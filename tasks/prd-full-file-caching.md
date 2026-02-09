# PRD: Full File Content Caching

## Introduction

Currently, Ultra GitLab caches MR diffs, comments, approvals, and metadata in SQLite during background sync — all of which load instantly. However, when a user selects a file in the Monaco diff viewer, the app makes two live network requests to the GitLab API to fetch the full file content (base and head versions). This causes multi-second delays every time a file is opened, breaking the "everything is instant" promise of background sync.

This feature pre-caches full file content (both base and head versions) for all changed text files during the regular background sync cycle. When a user opens a file, content loads directly from SQLite in under 100ms with no network request needed.

## Goals

- Eliminate network requests when viewing file content in already-synced MRs
- Achieve sub-100ms file content loading from SQLite cache
- Pre-fetch all changed text files (base + head) during the 5-minute background sync
- Deduplicate file content storage using SHA-based blob storage
- Gracefully fall back to network fetch on cache miss (first sync in progress, new MR)
- Keep cache size manageable by only caching text files

## User Stories

### US-001: Create file content cache schema
**Description:** As a developer, I need database tables to store cached file content so that full file versions persist across sessions.

**Acceptance Criteria:**
- [ ] Create a new `file_blobs` table with columns: `sha` (TEXT PK), `content` (TEXT NOT NULL), `size_bytes` (INTEGER NOT NULL), `cached_at` (INTEGER NOT NULL)
- [ ] Create a new `file_versions` table with columns: `id` (INTEGER PK), `mr_id` (INTEGER NOT NULL FK), `file_path` (TEXT NOT NULL), `version_type` (TEXT NOT NULL — 'base' or 'head'), `sha` (TEXT NOT NULL FK to file_blobs), `instance_id` (TEXT NOT NULL), `project_id` (INTEGER NOT NULL)
- [ ] Add unique constraint on `file_versions(mr_id, file_path, version_type)` to prevent duplicates
- [ ] Add index on `file_versions(mr_id)` for efficient lookup
- [ ] Add index on `file_blobs(sha)` (already PK, but verify)
- [ ] Migration file follows existing pattern in `src-tauri/migrations/`
- [ ] Typecheck passes (`cargo check`)

### US-002: Add Rust models for file content cache
**Description:** As a developer, I need Rust structs and database query functions so the sync engine and commands can read/write cached file content.

**Acceptance Criteria:**
- [ ] Create `FileBlob` model struct with fields matching the `file_blobs` table
- [ ] Create `FileVersion` model struct with fields matching the `file_versions` table
- [ ] Implement `upsert_file_blob(pool, sha, content, size_bytes)` — inserts blob if SHA not already stored (deduplication)
- [ ] Implement `upsert_file_version(pool, mr_id, file_path, version_type, sha, instance_id, project_id)` — inserts or updates the version mapping
- [ ] Implement `get_cached_file_content(pool, mr_id, file_path, version_type) -> Option<String>` — joins `file_versions` + `file_blobs` to return content
- [ ] Implement `delete_file_versions_for_mr(pool, mr_id)` — cascade cleanup when MR is purged
- [ ] Implement `get_orphaned_blobs(pool) -> Vec<String>` — finds blobs not referenced by any file_version (for future cleanup)
- [ ] Typecheck passes (`cargo check`)

### US-003: Pre-fetch file content during background sync
**Description:** As a user, I want all changed text files to be pre-downloaded during background sync so they're ready when I open an MR.

**Acceptance Criteria:**
- [ ] During `sync_mr()`, after fetching diff files, iterate over each `diff_file` entry
- [ ] For each text file (skip binary detection: check file extension against known binary extensions like images, executables, archives, fonts)
- [ ] Fetch base version content using `get_file_content(instance_id, project_id, old_path, base_sha)` — skip for newly added files (change_type = 'added')
- [ ] Fetch head version content using `get_file_content(instance_id, project_id, new_path, head_sha)` — skip for deleted files (change_type = 'deleted')
- [ ] Compute SHA for each fetched content (use the Git blob SHA from the API, or compute SHA-256 of content)
- [ ] Store via `upsert_file_blob()` and `upsert_file_version()`
- [ ] File fetch failures for individual files should log a warning but NOT fail the entire MR sync
- [ ] Sync continues to work correctly if GitLab API rate limits are hit (skip remaining files, retry next cycle)
- [ ] Typecheck passes (`cargo check`)

### US-004: Serve file content from cache in Tauri commands
**Description:** As a user, I want file content to load instantly from cache when I select a file in the diff viewer.

**Acceptance Criteria:**
- [ ] Modify `get_file_content` command to first check `get_cached_file_content(pool, mr_id, file_path, version_type)`
- [ ] The command needs access to `mr_id` to look up the cache — update the command signature to accept `mr_id` as an optional parameter
- [ ] If cache hit: return content directly from SQLite (no network request)
- [ ] If cache miss: fall back to existing GitLab API fetch (current behavior preserved)
- [ ] Add a new command `get_cached_file_pair(mr_id, file_path)` that returns both base and head content in a single call (avoids two round trips even to SQLite)
- [ ] Typecheck passes (`cargo check`)

### US-005: Update frontend to use cached file loading
**Description:** As a user, I want the MR detail page to load files from cache so I see instant file switching with no loading spinners.

