# Issue Cache-First Reads Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Issue Detail page render from local SQLite on every visit, with a transparent background refresh that keeps data current — so navigating to a previously-viewed issue never shows a loading spinner.

**Architecture:** Add a new `issue_notes` table to cache GitLab notes, split the single `get_issue_detail` backend command into three (cached-read, cached-notes-read, network-refresh), and rewire the frontend query hooks to read-from-cache + refresh-in-background. Mutations (add note, set assignees, set state) remain online-only in this plan; making them offline-capable is a follow-up (Track B).

**Tech Stack:** Rust (sqlx, Tauri 2), React 19 + TypeScript, @tanstack/react-query, Bun.

**PRD reference:** `tasks/prd-issue-offline-support.md` — this plan covers Track A (US-001 to US-004).

---

## File Structure

**Backend (Rust):**
- Create: `src-tauri/src/db/migrations/0021_create_issue_notes.sql` — new `issue_notes` table
- Create: `src-tauri/src/db/issue_notes.rs` — CRUD helpers for `issue_notes`
- Modify: `src-tauri/src/db/mod.rs` — register the migration + module
- Modify: `src-tauri/src/commands/issues.rs` — add `get_cached_issue_detail`, `list_cached_issue_notes`, `refresh_issue_detail`; remove `get_issue_detail` (replaced by the pair above)
- Modify: `src-tauri/src/commands/mod.rs` — re-export new commands, drop `get_issue_detail`
- Modify: `src-tauri/src/lib.rs` — register handlers, drop `get_issue_detail`

**Frontend (TypeScript):**
- Modify: `src/services/tauri.ts` — replace `getIssueDetail` with `getCachedIssueDetail` + `refreshIssueDetail`; replace `listIssueNotes` with `listCachedIssueNotes`
- Modify: `src/lib/queryKeys.ts` — add `cachedIssue` / `cachedIssueNotes` keys (or reuse existing, see Task 7)
- Modify: `src/pages/IssueDetailPage/useIssueData.ts` — rewrite `useIssueDetailQuery`, `useIssueNotesQuery`, add `useIssueBackgroundRefresh`
- Modify: `src/pages/IssueDetailPage/IssueDetailView.tsx` — show "updating…" indicator while background refresh is in flight; remove first-visit spinner for cached data

---

## Conventions

- **Commit after each task.** Run `cargo check` (or `bunx tsc --noEmit` for TS tasks) before committing.
- **All Rust tests use the `setup_test_db()` helper pattern** from `src-tauri/src/models/project.rs` — copy it into new test modules.
- **Migration numbering:** the next free number is `0021`.
- **Serde:** DTO response structs for the frontend use `#[serde(rename_all = "camelCase")]`; DB row structs stay snake_case.

---

## Task 1: Add `issue_notes` table migration

**Files:**
- Create: `src-tauri/src/db/migrations/0021_create_issue_notes.sql`
- Modify: `src-tauri/src/db/mod.rs:88-180` (the `MIGRATIONS` array and `test_initialize_creates_database` assertions)

- [ ] **Step 1: Write the migration SQL**

Create `src-tauri/src/db/migrations/0021_create_issue_notes.sql`:

```sql
-- Migration: 0021_create_issue_notes.sql
-- Caches GitLab issue notes (comments) locally so the Issue Detail page can
-- render without a network round-trip. Rows are upserted on `refresh_issue_detail`
-- and looked up on `list_cached_issue_notes`.

CREATE TABLE IF NOT EXISTS issue_notes (
    id INTEGER NOT NULL,
    instance_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    issue_iid INTEGER NOT NULL,
    body TEXT NOT NULL,
    author_username TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_avatar_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    system INTEGER NOT NULL DEFAULT 0,
    cached_at INTEGER NOT NULL,
    PRIMARY KEY (id, instance_id),
    FOREIGN KEY (instance_id) REFERENCES gitlab_instances(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issue_notes_lookup
    ON issue_notes(instance_id, project_id, issue_iid, created_at);
```

- [ ] **Step 2: Register the migration**

Edit `src-tauri/src/db/mod.rs`, append to the `MIGRATIONS` array (after the `0020` entry, around line 175):

```rust
    (
        "0021_create_issue_notes",
        include_str!("migrations/0021_create_issue_notes.sql"),
    ),
```

- [ ] **Step 3: Add a test asserting the table exists**

Edit `src-tauri/src/db/mod.rs` inside `test_initialize_creates_database` (around line 300, where other `assert!(table_names.contains(...))` calls live), add:

