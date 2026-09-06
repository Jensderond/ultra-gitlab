# Plan: Queue Issue Mutations Through the Sync Queue (Issue Offline Writes)

## Context

The app's core promise is offline-first review. For merge requests that promise holds
end to end: approvals, comments, replies and resolves are applied to SQLite first,
enqueued in `sync_queue`, and pushed by `sync_processor` when the network is there
(`src-tauri/src/commands/approval.rs:50-60`, `src-tauri/src/commands/comments.rs:264-380`).

Issues only got half of that. `tasks/prd-issue-offline-support.md` US-001 to US-004 are
done: issue rows and notes are cached (`db/migrations/0020`, `0021`), the detail page reads
from SQLite and refreshes in the background (`src/pages/IssueDetailPage/useIssueData.ts:56-90`).
But every issue *write* still goes straight to GitLab with no fallback:

- `add_issue_note`, `set_issue_assignees`, `set_issue_state`, `set_issue_description`
  in `src-tauri/src/commands/issues.rs:511-583` each build a client and call the API inline.
- The frontend mutations in `useIssueData.ts:130-235` await that call, then call
  `refreshIssueDetail` again. Offline, the mutation throws and the UI shows a raw error.

So a user can browse issues offline but cannot comment, reassign, close or edit one.
The same action on an MR works. This plan closes that gap by implementing PRD
US-005, US-006, US-007, US-010 and US-011 (queue extension, processor dispatch, optimistic
local writes, terminal-failure handling, removal of the online-only path).

**Out of scope** (separate follow-ups): US-008 connectivity state machine and US-009 global
status pill. The existing queue already retries on every sync tick and can be flushed on
demand, which is enough for the write path to work offline. Offline creation of new issues,
label and milestone changes, and note editing stay out per the PRD non-goals.

---

## Design decisions

1. **Widen `sync_queue` rather than add a second queue.** One queue keeps ordering,
   retry, cleanup and the status counters in `get_sync_status` working for both kinds
   of action. The table is rebuilt (SQLite cannot relax NOT NULL in place), following the
   pattern already used in `db/migrations/0002_add_discarded_status.sql`.

2. **Store `instance_id` on the queue row for issue actions.** The engine currently
   resolves the instance for each action via `SELECT instance_id FROM merge_requests WHERE id = ?`
   (`services/sync_engine.rs:2628-2632`). Issues have a composite key `(id, instance_id)`, so
   a plain FK is not possible. Putting `instance_id` on the row makes resolution a no-op for
   issue actions and avoids a join.

3. **Keep the existing Tauri command names and signatures.** The PRD proposes renaming to
   `enqueue_*`. Keeping `add_issue_note`, `set_issue_assignees`, `set_issue_state` and
   `set_issue_description` and changing their semantics means no changes to
   `src/services/tauri.ts` call shapes or to `e2e/fixtures/tauri-mock.ts`. Return types
   gain a `pendingSync` field, which is additive.

4. **Last write wins for field changes.** When a new `IssueState`, `IssueAssignees` or
   `IssueDescription` action is enqueued for an issue that already has a pending action of
   the same type, the older one is marked `discarded` with reason `superseded`. This is the
   PRD's recommended answer to its open question and avoids close/reopen flapping.

5. **Optimistic rows carry `pending_sync`.** Notes get a negative local id (same scheme
   as MR comments in `commands/comments.rs`), issues get a flag. Both are cleared by the
   processor on success. Terminal failures roll the row back to server truth.

6. **Reuse the existing UI marker.** `SyncBadge` already renders pending/failed/discarded
   for MR comments but is duplicated in `ActivityFeed.tsx:27` and
   `CommentPanel/InlineComment.tsx:49`. Extract it once and reuse it for issue notes.

---

## Phase 0: Preparation (no behaviour change)

### 0.1 Extract issue persistence into `src-tauri/src/db/issues.rs`
`commands/issues.rs:384` (`upsert_and_join`) and its helpers hold the SQL that writes an
issue row and joins the project. The processor lives in `services/` and must not depend on
`commands/`. Move the upsert, the row-to-DTO join, and a new `set_pending_sync(pool,
instance_id, id, bool)` into `db/issues.rs`; keep `commands/issues.rs` as a thin caller.
Register in `db/mod.rs`.

