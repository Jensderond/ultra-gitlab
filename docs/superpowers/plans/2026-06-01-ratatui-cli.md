# Ultra GitLab ratatui CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a terminal UI (`ultra`) that browses GitLab merge requests, shows syntax-highlighted diffs, and manages MRs (approve / rebase / merge / undraft / auto-merge), reusing the existing `ultra_gitlab_lib` backend and sharing its SQLite database with the desktop app.

**Architecture:** A new workspace-member crate `src-tauri/cli/` links `ultra_gitlab_lib` by path and opens the **same** SQLite file the desktop app uses (WAL + busy-timeout makes concurrent access safe). Reads come straight from SQLite; actions call `GitLabClient` directly plus an optimistic DB write — exactly what the desktop's command handlers do — so both surfaces converge through GitLab on the desktop's next sync. Shared read/action logic is first extracted from the Tauri command handlers into a new `core` module in the lib, which both the commands and the CLI call.

**Tech Stack:** Rust, ratatui 0.29 + crossterm 0.28 (event-stream), syntect 5 (syntax highlighting), tokio, sqlx (via the lib), `dirs` for DB-path resolution.

---

## Conventions for this plan

- All paths are relative to the repo root `/Users/jens/Sites/ultra-gitlab`.
- The Rust package lives in `src-tauri/`. Run cargo commands from there: `cd src-tauri && cargo ...`.
- Lib crate name in `use` statements is `ultra_gitlab_lib`.
- Run a single lib test: `cd src-tauri && cargo test --lib <name> -- --nocapture`.
- Run CLI crate tests: `cd src-tauri && cargo test -p ultra-gitlab-cli`.
- Commit after every task with the message shown in the task's final step.

## File structure

**Lib (extracted shared logic) — `src-tauri/src/core/`:**
- `core/mod.rs` — module declarations + `create_client` (GitLab client from instance id) + instance helpers.
- `core/mr_query.rs` — read queries returning domain models: `list_review_mrs`, `list_my_mrs`, `get_detail`, `get_diff_files`.
- `core/mr_actions.rs` — `merge`, `rebase`, `undraft`, `approve`, `unapprove`, `apply_local_approval`, `get_live_diff`.

**Lib edits:** `src-tauri/src/lib.rs` (add `pub mod core;`), `src-tauri/src/commands/mr.rs` and `src-tauri/src/commands/approval.rs` (delegate to `core`).

**CLI crate — `src-tauri/cli/`:**
- `Cargo.toml`
- `src/main.rs` — arg parse, resolve DB path, init pool, run app, restore terminal.
- `src/db_path.rs` — `resolve_db_path` (flag / env / default).
- `src/event.rs` — `AppEvent`, `Action`, async result channel types.
- `src/data.rs` — async wrappers over `ultra_gitlab_lib::core` that produce view models.
- `src/app.rs` — `App` state, `Tab`, `Screen`, `Focus`, event loop, key handling.
- `src/actions.rs` — spawn action tasks (approve/rebase/merge/undraft/auto-merge).
- `src/syntax.rs` — syntect wrapper: highlight a file's lines.
- `src/ui/mod.rs` — top-level `draw`.
- `src/ui/list.rs` — MR list table.
- `src/ui/detail.rs` — header + filetree + diff panes.
- `src/ui/diff.rs` — diff hunks → highlighted ratatui `Text`.
- `src/ui/footer.rs` — status line + key hints.

---

# Phase 0 — Lib `core` module: client + instance helpers

### Task 0.1: Create the `core` module with client + instance helpers

**Files:**
- Create: `src-tauri/src/core/mod.rs`
- Modify: `src-tauri/src/lib.rs:6-10` (module list)

- [ ] **Step 1: Write the failing test**

Create `src-tauri/src/core/mod.rs` with the implementation AND tests in one file:

```rust
//! Backend operations shared between the Tauri commands and the `ultra` CLI.
//!
//! Functions here take `&DbPool` (not Tauri `State`) so they can run in any
//! process. The Tauri command handlers delegate to these; the CLI calls them
//! directly against the same SQLite database.

pub mod mr_actions;
pub mod mr_query;

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::GitLabInstance;
use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig};

/// Build a GitLab API client for the given instance from its stored token.
pub async fn create_client(pool: &DbPool, instance_id: i64) -> Result<GitLabClient, AppError> {
    let instance: Option<GitLabInstance> = sqlx::query_as(
        r#"
        SELECT id, url, name, token, created_at, authenticated_username, session_cookie, is_default
        FROM gitlab_instances
        WHERE id = $1
        "#,
    )
    .bind(instance_id)
    .fetch_optional(pool)
    .await?;

    let instance = instance
        .ok_or_else(|| AppError::not_found_with_id("GitLabInstance", instance_id.to_string()))?;
    let token = instance
        .token
        .ok_or_else(|| AppError::authentication("No token configured for GitLab instance"))?;

    GitLabClient::new(GitLabClientConfig {
        base_url: instance.url,
        token,
        timeout_secs: 30,
    })
}

/// Return the default instance id, falling back to the lowest id if none is
/// explicitly marked default. `None` means no instances are configured.
pub async fn default_instance_id(pool: &DbPool) -> Result<Option<i64>, AppError> {
    let id: Option<i64> = sqlx::query_scalar(
        "SELECT id FROM gitlab_instances ORDER BY is_default DESC, id ASC LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(id)
}

/// Return the authenticated username stored for an instance, if any.
pub async fn authenticated_username(
    pool: &DbPool,
    instance_id: i64,
) -> Result<Option<String>, AppError> {
    let name: Option<String> =
        sqlx::query_scalar("SELECT authenticated_username FROM gitlab_instances WHERE id = ?")
            .bind(instance_id)
            .fetch_optional(pool)
            .await?
            .flatten();
    Ok(name)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::tempdir;

    /// Build a temp DB and insert one default instance. Returns (pool, id).
    pub async fn seed_instance(default: bool) -> (DbPool, i64) {
        let dir = tempdir().unwrap();
        let path = dir.path().join("t.db");
        // Keep the tempdir alive for the test process lifetime.
        std::mem::forget(dir);
        let pool = db::initialize(&path).await.unwrap();
        sqlx::query(
            "INSERT INTO gitlab_instances (url, name, token, created_at, authenticated_username, is_default)
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind("https://gitlab.example.com")
        .bind("test")
        .bind("tok")
        .bind(0i64)
        .bind("me")
        .bind(default as i64)
        .execute(&pool)
        .await
        .unwrap();
        let id: i64 = sqlx::query_scalar("SELECT id FROM gitlab_instances LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        (pool, id)
    }

    #[tokio::test]
    async fn default_instance_id_returns_seeded() {
        let (pool, id) = seed_instance(true).await;
        assert_eq!(default_instance_id(&pool).await.unwrap(), Some(id));
    }

    #[tokio::test]
    async fn default_instance_id_none_when_empty() {
        let dir = tempdir().unwrap();
        let pool = db::initialize(&dir.path().join("t.db")).await.unwrap();
        assert_eq!(default_instance_id(&pool).await.unwrap(), None);
    }

    #[tokio::test]
    async fn authenticated_username_reads_value() {
        let (pool, id) = seed_instance(true).await;
        assert_eq!(
            authenticated_username(&pool, id).await.unwrap(),
            Some("me".to_string())
        );
    }
}
```

This will not compile yet because `core::mr_actions` and `core::mr_query` don't exist. That is expected — the next step adds empty stubs so this task's tests can run. To let Step 2 run in isolation, temporarily comment out the two `pub mod` lines at the top, run the test, then restore them and create the stubs.

- [ ] **Step 2: Register the module and create empty submodule stubs**

Add to `src-tauri/src/lib.rs` after line 7 (`pub mod db;`):

```rust
pub mod core;
```

Create `src-tauri/src/core/mr_query.rs`:

```rust
//! Read queries shared between Tauri commands and the CLI.
```

Create `src-tauri/src/core/mr_actions.rs`:

```rust
//! Mutating MR operations shared between Tauri commands and the CLI.
```

- [ ] **Step 3: Run the tests**

Run: `cd src-tauri && cargo test --lib core::tests`
Expected: 3 tests pass (`default_instance_id_returns_seeded`, `default_instance_id_none_when_empty`, `authenticated_username_reads_value`).

- [ ] **Step 4: Verify the whole lib still builds**

Run: `cd src-tauri && cargo check --lib`
Expected: compiles with no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/core src-tauri/src/lib.rs
git commit -m "feat(core): add core module with client and instance helpers"
```

---

# Phase 1 — Core MR read queries + delegate commands

### Task 1.1: `list_review_mrs` and `list_my_mrs` in core

**Files:**
- Modify: `src-tauri/src/core/mr_query.rs`

- [ ] **Step 1: Write the implementation**

Replace the contents of `src-tauri/src/core/mr_query.rs` with:

```rust
//! Read queries shared between Tauri commands and the CLI.
//!
//! These return domain models (`MergeRequest`, `Diff`, `DiffFile`). The Tauri
//! command layer maps them to camelCase DTOs; the CLI uses them directly.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::{Diff, DiffFile, MergeRequest};

/// Filter for the "review" list (MRs not authored by me).
#[derive(Debug, Default, Clone)]
pub struct ReviewFilter {
    /// `opened` (default), `merged`, `closed`, or `all`.
    pub state: Option<String>,
    /// Substring matched against title and description.
    pub search: Option<String>,
}

const MR_COLUMNS: &str = r#"
    mr.id, mr.instance_id, mr.iid, mr.project_id,
    COALESCE(p.name_with_namespace, mr.project_name) AS project_name,
    mr.title, mr.description,
    mr.author_username, mr.source_branch, mr.target_branch, mr.state,
    mr.web_url, mr.created_at, mr.updated_at, mr.merged_at,
    mr.approval_status, mr.approvals_required, mr.approvals_count,
    mr.labels, mr.reviewers, mr.cached_at, mr.user_has_approved,
    mr.head_pipeline_status, mr.state_changed_at
"#;