```rust
        assert!(table_names.contains(&"issue_notes"));
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `cd src-tauri && cargo test -p ultra-gitlab-lib db::tests -- --nocapture`

Expected: both `test_initialize_creates_database` and `test_migrations_are_idempotent` pass. The former's `table_names` list now includes `issue_notes`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/migrations/0021_create_issue_notes.sql src-tauri/src/db/mod.rs
git commit -m "feat(issues): add issue_notes table migration"
```

---

## Task 2: Add `db/issue_notes.rs` module

**Files:**
- Create: `src-tauri/src/db/issue_notes.rs`
- Modify: `src-tauri/src/db/mod.rs:8-11` (module declarations)

- [ ] **Step 1: Write the failing tests**

Create `src-tauri/src/db/issue_notes.rs`:

```rust
//! CRUD helpers for the `issue_notes` cache.

use crate::db::pool::DbPool;
use crate::error::AppError;
use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// A cached GitLab issue note (comment).
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct IssueNoteRow {
    pub id: i64,
    pub instance_id: i64,
    pub project_id: i64,
    pub issue_iid: i64,
    pub body: String,
    pub author_username: String,
    pub author_name: String,
    pub author_avatar_url: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub system: bool,
    pub cached_at: i64,
}

/// Fields accepted by `upsert_issue_note`.
#[derive(Debug, Clone)]
pub struct UpsertIssueNote {
    pub id: i64,
    pub instance_id: i64,
    pub project_id: i64,
    pub issue_iid: i64,
    pub body: String,
    pub author_username: String,
    pub author_name: String,
    pub author_avatar_url: Option<String>,
    pub created_at: i64,
    pub updated_at: i64,
    pub system: bool,
}

/// Insert or update a cached note. Uses (id, instance_id) as the natural key.
pub async fn upsert_issue_note(pool: &DbPool, note: &UpsertIssueNote) -> Result<(), AppError> {
    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        r#"
        INSERT INTO issue_notes (
            id, instance_id, project_id, issue_iid, body,
            author_username, author_name, author_avatar_url,
            created_at, updated_at, system, cached_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id, instance_id) DO UPDATE SET
            body = excluded.body,
            author_username = excluded.author_username,
            author_name = excluded.author_name,
            author_avatar_url = excluded.author_avatar_url,
            created_at = excluded.created_at,
            updated_at = excluded.updated_at,
            system = excluded.system,
            cached_at = excluded.cached_at
        "#,
    )
    .bind(note.id)
    .bind(note.instance_id)
    .bind(note.project_id)
    .bind(note.issue_iid)
    .bind(&note.body)
    .bind(&note.author_username)
    .bind(&note.author_name)
    .bind(&note.author_avatar_url)
    .bind(note.created_at)
    .bind(note.updated_at)
    .bind(note.system as i64)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// List cached notes for an issue, oldest first.
pub async fn list_cached_notes(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    issue_iid: i64,
) -> Result<Vec<IssueNoteRow>, AppError> {
    let rows = sqlx::query_as::<_, IssueNoteRow>(
        r#"
        SELECT id, instance_id, project_id, issue_iid, body,
               author_username, author_name, author_avatar_url,
               created_at, updated_at, system, cached_at
        FROM issue_notes
        WHERE instance_id = ? AND project_id = ? AND issue_iid = ?
        ORDER BY created_at ASC
        "#,
    )
    .bind(instance_id)
    .bind(project_id)
    .bind(issue_iid)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Delete cached notes for an issue whose GitLab ids are NOT in `keep_ids`.
/// Called after a refresh so notes deleted on GitLab disappear locally.
pub async fn prune_missing_notes(
    pool: &DbPool,
    instance_id: i64,
    project_id: i64,
    issue_iid: i64,
    keep_ids: &[i64],
) -> Result<(), AppError> {
    // Build `(?, ?, ...)` placeholder list; empty list means delete ALL for the issue.
    if keep_ids.is_empty() {
        sqlx::query(
            "DELETE FROM issue_notes
             WHERE instance_id = ? AND project_id = ? AND issue_iid = ?",
        )
        .bind(instance_id)
        .bind(project_id)
        .bind(issue_iid)
        .execute(pool)
        .await?;
        return Ok(());
    }

    let placeholders = vec!["?"; keep_ids.len()].join(",");
    let sql = format!(
        "DELETE FROM issue_notes
         WHERE instance_id = ? AND project_id = ? AND issue_iid = ?
           AND id NOT IN ({})",
        placeholders
    );
    let mut q = sqlx::query(&sql)
        .bind(instance_id)
        .bind(project_id)
        .bind(issue_iid);
    for id in keep_ids {
        q = q.bind(*id);
    }
    q.execute(pool).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::tempdir;

    async fn setup_test_db() -> sqlx::SqlitePool {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");
        let pool = db::initialize(&db_path).await.unwrap();
        sqlx::query(
            "INSERT INTO gitlab_instances (url, name) VALUES ('https://gitlab.com', 'GitLab')",
        )
        .execute(&pool)
        .await
        .unwrap();
        pool
    }

    fn sample_note(id: i64) -> UpsertIssueNote {
        UpsertIssueNote {
            id,
            instance_id: 1,
            project_id: 10,
            issue_iid: 5,
            body: format!("note body {}", id),
            author_username: "alice".to_string(),
            author_name: "Alice".to_string(),
            author_avatar_url: None,
            created_at: 1_700_000_000 + id,
            updated_at: 1_700_000_000 + id,
            system: false,
        }
    }

    #[tokio::test]
    async fn test_upsert_and_list_notes_ordered_by_created_at() {
        let pool = setup_test_db().await;
        upsert_issue_note(&pool, &sample_note(3)).await.unwrap();
        upsert_issue_note(&pool, &sample_note(1)).await.unwrap();
        upsert_issue_note(&pool, &sample_note(2)).await.unwrap();

        let rows = list_cached_notes(&pool, 1, 10, 5).await.unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(rows[0].id, 1);
        assert_eq!(rows[1].id, 2);
        assert_eq!(rows[2].id, 3);
    }

    #[tokio::test]
    async fn test_upsert_updates_existing_body() {
        let pool = setup_test_db().await;
        let mut note = sample_note(1);
        upsert_issue_note(&pool, &note).await.unwrap();

        note.body = "edited".to_string();
        upsert_issue_note(&pool, &note).await.unwrap();

        let rows = list_cached_notes(&pool, 1, 10, 5).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].body, "edited");
    }

    #[tokio::test]
    async fn test_prune_missing_notes_keeps_listed_ids() {
        let pool = setup_test_db().await;
        for id in [1, 2, 3] {
            upsert_issue_note(&pool, &sample_note(id)).await.unwrap();
        }

        prune_missing_notes(&pool, 1, 10, 5, &[2]).await.unwrap();

        let rows = list_cached_notes(&pool, 1, 10, 5).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, 2);
    }

    #[tokio::test]
    async fn test_prune_with_empty_keep_list_clears_issue() {
        let pool = setup_test_db().await;
        upsert_issue_note(&pool, &sample_note(1)).await.unwrap();

        prune_missing_notes(&pool, 1, 10, 5, &[]).await.unwrap();

        let rows = list_cached_notes(&pool, 1, 10, 5).await.unwrap();
        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn test_notes_for_other_issues_not_returned() {
        let pool = setup_test_db().await;
        upsert_issue_note(&pool, &sample_note(1)).await.unwrap();

        let mut other = sample_note(2);
        other.issue_iid = 99;
        upsert_issue_note(&pool, &other).await.unwrap();

        let rows = list_cached_notes(&pool, 1, 10, 5).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].id, 1);
    }
}
```

