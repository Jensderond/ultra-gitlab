# PRD: Pipelines Overview Screen

## Introduction

Add a Pipelines screen to Ultra GitLab that gives users a fast, at-a-glance overview of the latest pipeline status across their GitLab projects. The screen shows a dashboard of last-visited and pinned projects, each displaying its most recent pipeline result. Projects are searchable via a local SQLite cache with async GitLab API fallback, and pipeline data auto-refreshes so running pipelines stay current.

This is a **view-only** screen — users monitor pipeline health here and can open any project or pipeline directly in their browser for actions like retrying or canceling.

## Goals

- Provide a single dashboard showing the latest pipeline status for 10–30 projects
- Enable instant project search using locally cached projects, with GitLab API fallback
- Auto-track recently visited projects and allow pinning favorites
- Auto-refresh pipeline data (frequently for running pipelines, less often for idle ones)
- Allow opening any project or pipeline in the browser with one click

## User Stories

### US-001: Pipeline projects database migration
**Description:** As a developer, I need to store pipeline-related project tracking data (last visited, pinned) so it persists across sessions.

**Acceptance Criteria:**
- [ ] New migration adds a `pipeline_projects` table with columns: `project_id INTEGER`, `instance_id INTEGER`, `pinned INTEGER DEFAULT 0`, `last_visited_at TEXT`, `sort_order INTEGER`
- [ ] Composite PK on `(project_id, instance_id)`, FK to `projects` and `gitlab_instances`
- [ ] Migration runs cleanly on existing databases
- [ ] Typecheck passes (`cargo check`)

### US-002: Rust commands for pipeline project management
**Description:** As a developer, I need Tauri commands to manage which projects appear on the pipelines dashboard.

**Acceptance Criteria:**
- [ ] `list_pipeline_projects` command returns all tracked projects (pinned first, then by last_visited_at desc)
- [ ] `visit_pipeline_project` command upserts a project into `pipeline_projects` with current timestamp
- [ ] `toggle_pin_pipeline_project` command toggles the `pinned` flag for a project
- [ ] `remove_pipeline_project` command removes a project from the dashboard
- [ ] Commands registered in `mod.rs` and `lib.rs`
- [ ] Typecheck passes (`cargo check`)

### US-003: Rust command to fetch latest pipeline status
**Description:** As a developer, I need a Tauri command that fetches the latest pipeline for a given project from the GitLab API.

**Acceptance Criteria:**
- [ ] `get_project_pipeline_status` command calls GitLab API `GET /projects/:id/pipelines?per_page=1` and returns the latest pipeline
- [ ] Response includes: pipeline id, status (success/failed/running/pending/canceled/skipped), ref (branch/tag), sha (short), web_url, created_at, updated_at, duration
- [ ] `get_bulk_pipeline_statuses` command accepts a list of project IDs and returns statuses for all (parallelized)
- [ ] Typecheck passes (`cargo check`)

### US-004: Rust command for project search with cache + API fallback
**Description:** As a developer, I need a Tauri command that searches projects locally first, then falls back to the GitLab API.

**Acceptance Criteria:**
- [ ] `search_projects` command first queries the `projects` SQLite table using LIKE on `name_with_namespace`
- [ ] If local results < 5, also queries GitLab API `GET /projects?search=:query&per_page=10`
- [ ] API results are upserted into the `projects` cache table
- [ ] Returns combined, deduplicated results (local first, then API results)
- [ ] Typecheck passes (`cargo check`)

### US-005: Pipelines page with last visited projects dashboard
**Description:** As a user, I want to see a dashboard of my recently visited and pinned projects with their latest pipeline status when I open the Pipelines screen.

**Acceptance Criteria:**
- [ ] New route `/pipelines` renders the `PipelinesPage` component
- [ ] Dashboard shows project cards in a responsive grid layout
- [ ] Pinned projects appear first (with a pin indicator), then recent projects sorted by last visited
- [ ] Each card shows: project name (with namespace), latest pipeline status badge (color-coded), branch/ref name, pipeline relative time (e.g., "3 min ago"), and a small "updated X ago" freshness timestamp
- [ ] Empty state shown when no projects are tracked yet, with prompt to search
- [ ] Typecheck passes (`bunx tsc --noEmit`)

