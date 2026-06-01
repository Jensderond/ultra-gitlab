# Undraft Merge Requests Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users mark their own draft MRs as ready ("undraft") via `Cmd+Enter` on the MR detail page, and add a persisted "Drafts" visibility toggle (shown by default) to the My MRs list.

**Architecture:** Undraft is a direct GitLab `PUT` that strips the `Draft:`/`WIP:` title prefix (matching the web "Mark as ready" button), then updates the local DB title. Draft visibility mirrors the existing `show_recently_merged_mrs` toggle: a persisted backend setting → `AppSettings` → query param → SQL filter, surfaced as a header switch + `d` keyboard shortcut. `Cmd+Enter` on the detail page becomes contextual (`merge → rebase → undraft`).

**Tech Stack:** Rust (Tauri 2, sqlx), React 19 + TypeScript, `@tanstack/react-query`, `@tanstack/react-hotkeys`. Package manager: `bun`. Typecheck: `bunx tsc --noEmit`. Rust check: `cargo check` (run inside `src-tauri/`).

**Reference spec:** `docs/superpowers/specs/2026-06-01-undraft-merge-requests-design.md`

---

## File Structure

**Backend (Rust):**
- `src-tauri/src/services/gitlab_client.rs` — add `mark_merge_request_ready` (PUT title).
- `src-tauri/src/commands/mr.rs` — add `strip_draft_prefix` helper + `undraft_mr` command; add `include_drafts` param to `list_my_merge_requests`.
- `src-tauri/src/commands/settings.rs` — add `show_draft_mrs` setting + `update_show_draft_mrs` command.
- `src-tauri/src/commands/mod.rs`, `src-tauri/src/lib.rs` — register the two new commands.

**Frontend (TS):**
- `src/services/tauri.ts` — `undraftMR`, `updateShowDraftMrs`, `includeDrafts` arg on `listMyMergeRequests`.
- `src/services/index.ts` — re-export new wrappers.
- `src/types/index.ts` — add `showDraftMrs` to settings type.
- `src/lib/queryKeys.ts` — extend `myMRList` key with drafts flag.
- `src/hooks/queries/useMyMRListQuery.ts` — accept/pass `includeDrafts`.
- `src/config/shortcuts.ts` — register `toggle-drafts`.
- `src/pages/MyMRsPage.tsx` — header toggle button + `d` shortcut + pass flag to query.
- `src/pages/MyMRDetailPage/MergeSection.tsx` — `undraft` action + "Mark ready" button + draft-disables-merge logic.
- `src/pages/MyMRDetailPage/useMyMRKeyboard.ts` — `Cmd+Enter` order `merge → rebase → undraft`.

---

## Task 1: Backend — `mark_merge_request_ready` GitLab client method

**Files:**
- Modify: `src-tauri/src/services/gitlab_client.rs` (insert after `rebase_merge_request`, ends at line 1063)

- [ ] **Step 1: Add the client method**

Insert immediately after the closing brace of `rebase_merge_request` (after line 1063), before `/// Add a general comment to a merge request.`:

```rust
    /// Mark a merge request as ready by setting its title (removes the Draft: prefix).
    ///
    /// GitLab has no dedicated "undraft" write attribute that is stable across
    /// versions; the web UI's "Mark as ready" simply edits the title. We do the
    /// same by PUTting a title with the draft prefix already stripped.
    pub async fn mark_merge_request_ready(
        &self,
        project_id: i64,
        mr_iid: i64,
        new_title: &str,
    ) -> Result<(), AppError> {
        let endpoint = format!("/projects/{}/merge_requests/{}", project_id, mr_iid);
        let url = self.api_url(&endpoint);
        let response = self
            .send_with_retry(
                self.client
                    .put(&url)
                    .json(&serde_json::json!({ "title": new_title })),
            )
            .await?;

        if response.status().is_success() {
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let message = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("message")?.as_str().map(String::from))
                .unwrap_or_else(|| format!("Failed to mark ready ({})", status));

            Err(AppError::gitlab_api_full(&message, status.as_u16(), &endpoint))
        }
    }
```

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles (warnings about unused method are fine until Task 2 wires it in).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/services/gitlab_client.rs
git commit -m "feat: add mark_merge_request_ready GitLab client method"
```

---

## Task 2: Backend — `strip_draft_prefix` helper + unit test

**Files:**
- Modify: `src-tauri/src/commands/mr.rs` (add helper near `get_mr_api_ids` ~line 1251; add test in the existing `#[cfg(test)] mod tests` block ~line 1330)