- [ ] **Step 2: Register the module**

Edit `src-tauri/src/db/mod.rs` (around line 8) and add the new `pub mod` line:

```rust
pub mod file_cache;
pub mod issue_notes;
pub mod notification_settings;
pub mod pipeline_cache;
pub mod pool;
```

- [ ] **Step 3: Run tests — they should fail to compile until the module is wired up, then pass**

Run: `cd src-tauri && cargo test -p ultra-gitlab-lib db::issue_notes -- --nocapture`

Expected: all five tests pass.

- [ ] **Step 4: Verify full build still compiles**

Run: `cd src-tauri && cargo check`

Expected: no errors, no new warnings.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/db/issue_notes.rs src-tauri/src/db/mod.rs
git commit -m "feat(issues): add issue_notes DB module with upsert/list/prune"
```

---

## Task 3: Add cached-read commands `get_cached_issue_detail` + `list_cached_issue_notes`

**Files:**
- Modify: `src-tauri/src/commands/issues.rs` — add two new commands after the existing `IssueNoteDto`
- Modify: `src-tauri/src/commands/mod.rs` — re-export
- Modify: `src-tauri/src/lib.rs` — register in `generate_handler!`

- [ ] **Step 1: Add `get_cached_issue_detail` command**

In `src-tauri/src/commands/issues.rs`, add this function near the other cached-read commands (around line 212, next to `list_cached_issues`):

```rust
/// Read a single cached issue by (instance_id, project_id, issue_iid) without
/// hitting GitLab. Returns None if the issue has never been synced locally.
#[tauri::command]
pub async fn get_cached_issue_detail(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    issue_iid: i64,
) -> Result<Option<IssueWithProject>, AppError> {
    let rows = issue::list_issues(pool.inner(), instance_id, Some(project_id), false, false).await?;
    let Some(row) = rows.into_iter().find(|i| i.iid == issue_iid) else {
        return Ok(None);
    };
    let project = project::get_project(pool.inner(), instance_id, project_id).await?;
    Ok(Some(IssueWithProject {
        project_name: project.as_ref().map(|p| p.name.clone()),
        project_name_with_namespace: project.as_ref().map(|p| p.name_with_namespace.clone()),
        project_path_with_namespace: project.as_ref().map(|p| p.path_with_namespace.clone()),
        project_custom_name: project.as_ref().and_then(|p| p.custom_name.clone()),
        project_starred: project.as_ref().map(|p| p.starred).unwrap_or(false),
        issue: row,
    }))
}
```

- [ ] **Step 2: Add `list_cached_issue_notes` command**

In the same file, add this function near `list_issue_notes` (around line 414 — keep both during the transition; remove the old one in Task 8):

```rust
/// Read cached issue notes without hitting GitLab. Empty list means either
/// "no notes" or "never refreshed" — the caller should trigger a refresh on
/// first visit to distinguish.
#[tauri::command]
pub async fn list_cached_issue_notes(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    issue_iid: i64,
) -> Result<Vec<IssueNoteDto>, AppError> {
    let rows = crate::db::issue_notes::list_cached_notes(
        pool.inner(),
        instance_id,
        project_id,
        issue_iid,
    )
    .await?;
    Ok(rows
        .into_iter()
        .map(|r| IssueNoteDto {
            id: r.id,
            body: r.body,
            author_username: r.author_username,
            author_name: r.author_name,
            author_avatar_url: r.author_avatar_url,
            created_at: r.created_at,
            updated_at: r.updated_at,
            system: r.system,
        })
        .collect())
}
```

- [ ] **Step 3: Re-export from `commands/mod.rs`**

Edit `src-tauri/src/commands/mod.rs` line 53 area. Locate the existing line:

```rust
    add_issue_note, get_issue_detail, list_cached_issues, list_issue_assignee_candidates,
