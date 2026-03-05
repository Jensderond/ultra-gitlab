# PRD: TanStack Query Frontend Refactoring

## Introduction

Refactor the Ultra GitLab frontend data layer to use TanStack Query v5. The current implementation uses manual `useEffect + useState` patterns across ~12 custom hooks and 6 pages, with no cache deduplication, hand-rolled polling loops, custom in-memory file content caching, and ad-hoc optimistic update logic. This refactor eliminates that boilerplate and delivers measurable user-facing improvements: faster file navigation (prefetching), no redundant network calls (cache deduplication), and more consistent error states. All 7 phases are implemented on a single feature branch and merged as one PR.

## Goals

- Replace all `useEffect + useState` data fetching with `useQuery` / `useMutation` / `useQueries`
- Eliminate redundant network calls through TQ's built-in cache deduplication
- Replace 3+ manual `setTimeout` polling loops with `refetchInterval` callbacks
- Replace the custom in-memory file content Map with TQ's `staleTime: Infinity` cache (SHA-keyed)
- Replace scattered `tauriListen` calls (4+ locations) with a single centralized event → invalidation module
- Surface errors consistently across the UI using TQ's `error` objects
- Ship React Query Devtools in dev builds only

## User Stories

### US-001: Install TanStack Query and wire up QueryClientProvider
**Description:** As a developer, I need TanStack Query installed and a QueryClient configured so all subsequent hooks can use it.

**Acceptance Criteria:**
- [ ] `@tanstack/react-query` and `@tanstack/react-query-devtools` added to `package.json` via `bun add`
- [ ] `src/lib/queryClient.ts` created with global defaults: `staleTime: 30_000`, `gcTime: 5 * 60_000`, `retry: 1`, `refetchOnWindowFocus: true`, `mutations.retry: 0`
- [ ] `src/lib/queryKeys.ts` created with type-safe hierarchical key factory covering all entity types (instances, mr, mrFiles, mrDiffRefs, mrComments, mrFileComments, mrReviewers, fileContent, fileContentBase64, gitattributes, pipelineProjects, pipelineStatuses, pipelineJobs, jobTrace, companionStatus, settings)
- [ ] `src/main.tsx` wraps `<App />` in `<QueryClientProvider client={queryClient}>`
- [ ] `<ReactQueryDevtools />` rendered only when `import.meta.env.DEV === true`
- [ ] `bunx tsc --noEmit` passes

### US-002: Centralize Tauri event → cache invalidation
**Description:** As a developer, I need a single module that wires Tauri backend events to query invalidation so I don't maintain scattered `tauriListen` calls across multiple hooks.

**Acceptance Criteria:**
- [ ] `src/lib/tauriEvents.ts` created with `setupTauriEventListeners()` function
- [ ] Module-level singleton guard (`let initialized = false`) prevents duplicate listeners under React StrictMode / HMR
- [ ] `mr-updated` event handler debounces 500ms and invalidates: `['mr', mrId]`, `['mrFiles', mrId]`, `['mrDiffRefs', mrId]`, `['fileContent']`, `['mrList']`, `['myMRList']`
- [ ] `action-synced` event handler dispatches by `action_type`:
  - `comment`/`reply` → invalidate `['mrComments', mrId]`, `['mrFileComments', mrId]`
  - `approve`/`unapprove` → invalidate `['mr', mrId]`, `['mrList']`, `['myMRList']`
  - `resolve`/`unresolve` → invalidate `['mrComments', mrId]`
- [ ] All `invalidateQueries` calls use v5 object filter syntax: `{ queryKey: [...] }`
- [ ] `setupTauriEventListeners()` called once in `src/main.tsx`
- [ ] `bunx tsc --noEmit` passes

### US-003: Migrate simple read-only queries (Phase 1)
**Description:** As a developer, I need simple, standalone queries for instances, settings, and companion status so I can remove duplicated `useEffect` fetches across pages.

**Acceptance Criteria:**
- [ ] `src/hooks/queries/useInstancesQuery.ts` created — replaces `listInstances` useEffect in MRListPage, MyMRsPage, useActivityData, App.tsx
- [ ] `src/hooks/queries/useCurrentUserQuery.ts` created — derives authenticated username for a given `instanceId` from `useInstancesQuery`; replaces the repeated `.find()` pattern in 3+ hooks
- [ ] `src/hooks/queries/useSettingsQuery.ts` and `useCollapsePatternsQuery.ts` created
- [ ] `src/hooks/queries/useGitattributesQuery.ts` created — `staleTime: 10 * 60_000`, `enabled` when instanceId + projectId available
- [ ] `src/hooks/queries/useCompanionStatusQuery.ts` created — `refetchInterval: 30_000`; `src/hooks/useCompanionStatus.ts` deleted
- [ ] `src/hooks/queries/useHasApprovedMRsQuery.ts` created — uses `useQueries` over all instances, always fetches independently (does not depend on MyMRsPage cache); `src/hooks/useHasApprovedMRs.ts` deleted
- [ ] All consumers (MRListPage, MyMRsPage, App.tsx, Settings sections) updated to use new hooks
- [ ] Existing hook external APIs unchanged (same return shape) so consumer diffs are minimal
- [ ] `bunx tsc --noEmit` passes

