# PRD: Collapse Generated Files in MR File Tree

## Introduction

When reviewing merge requests, generated files (lock files, compiled output, auto-generated code) clutter the file tree and distract from the files that actually need human review. This feature visually dims generated files in the MR detail file navigation so reviewers can focus on meaningful changes while still seeing the full picture. Files are identified as "generated" via two sources: the project's `.gitattributes` file (`linguist-generated`) and user-configured glob patterns in app settings. Generated files appear dimmed in the file tree and are skipped during keyboard navigation. When all files in an MR are generated, the diff viewer shows a lighthearted empty state instead of auto-opening a file.

## Goals

- Show generated files dimmed in the file tree so reviewers see the full file list but know what's auto-generated
- Respect `.gitattributes` `linguist-generated` markers from each project
- Allow users to configure additional glob patterns in app settings to mark files as generated
- Skip generated files during keyboard navigation (j/k, arrow keys)
- Auto-select the first non-generated file on MR detail load
- When all files are generated, show a fun empty state in the diff viewer area (no file auto-opened)
- Cache `.gitattributes` per project locally with stale-while-revalidate strategy
- Maintain 60fps — no loading spinners, use cached data with background refresh

## User Stories

### US-001: Add gitattributes cache table and Tauri command
**Description:** As a developer, I need to store parsed `.gitattributes` data per project locally so the frontend can determine which files are generated without blocking on network requests.

**Acceptance Criteria:**
- [ ] Add new SQLite migration creating a `gitattributes_cache` table with columns: `id`, `project_id` (integer), `instance_id` (integer), `patterns` (JSON text — array of `{glob, attribute}` entries for `linguist-generated`), `fetched_at` (Unix timestamp), foreign keys to `gitlab_instances` and `projects`
- [ ] Add Tauri command `get_gitattributes(instanceId, projectId)` that returns cached patterns if fresh (<24h), otherwise returns cached data and triggers a background refresh
- [ ] Add Tauri command `refresh_gitattributes(instanceId, projectId)` that fetches `.gitattributes` from the project's default branch via GitLab API, parses `linguist-generated` entries, and upserts the cache
- [ ] Background refresh does not block the command response — stale data is returned immediately
- [ ] If no cache exists yet, fetch synchronously on first call (one-time cost per project)
- [ ] Typecheck passes (`cargo check`)

### US-002: Parse .gitattributes linguist-generated patterns
**Description:** As a developer, I need to parse `.gitattributes` file content to extract glob patterns marked with `linguist-generated` so I can match them against MR file paths.

**Acceptance Criteria:**
- [ ] Parse `.gitattributes` lines in the format `<pattern> linguist-generated` or `<pattern> linguist-generated=true`
- [ ] Ignore lines with `linguist-generated=false` (explicit opt-out)
- [ ] Ignore comment lines (starting with `#`) and blank lines
- [ ] Handle standard gitattributes glob syntax: `*`, `**`, `?`, `[...]`
- [ ] Return a list of glob pattern strings that mark files as generated
- [ ] Handle missing `.gitattributes` file gracefully (return empty list, no error)
- [ ] Unit tests covering: typical patterns, negation, comments, missing file
- [ ] Typecheck passes (`cargo check`)

### US-003: Add collapse glob patterns to app settings
**Description:** As a user, I want to configure glob patterns in the app settings that mark files as collapsed/generated so I can hide files that aren't covered by `.gitattributes`.

**Acceptance Criteria:**
- [ ] Add a "Collapsed File Patterns" section to the Settings page below existing settings
- [ ] Display an editable list of glob patterns (one per row) with add/remove controls
- [ ] Ship with sensible defaults: `*.lock`, `*-lock.json`, `*.min.js`, `*.min.css`, `*.map`, `*.generated.*`, `package-lock.json`, `bun.lockb`, `yarn.lock`, `pnpm-lock.yaml`, `Cargo.lock`
- [ ] Persist patterns in `settings.json` via existing tauri-plugin-store
- [ ] Add Tauri commands `get_collapse_patterns()` and `update_collapse_patterns(patterns)` (or extend existing settings commands)
- [ ] Patterns apply globally across all projects
- [ ] Typecheck passes (both Rust and TypeScript)
- [ ] Verify in browser using dev-browser skill