```

Replace with (alphabetical, adding the two new exports):

```rust
    add_issue_note, get_cached_issue_detail, get_issue_detail, list_cached_issue_notes,
    list_cached_issues, list_issue_assignee_candidates,
```

- [ ] **Step 4: Register in `lib.rs` handler**

Edit `src-tauri/src/lib.rs`. Find the import line (around line 23) and add the two new names; find the `generate_handler!` block (around line 337) and add them there too.

Import line change (keep sorted):
```rust
    add_issue_note, get_cached_issue_detail, get_issue_detail, get_token_info,
    list_cached_issue_notes, list_cached_issues,
```

`generate_handler!` additions (place near existing issue commands):
```rust
            get_cached_issue_detail,
            get_issue_detail,
            list_cached_issue_notes,
```

- [ ] **Step 5: Verify build**

Run: `cd src-tauri && cargo check`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/issues.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(issues): add cached-read commands for issue detail and notes"
```

---

## Task 4: Add `refresh_issue_detail` command (network fetch + cache write + prune)

**Files:**
- Modify: `src-tauri/src/commands/issues.rs`
- Modify: `src-tauri/src/commands/mod.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1: Add a helper to cache notes after a refresh**

In `src-tauri/src/commands/issues.rs`, add this helper below `upsert_and_join` (around line 398):

```rust
/// Fetch and cache all notes for an issue. Prunes any locally-cached notes
/// whose GitLab ids are no longer present (i.e. deleted upstream).
async fn fetch_and_cache_notes(
    client: &GitLabClient,
    pool: &sqlx::SqlitePool,
    instance_id: i64,
    project_id: i64,
    issue_iid: i64,
) -> Result<(), AppError> {
    let notes = client.list_issue_notes(project_id, issue_iid).await?;
    let keep_ids: Vec<i64> = notes.iter().map(|n| n.id).collect();

    for n in notes {
        let upsert = crate::db::issue_notes::UpsertIssueNote {
            id: n.id,
            instance_id,
            project_id,
            issue_iid,
            body: n.body,
            author_username: n.author.username,
            author_name: n.author.name,
            author_avatar_url: n.author.avatar_url,
            created_at: parse_ts(&n.created_at),
            updated_at: parse_ts(&n.updated_at),
            system: n.system,
        };
        crate::db::issue_notes::upsert_issue_note(pool, &upsert).await?;
    }

    crate::db::issue_notes::prune_missing_notes(
        pool,
        instance_id,
        project_id,
        issue_iid,
        &keep_ids,
    )
    .await?;
    Ok(())
}
```

- [ ] **Step 2: Add `refresh_issue_detail` command**

In the same file, add this new command just above the existing `get_issue_detail` (around line 399):

```rust
/// Fetch a single issue and its notes from GitLab, write both to the cache,
/// and return the joined row. The frontend calls this in the background after
/// rendering cached data so the view updates silently with fresh values.
#[tauri::command]
pub async fn refresh_issue_detail(
    pool: State<'_, DbPool>,
    instance_id: i64,
    project_id: i64,
    issue_iid: i64,
) -> Result<IssueWithProject, AppError> {
    let (client, username) = create_client_with_username(pool.inner(), instance_id).await?;
    let gi = client.get_issue(project_id, issue_iid).await?;
    let joined = upsert_and_join(pool.inner(), &client, instance_id, gi, &username).await?;
    fetch_and_cache_notes(&client, pool.inner(), instance_id, project_id, issue_iid).await?;
    Ok(joined)
}
```

- [ ] **Step 3: Re-export**

Edit `src-tauri/src/commands/mod.rs`, add `refresh_issue_detail` to the issue-command re-export line (keep alphabetical):

```rust
    add_issue_note, get_cached_issue_detail, get_issue_detail, list_cached_issue_notes,
    list_cached_issues, list_issue_assignee_candidates, list_issue_notes,
    list_issue_projects, refresh_issue_detail, rename_project, set_issue_assignees,
    set_issue_state, sync_my_issues, sync_project_issues, toggle_issue_star,
    toggle_project_star,
