# PRD: Event-Driven UI Updates from Sync Engine

## Introduction

The background sync engine periodically fetches MR data from GitLab but has no way to notify the frontend when it finishes. The frontend currently polls `get_sync_status` every 5 seconds to detect changes — wasteful and introducing up to 5 seconds of UI latency. Event payload structs and frontend listeners already exist (`sync_events.rs`, `useSyncStatus.ts`) but the sync engine's `run_sync()` method never actually emits them. This feature wires up the existing event infrastructure so the UI reacts to sync completion in real-time, and removes polling entirely.

## Goals

- Emit Tauri events from the sync engine at each sync phase and for each MR update
- Auto-refresh the frontend MR list and sync status when events arrive
- Remove the 5-second polling interval from `useSyncStatus`
- Maintain backward compatibility with existing event listeners in `App.tsx` and `useSyncStatus.ts`

## User Stories

### US-001: Pass AppHandle to SyncEngine
**Description:** As a developer, I need the sync engine to have access to `AppHandle` so it can emit events to the frontend.

**Acceptance Criteria:**
- [ ] `SyncEngine` struct stores a `tauri::AppHandle` field
- [ ] `start_background()` accepts `AppHandle` as a parameter
- [ ] `AppHandle` is passed from `lib.rs` setup where the sync engine is started
- [ ] `use tauri::Emitter;` is imported where `emit()` is called
- [ ] Existing sync functionality is unchanged (sync still runs on schedule, commands still work)
- [ ] `cargo check` passes

### US-002: Emit sync-progress events from run_sync
**Description:** As a user, I want the UI to show real-time sync progress so I know what the app is doing in the background.

**Acceptance Criteria:**
- [ ] `run_sync()` emits `sync-progress` with phase `"starting"` when sync begins
- [ ] Emits `"fetching_mrs"` when fetching MR list for each instance (payload includes instance URL)
- [ ] Emits `"fetching_diff"` when fetching diffs for an MR
- [ ] Emits `"fetching_comments"` when fetching comments for an MR
- [ ] Emits `"pushing_actions"` when processing the sync queue
- [ ] Emits `"purging"` when purging merged/closed MRs
- [ ] Emits `"complete"` when sync finishes successfully (payload includes MR count and duration)
- [ ] Emits `"failed"` when sync encounters an unrecoverable error (payload includes error message)
- [ ] Uses the existing `SyncProgressPayload` struct from `sync_events.rs`
- [ ] `cargo check` passes

### US-003: Emit mr-updated events per MR
**Description:** As a user, I want the MR list and detail view to update automatically as each MR is synced, so I see changes progressively without waiting for the full sync to finish.

**Acceptance Criteria:**
- [ ] Emits `mr-updated` with kind `"created"` when a new MR is inserted into the cache
- [ ] Emits `mr-updated` with kind `"updated"` when MR metadata (title, description, state, labels, reviewers, approval) changes
- [ ] Emits `mr-updated` with kind `"diff_updated"` when diff data is cached or changed
- [ ] Emits `mr-updated` with kind `"comments_updated"` when discussions/comments are synced for an MR
- [ ] Emits `mr-updated` with kind `"purged"` when a merged/closed MR is removed from cache
- [ ] Each event payload includes `mr_id` and `instance_url` (matching existing `MrUpdatedPayload`)
- [ ] `cargo check` passes

### US-004: Emit action-synced events during sync queue processing
**Description:** As a user, I want to know when my queued actions (approvals, comments) are pushed to GitLab during background sync.

**Acceptance Criteria:**
- [ ] Emits `action-synced` for each action processed during `push_pending_actions` in the sync loop
- [ ] Payload includes action type, success/failure status, and error message if failed
- [ ] Uses existing `ActionSyncedPayload` struct from `sync_events.rs`
- [ ] `cargo check` passes

### US-005: Emit auth-expired events on 401 during sync
**Description:** As a user, I want to be prompted to re-authenticate when my GitLab token expires, even if it happens during background sync.

**Acceptance Criteria:**
- [ ] When a GitLab API call returns 401 during sync, emits `auth-expired` event
- [ ] Payload includes instance URL and a descriptive message
- [ ] Sync skips the affected instance and continues with remaining instances
- [ ] Uses existing `AuthExpiredPayload` struct from `sync_events.rs`
- [ ] `cargo check` passes