### US-004: Build file classification logic on the frontend
**Description:** As a developer, I need a function that takes the file list and both pattern sources (gitattributes + user settings) and classifies each file as "generated" or "reviewable" so the UI can filter accordingly.

**Acceptance Criteria:**
- [ ] Create a utility function `classifyFiles(files: DiffFileSummary[], gitattributePatterns: string[], userPatterns: string[]): { reviewable: DiffFileSummary[], generated: DiffFileSummary[] }`
- [ ] Match file paths (`new_path`) against both gitattributes patterns and user-configured patterns using glob matching
- [ ] A file is "generated" if it matches any pattern from either source
- [ ] Use a glob matching library that supports gitattributes-style patterns (e.g., `picomatch` or `minimatch`)
- [ ] Classification runs synchronously and handles 500+ files in <1ms
- [ ] Typecheck passes

### US-005: Dim generated files in FileNavigation
**Description:** As a reviewer, I want generated files to appear visually dimmed in the file tree so I can distinguish them from files that need review, while still seeing the full list of changes.

**Acceptance Criteria:**
- [ ] FileNavigation component receives classification data and applies a dimmed visual treatment to generated files (reduced opacity, muted text color)
- [ ] Generated files are still visible and listed in their normal position in the file tree
- [ ] Generated files show a small "generated" label or icon to explain why they are dimmed
- [ ] Clicking a dimmed generated file still opens it in the diff viewer (user can review if they choose)
- [ ] Reviewable files remain fully styled with normal contrast
- [ ] When there are 0 generated files, no visual changes are applied
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-006: Skip generated files in keyboard navigation
**Description:** As a reviewer, I want j/k and arrow key navigation to skip generated files so I can move through reviewable files without interruption.

**Acceptance Criteria:**
- [ ] Keyboard navigation (j/k, up/down arrows) only cycles through reviewable files
- [ ] File index tracking uses the reviewable file list, not the full file list
- [ ] When navigating past the last reviewable file, wrap to the first (and vice versa)
- [ ] The "mark viewed + next" shortcut (`v`) also skips generated files
- [ ] Typecheck passes

### US-007: Auto-select first reviewable file and all-generated empty state
**Description:** As a reviewer, I want the MR detail view to automatically open the first non-generated file. When all files are generated, I want to see a lighthearted message instead of a diff.