### 0.2 Add `replace_local_note` and `delete_local_note` to `db/issue_notes.rs`
`replace_local_note(pool, instance_id, local_id, real_note)` deletes the negative-id row
and upserts the GitLab note in one transaction. `delete_local_note` is the rollback path.

### 0.3 Extract `SyncBadge` to `src/components/SyncBadge/SyncBadge.tsx`
Move the component and its CSS out of `ActivityFeed.tsx` and `InlineComment.tsx`, import it
from both. (`CommentPanel/` is dead code per the frontend survey; if it is deleted first,
only `ActivityFeed.tsx` needs updating.)

**Verify:** `cargo check`, `cargo test`, `bunx tsc --noEmit`, `bun run lint` all pass with
no behaviour change.

---

## Phase 1: Schema and model

### 1.1 Migration `0027_sync_queue_issue_targets.sql`
Rebuild `sync_queue` with:
- `mr_id INTEGER` (nullable), FK to `merge_requests(id) ON DELETE CASCADE` kept
- `issue_id INTEGER` (nullable, GitLab issue id)
- `instance_id INTEGER` (nullable), FK to `gitlab_instances(id) ON DELETE CASCADE`
- `CHECK ((mr_id IS NOT NULL AND issue_id IS NULL) OR (mr_id IS NULL AND issue_id IS NOT NULL AND instance_id IS NOT NULL))`
- everything else unchanged; copy rows with `INSERT ... SELECT`, recreate `idx_sync_queue_status`,
  add `idx_sync_queue_issue ON sync_queue(instance_id, issue_id, status)`.

Also in this migration:
- `ALTER TABLE issues ADD COLUMN pending_sync INTEGER NOT NULL DEFAULT 0;`
- `ALTER TABLE issue_notes ADD COLUMN pending_sync INTEGER NOT NULL DEFAULT 0;`

Check how `db/pool.rs` runs migrations. If sqlx wraps each file in a transaction, the
table rebuild needs `PRAGMA foreign_keys` handling identical to migration 0002; copy what
0002 does rather than inventing a new approach.

### 1.2 `models/sync_action.rs`
- `ActionType` gains `IssueNote`, `IssueAssignees`, `IssueState`, `IssueDescription`
  with `Display` strings `issuenote`, `issueassignees`, `issuestate`, `issuedescription`
  and matching `From<&str>` arms.
- `SyncAction.mr_id` becomes `Option<i64>`; add `issue_id: Option<i64>` and
  `instance_id: Option<i64>`. Add `fn target(&self) -> ActionTarget` returning
  `Mr(i64)` or `Issue { instance_id, issue_id }` so callers stop matching on raw fields.
- Fix every `action.mr_id` use that breaks: `sync_processor.rs` log lines,
  `sync_queue::get_actions_for_mr`, `commands/comments.rs`, the `SyncAction` literals in
  the `#[cfg(test)]` blocks, and `tests/*.rs`.
- Grep `src/` for a frontend type mirroring `SyncAction` (`mrId` on a sync action type)
  and make `mrId` optional there too.

### 1.3 `services/sync_queue.rs`
- New payload structs, all with `instance_id`, `project_id`, `issue_iid`:
  `IssueNotePayload { body }`, `IssueAssigneesPayload { assignee_ids: Vec<i64> }`,
  `IssueStatePayload { state_event: String }`, `IssueDescriptionPayload { description: String }`.
- `EnqueueInput` gains `issue_id: Option<i64>` and `instance_id: Option<i64>`; `mr_id`
  becomes `Option<i64>`. Add constructors `EnqueueInput::for_mr(mr_id, action_type, payload,
  local_ref)` and `EnqueueInput::for_issue(instance_id, issue_id, action_type, payload,
  local_ref)` and switch the four existing MR call sites to `for_mr` so their diff is one line.
