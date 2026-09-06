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

5. **Optimistic rows carry `pending_sync`, and the processor reconciles them itself.**
   Notes get a negative local id (same scheme as MR comments in `commands/comments.rs`),
   issues get a flag. The processor replaces the placeholder with the real row from the API
   response the moment the push succeeds. It must **not** rely on a later cache refresh to
   remove the placeholder; that is the design flaw behind the duplicate-comment bug in the
   MR path described in "Prerequisite: duplicate MR comments" below. Terminal failures roll
   the row back to server truth.

6. **Reuse the existing UI marker.** `SyncBadge` already renders pending/failed/discarded
   for MR comments but is duplicated in `ActivityFeed.tsx:27` and
   `CommentPanel/InlineComment.tsx:49`. Extract it once and reuse it for issue notes.

7. **Never increase request volume against the GitLab instance.** This is a hard
   requirement. The queue must make the write path *cheaper* than today, and failure
   handling must back off rather than retry in a loop. See "Request budget" below; every
   phase that touches the network has an explicit budget check.

---

## Request budget

### What the app does today

| Situation | Calls per user action | Where |
|---|---|---|
| Post a note online | 3 GETs/POSTs: `add_issue_note`, then the frontend calls `refresh_issue_detail` which does `get_issue` + `list_issue_notes` | `commands/issues.rs:511-521`, `useIssueData.ts:137-151`, `issues.rs:464-478` |
| Change state / assignees / description online | 3: `update_issue`, then the same two-call refresh | `issues.rs:525-583`, `useIssueData.ts:160-235` |
| Any action offline | 1 failed attempt, then a raw error; nothing retried | |

Existing protections that stay in place and are relied on:
- `send_with_retry` retries 429 at most 3 times with exponential backoff and honours
  `Retry-After` capped at 60s (`services/gitlab_client.rs:524, 563-598`).
- Queue actions are processed sequentially, one request at a time
  (`sync_engine.rs:2626-2716`), never in parallel.
- The sync tick is 5 minutes (`DEFAULT_SYNC_INTERVAL_SECS`, `sync_engine.rs:39`); issue
  list refresh is 30 minutes.
- Each action is attempted at most `MAX_RETRIES = 5` times before it is parked as
  `failed` and only a manual retry from Settings revives it (`sync_queue.rs:253-285`,
  `commands/sync.rs:143`).

### What the plan changes

| Situation | Calls per user action after this plan |
|---|---|
| Post a note online | 1 (`add_issue_note` via the processor; the returned note replaces the placeholder, no refresh) |
| Change a field online | 1 (`update_issue`; the returned issue row is upserted, no refresh) |
| Rapid repeated changes to the same field | 1 for the last one; earlier pending ones are discarded as `superseded` before they are sent |
| Any action offline | 0 requests reach GitLab (connection fails locally); retried on the next tick with backoff |
| Terminal failure needing rollback | at most 1 extra `get_issue`, and 0 when the failure was a 404 (the row is deleted locally instead) |

Net effect: the online write path drops from 3 calls to 1 per action.

### Gaps in the current queue that this plan must close, or the queue would add load

1. **No per-action backoff.** `mark_failed` leaves an action `pending` until the fifth
   failure (`sync_queue.rs:271-277`), and every pending action is re-sent on every tick
   *and every flush*. Combined with flush-on-enqueue, each new user action would
   immediately re-fire every currently-failing action. Fix in Phase 1.4.
2. **No circuit breaker inside a batch.** `process_actions_resolving_instances` keeps
   sending the remaining actions after a 429, 5xx or connection error, one request each
   (`sync_engine.rs:2689-2716`). Fix in Phase 2.5.
3. **Flushes are not coalesced.** Each enqueue sends its own `FlushActions` command and
   each is handled immediately (`sync_engine.rs:460-465`). Fix in Phase 2.4.

### Things this plan deliberately does not do

- No HTTP-layer retry on 5xx or connection errors for queue actions. They are POST/PUT
  and not idempotent; the queue's tick-plus-backoff is the retry. (The backend survey
  suggested widening `send_with_retry` to 5xx; if that is ever done it must be limited to
  idempotent GETs, with jitter and a small cap, or it multiplies load during an outage.)
- No polling for connectivity. Offline detection is "the request failed to connect",
  which costs GitLab nothing.
- No background refresh after a mutation. The `issue-updated` event only invalidates the
  local TanStack Query cache, which re-reads SQLite.

