# Custom MR Filter — Design

**Issue:** [#28 — Add custom merge request filter option](https://github.com/Jensderond/ultra-gitlab/issues/28)
**Date:** 2026-07-28
**Status:** Approved

## Problem

MR visibility is driven entirely by the sync engine's three hardcoded scopes in
`src-tauri/src/services/sync_engine.rs::fetch_mrs_for_instance`:

1. `scope=created_by_me` (authored)
2. `scope=all&reviewer_username=<me>` (reviewing)
3. `scope=assigned_to_me` (assigned)

MRs where the user is not the author, an assignee, or an explicit reviewer are
never fetched, so they never appear anywhere in the app. When a project's
default reviewer rules don't add someone automatically (e.g. Magento MRs),
those MRs are invisible — reported by Colin Kallemein via Paul van der Meijs.

## Decisions

| Question | Decision |
|---|---|
| Scope model | Custom query filter built from GitLab query params (not project-picker, not a blunt "all MRs" toggle) |
| How many filters | One filter per GitLab instance |
| Where results appear | Merged into the existing Review list, no visual distinction |
| Sync depth | Full sync, identical to reviewer-scoped MRs (diff, comments, approvals, pipeline, file contents) |
| Filter knobs (v1) | Draft (yes/no/any), author include, author exclude, labels. No project/group narrowing. State is fixed to `opened`. |
| Architecture | Fourth config-driven sync scope alongside the three hardcoded ones (additive; no scope-table refactor) |

## Architecture

The custom filter becomes a **fourth fetch scope** in
`fetch_mrs_for_instance`. It is loaded from a new per-instance settings row,
translated into a `MergeRequestsQuery`, and fetched concurrently with the
existing three scopes via `tokio::join!`. Results merge through the existing
`merge_unique` id-dedup, so overlap with authored/reviewing/assigned scopes is
handled for free.

Because merged MRs are indistinguishable from reviewer-scoped ones, **nothing
downstream changes**: `sync_mr` full-syncs them, `list_review_mrs` surfaces
them (they are non-authored and non-assigned), snooze/approve/comment all work,
and soft-purge cleans them up.

## Data Model

New migration `src-tauri/src/db/migrations/0026_custom_mr_filters.sql`,
following the `notification_settings` per-instance pattern:

```sql
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

- One row per instance (the "one filter" decision). Upsert on save.
- `author_username` / `not_author_username` are single-value because the
  GitLab global `/merge_requests` endpoint only accepts a single value for
  each.
- New db module `src-tauri/src/db/custom_filter.rs` with `get(pool,
  instance_id)` and `upsert(pool, instance_id, filter)`, registered in
  `db/mod.rs`. Functions return `Result<T, AppError>`.

## Sync Behavior

In `fetch_mrs_for_instance`:

1. Load the instance's `custom_mr_filters` row. If absent or `enabled = 0`,
   behavior is identical to today (three scopes).
2. When enabled, build the fourth query:
   - `state=opened`, `scope=all`, `per_page=100`
   - `wip` from `draft` ('yes'/'no', omitted when NULL)
   - `author_username`, `not[author_username]`, `labels` from config when set
3. Fetch all four scopes concurrently; merge with `merge_unique`.
4. Failure semantics match the existing scopes: an auth-expired error
   propagates; any other error logs, sets `complete = false` (disabling
   soft-purge for the cycle), and the sync continues with the other scopes'
   results. **Fail-open**: a broken filter never blocks the reviewer-based
   sync.

Client change: add `labels: Option<String>` (comma-separated, serialized as
`labels`) to `MergeRequestsQuery` in `services/gitlab_client.rs`.

Lifecycle edge cases (no new code needed):

- **Filter disabled or narrowed:** the next complete fetch soft-purges
  no-longer-matching cached MRs (marked merged, dropping them from the opened
  Review list) — the same mechanism that handles being removed as a reviewer.
- **Filter matches too many MRs:** the existing `max_mrs_per_sync` cap
  truncates the merged set and disables soft-purge for that cycle, exactly as
  today. The Settings UI warns before this happens (see below). Independently,
  if a scope's GitLab response itself has further pages (`next_page` present
  on the `per_page=100` fetch — most plausible for `scope=all` on the custom
  filter), that scope's fetch is marked incomplete and soft-purge is disabled
  for the cycle even if the merged, deduplicated set stays under
  `max_mrs_per_sync`.

## Commands & Service Layer

Three new Tauri commands in `src-tauri/src/commands/custom_filter.rs`
(re-exported in `commands/mod.rs`, registered in `lib.rs`):

- `get_custom_mr_filter(instance_id) -> Option<CustomMrFilter>`
- `set_custom_mr_filter(instance_id, filter) -> ()` — upserts; when the saved
  filter is enabled, triggers a sync so results appear immediately.
- `test_custom_mr_filter(instance_id, filter) -> u64` — runs the query with
  `per_page=1` and returns the total match count from the `x-total` pagination
  header. Errors (e.g. GitLab 400 for a bad param) propagate to the UI.

DTOs use `#[serde(rename_all = "camelCase")]`. Frontend: invoke wrappers in
`src/services/tauri.ts`, high-level functions in `src/services/gitlab.ts`,
re-exports in `src/services/index.ts`, types in `src/types/index.ts`.

## Settings UI

New "Custom filter" section in the Settings rail (`/settings/custom-filter`),
one card per configured instance:

- Enable toggle
- Draft dropdown: Any / Exclude drafts / Only drafts
- Author include input (single username)
- Author exclude input (single username)
- Labels input (comma-separated)
- Live match count via `test_custom_mr_filter` (debounced on change), with a
  warning when the count exceeds `max_mrs_per_sync` (truncation territory);
  API errors from the test call render inline here.

Styling follows the existing Settings conventions: rail + detail layout, quiet
active states, no gradients or accent bars.

## Error Handling

- **Sync path (fail-open):** an invalid filter produces a GitLab 400 on that
  one scope; the error is logged, `complete = false` is set, and the other
  three scopes still sync. The app never loses reviewer-based MRs because of a
  bad custom filter.
- **Settings path (fail-loud):** the same 400 from `test_custom_mr_filter`
  displays inline in the Settings card, where the user can fix the filter.

## Testing

- `db/custom_filter.rs`: upsert/get roundtrip, absent-row → `None`, cascade
  delete with instance removal (temp-DB pattern from `mr_query.rs` tests).
- Sync engine: enabled filter adds the fourth scope's MRs to the merged set;
  fourth-scope failure sets `complete = false` (mirrors the existing
  incomplete-fetch tests around soft-purge).
- Query serialization: `labels` and `wip` render the expected query params.
- Frontend: `bunx tsc --noEmit`; e2e screenshot of the new Settings section
  following the existing e2e patterns.

## Out of Scope (v1)

- Multiple named filters per instance
- Project/group narrowing knobs
- Distinguishing custom-filter MRs in the Review list (badge, toggle, or
  separate view)
- Metadata-only / lazy sync depth
