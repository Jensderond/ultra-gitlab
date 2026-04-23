# PRD: Offline-First Support for Issues

## Introduction

Ultra GitLab already has robust offline-first behavior for Merge Requests: MR rows, diffs, comments, and reviewer data are cached in SQLite, and user actions (approve, comment, reply, resolve) are queued through `sync_queue` and reconciled by `sync_processor`. Issues were added later and only inherit *half* of that pattern — issue rows are cached by the 30-minute sync engine, but every interaction on the Issue Detail page goes live to GitLab:

- `get_issue_detail` always hits the network (even though the row is already in SQLite)
- `list_issue_notes` never caches — comments are fetched on every visit
- `add_issue_note`, `set_issue_assignees`, `set_issue_state` call GitLab directly with no queue fallback

The result: the Issue Detail page shows a loading spinner on every visit, breaks entirely when offline, and silently fails user actions when the network is flaky.

This PRD brings Issues to the same offline-first bar as MRs. The user should be able to sync, go fully offline, navigate between issues without spinners (beyond local SQLite latency), perform actions (comment, reassign, close/reopen), and have those actions flow back to GitLab automatically when connectivity returns.

## Goals

- Issue Detail page reads exclusively from local cache on navigation — no network round-trip blocks the UI
- Issue notes (comments) are cached in SQLite and survive restarts
- All issue mutations (add note, change assignees, close/reopen) are persisted locally and queued for sync via the existing `sync_queue` infrastructure
- Queued mutations apply optimistically to the local view so the user sees their change immediately, with a visible "pending sync" marker
- The app detects connectivity from sync_engine's existing network-error signals and pauses/resumes the queue processor accordingly — no explicit ping
- Conflicts between a queued action and server state (e.g. issue deleted or state already changed) are surfaced rather than silently lost
- Zero regression to existing MR offline behavior

## User Stories

### US-001: Cache issue notes in SQLite

**Description:** As the system, I need to persist issue comments locally so the detail view can render without a network call.

**Acceptance Criteria:**
- [ ] New migration adds an `issue_notes` table with columns: `id` (GitLab note id, PK), `instance_id`, `project_id`, `issue_iid`, `author_username`, `author_name`, `author_avatar_url`, `body`, `created_at`, `updated_at`, `system` (bool), `resolvable` (bool), `resolved` (bool), `cached_at`
- [ ] Index on `(instance_id, project_id, issue_iid)` for fast per-issue lookup
- [ ] New module `src-tauri/src/db/issue_notes.rs` exposing `upsert_issue_note`, `list_issue_notes_cached`, `delete_issue_notes_for_issue`, `delete_issue_note`
- [ ] Module registered in `src-tauri/src/db/mod.rs`
- [ ] `cargo check` passes

### US-002: Cache-only read commands for issue detail

**Description:** As the frontend, I need tauri commands that read issue detail and notes from SQLite without touching GitLab.

**Acceptance Criteria:**
- [ ] New command `get_cached_issue_detail(instance_id, project_id, issue_iid) -> Option<IssueWithProject>` returning the joined row from the local DB (None if not cached)
- [ ] New command `list_cached_issue_notes(instance_id, project_id, issue_iid) -> Vec<IssueNoteDto>` returning cached notes ordered by `created_at ASC`
- [ ] Commands registered in `commands/mod.rs` and `lib.rs` handler list
- [ ] Neither command makes any `gitlab_client` call
- [ ] `cargo check` passes

### US-003: Background refresh command for issue detail + notes

**Description:** As the frontend, I need a command that pulls fresh issue detail and notes from GitLab and writes them to the cache, so I can call it in the background after showing cached data.

**Acceptance Criteria:**
- [ ] New command `refresh_issue_detail(instance_id, project_id, issue_iid) -> IssueWithProject` that fetches the issue and notes from GitLab, upserts both into SQLite, deletes any locally-cached notes whose GitLab id is no longer present, and returns the joined row
- [ ] The refresh is idempotent: running it twice produces identical DB state
- [ ] Failures return a clear `AppError` the frontend can detect (offline vs other)
- [ ] The existing `get_issue_detail` command is deprecated in favor of `refresh_issue_detail` + `get_cached_issue_detail` (frontend migrated, then old command removed)
- [ ] `cargo check` passes