- [ ] **Step 1: Write the failing test**

Add inside the existing `mod tests` block in `src-tauri/src/commands/mr.rs` (after `test_parse_range`):

```rust
    #[test]
    fn test_strip_draft_prefix() {
        assert_eq!(strip_draft_prefix("Draft: Add feature"), "Add feature");
        assert_eq!(strip_draft_prefix("WIP: Add feature"), "Add feature");
        // No prefix — returned unchanged.
        assert_eq!(strip_draft_prefix("Add feature"), "Add feature");
        // Prefix without trailing space still stripped.
        assert_eq!(strip_draft_prefix("Draft:Add feature"), "Add feature");
        // Only a leading prefix is stripped, not mid-title occurrences.
        assert_eq!(strip_draft_prefix("Add Draft: thing"), "Add Draft: thing");
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src-tauri && cargo test strip_draft_prefix`
Expected: FAIL — `cannot find function strip_draft_prefix`.

- [ ] **Step 3: Add the helper**

Insert in `src-tauri/src/commands/mr.rs` directly above `async fn get_mr_api_ids` (currently ~line 1251):

```rust
/// Remove a leading `Draft:` or `WIP:` prefix from an MR title.
///
/// Matches the prefixes the frontend `isDraft` recognizes. Trims one optional
/// following space. Returns the title unchanged if it has no draft prefix.
fn strip_draft_prefix(title: &str) -> String {
    for prefix in ["Draft:", "WIP:"] {
        if let Some(rest) = title.strip_prefix(prefix) {
            return rest.trim_start().to_string();
        }
    }
    title.to_string()
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src-tauri && cargo test strip_draft_prefix`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/mr.rs
git commit -m "feat: add strip_draft_prefix helper with tests"
```

---

## Task 3: Backend — `undraft_mr` command

**Files:**
- Modify: `src-tauri/src/commands/mr.rs` (add command after `rebase_mr`, ends at line 1328)
- Modify: `src-tauri/src/commands/mod.rs:67`
- Modify: `src-tauri/src/lib.rs` (import list ~line 31 and `generate_handler!` ~line 333)

- [ ] **Step 1: Add the command**

Insert in `src-tauri/src/commands/mr.rs` after the closing brace of `rebase_mr` (after line 1328), before `#[cfg(test)]`:

```rust
/// Mark the user's own draft MR as ready by stripping the Draft:/WIP: title prefix.
///
/// Looks up the cached title, strips the prefix, and PUTs the new title to
/// GitLab. On success, updates the local DB title and returns it. If the title
/// has no draft prefix, returns it unchanged without a network call.
///
/// # Arguments
/// * `mr_id` - The local MR database ID
///
/// # Returns
/// The MR title after stripping (the new ready title).
#[tauri::command]
pub async fn undraft_mr(pool: State<'_, DbPool>, mr_id: i64) -> Result<String, AppError> {
    let title: String = sqlx::query_scalar("SELECT title FROM merge_requests WHERE id = ?")
        .bind(mr_id)
        .fetch_optional(pool.inner())
        .await?
        .ok_or_else(|| AppError::not_found_with_id("MergeRequest", mr_id.to_string()))?;

    let new_title = strip_draft_prefix(&title);

    // No draft prefix — nothing to do. Avoid an unnecessary API call.
    if new_title == title {
        return Ok(title);
    }

    let (instance_id, project_id, mr_iid) = get_mr_api_ids(pool.inner(), mr_id).await?;
    let client = create_gitlab_client(&pool, instance_id).await?;
    client
        .mark_merge_request_ready(project_id, mr_iid, &new_title)
        .await?;

    sqlx::query("UPDATE merge_requests SET title = ? WHERE id = ?")
        .bind(&new_title)
        .bind(mr_id)
        .execute(pool.inner())
        .await?;

    Ok(new_title)
}
```