```

(Adjust the surrounding line exactly to fit the existing `pub use` statement — preserve the other items.)

- [ ] **Step 4: Register in `lib.rs`**

Edit `src-tauri/src/lib.rs`. Add `refresh_issue_detail` to both the import and the `generate_handler!` list, alongside the other issue commands.

- [ ] **Step 5: Verify build**

Run: `cd src-tauri && cargo check`

Expected: clean.

- [ ] **Step 6: Smoke-test against real GitLab**

From `credentials.md`, grab the test instance + token. Start the Tauri dev app (`bun run tauri dev`), open an existing issue, then in the browser devtools console run:

```js
await window.__TAURI__.core.invoke('refresh_issue_detail', {
  instanceId: 1,
  projectId: /* pick an id from the issues list */,
  issueIid: /* pick an iid */,
});
```

Expected: returns the `IssueWithProject` JSON. Follow-up check:

```js
await window.__TAURI__.core.invoke('list_cached_issue_notes', {
  instanceId: 1,
  projectId: /* same */,
  issueIid: /* same */,
});
```

Expected: returns the same notes array the GitLab web UI shows for that issue.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/issues.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat(issues): add refresh_issue_detail command with notes caching"
```

---

## Task 5: Wire frontend service layer to new commands

**Files:**
- Modify: `src/services/tauri.ts:634-654`
- Modify: `src/services/index.ts` (if it re-exports — verify and adjust)

- [ ] **Step 1: Replace `getIssueDetail` and `listIssueNotes` wrappers**

Edit `src/services/tauri.ts`. Locate `getIssueDetail` (line ~637) and `listIssueNotes` (line ~648). Replace the block spanning both with:

```ts
/**
 * Read a cached issue from SQLite, joined with project metadata.
 * Returns null if the issue has never been synced locally.
 */
export async function getCachedIssueDetail(
  instanceId: number,
  projectId: number,
  issueIid: number,
): Promise<IssueWithProject | null> {
  return invoke<IssueWithProject | null>('get_cached_issue_detail', {
    instanceId,
    projectId,
    issueIid,
  });
}

/**
 * Read cached notes for an issue from SQLite, oldest first.
 */
export async function listCachedIssueNotes(
  instanceId: number,
  projectId: number,
  issueIid: number,
): Promise<IssueNote[]> {
  return invoke<IssueNote[]>('list_cached_issue_notes', {
    instanceId,
    projectId,
    issueIid,
  });
}

/**
 * Fetch a single issue and its notes from GitLab, write both to the cache,
 * and return the refreshed joined row.
 */
export async function refreshIssueDetail(
  instanceId: number,
  projectId: number,
  issueIid: number,
): Promise<IssueWithProject> {
  return invoke<IssueWithProject>('refresh_issue_detail', {
    instanceId,
    projectId,
    issueIid,
  });
}
```

- [ ] **Step 2: Check re-exports**

Run: `grep -n "getIssueDetail\|listIssueNotes" src/services/index.ts src/services/gitlab.ts`

