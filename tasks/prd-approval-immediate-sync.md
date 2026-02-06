# PRD: Immediate Sync on Approval

## Introduction

When a user approves or unapproves a merge request, the action is currently queued in `sync_queue` and only pushed to GitLab during the next background sync cycle (every 5 minutes). This means an approval can sit locally for up to 5 minutes before GitLab reflects it — creating confusion for teammates waiting on reviews.

This feature adds an immediate background push specifically for approval actions, so approve/unapprove reaches GitLab within seconds instead of minutes.

## Goals

- Push approve/unapprove actions to GitLab immediately after the user triggers them
- Keep the existing fire-and-forget UX — no new UI elements or notifications
- Maintain the regular 5-minute sync cycle unchanged as a safety net
- Reuse existing sync queue infrastructure (no parallel submission path)

## User Stories

### US-001: Trigger immediate sync after approval enqueue
**Description:** As a reviewer, I want my approval to reach GitLab immediately so that my teammates see it without waiting for the next sync cycle.

**Acceptance Criteria:**
- [ ] After `approve_mr` enqueues an action, the sync engine is notified to process pending approval actions immediately
- [ ] After `unapprove_mr` enqueues an action, the sync engine is notified to process pending approval actions immediately
- [ ] The immediate push happens in a background task — the command still returns instantly to the frontend
- [ ] The regular 5-minute sync cycle continues unchanged and is not disrupted by the immediate push
- [ ] Typecheck passes (`cargo check`)

### US-002: Process only approval actions during immediate flush
**Description:** As the system, I should only flush approval-type actions during the immediate push to avoid sending half-written comments or unintended bulk operations.

**Acceptance Criteria:**
- [ ] The immediate flush processes only `Approve`-type actions from the sync queue (which covers both approve and unapprove payloads)
- [ ] Other queued actions (Comment, Reply, Resolve, Unresolve) remain in the queue for the regular sync cycle
- [ ] If no approval actions are pending, the flush is a no-op (no unnecessary API calls)
- [ ] Typecheck passes (`cargo check`)

### US-003: Fall back to existing retry logic on immediate push failure
**Description:** As the system, if the immediate push to GitLab fails, I should not introduce new retry behavior — the existing 5-minute cycle and retry logic handle it.

**Acceptance Criteria:**
- [ ] If the immediate push fails (network error, 5xx, etc.), the action stays in the queue with its existing status/retry logic
- [ ] The failure does not block or delay the command response to the frontend
- [ ] The action will be retried during the next regular sync cycle (existing behavior)
- [ ] No new error UI or toast is shown for immediate push failures
- [ ] Typecheck passes (`cargo check`)

## Functional Requirements

- FR-1: Add a command channel or notification mechanism from approval commands to the sync engine to request an immediate flush
- FR-2: The sync engine must support an `FlushApprovals` (or similar) command that processes only `Approve`-type pending actions from the queue
- FR-3: The `approve_mr` command must send the flush signal after successfully enqueuing the action
- FR-4: The `unapprove_mr` command must send the flush signal after successfully enqueuing the action
- FR-5: The immediate flush must reuse the existing `sync_processor` logic for executing actions and handling errors/discards
- FR-6: The immediate flush must not interfere with a currently-running full sync (e.g., use a lock or sequential processing via the existing command channel)
- FR-7: The regular 5-minute sync interval must remain unchanged and unaffected

## Non-Goals

- No new UI elements, toasts, or notifications for the immediate push
- No immediate push for non-approval actions (comments, replies, resolve/unresolve)
- No changes to the sync interval or sync configuration
- No new retry strategy — existing retry logic applies as-is
- No changes to the frontend `ApprovalButton` component

## Technical Considerations

- The sync engine already has a command channel (`SyncCommand` enum with `TriggerSync`, `UpdateConfig`, `Stop`). Adding a `FlushApprovals` variant is the natural extension point.
- The `SyncHandle` is already stored as Tauri managed state, so approval commands can access it to send the flush signal.
- The `sync_processor::process_action` function already handles individual action execution — the flush just needs to select and iterate only `Approve`-type pending actions.
- Concurrency: if a full sync is in progress when the flush arrives, the flush should either wait for the sync to finish or be skipped (the full sync will process approvals anyway). The existing command channel pattern handles this naturally since commands are processed sequentially.
- The `SyncHandle` needs to be passed to (or accessible from) the approval commands. Currently approval commands only receive the DB pool — they will also need access to `SyncHandle`.

## Success Metrics

- Approval actions reach GitLab within seconds of the user clicking approve/unapprove (instead of up to 5 minutes)
- No regression in existing sync behavior or approval UI responsiveness
- No increase in GitLab API errors from approval pushes

## Open Questions

- Should the flush signal be debounced if multiple approvals happen in rapid succession (e.g., approving several MRs quickly)? Likely unnecessary given approvals are infrequent, but worth noting.