/// MRs for review: excludes the authenticated user's own authored MRs and
/// MRs assigned to the user. Mirrors `commands::mr::get_merge_requests`.
pub async fn list_review_mrs(
    pool: &DbPool,
    instance_id: i64,
    filter: ReviewFilter,
) -> Result<Vec<MergeRequest>, AppError> {
    let mut query = format!(
        r#"
        SELECT {MR_COLUMNS}
        FROM merge_requests mr
        LEFT JOIN projects p ON p.id = mr.project_id AND p.instance_id = mr.instance_id
        WHERE mr.instance_id = $1
          AND mr.author_username != COALESCE(
              (SELECT authenticated_username FROM gitlab_instances WHERE id = mr.instance_id),
              ''
          )
          AND mr.assigned_to_me = 0
        "#
    );

    let state = filter.state.unwrap_or_else(|| "opened".to_string());
    let filter_state = state != "all";
    if filter_state {
        query.push_str(" AND mr.state = $2");
    }

    let has_search = filter.search.is_some();
    let search_pattern = filter.search.map(|s| format!("%{}%", s));
    if has_search {
        let param = if filter_state { "$3" } else { "$2" };
        query.push_str(&format!(
            " AND (mr.title LIKE {param} OR mr.description LIKE {param})"
        ));
    }
    query.push_str(" ORDER BY mr.updated_at DESC");

    let rows: Vec<MergeRequest> = match (filter_state, search_pattern.as_ref()) {
        (true, Some(search)) => {
            sqlx::query_as(&query)
                .bind(instance_id)
                .bind(&state)
                .bind(search)
                .fetch_all(pool)
                .await?
        }
        (true, None) => {
            sqlx::query_as(&query)
                .bind(instance_id)
                .bind(&state)
                .fetch_all(pool)
                .await?
        }
        (false, Some(search)) => {
            sqlx::query_as(&query)
                .bind(instance_id)
                .bind(search)
                .fetch_all(pool)
                .await?
        }
        (false, None) => sqlx::query_as(&query).bind(instance_id).fetch_all(pool).await?,
    };
    Ok(rows)
}

/// MRs authored by, or assigned to, the authenticated user. Mirrors
/// `commands::mr::list_my_merge_requests`.
pub async fn list_my_mrs(
    pool: &DbPool,
    instance_id: i64,
    include_recently_merged: bool,
    include_drafts: bool,
) -> Result<Vec<MergeRequest>, AppError> {
    let username: Option<String> =
        sqlx::query_scalar("SELECT authenticated_username FROM gitlab_instances WHERE id = ?")
            .bind(instance_id)
            .fetch_optional(pool)
            .await?
            .flatten();
    let username = username.ok_or_else(|| {
        AppError::not_found("No authenticated username found. Please re-authenticate.")
    })?;

    let draft_clause = if include_drafts {
        ""
    } else {
        " AND mr.title NOT LIKE 'Draft:%' AND mr.title NOT LIKE 'WIP:%'"
    };

    let rows: Vec<MergeRequest> = if include_recently_merged {
        let cutoff = chrono::Utc::now().timestamp() - 86_400;
        sqlx::query_as(&format!(
            r#"
            SELECT {MR_COLUMNS}
            FROM merge_requests mr
            LEFT JOIN projects p ON p.id = mr.project_id AND p.instance_id = mr.instance_id
            WHERE mr.instance_id = ?
              AND (mr.author_username = ? OR mr.assigned_to_me = 1)
              AND (
                  mr.state = 'opened'
                  OR (mr.state = 'merged' AND mr.merged_at IS NOT NULL AND mr.merged_at >= ?)
              ){draft_clause}
            ORDER BY (mr.state = 'opened') DESC, mr.updated_at DESC
            "#
        ))
        .bind(instance_id)
        .bind(&username)
        .bind(cutoff)
        .fetch_all(pool)
        .await?
    } else {
        sqlx::query_as(&format!(
            r#"
            SELECT {MR_COLUMNS}
            FROM merge_requests mr
            LEFT JOIN projects p ON p.id = mr.project_id AND p.instance_id = mr.instance_id
            WHERE mr.instance_id = ? AND mr.state = 'opened'
              AND (mr.author_username = ? OR mr.assigned_to_me = 1){draft_clause}
            ORDER BY mr.updated_at DESC
            "#
        ))
        .bind(instance_id)
        .bind(&username)
        .fetch_all(pool)
        .await?
    };
    Ok(rows)
}

/// Detail bundle for one MR: the row, its diff metadata, changed files, and a
/// count of pending sync-queue actions.
#[derive(Debug)]
pub struct MrDetail {
    pub mr: MergeRequest,
    pub diff: Option<Diff>,
    pub diff_files: Vec<DiffFile>,
    pub pending_actions: i64,
}

/// Load full detail for one MR from cache. Mirrors
/// `commands::mr::get_merge_request_detail`.
pub async fn get_detail(pool: &DbPool, mr_id: i64) -> Result<MrDetail, AppError> {
    let mr: Option<MergeRequest> = sqlx::query_as(&format!(
        r#"
        SELECT {MR_COLUMNS}
        FROM merge_requests mr
        LEFT JOIN projects p ON p.id = mr.project_id AND p.instance_id = mr.instance_id
        WHERE mr.id = $1
        "#
    ))
    .bind(mr_id)
    .fetch_optional(pool)
    .await?;
    let mr = mr.ok_or_else(|| AppError::not_found_with_id("MergeRequest", mr_id.to_string()))?;

    let diff: Option<Diff> = sqlx::query_as(
        "SELECT mr_id, content, base_sha, head_sha, start_sha, file_count, additions, deletions, cached_at
         FROM diffs WHERE mr_id = $1",
    )
    .bind(mr_id)
    .fetch_optional(pool)
    .await?;

    let diff_files = get_diff_files(pool, mr_id).await?;

    let pending_actions: (i64,) = sqlx::query_as(
        "SELECT COUNT(*) FROM sync_queue WHERE mr_id = $1 AND status IN ('pending', 'syncing')",
    )
    .bind(mr_id)
    .fetch_one(pool)
    .await?;

    Ok(MrDetail {
        mr,
        diff,
        diff_files,
        pending_actions: pending_actions.0,
    })
}

/// Changed files for an MR, ordered by position. Mirrors
/// `commands::mr::get_diff_files`.
pub async fn get_diff_files(pool: &DbPool, mr_id: i64) -> Result<Vec<DiffFile>, AppError> {
    let files: Vec<DiffFile> = sqlx::query_as(
        "SELECT id, mr_id, old_path, new_path, change_type, additions, deletions, file_position, diff_content
         FROM diff_files WHERE mr_id = $1 ORDER BY file_position",
    )
    .bind(mr_id)
    .fetch_all(pool)
    .await?;
    Ok(files)
}
```

- [ ] **Step 2: Write the failing tests**

Append to `src-tauri/src/core/mr_query.rs`:

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::db;
    use tempfile::tempdir;

    async fn pool_with_mr(author: &str, assigned: i64, state: &str, title: &str) -> (DbPool, i64) {
        let dir = tempdir().unwrap();
        std::mem::forget(dir.path().to_path_buf());
        let path = std::env::temp_dir().join(format!("ugl-{}-{}.db", author, title.len()));
        let _ = std::fs::remove_file(&path);
        let pool = db::initialize(&path).await.unwrap();
        sqlx::query(
            "INSERT INTO gitlab_instances (url, token, created_at, authenticated_username, is_default)
             VALUES ('u', 't', 0, 'me', 1)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let inst: i64 = sqlx::query_scalar("SELECT id FROM gitlab_instances LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO merge_requests
             (id, instance_id, iid, project_id, project_name, title, author_username,
              source_branch, target_branch, state, web_url, created_at, updated_at,
              labels, reviewers, cached_at, assigned_to_me)
             VALUES (1, ?, 1, 10, 'g/p', ?, ?, 's', 'main', ?, 'http://x', 0, 0, '[]', '[]', 0, ?)",
        )
        .bind(inst)
        .bind(title)
        .bind(author)
        .bind(state)
        .bind(assigned)
        .execute(&pool)
        .await
        .unwrap();
        (pool, inst)
    }

    #[tokio::test]
    async fn review_excludes_my_own_mrs() {
        let (pool, inst) = pool_with_mr("me", 0, "opened", "mine").await;
        let rows = list_review_mrs(&pool, inst, ReviewFilter::default()).await.unwrap();
        assert!(rows.is_empty(), "own MR must not appear in review list");
    }

    #[tokio::test]
    async fn review_includes_others_mrs() {
        let (pool, inst) = pool_with_mr("alice", 0, "opened", "hers").await;
        let rows = list_review_mrs(&pool, inst, ReviewFilter::default()).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].author_username, "alice");
    }

    #[tokio::test]
    async fn mine_includes_my_open_mr() {
        let (pool, inst) = pool_with_mr("me", 0, "opened", "minework").await;
        let rows = list_my_mrs(&pool, inst, false, true).await.unwrap();
        assert_eq!(rows.len(), 1);
    }

    #[tokio::test]
    async fn detail_returns_mr_and_empty_diff() {
        let (pool, _inst) = pool_with_mr("alice", 0, "opened", "detailwork").await;
        let detail = get_detail(&pool, 1).await.unwrap();
        assert_eq!(detail.mr.id, 1);
        assert!(detail.diff.is_none());
        assert!(detail.diff_files.is_empty());
        assert_eq!(detail.pending_actions, 0);
    }
}
```

- [ ] **Step 3: Run the tests**

Run: `cd src-tauri && cargo test --lib core::mr_query`
Expected: 4 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/core/mr_query.rs
git commit -m "feat(core): add MR read queries (review/mine/detail/files)"
```

### Task 1.2: Delegate the read commands to `core`

**Files:**
- Modify: `src-tauri/src/commands/mr.rs:102-199` (`get_merge_requests`), `:214-298` (`list_my_merge_requests`), `:349-429` (`get_merge_request_detail`), `:623-642` (`get_diff_files`)

- [ ] **Step 1: Replace `get_merge_requests` body to delegate**

In `src-tauri/src/commands/mr.rs`, replace the body of `get_merge_requests` (keep the `#[tauri::command]` signature) with:

```rust
#[tauri::command]
pub async fn get_merge_requests(
    pool: State<'_, DbPool>,
    instance_id: i64,
    filter: Option<MergeRequestFilter>,
) -> Result<Vec<MergeRequestListItem>, AppError> {
    let filter = filter.unwrap_or_default();
    let rows = crate::core::mr_query::list_review_mrs(
        pool.inner(),
        instance_id,
        crate::core::mr_query::ReviewFilter {
            state: filter.state,
            search: filter.search,
        },
    )
    .await?;
    Ok(rows.into_iter().map(MergeRequestListItem::from).collect())
}
```

- [ ] **Step 2: Replace `list_my_merge_requests` body to delegate**

```rust
#[tauri::command]
pub async fn list_my_merge_requests(
    pool: State<'_, DbPool>,
    instance_id: i64,
    include_recently_merged: Option<bool>,
    include_drafts: Option<bool>,
) -> Result<Vec<MergeRequestListItem>, AppError> {
    let rows = crate::core::mr_query::list_my_mrs(
        pool.inner(),
        instance_id,
        include_recently_merged.unwrap_or(false),
        include_drafts.unwrap_or(true),
    )
    .await?;
    Ok(rows.into_iter().map(MergeRequestListItem::from).collect())
}
```

- [ ] **Step 3: Replace `get_merge_request_detail` body to delegate**

