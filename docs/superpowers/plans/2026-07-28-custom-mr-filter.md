# Custom MR Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user define one custom MR query per GitLab instance (draft/author/labels knobs) that syncs as a fourth scope, so MRs they aren't an explicit reviewer on appear in the Review list. ([Issue #28](https://github.com/Jensderond/ultra-gitlab/issues/28), spec: `docs/superpowers/specs/2026-07-28-custom-mr-filter-design.md`)

**Architecture:** A `custom_mr_filters` SQLite table (one row per instance) feeds a fourth concurrent fetch in `sync_engine.rs::fetch_mrs_for_instance`, merged via the existing `merge_unique` dedup. Downstream (full MR sync, Review list query, soft-purge) is untouched. Three new Tauri commands expose get/set/test; a new Settings rail section provides the form with a live match count.

**Tech Stack:** Rust (Tauri 2, sqlx/SQLite, tokio), React 19 + TypeScript, Playwright e2e with a Tauri invoke mock.

## Global Constraints

- Package manager is **bun**: `bunx tsc --noEmit` for typecheck; Rust checks via `cargo test` / `cargo check` run inside `src-tauri/`.
- GitLab API response structs: snake_case serde; Tauri command DTOs and models exposed to the frontend: `#[serde(rename_all = "camelCase")]`; frontend types camelCase.
- The custom filter's query always has `state=opened`, `scope=all` (fixed, not user-configurable).
- `author_username` / `not_author_username` are single values (GitLab global `/merge_requests` endpoint limitation). `labels` is comma-separated (GitLab AND-semantics).
- Sync must **fail open**: a broken custom filter logs, sets `complete = false`, and never blocks the three built-in scopes.
- Settings UI follows existing conventions: `SettingsGroup`/`SettingsRow` components, quiet active states, no gradients/accent bars, no opacity-dimming.
- Commit after every task with a conventional-commit message.

---

### Task 1: Migration, model, and db module

**Files:**
- Create: `src-tauri/src/db/migrations/0026_custom_mr_filters.sql`
- Create: `src-tauri/src/models/custom_mr_filter.rs`
- Create: `src-tauri/src/db/custom_filter.rs`
- Modify: `src-tauri/src/db/mod.rs` (MIGRATIONS array + `pub mod custom_filter;`)
- Modify: `src-tauri/src/models/mod.rs` (module + re-export)
- Test: inline `#[cfg(test)]` module in `src-tauri/src/db/custom_filter.rs`

**Interfaces:**
- Consumes: existing `crate::db::initialize` (temp-DB test pattern), `gitlab_instances` table.
- Produces: `CustomMrFilter` model (fields below) re-exported from `crate::models`; `crate::db::custom_filter::{get_custom_filter, upsert_custom_filter}` with signatures:
  - `pub async fn get_custom_filter(pool: &sqlx::SqlitePool, instance_id: i64) -> Result<Option<CustomMrFilter>, sqlx::Error>`
  - `pub async fn upsert_custom_filter(pool: &sqlx::SqlitePool, filter: &CustomMrFilter) -> Result<(), sqlx::Error>`

- [ ] **Step 1: Create the migration file**

`src-tauri/src/db/migrations/0026_custom_mr_filters.sql`:

```sql
-- Custom MR filter: one user-defined sync scope per instance (issue #28)
CREATE TABLE IF NOT EXISTS custom_mr_filters (
    instance_id         INTEGER PRIMARY KEY
                        REFERENCES gitlab_instances(id) ON DELETE CASCADE,
    enabled             INTEGER NOT NULL DEFAULT 0,
    draft               TEXT,     -- 'yes' | 'no' | NULL = any
    author_username     TEXT,     -- include only MRs by this author
    not_author_username TEXT,     -- exclude MRs by this author
    labels              TEXT,     -- comma-separated; GitLab AND-semantics
    updated_at          INTEGER NOT NULL
);
```

Register it in `src-tauri/src/db/mod.rs` by appending to the `MIGRATIONS` const (after the `0025_mr_snoozes` entry):

```rust
    (
        "0026_custom_mr_filters",
        include_str!("migrations/0026_custom_mr_filters.sql"),
    ),
```

- [ ] **Step 2: Create the model**

`src-tauri/src/models/custom_mr_filter.rs`:

```rust
//! Custom MR filter model (issue #28).

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Per-instance user-defined MR sync filter. When enabled, sync fetches a
/// fourth scope (state=opened, scope=all) narrowed by these optional params,
/// in addition to the authored/reviewing/assigned scopes.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CustomMrFilter {
    pub instance_id: i64,
    /// Whether the filter participates in sync.
    pub enabled: bool,
    /// GitLab `wip` param: "yes" (only drafts), "no" (exclude drafts), None = any.
    pub draft: Option<String>,
    /// Only MRs authored by this username.
    pub author_username: Option<String>,
    /// Exclude MRs authored by this username.
    pub not_author_username: Option<String>,
    /// Comma-separated label names (GitLab AND-semantics).
    pub labels: Option<String>,
    pub updated_at: i64,
}
```