- `enqueue_action` binds the new columns and reads them back.
- New `supersede_pending_issue_actions(pool, instance_id, issue_id, action_type)` that marks
  older pending rows of that type `discarded` with `last_error = 'superseded'`.
- New `get_issue_action_status(pool, local_reference_id)` mirroring
  `commands/comments.rs:138-151` so cached-note reads can report `pending`/`failed`.

**Verify:** `cargo test` (unit tests in `sync_action.rs` and `sync_queue.rs` extended for
the new variants and the CHECK constraint); an integration test that runs all migrations
on a fresh temp DB and on a DB seeded with pre-0027 `sync_queue` rows, asserting the rows
survive with `issue_id IS NULL`.

---

## Phase 2: Processor and engine

### 2.1 Dispatch in `services/sync_processor.rs:168-175`
Add arms:
- `IssueNote` → `process_issue_note(client, pool, action)`: parse payload, call
  `client.add_issue_note`, then `db::issue_notes::replace_local_note` using
  `action.local_reference_id`. Emit `issue-updated`.
- `IssueAssignees` / `IssueState` / `IssueDescription` → `process_issue_update(client, pool,
  action, IssueUpdate { .. })`: call `client.update_issue`, upsert the returned issue via
  `db::issues`, clear `pending_sync`. Emit `issue-updated`.

The processor currently has no emitter. Either pass `&dyn EventEmitter` into
`process_action` (preferred: the engine already owns one) or return the touched issue key in
`ProcessResult` and let the engine emit. Event payload: `{ instanceId, projectId, issueIid }`
on a new constant `ISSUE_UPDATED_EVENT = "issue-updated"` next to the existing event
constants in `sync_engine.rs`.

### 2.2 Terminal-failure classification
`check_stale_mr_error` (`sync_processor.rs:83`) recognises MR-specific
conditions. Add `check_terminal_issue_error` for issue actions: HTTP 404, 403, 410 discard;
409 discards only for `IssueState` when GitLab reports the state is already applied. Wire it
into the `Err(e)` branch of `process_action` based on `action.target()`.

On discard, roll back the optimistic write:
- `IssueNote` → `delete_local_note`.
- field actions → attempt `client.get_issue` and upsert the server row; if that 404s,
  delete the local `issues` row. Either way clear `pending_sync`.
Emit `issue-updated` and a `sync_events` entry of kind `action_discarded` with the reason,
so the frontend can toast (the MR path already has a discard notification; reuse it).

### 2.3 Instance resolution in `sync_engine.rs:2609-2680`
In `process_actions_resolving_instances`, branch on `action.target()`: for `Issue` use
`action.instance_id` directly; for `Mr` keep the existing `merge_requests` lookup. The
per-instance client cache stays as is.

### 2.4 Flush on enqueue
`SyncHandle::flush_actions(Vec<ActionType>)` (`sync_engine.rs:219`) already exists. Add
`flush_issue_actions()` that sends the four issue types, called fire-and-forget from each
issue command after enqueue, mirroring `flush_approvals` in `approval.rs`. Online users keep
the immediate behaviour they have today; offline users get a retry on the next sync tick.

**Verify:** `cargo test`. Add processor unit tests for payload parsing of each new struct,
and an integration test `tests/issue_offline_workflow.rs` modelled on
`tests/offline_workflow.rs` that seeds an instance, an issue, enqueues each action type
through the real `enqueue_action`, and asserts the rows and `pending_sync` flags. Manual
check with real credentials (see Phase 5).

---

## Phase 3: Commands (optimistic local writes)

All in `src-tauri/src/commands/issues.rs`; no signature changes.

### 3.1 `add_issue_note`
1. Compute a negative local id with the existing `generate_local_id()` helper used by
   `add_comment` in `commands/comments.rs` (move it somewhere shared if it is private).
2. Insert an `issue_notes` row with that id, `pending_sync = 1`, author from
   `gitlab_instances.authenticated_username` (fall back to `"me"` if null; do **not** call
   `validate_token`, that is a network call).
3. Enqueue `IssueNote` with `local_reference_id = Some(local_id)`.
4. Flush, return the placeholder as `IssueNoteDto { pending_sync: true, .. }`.