```rust
#[tauri::command]
pub async fn get_merge_request_detail(
    pool: State<'_, DbPool>,
    mr_id: i64,
) -> Result<MergeRequestDetail, AppError> {
    let detail = crate::core::mr_query::get_detail(pool.inner(), mr_id).await?;
    let diff_summary = detail.diff.map(|d| DiffSummary {
        file_count: d.file_count,
        additions: d.additions,
        deletions: d.deletions,
        files: detail.diff_files.into_iter().map(DiffFileSummary::from).collect(),
    });
    Ok(MergeRequestDetail {
        mr: MergeRequestListItem::from(detail.mr),
        diff_summary,
        pending_actions: detail.pending_actions,
    })
}
```

- [ ] **Step 4: Replace `get_diff_files` body to delegate**

```rust
#[tauri::command]
pub async fn get_diff_files(
    pool: State<'_, DbPool>,
    mr_id: i64,
) -> Result<Vec<DiffFile>, AppError> {
    crate::core::mr_query::get_diff_files(pool.inner(), mr_id).await
}
```

- [ ] **Step 5: Build and run the existing lib tests**

Run: `cd src-tauri && cargo test --lib`
Expected: compiles; all existing tests still pass (the `commands::mr::tests` for diff parsing and `core::mr_query::tests` included).

- [ ] **Step 6: Commit**

```bash
git add src-tauri/src/commands/mr.rs
git commit -m "refactor(commands): delegate MR read commands to core"
```

---

# Phase 2 — Core MR actions

### Task 2.1: `merge`, `rebase`, `undraft` in core + delegate commands

**Files:**
- Modify: `src-tauri/src/core/mr_actions.rs`
- Modify: `src-tauri/src/commands/mr.rs` (`merge_mr`, `rebase_mr`, `undraft_mr` bodies; `strip_draft_prefix`/`get_mr_api_ids` move to core)

- [ ] **Step 1: Implement actions in core**

Replace the contents of `src-tauri/src/core/mr_actions.rs` with:

```rust
//! Mutating MR operations shared between Tauri commands and the CLI.
//!
//! merge/rebase/undraft call the GitLab API directly (not the sync queue) and
//! write an optimistic local update, matching the desktop command handlers.

use crate::core::create_client;
use crate::db::pool::DbPool;
use crate::error::AppError;

/// Look up (instance_id, project_id, iid) for a local MR id.
pub async fn mr_api_ids(pool: &DbPool, mr_id: i64) -> Result<(i64, i64, i64), AppError> {
    sqlx::query_as::<_, (i64, i64, i64)>(
        "SELECT instance_id, project_id, iid FROM merge_requests WHERE id = ?",
    )
    .bind(mr_id)
    .fetch_optional(pool)
    .await?
    .ok_or_else(|| AppError::not_found_with_id("MergeRequest", mr_id.to_string()))
}

/// Strip a leading `Draft:` or `WIP:` prefix from an MR title.
pub fn strip_draft_prefix(title: &str) -> String {
    for prefix in ["Draft:", "WIP:"] {
        if let Some(rest) = title.strip_prefix(prefix) {
            return rest.trim_start().to_string();
        }
    }
    title.to_string()
}

/// Merge an MR via the GitLab API, then mark it merged locally.
pub async fn merge(pool: &DbPool, mr_id: i64) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client.merge_merge_request(project_id, iid).await?;
    let now = chrono::Utc::now().timestamp();
    sqlx::query(
        "UPDATE merge_requests SET state = 'merged', merged_at = ?, state_changed_at = ? WHERE id = ?",
    )
    .bind(now)
    .bind(now)
    .bind(mr_id)
    .execute(pool)
    .await?;
    Ok(())
}

/// Rebase an MR's source branch via the GitLab API (async on GitLab's side).
pub async fn rebase(pool: &DbPool, mr_id: i64) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client.rebase_merge_request(project_id, iid).await
}

/// Mark a draft MR ready by stripping its title prefix. Returns the new title.
/// No-op (no network call) if the title has no draft prefix.
pub async fn undraft(pool: &DbPool, mr_id: i64) -> Result<String, AppError> {
    let title: String = sqlx::query_scalar("SELECT title FROM merge_requests WHERE id = ?")
        .bind(mr_id)
        .fetch_optional(pool)
        .await?
        .ok_or_else(|| AppError::not_found_with_id("MergeRequest", mr_id.to_string()))?;
    let new_title = strip_draft_prefix(&title);
    if new_title == title {
        return Ok(title);
    }
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client.mark_merge_request_ready(project_id, iid, &new_title).await?;
    sqlx::query("UPDATE merge_requests SET title = ? WHERE id = ?")
        .bind(&new_title)
        .bind(mr_id)
        .execute(pool)
        .await?;
    Ok(new_title)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strip_prefix_variants() {
        assert_eq!(strip_draft_prefix("Draft: x"), "x");
        assert_eq!(strip_draft_prefix("WIP: x"), "x");
        assert_eq!(strip_draft_prefix("Draft:x"), "x");
        assert_eq!(strip_draft_prefix("plain"), "plain");
        assert_eq!(strip_draft_prefix("a Draft: b"), "a Draft: b");
    }
}
```

- [ ] **Step 2: Delegate the three commands and remove the now-duplicated helpers**

In `src-tauri/src/commands/mr.rs`:

Replace `merge_mr` body:

```rust
#[tauri::command]
pub async fn merge_mr(pool: State<'_, DbPool>, mr_id: i64) -> Result<(), AppError> {
    crate::core::mr_actions::merge(pool.inner(), mr_id).await
}
```

Replace `rebase_mr` body:

```rust
#[tauri::command]
pub async fn rebase_mr(pool: State<'_, DbPool>, mr_id: i64) -> Result<(), AppError> {
    crate::core::mr_actions::rebase(pool.inner(), mr_id).await
}
```

Replace `undraft_mr` body:

```rust
#[tauri::command]
pub async fn undraft_mr(pool: State<'_, DbPool>, mr_id: i64) -> Result<String, AppError> {
    crate::core::mr_actions::undraft(pool.inner(), mr_id).await
}
```

Then delete the now-unused private helpers in `commands/mr.rs`: `fn strip_draft_prefix` and `fn get_mr_api_ids`, **and** the `test_strip_draft_prefix` test (its replacement lives in `core::mr_actions::tests`). Keep `check_merge_status` working: it used `get_mr_api_ids` — update it to call `crate::core::mr_actions::mr_api_ids(pool.inner(), mr_id)`. Likewise update `get_mr_pipelines` to call `crate::core::mr_actions::mr_api_ids`.

- [ ] **Step 3: Build and test**

Run: `cd src-tauri && cargo test --lib`
Expected: compiles; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/core/mr_actions.rs src-tauri/src/commands/mr.rs
git commit -m "refactor(core): move merge/rebase/undraft to core, delegate commands"
```

### Task 2.2: Shared `apply_local_approval` + core `approve`/`unapprove`

**Files:**
- Modify: `src-tauri/src/core/mr_actions.rs`
- Modify: `src-tauri/src/commands/approval.rs` (use shared optimistic-update helper)

- [ ] **Step 1: Add the optimistic-approval helper and direct-API approve/unapprove to core**

Append to `src-tauri/src/core/mr_actions.rs` (above the `#[cfg(test)]` block):

```rust
/// Apply the optimistic local approval-count update used by both the desktop
/// (queue path) and the CLI (direct path). `approved=true` increments and sets
/// `user_has_approved=1`; `false` decrements (floored at 0) and clears it.
pub async fn apply_local_approval(
    pool: &DbPool,
    mr_id: i64,
    approved: bool,
) -> Result<(), AppError> {
    let sql = if approved {
        r#"
        UPDATE merge_requests
        SET approvals_count = COALESCE(approvals_count, 0) + 1,
            approval_status = CASE
                WHEN COALESCE(approvals_count, 0) + 1 >= COALESCE(approvals_required, 1)
                THEN 'approved' ELSE 'pending' END,
            user_has_approved = 1
        WHERE id = ?
        "#
    } else {
        r#"
        UPDATE merge_requests
        SET approvals_count = MAX(COALESCE(approvals_count, 0) - 1, 0),
            approval_status = CASE
                WHEN MAX(COALESCE(approvals_count, 0) - 1, 0) >= COALESCE(approvals_required, 1)
                THEN 'approved' ELSE 'pending' END,
            user_has_approved = 0
        WHERE id = ?
        "#
    };
    sqlx::query(sql).bind(mr_id).execute(pool).await?;
    Ok(())
}

/// Approve an MR via the GitLab API + optimistic local update (CLI path).
pub async fn approve(pool: &DbPool, mr_id: i64) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client.approve_merge_request(project_id, iid).await?;
    apply_local_approval(pool, mr_id, true).await
}

/// Unapprove an MR via the GitLab API + optimistic local update (CLI path).
pub async fn unapprove(pool: &DbPool, mr_id: i64) -> Result<(), AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    client.unapprove_merge_request(project_id, iid).await?;
    apply_local_approval(pool, mr_id, false).await
}
```

- [ ] **Step 2: De-duplicate the desktop approval command's optimistic SQL**

In `src-tauri/src/commands/approval.rs`, in `approve_mr` replace the inline `sqlx::query(r#"UPDATE merge_requests ... user_has_approved = 1 ...#)` block with:

```rust
    crate::core::mr_actions::apply_local_approval(pool.inner(), mr_id, true).await?;
```

In `unapprove_mr` replace the inline optimistic UPDATE block with:

```rust
    crate::core::mr_actions::apply_local_approval(pool.inner(), mr_id, false).await?;
```

Leave the rest of both functions (payload build, `sync_queue::enqueue_action`, `flush_approvals`) unchanged.

- [ ] **Step 3: Add a core test for the optimistic update**

Append inside `core::mr_actions::tests` in `src-tauri/src/core/mr_actions.rs`:

```rust
    #[tokio::test]
    async fn local_approval_increments_and_decrements() {
        use crate::db;
        use tempfile::tempdir;
        let dir = tempdir().unwrap();
        let pool = db::initialize(&dir.path().join("t.db")).await.unwrap();
        sqlx::query(
            "INSERT INTO merge_requests
             (id, instance_id, iid, project_id, project_name, title, author_username,
              source_branch, target_branch, state, web_url, created_at, updated_at,
              labels, reviewers, cached_at, approvals_required, approvals_count)
             VALUES (1, 1, 1, 1, 'g/p', 't', 'a', 's', 'm', 'opened', 'x', 0, 0, '[]', '[]', 0, 1, 0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        apply_local_approval(&pool, 1, true).await.unwrap();
        let (count, approved): (i64, i64) =
            sqlx::query_as("SELECT approvals_count, user_has_approved FROM merge_requests WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((count, approved), (1, 1));

        apply_local_approval(&pool, 1, false).await.unwrap();
        let (count, approved): (i64, i64) =
            sqlx::query_as("SELECT approvals_count, user_has_approved FROM merge_requests WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((count, approved), (0, 0));
    }
```

- [ ] **Step 4: Build and test**