- [ ] **Step 2: Re-export in `commands/mod.rs`**

In `src-tauri/src/commands/mod.rs` line 67, add `undraft_mr` to the `pub use` list. Change:

```rust
    list_my_merge_requests, merge_mr, rebase_mr, resolve_mr_by_web_url, fetch_mr_by_web_url,
```
to:
```rust
    list_my_merge_requests, merge_mr, rebase_mr, undraft_mr, resolve_mr_by_web_url, fetch_mr_by_web_url,
```

- [ ] **Step 3: Register in `lib.rs`**

In `src-tauri/src/lib.rs`, add `undraft_mr` to the `use crate::commands::{...}` import block. On line 31 change:
```rust
    rebase_mr, refresh_avatars, refresh_gitattributes, regenerate_companion_pin, rename_instance,
```
to:
```rust
    rebase_mr, refresh_avatars, refresh_gitattributes, regenerate_companion_pin, rename_instance,
    undraft_mr,
```

Then in the `tauri::generate_handler![...]` block, add `undraft_mr,` directly after the `rebase_mr,` line (line 333):
```rust
            rebase_mr,
            undraft_mr,
```

- [ ] **Step 4: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles cleanly.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands/mr.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add undraft_mr command"
```

---

## Task 4: Backend — `include_drafts` filter on `list_my_merge_requests`

**Files:**
- Modify: `src-tauri/src/commands/mr.rs:213-289` (the `list_my_merge_requests` command)

- [ ] **Step 1: Add the parameter and filter**

In `src-tauri/src/commands/mr.rs`, change the `list_my_merge_requests` signature to add the new param:

```rust
pub async fn list_my_merge_requests(
    pool: State<'_, DbPool>,
    instance_id: i64,
    include_recently_merged: Option<bool>,
    include_drafts: Option<bool>,
) -> Result<Vec<MergeRequestListItem>, AppError> {
```

Directly after the `username` is resolved (after the `let username = username.ok_or_else(...)?;` block, before `let mrs: Vec<MergeRequest> = if include_recently_merged...`), add:

```rust
    // When drafts are hidden, exclude titles with a Draft:/WIP: prefix.
    let draft_clause = if include_drafts.unwrap_or(true) {
        ""
    } else {
        " AND mr.title NOT LIKE 'Draft:%' AND mr.title NOT LIKE 'WIP:%'"
    };
```

In the **recently-merged branch**, change the query so the draft clause is interpolated before `ORDER BY`. Replace the existing recently-merged query string's tail. The query currently ends:
```rust
              )
            ORDER BY (mr.state = 'opened') DESC, mr.updated_at DESC
            "#,