---

## Prerequisite: duplicate MR comments after sync

Users see a comment twice after it reaches GitLab: the local placeholder with a pending
badge, and the real one fetched from GitLab. The cause is an ordering bug between two pieces
of shared queue code, and the issue-note design in this plan must not inherit it.

### Mechanism

1. `add_comment` inserts a local row with a negative id and `is_local = 1`, and enqueues a
   `comment` action with `local_reference_id` pointing at it
   (`commands/comments.rs:305-352`). `reply_to_comment` does the same (`:405-471`).
2. `process_comment` and `process_reply` post to GitLab and return `Ok(())`. The API
   response is thrown away and the local row is left untouched
   (`services/sync_processor.rs:288-345`). That response already carries the real id:
   `add_comment` and `reply_to_discussion` return a `GitLabNote`, `add_inline_comment`
   returns a `GitLabDiscussion` whose first note is the new comment
   (`services/gitlab_client.rs:1297-1386`).
3. The only code that removes the local row is the cleanup at the end of
   `upsert_discussions`, which runs during the next comment fetch for that MR and requires
   a `sync_queue` row with status `synced` or `discarded` whose `local_reference_id` matches
   (`services/sync_engine.rs:2291-2304`).
4. `run_sync` deletes every `synced` queue row at the end of each run via `cleanup_synced`
   (`sync_engine.rs:615`, `sync_queue.rs:404-409`).

When the comment is pushed by the immediate flush, the queue row survives until the next
tick, the fetch finds it, and the placeholder is removed. When the push happens *inside* a
sync run, the phases are: fetch comments (placeholder still pending, kept), push actions
(row becomes `synced`), cleanup (row deleted). On the following run GitLab returns the real
note, but the evidence is gone, so the placeholder lives forever. That "inside a run" case is
precisely the offline case: the comment was written while offline, or the flush failed once,
so the action was still pending at tick time.

Two things make it worse: `get_comment_sync_status` returns `"pending"` when no queue row
exists (`commands/comments.rs:138-151`), so an orphan shows a pending badge; and the
placeholder has no `discussion_id`, so it also renders as a separate thread.

### Fix (ship before or as the first commit of this plan)

1. **Reconcile in the processor.** `process_comment` and `process_reply` take `pool` and,
   on success, replace the placeholder in one transaction: delete the row with id
   `action.local_reference_id`, then insert the returned `GitLabNote` as a normal row
   (`is_local = 0`, real id, `discussion_id` from the response where available). Emit
   `mr-updated` with `CommentsUpdated` so the drawer refreshes. This is zero extra requests;
   the data is already in the response.
2. **Heal orphans in `upsert_discussions`.** Replace the evidence-based delete with:
   delete local rows for this MR whose id is not referenced by any queue row with status
   `pending`, `syncing` or `failed`. A placeholder without a live queue row can only be
   synced, discarded, or lost; in all three cases the GitLab fetch is the truth. This also
   cleans up every existing orphan on the next sync, with no migration.
3. **Make the missing-row case visible.** `get_comment_sync_status` should return
   `"discarded"` (or a new `"orphaned"`) instead of `"pending"` when no queue row exists,
   so any future regression shows up as a red badge rather than a permanent pending one.
4. **Regression test** in `tests/rollback_on_failure.rs` or a new `tests/comment_reconcile.rs`:
   insert a placeholder plus a `pending` queue row, mark it synced, run `cleanup_synced`,
   then call `upsert_discussions` with the GitLab note. Assert exactly one row remains and it
   has the real id. A second test drives `process_comment` against an HTTP stub and asserts
   the placeholder is replaced before any fetch runs.

Budget check: the fix removes work rather than adding it. No new requests; one fewer
inconsistent row to render.

---

## Phase 0: Preparation (no behaviour change)

### 0.1 Make issue persistence reachable from `services/`
The row upsert already lives in `models/issue.rs:139` (`upsert_issue`) and is usable from
the processor. What is stuck in `commands/issues.rs:384` is `upsert_and_join`, which maps a
GitLab issue to `UpsertIssue`, ensures the project is cached, and joins the project for the
DTO. The processor lives in `services/` and must not depend on `commands/`. Move the
GitLab-issue-to-`UpsertIssue` mapping and the join into `models/issue.rs` (or a new
`core/issues.rs`, matching `core/mr_actions.rs`), and add `set_pending_sync(pool,
instance_id, id, bool)` next to `upsert_issue`. `commands/issues.rs` becomes a thin caller.