Run: `cd src-tauri && cargo test --lib`
Expected: compiles; all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/core/mr_actions.rs src-tauri/src/commands/approval.rs
git commit -m "feat(core): add approve/unapprove + shared optimistic-approval helper"
```

### Task 2.3: `get_live_diff` (in-memory live fetch fallback)

**Files:**
- Modify: `src-tauri/src/core/mr_actions.rs`

- [ ] **Step 1: Add the live-diff fetcher**

Append to `src-tauri/src/core/mr_actions.rs` (above the test module):

```rust
/// A changed file fetched live from GitLab (not persisted). Field names match
/// the subset of `models::DiffFile` the CLI's renderer needs.
#[derive(Debug, Clone)]
pub struct LiveDiffFile {
    pub old_path: Option<String>,
    pub new_path: String,
    pub change_type: String,
    pub diff_content: String,
}

/// Fetch an MR's diff live from GitLab and return per-file unified diffs.
/// Used when the local cache has no diff for an MR. Not written back to the DB;
/// the desktop sync engine persists diffs on its own cycle.
pub async fn get_live_diff(pool: &DbPool, mr_id: i64) -> Result<Vec<LiveDiffFile>, AppError> {
    let (instance_id, project_id, iid) = mr_api_ids(pool, mr_id).await?;
    let client = create_client(pool, instance_id).await?;
    let version = client.get_merge_request_diff(project_id, iid).await?;
    Ok(version
        .diffs
        .into_iter()
        .map(|d| LiveDiffFile {
            change_type: if d.new_file {
                "added"
            } else if d.deleted_file {
                "deleted"
            } else if d.renamed_file {
                "renamed"
            } else {
                "modified"
            }
            .to_string(),
            old_path: if d.old_path == d.new_path {
                None
            } else {
                Some(d.old_path)
            },
            new_path: d.new_path,
            diff_content: d.diff,
        })
        .collect())
}
```

- [ ] **Step 2: Build (no new unit test — requires network; covered in manual verification)**

Run: `cd src-tauri && cargo check --lib`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/core/mr_actions.rs
git commit -m "feat(core): add live-diff fetch fallback"
```

---

# Phase 3 — CLI crate scaffold

### Task 3.1: Workspace + CLI crate that opens the shared DB

**Files:**
- Modify: `src-tauri/Cargo.toml` (add `[workspace]`)
- Create: `src-tauri/cli/Cargo.toml`
- Create: `src-tauri/cli/src/db_path.rs`
- Create: `src-tauri/cli/src/main.rs`

- [ ] **Step 1: Make `src-tauri` a workspace root with the cli member**

Add to the **top** of `src-tauri/Cargo.toml` (before `[package]`):

```toml
[workspace]
members = ["cli"]
resolver = "2"
```

(The existing `[package]`, `[lib]`, `[profile.release]`, etc. stay. `src-tauri` is both the workspace root and a member; `cli` is the second member.)

- [ ] **Step 2: Create the CLI crate manifest**

Create `src-tauri/cli/Cargo.toml`:

```toml
[package]
name = "ultra-gitlab-cli"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "ultra"
path = "src/main.rs"

[dependencies]
ultra-gitlab = { path = ".." }
ratatui = "0.29"
crossterm = { version = "0.28", features = ["event-stream"] }
tokio = { version = "1", features = ["rt-multi-thread", "macros", "sync", "time"] }
futures = "0.3"
syntect = "5"
dirs = "5"
chrono = "0.4"
anyhow = "1"
```

- [ ] **Step 3: Implement DB-path resolution**

Create `src-tauri/cli/src/db_path.rs`:

```rust
//! Resolve the SQLite database path the desktop app uses, so the CLI shares it.
//!
//! Order of precedence: `--db <path>` flag, `ULTRA_GITLAB_DB` env var, then the
//! default Tauri app-data location: `<data_dir>/<identifier>/ultra-gitlab.db`.
//! The identifier matches `src-tauri/tauri.conf.json`.

use std::path::PathBuf;

const IDENTIFIER: &str = "com.jens.ultra-gitlab";
const DB_FILE: &str = "ultra-gitlab.db";

/// Resolve the database path from an optional explicit override.
/// `flag` is the value of `--db` if passed on the command line.
pub fn resolve_db_path(flag: Option<String>) -> anyhow::Result<PathBuf> {
    if let Some(p) = flag {
        return Ok(PathBuf::from(p));
    }
    if let Ok(p) = std::env::var("ULTRA_GITLAB_DB") {
        return Ok(PathBuf::from(p));
    }
    let data = dirs::data_dir()
        .ok_or_else(|| anyhow::anyhow!("could not determine OS data directory"))?;
    Ok(data.join(IDENTIFIER).join(DB_FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flag_wins() {
        let p = resolve_db_path(Some("/tmp/x.db".into())).unwrap();
        assert_eq!(p, PathBuf::from("/tmp/x.db"));
    }

    #[test]
    fn default_ends_with_identifier_and_file() {
        let p = resolve_db_path(None).unwrap();
        assert!(p.ends_with(format!("{IDENTIFIER}/{DB_FILE}")));
    }
}
```

- [ ] **Step 4: Minimal main that connects and prints a summary**

Create `src-tauri/cli/src/main.rs`:

```rust
//! `ultra` — terminal UI for Ultra GitLab.

mod db_path;

use anyhow::Context;
use ultra_gitlab_lib::core;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Crude flag parse: support `--db <path>` only for now.
    let mut args = std::env::args().skip(1);
    let mut db_flag = None;
    while let Some(a) = args.next() {
        if a == "--db" {
            db_flag = args.next();
        }
    }

    let path = db_path::resolve_db_path(db_flag)?;
    if !path.exists() {
        anyhow::bail!(
            "Database not found at {}.\nRun the Ultra GitLab desktop app and sign in first.",
            path.display()
        );
    }
    let pool = ultra_gitlab_lib::db::initialize(&path)
        .await
        .with_context(|| format!("opening database at {}", path.display()))?;

    let instance_id = core::default_instance_id(&pool)
        .await?
        .context("No GitLab instance configured. Sign in via the desktop app first.")?;
    let user = core::authenticated_username(&pool, instance_id).await?;

    println!(
        "Connected to {} as {} (instance {})",
        path.display(),
        user.as_deref().unwrap_or("<unknown>"),
        instance_id
    );
    Ok(())
}
```

- [ ] **Step 5: Build and test the crate**

Run: `cd src-tauri && cargo test -p ultra-gitlab-cli`
Expected: `db_path` tests pass; crate builds.

- [ ] **Step 6: Verify the desktop bin still builds under the new workspace**

Run: `cd src-tauri && cargo check --bin ultra-gitlab`
Expected: compiles with no errors.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/cli/Cargo.toml src-tauri/cli/src/db_path.rs src-tauri/cli/src/main.rs
git commit -m "feat(cli): scaffold ultra CLI crate that opens the shared DB"
```

---

# Phase 4 — App state, view models, event loop skeleton

### Task 4.1: View models + data layer

**Files:**
- Create: `src-tauri/cli/src/data.rs`

- [ ] **Step 1: Implement view models and async loaders**

Create `src-tauri/cli/src/data.rs`:

```rust
//! View models and async loaders that adapt `ultra_gitlab_lib::core` results
//! for the TUI.

use ultra_gitlab_lib::core::mr_actions;
use ultra_gitlab_lib::core::mr_query::{self, ReviewFilter};
use ultra_gitlab_lib::db::pool::DbPool;
use ultra_gitlab_lib::error::AppError;
use ultra_gitlab_lib::models::{DiffFile, MergeRequest};

/// A row in either list view.
#[derive(Debug, Clone)]
pub struct MrRow {
    pub id: i64,
    pub iid: i64,
    pub project_name: String,
    pub title: String,
    pub author: String,
    pub source_branch: String,
    pub state: String,
    pub approvals_count: i64,
    pub approvals_required: i64,
    pub pipeline: Option<String>,
    pub is_draft: bool,
    pub user_has_approved: bool,
}

impl From<MergeRequest> for MrRow {
    fn from(m: MergeRequest) -> Self {
        let is_draft = m.title.starts_with("Draft:") || m.title.starts_with("WIP:");
        MrRow {
            id: m.id,
            iid: m.iid,
            project_name: m.project_name,
            title: m.title,
            author: m.author_username,
            source_branch: m.source_branch,
            state: m.state,
            approvals_count: m.approvals_count.unwrap_or(0),
            approvals_required: m.approvals_required.unwrap_or(0),
            pipeline: m.head_pipeline_status,
            is_draft,
            user_has_approved: m.user_has_approved,
        }
    }
}

/// A changed file plus its raw unified-diff text, from cache or live fetch.
#[derive(Debug, Clone)]
pub struct FileDiff {
    pub new_path: String,
    pub change_type: String,
    pub additions: i64,
    pub deletions: i64,
    pub diff_content: String,
}

impl From<DiffFile> for FileDiff {
    fn from(f: DiffFile) -> Self {
        FileDiff {
            new_path: f.new_path,
            change_type: f.change_type,
            additions: f.additions,
            deletions: f.deletions,
            diff_content: f.diff_content.unwrap_or_default(),
        }
    }
}

impl From<mr_actions::LiveDiffFile> for FileDiff {
    fn from(f: mr_actions::LiveDiffFile) -> Self {
        FileDiff {
            new_path: f.new_path,
            change_type: f.change_type,
            additions: 0,
            deletions: 0,
            diff_content: f.diff_content,
        }
    }
}

/// Full detail payload for the detail screen.
#[derive(Debug, Clone)]
pub struct DetailData {
    pub row: MrRow,
    pub files: Vec<FileDiff>,
    /// True when the diff was fetched live (cache miss).
    pub live: bool,
}

pub async fn load_review(pool: &DbPool, instance_id: i64) -> Result<Vec<MrRow>, AppError> {
    let rows = mr_query::list_review_mrs(pool, instance_id, ReviewFilter::default()).await?;
    Ok(rows.into_iter().map(MrRow::from).collect())
}

pub async fn load_mine(pool: &DbPool, instance_id: i64) -> Result<Vec<MrRow>, AppError> {
    let rows = mr_query::list_my_mrs(pool, instance_id, true, true).await?;
    Ok(rows.into_iter().map(MrRow::from).collect())
}

pub async fn load_detail(pool: &DbPool, mr_id: i64) -> Result<DetailData, AppError> {
    let detail = mr_query::get_detail(pool, mr_id).await?;
    let row = MrRow::from(detail.mr);
    if detail.diff_files.is_empty() {
        // Cache miss — fetch live, in-memory only.
        let live = mr_actions::get_live_diff(pool, mr_id).await?;
        Ok(DetailData {
            row,
            files: live.into_iter().map(FileDiff::from).collect(),
            live: true,
        })
    } else {
        Ok(DetailData {
            row,
            files: detail.diff_files.into_iter().map(FileDiff::from).collect(),
            live: false,
        })
    }
}
```

- [ ] **Step 2: Build**

Run: `cd src-tauri && cargo check -p ultra-gitlab-cli`
Expected: compiles.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/cli/src/data.rs
git commit -m "feat(cli): add view models and async data loaders"
```

