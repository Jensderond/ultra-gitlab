# PRD: Sync Engine Performance Optimizations

## Introduction

The sync engine (`sync_engine.rs`) is the backbone of Ultra GitLab, responsible for fetching MR metadata, diffs, comments, and file content from GitLab and keeping the local SQLite database in sync. Currently, all work is done sequentially and events are emitted unconditionally, leading to unnecessary API wait time and frontend re-renders. This PRD covers four targeted optimizations — plus a prerequisite 429 retry/backoff mechanism — that reduce wasted work and introduce bounded concurrency to make syncs significantly faster without sacrificing stability.

## Goals

- Reduce unnecessary frontend event emissions by ~25% (remove redundant Updated emit)
- Cut per-MR detail fetch time by ~50% (parallel diff + comments)
- Dramatically speed up file content caching for MRs with many changed files (concurrent fetching, limit 6)
- Achieve ~3-4x faster sync for instances with 10+ MRs (concurrent MR processing, limit 4)
- Add 429 retry/backoff to GitLabClient so concurrency is safe against rate limits
- Maintain full correctness — no data loss, no stale state, no race conditions
- Provide measurable before/after proof via sync_metrics instrumentation

## User Stories

### US-001: Add 429 retry/backoff to GitLabClient
**Description:** As a developer, I need the GitLab HTTP client to automatically retry on 429 (rate limit) responses with exponential backoff, so that concurrent API calls don't cause permanent failures when rate limits are hit.

**Acceptance Criteria:**
- [ ] `handle_response` in `gitlab_client.rs` detects 429 status and retries with exponential backoff
- [ ] Respects `Retry-After` header from GitLab when present
- [ ] Maximum 3 retries per request, with backoff: 1s, 2s, 4s (or `Retry-After` value)
- [ ] After max retries, returns the 429 error as `AppError` (no silent swallowing)
- [ ] Retry logic lives in a shared helper used by both `handle_response` and `get_paginated`
- [ ] Existing non-429 error handling is unchanged
- [ ] `cargo check` passes
- [ ] Manual test: sync completes normally against real GitLab instance

### US-002: Add sync metrics instrumentation
**Description:** As a developer, I need timing instrumentation so I can capture baseline "before" metrics and compare "after" metrics for each optimization.

**Acceptance Criteria:**
- [ ] New `sync_metrics` table: `(id, sync_run_id TEXT, phase TEXT, instance_id INTEGER, mr_iid INTEGER, duration_ms INTEGER, api_calls INTEGER, items_processed INTEGER, timestamp INTEGER)`
- [ ] Migration added to `src-tauri/src/db/migrations/`
- [ ] `sync_run_id` (UUID) generated once per `run_sync()` call, passed through to sub-functions
- [ ] Metrics recorded for phases: `total`, `instance`, `mr`, `diff`, `comments`, `file_cache`
- [ ] `AtomicU64` API call counter added to `GitLabClient`, incremented on every HTTP request
- [ ] Counter readable via `client.call_count()` method
- [ ] Metrics logged at end of each sync run via `log::info!` with summary (total_ms, api_calls, mr_count, events_emitted)
- [ ] `cargo check` passes
- [ ] Run 5 baseline syncs against real GitLab and record metrics

### US-003: Remove first Updated emit
**Description:** As a user, I want the sync engine to emit fewer redundant events so the frontend doesn't re-render with stale approval data mid-sync.

**Acceptance Criteria:**
- [ ] The `emit_mr_updated(Created/Updated)` call at line 829 of `sync_engine.rs` is removed
- [ ] The `emit_mr_updated(Updated)` at line 908 (after approval data is written) remains as the single metadata-update event
- [ ] For newly created MRs (`is_new == true`), a `Created` event is still emitted — move it to after approvals are written (near line 908)
- [ ] Frontend `tauriEvents.ts` continues to work without changes (event shape is unchanged)
- [ ] `cargo check` passes
- [ ] Manual test: create a new MR in GitLab, trigger sync, verify MR appears in the app
- [ ] Manual test: update an existing MR in GitLab, trigger sync, verify approval data is correct on first render
- [ ] Compare sync_metrics: events_emitted should decrease by ~25% vs baseline