**Acceptance Criteria:**
- [ ] Update `MRDetailPage.tsx` file selection handler to call `get_cached_file_pair(mrId, filePath)` first
- [ ] If both base and head content returned: render Monaco immediately without loading state
- [ ] If cache miss (null returned): fall back to existing `getFileContent()` calls with loading indicator
- [ ] Update `src/services/tauri.ts` to add the new `getCachedFilePair` invoke wrapper
- [ ] Update `src/services/gitlab.ts` and `src/services/index.ts` to export the new function
- [ ] Add appropriate TypeScript types in `src/types/index.ts` for the cached file pair response
- [ ] Typecheck passes (`bunx tsc --noEmit`)

### US-006: Purge cached file content with MR cleanup
**Description:** As a developer, I need cached file content to be cleaned up when MRs are purged so the database doesn't grow unbounded.

**Acceptance Criteria:**
- [ ] Extend `purge_closed_mrs()` to also call `delete_file_versions_for_mr()` for each purged MR
- [ ] After purging file versions, run orphaned blob cleanup to remove `file_blobs` entries no longer referenced by any `file_version`
- [ ] Existing cache size calculation (`get_cache_size()`) accounts for `file_blobs` and `file_versions` tables
- [ ] Typecheck passes (`cargo check`)

### US-007: Skip re-fetching unchanged files on subsequent syncs
**Description:** As a developer, I want the sync to skip files that haven't changed so we don't waste bandwidth or API calls on content we already have.

**Acceptance Criteria:**
- [ ] Before fetching file content during sync, check if a `file_version` entry already exists for this `(mr_id, file_path, version_type)` with matching SHAs
- [ ] If the diff's `base_sha`/`head_sha` haven't changed since last sync, skip all file content fetching for that MR
- [ ] If only some files changed (new commits pushed), fetch only the files whose SHAs differ
- [ ] Log skipped file count at debug level for observability
- [ ] Typecheck passes (`cargo check`)

## Functional Requirements

- FR-1: Create `file_blobs` table storing deduplicated file content keyed by SHA
- FR-2: Create `file_versions` table mapping (mr_id, file_path, version_type) to a blob SHA
- FR-3: During background sync, fetch base and head content for all changed text files in each MR
- FR-4: Skip binary files (images, executables, archives, fonts) during pre-fetch
- FR-5: Skip fetching base content for newly added files and head content for deleted files
- FR-6: Deduplicate storage — if two MRs change the same file at the same SHA, store content only once
- FR-7: `get_file_content` command checks cache first, falls back to network on miss
- FR-8: New `get_cached_file_pair` command returns both base and head in one call
- FR-9: Frontend uses cached file pair for instant file switching in Monaco diff viewer
- FR-10: File versions are deleted when their parent MR is purged; orphaned blobs are cleaned up
- FR-11: Subsequent syncs skip files whose SHAs haven't changed
- FR-12: Individual file fetch failures during sync are non-fatal (log + continue)
- FR-13: Cache size calculation includes file blob storage for existing size limit enforcement

## Non-Goals

- No caching of binary files (images, fonts, archives, executables) — these continue to use on-demand base64 fetching
- No file content compression in SQLite (SQLite handles this adequately at the page level)
- No separate background thread for file fetching — runs as part of existing sync cycle
- No offline mode indicator or explicit "cached" badge in the UI
- No manual cache invalidation UI — cache is managed automatically
- No pre-fetching of files for MRs the user hasn't been assigned to review

## Technical Considerations

- **Blob deduplication**: Using the Git SHA (or SHA-256 of content) as the blob key means identical file versions across MRs share one stored copy. This is especially valuable for large repos where multiple MRs touch the same base files.
- **Sync time impact**: Pre-fetching file content will increase sync duration. For an MR with 20 changed files, that's up to 40 API calls (base + head per file). Consider parallel fetching with a concurrency limit (e.g., 4 concurrent requests) to keep sync times reasonable.
- **Database size**: Text file content can be large. The existing 500MB cache limit applies. A typical MR with 20 files averaging 500 lines (~15KB each) adds ~600KB. Even 50 MRs would only add ~30MB.
- **SQLite WAL mode**: Already enabled, which means cached reads don't block sync writes. File content reads will be fast even during active sync.
- **Migration**: New migration file (e.g., `0007_file_content_cache.sql`) following existing naming convention.
- **Existing `get_file_content` command**: Currently takes `(instance_id, project_id, file_path, sha)`. Adding `mr_id` as an optional parameter maintains backward compatibility. The new `get_cached_file_pair` command provides a cleaner API for the primary use case.

## Success Metrics

- File content loads from cache in under 100ms (vs current 1-5 seconds via network)
- Zero network requests when viewing files in fully-synced MRs
- Background sync completes within 2x of current duration (file fetching adds overhead but stays reasonable)
- Cache storage for file content stays under 100MB for typical usage (< 50 active MRs)
- No regression in sync reliability — individual file fetch failures don't break MR sync

## Open Questions

- Should we use the Git blob SHA from the API response or compute our own SHA-256? Git blob SHAs are readily available from the diff metadata and provide natural deduplication.
- What concurrency limit should we use for parallel file fetching during sync? Need to balance speed vs GitLab API rate limits.
- Should we add a user-facing setting to disable file pre-caching for users on metered connections or with limited disk space?