### Task 4.2: Events, App state, and the event loop (tabs + quit)

**Files:**
- Create: `src-tauri/cli/src/event.rs`
- Create: `src-tauri/cli/src/app.rs`
- Create: `src-tauri/cli/src/ui/mod.rs`
- Create: `src-tauri/cli/src/ui/footer.rs`
- Modify: `src-tauri/cli/src/main.rs` (wire terminal + run loop)

- [ ] **Step 1: Define events and async results**

Create `src-tauri/cli/src/event.rs`:

```rust
//! Async results delivered to the UI loop over an mpsc channel.

use crate::data::{DetailData, MrRow};

/// A message produced by a background task and consumed by the event loop.
#[derive(Debug)]
pub enum AppEvent {
    Review(Result<Vec<MrRow>, String>),
    Mine(Result<Vec<MrRow>, String>),
    Detail(Result<DetailData, String>),
    /// (verb, result) for an action like "merge", "approve".
    ActionDone(String, Result<String, String>),
}
```

- [ ] **Step 2: Define App state + tabs/screens**

Create `src-tauri/cli/src/app.rs`:

```rust
//! Application state and the main event loop.

use crate::data;
use crate::event::AppEvent;
use crate::ui;
use crossterm::event::{Event, EventStream, KeyCode, KeyEventKind};
use futures::StreamExt;
use ratatui::widgets::ListState;
use ratatui::DefaultTerminal;
use std::sync::Arc;
use tokio::sync::mpsc;
use ultra_gitlab_lib::db::pool::DbPool;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Review,
    Mine,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Screen {
    List,
    Detail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Focus {
    Tree,
    Diff,
}

pub struct App {
    pub pool: Arc<DbPool>,
    pub instance_id: i64,
    pub username: Option<String>,

    pub tab: Tab,
    pub screen: Screen,
    pub focus: Focus,

    pub review: Vec<data::MrRow>,
    pub mine: Vec<data::MrRow>,
    pub list_state: ListState,

    pub detail: Option<data::DetailData>,
    pub file_state: ListState,
    pub diff_scroll: u16,

    pub status: String,
    pub busy: bool,
    pub should_quit: bool,
    pub confirm: Option<Confirm>,

    pub tx: mpsc::UnboundedSender<AppEvent>,
}

/// A pending y/n confirmation for a destructive action.
#[derive(Debug, Clone)]
pub struct Confirm {
    pub verb: String,
    pub mr_id: i64,
    pub prompt: String,
}

impl App {
    pub fn new(
        pool: Arc<DbPool>,
        instance_id: i64,
        username: Option<String>,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Self {
        let mut list_state = ListState::default();
        list_state.select(Some(0));
        App {
            pool,
            instance_id,
            username,
            tab: Tab::Review,
            screen: Screen::List,
            focus: Focus::Tree,
            review: Vec::new(),
            mine: Vec::new(),
            list_state,
            detail: None,
            file_state: ListState::default(),
            diff_scroll: 0,
            status: "Loading…".into(),
            busy: true,
            should_quit: false,
            confirm: None,
            tx,
        }
    }

    /// Rows for the active tab.
    pub fn rows(&self) -> &[data::MrRow] {
        match self.tab {
            Tab::Review => &self.review,
            Tab::Mine => &self.mine,
        }
    }

    /// Spawn the initial list loads for both tabs.
    pub fn load_lists(&mut self) {
        self.busy = true;
        self.status = "Loading…".into();
        spawn_review(self);
        spawn_mine(self);
    }
}

fn spawn_review(app: &App) {
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_review(&pool, inst).await.map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::Review(r));
    });
}

fn spawn_mine(app: &App) {
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_mine(&pool, inst).await.map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::Mine(r));
    });
}

/// Run the event loop until the user quits.
pub async fn run(
    mut terminal: DefaultTerminal,
    mut app: App,
    mut rx: mpsc::UnboundedReceiver<AppEvent>,
) -> anyhow::Result<()> {
    let mut keys = EventStream::new();
    app.load_lists();
    terminal.draw(|f| ui::draw(f, &mut app))?;

    loop {
        tokio::select! {
            maybe_key = keys.next() => {
                if let Some(Ok(Event::Key(key))) = maybe_key {
                    if key.kind == KeyEventKind::Press {
                        handle_key(&mut app, key.code);
                    }
                }
            }
            Some(ev) = rx.recv() => {
                handle_event(&mut app, ev);
            }
        }
        if app.should_quit {
            break;
        }
        terminal.draw(|f| ui::draw(f, &mut app))?;
    }
    Ok(())
}

fn handle_event(app: &mut App, ev: AppEvent) {
    match ev {
        AppEvent::Review(Ok(rows)) => {
            app.review = rows;
            app.busy = false;
            app.status = "Ready".into();
        }
        AppEvent::Mine(Ok(rows)) => {
            app.mine = rows;
            app.busy = false;
            app.status = "Ready".into();
        }
        AppEvent::Detail(Ok(d)) => {
            app.busy = false;
            app.status = if d.live { "Loaded diff (live)".into() } else { "Ready".into() };
            app.file_state.select(Some(0));
            app.diff_scroll = 0;
            app.detail = Some(d);
        }
        AppEvent::ActionDone(verb, Ok(msg)) => {
            app.busy = false;
            app.status = format!("{verb}: {msg}");
            app.load_lists();
        }
        AppEvent::Review(Err(e))
        | AppEvent::Mine(Err(e))
        | AppEvent::Detail(Err(e)) => {
            app.busy = false;
            app.status = format!("Error: {e}");
        }
        AppEvent::ActionDone(verb, Err(e)) => {
            app.busy = false;
            app.status = format!("{verb} failed: {e}");
        }
    }
}

fn handle_key(app: &mut App, code: KeyCode) {
    // Confirmation prompt intercepts keys first.
    if let Some(confirm) = app.confirm.clone() {
        match code {
            KeyCode::Char('y') | KeyCode::Char('Y') => {
                app.confirm = None;
                crate::actions::dispatch(app, &confirm.verb, confirm.mr_id);
            }
            _ => {
                app.confirm = None;
                app.status = "Cancelled".into();
            }
        }
        return;
    }

    match app.screen {
        Screen::List => handle_list_key(app, code),
        Screen::Detail => handle_detail_key(app, code),
    }
}

fn handle_list_key(app: &mut App, code: KeyCode) {
    match code {
        KeyCode::Char('q') => app.should_quit = true,
        KeyCode::Tab | KeyCode::Char('1') if matches!(code, KeyCode::Tab) => toggle_tab(app),
        KeyCode::Char('1') => {
            app.tab = Tab::Review;
            app.list_state.select(Some(0));
        }
        KeyCode::Char('2') => {
            app.tab = Tab::Mine;
            app.list_state.select(Some(0));
        }
        KeyCode::Char('j') | KeyCode::Down => move_selection(app, 1),
        KeyCode::Char('k') | KeyCode::Up => move_selection(app, -1),
        KeyCode::Char('r') => app.load_lists(),
        KeyCode::Enter => open_detail(app),
        _ => {}
    }
}

fn handle_detail_key(app: &mut App, code: KeyCode) {
    match code {
        KeyCode::Esc | KeyCode::Char('q') => {
            app.screen = Screen::List;
            app.detail = None;
        }
        KeyCode::Tab => {
            app.focus = match app.focus {
                Focus::Tree => Focus::Diff,
                Focus::Diff => Focus::Tree,
            };
        }
        KeyCode::Char('j') | KeyCode::Down => match app.focus {
            Focus::Tree => move_file(app, 1),
            Focus::Diff => app.diff_scroll = app.diff_scroll.saturating_add(1),
        },
        KeyCode::Char('k') | KeyCode::Up => match app.focus {
            Focus::Tree => move_file(app, -1),
            Focus::Diff => app.diff_scroll = app.diff_scroll.saturating_sub(1),
        },
        // Actions handled in Task 8.
        other => crate::actions::handle_action_key(app, other),
    }
}

fn toggle_tab(app: &mut App) {
    app.tab = match app.tab {
        Tab::Review => Tab::Mine,
        Tab::Mine => Tab::Review,
    };
    app.list_state.select(Some(0));
}

fn move_selection(app: &mut App, delta: i32) {
    let len = app.rows().len();
    if len == 0 {
        return;
    }
    let cur = app.list_state.selected().unwrap_or(0) as i32;
    let next = (cur + delta).clamp(0, len as i32 - 1) as usize;
    app.list_state.select(Some(next));
}

fn move_file(app: &mut App, delta: i32) {
    let Some(d) = &app.detail else { return };
    let len = d.files.len();
    if len == 0 {
        return;
    }
    let cur = app.file_state.selected().unwrap_or(0) as i32;
    let next = (cur + delta).clamp(0, len as i32 - 1) as usize;
    app.file_state.select(Some(next));
    app.diff_scroll = 0;
}

fn open_detail(app: &mut App) {
    let Some(sel) = app.list_state.selected() else { return };
    let Some(row) = app.rows().get(sel) else { return };
    let mr_id = row.id;
    app.screen = Screen::Detail;
    app.focus = Focus::Tree;
    app.detail = None;
    app.busy = true;
    app.status = "Loading diff…".into();
    let pool = app.pool.clone();
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_detail(&pool, mr_id).await.map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::Detail(r));
    });
}
```

Note: the `KeyCode::Tab | KeyCode::Char('1') if ...` arm above is awkward; simplify by deleting that arm and keeping the explicit `KeyCode::Tab => toggle_tab(app),` arm. Use this corrected `handle_list_key`:

```rust
fn handle_list_key(app: &mut App, code: KeyCode) {
    match code {
        KeyCode::Char('q') => app.should_quit = true,
        KeyCode::Tab => toggle_tab(app),
        KeyCode::Char('1') => {
            app.tab = Tab::Review;
            app.list_state.select(Some(0));
        }
        KeyCode::Char('2') => {
            app.tab = Tab::Mine;
            app.list_state.select(Some(0));
        }
        KeyCode::Char('j') | KeyCode::Down => move_selection(app, 1),
        KeyCode::Char('k') | KeyCode::Up => move_selection(app, -1),
        KeyCode::Char('r') => app.load_lists(),
        KeyCode::Enter => open_detail(app),
        _ => {}
    }
}
```

- [ ] **Step 2: Create a placeholder `actions` module so `app.rs` compiles**

Create `src-tauri/cli/src/actions.rs`:

```rust
//! Action dispatch (approve / rebase / merge / undraft / auto-merge).
//! Fleshed out in Phase 8; placeholders keep the event loop compiling.

use crate::app::App;
use crossterm::event::KeyCode;

/// Handle an action key on the detail screen. No-op until Phase 8.
pub fn handle_action_key(_app: &mut App, _code: KeyCode) {}

/// Run a confirmed action. No-op until Phase 8.
pub fn dispatch(_app: &mut App, _verb: &str, _mr_id: i64) {}
```