### US-006: Pipeline status badges and colors
**Description:** As a user, I want to instantly see pipeline health through color-coded status indicators.

**Acceptance Criteria:**
- [ ] Status badges use distinct colors: green (success), red (failed), blue (running with animation), amber (pending), gray (canceled/skipped)
- [ ] Running pipelines show a subtle pulse/spinner animation
- [ ] Badge is the most prominent visual element on each project card
- [ ] Typecheck passes (`bunx tsc --noEmit`)

### US-007: Project search with instant local + async API results
**Description:** As a user, I want to search for projects to add to my dashboard, with instant results from cache and additional results from GitLab.

**Acceptance Criteria:**
- [ ] Search input at the top of the Pipelines page with keyboard shortcut focus (e.g., `/`)
- [ ] Typing shows local cached results immediately (no debounce)
- [ ] After 300ms debounce, GitLab API search fires and results merge in below local results
- [ ] Loading indicator shown while API search is in progress
- [ ] Clicking a search result navigates to that project's pipeline view and adds it to "last visited"
- [ ] Typecheck passes (`bunx tsc --noEmit`)

### US-008: Pin/unpin projects on dashboard
**Description:** As a user, I want to pin important projects so they always appear at the top of my dashboard.

**Acceptance Criteria:**
- [ ] Each project card has a pin/unpin toggle (icon button)
- [ ] Pinned projects show a pin icon and sort to the top of the grid
- [ ] Unpinning moves the project back into the "recent" section
- [ ] Pin state persists across app restarts (stored in SQLite)
- [ ] Typecheck passes (`bunx tsc --noEmit`)

### US-009: Open project/pipeline in browser
**Description:** As a user, I want to quickly open a project's pipeline page in my browser for full GitLab actions.

**Acceptance Criteria:**
- [ ] Each project card has an "open in browser" icon button
- [ ] Clicking opens `{project.web_url}/-/pipelines` in the system default browser
- [ ] Uses Tauri shell open API (`@tauri-apps/plugin-shell`)
- [ ] Typecheck passes (`bunx tsc --noEmit`)

### US-010: Auto-refresh pipeline statuses
**Description:** As a user, I want pipeline statuses to update automatically so I see real-time progress without manual refreshing.

**Acceptance Criteria:**
- [ ] Dashboard polls for pipeline statuses every 30 seconds when pipelines are running
- [ ] Poll interval increases to 120 seconds when all pipelines are idle (success/failed/canceled)
- [ ] Polling pauses when the Pipelines page is not active (tab/page visibility)
- [ ] Status transitions animate smoothly (no jarring full-reload flicker)
- [ ] Typecheck passes (`bunx tsc --noEmit`)

### US-011: Add Pipelines to sidebar navigation
**Description:** As a user, I want to access the Pipelines screen from the app sidebar.

**Acceptance Criteria:**
- [ ] New "Pipelines" icon entry in `AppSidebar` between "My MRs" and "Settings"
- [ ] Active state highlights when on `/pipelines` route
- [ ] Keyboard shortcut `Cmd+I` / `Ctrl+I` navigates to Pipelines
- [ ] Typecheck passes (`bunx tsc --noEmit`)

### US-012: Remove project from dashboard
**Description:** As a user, I want to remove projects from my dashboard that I no longer need to monitor.

**Acceptance Criteria:**
- [ ] Each project card has a remove/dismiss action (e.g., via context menu or hover action)
- [ ] Removing a project deletes it from `pipeline_projects` table
- [ ] Removed projects can be re-added via search
- [ ] Typecheck passes (`bunx tsc --noEmit`)

### US-013: Command palette integration for pipeline projects
**Description:** As a user, I want to quickly jump to a project's pipelines from the command palette so I can navigate without leaving the keyboard.