### 3.2 `set_issue_assignees`, `set_issue_state`, `set_issue_description`
1. Read the cached `issues` row; error `not_found` if absent (the detail page always has
   one before actions are enabled).
2. Patch the field locally (`assignee_usernames` needs id→username mapping from
   `known_users`; fall back to keeping the old value and only flagging pending if a
   mapping is missing), set `pending_sync = 1`, `updated_at = now`.
3. `supersede_pending_issue_actions` for the same type, then enqueue.
4. Flush, return the joined row with `pending_sync: true`.

### 3.3 Read side
- `list_cached_issue_notes` adds `pending_sync` and `sync_status` (via
  `get_issue_action_status` for negative ids, `synced` otherwise) to `IssueNoteDto`.
- `get_cached_issue_detail` and `list_cached_issues` expose `pending_sync` on the issue DTO.
- `refresh_issue_detail` must not prune negative-id notes (`prune_missing_notes` currently
  deletes anything not returned by GitLab) and must not overwrite a `pending_sync = 1`
  issue row's patched fields. Simplest: skip the upsert of `state`, `assignee_usernames`,
  `description` when the local row is pending; the processor reconciles them.

### 3.4 Delete a pending note
Add `delete_issue_note(instance_id, project_id, issue_iid, note_id)` for negative ids only:
delete the row and its pending queue entry, mirroring `commands/comments.rs:624-640`. This
gives users an undo while offline. Register in `commands/mod.rs` and `lib.rs`.

### 3.5 Remove the client from the write path
`create_client_with_username` (`issues.rs:628`) is no longer used by the four mutations.
It stays for `list_issue_assignee_candidates`, `refresh_issue_detail` and the sync commands.
(The backend survey flagged this helper as one of five duplicates of `core::create_client`;
folding it into `core` is a separate cleanup.)

**Verify:** `cargo check`, `cargo test`, and the integration test from 2.4 extended to call
the Tauri command bodies via their inner functions.

---

## Phase 4: Frontend

### 4.1 Types (`src/types/index.ts`)
`IssueNote` gains `pendingSync: boolean` and `syncStatus: SyncStatus | null`.
`IssueWithProject` gains `pendingSync: boolean`.

### 4.2 Mutations (`src/pages/IssueDetailPage/useIssueData.ts:130-235`)
- Drop the `await refreshIssueDetail(...)` in every `onSuccess`; the command already wrote
  the optimistic row, so just invalidate `queryKeys.issue`, `queryKeys.issueNotes` and the
  `['issues', instanceId]` list.
- Add `onError` that surfaces the error through the existing toast pattern instead of
  leaving it to the caller. With the queue in place the only expected errors are local
  (no cached row, DB failure).
- Subscribe once (in `useIssueBackgroundRefresh` or a new `useIssueSyncEvents`) to the
  `issue-updated` Tauri event and invalidate the same keys when the payload matches this
  issue. Follow the `tauriListen('auth-expired', ...)` pattern in `App.tsx:97-113`.

### 4.3 View (`src/pages/IssueDetailPage/IssueDetailView.tsx`)
- Render `<SyncBadge status={note.syncStatus} />` on each note, same placement as MR
  comments in `ActivityFeed.tsx`.
- When `issue.pendingSync` is true, render a `pending` badge next to the state pill in the
  header.
- Notes with a negative id get a delete affordance wired to `deleteIssueNote`.
- The close/reopen and assignee controls stay enabled offline; remove any `isPending`
  disabling that assumed a network round trip.

### 4.4 Service layer (`src/services/tauri.ts`)
Add `deleteIssueNote`. Existing wrappers keep their names.

### 4.5 E2E mocks
`e2e/fixtures/tauri-mock.ts`: make the mocked `add_issue_note` return `pendingSync: true`
and `syncStatus: 'pending'`, add `delete_issue_note`. Add
`e2e/issue-offline-actions.spec.ts`: post a note, assert the badge; mock the queue as
`failed`, assert the failed badge; delete the pending note, assert it disappears.