```
Replace that `sqlx::query_as(r#"..."#)` literal with a `format!` so the clause is injected. Change the call from `sqlx::query_as(r#"...ORDER BY (mr.state = 'opened') DESC, mr.updated_at DESC"#,)` to:

```rust
        sqlx::query_as(&format!(
            r#"
            SELECT
                mr.id, mr.instance_id, mr.iid, mr.project_id,
                COALESCE(p.name_with_namespace, mr.project_name) AS project_name,
                mr.title, mr.description,
                mr.author_username, mr.source_branch, mr.target_branch, mr.state,
                mr.web_url, mr.created_at, mr.updated_at, mr.merged_at,
                mr.approval_status, mr.approvals_required, mr.approvals_count,
                mr.labels, mr.reviewers, mr.cached_at, mr.user_has_approved,
                mr.head_pipeline_status, mr.state_changed_at
            FROM merge_requests mr
            LEFT JOIN projects p ON p.id = mr.project_id AND p.instance_id = mr.instance_id
            WHERE mr.instance_id = ?
              AND mr.author_username = ?
              AND (
                  mr.state = 'opened'
                  OR (mr.state = 'merged' AND mr.merged_at IS NOT NULL AND mr.merged_at >= ?)
              ){draft_clause}
            ORDER BY (mr.state = 'opened') DESC, mr.updated_at DESC
            "#,
        ))
```

In the **else (opened-only) branch**, similarly change the `sqlx::query_as(r#"..."#)` to a `format!` injecting the clause before `ORDER BY`:

```rust
        sqlx::query_as(&format!(
            r#"
            SELECT
                mr.id, mr.instance_id, mr.iid, mr.project_id,
                COALESCE(p.name_with_namespace, mr.project_name) AS project_name,
                mr.title, mr.description,
                mr.author_username, mr.source_branch, mr.target_branch, mr.state,
                mr.web_url, mr.created_at, mr.updated_at, mr.merged_at,
                mr.approval_status, mr.approvals_required, mr.approvals_count,
                mr.labels, mr.reviewers, mr.cached_at, mr.user_has_approved,
                mr.head_pipeline_status, mr.state_changed_at
            FROM merge_requests mr
            LEFT JOIN projects p ON p.id = mr.project_id AND p.instance_id = mr.instance_id
            WHERE mr.instance_id = ? AND mr.state = 'opened' AND mr.author_username = ?{draft_clause}
            ORDER BY mr.updated_at DESC
            "#,
        ))
```

Note: `draft_clause` is a hardcoded constant string (no user input), so this `format!` introduces no SQL injection. The `.bind(...)` calls after each query stay unchanged.

- [ ] **Step 2: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles cleanly.

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/commands/mr.rs
git commit -m "feat: add include_drafts filter to list_my_merge_requests"
```

---

## Task 5: Backend — `show_draft_mrs` setting + `update_show_draft_mrs` command

**Files:**
- Modify: `src-tauri/src/commands/settings.rs`
- Modify: `src-tauri/src/commands/mod.rs:83`
- Modify: `src-tauri/src/lib.rs` (import ~line 44, handler ~line 309)

- [ ] **Step 1: Add the store key constant**

In `src-tauri/src/commands/settings.rs` after line 54 (the `SHOW_RECENTLY_MERGED_MRS_KEY` const), add:

```rust
/// Key for the "show draft MRs" toggle on the My MRs page.
const SHOW_DRAFT_MRS_KEY: &str = "show_draft_mrs";
```

- [ ] **Step 2: Add the field to `AppSettings`**

In the `AppSettings` struct (after `show_recently_merged_mrs: bool,` line 124) add:

```rust
    /// Whether the My MRs page includes the user's draft MRs. Defaults to true.
    pub show_draft_mrs: bool,
```

In `impl Default for AppSettings` (after `show_recently_merged_mrs: false,` line 141) add:

```rust
            show_draft_mrs: true,
```

- [ ] **Step 3: Load and save the setting**

In `load_settings`, after the `show_recently_merged_mrs` block (after line 238), add:

```rust
    // Try to load "show draft MRs" flag (defaults to true)
    let show_draft_mrs = match store.get(SHOW_DRAFT_MRS_KEY) {
        Some(value) => serde_json::from_value(value.clone()).unwrap_or(true),
        None => true,
    };
```

Add `show_draft_mrs,` to the `Ok(AppSettings { ... })` constructor at the end of `load_settings` (after `show_recently_merged_mrs,` line 252).

In `save_settings`, after the show-recently-merged save block (after line 308), add:

```rust
    // Save "show draft MRs" flag
    let show_draft_value = serde_json::to_value(settings.show_draft_mrs)?;
    store.set(SHOW_DRAFT_MRS_KEY, show_draft_value);
```

- [ ] **Step 4: Add the update command**

After the `update_show_recently_merged_mrs` command (after line 546), add:

```rust
/// Update the "show draft MRs" toggle for the My MRs page.
///
/// # Arguments
/// * `show` - When true, the My MRs list includes the user's draft MRs.
#[tauri::command]
pub async fn update_show_draft_mrs(app: AppHandle, show: bool) -> Result<(), AppError> {
    let mut settings = load_settings(&app).await?;
    settings.show_draft_mrs = show;
    save_settings(&app, &settings).await?;
    *settings_cache().write().await = settings;
    Ok(())
}
```

- [ ] **Step 5: Register the command**

In `src-tauri/src/commands/mod.rs` line 83, add `update_show_draft_mrs,` to the `pub use` list (next to `update_show_recently_merged_mrs`):
```rust
    update_show_draft_mrs, update_show_recently_merged_mrs, update_sync_settings, update_theme, update_ui_font,
```

In `src-tauri/src/lib.rs` import block line 44, add `update_show_draft_mrs,`:
```rust
    update_show_draft_mrs, update_show_recently_merged_mrs, update_sync_config,
```

In the `generate_handler!` block, add `update_show_draft_mrs,` directly before `update_show_recently_merged_mrs,` (line 309):
```rust
            update_show_draft_mrs,
            update_show_recently_merged_mrs,
```

- [ ] **Step 6: Verify it compiles**

Run: `cd src-tauri && cargo check`
Expected: compiles cleanly.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/src/commands/settings.rs src-tauri/src/commands/mod.rs src-tauri/src/lib.rs
git commit -m "feat: add show_draft_mrs setting and update command"
```

---

## Task 6: Frontend — service wrappers + settings type

**Files:**
- Modify: `src/services/tauri.ts` (`listMyMergeRequests` ~line 269, new fns near `updateShowRecentlyMergedMrs` ~line 529, and an MR-action fn near other MR actions)
- Modify: `src/services/index.ts` (re-exports ~lines 24, 72)
- Modify: `src/types/index.ts:299`

- [ ] **Step 1: Add `includeDrafts` to `listMyMergeRequests`**

In `src/services/tauri.ts` change the `listMyMergeRequests` function (line 269):

```ts
export async function listMyMergeRequests(
  instanceId: number,
  includeRecentlyMerged: boolean = false,
  includeDrafts: boolean = true
): Promise<MergeRequest[]> {
  return invoke<MergeRequest[]>('list_my_merge_requests', {
    instanceId,
    includeRecentlyMerged,
    includeDrafts,
  });
}
```

- [ ] **Step 2: Add `undraftMR` and `updateShowDraftMrs`**

In `src/services/tauri.ts`, add `undraftMR` (place it near `mergeMR`/`rebaseMR` — search for `export async function rebaseMR`):

```ts
/**
 * Mark the user's own draft MR as ready (strips the Draft:/WIP: title prefix).
 * Returns the new title.
 */
export async function undraftMR(mrId: number): Promise<string> {
  return invoke<string>('undraft_mr', { mrId });
}
```

Add `updateShowDraftMrs` directly after `updateShowRecentlyMergedMrs` (after line 531):

```ts
/**
 * Persist the "show draft MRs" toggle used on the My MRs page.
 */
export async function updateShowDraftMrs(show: boolean): Promise<void> {
  return invoke<void>('update_show_draft_mrs', { show });
}
```

- [ ] **Step 3: Re-export from `services/index.ts`**

In `src/services/index.ts`, add `undraftMR,` near the other MR action exports (the block that includes `mergeMR`/`rebaseMR` — search for `rebaseMR`) and `updateShowDraftMrs,` next to `updateShowRecentlyMergedMrs` (line 72):

```ts
  updateShowDraftMrs,
  updateShowRecentlyMergedMrs,
```

- [ ] **Step 4: Add `showDraftMrs` to the settings type**

In `src/types/index.ts` after line 299 (`showRecentlyMergedMrs: boolean;`) add:

```ts
  showDraftMrs: boolean;
```

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors. (If `undraftMR` is reported as unused, that's resolved in Task 9.)

- [ ] **Step 6: Commit**

```bash
git add src/services/tauri.ts src/services/index.ts src/types/index.ts
git commit -m "feat: add undraftMR and showDraftMrs frontend service wrappers"
```

---

## Task 7: Frontend — query key + `useMyMRListQuery` drafts flag

**Files:**
- Modify: `src/lib/queryKeys.ts:7-8`
- Modify: `src/hooks/queries/useMyMRListQuery.ts`

- [ ] **Step 1: Extend the query key**

In `src/lib/queryKeys.ts` change `myMRList` (lines 7-8):

```ts
  myMRList: (
    instanceId: string,
    includeRecentlyMerged: boolean = false,
    includeDrafts: boolean = true,
  ) => ["myMRList", instanceId, includeRecentlyMerged, includeDrafts] as const,
```

- [ ] **Step 2: Thread `includeDrafts` through the hook**

Replace the body of `src/hooks/queries/useMyMRListQuery.ts` with:

```ts
import { useQuery } from '@tanstack/react-query';
import { useSyncExternalStore } from 'react';
import { queryKeys } from '../../lib/queryKeys';
import { listMyMergeRequests } from '../../services/tauri';
import { pendingMerges } from '../../lib/pendingMerges';

export function useMyMRListQuery(
  instanceId: number | undefined,
  includeRecentlyMerged: boolean = false,
  includeDrafts: boolean = true,
) {
  const pending = useSyncExternalStore(
    pendingMerges.subscribe,
    pendingMerges.getSnapshot,
    pendingMerges.getSnapshot,
  );
  const query = useQuery({
    queryKey: queryKeys.myMRList(String(instanceId ?? ''), includeRecentlyMerged, includeDrafts),
    queryFn: () => listMyMergeRequests(instanceId!, includeRecentlyMerged, includeDrafts),
    enabled: !!instanceId,
  });
  return {
    ...query,
    data: pending.size > 0 ? query.data?.filter((mr) => !pending.has(mr.id)) : query.data,
  };
}
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queryKeys.ts src/hooks/queries/useMyMRListQuery.ts
git commit -m "feat: thread includeDrafts through My MRs query"
```

---

## Task 8: Frontend — register `toggle-drafts` shortcut + My MRs list toggle

**Files:**
- Modify: `src/config/shortcuts.ts:282-289`
- Modify: `src/pages/MyMRsPage.tsx`

- [ ] **Step 1: Register the shortcut**

In `src/config/shortcuts.ts`, in the "My MR list shortcuts" section, add after the `toggle-recently-merged` entry (after line 289):

```ts
  {
    id: 'toggle-drafts',
    description: 'Toggle draft MRs',
    defaultKey: 'd',
    category: 'list',
    context: 'my-mr-list',
  },
```

- [ ] **Step 2: Read the setting and pass it to the query in `MyMRsPage.tsx`**

In `src/pages/MyMRsPage.tsx`:

After line 86 (`const showRecentlyMerged = settingsQuery.data?.showRecentlyMergedMrs ?? false;`) add:

```ts
  const showDrafts = settingsQuery.data?.showDraftMrs ?? true;
```

Add the import for `updateShowDraftMrs`. Change line 22:
```ts
import { updateShowRecentlyMergedMrs } from '../services';
```
to:
```ts
import { updateShowRecentlyMergedMrs, updateShowDraftMrs } from '../services';
```

After `handleToggleRecentlyMerged` (after line 96) add:

```ts
  const handleToggleDrafts = useCallback(async () => {
    const next = !showDrafts;
    await updateShowDraftMrs(next);
    queryClient.invalidateQueries({ queryKey: queryKeys.settings() });
  }, [showDrafts, queryClient]);
```

After the `toggle-recently-merged` hotkey (after line 101) add:

```ts
  useHotkey(parseHotkey(getKey('toggle-drafts') ?? 'd'), () => {
    handleToggleDrafts();
  });
```

Change the query call (line 110) to pass `showDrafts`:
```ts
  const myMRsQuery = useMyMRListQuery(selectedInstanceId ?? undefined, showRecentlyMerged, showDrafts);
```

- [ ] **Step 3: Add the header toggle button**

In `src/pages/MyMRsPage.tsx`, in the `PageHeader` `actions` prop, add a "Drafts" toggle button directly before the existing "Recently merged" button (before line 209's `<button ... className={`recently-merged-toggle ...`}>`):

```tsx
            <button
              type="button"
              className={`recently-merged-toggle ${showDrafts ? 'is-on' : ''}`}
              onClick={handleToggleDrafts}
              role="switch"
              aria-checked={showDrafts}
              title={showDrafts ? 'Hide your draft MRs' : 'Show your draft MRs'}
            >
              <span className="recently-merged-toggle-dot" aria-hidden="true" />
              <span className="recently-merged-toggle-label">Drafts</span>
            </button>
```

(Reuses the existing `recently-merged-toggle` CSS classes — no new styles needed.)

- [ ] **Step 4: Add the shortcut to the footer bar**

In `src/pages/MyMRsPage.tsx`, in `defaultShortcuts` (lines 30-36) add a `drafts` entry after the `m` entry (after line 33):

```ts
  { key: 'd', label: 'drafts' },
```

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/config/shortcuts.ts src/pages/MyMRsPage.tsx
git commit -m "feat: add draft visibility toggle to My MRs list"
```

---

## Task 9: Frontend — undraft action in `MergeSection`

**Files:**
- Modify: `src/pages/MyMRDetailPage/MergeSection.tsx`

- [ ] **Step 1: Import `undraftMR` and add `undraft` to `MergeActions`**

In `src/pages/MyMRDetailPage/MergeSection.tsx` change line 7:
```ts
import { mergeMR, checkMergeStatus, rebaseMR } from '../../services/tauri';
```
to:
```ts
import { mergeMR, checkMergeStatus, rebaseMR, undraftMR } from '../../services/tauri';
```

Change the `MergeActions` interface (lines 43-46) to add `undraft`:
```ts
export interface MergeActions {
  merge: (() => void) | null;
  rebase: (() => void) | null;
  undraft: (() => void) | null;
}
```

- [ ] **Step 2: Add a draft check and the undraft handler**

In `MergeSection`, after `const mrIid = mr.iid;` (line 65) add:

```ts
  const isDraft = mrTitle.startsWith('Draft:') || mrTitle.startsWith('WIP:');
```

After `handleRebase` (after line 144) add:

```ts
  const handleUndraft = useCallback(async () => {
    try {
      const newTitle = await undraftMR(mrId);
      setMr((prev) => (prev ? { ...prev, title: newTitle } : prev));
      // Re-check mergeability now that the draft block is gone.
      fetchMergeStatus();
      queryClient.invalidateQueries({ queryKey: queryKeys.mr(mrId) });
      if (instanceId) {
        queryClient.invalidateQueries({ queryKey: queryKeys.myMRList(String(instanceId)) });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to mark ready';
      addToast({
        type: 'info',
        title: `Failed to mark !${mrIid} ready`,
        body: `${mrTitle} — ${message}`,
      });
    }
  }, [mrId, setMr, fetchMergeStatus, queryClient, instanceId, mrIid, mrTitle, addToast]);
```

- [ ] **Step 3: Disable merge/rebase while draft and expose `undraft`**

Change the `canMerge`/`canRebase` definitions (lines 156-157):
```ts
  const canMerge = !isDraft && mr.state === 'opened' && optimisticallyMergeable && mr.approvalStatus === 'approved' && !merging;
  const canRebase = !isDraft && mr.state === 'opened' && mergeStatus === 'need_rebase' && !rebasing;
```

Change the `actionsRef` effect (lines 158-165) to include `undraft`:
```ts
  useEffect(() => {
    if (actionsRef) {
      actionsRef.current = {
        merge: canMerge ? handleMerge : null,
        rebase: canRebase ? handleRebase : null,
        undraft: isDraft && mr.state === 'opened' ? handleUndraft : null,
      };
    }
  }, [actionsRef, canMerge, canRebase, handleMerge, handleRebase, isDraft, mr.state, handleUndraft]);
```

- [ ] **Step 4: Render a "Mark ready" button in the draft branch**

In the render, replace the `draft_status` branch (lines 242-245):
```tsx
      ) : mergeStatus === 'draft_status' ? (
        <div className="my-mr-merge-actions">
          <span className="my-mr-merge-status draft">Draft</span>
        </div>
```
with:
```tsx
      ) : isDraft || mergeStatus === 'draft_status' ? (
        <div className="my-mr-merge-actions">
          <span className="my-mr-merge-status draft">Draft</span>
          <button className="my-mr-action-btn rebase" onClick={handleUndraft}>
            Mark ready <span className="shortcut-tag"><span className="shortcut-mod">⌘</span>+↵</span>
          </button>
        </div>
```

(Reuses the existing `my-mr-action-btn rebase` button styling. The `isDraft ||` guard ensures the button shows even before the async merge-status check resolves.)

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors. (`useMyMRKeyboard` already supplies a `MergeActions` ref; it gets the `undraft` field in Task 10. If `tsc` flags the ref initial value missing `undraft`, that is fixed in Task 10 — if it errors now, proceed to Task 10 then re-run.)

- [ ] **Step 6: Commit**

```bash
git add src/pages/MyMRDetailPage/MergeSection.tsx
git commit -m "feat: add undraft action and Mark ready button to MergeSection"
```

---

## Task 10: Frontend — wire undraft into `Cmd+Enter`

**Files:**
- Modify: `src/pages/MyMRDetailPage/useMyMRKeyboard.ts:121-143`
- Check: `src/pages/MyMRDetailPage/index.tsx` (where `mergeActionsRef` is initialized — ensure the initial value includes `undraft: null`)

- [ ] **Step 1: Find and fix the ref initializer**

Run: `grep -rn "mergeActionsRef\|useRef<MergeActions>\|merge: null" src/pages/MyMRDetailPage/index.tsx`

If the ref is initialized like `useRef<MergeActions>({ merge: null, rebase: null })`, change it to:
```ts
{ merge: null, rebase: null, undraft: null }
```
(If `index.tsx` does not initialize it directly, search the directory: `grep -rn "merge: null, rebase: null" src/pages/MyMRDetailPage/` and update each occurrence.)

- [ ] **Step 2: Extend the `Cmd+Enter` handler**

In `src/pages/MyMRDetailPage/useMyMRKeyboard.ts`, replace the body of the `handleMerge` keydown function (lines 128-139) so the action order is `merge → rebase → undraft`:

```ts
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const actions = mergeActionsRef.current;
        if (actions?.merge) {
          e.preventDefault();
          trackShortcut('Mod+Enter', 'merge', 'my_mr_detail');
          actions.merge();
        } else if (actions?.rebase) {
          e.preventDefault();
          trackShortcut('Mod+Enter', 'rebase', 'my_mr_detail');
          actions.rebase();
        } else if (actions?.undraft) {
          e.preventDefault();
          trackShortcut('Mod+Enter', 'undraft', 'my_mr_detail');
          actions.undraft();
        }
      }
```

- [ ] **Step 3: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/MyMRDetailPage/useMyMRKeyboard.ts src/pages/MyMRDetailPage/index.tsx
git commit -m "feat: trigger undraft via Cmd+Enter on draft MRs"
```

---

## Task 11: Full verification

- [ ] **Step 1: Rust check + tests**

Run: `cd src-tauri && cargo check && cargo test strip_draft_prefix`
Expected: compiles; test passes.

- [ ] **Step 2: Frontend typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Manual verification against the real GitLab instance**

Using the test credentials in `credentials.md`:
1. Launch: `bun run tauri dev`.
2. Open the My MRs list. Confirm the **Drafts** toggle is **on** by default and your draft MRs are visible. Toggle it off (button or `d`) → drafts disappear; the setting persists after restart.
3. Open one of your own draft MRs. The Merge section shows **Draft** + a **Mark ready ⌘+↵** button.
4. Press `Cmd+Enter` (or click the button). Confirm: the title loses its `Draft:` prefix, the merge action becomes available, and no error toast appears.
5. Confirm the normal MR list still shows no drafts (unchanged).

- [ ] **Step 4: Final commit (if any docs/cleanup remain)**

```bash
git add -A
git commit -m "chore: undraft MRs feature verification" || echo "nothing to commit"
```

---

## Notes for the implementer

- Run all `cargo` commands from inside `src-tauri/`.
- The `recently-merged-toggle` CSS classes are reused for the Drafts button — do **not** add new CSS.
- `strip_draft_prefix` and the SQL `NOT LIKE` filter must stay in sync on the `Draft:`/`WIP:` prefixes (matches the frontend `isDraft` in `MyMRsPage.tsx:57`).
- The undraft PUT only updates the local title on success; failures surface via toast and leave local state untouched.
- A draft MR that is also approved must NOT be mergeable — the `!isDraft` guard on `canMerge` enforces this even when GitLab's merge-status check hasn't resolved yet.