Budget note: `ensure_projects_cached` (`issues.rs:94`) may call GitLab for an unknown
project. The processor must not call it; the project is always cached by the time an
issue action can be enqueued, so pass the cached project or skip the join when absent.

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
- `next_attempt_at INTEGER` (nullable) on the rebuilt `sync_queue`, used for backoff (1.4)
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
  `sync_queue::get_actions_for_mr`, `commands/comments.rs`, the `ActionSyncedPayload`
  emitted at `sync_engine.rs:2692-2702` (its `mr_id` becomes `Option<i64>`, and the
  matching frontend type), the `SyncAction` literals in the `#[cfg(test)]` blocks, and
  `tests/*.rs`.
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

### 1.4 Per-action backoff (applies to MR actions too)
- `mark_failed` sets `next_attempt_at = now + backoff(retry_count)` where
  `backoff(n) = min(30s * 2^n, 15 min)` plus up to 20% random jitter. With
  `MAX_RETRIES = 5` an action is attempted at roughly 0s, 30s, 1m, 2m, 4m, then parked.
- `get_pending_actions`, `get_pending_actions_by_type` and `get_retryable_actions` add
  `AND (next_attempt_at IS NULL OR next_attempt_at <= ?)`. The tick and any flush
  therefore skip actions that are cooling down instead of re-sending them.
- `retry_action` (manual retry from Settings) clears `next_attempt_at`.
- `mark_synced` and `mark_discarded` leave the column alone; `cleanup_synced` is unaffected.
- Expose `next_attempt_at` on `SyncAction` so the Settings queue view can show "retrying in 2m".

**Verify:** `cargo test` (unit tests in `sync_action.rs` and `sync_queue.rs` extended for
the new variants, the CHECK constraint, and the backoff formula); an integration test that
runs all migrations on a fresh temp DB and on a DB seeded with pre-0027 `sync_queue` rows,
asserting the rows survive with `issue_id IS NULL` and `next_attempt_at IS NULL`; a test
that an action marked failed once is not returned by `get_pending_actions` until its
`next_attempt_at` has passed.

---

## Phase 2: Processor and engine

### 2.1 Dispatch in `services/sync_processor.rs:168-175`
Add arms:
- `IssueNote` → `process_issue_note(client, pool, action)`: parse payload, call
  `client.add_issue_note`, then `db::issue_notes::replace_local_note` using
  `action.local_reference_id` and the returned note, in one transaction. Emit
  `issue-updated`. This is the same reconcile-in-the-processor shape as the MR prerequisite
  fix; do not depend on `refresh_issue_detail` or `prune_missing_notes` to remove the
  placeholder.
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
- `IssueNote` → `delete_local_note`. No request.
- field actions after a 404 or 410 → delete the local `issues` row. No request.
- field actions after a 403 or a no-op 409 → one `client.get_issue` to restore server truth
  and upsert it. This is the only extra request in the whole design and it happens at most
  once per discarded action.
Either way clear `pending_sync`.
Emit `issue-updated` and a `sync_events` entry of kind `action_discarded` with the reason,
so the frontend can toast (the MR path already has a discard notification; reuse it).

### 2.3 Instance resolution in `sync_engine.rs:2609-2680`
In `process_actions_resolving_instances`, branch on `action.target()`: for `Issue` use
`action.instance_id` directly; for `Mr` keep the existing `merge_requests` lookup. The
per-instance client cache stays as is.

### 2.4 Coalesced flush on enqueue
`SyncHandle::flush_actions(Vec<ActionType>)` (`sync_engine.rs:219`) already exists and is
handled immediately at `sync_engine.rs:460-465`. Change the handling so flushes coalesce:
- On `FlushActions`, merge the requested types into a pending set and arm (or re-arm) a
  short debounce timer, about 1.5s, inside the engine's `select!` loop. When it fires,
  run `flush_actions_by_types` once for the merged set. Ten quick enqueues become one drain,
  and because `supersede_pending_issue_actions` ran on each enqueue, the drain sends only the
  last state, assignees or description change.
- If a drain is already running, a new flush request sets a "drain again" flag rather than
  starting a second drain, so two batches never run concurrently.
- Add `flush_issue_actions()` on `SyncHandle` for the four issue types, called
  fire-and-forget from each issue command after enqueue, mirroring `flush_approvals`.