### US-004: Frontend reads issue detail from cache, refreshes in background

**Description:** As a user, I want the Issue Detail page to appear instantly when I navigate to it, with any newer data appearing silently once it loads.

**Acceptance Criteria:**
- [ ] `useIssueDetailQuery` and `useIssueNotesQuery` call the new cached-read commands
- [ ] On mount, a background refresh (`refresh_issue_detail`) is triggered; its result invalidates the cached queries so the view updates in place
- [ ] If no cached row exists (first-ever visit to this issue), the page shows a loading state only until the background refresh returns; on subsequent visits, no loading state is ever shown
- [ ] A small, unobtrusive "updating…" indicator appears while the background refresh is in flight, and disappears on completion
- [ ] Typecheck passes (`bunx tsc --noEmit`)
- [ ] Verify in browser: navigate to an issue, see instant render; re-navigate, see no spinner; throttle network in devtools and confirm the page still renders from cache

### US-005: Extend sync queue to support issue actions

**Description:** As the system, I need the sync queue to carry issue-targeted actions alongside MR actions.

**Acceptance Criteria:**
- [ ] Migration makes `sync_actions.mr_id` nullable and adds nullable `issue_id` column; existing rows retain their `mr_id` and get NULL `issue_id`
- [ ] Check constraint ensures exactly one of `mr_id` / `issue_id` is set per row
- [ ] `ActionType` enum gains `AddIssueNote`, `SetIssueAssignees`, `SetIssueState`
- [ ] New payload structs (`IssueNotePayload`, `IssueAssigneesPayload`, `IssueStatePayload`) serialize to JSON like existing MR payloads
- [ ] `EnqueueInput` supports an `issue_id` variant; existing MR enqueue paths are untouched
- [ ] `sync_queue::list_pending_actions` returns both MR and issue actions
- [ ] `cargo check` passes

### US-006: Processor handles issue actions

**Description:** As the system, I need `sync_processor` to execute queued issue actions against GitLab and mark them synced.

**Acceptance Criteria:**
- [ ] Processor dispatches `AddIssueNote` → `gitlab_client.add_issue_note`, persists the returned note id into the local `issue_notes` row replacing the placeholder
- [ ] Processor dispatches `SetIssueAssignees` → `gitlab_client.update_issue` with assignee ids and upserts the returned issue row
- [ ] Processor dispatches `SetIssueState` → `gitlab_client.update_issue` with state event and upserts the returned issue row
- [ ] Retry + backoff behavior mirrors MR actions (same `MAX_RETRIES` and error-classification rules)
- [ ] Terminal failures (issue deleted, permission denied) mark the action `discarded` and emit a `sync_events` entry the frontend can surface
- [ ] `cargo check` passes
- [ ] Integration-test style manual check with real credentials: enqueue a comment while offline (network disabled), re-enable network, confirm it appears on GitLab within the next sync tick

### US-007: Optimistic local writes for issue mutations

**Description:** As a user, I want my changes to an issue to appear immediately in the UI, even when offline, with a clear indicator that they are pending sync.

**Acceptance Criteria:**
- [ ] `add_issue_note` command is replaced by `enqueue_issue_note`: inserts a placeholder row into `issue_notes` with a negative/local id and `pending_sync = true`, enqueues the action, returns the placeholder
- [ ] `set_issue_assignees` / `set_issue_state` commands are replaced by `enqueue_*` variants: patch the local `issues` row immediately, enqueue the action, return the updated row
- [ ] New `pending_sync` boolean column on `issues` and `issue_notes` (default false) flipped to true on optimistic write, back to false when processor confirms
- [ ] Frontend renders pending notes with a subtle "pending" pill; pending issue rows show the same indicator in the header
- [ ] On processor failure that is *not* a terminal failure (network error), row stays `pending_sync = true` until a retry succeeds
- [ ] On terminal failure (discarded), the optimistic change is rolled back and the user sees a toast explaining why
- [ ] Typecheck + `cargo check` pass
- [ ] Verify in browser: post a comment while online (appears instantly with pending pill, resolves to normal shortly after); post a comment with network disabled, re-enable network, confirm it syncs