### US-006: Auto-refresh frontend on sync events
**Description:** As a user, I want the MR list and detail views to automatically update when sync events arrive, without me having to manually refresh.

**Acceptance Criteria:**
- [ ] `useSyncStatus` updates `isSyncing` state based on `sync-progress` phase (true for starting through purging, false for complete/failed)
- [ ] `useSyncStatus` updates `lastSyncTime`, `lastError`, `lastSyncMrCount` from `sync-progress` complete/failed payloads
- [ ] MR list re-fetches data when `mr-updated` events arrive (debounced — not on every single event during a burst)
- [ ] MR detail view re-fetches when an `mr-updated` event matches the currently viewed MR
- [ ] Pending/failed action counts update when `action-synced` events arrive
- [ ] Typecheck passes (`bunx tsc --noEmit`)

### US-007: Remove polling from useSyncStatus
**Description:** As a developer, I want to remove the 5-second polling interval so the app relies entirely on events for sync status updates.

**Acceptance Criteria:**
- [ ] The `setInterval` / polling logic in `useSyncStatus` is removed
- [ ] Initial status is still fetched on mount (one-time `get_sync_status` call)
- [ ] Manual `triggerSync()` still works and updates status via events
- [ ] `retryAllActions()` and `discardAction()` still work
- [ ] No `pollInterval` option remains in the hook's API
- [ ] Typecheck passes (`bunx tsc --noEmit`)

## Functional Requirements

- FR-1: `SyncEngine` must accept and store a `tauri::AppHandle` to emit events
- FR-2: `run_sync()` must emit `sync-progress` events at each phase transition (starting, fetching_mrs, fetching_diff, fetching_comments, pushing_actions, purging, complete, failed)
- FR-3: `run_sync()` must emit `mr-updated` events per MR when data changes (created, updated, diff_updated, comments_updated, purged)
- FR-4: `run_sync()` must emit `action-synced` events when processing queued actions
- FR-5: `run_sync()` must emit `auth-expired` when encountering 401 responses from GitLab
- FR-6: Event emission failures must be logged but must not abort the sync (fire-and-forget)
- FR-7: Frontend `useSyncStatus` must derive all sync state from events, not polling
- FR-8: Frontend must debounce MR list refetches when receiving rapid `mr-updated` events (e.g., 500ms debounce window)
- FR-9: Frontend must still fetch initial sync status on mount via `get_sync_status` command
- FR-10: The `flush_approvals` code path must also emit `action-synced` events for consistency

## Non-Goals

- No new event types beyond the 4 already defined in `sync_events.rs`
- No WebSocket or SSE — Tauri's built-in event system is sufficient
- No event persistence or replay (events are fire-and-forget)
- No changes to sync scheduling logic (interval, manual trigger)
- No UI changes to sync status display (the existing status bar / indicators will simply update faster)
- No changes to the optimistic update patterns for approve/comment actions

## Technical Considerations

- **AppHandle is `Send + Sync`**: Safe to store in `SyncEngine` and use from the background tokio task
- **Event payloads must be `Clone + Serialize`**: The existing payload structs in `sync_events.rs` already satisfy this
- **Debouncing on frontend**: Use a debounce (e.g., 500ms) when `mr-updated` events trigger MR list refetches, since a single sync cycle can emit 50-100+ events
- **Event emission is cheap**: `AppHandle::emit()` serializes to JSON and dispatches to webview — sub-millisecond, no network round-trip
- **`flush_approvals` path**: Currently processes approval actions outside the main sync loop; needs the same event emission treatment for consistency
- **Existing `retry_failed_actions` command**: Already emits events — ensure it continues to work alongside the new engine-level emissions
- **`use tauri::Emitter;`**: Must be imported in any file that calls `app.emit()`

## Success Metrics

- MR list updates within 100ms of sync completing an MR (vs. up to 5 seconds with polling)
- Zero `setInterval` polling calls for sync status in the frontend
- Sync engine emits progress events for every phase of every sync cycle
- No regressions in existing sync, approval, or comment functionality

## Open Questions

- Should `mr-updated` events include a summary of what changed (e.g., new labels, new comments count) or just signal that an update occurred?
- Should we add a `sync-progress` event for `fetching_approval_status` as a distinct phase, or keep it bundled with `fetching_mrs`?