- [ ] **Step 3: Create the top-level UI draw + footer (lists rendered in Phase 5)**

Create `src-tauri/cli/src/ui/footer.rs`:

```rust
//! Bottom status/hint bar.

use crate::app::{App, Screen};
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

pub fn render(f: &mut Frame, app: &App, area: Rect) {
    let hints = match app.screen {
        Screen::List => "1/2 tabs · j/k move · enter open · r refresh · q quit",
        Screen::Detail => {
            "tab focus · j/k scroll · a approve · R rebase · M merge · U undraft · A auto-merge · esc back"
        }
    };
    let spinner = if app.busy { "⏳ " } else { "" };
    let line = format!(" {spinner}{}  |  {hints}", app.status);
    f.render_widget(
        Paragraph::new(line).style(Style::default().fg(Color::Gray)),
        area,
    );
}
```

Create `src-tauri/cli/src/ui/mod.rs`:

```rust
//! Top-level rendering: tab bar, body, footer.

pub mod footer;

use crate::app::{App, Screen, Tab};
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Frame;

pub fn draw(f: &mut Frame, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(0), Constraint::Length(1)])
        .split(f.area());

    render_tabs(f, app, chunks[0]);

    match app.screen {
        // Lists and detail bodies are added in Phases 5 and 7. For now show a
        // placeholder so the skeleton runs.
        Screen::List => {
            let n = app.rows().len();
            let p = Paragraph::new(format!("{} merge requests (list view: Phase 5)", n))
                .block(Block::default().borders(Borders::ALL));
            f.render_widget(p, chunks[1]);
        }
        Screen::Detail => {
            let p = Paragraph::new("detail view: Phase 7")
                .block(Block::default().borders(Borders::ALL));
            f.render_widget(p, chunks[1]);
        }
    }

    footer::render(f, app, chunks[2]);
}

fn render_tabs(f: &mut Frame, app: &App, area: ratatui::layout::Rect) {
    let sel = Style::default().fg(Color::Black).bg(Color::Cyan).add_modifier(Modifier::BOLD);
    let unsel = Style::default().fg(Color::Cyan);
    let span = |label, active| {
        Span::styled(format!(" {label} "), if active { sel } else { unsel })
    };
    let line = Line::from(vec![
        span("1 Review", app.tab == Tab::Review),
        Span::raw(" "),
        span("2 Mine", app.tab == Tab::Mine),
    ]);
    f.render_widget(Paragraph::new(line), area);
}
```

- [ ] **Step 4: Wire up the terminal in `main.rs`**

Replace `src-tauri/cli/src/main.rs` with:

```rust
//! `ultra` — terminal UI for Ultra GitLab.

mod actions;
mod app;
mod data;
mod db_path;
mod event;
mod ui;

use anyhow::Context;
use std::sync::Arc;
use tokio::sync::mpsc;
use ultra_gitlab_lib::core;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let mut db_flag = None;
    while let Some(a) = args.next() {
        if a == "--db" {
            db_flag = args.next();
        }
    }

    let path = db_path::resolve_db_path(db_flag)?;
    if !path.exists() {
        anyhow::bail!(
            "Database not found at {}.\nRun the Ultra GitLab desktop app and sign in first.",
            path.display()
        );
    }
    let pool = ultra_gitlab_lib::db::initialize(&path)
        .await
        .with_context(|| format!("opening database at {}", path.display()))?;
    let instance_id = core::default_instance_id(&pool)
        .await?
        .context("No GitLab instance configured. Sign in via the desktop app first.")?;
    let username = core::authenticated_username(&pool, instance_id).await?;

    let (tx, rx) = mpsc::unbounded_channel();
    let app = app::App::new(Arc::new(pool), instance_id, username, tx);

    let terminal = ratatui::init();
    let result = app::run(terminal, app, rx).await;
    ratatui::restore();
    result
}
```

- [ ] **Step 5: Build**

Run: `cd src-tauri && cargo check -p ultra-gitlab-cli`
Expected: compiles (warnings about unused fields are fine).

- [ ] **Step 6: Manual smoke test**

Run: `cd src-tauri && cargo run -p ultra-gitlab-cli`
Expected: a TUI opens with a tab bar (1 Review / 2 Mine), a placeholder body showing a merge-request count, and a footer. `1`/`2`/`Tab` switch tabs; `q` quits and the terminal is restored cleanly.
(If no desktop DB exists yet, it exits with the "Database not found" message — that is correct.)

- [ ] **Step 7: Commit**

```bash
git add src-tauri/cli/src/event.rs src-tauri/cli/src/app.rs src-tauri/cli/src/actions.rs src-tauri/cli/src/ui src-tauri/cli/src/main.rs
git commit -m "feat(cli): app state, event loop, tab skeleton"
```

---

# Phase 5 — List views

### Task 5.1: Render the MR list table

**Files:**
- Create: `src-tauri/cli/src/ui/list.rs`
- Modify: `src-tauri/cli/src/ui/mod.rs` (call into `list::render`)

- [ ] **Step 1: Implement the list renderer**

Create `src-tauri/cli/src/ui/list.rs`:

```rust
//! MR list table for the active tab.

use crate::app::{App, Tab};
use crate::data::MrRow;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem};
use ratatui::Frame;

fn pipeline_glyph(status: Option<&str>) -> Span<'static> {
    let (sym, color) = match status {
        Some("success") => ("●", Color::Green),
        Some("failed") => ("●", Color::Red),
        Some("running") => ("●", Color::Yellow),
        Some(_) => ("●", Color::DarkGray),
        None => ("·", Color::DarkGray),
    };
    Span::styled(sym, Style::default().fg(color))
}

fn approval_span(row: &MrRow) -> Span<'static> {
    let txt = format!("{}/{}", row.approvals_count, row.approvals_required.max(0));
    let color = if row.approvals_count >= row.approvals_required && row.approvals_required > 0 {
        Color::Green
    } else {
        Color::DarkGray
    };
    Span::styled(txt, Style::default().fg(color))
}

fn row_line(row: &MrRow, mine: bool) -> Line<'static> {
    let mut spans = vec![
        pipeline_glyph(row.pipeline.as_deref()),
        Span::raw(" "),
        approval_span(row),
        Span::raw("  "),
        Span::styled(
            format!("{:<28}", truncate(&row.project_name, 28)),
            Style::default().fg(Color::Blue),
        ),
        Span::raw(" "),
        Span::raw(truncate(&row.title, 60)),
    ];
    if mine && row.is_draft {
        spans.push(Span::styled(" [draft]", Style::default().fg(Color::Yellow)));
    }
    if !mine {
        spans.push(Span::styled(
            format!("  @{}", row.author),
            Style::default().fg(Color::DarkGray),
        ));
    }
    Line::from(spans)
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}

pub fn render(f: &mut Frame, app: &mut App, area: Rect) {
    let mine = app.tab == Tab::Mine;
    let title = if mine { " Mine " } else { " Review " };
    let rows = app.rows();
    if rows.is_empty() {
        let msg = if app.busy {
            "Loading…"
        } else {
            "No merge requests. Press r to refresh (desktop app keeps the cache fresh)."
        };
        let block = Block::default().borders(Borders::ALL).title(title);
        f.render_widget(ratatui::widgets::Paragraph::new(msg).block(block), area);
        return;
    }
    let items: Vec<ListItem> = rows.iter().map(|r| ListItem::new(row_line(r, mine))).collect();
    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(title))
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, area, &mut app.list_state);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(title: &str) -> MrRow {
        MrRow {
            id: 1,
            iid: 1,
            project_name: "group/project".into(),
            title: title.into(),
            author: "alice".into(),
            source_branch: "feat".into(),
            state: "opened".into(),
            approvals_count: 1,
            approvals_required: 2,
            pipeline: Some("success".into()),
            is_draft: false,
            user_has_approved: false,
        }
    }

    #[test]
    fn truncate_adds_ellipsis() {
        assert_eq!(truncate("abcdef", 4), "abc…");
        assert_eq!(truncate("abc", 4), "abc");
    }

    #[test]
    fn row_line_contains_title() {
        let line = row_line(&row("Fix the bug"), false);
        let text: String = line.spans.iter().map(|s| s.content.as_ref()).collect();
        assert!(text.contains("Fix the bug"));
        assert!(text.contains("@alice"));
    }
}
```

- [ ] **Step 2: Call the list renderer from `ui::mod`**

In `src-tauri/cli/src/ui/mod.rs`, add `pub mod list;` near `pub mod footer;`, and replace the `Screen::List => { ... }` placeholder arm with:

```rust
        Screen::List => list::render(f, app, chunks[1]),
```

- [ ] **Step 3: Build and test**

Run: `cd src-tauri && cargo test -p ultra-gitlab-cli`
Expected: `list::tests` pass; crate compiles.

- [ ] **Step 4: Manual check**

Run: `cd src-tauri && cargo run -p ultra-gitlab-cli`
Expected: both tabs show real MR rows from the cache (pipeline dot, approvals, project, title; `@author` on Review, `[draft]` on Mine). `j`/`k` move the highlight; `Enter` switches to the (still placeholder) detail screen and back with `Esc`.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/cli/src/ui/list.rs src-tauri/cli/src/ui/mod.rs
git commit -m "feat(cli): render MR list tables for both tabs"
```

---

# Phase 6 — Syntax highlighting + diff rendering

### Task 6.1: syntect wrapper

**Files:**
- Create: `src-tauri/cli/src/syntax.rs`
- Modify: `src-tauri/cli/src/main.rs` (add `mod syntax;`)

- [ ] **Step 1: Implement the highlighter**

Create `src-tauri/cli/src/syntax.rs`:

```rust
//! Thin syntect wrapper: turn a file's lines into per-line styled segments.

use ratatui::style::Color;
use syntect::easy::HighlightLines;
use syntect::highlighting::{Style as SynStyle, ThemeSet};
use syntect::parsing::SyntaxSet;
use syntect::util::LinesWithEndings;

/// A piece of text with a foreground color.
#[derive(Debug, Clone)]
pub struct Segment {
    pub text: String,
    pub color: Color,
}

pub struct Highlighter {
    syntaxes: SyntaxSet,
    themes: ThemeSet,
}

impl Highlighter {
    pub fn new() -> Self {
        Highlighter {
            syntaxes: SyntaxSet::load_defaults_newlines(),
            themes: ThemeSet::load_defaults(),
        }
    }