### US-004: Migrate MR list and MR detail queries (Phase 2)
**Description:** As a developer, I need TQ-backed queries for MR lists and MR detail data so that navigating between MRs doesn't refetch data that's already cached.

**Acceptance Criteria:**
- [ ] `useMRListQuery`, `useMyMRListQuery`, `useMRDetailQuery`, `useDiffFilesQuery`, `useDiffRefsQuery`, `useMRReviewersQuery` created in `src/hooks/queries/`
- [ ] `useMRData.ts` refactored to compose individual queries; its `tauriListen('mr-updated')` call removed (handled by `tauriEvents.ts`)
- [ ] `useMyMRData.ts` refactored to compose `useMRDetailQuery + useMRReviewersQuery + useCommentsQuery + useCurrentUserQuery`
- [ ] `clearFileCache` / `clearFileCacheRef` NOT removed yet (in-memory cache still active; removed in US-005)
- [ ] `MRList.tsx` reducer slimmed to UI-only state (`syncStatus`, `newMrIds`); data from `useMRListQuery`
  - `isFetching` (not `isLoading`) drives background refresh indicator; `isLoading` drives foreground spinner
  - `newMrIds` tracking uses `useRef` to compare previous vs current query data in a `useEffect`
- [ ] Refresh button calls `queryClient.invalidateQueries({ queryKey: queryKeys.mrList(instanceId) })`
- [ ] `bunx tsc --noEmit` passes

### US-005: Replace file content dual-cache with TQ (Phase 3)
**Description:** As a user, I want file navigation between diff files to feel instant when I've already viewed them, and I want adjacent files to load in the background automatically.

**Acceptance Criteria:**
- [ ] `src/hooks/queries/useFileContentQuery.ts` created with two variants:
  - Text: `queryKey: queryKeys.fileContent(instanceId, projectId, filePath, sha)`, `staleTime: Infinity`, `gcTime: 30 * 60_000`, `refetchOnWindowFocus: false`, `refetchOnMount: false`
  - Image: `queryKey: queryKeys.fileContentBase64(...)`, same settings, calls `getFileContentBase64`
- [ ] Query function handles all edge cases: `isNewFile` (skip base fetch), `isDeletedFile` (skip head fetch), renamed files (`oldPath` for base, `newPath` for head)
- [ ] `getCachedFilePair` (SQLite read-by-mrId) is NOT used in query function — TQ cache serves deduplication
- [ ] `keepPreviousData` is NOT used (prevents wrong file content showing during key transitions)
- [ ] Adjacent file prefetching: `useEffect` after active file data resolves calls `queryClient.prefetchQuery` for `currentIdx - 1` and `currentIdx + 1` in reviewable file list
- [ ] `useLayoutEffect` in `useFileContent.ts` removed — TQ returns cached data synchronously, zero-flash achieved without it
- [ ] `clearFileCacheRef` and `clearFileCache` removed from `MRDetailPage/index.tsx` and `useMRData.ts` (replaced by global `tauriEvents.ts` invalidation of `['fileContent']`)
- [ ] Navigating back to a previously-viewed file shows content immediately (no loading state)
- [ ] `bunx tsc --noEmit` passes

### US-006: Migrate comment mutations with optimistic updates (Phase 4)
**Description:** As a user, I want comments I post to appear immediately and remain visible as "pending" until the backend confirms, and I want failed comments to disappear automatically.

**Acceptance Criteria:**
- [ ] `src/hooks/queries/useCommentsQuery.ts` created — `staleTime: 30_000` (enables self-healing if `action-synced` events are missed)
- [ ] `useAddCommentMutation` created — optimistically appends comment with negative ID to cache; `onSettled` does NOT call `invalidateQueries` (invalidation driven by `action-synced` Tauri event)
- [ ] `useReplyCommentMutation` created — optimistic append to existing thread
- [ ] `useResolveDiscussionMutation` created — optimistically toggles `resolved` on all comments with matching `discussionId`; waits for `action-synced`
- [ ] `useDeleteCommentMutation` created — optimistic removal with `onMutate` snapshot for `onError` rollback
- [ ] `useAddInlineCommentMutation` created — for `CommentOverlay.tsx`; request shape includes `filePath`, `newLine`/`oldLine`; updates both `['mrFileComments', mrId, filePath]` and `['mrComments', mrId]` caches optimistically
- [ ] `useActivityData.ts` refactored to compose above hooks; its `tauriListen('action-synced')` removed
- [ ] Adding a comment that fails (network error) removes the optimistic entry automatically
- [ ] `bunx tsc --noEmit` passes