### US-004: Concurrent diff + comments fetch with tokio::join!
**Description:** As a user, I want diff and comment fetching to happen in parallel per MR so that syncs are faster.

**Acceptance Criteria:**
- [ ] In `sync_mr()`, the diff fetch (`client.get_merge_request_diff`) and comments fetch (`client.list_discussions`) are wrapped in `tokio::join!`
- [ ] Both results are handled independently — a diff error does not prevent comment processing, and vice versa (matches current behavior)
- [ ] The `emit_progress` calls for `FetchingDiff` and `FetchingComments` phases are combined or emitted before the join
- [ ] `cache_file_contents()` still runs after diff fetch completes (it depends on the diff result)
- [ ] Error logging for each phase remains identical to current behavior
- [ ] `cargo check` passes
- [ ] Manual test: sync completes successfully, diffs and comments both appear correctly
- [ ] Compare sync_metrics: per-MR `duration_ms` should decrease by ~30-50%

### US-005: Concurrent file content fetching
**Description:** As a user, I want file content caching to fetch multiple files in parallel so that MRs with many changed files sync much faster.

**Acceptance Criteria:**
- [ ] `cache_file_contents()` uses `futures::stream::FuturesUnordered` (or `buffer_unordered`) to fetch files concurrently
- [ ] Concurrency is hardcoded to `MAX_CONCURRENT_FILE_FETCHES = 6`
- [ ] Each file fetch task includes: check cache → fetch from GitLab → SHA-256 hash → upsert blob → upsert version (same logic as current sequential version)
- [ ] The `pool: DbPool` (which is `SqlitePool`) is shared across concurrent tasks via `.clone()` (sqlx pools are `Arc`-based)
- [ ] The `client: &GitLabClient` is shared across tasks (needs `client.clone()` or `Arc` wrapping if `&self` won't work with spawn)
- [ ] Per-file errors are logged and do not abort other file fetches (matches current behavior)
- [ ] Binary file skip logic remains before spawning tasks
- [ ] The SHA-unchanged early return (lines 1348-1355) still short-circuits the entire function
- [ ] Add `futures` crate to `Cargo.toml` if not already present
- [ ] `cargo check` passes
- [ ] Manual test: open an MR with 10+ changed files, verify all file contents load correctly
- [ ] Compare sync_metrics: `file_cache` phase `duration_ms` should decrease significantly for MRs with many files

### US-006: Concurrent MR processing
**Description:** As a user, I want multiple MRs to sync in parallel within an instance so that syncing 10+ MRs is much faster.

**Acceptance Criteria:**
- [ ] `notified_mr_ready: HashSet<i64>` on `SyncEngine` is changed to `Arc<RwLock<HashSet<i64>>>` (tokio RwLock)
- [ ] All reads/writes to `notified_mr_ready` use `.read().await` / `.write().await`
- [ ] `sync_mr()` is refactored to not require `&mut self` — it should work with `&self` or as a standalone function taking `Arc`-wrapped shared state
- [ ] In `sync_instance()`, the sequential `for mr in &mrs` loop is replaced with a `tokio::task::JoinSet` (or `FuturesUnordered`) bounded by a `tokio::sync::Semaphore` with `MAX_CONCURRENT_MRS = 4`
- [ ] Each spawned task gets cloned copies of: `pool`, `app_handle`, `client`, `notified_mr_ready`, and the MR data it needs
- [ ] Results are collected after all tasks complete: successful MR IDs go into `synced_local_mr_ids`, errors go into `result.errors` (matches current behavior)
- [ ] The post-MR-loop operations (`check_mr_ready_transitions`, `cache_project_titles`, `refresh_gitattributes`, `purge_closed_mrs`, `push_pending_actions`) still run sequentially after all MRs are processed
- [ ] Auth errors (401) from any MR task are detected and the `AUTH_EXPIRED_EVENT` is emitted (matches current behavior)
- [ ] `cargo check` passes
- [ ] Manual test: sync with 5+ MRs, verify all MRs appear correctly with diffs, comments, and approvals
- [ ] Manual test: verify sync still works correctly with a single MR (edge case: semaphore with 1 item)
- [ ] Compare sync_metrics: `instance` phase `duration_ms` should decrease by ~2-3x for 10+ MRs

## Functional Requirements

- FR-1: `GitLabClient` must retry 429 responses with exponential backoff (1s, 2s, 4s) up to 3 times, respecting `Retry-After` header
- FR-2: A `sync_metrics` table must record per-phase timing data with a `sync_run_id` UUID per sync run
- FR-3: `GitLabClient` must expose an `AtomicU64` API call counter incremented on every HTTP request
- FR-4: The first `emit_mr_updated` call in `sync_mr()` (line 829) must be removed; the `Created` event for new MRs must be emitted after approvals are written
- FR-5: Diff and comment fetching within `sync_mr()` must execute concurrently via `tokio::join!`
- FR-6: `cache_file_contents()` must fetch up to 6 files concurrently using `FuturesUnordered`
- FR-7: `sync_instance()` must process up to 4 MRs concurrently using a `Semaphore`-bounded task set
- FR-8: `SyncEngine::notified_mr_ready` must use `Arc<RwLock<HashSet<i64>>>` to support shared concurrent access
- FR-9: All concurrency limits must be hardcoded constants (not user-configurable)
- FR-10: Per-MR errors must not abort processing of other MRs (best-effort error handling)
- FR-11: Sync metrics must be compared before/after each optimization: 5+ runs each, comparing median total_ms, api_calls, and events_emitted

## Non-Goals

- No user-configurable concurrency limits (hardcoded constants only)
- No concurrent instance-level syncing (instances still sync sequentially)
- No webhook-based push updates (still poll-based)
- No incremental sync via `updated_after` filtering (separate future optimization)
- No changes to frontend event handling or query invalidation logic (separate PRD)
- No ETag/conditional request support
- No changes to the sync queue / pending actions processing

## Technical Considerations

- **SQLite concurrency**: sqlx's `SqlitePool` handles concurrent access via WAL mode. Multiple readers are fine; concurrent writers queue at the SQLite level. The bounded concurrency (4 MRs, 6 files) keeps write contention manageable.
- **GitLabClient cloning**: `GitLabClient` contains a `reqwest::Client` (which is internally `Arc`-based and cheap to clone) and a `GitLabClientConfig`. It needs `Clone` derived or the client wrapped in `Arc` for sharing across spawned tasks.
- **Rate limits**: GitLab allows ~10 req/s per user (gitlab.com). With 4 concurrent MRs each making ~3 API calls, peak concurrency is ~12 requests. The 429 retry/backoff (US-001) provides safety. Self-hosted instances may have different limits.
- **Task spawning**: `tokio::spawn` requires `'static` futures. This means data passed to spawned tasks must be owned (cloned) rather than borrowed. `SyncEngine` fields (`pool`, `app_handle`) are already cheap to clone.
- **Ordering**: Post-sync operations (ready-state transitions, purge, action push) depend on all MRs being processed first. The `JoinSet` must be fully drained before these run.
- **Dependency chain**: US-001 (429 backoff) must be implemented before US-005 and US-006 to ensure concurrency is safe.

## Success Metrics

- Events emitted per sync cycle reduced by ≥25% after US-003
- Per-MR detail fetch time reduced by ≥30% after US-004
- File caching time for MRs with 10+ files reduced by ≥50% after US-005
- Total instance sync time for 10+ MRs reduced by ≥50% after US-006
- Zero increase in sync errors, failed actions, or auth-expired events across all changes
- Zero increase in 429 rate-limit errors (backoff handles them transparently)
- All metrics proven via before/after comparison using sync_metrics data (≥5 runs each)

## Open Questions

- Should `MAX_CONCURRENT_MRS` be reduced to 3 if we observe SQLite write contention under load?
- Should we add a global rate limiter (token bucket) in `GitLabClient` in addition to 429 retry, or is retry-on-429 sufficient?
- Does `cache_file_contents` need to run inside the MR concurrent task, or can it be deferred to a post-MR-loop batch phase for better throughput?