    /// Highlight whole source text, returning one Vec<Segment> per line.
    /// `path` selects the syntax by file extension; unknown → plain text.
    pub fn highlight(&self, path: &str, source: &str) -> Vec<Vec<Segment>> {
        let theme = &self.themes.themes["base16-eighties.dark"];
        let ext = path.rsplit('.').next().unwrap_or("");
        let syntax = self
            .syntaxes
            .find_syntax_by_extension(ext)
            .unwrap_or_else(|| self.syntaxes.find_syntax_plain_text());
        let mut hl = HighlightLines::new(syntax, theme);

        let mut out = Vec::new();
        for line in LinesWithEndings::from(source) {
            let ranges: Vec<(SynStyle, &str)> =
                hl.highlight_line(line, &self.syntaxes).unwrap_or_default();
            let segs = ranges
                .into_iter()
                .map(|(style, text)| Segment {
                    text: text.trim_end_matches('\n').to_string(),
                    color: Color::Rgb(style.foreground.r, style.foreground.g, style.foreground.b),
                })
                .collect();
            out.push(segs);
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn highlights_rust_into_lines() {
        let hl = Highlighter::new();
        let lines = hl.highlight("main.rs", "fn main() {}\nlet x = 1;\n");
        assert_eq!(lines.len(), 2);
        assert!(!lines[0].is_empty());
    }

    #[test]
    fn unknown_extension_is_plain() {
        let hl = Highlighter::new();
        let lines = hl.highlight("notes.unknownext", "hello world\n");
        assert_eq!(lines.len(), 1);
        let text: String = lines[0].iter().map(|s| s.text.as_str()).collect();
        assert_eq!(text, "hello world");
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/cli/src/main.rs`, add `mod syntax;` to the module list.

- [ ] **Step 3: Build and test**

Run: `cd src-tauri && cargo test -p ultra-gitlab-cli syntax`
Expected: both syntax tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/cli/src/syntax.rs src-tauri/cli/src/main.rs
git commit -m "feat(cli): add syntect highlighter wrapper"
```

### Task 6.2: Diff → highlighted ratatui Text

**Files:**
- Create: `src-tauri/cli/src/ui/diff.rs`
- Modify: `src-tauri/cli/src/ui/mod.rs` (`pub mod diff;`)

- [ ] **Step 1: Implement diff rendering**

This reuses the lib's existing unified-diff parser (`ultra_gitlab_lib::commands::mr::parse_unified_diff_public`) and layers syntect foreground colors with a per-line diff background tint.

Create `src-tauri/cli/src/ui/diff.rs`:

```rust
//! Render a single file's unified diff as syntax-highlighted ratatui Text.

use crate::syntax::Highlighter;
use ratatui::style::{Color, Style};
use ratatui::text::{Line, Span};
use ratatui::text::Text;
use ultra_gitlab_lib::commands::mr::parse_unified_diff_public;

const ADD_BG: Color = Color::Rgb(20, 48, 28);
const DEL_BG: Color = Color::Rgb(56, 24, 24);
const GUTTER: Color = Color::DarkGray;

/// Build highlighted, scrollable Text for a file's unified diff.
/// `path` selects the syntax; `diff_content` is the raw unified diff.
pub fn render_diff<'a>(hl: &Highlighter, path: &str, diff_content: &str) -> Text<'a> {
    let hunks = parse_unified_diff_public(diff_content);

    // Highlight the assembled visible source (context + added lines) so syntect
    // keeps multi-line state; removed lines are highlighted as their own text.
    // For simplicity we highlight each line's content independently against the
    // file syntax — adequate for v1 and avoids tracking two file sides.
    let mut lines: Vec<Line> = Vec::new();
    for hunk in &hunks {
        lines.push(Line::from(Span::styled(
            format!("@@ -{},{} +{},{} @@", hunk.old_start, hunk.old_count, hunk.new_start, hunk.new_count),
            Style::default().fg(Color::Cyan),
        )));
        for dl in &hunk.lines {
            let (bg, sign, old_n, new_n) = match dl.line_type.as_str() {
                "add" => (Some(ADD_BG), "+", None, dl.new_line_number),
                "remove" => (Some(DEL_BG), "-", dl.old_line_number, None),
                _ => (None, " ", dl.old_line_number, dl.new_line_number),
            };
            let gutter = format!(
                "{:>4} {:>4} ",
                old_n.map(|n| n.to_string()).unwrap_or_default(),
                new_n.map(|n| n.to_string()).unwrap_or_default(),
            );
            let mut spans = vec![
                Span::styled(gutter, Style::default().fg(GUTTER)),
                Span::styled(sign.to_string(), line_style(bg)),
            ];
            for seg in hl.highlight(path, &dl.content).into_iter().next().unwrap_or_default() {
                let mut style = Style::default().fg(seg.color);
                if let Some(bg) = bg {
                    style = style.bg(bg);
                }
                spans.push(Span::styled(seg.text, style));
            }
            lines.push(Line::from(spans));
        }
        lines.push(Line::from(""));
    }
    if lines.is_empty() {
        lines.push(Line::from(Span::styled(
            "(no textual diff — binary or empty)",
            Style::default().fg(Color::DarkGray),
        )));
    }
    Text::from(lines)
}

fn line_style(bg: Option<Color>) -> Style {
    let mut s = Style::default();
    if let Some(bg) = bg {
        s = s.bg(bg);
    }
    s
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_hunk_lines() {
        let hl = Highlighter::new();
        let diff = "@@ -1,2 +1,2 @@\n context\n-old\n+new\n";
        let text = render_diff(&hl, "x.rs", diff);
        // hunk header + 3 body lines + trailing blank
        assert!(text.lines.len() >= 4);
    }

    #[test]
    fn empty_diff_shows_placeholder() {
        let hl = Highlighter::new();
        let text = render_diff(&hl, "x.bin", "");
        let s: String = text.lines[0].spans.iter().map(|sp| sp.content.as_ref()).collect();
        assert!(s.contains("no textual diff"));
    }
}
```

- [ ] **Step 2: Register the module**

In `src-tauri/cli/src/ui/mod.rs` add `pub mod diff;` near the other `pub mod` lines.

- [ ] **Step 3: Build and test**

Run: `cd src-tauri && cargo test -p ultra-gitlab-cli diff`
Expected: both diff tests pass.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/cli/src/ui/diff.rs src-tauri/cli/src/ui/mod.rs
git commit -m "feat(cli): render syntax-highlighted unified diffs"
```

---

# Phase 7 — Detail view

### Task 7.1: Header + filetree + diff panes

**Files:**
- Create: `src-tauri/cli/src/ui/detail.rs`
- Modify: `src-tauri/cli/src/ui/mod.rs` (call `detail::render`; own a `Highlighter`)
- Modify: `src-tauri/cli/src/app.rs` (hold a `Highlighter` on `App`)

- [ ] **Step 1: Give `App` a highlighter**

In `src-tauri/cli/src/app.rs`:
- Add `use crate::syntax::Highlighter;` to the imports.
- Add a field to `App`: `pub highlighter: Highlighter,`
- In `App::new`, initialize it: `highlighter: Highlighter::new(),` (add to the struct literal).

- [ ] **Step 2: Implement the detail renderer**

Create `src-tauri/cli/src/ui/detail.rs`:

```rust
//! Detail screen: MR header on top, file tree (left) + diff (right) below.

use crate::app::{App, Focus};
use crate::ui::diff;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph, Wrap};
use ratatui::Frame;

pub fn render(f: &mut Frame, app: &mut App, area: Rect) {
    let Some(detail) = app.detail.clone() else {
        f.render_widget(
            Paragraph::new("Loading diff…").block(Block::default().borders(Borders::ALL)),
            area,
        );
        return;
    };

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(4), Constraint::Min(0)])
        .split(area);

    render_header(f, &detail, rows[0]);

    let panes = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(32), Constraint::Percentage(68)])
        .split(rows[1]);

    render_tree(f, app, &detail, panes[0]);
    render_diff(f, app, &detail, panes[1]);
}

fn render_header(f: &mut Frame, detail: &crate::data::DetailData, area: Rect) {
    let r = &detail.row;
    let title = Line::from(vec![
        Span::styled(format!("!{} ", r.iid), Style::default().fg(Color::DarkGray)),
        Span::styled(r.title.clone(), Style::default().add_modifier(Modifier::BOLD)),
    ]);
    let meta = Line::from(vec![
        Span::styled(r.project_name.clone(), Style::default().fg(Color::Blue)),
        Span::raw("  "),
        Span::styled(format!("{} → {}", r.source_branch, "…"), Style::default().fg(Color::DarkGray)),
        Span::raw("  "),
        Span::raw(format!("approvals {}/{}", r.approvals_count, r.approvals_required.max(0))),
        Span::raw("  "),
        Span::raw(format!("pipeline {}", r.pipeline.clone().unwrap_or_else(|| "-".into()))),
    ]);
    let block = Block::default().borders(Borders::ALL);
    f.render_widget(Paragraph::new(vec![title, meta]).block(block).wrap(Wrap { trim: true }), area);
}

fn render_tree(f: &mut Frame, app: &mut App, detail: &crate::data::DetailData, area: Rect) {
    let items: Vec<ListItem> = detail
        .files
        .iter()
        .map(|file| {
            let sym = match file.change_type.as_str() {
                "added" => Span::styled("A ", Style::default().fg(Color::Green)),
                "deleted" => Span::styled("D ", Style::default().fg(Color::Red)),
                "renamed" => Span::styled("R ", Style::default().fg(Color::Yellow)),
                _ => Span::styled("M ", Style::default().fg(Color::Cyan)),
            };
            ListItem::new(Line::from(vec![sym, Span::raw(file.new_path.clone())]))
        })
        .collect();
    let focused = app.focus == Focus::Tree;
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Files ")
        .border_style(border_style(focused));
    let list = List::new(items)
        .block(block)
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, area, &mut app.file_state);
}

fn render_diff(f: &mut Frame, app: &App, detail: &crate::data::DetailData, area: Rect) {
    let focused = app.focus == Focus::Diff;
    let sel = app.file_state.selected().unwrap_or(0);
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Diff ")
        .border_style(border_style(focused));

    let Some(file) = detail.files.get(sel) else {
        f.render_widget(Paragraph::new("No file selected").block(block), area);
        return;
    };
    let text = diff::render_diff(&app.highlighter, &file.new_path, &file.diff_content);
    f.render_widget(
        Paragraph::new(text).block(block).scroll((app.diff_scroll, 0)),
        area,
    );
}