### US-008: Connectivity awareness via sync_engine signals

**Description:** As the system, I want to pause queue processing when I detect the network is unreachable and resume when it comes back — without running an explicit ping.

**Acceptance Criteria:**
- [ ] `sync_engine` classifies request failures as "offline" (DNS/connect/timeout) vs "other" (4xx/5xx) using existing error variants
- [ ] A shared `ConnectivityState` (`Online` | `Offline`) is updated whenever sync_engine completes or fails a request; exposed via a getter
- [ ] `sync_processor`'s loop checks `ConnectivityState` before draining the queue; when offline, it sleeps and skips draining
- [ ] When connectivity transitions `Offline -> Online`, the processor is nudged to drain immediately (reuse existing wake mechanism)
- [ ] A `sync_events` event announces connectivity transitions so the frontend can show status
- [ ] `cargo check` passes

### US-009: Frontend "pending sync" indicator and offline banner

**Description:** As a user, I want to see at a glance whether the app is online and whether I have unsynced actions.

**Acceptance Criteria:**
- [ ] Global status pill (location: top of sidebar or page header — designer's call) shows `Synced` / `N pending` / `Offline · N pending`
- [ ] Pill is reactive to `sync_events` (connectivity and queue depth)
- [ ] Clicking the pill opens the existing sync status surface (if one exists) or a minimal popover listing pending actions with `retry` / `discard` controls
- [ ] Pill is hidden entirely when there's no activity (online + zero pending)
- [ ] Typecheck passes
- [ ] Verify in browser: perform an issue action online (pill flashes `1 pending` then clears); disable network, perform an action (pill shows `Offline · 1 pending`); re-enable network, pill clears

### US-010: Conflict handling for terminal failures

**Description:** As a user, when my queued action cannot succeed (e.g. issue was deleted, I lost access, or the state was already changed), I need clear feedback rather than silent data loss.

**Acceptance Criteria:**
- [ ] Processor classifies these GitLab responses as terminal: 404 (not found), 403 (forbidden), 410 (gone), and 409 specifically when the state transition is already applied
- [ ] Terminal failures mark the action `discarded`, roll back the optimistic local change, and emit a `sync_event` with kind `action_discarded` and a human-readable reason
- [ ] Frontend displays a toast per discarded action with the reason and a link to re-open the issue if it still exists
- [ ] Non-terminal failures (5xx, network errors) continue to retry per existing MR logic
- [ ] `cargo check` passes
- [ ] Manual check with real credentials: queue a state change while offline, delete the issue on GitLab, re-enable network, confirm the action is discarded with a toast

### US-011: Remove dead `get_issue_detail` / direct mutation commands

**Description:** As the codebase, I should not carry parallel online-only paths once the offline path is in place.

**Acceptance Criteria:**
- [ ] `get_issue_detail`, `add_issue_note`, `set_issue_assignees`, `set_issue_state` commands are removed from `commands/issues.rs`, `commands/mod.rs`, and `lib.rs`
- [ ] Frontend service layer (`services/tauri.ts`, `services/gitlab.ts`, `services/index.ts`) is updated — no dangling exports
- [ ] All frontend call sites use the new cached-read + enqueue commands
- [ ] `cargo check` and `bunx tsc --noEmit` both pass

## Functional Requirements

- FR-1: `issue_notes` table caches every note the app has ever seen; notes are upserted on background refresh and on successful enqueue settlement.
- FR-2: Issue detail view reads only from SQLite on navigation. A background refresh runs in parallel.
- FR-3: Notes are fetched from GitLab and cached on first visit to an issue; thereafter notes are read from cache and refreshed opportunistically via background refresh.
- FR-4: Local writes to issues (comments, assignees, state) are applied to SQLite first, queued in `sync_actions` second, and reconciled to GitLab by `sync_processor`.
- FR-5: `sync_actions` table accepts either an `mr_id` or an `issue_id` (not both); existing MR rows are unchanged by the migration.
- FR-6: `ActionType` gains `AddIssueNote`, `SetIssueAssignees`, `SetIssueState`; payload shapes follow the existing MR payload pattern.
- FR-7: Optimistic rows carry a `pending_sync` flag rendered in the UI as a small pill.
- FR-8: Terminal failures (404/403/410, no-op 409) discard the queued action, roll back the optimistic write, and emit a `sync_event`.
- FR-9: Connectivity state is derived from sync_engine request outcomes (no explicit ping); processor pauses when offline.
- FR-10: A status indicator surfaces connectivity + pending-action count and is reactive to sync events.
- FR-11: The legacy online-only commands (`get_issue_detail`, `add_issue_note`, `set_issue_assignees`, `set_issue_state`) are removed in the same PRD.

## Non-Goals

- No offline creation of *new* issues (only existing-issue mutations are queued).
- No support for editing existing notes (GitLab API supports it; out of scope here).
- No offline support for issue label changes or milestone changes.
- No changes to the 30-minute bulk sync cadence; the sync engine's existing tick is reused.
- No explicit connectivity-probe endpoint (e.g. `/api/v4/version` ping); connectivity is inferred from actual request outcomes per answer 5A.
- No bulk pre-fetch of notes for all cached issues (per answer 4C, notes are lazy-cached on first visit).
- No multi-device conflict resolution beyond "last writer wins per field, terminal GitLab responses discard optimistic state."
- No offline attachment uploads.

## Design Considerations

- **Pending pill.** Reuse the existing badge styling used for pending MR comments — do not invent a new visual.
- **Offline banner.** Prefer a compact status pill over a full banner; avoid disrupting layout. Place in the same region as the existing sync-status indicator (if any).
- **Loading indicator.** "Updating…" microcopy should be subtle (small text or spinner glyph), positioned near the issue title, not a full-page overlay.
- **Frontend data layer.** Follow the existing react-query + service-layer pattern (`hooks/queries/useIssuesQuery.ts`, `services/tauri.ts`, `services/gitlab.ts`). No new state management primitive.

## Technical Considerations

- **Migration ordering.** The `sync_actions` nullability migration must run before any migration that writes rows with null `mr_id`. Gate new enqueues on migration success.
- **Payload deserialization backward compatibility.** Existing queued MR actions must still deserialize after the migration — use additive changes only to shared structs.
- **Avoid loops.** Background refresh invalidates react-query caches; make sure the invalidation does not re-trigger another `refresh_issue_detail` call on the same render (guard with a mount-scoped ref or `refetchOnMount: false`).
- **Negative local ids for optimistic notes.** Use monotonically decreasing negative ids seeded from `sync_actions.id` to avoid PK collisions; replace with the real GitLab id when the processor lands the note.
- **Processor fairness.** When both MR and issue actions are pending, interleave by `created_at` so neither type starves.
- **Test credentials.** All integration-style checks must use real credentials from `credentials.md` per CLAUDE.md.

## Success Metrics

- Issue Detail page renders in under 50ms from navigation on a warm cache (SQLite read + render only).
- Zero network calls are made on Issue Detail navigation when cached data exists (verify in devtools network tab).
- Issue actions performed while offline are reflected on GitLab within one sync tick of reconnection.
- Zero regressions in existing MR offline behavior (manual smoke test: comment, reply, resolve, approve).

## Open Questions

- Should the "pending" pill on a note be a subtle corner glyph or inline text? (Design judgment call, punt to implementer with instruction to match existing MR pending styling if any.)
- When a queued `SetIssueState` is superseded by a second `SetIssueState` for the same issue before the first syncs, do we collapse them in the queue or execute sequentially? (Recommend collapse; confirm during implementation.)
- Do we want a "Retry all" control on the status pill popover, or is per-action retry enough? (Defer; decide when building US-009.)
