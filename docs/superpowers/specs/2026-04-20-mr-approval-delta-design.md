# MR Approval Delta — Design

**Date:** 2026-04-20
**Status:** Approved for implementation

## Problem

When a reviewer approves a merge request in Ultra GitLab, new commits can be pushed to the source branch afterward, bringing the MR back for another review. Today the file list gives no indication of what changed since the prior approval — the reviewer has to re-scan every file to find the new diffs.

## Goal

After a reviewer approves an MR in-app, if the MR's head moves forward, surface the files that changed since the approval and let the reviewer focus on just that subset.

## Non-Goals

- Handling approvals made outside Ultra (e.g., on gitlab.com web UI).
- Tracking diff-level granularity within a file ("only the new hunks since approval").
- Remembering multiple historical approvals — only the latest checkpoint matters.
- Handling un-approvals triggered by GitLab when commits land on approved MRs.
- Detecting files *removed* since approval (row-deletion in `file_versions` is lossy). Known limitation.

## User-Facing Behavior

1. Reviewer clicks **Approve** inside Ultra GitLab at MR head SHA `abc123`. A checkpoint timestamp is recorded for that MR.
2. New commits land; next sync updates `file_versions` rows for the changed files.
3. Reviewer reopens the MR. A banner appears at the top:
   > *N files changed since you approved. [Review changes]*
4. Clicking **Review changes** toggles a filter on the file list to show only the changed-since-approval subset.
5. Each file in the changed set shows a small "new" badge in `FileNavigation`, regardless of whether the filter is active.
6. Reviewer can dismiss the banner for the session.
7. On re-approval, the checkpoint is overwritten with the new timestamp; the changed-set is recomputed (and will be empty until the next push).

## Architecture

### Data Model

Single new migration `0022_mr_approval_tracking.sql`:

```sql
ALTER TABLE file_versions ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

CREATE TABLE mr_approval_checkpoints (
  mr_id INTEGER PRIMARY KEY,
  approved_at INTEGER NOT NULL
);
```

`updated_at` is bumped whenever a `file_versions` row is inserted or replaced. `mr_approval_checkpoints` stores the wall-clock timestamp of the latest in-app approval for each MR.

### Change Detection

Determining the changed-since-approval set is a pure SQLite query:

```sql
SELECT file_path FROM file_versions
WHERE mr_id = ?
  AND version_type = 'head'
  AND updated_at > ?
```

with the second argument being `approved_at` for the MR. No GitLab API call, fully offline-capable.

Consistency property: if a push has occurred but sync hasn't run yet, the user sees stale data in the diff viewer *and* an empty changed-set — the two stay in sync.

### Backend Commands (Rust / Tauri)

Added in `src-tauri/src/commands/mr_approval.rs`:

- `set_approval_checkpoint(mr_id: i64) -> Result<(), AppError>` — UPSERT the checkpoint row with `approved_at = strftime('%s', 'now')`.
- `get_approval_checkpoint(mr_id: i64) -> Result<Option<i64>, AppError>` — returns the `approved_at` timestamp if present.
- `get_files_changed_since(mr_id: i64, since_ts: i64) -> Result<Vec<String>, AppError>` — runs the query above.

Registered via `commands/mod.rs` re-export and `generate_handler!` in `lib.rs`.

DB queries live in `src-tauri/src/db/mr_approval.rs`, registered as `pub mod` in `db/mod.rs`.

### file_cache.rs Update

The existing `INSERT OR REPLACE INTO file_versions` statement in `src-tauri/src/db/file_cache.rs` is updated to include `updated_at = strftime('%s', 'now')` on every insert/replace. No trigger is used — explicit write keeps behavior obvious.

### Frontend Service Layer

- `src/services/tauri.ts` adds low-level wrappers for the three new `invoke` calls.
- `src/services/gitlab.ts` exports:
  - `setApprovalCheckpoint(mrId: number): Promise<void>`
  - `getApprovalCheckpoint(mrId: number): Promise<number | null>`
  - `getFilesChangedSince(mrId: number, sinceTs: number): Promise<string[]>`
- `src/services/index.ts` re-exports the three new functions.

### View State

`src/pages/MRDetailPage/viewReducer.ts` adds to `ViewState`:

```ts
changedSinceApprovalPaths: Set<string>;
filterToChangedOnly: boolean;
bannerDismissed: boolean;
```

New reducer actions:

- `SET_CHANGED_SET` — populated after checkpoint query resolves.
- `TOGGLE_CHANGED_FILTER` — flips `filterToChangedOnly`.
- `DISMISS_BANNER` — sets `bannerDismissed = true`.
- `RESET_CHANGED_SET` — called after a successful re-approval so the UI clears instantly.

### Load Flow

`MRDetailPage/index.tsx` on mount (or MR ID change):

1. Fetch checkpoint via `getApprovalCheckpoint(mrId)`.
2. If present, call `getFilesChangedSince(mrId, approvedAt)`.
3. Dispatch `SET_CHANGED_SET` with the result (empty set if no checkpoint).

### Approve Flow

After the existing approval IPC call succeeds:

1. Call `setApprovalCheckpoint(mr.id)`.
2. Dispatch `RESET_CHANGED_SET`.

### UI Components

- **Banner** — a new component rendered at the top of the MR detail view when `changedSinceApprovalPaths.size > 0 && !bannerDismissed`. Props: count, `onReviewChanges`, `onDismiss`. Uses existing banner styling patterns from the codebase.
- **Filter toggle** — added to the file panel header; binds to `filterToChangedOnly`. Reuses existing toggle UI patterns.
- **Per-file badge** — `FileNavigation` reads the changed set and renders a small "new" pill next to each matching path. Independent of filter state.

All three components key off the same `changedSinceApprovalPaths` set from view state.

## Testing

- **Rust unit tests:** checkpoint UPSERT replaces prior row; `get_files_changed_since` returns only head-version rows with `updated_at > since_ts`.
- **Frontend unit tests:** reducer transitions for all four new actions.
- **Manual E2E with real credentials** (per project testing convention): approve an MR → push a commit → sync → reopen → verify banner count, filter behavior, and badges; re-approve → verify banner disappears and badges clear.

## File-Change Summary

**New files:**

- `src-tauri/src/db/migrations/0022_mr_approval_tracking.sql`
- `src-tauri/src/db/mr_approval.rs`
- `src-tauri/src/commands/mr_approval.rs`
- `src/pages/MRDetailPage/ApprovalDeltaBanner.tsx` (+ css as needed)

**Modified:**

- `src-tauri/src/db/mod.rs` — register `mr_approval` module.
- `src-tauri/src/db/file_cache.rs` — set `updated_at` on insert/replace.
- `src-tauri/src/db/migrations/mod.rs` (or `MIGRATIONS` array in `db/mod.rs`) — add migration.
- `src-tauri/src/commands/mod.rs` — re-export new commands.
- `src-tauri/src/lib.rs` — add imports + `generate_handler!` entries.
- `src/services/tauri.ts` — IPC wrappers.
- `src/services/gitlab.ts` — high-level helpers.
- `src/services/index.ts` — re-exports.
- `src/pages/MRDetailPage/viewReducer.ts` — new state + actions.
- `src/pages/MRDetailPage/index.tsx` — load + approve flow integration.
- `src/pages/MRDetailPage/MRFilePanel.tsx` — filter toggle, honor `filterToChangedOnly`.
- `src/components/FileNavigation/FileNavigation.tsx` — per-file badges.

## Open Questions

None.