In `src-tauri/src/models/mod.rs`, add `pub mod custom_mr_filter;` and `pub use custom_mr_filter::CustomMrFilter;` following the pattern of the `notification_settings` lines already there.

- [ ] **Step 3: Write the failing db tests**

Create `src-tauri/src/db/custom_filter.rs` with ONLY the test module first (so the test fails to compile against missing functions — that's the failing state for this step; sqlx query correctness is what the tests actually verify):

```rust
//! Database queries for the per-instance custom MR filter (issue #28).

use crate::models::CustomMrFilter;

#[cfg(test)]
mod tests {
    use super::*;

    /// Temp DB with one gitlab instance; returns (dir, pool, instance_id).
    async fn pool_with_instance() -> (tempfile::TempDir, crate::db::pool::DbPool, i64) {
        let dir = tempfile::tempdir().unwrap();
        let pool = crate::db::initialize(&dir.path().join("t.db")).await.unwrap();
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
        (dir, pool, inst)
    }

    fn sample_filter(instance_id: i64) -> CustomMrFilter {
        CustomMrFilter {
            instance_id,
            enabled: true,
            draft: Some("no".to_string()),
            author_username: None,
            not_author_username: Some("renovate-bot".to_string()),
            labels: Some("magento".to_string()),
            updated_at: 123,
        }
    }

    #[tokio::test]
    async fn get_returns_none_when_never_configured() {
        let (_dir, pool, inst) = pool_with_instance().await;
        let got = get_custom_filter(&pool, inst).await.unwrap();
        assert!(got.is_none());
    }

    #[tokio::test]
    async fn upsert_then_get_roundtrips() {
        let (_dir, pool, inst) = pool_with_instance().await;
        upsert_custom_filter(&pool, &sample_filter(inst)).await.unwrap();
        let got = get_custom_filter(&pool, inst).await.unwrap().unwrap();
        assert!(got.enabled);
        assert_eq!(got.draft.as_deref(), Some("no"));
        assert_eq!(got.not_author_username.as_deref(), Some("renovate-bot"));
        assert_eq!(got.labels.as_deref(), Some("magento"));
        assert_eq!(got.updated_at, 123);
    }

    #[tokio::test]
    async fn upsert_twice_updates_in_place() {
        let (_dir, pool, inst) = pool_with_instance().await;
        upsert_custom_filter(&pool, &sample_filter(inst)).await.unwrap();
        let mut second = sample_filter(inst);
        second.enabled = false;
        second.labels = None;
        second.updated_at = 456;
        upsert_custom_filter(&pool, &second).await.unwrap();

        let got = get_custom_filter(&pool, inst).await.unwrap().unwrap();
        assert!(!got.enabled);
        assert_eq!(got.labels, None);
        assert_eq!(got.updated_at, 456);

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM custom_mr_filters")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1, "upsert must not create a second row");
    }
}
```

Register the module in `src-tauri/src/db/mod.rs`: add `pub mod custom_filter;` to the alphabetized `pub mod` list (after `auto_run`, before `file_cache`).

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd src-tauri && cargo test custom_filter`
Expected: compile error — `get_custom_filter` / `upsert_custom_filter` not found.

- [ ] **Step 5: Implement the db functions**

Add above the test module in `src-tauri/src/db/custom_filter.rs`:

```rust
/// Get the custom filter for an instance (None when never configured).
pub async fn get_custom_filter(
    pool: &sqlx::SqlitePool,
    instance_id: i64,
) -> Result<Option<CustomMrFilter>, sqlx::Error> {
    sqlx::query_as::<_, CustomMrFilter>(
        "SELECT instance_id, enabled, draft, author_username, not_author_username, labels, updated_at
         FROM custom_mr_filters WHERE instance_id = ?",
    )
    .bind(instance_id)
    .fetch_optional(pool)
    .await
}

/// Insert or update the custom filter for `filter.instance_id`.
pub async fn upsert_custom_filter(
    pool: &sqlx::SqlitePool,
    filter: &CustomMrFilter,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        r#"
        INSERT INTO custom_mr_filters
            (instance_id, enabled, draft, author_username, not_author_username, labels, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(instance_id) DO UPDATE SET
            enabled = excluded.enabled,
            draft = excluded.draft,
            author_username = excluded.author_username,
            not_author_username = excluded.not_author_username,
            labels = excluded.labels,
            updated_at = excluded.updated_at
        "#,
    )
    .bind(filter.instance_id)
    .bind(filter.enabled)
    .bind(&filter.draft)
    .bind(&filter.author_username)
    .bind(&filter.not_author_username)
    .bind(&filter.labels)
    .bind(filter.updated_at)
    .execute(pool)
    .await?;
    Ok(())
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd src-tauri && cargo test custom_filter`
Expected: 3 tests PASS. Also run `cargo test db::` to confirm no migration regression.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/db/migrations/0026_custom_mr_filters.sql src-tauri/src/db/mod.rs src-tauri/src/db/custom_filter.rs src-tauri/src/models/custom_mr_filter.rs src-tauri/src/models/mod.rs
git commit -m "feat(custom-filter): add custom_mr_filters table, model, and db module"
```

---

### Task 2: `labels` query param + `MergeRequestsQuery::from_custom_filter`

**Files:**
- Modify: `src-tauri/src/services/gitlab_client.rs` (the `MergeRequestsQuery` struct ends around line 125; add field + impl + tests)
- Test: new `#[cfg(test)] mod custom_filter_query_tests` at the bottom of `gitlab_client.rs` (append after any existing test module)

**Interfaces:**
- Consumes: `crate::models::CustomMrFilter` from Task 1.
- Produces: `MergeRequestsQuery.labels: Option<String>` (serialized as `labels`); `impl MergeRequestsQuery { pub fn from_custom_filter(filter: &CustomMrFilter) -> Self }`.

- [ ] **Step 1: Write the failing tests**

Append to `src-tauri/src/services/gitlab_client.rs`:

```rust
#[cfg(test)]
mod custom_filter_query_tests {
    use super::*;
    use crate::models::CustomMrFilter;

    fn filter() -> CustomMrFilter {
        CustomMrFilter {
            instance_id: 1,
            enabled: true,
            draft: Some("no".to_string()),
            author_username: None,
            not_author_username: Some("renovate-bot".to_string()),
            labels: Some("magento,backend".to_string()),
            updated_at: 0,
        }
    }

    #[test]
    fn from_custom_filter_maps_all_knobs() {
        let q = MergeRequestsQuery::from_custom_filter(&filter());
        assert_eq!(q.state.as_deref(), Some("opened"), "state is fixed to opened");
        assert_eq!(q.scope.as_deref(), Some("all"), "scope is fixed to all");
        assert_eq!(q.per_page, Some(100));
        assert_eq!(q.draft.as_deref(), Some("no"));
        assert_eq!(q.author_username, None);
        assert_eq!(q.not_author_username.as_deref(), Some("renovate-bot"));
        assert_eq!(q.labels.as_deref(), Some("magento,backend"));
        assert_eq!(q.reviewer_username, None, "custom scope must not be reviewer-bound");
    }

    #[test]
    fn from_custom_filter_omits_unset_knobs() {
        let mut f = filter();
        f.draft = None;
        f.not_author_username = None;
        f.labels = None;
        let q = MergeRequestsQuery::from_custom_filter(&f);
        assert_eq!(q.draft, None);
        assert_eq!(q.not_author_username, None);
        assert_eq!(q.labels, None);
    }

    #[test]
    fn labels_param_serializes_without_rename() {
        let q = MergeRequestsQuery {
            labels: Some("magento".to_string()),
            ..Default::default()
        };
        let json = serde_json::to_string(&q).unwrap();
        assert!(json.contains("\"labels\":\"magento\""), "got: {json}");
    }
}
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src-tauri && cargo test custom_filter_query`
Expected: compile error — no field `labels`, no function `from_custom_filter`.

- [ ] **Step 3: Implement**

Add to the `MergeRequestsQuery` struct (after `not_approved_by_usernames`):

```rust
    /// Filter by labels (comma-separated names, AND-semantics).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub labels: Option<String>,
```

Add directly below the struct definition:

```rust
impl MergeRequestsQuery {
    /// Query for the user-defined custom filter scope (issue #28): all open
    /// MRs visible on the instance, narrowed by the filter's optional params.
    pub fn from_custom_filter(filter: &crate::models::CustomMrFilter) -> Self {
        MergeRequestsQuery {
            state: Some("opened".to_string()),
            scope: Some("all".to_string()),
            per_page: Some(100),
            draft: filter.draft.clone(),
            author_username: filter.author_username.clone(),
            not_author_username: filter.not_author_username.clone(),
            labels: filter.labels.clone(),
            ..Default::default()
        }
    }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd src-tauri && cargo test custom_filter_query`
Expected: 3 tests PASS. Then `cargo check` for the whole crate (the new struct field uses `..Default::default()` everywhere else, so no other call sites need edits — `cargo check` proves it).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/gitlab_client.rs
git commit -m "feat(custom-filter): labels param and from_custom_filter query builder"
```

---

### Task 3: Fourth sync scope in the sync engine

**Files:**
- Modify: `src-tauri/src/services/sync_engine.rs`:
  - `fetch_mrs_for_instance` (~line 1105): new `instance_id: i64` parameter, load filter, fetch fourth scope
  - its single caller (~line 858): pass `instance.id`

**Interfaces:**
- Consumes: `crate::db::custom_filter::get_custom_filter` (Task 1), `MergeRequestsQuery::from_custom_filter` (Task 2).
- Produces: no new public API — behavior change only. Custom-scope MRs flow through the existing `FetchedMrs { mrs, complete }` return value.

- [ ] **Step 1: Add the parameter and load the filter**

Change the signature:

```rust
    async fn fetch_mrs_for_instance(
        &self,
        client: &GitLabClient,
        config: &SyncConfig,
        username: &str,
        instance_id: i64,
    ) -> Result<FetchedMrs, AppError> {
```

Immediately after the three existing query definitions (`authored_query`, `reviewing_query`, `assigned_query`) add:

```rust
        // Fourth, user-defined scope (issue #28): all open MRs matching the
        // instance's custom filter. Fail-open on DB errors — a broken filter
        // must never block the reviewer-based sync.
        let custom_filter = crate::db::custom_filter::get_custom_filter(&self.pool, instance_id)
            .await
            .unwrap_or_else(|e| {
                eprintln!("[sync] failed to load custom filter (skipping): {}", e);
                None
            })
            .filter(|f| f.enabled);
        let custom_query = custom_filter
            .as_ref()
            .map(crate::services::gitlab_client::MergeRequestsQuery::from_custom_filter);
```

(If `MergeRequestsQuery` is already imported at the top of `sync_engine.rs` — it is, the three existing queries use it unqualified — write `.map(MergeRequestsQuery::from_custom_filter)` instead.)

- [ ] **Step 2: Fetch it concurrently and merge**

Replace the existing `tokio::join!` + result loop:

```rust
        // All scopes are independent — fetch them concurrently. The custom
        // scope is optional; when disabled its future resolves to None.
        let custom_fetch = async {
            match custom_query.as_ref() {
                Some(q) => Some(client.list_merge_requests(q).await),
                None => None,
            }
        };
        let (authored, reviewing, assigned, custom) = tokio::join!(
            client.list_merge_requests(&authored_query),
            client.list_merge_requests(&reviewing_query),
            client.list_merge_requests(&assigned_query),
            custom_fetch,
        );

        let mut scope_results = vec![
            ("authored", authored),
            ("reviewing", reviewing),
            ("assigned", assigned),
        ];
        if let Some(result) = custom {
            scope_results.push(("custom-filter", result));
        }

        for (scope, result) in scope_results {
            match result {
                Ok(response) => {
                    eprintln!(
                        "[sync] Received {} {} MRs from GitLab",
                        response.data.len(),
                        scope
                    );
                    merge_unique(&mut all_mrs, response.data);
                }
                // Auth failures must propagate so the caller can prompt re-auth.
                Err(e) if e.is_authentication_expired() => return Err(e),
                Err(e) => {
                    complete = false;
                    eprintln!("[sync] {} MR fetch failed (continuing): {}", scope, e);
                }
            }
        }
```

Keep the existing `eprintln!` announcing the fetch and the `max_mrs_per_sync` truncation block below unchanged.

- [ ] **Step 3: Update the caller**

At the call site (~line 858), add the new argument:

```rust
            self.fetch_mrs_for_instance(
                &client,
                &config,
                current_username.as_deref().unwrap_or("unknown"),
                instance.id,
            ),
```

- [ ] **Step 4: Verify**

Run: `cd src-tauri && cargo test`
Expected: full test suite PASSES (the purge tests around `test_incomplete_fetch_does_not_soft_purge` are the regression guard for the `complete` semantics this change extends). Then `cargo clippy -- -D warnings` if clippy is part of the repo workflow; otherwise `cargo check`.

Note: there is no HTTP-mock test infrastructure in this crate, so the fourth fetch is covered by the query-builder unit tests (Task 2) plus the type system; do NOT add a new HTTP mocking dev-dependency for this.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/services/sync_engine.rs
git commit -m "feat(custom-filter): sync custom filter as fourth concurrent scope"
```

---

### Task 4: Tauri commands (get / set / test)

**Files:**
- Create: `src-tauri/src/commands/custom_filter.rs`
- Modify: `src-tauri/src/commands/mr.rs` (~line 690: `async fn create_gitlab_client` → `pub(crate) async fn`)
- Modify: `src-tauri/src/commands/mod.rs` (module + re-exports)
- Modify: `src-tauri/src/lib.rs` (import + three `generate_handler!` entries)

**Interfaces:**
- Consumes: `db::custom_filter` (Task 1), `MergeRequestsQuery::from_custom_filter` (Task 2), `commands::mr::create_gitlab_client(pool: &State<'_, DbPool>, instance_id: i64) -> Result<GitLabClient, AppError>` (existing, made `pub(crate)` here).
- Produces: commands `get_custom_mr_filter(instance_id) -> Option<CustomMrFilter>`, `set_custom_mr_filter(filter) -> ()`, `test_custom_mr_filter(filter) -> u32` (total match count from the `x-total` pagination header). `set` stamps `updated_at` server-side.

- [ ] **Step 1: Make the client helper reusable**

In `src-tauri/src/commands/mr.rs`, change `async fn create_gitlab_client(` to `pub(crate) async fn create_gitlab_client(` (keep everything else identical).

- [ ] **Step 2: Create the commands**

`src-tauri/src/commands/custom_filter.rs`:

```rust
//! Custom MR filter commands (issue #28).

use crate::db::custom_filter as db;
use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::CustomMrFilter;
use crate::services::gitlab_client::MergeRequestsQuery;
use tauri::State;

/// Get the custom MR filter for an instance (None when never configured).
#[tauri::command]
pub async fn get_custom_mr_filter(
    pool: State<'_, DbPool>,
    instance_id: i64,
) -> Result<Option<CustomMrFilter>, AppError> {
    Ok(db::get_custom_filter(pool.inner(), instance_id).await?)
}

/// Save (insert or update) the custom MR filter. `updated_at` is stamped
/// server-side; the value sent by the frontend is ignored.
#[tauri::command]
pub async fn set_custom_mr_filter(
    pool: State<'_, DbPool>,
    filter: CustomMrFilter,
) -> Result<(), AppError> {
    let mut filter = filter;
    filter.updated_at = chrono::Utc::now().timestamp();
    db::upsert_custom_filter(pool.inner(), &filter).await?;
    Ok(())
}

/// Count MRs matching a (possibly unsaved) filter without syncing them.
/// Runs the query with per_page=1 and returns GitLab's x-total header, so the
/// Settings UI can warn before a filter floods the sync. GitLab errors (e.g.
/// 400 for a bad param) propagate to the UI.
#[tauri::command]
pub async fn test_custom_mr_filter(
    pool: State<'_, DbPool>,
    filter: CustomMrFilter,
) -> Result<u32, AppError> {
    let client = crate::commands::mr::create_gitlab_client(&pool, filter.instance_id).await?;
    let mut query = MergeRequestsQuery::from_custom_filter(&filter);
    query.per_page = Some(1);
    let response = client.list_merge_requests(&query).await?;
    Ok(response.pagination.total)
}
```

- [ ] **Step 3: Register (3 places)**

1. `src-tauri/src/commands/mod.rs`: add `pub mod custom_filter;` (alphabetical, after `comments`) and `pub use custom_filter::{get_custom_mr_filter, set_custom_mr_filter, test_custom_mr_filter};` next to the other `pub use` lines.
2. `src-tauri/src/lib.rs`: add the three names to the big `use crate::commands::{...}` import block.
3. `src-tauri/src/lib.rs`: add `get_custom_mr_filter,`, `set_custom_mr_filter,`, `test_custom_mr_filter,` inside `generate_handler![...]` (near `get_notification_settings` / `update_notification_settings`).

- [ ] **Step 4: Verify**

Run: `cd src-tauri && cargo check && cargo test custom_filter`
Expected: compiles; Task 1/2 tests still PASS. (The command layer is a thin shell over already-tested db/query code plus a live network call — no new unit tests.)

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/custom_filter.rs src-tauri/src/commands/mod.rs src-tauri/src/commands/mr.rs src-tauri/src/lib.rs
git commit -m "feat(custom-filter): get/set/test tauri commands"
```

---

### Task 5: Frontend types and service wrappers

**Files:**
- Modify: `src/types/index.ts` (new interface, next to `NotificationSettings` around line 570)
- Modify: `src/services/tauri.ts` (three wrappers, next to `getNotificationSettings` around line 1079)
- Modify: `src/services/index.ts` (re-export the three functions in the tauri re-export block around line 69)

**Interfaces:**
- Consumes: Task 4's commands (camelCase DTO of `CustomMrFilter`).
- Produces: `CustomMrFilter` TS interface; `getCustomMrFilter(instanceId: number): Promise<CustomMrFilter | null>`, `setCustomMrFilter(filter: CustomMrFilter): Promise<void>`, `testCustomMrFilter(filter: CustomMrFilter): Promise<number>`.

- [ ] **Step 1: Add the type**

In `src/types/index.ts`, after the `NotificationSettings` interface:

```typescript
// ============================================================================
// Custom MR Filter
// ============================================================================

/** Per-instance user-defined MR sync filter (issue #28). */
export interface CustomMrFilter {
  instanceId: number;
  enabled: boolean;
  /** GitLab wip param: 'yes' (only drafts), 'no' (exclude drafts), null = any. */
  draft: string | null;
  authorUsername: string | null;
  notAuthorUsername: string | null;
  /** Comma-separated label names (AND-semantics). */
  labels: string | null;
  updatedAt: number;
}
```

- [ ] **Step 2: Add the wrappers**

In `src/services/tauri.ts` (add `CustomMrFilter` to the existing `import type { ... } from '../types'` block), after `updateNotificationSettings`:

```typescript
/**
 * Get the custom MR filter for an instance (null when never configured).
 */
export async function getCustomMrFilter(instanceId: number): Promise<CustomMrFilter | null> {
  return invoke<CustomMrFilter | null>('get_custom_mr_filter', { instanceId });
}

/**
 * Save the custom MR filter for filter.instanceId.
 */
export async function setCustomMrFilter(filter: CustomMrFilter): Promise<void> {
  return invoke<void>('set_custom_mr_filter', { filter });
}

/**
 * Count MRs matching a (possibly unsaved) filter via GitLab's x-total header.
 */
export async function testCustomMrFilter(filter: CustomMrFilter): Promise<number> {
  return invoke<number>('test_custom_mr_filter', { filter });
}
```

- [ ] **Step 3: Re-export**

In `src/services/index.ts`, add `getCustomMrFilter,`, `setCustomMrFilter,`, `testCustomMrFilter,` to the block that already re-exports `getNotificationSettings` from `./tauri`.

- [ ] **Step 4: Verify**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/services/tauri.ts src/services/index.ts
git commit -m "feat(custom-filter): frontend service wrappers and types"
```

---

### Task 6: Settings UI section

**Files:**
- Create: `src/pages/Settings/ToggleSwitch.tsx` (extracted from NotificationsSection)
- Create: `src/pages/Settings/CustomFilterSection.tsx`
- Modify: `src/pages/Settings/NotificationsSection.tsx` (delete its local `ToggleSwitch`, import the extracted one)
- Modify: `src/pages/Settings/index.tsx` (SectionId union, SECTION_GROUPS entry, SectionContent case, import)
- Modify: `src/pages/Settings.css` (small additions)

**Interfaces:**
- Consumes: Task 5's `getCustomMrFilter`/`setCustomMrFilter`/`testCustomMrFilter` and `triggerSync` from `../../services/tauri`; `useInstancesQuery` (returns `GitLabInstance[]` with `{ id, url, name }`); `useSyncSettingsQuery` (returns `{ max_mrs_per_sync: number }` among others); `SettingsGroup`/`SettingsRow` from `./SettingsGroup`; `useToast` — call as `addToast({ type: 'info', title: '...', body: '...' })`.
- Produces: `<CustomFilterSection />` rendered at `/settings/custom-filter`; shared `<ToggleSwitch checked disabled? ariaLabel onChange />`.

- [ ] **Step 1: Extract ToggleSwitch**

Create `src/pages/Settings/ToggleSwitch.tsx` by moving the `ToggleSwitch` component verbatim out of `NotificationsSection.tsx` (it renders a `button.companion-toggle` with role="switch" — copy it exactly, add `export default`). Update `NotificationsSection.tsx` to `import ToggleSwitch from './ToggleSwitch';` and delete the local definition.

Run: `bunx tsc --noEmit` — expected: clean.

- [ ] **Step 2: Create CustomFilterSection**

`src/pages/Settings/CustomFilterSection.tsx`:

```tsx
import { useState, useEffect } from 'react';
import {
  getCustomMrFilter,
  setCustomMrFilter,
  testCustomMrFilter,
  triggerSync,
} from '../../services/tauri';
import type { CustomMrFilter, GitLabInstance } from '../../types';
import { useInstancesQuery } from '../../hooks/queries/useInstancesQuery';
import { useSyncSettingsQuery } from '../../hooks/queries/useSyncSettingsQuery';
import { useToast } from '../../components/Toast';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import ToggleSwitch from './ToggleSwitch';

function emptyFilter(instanceId: number): CustomMrFilter {
  return {
    instanceId,
    enabled: false,
    draft: 'no',
    authorUsername: null,
    notAuthorUsername: null,
    labels: null,
    updatedAt: 0,
  };
}

/** Normalize a text input value: trimmed, empty string → null. */
function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function InstanceFilterCard({
  instance,
  maxMrsPerSync,
}: {
  instance: GitLabInstance;
  maxMrsPerSync: number | undefined;
}) {
  const { addToast } = useToast();
  const [filter, setFilter] = useState<CustomMrFilter | null>(null);
  const [saving, setSaving] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    getCustomMrFilter(instance.id)
      .then((f) => setFilter(f ?? emptyFilter(instance.id)))
      .catch(() => setFilter(emptyFilter(instance.id)));
  }, [instance.id]);

  // Debounced live match count whenever the (enabled) filter changes.
  useEffect(() => {
    if (!filter || !filter.enabled) {
      setMatchCount(null);
      setTestError(null);
      return;
    }
    const timer = setTimeout(() => {
      testCustomMrFilter(filter)
        .then((n) => {
          setMatchCount(n);
          setTestError(null);
        })
        .catch((err) => {
          setMatchCount(null);
          setTestError(String(err));
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [filter]);

  if (!filter) return null;

  const update = (patch: Partial<CustomMrFilter>) =>
    setFilter({ ...filter, ...patch });

  async function save() {
    if (!filter) return;
    setSaving(true);
    try {
      await setCustomMrFilter(filter);
      addToast({ type: 'info', title: 'Custom filter saved', body: instance.name ?? instance.url });
      if (filter.enabled) {
        // Surface the new MRs right away.
        triggerSync(true).catch(() => {});
      }
    } catch (err) {
      addToast({ type: 'error', title: 'Failed to save filter', body: String(err) });
    } finally {
      setSaving(false);
    }
  }

  const overCap =
    matchCount !== null && maxMrsPerSync !== undefined && matchCount > maxMrsPerSync;

  return (
    <SettingsGroup
      title={instance.name ?? instance.url}
      footer={
        filter.enabled && (
          <span className={`custom-filter-count${overCap ? ' custom-filter-count--warn' : ''}`}>
            {testError
              ? `Filter check failed: ${testError}`
              : matchCount === null
                ? 'Counting matching MRs…'
                : overCap
                  ? `${matchCount} MRs match — more than the sync limit of ${maxMrsPerSync}; the list will be truncated`
                  : `${matchCount} open MRs match this filter`}
          </span>
        )
      }
    >
      <SettingsRow
        label="Enable custom filter"
        description="Also sync open MRs matching this query, beyond your reviews"
      >
        <ToggleSwitch
          checked={filter.enabled}
          ariaLabel={`Enable custom filter for ${instance.name ?? instance.url}`}
          onChange={(enabled) => update({ enabled })}
        />
      </SettingsRow>
      <SettingsRow label="Drafts" description="Include draft/WIP merge requests" htmlFor={`cf-draft-${instance.id}`}>
        <select
          id={`cf-draft-${instance.id}`}
          value={filter.draft ?? ''}
          disabled={!filter.enabled}
          onChange={(e) => update({ draft: e.target.value === '' ? null : e.target.value })}
        >
          <option value="no">Exclude drafts</option>
          <option value="">Include drafts</option>
          <option value="yes">Only drafts</option>
        </select>
      </SettingsRow>
      <SettingsRow label="Author" description="Only MRs by this username" htmlFor={`cf-author-${instance.id}`}>
        <input
          id={`cf-author-${instance.id}`}
          className="custom-filter-input"
          type="text"
          placeholder="any author"
          value={filter.authorUsername ?? ''}
          disabled={!filter.enabled}
          onChange={(e) => update({ authorUsername: toNullable(e.target.value) })}
        />
      </SettingsRow>
      <SettingsRow label="Exclude author" description="Hide MRs by this username" htmlFor={`cf-not-author-${instance.id}`}>
        <input
          id={`cf-not-author-${instance.id}`}
          className="custom-filter-input"
          type="text"
          placeholder="e.g. renovate-bot"
          value={filter.notAuthorUsername ?? ''}
          disabled={!filter.enabled}
          onChange={(e) => update({ notAuthorUsername: toNullable(e.target.value) })}
        />
      </SettingsRow>
      <SettingsRow label="Labels" description="Comma-separated; MRs must carry all of them" htmlFor={`cf-labels-${instance.id}`}>
        <input
          id={`cf-labels-${instance.id}`}
          className="custom-filter-input"
          type="text"
          placeholder="e.g. magento"
          value={filter.labels ?? ''}
          disabled={!filter.enabled}
          onChange={(e) => update({ labels: toNullable(e.target.value) })}
        />
      </SettingsRow>
      <SettingsRow>
        <button className="custom-filter-save" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save filter'}
        </button>
      </SettingsRow>
    </SettingsGroup>
  );
}

/**
 * Custom MR filter settings: one user-defined sync scope per instance so MRs
 * the user isn't an explicit reviewer on still show up (issue #28).
 */
export default function CustomFilterSection() {
  const instancesQuery = useInstancesQuery();
  const syncQuery = useSyncSettingsQuery();

  if (!instancesQuery.data) return null;
  if (instancesQuery.data.length === 0) {
    return <p className="settings-empty-hint">Connect a GitLab instance first.</p>;
  }

  return (
    <div className="custom-filter-section">
      {instancesQuery.data.map((instance) => (
        <InstanceFilterCard
          key={instance.id}
          instance={instance}
          maxMrsPerSync={syncQuery.data?.max_mrs_per_sync}
        />
      ))}
    </div>
  );
}
```

Note for the implementer: verify the exact `addToast` payload shape and toast `type` values against `src/components/Toast/ToastContext.tsx` (calls in `NotificationsSection.tsx` use `{ type: 'info', title, body }`); if `'error'` is not a valid type, use the closest existing one. Verify `useInstancesQuery`'s row type is `GitLabInstance` (it wraps `listInstances`).

- [ ] **Step 3: Register the section**

In `src/pages/Settings/index.tsx`:

1. Add `| 'custom-filter'` to the `SectionId` union.
2. In `SECTION_GROUPS`, append to the **Connection** group after the `sync` entry:

```typescript
      {
        id: 'custom-filter',
        label: 'Custom Filter',
        description: 'Sync extra merge requests beyond your reviews',
        tauriOnly: true,
      },
```

3. Import and wire: `import CustomFilterSection from './CustomFilterSection';` and in `SectionContent`'s switch add `case 'custom-filter': return <CustomFilterSection />;`.

- [ ] **Step 4: Styles**

Append to `src/pages/Settings.css` (reusing the select styling already applied via `.settings-row-control select`):

```css
/* ================================================
   CUSTOM MR FILTER
   ================================================ */

.custom-filter-section {
  display: flex;
  flex-direction: column;
  gap: 20px;
}

.settings-row-control .custom-filter-input {
  padding: 8px 12px;
  font-family: 'IBM Plex Mono', monospace;
  font-size: 12px;
  color: var(--text-primary);
  background: var(--bg-dim);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  width: 200px;
}

.settings-row-control .custom-filter-input:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.custom-filter-count--warn {
  color: var(--status-warning, #e5a50a);
}

.custom-filter-save {
  padding: 8px 14px;
  font-size: 12px;
  font-weight: 500;
  color: var(--text-primary);
  background: var(--bg-dim);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  cursor: pointer;
}

.custom-filter-save:disabled {
  opacity: 0.6;
  cursor: default;
}
```

Check `Settings.css` for an existing empty-state hint class before adding `settings-empty-hint`; if one exists (grep for `empty`), use it instead in the component.

- [ ] **Step 5: Verify**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Settings/CustomFilterSection.tsx src/pages/Settings/ToggleSwitch.tsx src/pages/Settings/NotificationsSection.tsx src/pages/Settings/index.tsx src/pages/Settings.css
git commit -m "feat(custom-filter): settings section with live match count"
```

---

### Task 7: E2E coverage

**Files:**
- Modify: `e2e/fixtures/tauri-mock.ts` (three handlers + state map, near the `autoMergeClaims` map ~line 85)
- Create: `e2e/custom-filter.spec.ts`

**Interfaces:**
- Consumes: Task 6's UI (`.custom-filter-section`, per-card `[role="switch"]`, `.custom-filter-save`, footer count text), Task 5's invoke command names.
- Produces: mock handlers `get_custom_mr_filter` / `set_custom_mr_filter` / `test_custom_mr_filter`; one e2e spec.

- [ ] **Step 1: Add mock handlers**

In `e2e/fixtures/tauri-mock.ts`, near the `autoMergeClaims` map add:

```typescript
    const customFilters = new Map<number, unknown>();
```

and inside the `handlers` record (e.g. after `get_notification_settings`):

```typescript
      // -- Custom MR filter --
      get_custom_mr_filter: (args) => customFilters.get(args.instanceId as number) ?? null,
      set_custom_mr_filter: (args) => {
        const filter = args.filter as { instanceId: number };
        customFilters.set(filter.instanceId, filter);
        return undefined;
      },
      test_custom_mr_filter: () => 42,
```

- [ ] **Step 2: Write the failing e2e test**

`e2e/custom-filter.spec.ts`:

```typescript
import { test, expect } from './fixtures/test-base';

test.describe('Custom MR filter settings', () => {
  test('enable filter, see live match count, save', async ({ page }) => {
    await page.goto('/settings/custom-filter');
    await expect(page.locator('.custom-filter-section')).toBeVisible();

    const card = page.locator('.settings-group-wrap').first();

    // Enable the filter — the debounced count should appear.
    await card.locator('[role="switch"]').click();
    await expect(card.getByText('42 open MRs match this filter')).toBeVisible();

    // Narrow by label and save.
    await card.getByPlaceholder('e.g. magento').fill('magento');
    await card.locator('.custom-filter-save').click();
    await expect(page.getByText('Custom filter saved')).toBeVisible();
  });

  test('filter fields are disabled until enabled', async ({ page }) => {
    await page.goto('/settings/custom-filter');
    const card = page.locator('.settings-group-wrap').first();
    await expect(card.getByPlaceholder('e.g. renovate-bot')).toBeDisabled();
    await card.locator('[role="switch"]').click();
    await expect(card.getByPlaceholder('e.g. renovate-bot')).toBeEnabled();
  });
});
```

- [ ] **Step 3: Run the e2e test**

Run: `bunx playwright test e2e/custom-filter.spec.ts`
Expected: PASS (if the toast assertion is flaky, assert on the toast container class used by other specs — grep `e2e/*.spec.ts` for how toasts are asserted and match that pattern).

- [ ] **Step 4: Run the full check suite**

Run: `bunx tsc --noEmit && cd src-tauri && cargo test`
Expected: everything green.

- [ ] **Step 5: Commit**

```bash
git add e2e/fixtures/tauri-mock.ts e2e/custom-filter.spec.ts
git commit -m "test(custom-filter): e2e coverage for settings section"
```

---

## Deviations from the spec (documented, agreed rationale)

- The spec says `set_custom_mr_filter` "triggers a sync"; the plan does this from the **frontend** (Settings calls `triggerSync(true)` after a successful save of an enabled filter) instead of threading the SyncEngine handle into the command — same observable behavior, less plumbing.
- The spec's "e2e screenshot" is covered by the functional e2e spec in Task 7; a README screenshot in `screenshots.spec.ts` is intentionally omitted to avoid churning the screenshot baseline. Add later if wanted.
- The spec's testing section asks for a sync-engine test that a fourth-scope fetch failure sets `complete = false`. The crate has no HTTP-mock infrastructure and adding one for this is out of proportion; the failure path is the same match arm as the three existing scopes (covered by the purge regression tests), and the query construction is unit-tested in Task 2.