### 2.5 Batch circuit breaker and push cooldown
In `process_actions_resolving_instances` (`sync_engine.rs:2626-2716`), after each
`process_action`, inspect the failure:
- `AppError::Network` (connect, DNS, timeout) or `GitLabApi` with status 429, 502, 503 or
  504: stop the batch. Remaining actions stay `pending` for the next tick. Record
  `push_cooldown_until` on the engine: `Retry-After` when present (the client already parses
  it for its own retry; surface it on the error), otherwise 60s for 429 and 30s for 5xx.
- Any other error (4xx, discard, parse failure): mark that action per existing rules and
  continue, since the next action is independent.
While `push_cooldown_until` is in the future, `FlushActions` is a no-op and the tick skips
the push phase. The next tick after the cooldown resumes normally.

The breaker is per batch and per instance: a 429 from one GitLab instance must not block
pushes to another. Key the cooldown by `instance_id`.

**Verify:** `cargo test`. Add processor unit tests for payload parsing of each new struct,
and an integration test `tests/issue_offline_workflow.rs` modelled on
`tests/offline_workflow.rs` that seeds an instance, an issue, enqueues each action type
through the real `enqueue_action`, and asserts the rows and `pending_sync` flags. For the
breaker, extract the "should this error stop the batch and for how long" decision into a
pure function and unit test it; then one integration test with a local HTTP stub (see what
`tests/rollback_on_failure.rs` uses; if there is no stub, add `wiremock` as a dev
dependency) that queues three actions, returns 429 with `Retry-After: 5` on the first, and
asserts `api_call_count` is exactly 1 and the other two are still `pending`. Manual check
with real credentials (see Phase 5).

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
- `refresh_issue_detail` must not prune negative-id notes that still have a live queue row
  (`prune_missing_notes` currently deletes anything not returned by GitLab), and must not
  overwrite a `pending_sync = 1` issue row's patched fields. Simplest: skip the upsert of
  `state`, `assignee_usernames`, `description` when the local row is pending; the processor
  reconciles them. Negative-id notes with no `pending`, `syncing` or `failed` queue row are
  orphans and *should* be pruned, mirroring prerequisite fix 2.

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
  `['issues', instanceId]` list. This alone removes two GitLab calls per action. Make sure
  no other code path re-adds a network refresh after a mutation; `useIssueBackgroundRefresh`
  must stay mount-scoped and not fire on cache invalidation (guard already noted in the PRD).
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
2b. **Request-count check.** `SyncResult.api_calls` is already recorded per sync run
   (`sync_engine.rs:163, 718`) and shown in diagnostics. Before and after the change, on the
   same instance: post one note and change state once, then read the counter. Expect 3 calls
   per action before and 1 after. Then, with the network up but the token revoked (forces
   4xx), queue five actions in ten seconds and confirm the counter shows one request per
   distinct action and none for the superseded ones. Finally, point the app at a stub that
   returns 429 and confirm exactly one request per cooldown window.
3. Tick the completed boxes in `tasks/prd-issue-offline-support.md` for US-005, US-006,
   US-007, US-010, US-011 and note the deviation on command naming (decision 3).
4. Delete `src/components/CommentPanel/` if not done in Phase 0 (unused; confirmed by the
   frontend survey).

---

## Sequencing and size

| Phase | Scope | Rough size |
|---|---|---|
| 0 | Extractions, no behaviour change | half a day |
| 1 | Migration, model, queue, backoff | half a day to one day |
| 2 | Processor, engine, events, coalesced flush, circuit breaker | one to one and a half days |
| 3 | Commands | half a day |
| 4 | Frontend | half a day |
| 5 | Verification and docs | half a day |

Phases 0 and 1 can ship as their own PR (pure refactor plus additive schema). Phases 2 to 4
should land together because the commands stop calling the API and depend on the processor
to complete the write.

---

## Risks and mitigations

- **Backoff and breaker change MR behaviour too.** Both live in shared queue code, so a
  failing MR comment now also waits 30s before its second attempt instead of firing on the
  next flush. This is intended, and it is strictly less traffic than today. Call it out in
  the PR description so the change is reviewed on purpose rather than discovered.
- **Debounce delays the online happy path by about 1.5s.** The user already sees the
  optimistic row, so the delay is invisible; only the pending badge lingers slightly longer.
  Keep the debounce constant in one place so it can be tuned.
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
- `src-tauri/src/models/issue.rs` (or new `core/issues.rs`), `db/issue_notes.rs`
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
