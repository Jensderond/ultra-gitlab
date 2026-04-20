# MR Approval Delta Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a reviewer approves an MR in-app, remember the approval timestamp; when new commits arrive, surface which files changed since approval via a banner, filter toggle, and per-file badges.

**Architecture:** A new SQLite table `mr_approval_checkpoints` stores the approval timestamp per MR. The existing `file_versions` table gains an `updated_at` column, bumped on every INSERT OR REPLACE. Files changed since the checkpoint are derived by `SELECT file_path FROM file_versions WHERE mr_id = ? AND version_type = 'head' AND updated_at > ?`. Three new Tauri commands expose: set checkpoint, get checkpoint, list changed-since files. The MR detail page loads the checkpoint on mount, populates a reducer field, and renders a dismissible banner + a filter toggle + per-file badges keyed off the same `Set<string>`.

**Tech Stack:** Rust (Tauri 2, sqlx), TypeScript/React 19, Vite, Vitest for frontend unit tests.

**Design spec:** `docs/superpowers/specs/2026-04-20-mr-approval-delta-design.md`

---

## Task 1: Migration — `updated_at` on `file_versions` + `mr_approval_checkpoints` table

**Files:**
- Create: `src-tauri/src/db/migrations/0022_mr_approval_tracking.sql`
- Modify: `src-tauri/src/db/mod.rs` (add to `MIGRATIONS` array)

- [ ] **Step 1: Create the migration SQL**

Create `src-tauri/src/db/migrations/0022_mr_approval_tracking.sql`:

```sql
-- Migration: 0022_mr_approval_tracking.sql
-- Adds updated_at column to file_versions (for detecting changes since approval)
-- and a table to track per-MR approval checkpoints.

ALTER TABLE file_versions ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_file_versions_updated_at
  ON file_versions(mr_id, version_type, updated_at);

CREATE TABLE IF NOT EXISTS mr_approval_checkpoints (
    mr_id INTEGER PRIMARY KEY,
    approved_at INTEGER NOT NULL
);
```

- [ ] **Step 2: Register the migration**

In `src-tauri/src/db/mod.rs`, append a new entry to the `MIGRATIONS` array (after the `0021_create_issue_notes` entry, before the closing `];`):

```rust
    (
        "0022_mr_approval_tracking",
        include_str!("migrations/0022_mr_approval_tracking.sql"),
    ),
```

- [ ] **Step 3: Run Rust build to verify migration compiles**

Run: `cd src-tauri && cargo check`
Expected: successful compilation, no errors.

- [ ] **Step 4: Run existing migration test to verify schema still works**