**Acceptance Criteria:**
- [ ] On MR detail page load, after files are classified, auto-select the first reviewable file (not the first file overall)
- [ ] If all files are generated, do NOT auto-open any file — instead show an empty state in the diff viewer area
- [ ] The empty state displays a fun message: "Nothing to see here — the robots wrote all of this." (or similar lighthearted copy that fits the app's tone)
- [ ] The empty state is centered in the diff viewer area with muted styling
- [ ] User can still click any dimmed file in the tree to open it manually if they want to inspect
- [ ] File content loading starts immediately for the auto-selected file (when one exists)
- [ ] No visible delay compared to current behavior — gitattributes data comes from cache
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-008: Fetch gitattributes on MR sync
**Description:** As a developer, I want `.gitattributes` to be refreshed during the regular MR sync cycle so the cache stays reasonably fresh without dedicated user action.

**Acceptance Criteria:**
- [ ] During MR sync, for each project with MRs, check if gitattributes cache is older than 24 hours
- [ ] If stale, fetch and update the cache as part of the sync operation
- [ ] Fetching gitattributes does not slow down or block MR data sync
- [ ] New projects get their gitattributes fetched on first sync
- [ ] Typecheck passes (`cargo check`)

## Functional Requirements

- FR-1: Parse `.gitattributes` for `linguist-generated` (and `linguist-generated=true`) patterns, ignoring `=false`, comments, and blank lines
- FR-2: Cache parsed gitattributes patterns per project in SQLite with a `fetched_at` timestamp
- FR-3: Serve cached gitattributes immediately; refresh in background if older than 24 hours
- FR-4: On first access for a project with no cache, fetch synchronously (one-time cost)
- FR-5: Store user-configurable collapse glob patterns in `settings.json` via tauri-plugin-store
- FR-6: Ship with default collapse patterns for common generated files (lock files, minified assets, source maps)
- FR-7: Classify each diff file as "generated" or "reviewable" by matching against both pattern sources
- FR-8: Render all files in the FileNavigation sidebar; apply dimmed styling (reduced opacity, muted color) to generated files
- FR-9: Generated files remain clickable — clicking opens the diff for manual inspection
- FR-10: Keyboard navigation (j/k, arrows, `v`) skips generated files entirely
- FR-11: Auto-select the first reviewable file when opening an MR detail view
- FR-14: When all files are generated, display a lighthearted empty state in the diff viewer instead of opening a file
- FR-12: Refresh gitattributes cache during regular MR sync when stale (>24h)
- FR-13: All pattern matching and file classification must be synchronous and fast (<1ms for typical MRs)

## Non-Goals

- No per-project override of collapse patterns (global settings only for v1)
- No support for `linguist-vendored`, `linguist-documentation`, or other linguist attributes
- No manual "mark as generated" / "unmark as generated" toggle per file in a single review session
- No `.gitattributes` editing or creation from within the app
- No nested `.gitattributes` support (only root `.gitattributes` is parsed)

## Design Considerations

- Generated files stay in the file tree at their normal position but are visually dimmed (reduced opacity ~50%, muted text color) so the tree never looks empty
- A small "generated" label or subtle icon next to dimmed files explains why they look different
- Dimmed files are still clickable for manual inspection — they just aren't keyboard-navigable
- The all-generated empty state should feel playful, not like an error — centered text, maybe a small illustration or emoji-free icon, muted colors
- The Settings UI for glob patterns should use a simple list editor: each row is a text input with a remove button, plus an "Add pattern" button at the bottom

## Technical Considerations

- **Glob matching**: Use `picomatch` or `minimatch` on the frontend for pattern matching — both support gitattributes-style globs and are fast enough for synchronous use
- **GitLab API for .gitattributes**: Use the Repository Files API (`GET /projects/:id/repository/files/.gitattributes?ref=<default_branch>`) to fetch the file content; handle 404 gracefully
- **Cache invalidation**: The 24-hour stale threshold is a balance between freshness and avoiding unnecessary API calls; `.gitattributes` changes infrequently
- **Settings storage**: Extend the existing `AppSettings` struct and `settings.json` store to include `collapse_patterns: Vec<String>`
- **Frontend data flow**: `MRDetailPage` fetches gitattributes + user patterns on mount (both cached/instant), runs classification, passes full list + classification to `FileNavigation` (for dimming) and uses reviewable-only list for keyboard navigation state
- **Empty state**: When `reviewable.length === 0`, render the all-generated empty state component in the diff viewer area instead of MonacoDiffViewer
- **No loading states needed**: gitattributes always served from cache (or fetched once on first access); user patterns from settings.json — both available synchronously from the frontend's perspective

## Success Metrics

- Generated files are visually dimmed in file tree on MR detail load with no perceptible delay
- Keyboard navigation only visits reviewable files
- First reviewable file is auto-selected and its content loads immediately
- All-generated MRs show the empty state instead of a blank or confusing diff viewer
- Settings page allows adding/removing collapse patterns with instant persistence
- `.gitattributes` cache hit rate >95% after initial project setup

## Open Questions

- Should we show the generated file count in the MR list page (e.g., "12 files changed, 8 generated")?
- Should the "mark all as viewed" action also mark generated files as viewed?
- If a user comments on a generated file (via GitLab web), should it be promoted to the reviewable list?