If either symbol is re-exported, update the re-export file: replace `getIssueDetail` with `getCachedIssueDetail, refreshIssueDetail` and `listIssueNotes` with `listCachedIssueNotes`.

- [ ] **Step 3: Verify typecheck**

Run: `bunx tsc --noEmit`

Expected: new `useIssueData.ts` errors will appear (that's Task 6). If there are errors in files you didn't touch in this task, pause and fix them before proceeding.

- [ ] **Step 4: Commit**

```bash
git add src/services/tauri.ts src/services/index.ts src/services/gitlab.ts
git commit -m "feat(issues): add cached-read and refresh service wrappers"
```

(Omit files from the commit that weren't actually modified.)

---

## Task 6: Rewrite `useIssueData.ts` to cache-first + background refresh

**Files:**
- Modify: `src/pages/IssueDetailPage/useIssueData.ts`
- Modify: `src/lib/queryKeys.ts` — no structural change needed; existing `issue` / `issueNotes` keys are reused. (If the plan-executor prefers distinct keys for cache reads, that's fine — but reuse keeps mutation invalidation working.)

- [ ] **Step 1: Replace `useIssueDetailQuery` and `useIssueNotesQuery`**

Open `src/pages/IssueDetailPage/useIssueData.ts`. Replace lines 1–41 with:

```ts
import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  addIssueNote,
  getCachedIssueDetail,
  listCachedIssueNotes,
  listIssueAssigneeCandidates,
  refreshIssueDetail,
  setIssueAssignees,
  setIssueState,
} from '../../services/tauri';
import { queryKeys } from '../../lib/queryKeys';
import type { IssueAssigneeCandidate, IssueNote, IssueWithProject } from '../../types';

/**
 * Read the issue from SQLite. Returns `null` when nothing is cached for this
 * issue yet (first-ever visit) — the view distinguishes that from a loaded row.
 */
export function useIssueDetailQuery(
  instanceId: number | null,
  projectId: number,
  issueIid: number,
) {
  return useQuery<IssueWithProject | null>({
    queryKey:
      instanceId == null
        ? ['issue', 'disabled']
        : queryKeys.issue(instanceId, projectId, issueIid),
    queryFn: () => getCachedIssueDetail(instanceId as number, projectId, issueIid),
    enabled: instanceId != null && projectId > 0 && issueIid > 0,
    staleTime: Infinity,
  });
}

/**
 * Read cached notes for the issue.
 */
export function useIssueNotesQuery(
  instanceId: number | null,
  projectId: number,
  issueIid: number,
) {
  return useQuery<IssueNote[]>({
    queryKey:
      instanceId == null
        ? ['issueNotes', 'disabled']
        : queryKeys.issueNotes(instanceId, projectId, issueIid),
    queryFn: () => listCachedIssueNotes(instanceId as number, projectId, issueIid),
    enabled: instanceId != null && projectId > 0 && issueIid > 0,
    staleTime: Infinity,
  });
}

/**
 * Fire a single background refresh for the issue (+ notes). On success,
 * invalidate the cached-read queries so they re-read from SQLite.
 *
 * Exposes `isPending` so the view can show an "updating…" indicator.
 * Network errors are swallowed here (logged only) — an offline user should
 * still see their cached data without a disruptive error banner.
 */
export function useIssueBackgroundRefresh(
  instanceId: number | null,
  projectId: number,
  issueIid: number,
) {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: () => refreshIssueDetail(instanceId as number, projectId, issueIid),
    onSuccess: () => {
      if (instanceId == null) return;
      qc.invalidateQueries({
        queryKey: queryKeys.issue(instanceId, projectId, issueIid),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.issueNotes(instanceId, projectId, issueIid),
      });
    },
    onError: (err) => {
      console.warn('[issue] background refresh failed', err);
    },
  });

  useEffect(() => {
    if (instanceId == null || projectId <= 0 || issueIid <= 0) return;
    mutation.mutate();
    // Intentionally depend only on identity — we want ONE refresh on mount /
    // when the issue identity changes, not on every re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instanceId, projectId, issueIid]);

  return { isRefreshing: mutation.isPending };
}
```

- [ ] **Step 2: Keep mutation hooks, but invalidate cached-read queries on success**

The existing `useAddIssueNote`, `useSetIssueAssignees`, `useSetIssueState` hooks (lines 59–111 of the original file) already invalidate `queryKeys.issue(...)` and `queryKeys.issueNotes(...)`. That still works after Task 6 because the cache-read queries reuse those keys.

However, `useSetIssueAssignees` and `useSetIssueState` currently call `qc.setQueryData` with the GitLab response. Because cached-read queries now return `IssueWithProject | null`, the cached value shape still matches — leave these as is.

Add one extra refresh after each mutation so notes that were auto-generated by GitLab (e.g. the "state changed" system note) show up:

Replace the body of `useAddIssueNote` (lines 59–76 of the original file) with:

```ts
export function useAddIssueNote(
  instanceId: number,
  projectId: number,
  issueIid: number,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: string) => addIssueNote(instanceId, projectId, issueIid, body),
    onSuccess: async () => {
      // Pull fresh notes + issue into cache so the view updates with the new note.
      await refreshIssueDetail(instanceId, projectId, issueIid);
      qc.invalidateQueries({
        queryKey: queryKeys.issueNotes(instanceId, projectId, issueIid),
      });
      qc.invalidateQueries({
        queryKey: queryKeys.issue(instanceId, projectId, issueIid),
      });
    },
  });
}
```

Apply the same pattern (await `refreshIssueDetail` in `onSuccess`) to `useSetIssueAssignees` and `useSetIssueState`, keeping their existing mutation bodies intact otherwise. Drop the `qc.setQueryData(...)` lines in those two hooks — the refresh + invalidation replaces that write.

`useAssigneeCandidatesQuery` is unchanged.

- [ ] **Step 3: Verify typecheck**

Run: `bunx tsc --noEmit`

Expected: clean. If the view file `IssueDetailView.tsx` now errors because it assumes `issue` is non-null on initial render, that's addressed in Task 7 — proceed.

- [ ] **Step 4: Commit**

```bash
git add src/pages/IssueDetailPage/useIssueData.ts
git commit -m "feat(issues): cache-first queries with background refresh on mount"
```

---

## Task 7: Update `IssueDetailView.tsx` — instant render from cache + subtle "updating…" indicator

**Files:**
- Modify: `src/pages/IssueDetailPage/IssueDetailView.tsx`
- Modify: `src/pages/IssueDetailPage/IssueDetailPage.css` — add one rule for the indicator

- [ ] **Step 1: Use the background refresh hook and adjust loading logic**

Open `src/pages/IssueDetailPage/IssueDetailView.tsx`. In the imports from `./useIssueData` (lines 15–21), add `useIssueBackgroundRefresh`:

```ts
import {
  useIssueDetailQuery,
  useIssueNotesQuery,
  useAddIssueNote,
  useSetIssueAssignees,
  useSetIssueState,
  useIssueBackgroundRefresh,
} from './useIssueData';
```

Inside the component body, after the existing mutation hooks (around line 77), add:

```ts
  const { isRefreshing } = useIssueBackgroundRefresh(instanceId, projectId, issueIid);
```

- [ ] **Step 2: Replace the loading branch so it only shows when there is truly no cached data**

Find the block at lines 159–165:

```tsx
  if (issueQuery.isLoading) {
    return (
      <div className="issue-detail">
        <div className="issue-detail-loading">Loading issue…</div>
      </div>
    );
  }
```

Replace with:

```tsx
  // Show the loading state only on a first-ever visit (no cached row AND query
  // is still resolving). After that, the cached row renders instantly and the
  // background refresh updates it in place.
  if (issueQuery.isLoading || (issue === null && isRefreshing)) {
    return (
      <div className="issue-detail">
        <div className="issue-detail-loading">Loading issue…</div>
      </div>
    );
  }
```

Then locate the error branch at lines 167–178. The `!issue` check currently lumps "no cache + refresh failed" with "hard error." Update it so a `null` cached row without a refresh failure shows the loading state above rather than the error:

Change:

```tsx
  if (issueQuery.isError || !issue) {
```

to:

```tsx
  if (issueQuery.isError || issue == null) {
```

(This keeps the same behavior but is explicit. The upstream branch already handles the "cache miss + still refreshing" case.)

- [ ] **Step 3: Add the "updating…" indicator next to the title**

Inside `header.mr-detail-header > .mr-header-top` (around line 204, after the `<div className="mr-detail-actions">` block), add a sibling that only renders while refreshing:

```tsx
            {isRefreshing && (
              <span className="issue-refresh-indicator" aria-live="polite">
                Updating…
              </span>
            )}
```

- [ ] **Step 4: Add the indicator styles**

Open `src/pages/IssueDetailPage/IssueDetailPage.css` and append:

```css
.issue-refresh-indicator {
  font-size: 0.75rem;
  color: var(--text-muted, #888);
  opacity: 0.8;
  margin-left: 0.5rem;
  font-style: italic;
}
```

(Adjust `--text-muted` fallback if the project uses a different variable — `grep -n "text-muted\|--color-muted" src/**/*.css` to find.)

- [ ] **Step 5: Verify typecheck**

Run: `bunx tsc --noEmit`

Expected: clean.

- [ ] **Step 6: Browser verification (real GitLab)**

Start dev app: `bun run tauri dev`.

Scenario A — cached render:
1. Open the Issues page, click into an issue. Note loading text appears briefly.
2. Go back to the list, click the same issue again. Expected: renders instantly (no "Loading issue…"), "Updating…" appears next to the title for a second, then disappears.

Scenario B — offline render:
1. Disable the machine's network (airplane mode or dev devtools Network → Offline).
2. Navigate to a previously-opened issue. Expected: renders instantly from cache; "Updating…" appears, then disappears silently after the refresh fails (no error banner).
3. Re-enable network; repeat — "Updating…" appears then disappears, page stays rendered.

Scenario C — fresh data appears silently:
1. On GitLab web UI, edit the issue title.
2. In the app, re-visit that issue. Expected: old title renders first, then title swaps to new value within ~1s.

- [ ] **Step 7: Commit**

```bash
git add src/pages/IssueDetailPage/IssueDetailView.tsx src/pages/IssueDetailPage/IssueDetailPage.css
git commit -m "feat(issues): cache-first detail view with background refresh indicator"
```

---

## Task 8: Remove deprecated `get_issue_detail` + `list_issue_notes` commands

**Files:**
- Modify: `src-tauri/src/commands/issues.rs` — delete the two old commands
- Modify: `src-tauri/src/commands/mod.rs` — drop the re-exports
- Modify: `src-tauri/src/lib.rs` — drop the imports and `generate_handler!` entries
- Modify: `src/services/tauri.ts` — confirm the old `getIssueDetail` / `listIssueNotes` wrappers are already removed by Task 5

- [ ] **Step 1: Delete old commands from `commands/issues.rs`**

In `src-tauri/src/commands/issues.rs`, delete:
- The `get_issue_detail` function (lines 399–410 of the original file)
- The `list_issue_notes` function (lines 412–423 of the original file)

Leave `upsert_and_join` and `fetch_and_cache_notes` — they are still used by `refresh_issue_detail`, `set_issue_assignees`, and `set_issue_state`.

- [ ] **Step 2: Drop re-exports from `commands/mod.rs`**

Remove `get_issue_detail` and `list_issue_notes` from the `pub use` line for issue commands.

- [ ] **Step 3: Drop registrations from `lib.rs`**

Remove `get_issue_detail` and `list_issue_notes` from both the `use crate::commands::{...}` import line and the `generate_handler!` macro body.

- [ ] **Step 4: Verify no remaining callers**

Run:
```bash
grep -rn "get_issue_detail\|list_issue_notes\|getIssueDetail\|listIssueNotes" src src-tauri
```

Expected: matches only in this plan document (if at all) and in the new `list_cached_issue_notes` / `refresh_issue_detail` names as substrings. No live call sites.

- [ ] **Step 5: Verify build**

Run:
```bash
cd src-tauri && cargo check
bunx tsc --noEmit
```

Expected: clean.

- [ ] **Step 6: Smoke-test end-to-end one more time**

`bun run tauri dev`, open an issue, post a comment, change assignees, close and reopen. Each should work the same as before the refactor (online-only still, but now with cache-backed reads).

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/issues.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "refactor(issues): remove legacy online-only read commands"
```

---

## Self-Review Notes

- **Spec coverage (PRD Track A = US-001..US-004):**
  - US-001 (notes table + DB module) → Tasks 1 + 2
  - US-002 (cached-read commands) → Task 3
  - US-003 (refresh command) → Task 4 (and US-003's "deprecate and remove old command" → Task 8)
  - US-004 (frontend cache-first + background refresh + updating indicator) → Tasks 5 + 6 + 7
- **Out-of-plan-scope (deferred to Track B):** optimistic writes, `pending_sync` flag, sync queue extension, connectivity awareness, conflict handling, status pill. Mutations in this plan stay online-only; after success they call `refreshIssueDetail` so the cache stays current.
- **Type consistency:** `IssueNoteDto` (backend) ↔ `IssueNote` (frontend type) are unchanged; `IssueWithProject` is unchanged. New `refreshIssueDetail` returns the same `IssueWithProject` shape.
- **Known simplification:** the old mutation commands (`add_issue_note`, `set_issue_assignees`, `set_issue_state`) are untouched — they keep writing directly to GitLab. Their `onSuccess` handlers call `refreshIssueDetail` so the cached-read queries get the latest data. This is intentional: Track B replaces these with queued versions.