Run: `cd src-tauri && cargo test db::tests::test_initialize_creates_database -- --nocapture`
Expected: test passes. The migration runs without error; existing tables remain.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/migrations/0022_mr_approval_tracking.sql src-tauri/src/db/mod.rs
git commit -m "feat(db): add migration for MR approval delta tracking"
```

---

## Task 2: Update `file_cache.rs` to write `updated_at` on upsert

**Files:**
- Modify: `src-tauri/src/db/file_cache.rs:22-47`

- [ ] **Step 1: Write a failing test**

Append to `src-tauri/src/db/file_cache.rs` inside a new `#[cfg(test)] mod tests` block (or extend existing if present):

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::pool::create_pool;
    use tempfile::tempdir;

    async fn setup_pool() -> crate::db::pool::DbPool {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let pool = crate::db::initialize(&db_path).await.unwrap();
        std::mem::forget(dir); // keep dir alive for pool lifetime
        pool
    }

    #[tokio::test]
    async fn upsert_file_version_sets_updated_at_to_now() {
        let pool = setup_pool().await;

        upsert_file_blob(&pool, "sha1", "hello", 5).await.unwrap();
        upsert_file_version(&pool, 1, "foo.txt", "head", "sha1", "inst", 42)
            .await
            .unwrap();

        let (ts,): (i64,) = sqlx::query_as(
            "SELECT updated_at FROM file_versions WHERE mr_id = 1 AND file_path = 'foo.txt' AND version_type = 'head'"
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        let now = chrono::Utc::now().timestamp();
        assert!(ts > 0, "updated_at should be set (got {})", ts);
        assert!(ts <= now && ts >= now - 5, "updated_at should be ~now (got {}, now {})", ts, now);
    }

    #[tokio::test]
    async fn upsert_file_version_bumps_updated_at_on_replace() {
        let pool = setup_pool().await;

        upsert_file_blob(&pool, "sha1", "hello", 5).await.unwrap();
        upsert_file_version(&pool, 1, "foo.txt", "head", "sha1", "inst", 42)
            .await
            .unwrap();

        let (ts1,): (i64,) = sqlx::query_as(
            "SELECT updated_at FROM file_versions WHERE mr_id = 1 AND file_path = 'foo.txt' AND version_type = 'head'"
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

        upsert_file_blob(&pool, "sha2", "world", 5).await.unwrap();
        upsert_file_version(&pool, 1, "foo.txt", "head", "sha2", "inst", 42)
            .await
            .unwrap();

        let (ts2,): (i64,) = sqlx::query_as(
            "SELECT updated_at FROM file_versions WHERE mr_id = 1 AND file_path = 'foo.txt' AND version_type = 'head'"
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert!(ts2 > ts1, "updated_at should be bumped on replace (ts1={}, ts2={})", ts1, ts2);
    }
}
```

Note: if `chrono` is not already a dev-dep, use `std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64` instead.

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test file_cache::tests::upsert_file_version_sets_updated_at -- --nocapture`
Expected: FAIL — `updated_at` stays at the DEFAULT 0 because the upsert SQL doesn't set it.

- [ ] **Step 3: Update `upsert_file_version` to set `updated_at`**

Replace the body of `upsert_file_version` in `src-tauri/src/db/file_cache.rs`:

```rust
pub async fn upsert_file_version(
    pool: &DbPool,
    mr_id: i64,
    file_path: &str,
    version_type: &str,
    sha: &str,
    instance_id: &str,
    project_id: i64,
) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT OR REPLACE INTO file_versions
          (mr_id, file_path, version_type, sha, instance_id, project_id, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, strftime('%s', 'now'))
        "#,
    )
    .bind(mr_id)
    .bind(file_path)
    .bind(version_type)
    .bind(sha)
    .bind(instance_id)
    .bind(project_id)
    .execute(pool)
    .await?;

    Ok(())
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test file_cache::tests -- --nocapture`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/file_cache.rs
git commit -m "feat(db): stamp file_versions.updated_at on every upsert"
```

---

## Task 3: DB helpers for approval checkpoints

**Files:**
- Create: `src-tauri/src/db/mr_approval.rs`
- Modify: `src-tauri/src/db/mod.rs` (add `pub mod mr_approval;`)

- [ ] **Step 1: Write the failing test (TDD-first scaffold)**

Create `src-tauri/src/db/mr_approval.rs` with helpers + tests:

```rust
//! CRUD helpers for the `mr_approval_checkpoints` table.
//!
//! A checkpoint records the wall-clock timestamp of the user's most recent
//! in-app approval of an MR. The timestamp is compared against
//! `file_versions.updated_at` to derive the "changed since approval" file set.

use crate::db::pool::DbPool;
use crate::error::AppError;

/// Upsert a checkpoint for `mr_id` with `approved_at = now()`.
pub async fn set_checkpoint(pool: &DbPool, mr_id: i64) -> Result<(), AppError> {
    sqlx::query(
        r#"
        INSERT INTO mr_approval_checkpoints (mr_id, approved_at)
        VALUES (?, strftime('%s', 'now'))
        ON CONFLICT(mr_id) DO UPDATE SET approved_at = excluded.approved_at
        "#,
    )
    .bind(mr_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Returns the `approved_at` timestamp for `mr_id`, if any.
pub async fn get_checkpoint(pool: &DbPool, mr_id: i64) -> Result<Option<i64>, AppError> {
    let row: Option<(i64,)> =
        sqlx::query_as("SELECT approved_at FROM mr_approval_checkpoints WHERE mr_id = ?")
            .bind(mr_id)
            .fetch_optional(pool)
            .await?;
    Ok(row.map(|(ts,)| ts))
}

/// Returns the set of head-version file paths whose `updated_at` is strictly
/// greater than `since_ts` for the given MR.
pub async fn files_changed_since(
    pool: &DbPool,
    mr_id: i64,
    since_ts: i64,
) -> Result<Vec<String>, AppError> {
    let rows: Vec<(String,)> = sqlx::query_as(
        r#"
        SELECT file_path FROM file_versions
        WHERE mr_id = ? AND version_type = 'head' AND updated_at > ?
        ORDER BY file_path
        "#,
    )
    .bind(mr_id)
    .bind(since_ts)
    .fetch_all(pool)
    .await?;
    Ok(rows.into_iter().map(|(p,)| p).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    async fn setup_pool() -> crate::db::pool::DbPool {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let pool = crate::db::initialize(&db_path).await.unwrap();
        std::mem::forget(dir);
        pool
    }

    #[tokio::test]
    async fn set_and_get_checkpoint_roundtrip() {
        let pool = setup_pool().await;
        assert!(get_checkpoint(&pool, 42).await.unwrap().is_none());

        set_checkpoint(&pool, 42).await.unwrap();

        let ts = get_checkpoint(&pool, 42).await.unwrap().expect("checkpoint");
        assert!(ts > 0);
    }

    #[tokio::test]
    async fn set_checkpoint_overwrites_previous_row() {
        let pool = setup_pool().await;
        set_checkpoint(&pool, 7).await.unwrap();
        let ts1 = get_checkpoint(&pool, 7).await.unwrap().unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

        set_checkpoint(&pool, 7).await.unwrap();
        let ts2 = get_checkpoint(&pool, 7).await.unwrap().unwrap();

        assert!(ts2 > ts1, "second call should overwrite with newer timestamp");

        let (count,): (i64,) =
            sqlx::query_as("SELECT COUNT(*) FROM mr_approval_checkpoints WHERE mr_id = 7")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 1, "should be a single row per mr_id");
    }

    #[tokio::test]
    async fn files_changed_since_returns_only_head_rows_newer_than_ts() {
        let pool = setup_pool().await;

        crate::db::file_cache::upsert_file_blob(&pool, "shaA", "a", 1).await.unwrap();
        crate::db::file_cache::upsert_file_version(&pool, 1, "old.txt", "head", "shaA", "i", 0)
            .await
            .unwrap();
        crate::db::file_cache::upsert_file_version(&pool, 1, "old.txt", "base", "shaA", "i", 0)
            .await
            .unwrap();

        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;
        let cutoff = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        tokio::time::sleep(std::time::Duration::from_millis(1100)).await;

        crate::db::file_cache::upsert_file_blob(&pool, "shaB", "b", 1).await.unwrap();
        crate::db::file_cache::upsert_file_version(&pool, 1, "new.txt", "head", "shaB", "i", 0)
            .await
            .unwrap();
        crate::db::file_cache::upsert_file_version(&pool, 1, "new.txt", "base", "shaB", "i", 0)
            .await
            .unwrap();

        let changed = files_changed_since(&pool, 1, cutoff).await.unwrap();
        assert_eq!(changed, vec!["new.txt".to_string()]);
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/src/db/mod.rs`, add to the module declarations near the top (after `pub mod issue_notes;`):

```rust
pub mod mr_approval;
```

- [ ] **Step 3: Run the tests**

Run: `cd src-tauri && cargo test db::mr_approval::tests -- --nocapture`
Expected: all three tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/db/mr_approval.rs src-tauri/src/db/mod.rs
git commit -m "feat(db): add mr_approval checkpoint helpers"
```

---

## Task 4: Tauri commands for approval checkpoints

**Files:**
- Create: `src-tauri/src/commands/mr_approval.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs` (imports + `generate_handler!`)

- [ ] **Step 1: Create the command module**

Create `src-tauri/src/commands/mr_approval.rs`:

```rust
//! Tauri commands for MR approval checkpoint tracking.
//!
//! When the user approves an MR in-app, a checkpoint timestamp is stored.
//! The frontend uses the checkpoint to list files that changed since approval.

use crate::db::mr_approval;
use crate::db::pool::DbPool;
use crate::error::AppError;
use tauri::State;

/// Record an approval checkpoint for `mr_id` at `now()`.
#[tauri::command]
pub async fn set_approval_checkpoint(
    pool: State<'_, DbPool>,
    mr_id: i64,
) -> Result<(), AppError> {
    mr_approval::set_checkpoint(pool.inner(), mr_id).await
}

/// Get the approval checkpoint timestamp for `mr_id`, or `None`.
#[tauri::command]
pub async fn get_approval_checkpoint(
    pool: State<'_, DbPool>,
    mr_id: i64,
) -> Result<Option<i64>, AppError> {
    mr_approval::get_checkpoint(pool.inner(), mr_id).await
}

/// List head-version file paths changed since `since_ts`.
#[tauri::command]
pub async fn get_files_changed_since(
    pool: State<'_, DbPool>,
    mr_id: i64,
    since_ts: i64,
) -> Result<Vec<String>, AppError> {
    mr_approval::files_changed_since(pool.inner(), mr_id, since_ts).await
}
```

- [ ] **Step 2: Register module + re-exports in `commands/mod.rs`**

In `src-tauri/src/commands/mod.rs`:

Add to the module list (alphabetical position, after `mod mr;`):
```rust
pub mod mr_approval;
```

Add to the re-exports:
```rust
pub use mr_approval::{get_approval_checkpoint, get_files_changed_since, set_approval_checkpoint};
```

- [ ] **Step 3: Register in `lib.rs`**

In `src-tauri/src/lib.rs`:

Add to the big `use commands::{ ... };` list (near `approve_mr`):
```rust
    get_approval_checkpoint, get_files_changed_since, set_approval_checkpoint,
```

Add to the `tauri::generate_handler![...]` macro (near the `approve_mr`/`unapprove_mr` entries):
```rust
            set_approval_checkpoint,
            get_approval_checkpoint,
            get_files_changed_since,
```

- [ ] **Step 4: Build to verify wiring**

Run: `cd src-tauri && cargo check`
Expected: successful build.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/mr_approval.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(commands): expose approval checkpoint IPC"
```

---

## Task 5: Frontend IPC wrappers

**Files:**
- Modify: `src/services/tauri.ts`
- Modify: `src/services/gitlab.ts`
- Modify: `src/services/index.ts`

- [ ] **Step 1: Add low-level wrappers in `tauri.ts`**

Append near the existing `approveMR` function in `src/services/tauri.ts`:

```ts
export async function setApprovalCheckpoint(mrId: number): Promise<void> {
  return invoke<void>('set_approval_checkpoint', { mrId });
}

export async function getApprovalCheckpoint(mrId: number): Promise<number | null> {
  return invoke<number | null>('get_approval_checkpoint', { mrId });
}

export async function getFilesChangedSince(mrId: number, sinceTs: number): Promise<string[]> {
  return invoke<string[]>('get_files_changed_since', { mrId, sinceTs });
}
```

Note: if `tauri.ts` uses `transportInvoke` instead of a local `invoke` helper, follow the file's existing pattern (see how `approveMR` is written on line 366).

- [ ] **Step 2: Re-export from `gitlab.ts`**

In `src/services/gitlab.ts`, add to the imports from `./tauri`:
```ts
  setApprovalCheckpoint as tauriSetApprovalCheckpoint,
  getApprovalCheckpoint as tauriGetApprovalCheckpoint,
  getFilesChangedSince as tauriGetFilesChangedSince,
```

Append near the bottom of the file (after existing approval helpers):
```ts
export async function setApprovalCheckpoint(mrId: number): Promise<void> {
  return tauriSetApprovalCheckpoint(mrId);
}

export async function getApprovalCheckpoint(mrId: number): Promise<number | null> {
  return tauriGetApprovalCheckpoint(mrId);
}

export async function getFilesChangedSince(mrId: number, sinceTs: number): Promise<string[]> {
  return tauriGetFilesChangedSince(mrId, sinceTs);
}
```

- [ ] **Step 3: Update `services/index.ts` re-exports**

In `src/services/index.ts`, add to the re-export list alongside `approveMR`:
```ts
  setApprovalCheckpoint,
  getApprovalCheckpoint,
  getFilesChangedSince,
```

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: passes with no errors in the service layer.

- [ ] **Step 5: Commit**

```bash
git add src/services/tauri.ts src/services/gitlab.ts src/services/index.ts
git commit -m "feat(services): add approval checkpoint wrappers"
```

---

## Task 6: View reducer — state + actions for changed-since set

**Files:**
- Modify: `src/pages/MRDetailPage/viewReducer.ts`
- Create: `src/pages/MRDetailPage/viewReducer.test.ts`

- [ ] **Step 1: Write failing tests**

Create `src/pages/MRDetailPage/viewReducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { viewReducerForTest as viewReducer, initialViewState } from './viewReducer';

describe('viewReducer — approval delta', () => {
  it('SET_CHANGED_SET stores the set', () => {
    const next = viewReducer(initialViewState, {
      type: 'SET_CHANGED_SET',
      paths: ['a.ts', 'b.ts'],
    });
    expect(Array.from(next.changedSinceApprovalPaths).sort()).toEqual(['a.ts', 'b.ts']);
  });

  it('TOGGLE_CHANGED_FILTER flips filterToChangedOnly', () => {
    const next = viewReducer(initialViewState, { type: 'TOGGLE_CHANGED_FILTER' });
    expect(next.filterToChangedOnly).toBe(true);
    const back = viewReducer(next, { type: 'TOGGLE_CHANGED_FILTER' });
    expect(back.filterToChangedOnly).toBe(false);
  });

  it('DISMISS_BANNER sets bannerDismissed', () => {
    const next = viewReducer(initialViewState, { type: 'DISMISS_BANNER' });
    expect(next.bannerDismissed).toBe(true);
  });

  it('RESET_CHANGED_SET clears set, filter, and banner dismissal', () => {
    const primed = {
      ...initialViewState,
      changedSinceApprovalPaths: new Set(['a.ts']),
      filterToChangedOnly: true,
      bannerDismissed: true,
    };
    const next = viewReducer(primed, { type: 'RESET_CHANGED_SET' });
    expect(next.changedSinceApprovalPaths.size).toBe(0);
    expect(next.filterToChangedOnly).toBe(false);
    expect(next.bannerDismissed).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bunx vitest run src/pages/MRDetailPage/viewReducer.test.ts`
Expected: FAIL — `viewReducerForTest` not exported; new fields/actions don't exist.

- [ ] **Step 3: Extend the reducer**

Replace `src/pages/MRDetailPage/viewReducer.ts` with:

```ts
import { useReducer } from 'react';

export interface ViewState {
  selectedFile: string | null;
  fileFocusIndex: number;
  viewMode: 'unified' | 'split';
  collapseState: 'collapsed' | 'expanded' | 'partial';
  mobileSidebarOpen: boolean;
  viewedPaths: Set<string>;
  hideGenerated: boolean;
  changedSinceApprovalPaths: Set<string>;
  filterToChangedOnly: boolean;
  bannerDismissed: boolean;
}

type ViewAction =
  | { type: 'SELECT_FILE'; path: string; index: number; hasSavedState: boolean }
  | { type: 'SET_VIEW_MODE'; mode: 'unified' | 'split' }
  | { type: 'SET_COLLAPSE'; state: 'collapsed' | 'expanded' | 'partial' }
  | { type: 'TOGGLE_MOBILE_SIDEBAR' }
  | { type: 'CLOSE_MOBILE_SIDEBAR' }
  | { type: 'MARK_VIEWED'; path: string }
  | { type: 'TOGGLE_HIDE_GENERATED' }
  | { type: 'SET_CHANGED_SET'; paths: string[] }
  | { type: 'TOGGLE_CHANGED_FILTER' }
  | { type: 'DISMISS_BANNER' }
  | { type: 'RESET_CHANGED_SET' };

export const initialViewState: ViewState = {
  selectedFile: null,
  fileFocusIndex: 0,
  viewMode: 'unified',
  collapseState: 'collapsed',
  mobileSidebarOpen: false,
  viewedPaths: new Set(),
  hideGenerated: true,
  changedSinceApprovalPaths: new Set(),
  filterToChangedOnly: false,
  bannerDismissed: false,
};

function viewReducer(state: ViewState, action: ViewAction): ViewState {
  switch (action.type) {
    case 'SELECT_FILE':
      return {
        ...state,
        selectedFile: action.path,
        fileFocusIndex: action.index,
        collapseState: action.hasSavedState ? 'partial' : 'collapsed',
        mobileSidebarOpen: false,
      };
    case 'SET_VIEW_MODE':
      return { ...state, viewMode: action.mode };
    case 'SET_COLLAPSE':
      return { ...state, collapseState: action.state };
    case 'TOGGLE_MOBILE_SIDEBAR':
      return { ...state, mobileSidebarOpen: !state.mobileSidebarOpen };
    case 'CLOSE_MOBILE_SIDEBAR':
      return { ...state, mobileSidebarOpen: false };
    case 'MARK_VIEWED':
      return { ...state, viewedPaths: new Set(state.viewedPaths).add(action.path) };
    case 'TOGGLE_HIDE_GENERATED':
      return { ...state, hideGenerated: !state.hideGenerated };
    case 'SET_CHANGED_SET':
      return { ...state, changedSinceApprovalPaths: new Set(action.paths) };
    case 'TOGGLE_CHANGED_FILTER':
      return { ...state, filterToChangedOnly: !state.filterToChangedOnly };
    case 'DISMISS_BANNER':
      return { ...state, bannerDismissed: true };
    case 'RESET_CHANGED_SET':
      return {
        ...state,
        changedSinceApprovalPaths: new Set(),
        filterToChangedOnly: false,
        bannerDismissed: false,
      };
  }
}

export const viewReducerForTest = viewReducer;

export function useViewReducer() {
  return useReducer(viewReducer, initialViewState);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bunx vitest run src/pages/MRDetailPage/viewReducer.test.ts`
Expected: all four tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MRDetailPage/viewReducer.ts src/pages/MRDetailPage/viewReducer.test.ts
git commit -m "feat(mr-detail): reducer state for approval delta"
```

---

## Task 7: Load checkpoint + derive changed-set on MR mount

**Files:**
- Modify: `src/pages/MRDetailPage/index.tsx`

- [ ] **Step 1: Add the load effect**

In `src/pages/MRDetailPage/index.tsx`, add these imports to the existing `services/gitlab` import (line 26):

```ts
import {
  deleteComment,
  getApprovalCheckpoint,
  getFilesChangedSince,
} from '../../services/gitlab';
```

Add this effect after the existing "Clear file cache when MR changes" block (around line 119):

```tsx
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const approvedAt = await getApprovalCheckpoint(mrId);
        if (cancelled) return;
        if (approvedAt == null) {
          dispatch({ type: 'RESET_CHANGED_SET' });
          return;
        }
        const paths = await getFilesChangedSince(mrId, approvedAt);
        if (cancelled) return;
        dispatch({ type: 'SET_CHANGED_SET', paths });
      } catch (err) {
        console.error('[mr-detail] failed to load approval delta', err);
      }
    })();
    return () => { cancelled = true; };
  }, [mrId, dispatch]);
```

- [ ] **Step 2: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/pages/MRDetailPage/index.tsx
git commit -m "feat(mr-detail): load approval checkpoint and derive changed-set"
```

---

## Task 8: Record checkpoint on in-app approval

**Files:**
- Modify: `src/pages/MRDetailPage/index.tsx` (wrap existing `onApproved`)

Context: the approval action is triggered via `approvalButtonRef` → `MRHeader` → an `onApproved` callback (index.tsx:250). On successful approval we want to stamp the checkpoint before navigating away.

- [ ] **Step 1: Add `setApprovalCheckpoint` to the imports**

Extend the import from step 7:

```ts
import {
  deleteComment,
  getApprovalCheckpoint,
  getFilesChangedSince,
  setApprovalCheckpoint,
} from '../../services/gitlab';
```

- [ ] **Step 2: Stamp the checkpoint in `onApproved`**

Replace the existing `onApproved` inline handler at `src/pages/MRDetailPage/index.tsx:250-253` with:

```tsx
        onApproved={(trigger) => {
          trackMRApproved(mrId, Math.round((Date.now() - mrEnteredAtRef.current) / 1000), trigger);
          // Fire-and-forget: stamp the checkpoint so a future push shows delta.
          setApprovalCheckpoint(mrId).catch((err) =>
            console.error('[mr-detail] failed to set approval checkpoint', err),
          );
          dispatch({ type: 'RESET_CHANGED_SET' });
          navigate('/mrs');
        }}
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/MRDetailPage/index.tsx
git commit -m "feat(mr-detail): stamp approval checkpoint on approve"
```

---

## Task 9: `ApprovalDeltaBanner` component

**Files:**
- Create: `src/pages/MRDetailPage/ApprovalDeltaBanner.tsx`
- Create: `src/pages/MRDetailPage/ApprovalDeltaBanner.css`
- Modify: `src/pages/MRDetailPage/index.tsx` (render the banner)

- [ ] **Step 1: Create the component**

Create `src/pages/MRDetailPage/ApprovalDeltaBanner.tsx`:

```tsx
import './ApprovalDeltaBanner.css';

interface ApprovalDeltaBannerProps {
  count: number;
  onReviewChanges: () => void;
  onDismiss: () => void;
}

export default function ApprovalDeltaBanner({
  count,
  onReviewChanges,
  onDismiss,
}: ApprovalDeltaBannerProps) {
  return (
    <div className="approval-delta-banner" role="status">
      <span>
        {count} {count === 1 ? 'file has' : 'files have'} changed since you approved.
      </span>
      <div className="approval-delta-banner-actions">
        <button
          type="button"
          className="approval-delta-banner-btn primary"
          onClick={onReviewChanges}
        >
          Review changes
        </button>
        <button
          type="button"
          className="approval-delta-banner-btn"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create the CSS (match existing banner aesthetic)**

Create `src/pages/MRDetailPage/ApprovalDeltaBanner.css`:

```css
.approval-delta-banner {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 8px 16px;
  background: var(--banner-bg, #2d2a3a);
  color: var(--banner-fg, #e8e8f0);
  border-bottom: 1px solid var(--border-color, #3a3a4a);
  font-size: 13px;
}

.approval-delta-banner-actions {
  display: flex;
  gap: 8px;
}

.approval-delta-banner-btn {
  background: transparent;
  color: inherit;
  border: 1px solid currentColor;
  padding: 4px 10px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
}

.approval-delta-banner-btn.primary {
  background: var(--accent, #8a7fff);
  border-color: transparent;
  color: #fff;
}

.approval-delta-banner-btn:hover {
  opacity: 0.85;
}
```

- [ ] **Step 3: Render the banner in MRDetailPage**

In `src/pages/MRDetailPage/index.tsx`, add the import near other page imports:

```tsx
import ApprovalDeltaBanner from './ApprovalDeltaBanner';
```

Insert the banner block immediately before the `<MRHeader ... />` render (around line 242), after the closing `</div>` of the `isMergedOrClosed` block:

```tsx
      {view.changedSinceApprovalPaths.size > 0 && !view.bannerDismissed && (
        <ApprovalDeltaBanner
          count={view.changedSinceApprovalPaths.size}
          onReviewChanges={() => dispatch({ type: 'TOGGLE_CHANGED_FILTER' })}
          onDismiss={() => dispatch({ type: 'DISMISS_BANNER' })}
        />
      )}
```

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MRDetailPage/ApprovalDeltaBanner.tsx src/pages/MRDetailPage/ApprovalDeltaBanner.css src/pages/MRDetailPage/index.tsx
git commit -m "feat(mr-detail): approval delta banner"
```

---

## Task 10: Filter toggle + plumbing through MRFilePanel / FileNavigation

**Files:**
- Modify: `src/pages/MRDetailPage/MRFilePanel.tsx`
- Modify: `src/components/FileNavigation/FileNavigation.tsx`
- Modify: `src/components/FileNavigation/FileNavigation.css`
- Modify: `src/pages/MRDetailPage/index.tsx`

- [ ] **Step 1: Add props to `MRFilePanel`**

Replace `src/pages/MRDetailPage/MRFilePanel.tsx` with:

```tsx
import { FileNavigation } from '../../components/FileNavigation';
import type { DiffFileSummary } from '../../types';

interface MRFilePanelProps {
  files: DiffFileSummary[];
  selectedPath: string | null;
  focusIndex: number;
  viewedPaths: Set<string>;
  generatedPaths: Set<string>;
  hideGenerated: boolean;
  mobileSidebarOpen: boolean;
  isSmallScreen: boolean;
  changedSinceApprovalPaths: Set<string>;
  filterToChangedOnly: boolean;
  onSelect: (path: string) => void;
  onToggleHideGenerated: () => void;
  onToggleChangedFilter: () => void;
  onCloseMobileSidebar: () => void;
}

export default function MRFilePanel({
  files,
  selectedPath,
  focusIndex,
  viewedPaths,
  generatedPaths,
  hideGenerated,
  mobileSidebarOpen,
  isSmallScreen,
  changedSinceApprovalPaths,
  filterToChangedOnly,
  onSelect,
  onToggleHideGenerated,
  onToggleChangedFilter,
  onCloseMobileSidebar,
}: MRFilePanelProps) {
  return (
    <>
      {mobileSidebarOpen && isSmallScreen && (
        <div
          className="mobile-sidebar-backdrop"
          onClick={onCloseMobileSidebar}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onCloseMobileSidebar();
          }}
          role="button"
          tabIndex={0}
          aria-label="Close sidebar"
        />
      )}
      <aside className={`mr-detail-sidebar${mobileSidebarOpen ? ' mobile-open' : ''}`}>
        <FileNavigation
          files={files}
          selectedPath={selectedPath ?? undefined}
          onSelect={onSelect}
          focusIndex={focusIndex}
          viewedPaths={viewedPaths}
          generatedPaths={generatedPaths}
          hideGenerated={hideGenerated}
          onToggleHideGenerated={onToggleHideGenerated}
          changedSinceApprovalPaths={changedSinceApprovalPaths}
          filterToChangedOnly={filterToChangedOnly}
          onToggleChangedFilter={
            changedSinceApprovalPaths.size > 0 ? onToggleChangedFilter : undefined
          }
        />
      </aside>
    </>
  );
}
```

- [ ] **Step 2: Extend `FileNavigation` to honor filter + render badges**

In `src/components/FileNavigation/FileNavigation.tsx`, extend the `FileNavigationProps` interface (around line 12-29):

```ts
interface FileNavigationProps {
  files: DiffFileSummary[];
  selectedPath?: string;
  onSelect: (filePath: string) => void;
  focusIndex?: number;
  viewedPaths?: Set<string>;
  generatedPaths?: Set<string>;
  hideGenerated?: boolean;
  onToggleHideGenerated?: () => void;
  changedSinceApprovalPaths?: Set<string>;
  filterToChangedOnly?: boolean;
  onToggleChangedFilter?: () => void;
}
```

Destructure the new props in the component:

```tsx
export default function FileNavigation({
  files,
  selectedPath,
  onSelect,
  focusIndex,
  viewedPaths,
  generatedPaths,
  hideGenerated,
  onToggleHideGenerated,
  changedSinceApprovalPaths,
  filterToChangedOnly,
  onToggleChangedFilter,
}: FileNavigationProps) {
```

Find the `useMemo` that computes the displayed file list (search for `hideGenerated` in this file). Extend the filter to also honor `filterToChangedOnly`:

```tsx
  const displayedFiles = useMemo(() => {
    return files.filter((f) => {
      if (hideGenerated && generatedPaths?.has(f.newPath)) return false;
      if (filterToChangedOnly && !changedSinceApprovalPaths?.has(f.newPath)) return false;
      return true;
    });
  }, [files, hideGenerated, generatedPaths, filterToChangedOnly, changedSinceApprovalPaths]);
```

(If the existing `useMemo` already exists under a different name, amend that one — don't introduce a parallel variable. Search for `hideGenerated && ` in `FileNavigation.tsx` to find it.)

In the header area where `onToggleHideGenerated` is rendered, add the filter toggle right next to it (conditional on the callback being provided):

```tsx
  {onToggleChangedFilter && (
    <button
      type="button"
      className={`file-nav-filter-btn${filterToChangedOnly ? ' active' : ''}`}
      onClick={onToggleChangedFilter}
      title="Show only files changed since your approval"
    >
      Changes since approval
    </button>
  )}
```

In the file row rendering (search for the element that renders each `file` — it uses `change-{added|deleted|...}` classes), add a "new" badge next to the filename when the file is in `changedSinceApprovalPaths`:

```tsx
  {changedSinceApprovalPaths?.has(file.newPath) && (
    <span className="file-nav-delta-badge" title="Changed since your approval">
      new
    </span>
  )}
```

- [ ] **Step 3: Add CSS for the badge + toggle**

Append to `src/components/FileNavigation/FileNavigation.css`:

```css
.file-nav-delta-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border-radius: 8px;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.4;
  background: var(--accent, #8a7fff);
  color: #fff;
  text-transform: uppercase;
  letter-spacing: 0.02em;
}

.file-nav-filter-btn {
  background: transparent;
  border: 1px solid var(--border-color, #3a3a4a);
  color: var(--text-primary, #e8e8f0);
  border-radius: 4px;
  padding: 2px 8px;
  font-size: 11px;
  cursor: pointer;
}

.file-nav-filter-btn.active {
  background: var(--accent, #8a7fff);
  border-color: transparent;
  color: #fff;
}
```

- [ ] **Step 4: Pass new props from `MRDetailPage` to `MRFilePanel`**

In `src/pages/MRDetailPage/index.tsx`, update the `<MRFilePanel ... />` call (around line 259-271) with the new props:

```tsx
        <MRFilePanel
          files={files}
          selectedPath={view.selectedFile}
          focusIndex={view.fileFocusIndex}
          viewedPaths={view.viewedPaths}
          generatedPaths={generatedPaths}
          hideGenerated={view.hideGenerated}
          mobileSidebarOpen={view.mobileSidebarOpen}
          isSmallScreen={isSmallScreen}
          changedSinceApprovalPaths={view.changedSinceApprovalPaths}
          filterToChangedOnly={view.filterToChangedOnly}
          onSelect={handleFileSelect}
          onToggleHideGenerated={() => dispatch({ type: 'TOGGLE_HIDE_GENERATED' })}
          onToggleChangedFilter={() => dispatch({ type: 'TOGGLE_CHANGED_FILTER' })}
          onCloseMobileSidebar={() => dispatch({ type: 'CLOSE_MOBILE_SIDEBAR' })}
        />
```

- [ ] **Step 5: Typecheck + lint**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/MRDetailPage/MRFilePanel.tsx src/pages/MRDetailPage/index.tsx src/components/FileNavigation/FileNavigation.tsx src/components/FileNavigation/FileNavigation.css
git commit -m "feat(file-nav): filter toggle and badge for approval delta"
```

---

## Task 11: Full verification

- [ ] **Step 1: Backend tests**

Run: `cd src-tauri && cargo test`
Expected: all tests pass.

- [ ] **Step 2: Frontend tests**

Run: `bunx vitest run`
Expected: all tests pass (including new `viewReducer.test.ts`).

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 4: Manual E2E with real credentials**

1. Start `bun run tauri dev`.
2. Open an MR with recent commits.
3. Approve the MR from within Ultra GitLab.
4. Push a new commit to the MR's source branch (via `git push` on a fixture project from `credentials.md`).
5. Wait for the sync engine to refresh file versions (or press refresh).
6. Reopen the MR. Expected:
   - Banner appears with `N files have changed since you approved.`.
   - Clicking **Review changes** hides files not in the changed set.
   - Each changed file shows a "new" badge.
   - Clicking **Dismiss** removes the banner; badges and filter toggle remain.
   - Re-approving the MR clears the banner, badges, and filter on next load.

- [ ] **Step 5: No commit** — verification is a read-only gate.

---

## Out-of-Scope (confirmed with user, not implemented)

- Approvals made outside Ultra (gitlab.com web UI).
- Un-approve handling.
- File removal detection between approval and re-review.
- Diff-level granularity within a file.
- Multiple historical checkpoints.