**Acceptance Criteria:**
- [ ] Pinned and recently visited pipeline projects appear in the command palette (`Cmd+P`)
- [ ] Selecting a project navigates to `/pipelines` and opens/visits that project
- [ ] Projects appear with a pipeline icon to distinguish from MR-related entries
- [ ] Typecheck passes (`bunx tsc --noEmit`)

## Functional Requirements

- FR-1: New `pipeline_projects` table tracks which projects appear on the dashboard, with pinned flag and last_visited_at timestamp
- FR-2: Dashboard displays project cards in a grid, pinned first, then sorted by last_visited_at descending
- FR-3: Each project card shows: project name (namespaced), pipeline status badge (color-coded), branch/ref, pipeline relative timestamp, and "updated X ago" freshness indicator
- FR-4: Project search queries local `projects` SQLite cache instantly, then async falls back to GitLab API after 300ms debounce
- FR-5: GitLab API search results are upserted into the local `projects` cache for future instant results
- FR-6: Clicking a search result adds the project to the dashboard (upserts into `pipeline_projects`)
- FR-7: Users can pin/unpin projects; pinned projects always sort to the top
- FR-8: Users can remove projects from the dashboard
- FR-9: "Open in browser" button opens `{project.web_url}/-/pipelines` in the system default browser
- FR-10: Auto-refresh polls every 30s when running pipelines exist, every 120s when all are idle
- FR-11: Polling pauses when the Pipelines page is not visible/active
- FR-12: Bulk pipeline status fetch to efficiently load statuses for all dashboard projects
- FR-13: New sidebar entry and keyboard shortcut for Pipelines navigation
- FR-14: Pinned and recent pipeline projects available in command palette for keyboard navigation

## Non-Goals

- No pipeline job detail view (build → test → deploy stages) — view only summary status
- No retry, cancel, or trigger pipeline actions from within the app
- No pipeline log/output viewing
- No pipeline notifications or alerts
- No pipeline filtering by branch or status on the dashboard
- No drag-and-drop reordering of project cards
- No cross-instance pipeline comparison

## Design Considerations

- Dashboard grid should work well with 10–30 project cards, scrollable if needed
- Project cards should be compact — status badge is the hero element, supplemented by project name and branch
- Search should feel instant — show local results with no perceptible delay, API results loading in smoothly
- Use existing app design patterns: consistent with MR list page styling, sidebar navigation patterns
- Running pipelines should feel "alive" with subtle animation (pulse or spinner on the status badge)

## Technical Considerations

- **Existing infrastructure**: The `projects` table already caches GitLab project metadata — reuse it for search. Add a new `pipeline_projects` junction table for dashboard tracking.
- **GitLab API**: Use `GET /projects/:id/pipelines?per_page=1` for latest pipeline, `GET /projects?search=` for project search. Rate-limit aware — bulk fetch should parallelize but respect limits.
- **Tauri shell plugin**: Needed for "open in browser" — may need to add `@tauri-apps/plugin-shell` if not already installed.
- **Polling**: Use `setInterval` with adaptive timing. Clean up on page unmount. Consider using `document.visibilityState` for pause/resume.
- **Frontend state**: Pipeline statuses are transient (not cached in SQLite) — fetched fresh on each page load and via polling.

## Success Metrics

- User can see pipeline status of a project within 2 seconds of opening the Pipelines page
- Project search shows local results in under 100ms
- Running pipeline statuses update within 30 seconds of a status change
- Dashboard comfortably displays 30 projects without performance degradation

## Resolved Questions

- **Pipeline status caching:** Always fetch fresh from GitLab API. No SQLite cache for pipeline statuses — keeps it simple, avoids stale data, and load time is acceptable (~1-2s).
- **Command palette integration:** Yes — pinned and recent pipeline projects will be available in the command palette for quick keyboard navigation. See US-013.
- **Last checked timestamp:** Yes — each project card shows a small "updated X ago" text so users know how fresh the status is.