fn border_style(focused: bool) -> Style {
    if focused {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    }
}
```

- [ ] **Step 3: Wire detail into `ui::mod`**

In `src-tauri/cli/src/ui/mod.rs`:
- Add `pub mod detail;`.
- Replace the `Screen::Detail => { ... }` placeholder arm with `Screen::Detail => detail::render(f, app, chunks[1]),`.

- [ ] **Step 4: Build**

Run: `cd src-tauri && cargo check -p ultra-gitlab-cli`
Expected: compiles.

- [ ] **Step 5: Manual check**

Run: `cd src-tauri && cargo run -p ultra-gitlab-cli`
Expected: pressing `Enter` on an MR shows a header, a file list on the left, and a syntax-highlighted diff on the right. `Tab` toggles the cyan focus border; with focus on Files, `j`/`k` change file and reset diff scroll; with focus on Diff, `j`/`k` scroll the diff. MRs not yet opened in the desktop still show a diff (status shows "Loaded diff (live)").

- [ ] **Step 6: Commit**

```bash
git add src-tauri/cli/src/ui/detail.rs src-tauri/cli/src/ui/mod.rs src-tauri/cli/src/app.rs
git commit -m "feat(cli): detail screen with filetree and diff panes"
```

---

# Phase 8 — Actions

### Task 8.1: Action dispatch + confirmation

**Files:**
- Modify: `src-tauri/cli/src/actions.rs` (real implementation)

- [ ] **Step 1: Implement action keys and dispatch**

Replace `src-tauri/cli/src/actions.rs` with:

```rust
//! Action dispatch on the detail screen.
//!
//! Review tab: `a` approve / unapprove (toggles on the row's current state).
//! Mine tab:   `R` rebase, `M` merge (confirmed), `U` undraft, `A` auto-merge.
//! All actions run as background tasks; results arrive via AppEvent::ActionDone.

use crate::app::{App, Confirm, Tab};
use crate::event::AppEvent;
use crossterm::event::KeyCode;
use std::sync::Arc;
use ultra_gitlab_lib::core::mr_actions;
use ultra_gitlab_lib::db::auto_merge;
use ultra_gitlab_lib::db::pool::DbPool;

/// Current MR id on the detail screen, if any.
fn current_mr(app: &App) -> Option<i64> {
    app.detail.as_ref().map(|d| d.row.id)
}

pub fn handle_action_key(app: &mut App, code: KeyCode) {
    let Some(mr_id) = current_mr(app) else { return };
    match (app.tab, code) {
        (Tab::Review, KeyCode::Char('a')) => {
            let approved = app.detail.as_ref().map(|d| d.row.user_has_approved).unwrap_or(false);
            dispatch(app, if approved { "unapprove" } else { "approve" }, mr_id);
        }
        (Tab::Mine, KeyCode::Char('R')) => dispatch(app, "rebase", mr_id),
        (Tab::Mine, KeyCode::Char('U')) => dispatch(app, "undraft", mr_id),
        (Tab::Mine, KeyCode::Char('A')) => dispatch(app, "auto-merge", mr_id),
        (Tab::Mine, KeyCode::Char('M')) => {
            app.confirm = Some(Confirm {
                verb: "merge".into(),
                mr_id,
                prompt: "Merge this MR now? (y/N)".into(),
            });
            app.status = "Merge this MR now? Press y to confirm.".into();
        }
        _ => {}
    }
}

/// Spawn the background task for a confirmed/triggered action.
pub fn dispatch(app: &mut App, verb: &str, mr_id: i64) {
    app.busy = true;
    app.status = format!("{verb}…");
    let pool = app.pool.clone();
    let tx = app.tx.clone();
    let verb = verb.to_string();
    tokio::spawn(async move {
        let result = run(&pool, &verb, mr_id).await;
        let _ = tx.send(AppEvent::ActionDone(verb, result));
    });
}

async fn run(pool: &Arc<DbPool>, verb: &str, mr_id: i64) -> Result<String, String> {
    let pool = pool.as_ref();
    match verb {
        "approve" => mr_actions::approve(pool, mr_id).await.map(|_| "approved".into()),
        "unapprove" => mr_actions::unapprove(pool, mr_id).await.map(|_| "unapproved".into()),
        "rebase" => mr_actions::rebase(pool, mr_id).await.map(|_| "rebase requested".into()),
        "merge" => mr_actions::merge(pool, mr_id).await.map(|_| "merged".into()),
        "undraft" => mr_actions::undraft(pool, mr_id).await.map(|t| format!("ready: {t}")),
        "auto-merge" => {
            let now = chrono::Utc::now().timestamp();
            auto_merge::upsert_claim(pool, mr_id, now)
                .await
                .map(|_| "auto-merge claimed (desktop will process)".into())
                .map_err(|e| e.to_string())
        }
        other => Err(format!("unknown action {other}")),
    }
    .map_err(|e| e.to_string())
}
```

Note: `auto_merge::upsert_claim` returns `Result<(), sqlx::Error>`, so its `.map_err(|e| e.to_string())` is applied inside the arm; the trailing `.map_err` on the outer `match` covers the `AppError` arms. Because the two error types differ, write the auto-merge arm to fully resolve to `Result<String, String>` itself (as shown) and ensure the outer `.map_err` only sees `AppError`. If the compiler complains about mismatched arms, convert each arm explicitly to `Result<String, String>` and drop the outer `.map_err`. Concretely, the compiler-safe form is:

```rust
async fn run(pool: &Arc<DbPool>, verb: &str, mr_id: i64) -> Result<String, String> {
    let pool = pool.as_ref();
    match verb {
        "approve" => mr_actions::approve(pool, mr_id).await.map(|_| "approved".to_string()).map_err(|e| e.to_string()),
        "unapprove" => mr_actions::unapprove(pool, mr_id).await.map(|_| "unapproved".to_string()).map_err(|e| e.to_string()),
        "rebase" => mr_actions::rebase(pool, mr_id).await.map(|_| "rebase requested".to_string()).map_err(|e| e.to_string()),
        "merge" => mr_actions::merge(pool, mr_id).await.map(|_| "merged".to_string()).map_err(|e| e.to_string()),
        "undraft" => mr_actions::undraft(pool, mr_id).await.map(|t| format!("ready: {t}")).map_err(|e| e.to_string()),
        "auto-merge" => {
            let now = chrono::Utc::now().timestamp();
            auto_merge::upsert_claim(pool, mr_id, now).await
                .map(|_| "auto-merge claimed (desktop will process)".to_string())
                .map_err(|e| e.to_string())
        }
        other => Err(format!("unknown action {other}")),
    }
}
```

Use this second form.

- [ ] **Step 2: Show the confirmation prompt in the footer**

In `src-tauri/cli/src/ui/footer.rs`, at the start of `render`, prefer the confirm prompt when present. Replace the `let line = ...` construction with:

```rust
    let line = if let Some(confirm) = &app.confirm {
        format!(" {}", confirm.prompt)
    } else {
        let spinner = if app.busy { "⏳ " } else { "" };
        format!(" {spinner}{}  |  {hints}", app.status)
    };
```

(Keep the `hints` binding above it; it is unused when a confirm is showing, which is fine — silence the warning by prefixing `let _hints` only if the compiler warns; otherwise leave as-is.)

- [ ] **Step 3: Build**

Run: `cd src-tauri && cargo check -p ultra-gitlab-cli`
Expected: compiles.

- [ ] **Step 4: Build the whole workspace and run all tests**

Run: `cd src-tauri && cargo test`
Expected: lib tests + CLI tests all pass; desktop bin still compiles.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/cli/src/actions.rs src-tauri/cli/src/ui/footer.rs
git commit -m "feat(cli): wire MR actions (approve/rebase/merge/undraft/auto-merge)"
```

---

# Phase 9 — End-to-end verification

### Task 9.1: Manual verification against real credentials

**Files:** none (verification only)

- [ ] **Step 1: Ensure the desktop app has synced**

Launch the desktop app (`bun run tauri dev` from the repo root) and let the sync engine populate the cache (sign in if needed using `credentials.md`). Leave it running so it remains the sync authority.

- [ ] **Step 2: Run the CLI against the real shared DB**

Run: `cd src-tauri && cargo run -p ultra-gitlab-cli`
Expected: connects to the real database; Review and Mine tabs list real MRs.

- [ ] **Step 3: Verify read flows**

- Switch tabs with `1`/`2`/`Tab`.
- Open several MRs with `Enter`; confirm the header, file tree, and syntax-highlighted diffs render. Open an MR you have NOT opened in the desktop to exercise the live-diff path (footer shows "Loaded diff (live)").
- Scroll the diff and switch files; `Esc` returns to the list.

- [ ] **Step 4: Verify actions (use a safe throwaway MR)**

On the Mine tab detail of a disposable MR:
- `U` undraft → footer shows "ready: <title>"; confirm in the desktop app the draft prefix is gone after its next sync.
- `R` rebase → footer shows "rebase requested".
- `A` auto-merge → footer shows the claim message; confirm the desktop processes the claim.
- `M` then `y` merge → footer shows "merged"; verify in GitLab + desktop.
On a Review-tab MR: `a` toggles approve/unapprove; verify the approval count updates and the desktop reflects it after sync.

- [ ] **Step 5: Verify cross-process safety**

With the desktop app running and syncing, exercise CLI reads/actions repeatedly. Expected: no "database is locked" errors (WAL + busy-timeout handles concurrency). If any appear, note them — they would indicate a need to widen the busy-timeout.

- [ ] **Step 6: Document usage**

Create/append `src-tauri/cli/README.md` with build/run instructions:

```markdown
# ultra — Ultra GitLab terminal UI

Reuses the desktop app's backend and shares its SQLite database.

## Run
Keep the desktop app running (it keeps the cache fresh), then:

    cd src-tauri && cargo run -p ultra-gitlab-cli

Override the database location with `--db <path>` or `ULTRA_GITLAB_DB`.

## Keys
- Lists: `1`/`2`/`Tab` switch tabs · `j`/`k` move · `enter` open · `r` refresh · `q` quit
- Detail: `tab` focus · `j`/`k` scroll/file · `esc` back
- Review detail: `a` approve/unapprove
- Mine detail: `R` rebase · `M` merge (confirm `y`) · `U` undraft · `A` auto-merge
```

- [ ] **Step 7: Commit**

```bash
git add src-tauri/cli/README.md
git commit -m "docs(cli): add ultra CLI usage README"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** MRList (Review tab, Task 5.1) ✓; MRDetail filetree+diffs (Tasks 7.1, 6.2) ✓; MyMrList (Mine tab, Task 5.1) ✓; MyMrDetail actions rebase/merge/undraft/auto-merge (Task 8.1) ✓; approve on Review (Task 8.1) ✓; shared backend + shared DB (Phases 0–3) ✓; syntax-highlighted diffs (Phase 6) ✓; single default instance (`core::default_instance_id`) ✓; DB-path resolution with override (Task 3.1) ✓; live-diff fallback (Task 2.3, in-memory per the planning refinement) ✓.
- **Out of scope (per spec):** comments/discussions, pipeline drill-down, multi-instance picker — not implemented.
- **Type consistency:** action verbs are the exact strings `approve`/`unapprove`/`rebase`/`merge`/`undraft`/`auto-merge` in both `handle_action_key` and `run`. `MrRow`, `FileDiff`, `DetailData` are defined once in `data.rs` and used consistently. `core` function names (`list_review_mrs`, `list_my_mrs`, `get_detail`, `get_diff_files`, `merge`, `rebase`, `undraft`, `approve`, `unapprove`, `apply_local_approval`, `get_live_diff`, `mr_api_ids`, `create_client`, `default_instance_id`, `authenticated_username`) match across the plan.
```