### US-007: Replace pipeline polling with TQ refetchInterval (Phase 5)
**Description:** As a user, I want the pipeline dashboard and job log to update automatically while jobs are running, and stop polling when they complete, without manual intervention.

**Acceptance Criteria:**
- [ ] `usePipelineJobsQuery` created — `refetchInterval: query => hasActiveJobs(query.state.data) ? 10_000 : false`, `refetchIntervalInBackground: false`
- [ ] `usePipelineStatusesQuery` created — `refetchInterval: query => hasActivePipelines(query.state.data) ? 30_000 : 120_000`
- [ ] `useJobTraceQuery` created — `refetchInterval: isActive(status) ? 3_000 : false`; `staleTime: isActive(status) ? 0 : Infinity` (completed job traces never refetch)
- [ ] `usePipelineData.ts` reducer dropped entirely: `jobs` → `usePipelineJobsQuery`; `activeActions` → `useState<Set<number>>`
- [ ] `usePipelinesData.ts` reducer dropped entirely: `selectedInstanceId` + `searchQuery` → plain `useState`; `emitPipelineChanges` side effect moved to `useEffect` comparing previous vs current `usePipelineStatusesQuery.data` via `useRef`
- [ ] `JobLogPage.tsx` three polling `useEffect` hooks removed; uses `useJobTraceQuery` + `usePipelineJobsQuery`
- [ ] When the pipeline project list changes, `queryClient.removeQueries({ queryKey: ['pipelineStatuses'] })` called to prevent orphaned cache entries
- [ ] All manual `setTimeout`/`setInterval` polling code removed
- [ ] Pipeline dashboard stops consuming CPU when no active pipelines
- [ ] `bunx tsc --noEmit` passes

### US-008: Migrate file comments and CommentOverlay (Phase 6)
**Description:** As a developer, I need inline file comments to go through TQ mutations so the cache stays consistent between the file comment and activity views.

**Acceptance Criteria:**
- [ ] `src/hooks/queries/useFileCommentsQuery.ts` created
- [ ] `useFileComments.ts` updated to use `useFileCommentsQuery` internally
- [ ] `CommentOverlay.tsx` updated to call `useAddInlineCommentMutation` instead of calling the service directly
- [ ] Adding an inline comment updates both `['mrFileComments', mrId, filePath]` and `['mrComments', mrId]` caches optimistically
- [ ] `bunx tsc --noEmit` passes

### US-009: Migrate approval mutations and finalize settings (Phase 7)
**Description:** As a developer, I need approval actions and settings saves to go through TQ so the UI stays consistent without manual cache management.

**Acceptance Criteria:**
- [ ] `useApproveMRMutation` and `useUnapproveMRMutation` created — `onMutate` optimistically sets `userHasApproved` on `['mr', mrId]` cache with snapshot for rollback; `onError` rolls back; full sync confirmation and MR list refresh driven by `action-synced` → `approve`/`unapprove` handler in `tauriEvents.ts`
- [ ] Settings saves call `queryClient.invalidateQueries({ queryKey: queryKeys.settings() })` after persisting
- [ ] `useCodeTab.ts` uses `enabled: activeTab === 'code'`; on MR change calls `queryClient.removeQueries` for diff/file keys
- [ ] No remaining raw `useEffect` + `useState` fetch patterns in the codebase
- [ ] `bunx tsc --noEmit` passes

### US-010: Consistent error state surface
**Description:** As a user, I want to see a clear error message when data fails to load instead of silently empty states.

**Acceptance Criteria:**
- [ ] All query hooks expose TQ's `error` object (typed as `Error | null`)
- [ ] MR list, MR detail, pipeline list, and job log pages display an error message when `query.error` is non-null
- [ ] Error messages are human-readable (not raw Tauri error strings) — strip "Tauri IPC error:" prefix if present
- [ ] Previously silently-ignored errors (empty arrays on failure) now surface in the UI where the data is required to be useful
- [ ] `bunx tsc --noEmit` passes

### US-011: Browser verification pass across all major flows
**Description:** As a developer, I want to run through all major UI flows in the browser after the refactor is complete so that I can confirm loading states, data display, and interactions still work correctly end-to-end.

