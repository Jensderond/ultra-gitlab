# PRD: Fetch and Display GitLab Project Titles

## Introduction

Replace the raw `project_path` (e.g., `group/project`) currently shown on MR cards with the human-readable `name_with_namespace` (e.g., "GitLab.org / GitLab") fetched from the GitLab `GET /projects/:id` API endpoint. Project data is cached in a dedicated SQLite table so each project is only fetched once.

## Goals

- Display human-readable project titles (`name_with_namespace`) on MR cards instead of URL-derived paths
- Minimize API calls by caching project information in a normalized `projects` table
- Fetch project titles during the existing MR sync cycle, not on-demand
- Gracefully fall back to the URL-extracted `project_path` if the API call fails

## User Stories

### US-001: Create projects cache table
**Description:** As a developer, I need a normalized `projects` table so that project metadata is stored once and referenced by all merge requests.

**Acceptance Criteria:**
- [ ] New SQL migration creates a `projects` table with columns: `id` (INTEGER PRIMARY KEY, the GitLab project ID), `instance_id` (INTEGER, FK to instances), `name` (TEXT), `name_with_namespace` (TEXT), `path_with_namespace` (TEXT), `web_url` (TEXT), `created_at` (TEXT), `updated_at` (TEXT)
- [ ] Migration is registered in the migration list in `db/mod.rs`
- [ ] Remove or repurpose the existing `0004_add_project_name.sql` migration since we are using a separate table instead
- [ ] Typecheck/build passes (`cargo check`)

### US-002: Add Rust model and DB operations for projects
**Description:** As a developer, I need a `Project` struct and database helper functions to insert/query projects.

**Acceptance Criteria:**
- [ ] `Project` struct in `src-tauri/src/models/` with fields matching the database schema
- [ ] Function to look up a project by `(instance_id, project_id)` — returns `Option<Project>`
- [ ] Function to upsert a project (insert or update on conflict)
- [ ] Typecheck passes (`cargo check`)

### US-003: Add GitLab API method to fetch a project by ID
**Description:** As a developer, I need a method on the GitLab client to call `GET /projects/:id` and return project metadata.

**Acceptance Criteria:**
- [ ] New method on the GitLab client: `get_project(project_id: u64) -> Result<GitLabProject>`
- [ ] `GitLabProject` response struct with at least: `id`, `name`, `name_with_namespace`, `path_with_namespace`, `web_url`
- [ ] Typecheck passes (`cargo check`)

### US-004: Fetch and cache project titles during MR sync
**Description:** As a developer, I want the sync engine to automatically fetch project titles for any new project IDs encountered during an MR sync, so the data is available without extra API calls later.

**Acceptance Criteria:**
- [ ] After fetching MRs, the sync engine collects all unique `project_id` values
- [ ] For each `project_id` not already present in the `projects` table, call `GET /projects/:id`
- [ ] Upsert the fetched project data into the `projects` table
- [ ] If the API call for a project fails, log a warning and continue (do not block the sync)
- [ ] Typecheck passes (`cargo check`)

### US-005: Expose project name to the frontend via MR queries
**Description:** As a developer, I need the MR list and detail queries to join on the `projects` table and return the human-readable project name.

**Acceptance Criteria:**
- [ ] SQL queries in `commands/mr.rs` join `merge_requests` with `projects` on `(project_id, instance_id)`
- [ ] The `project_name` field on `MergeRequestListItem` is populated from `projects.name_with_namespace`
- [ ] If no project row exists (cache miss), fall back to extracting the path from `web_url` using the existing `extract_project_path()` function
- [ ] The `project_name` column on the `merge_requests` table can be removed or ignored in favor of the join
- [ ] Typecheck passes (`cargo check`)

### US-006: Display project title on MR cards
**Description:** As a user, I want to see the project's human-readable name (e.g., "GitLab.org / GitLab") on each MR card so I can quickly identify which project a merge request belongs to.

**Acceptance Criteria:**
- [ ] MR cards display `name_with_namespace` from the projects cache
- [ ] Falls back to `project_path` from URL if project title is unavailable
- [ ] Long names are truncated with ellipsis (existing CSS behavior)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- FR-1: Create a `projects` table with columns for GitLab project metadata (`id`, `instance_id`, `name`, `name_with_namespace`, `path_with_namespace`, `web_url`, timestamps)
- FR-2: The sync engine must collect unique `project_id` values from fetched MRs and batch-check which are missing from the local `projects` table
- FR-3: For each missing project, call `GET /projects/:id` on the corresponding GitLab instance
- FR-4: Upsert fetched project data into the `projects` table (insert new, update existing)
- FR-5: MR list and detail queries must JOIN on the `projects` table to resolve `name_with_namespace`
- FR-6: If the `projects` table has no row for a given MR's project, fall back to `extract_project_path()` from the `web_url`
- FR-7: API failures when fetching a project must not block or fail the MR sync — log and continue
- FR-8: The frontend MR card displays the resolved project title (already wired up in `MRListItem.tsx`)

## Non-Goals

- No dedicated "projects" UI or project management features
- No fetching of additional project metadata beyond what's needed for display (avatars, descriptions, etc.)
- No project search or filtering by project name (may come later)
- No lazy/on-demand fetching — all fetching happens during sync
- No periodic refresh of project names — they are fetched once and cached indefinitely

## Technical Considerations

- **Existing infrastructure:** The `MergeRequest` model already has a `project_name` field, `MRListItem.tsx` already renders it, and the TypeScript `MergeRequest` type includes `projectName`. The plumbing is in place — this feature normalizes the data source.
- **Migration strategy:** Replace the current `0004_add_project_name.sql` (which adds a column to `merge_requests`) with a migration that creates the `projects` table. The `project_name` column on `merge_requests` can be dropped or left as a fallback.
- **API rate limiting:** Project fetches are bounded by the number of unique projects across all MRs, which is typically small. No batching API exists — individual `GET /projects/:id` calls are required.
- **Compound key:** Projects are unique per `(instance_id, project_id)` since the same numeric project ID could exist on different GitLab instances.

## Success Metrics

- MR cards display human-readable project names (e.g., "GitLab.org / GitLab") instead of paths
- Each unique project is fetched from the API at most once (subsequent syncs use the cache)
- Sync does not fail or slow down significantly due to project fetches
- Fallback to `project_path` works seamlessly when project data is unavailable

## Open Questions

- Should we periodically refresh project names in case they are renamed on GitLab? (Current decision: no, fetch once and cache)
- Should the `project_name` column on `merge_requests` be dropped in this migration or left for backward compatibility?