**Verify:** `bunx tsc --noEmit`, `bun run lint`, `bun run test:e2e -- issue-offline-actions`
plus the existing `issue-*.spec.ts` files.

---

## Phase 5: Tests, docs, cleanup

1. **Real-credential check** (CLAUDE.md requires this for anything touching MR/issue data):
   with credentials from `credentials.md`, open an issue, disable the network, post a note
   and close the issue, confirm both show pending badges, re-enable the network, trigger a
   sync, confirm both land on GitLab and the badges clear. Then delete the issue on GitLab
   with a pending action queued and confirm the action is discarded and the local row rolled
   back.
2. **Regression smoke on MR offline flow** (comment, reply, resolve, approve) since the
   queue schema changed.
3. Tick the completed boxes in `tasks/prd-issue-offline-support.md` for US-005, US-006,
   US-007, US-010, US-011 and note the deviation on command naming (decision 3).
4. Delete `src/components/CommentPanel/` if not done in Phase 0 (unused; confirmed by the
   frontend survey).

---

## Sequencing and size

| Phase | Scope | Rough size |
|---|---|---|
| 0 | Extractions, no behaviour change | half a day |
| 1 | Migration, model, queue | half a day |
| 2 | Processor, engine, events | one day |
| 3 | Commands | half a day |
| 4 | Frontend | half a day |
| 5 | Verification and docs | half a day |

Phases 0 and 1 can ship as their own PR (pure refactor plus additive schema). Phases 2 to 4
should land together because the commands stop calling the API and depend on the processor
to complete the write.

---

## Risks and mitigations

- **Migration on live databases.** The table rebuild copies every `sync_queue` row. Test on
  a DB with pending, failed and discarded rows. Copy migration 0002's approach exactly.
- **Downgrade.** `ActionType::from` falls back to `Comment` for unknown strings
  (`models/sync_action.rs:27`). An older build opening a DB with queued issue rows would try
  to process them as MR comments and fail on the missing `mr_id`. Change the fallback to a
  new `Unknown` variant that the processor discards with a clear log line, so a downgrade
  is noisy rather than wrong.
- **Author display for placeholder notes.** `authenticated_username` may be null for
  instances added before migration 0008. The placeholder shows `"me"` until the processor
  replaces it; acceptable, and the same limitation exists for MR comments.
- **`refresh_issue_detail` racing a pending write.** Handled in 3.3 by skipping pending
  fields and negative-id notes during refresh. Add a unit test for that guard.
- **No `cargo` verification in the remote sandbox.** `cargo check` fails there on
  `gdk-sys` (missing system `gdk-3.0`), so all Rust verification must run on a developer
  machine or in CI. The DX survey noted CI does not run `cargo test` at all; adding
  `cargo test` and `cargo clippy` to `.github/workflows/playwright.yml` before starting this
  work is a cheap safety net and is recommended as a prerequisite PR.

---

## Files touched (summary)

**Rust**
- `src-tauri/src/db/migrations/0027_sync_queue_issue_targets.sql` (new)
- `src-tauri/src/db/issues.rs` (new), `db/issue_notes.rs`, `db/mod.rs`
- `src-tauri/src/models/sync_action.rs`
- `src-tauri/src/services/sync_queue.rs`, `sync_processor.rs`, `sync_engine.rs`
- `src-tauri/src/commands/issues.rs`, `commands/approval.rs`, `commands/comments.rs`,
  `commands/mod.rs`, `src-tauri/src/lib.rs`
- `src-tauri/tests/issue_offline_workflow.rs` (new), `tests/offline_workflow.rs`

**Frontend**
- `src/components/SyncBadge/SyncBadge.tsx` (new), `src/components/ActivityDrawer/ActivityFeed.tsx`
- `src/pages/IssueDetailPage/useIssueData.ts`, `IssueDetailView.tsx`
- `src/services/tauri.ts`, `src/types/index.ts`
- `e2e/fixtures/tauri-mock.ts`, `e2e/issue-offline-actions.spec.ts` (new)

**Docs**
- `tasks/prd-issue-offline-support.md`