**Acceptance Criteria:**
- [ ] App launches without console errors or white screens
- [ ] MR list loads and displays merge requests for each configured instance
- [ ] MR detail opens; files panel and diff viewer load correctly
- [ ] Navigating between diff files shows content instantly for cached files, loading state for uncached
- [ ] Adjacent file prefetch verified: navigate forward once, go back — second visit is instant
- [ ] Comments load in activity drawer; adding a comment shows optimistic entry immediately
- [ ] Resolving a discussion thread toggles resolved state immediately (optimistic)
- [ ] Pipeline dashboard loads; status badges reflect current pipeline states
- [ ] Job log page streams trace output while job is active; stops polling when job completes
- [ ] Settings page loads and saves without error
- [ ] React Query Devtools panel visible and accessible in dev build (`import.meta.env.DEV`)
- [ ] Devtools shows expected query keys and cache hit/miss behavior for file content queries
- [ ] No duplicate Tauri IPC calls observed for the same resource during normal navigation
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- FR-1: `QueryClientProvider` wraps the entire app; singleton `QueryClient` created at module load time, not inside React tree
- FR-2: All `invalidateQueries` calls use TQ v5 object filter syntax `{ queryKey: [...] }` — not legacy array shorthand
- FR-3: `tauriEvents.ts` uses a module-level singleton guard to prevent duplicate listeners under StrictMode / HMR
- FR-4: `mr-updated` Tauri events are debounced 500ms before triggering cache invalidation
- FR-5: `action-synced` invalidation scope covers all action types: comment, reply, approve, unapprove, resolve, unresolve
- FR-6: File content query keys include SHA — `['fileContent', instanceId, projectId, filePath, sha]` — making them immutable by design
- FR-7: `getCachedFilePair` (SQLite read-by-mrId+filePath) is NOT used inside TQ query functions; TQ cache handles deduplication
- FR-8: `keepPreviousData` is NOT used for file content queries
- FR-9: `refetchIntervalInBackground: false` on all polling queries (pipeline, job trace)
- FR-10: `<ReactQueryDevtools />` rendered only when `import.meta.env.DEV === true`
- FR-11: Comment mutation `onSettled` does NOT call `invalidateQueries` — invalidation is driven by `action-synced` Tauri event; `staleTime: 30_000` on comments provides self-healing fallback
- FR-12: `usePipelinesData.ts` and `usePipelineData.ts` reducers are dropped entirely; UI state replaced with `useState`
- FR-13: `useCompanionStatus.ts` and `useHasApprovedMRs.ts` are deleted; replaced by query hooks
- FR-14: `useHasApprovedMRsQuery` always fetches — does not depend on MyMRsPage cache being populated
- FR-15: `useMRListQuery` uses the global `staleTime: 30_000` default — no client-side polling; freshness is driven entirely by `mr-updated` Tauri event invalidation
- FR-16: `useApproveMRMutation` uses `onMutate` for an optimistic `userHasApproved` toggle (same pattern as comments — sync engine confirms via `action-synced` event); `onError` rolls back via snapshot
- FR-17: When the pipeline project list changes, call `queryClient.removeQueries({ queryKey: ['pipelineStatuses'] })` to prevent orphaned status cache entries

## Non-Goals

- No changes to the Rust backend or Tauri commands
- No changes to routing, page structure, or component hierarchy
- No new features, UI changes, or visual redesigns
- No TypeScript type changes to domain types in `src/types/index.ts`
- No infinite scroll or pagination (not currently in the app)
- No server-side rendering considerations (Tauri desktop app only)
- No Redux, Zustand, or other state management libraries

## Technical Considerations

- **Package manager:** `bun` — use `bun add`, not `npm install`
- **TQ version:** v5 — `refetchInterval` callback receives `query` object (`query.state.data`), not raw data; `useQueries` available for dynamic query arrays
- **React version:** 19 — fully compatible with TQ v5
- **Tauri IPC:** All data comes via `invoke()` wrappers in `src/services/tauri.ts` — these become `queryFn` bodies unchanged
- **Phase dependency:** Phase 3 (file content) must be completed before removing `clearFileCacheRef` from `MRDetailPage`; do not remove it in Phase 2
- **MRList reducer:** Keep slimmed reducer for `syncStatus` / `newMrIds` UI state — do not drop it entirely (unlike pipeline reducers which can be fully dropped)
- **`useCurrentUserQuery`** is a derived hook over `useInstancesQuery`, not a new Tauri call — no backend changes needed

## Success Metrics

- Zero `useEffect + useState` data-fetching patterns remaining after Phase 7
- File navigation to a previously-viewed file: 0ms load time (instant from cache)
- Adjacent file prefetched before user navigates to it in >80% of normal review flows
- No redundant parallel Tauri IPC calls for the same resource (verified via Devtools)
- All polling stops automatically when jobs/pipelines complete (no CPU usage at idle)
- Error states visible in MR list, MR detail, pipeline, and job log when backend fails

## Open Questions

None — all resolved.
