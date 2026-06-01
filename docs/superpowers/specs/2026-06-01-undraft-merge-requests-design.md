# Undraft Merge Requests — Design

Date: 2026-06-01
Status: Approved (pending spec review)

## Goal

Let users mark their own **draft** merge requests as ready ("undraft") from inside
Ultra GitLab, and control whether drafts appear in the **My MRs** list.

Three user-facing changes:

1. **Undraft action** on the MR detail page, bound to `Cmd+Enter` (contextual,
   like merge/rebase).
2. **Draft visibility toggle** on the My MRs list — drafts are **shown by
   default**; a persisted toggle hides them. Header button (next to "Recently
   merged") plus keyboard shortcut `d`.
3. The normal MR list is **unchanged** — it already hides drafts (see below).

## Current behavior (verified)

- **Sync** (`sync_engine.rs::fetch_mrs_for_instance`):
  - Authored MRs (`scope=created_by_me`) are fetched **without** a draft filter,
    so the user's own drafts land in the local DB.
  - Reviewing MRs are fetched with `draft: "no"`, so other people's drafts are
    never stored.
- **Normal MR list** (`get_merge_requests`): returns MRs where
  `author != authenticated_username`. Since other people's drafts are never
  synced, this list already shows no drafts. **No change needed.**
- **My MRs list** (`list_my_merge_requests`): returns the user's own opened MRs
  with no draft filter, so the user's drafts always show today.
- **Merge/rebase**: `Cmd+Enter` in `MyMRDetailPage` is contextual via
  `mergeActionsRef` — merges if mergeable, rebases if `need_rebase`. The key is
  not customizable (raw `keydown` listener in `useMyMRKeyboard`).
- **Recently-merged toggle** is the pattern to mirror: a persisted backend
  setting (`show_recently_merged_mrs`) → `AppSettings` → query param → SQL,
  toggled with `m` and a header switch button.
- **Draft detection** (frontend `isDraft`): title starts with `Draft:` or `WIP:`.

## Undraft mechanism (Option A — title strip)

GitLab's web "Mark as ready" performs a `PUT` that removes the `Draft:` title
prefix. We do the same:

`PUT /projects/:id/merge_requests/:iid` with `{ "title": <stripped title> }`.

Rationale: works on every GitLab version, matches the web UI, and lets us keep
the locally-cached title in sync in the same operation. (The `draft` boolean is
documented only as a *list filter*; its acceptance as a write attribute is not
reliable across versions.) The live API response will be confirmed during
implementation using the test credentials.

Prefix stripping reuses the same prefixes the frontend `isDraft` recognizes
(`Draft:` and `WIP:`, case-sensitive as today), trimming the following space.

## Changes

### 1. Backend — undraft command

- `services/gitlab_client.rs`: `mark_merge_request_ready(project_id, mr_iid,
  new_title) -> Result<(), AppError>` — `PUT .../merge_requests/:iid` with body
  `{ "title": new_title }`. Error handling mirrors `merge_merge_request`
  (parse `message` from body, map status codes, `AppError::gitlab_api_full`).
- `commands/mr.rs`: `undraft_mr(mr_id) -> Result<String, AppError>`:
  1. Look up `instance_id, project_id, iid` (`get_mr_api_ids`) and the cached
     `title`.
  2. Strip the `Draft:`/`WIP:` prefix; if the title has no draft prefix, return
     it unchanged (idempotent no-op call avoided — return early Ok with current
     title).
  3. Call `mark_merge_request_ready`.
  4. On success, `UPDATE merge_requests SET title = ? WHERE id = ?`.
  5. Return the new title.
- Register `undraft_mr` in `commands/mod.rs` and `lib.rs`
  (`generate_handler!`).

### 2. Backend — draft visibility setting & query filter

- `commands/settings.rs`:
  - New key `SHOW_DRAFT_MRS_KEY = "show_draft_mrs"`.
  - `AppSettings.show_draft_mrs: bool`, **default `true`**.
  - Load/save wired exactly like `show_recently_merged_mrs`.
  - `update_show_draft_mrs(app, show: bool)` command; register in
    `mod.rs` + `lib.rs`.
- `commands/mr.rs::list_my_merge_requests`: add param
  `include_drafts: Option<bool>` (default `true`). When `false`, append
  `AND mr.title NOT LIKE 'Draft:%' AND mr.title NOT LIKE 'WIP:%'` to both the
  recently-merged and the opened-only query branches.

### 3. Frontend — service + types

- `services/tauri.ts`:
  - `undraftMR(mrId: number): Promise<string>` → `invoke('undraft_mr', { mrId })`.
  - `updateShowDraftMrs(show: boolean)` → `invoke('update_show_draft_mrs', { show })`.
  - `listMyMergeRequests(instanceId, includeRecentlyMerged, includeDrafts)` —
    add `includeDrafts` arg passed as `includeDrafts`.
- `services/gitlab.ts` + `services/index.ts`: re-export the new wrappers.
- Settings type (`types/index.ts` / settings query type): add
  `showDraftMrs: boolean`.

### 4. Frontend — My MRs list (toggle)

- `MyMRsPage.tsx`:
  - Read `showDrafts = settingsQuery.data?.showDraftMrs ?? true`.
  - `handleToggleDrafts`: `updateShowDraftMrs(!showDrafts)` then invalidate
    settings query.
  - Register keyboard shortcut `toggle-drafts` (default `d`) via `useHotkey` /
    `getKey`, mirroring `toggle-recently-merged`.
  - Header: add a **"Drafts"** switch button next to "Recently merged",
    `role="switch"`, `aria-checked={showDrafts}`, `is-on` when `showDrafts`.
  - `useMyMRListQuery(selectedInstanceId, showRecentlyMerged, showDrafts)` —
    pass `showDrafts` as `includeDrafts`.
  - Add `{ key: 'd', label: 'drafts' }` to `defaultShortcuts`.
- `useMyMRListQuery.ts`: accept `includeDrafts` (default `true`), include it in
  the query key, pass to `listMyMergeRequests`.
- `lib/queryKeys.ts`: extend `myMRList` key to include the drafts flag.

### 5. Frontend — undraft via Cmd+Enter (contextual)

- `MyMRDetailPage/MergeSection.tsx`:
  - Compute `isDraft` from `mr.title` (same prefixes).
  - When `isDraft`: force `canMerge = false` and `canRebase = false`, and expose
    `undraft` in `MergeActions`.
  - Add `undraft: (() => void) | null` to the `MergeActions` interface.
  - `handleUndraft`: call `undraftMR(mrId)`, on success `setMr` with the new
    title (clears draft), refetch merge status, and invalidate MR + My MRs list
    queries. On error, surface via toast (like merge failure).
  - In the `draft_status` render branch, replace the static "Draft" label with a
    **"Mark ready ⌘+↵"** button wired to `handleUndraft`.
- `useMyMRKeyboard.ts`: extend the `Cmd+Enter` handler order to
  `merge → rebase → undraft`, with `trackShortcut('Mod+Enter', 'undraft',
  'my_mr_detail')`.

### 6. Shortcut registration & help

- Register the `toggle-drafts` shortcut (default `d`) wherever
  `toggle-recently-merged` is declared (shortcuts provider / customization /
  KeyboardHelp), so it is customizable and documented.

## Error handling

- Undraft failures surface via the existing toast pattern (title + message),
  matching merge failures. Local title is only updated on a successful PUT.
- `undraft_mr` on a non-draft title is a safe no-op (returns current title
  without a network call).

## Testing

- Rust: `cargo check` / existing unit-test conventions; add a unit test for the
  title-prefix stripping helper (Draft:, WIP:, no-prefix cases).
- Manual against the real GitLab instance (test credentials): undraft a real
  draft MR, confirm the title updates, the merge action becomes available, and
  the My MRs draft toggle hides/shows drafts and persists across restart.
- Typecheck: `bunx tsc --noEmit`.

## Out of scope

- Re-drafting (marking a ready MR back to draft).
- Changing normal MR list behavior (already hides drafts).
- Bulk undraft from the list view.
