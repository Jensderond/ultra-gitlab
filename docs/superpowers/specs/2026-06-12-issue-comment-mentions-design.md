# @mention autocomplete for the issue comment composer

Date: 2026-06-12
Status: Approved (design)

## Goal

When writing a comment on the Issue Detail page, typing `@` followed by
characters surfaces a dropdown of matching users. Selecting one inserts
`@username ` into the textarea. Candidates are drawn from the users we have
already cached locally ("all cached users we've seen").

## Scope

In scope:
- @mention autocomplete in the issue **comment composer** only
  (`IssueCommentComposer`).

Out of scope (YAGNI):
- Mentions in the description editor.
- Rich-text editing — we keep the plain `<textarea>` and do token replacement.
- Fuzzy ranking — simple case-insensitive prefix/substring match is enough.
- Fetching candidates from the GitLab API. We only use locally cached users.

## Data source

We do not have a single users table. User identity is fragmented across cached
tables, and only `issue_notes` stores username + name + avatar together.
Everywhere else we have username only (sometimes an avatar blob keyed by
username).

The mention list is therefore assembled from cached data, deduped by username,
preferring rows that carry a display name:

```sql
SELECT username, MAX(name) AS name
FROM (
    SELECT username, NULL AS name
    FROM user_avatars
    WHERE instance_id = ?1
    UNION ALL
    SELECT author_username AS username, author_name AS name
    FROM issue_notes
    WHERE instance_id = ?1 AND system = 0
)
GROUP BY username
ORDER BY username COLLATE NOCASE;
```

Consequence accepted by the user: rows where we have never cached a name show
only `@username`. Names fill in over time as more notes get cached.

Avatars are not part of the returned payload. The existing `UserAvatar`
component already renders an avatar from `(instanceId, username)` by reading the
cached blob, with a first-letter fallback when there is no blob. The dropdown
reuses it directly.

## Backend

New Tauri command in `src-tauri/src/commands/issues.rs` (or a small new module
if cleaner), registered in `src-tauri/src/lib.rs`:

```rust
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnownUserDto {
    pub username: String,
    pub name: Option<String>,
}

#[tauri::command]
pub async fn list_known_users(
    pool: State<'_, DbPool>,
    instance_id: i64,
) -> Result<Vec<KnownUserDto>, AppError>
```

The query lives in a DB module function (e.g. `db/known_users.rs`) returning
`Result<Vec<KnownUserDto>, AppError>`, following the existing `db/` pattern.
No GitLab client call — purely local read.

## Frontend

### Service layer
- `src/services/tauri.ts`: `listKnownUsers(instanceId)` invoke wrapper.
- `src/services/gitlab.ts` + `src/services/index.ts`: re-export.
- `src/types/index.ts`: `KnownUser` type `{ username: string; name?: string }`.

### Query hook
`useKnownUsersQuery(instanceId)` (React Query) in `useIssueData.ts`. Stable
list per instance; reasonable `staleTime` since it changes slowly.

### Composer integration
`IssueCommentComposer` gains a `users: KnownUser[]` prop. `IssueDetailView`
fetches via the hook and passes it down. The composer also needs `instanceId`
to render `UserAvatar`.

### Mention behavior (new local hook `useMentionAutocomplete` or inline)
Operating on the controlled textarea `value` + `selectionStart`:

1. **Active token detection**: from the cursor, scan left for an `@` that is at
   the start of input or preceded by whitespace, with only
   non-whitespace, mention-legal chars (`[A-Za-z0-9_.\-]`) between it and the
   cursor. That substring (without the `@`) is the query. Any whitespace or no
   `@` ⇒ no active mention, dropdown closed.
2. **Filtering**: case-insensitive match of the query against `username` and
   `name`. Prefix matches rank above substring matches; cap the list (e.g. 8).
   Empty query (just `@`) shows the first N users.
3. **Rendering**: popover positioned under the composer (simple absolute
   positioning below the textarea is acceptable; cursor-precise positioning is
   not required for v1). Each row: `UserAvatar` + name (or username) + a dim
   `@username`. Highlighted row has a selected style.
4. **Keyboard** (in textarea `onKeyDown`, only when dropdown open):
   - ↑ / ↓ move highlight (wrap), `preventDefault`.
   - Enter or Tab accept the highlighted row, `preventDefault` (so Enter does
     not submit / insert newline).
   - Esc closes the dropdown without inserting, `preventDefault`.
   - When dropdown is closed, existing behavior is unchanged (⌘↵ submits).
5. **Insertion**: replace the active token (`@query`) with `@username ` and set
   the cursor just after the inserted space. Close the dropdown.
6. **Mouse**: clicking a row accepts it; hovering sets the highlight.

## Error handling
- If `list_known_users` fails, the composer still works as a plain textarea;
  the dropdown simply never opens. Log a warning, no user-facing error.
- Empty cached user list ⇒ dropdown never opens.

## Testing
- Backend: unit test for the dedup/name-preference query against a seeded DB
  (user_avatars with no name + issue_notes with name for the same username
  collapses to one row keeping the name).
- Frontend: token-detection logic is the riskiest part — unit test it in
  isolation (cursor mid-text, `@` after punctuation vs whitespace, email-like
  `a@b` should NOT trigger, query with `.`/`-`). Component test for keyboard
  nav and insertion if the existing harness supports it.

## Files touched (summary)
- `src-tauri/src/db/known_users.rs` (new) + `db/mod.rs`
- `src-tauri/src/commands/issues.rs` (+ `commands/mod.rs`, `lib.rs`)
- `src/services/tauri.ts`, `gitlab.ts`, `index.ts`
- `src/types/index.ts`
- `src/pages/IssueDetailPage/useIssueData.ts`
- `src/pages/IssueDetailPage/IssueDetailView.tsx`
- `src/pages/IssueDetailPage/IssueCommentComposer.tsx`
- mention dropdown styles in the relevant CSS
