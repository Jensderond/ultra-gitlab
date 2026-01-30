# Tasks: Local-First GitLab MR Review

**Input**: Design documents from `/specs/001-local-mr-review/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/tauri-commands.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

- **Frontend**: `src/` (React + TypeScript)
- **Backend**: `src-tauri/src/` (Rust)
- **Tests**: `tests/` (frontend), `src-tauri/` (Rust via cargo test)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization, dependencies, and basic structure

- [x] T001 Add Rust dependencies to src-tauri/Cargo.toml (sqlx, reqwest, tree-sitter, thiserror, serde, tokio)
- [x] T002 Add frontend dependencies via bun (tauri-plugin-keyring-api, react-window)
- [x] T003 [P] Create TypeScript types in src/types/index.ts matching data model entities
- [x] T004 [P] Configure Tauri capabilities for keyring in src-tauri/capabilities/keyring.json
- [x] T005 [P] Create Rust module structure: src-tauri/src/commands/mod.rs, models/mod.rs, services/mod.rs, db/mod.rs

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

### Database Layer

- [x] T006 Create SQLite migration file in src-tauri/src/db/migrations/0001_initial_schema.sql with all tables from data-model.md
- [x] T007 Implement database initialization and migration runner in src-tauri/src/db/mod.rs
- [x] T008 Implement SQLite connection pool with WAL mode in src-tauri/src/db/pool.rs

### Rust Models

- [x] T009 [P] Create GitLabInstance model in src-tauri/src/models/gitlab_instance.rs
- [x] T010 [P] Create MergeRequest model in src-tauri/src/models/merge_request.rs
- [x] T011 [P] Create Diff and DiffFile models in src-tauri/src/models/diff.rs
- [x] T012 [P] Create Comment model in src-tauri/src/models/comment.rs
- [x] T013 [P] Create SyncAction and SyncLog models in src-tauri/src/models/sync_action.rs
- [x] T014 Export all models from src-tauri/src/models/mod.rs

### Error Handling

- [x] T015 Create application error types with Serialize impl in src-tauri/src/error.rs

### GitLab API Client

- [x] T016 Implement GitLab API client with reqwest in src-tauri/src/services/gitlab_client.rs
- [x] T017 Add authentication header handling (PRIVATE-TOKEN) in gitlab_client.rs
- [x] T018 Implement pagination handling for GitLab API responses in gitlab_client.rs

### Credential Storage

- [x] T019 Configure tauri-plugin-keyring in src-tauri/src/lib.rs
- [x] T020 Implement credential storage service in src-tauri/src/services/credentials.rs

### Authentication Commands

- [x] T021 Implement setup_gitlab_instance command in src-tauri/src/commands/auth.rs
- [x] T022 Implement get_gitlab_instances command in src-tauri/src/commands/auth.rs
- [x] T023 Implement delete_gitlab_instance command in src-tauri/src/commands/auth.rs
- [x] T024 Register auth commands in src-tauri/src/lib.rs

### Frontend Services

- [x] T025 [P] Create Tauri invoke wrapper with types in src/services/tauri.ts
- [x] T026 [P] Create GitLab service wrapper in src/services/gitlab.ts
- [x] T027 [P] Create storage service wrapper in src/services/storage.ts

### App Shell

- [x] T028 Create basic App component with routing in src/App.tsx
- [x] T029 Create Settings page component for GitLab instance setup in src/pages/Settings.tsx
- [x] T030 Create instance setup form with URL/token inputs in src/components/InstanceSetup/InstanceSetup.tsx

**Checkpoint**: Foundation ready - user story implementation can now begin

---

## Phase 3: User Story 1 - Browse and Review MRs Offline-Fast (Priority: P1) 🎯 MVP

**Goal**: Developer opens app, sees MR list instantly from cache, navigates with keyboard, views syntax-highlighted diffs - all without network latency

**Independent Test**: Load app with pre-populated cache (manually seeded SQLite), navigate MRs entirely offline, verify <200ms list load, <100ms diff open

### Backend Implementation (US1)

- [x] T031 [US1] Implement get_merge_requests command with filtering in src-tauri/src/commands/mr.rs
- [x] T032 [US1] Implement get_merge_request_detail command in src-tauri/src/commands/mr.rs
- [x] T033 [US1] Implement get_diff_content command in src-tauri/src/commands/mr.rs
- [x] T034 [US1] Implement get_diff_file command with syntax highlighting tokens in src-tauri/src/commands/mr.rs
- [x] T035 [US1] Register MR commands in src-tauri/src/lib.rs

### Tree-sitter Syntax Highlighting (US1)

- [x] T036 [P] [US1] Add tree-sitter language grammars to Cargo.toml (javascript, typescript, python, rust, go)
- [x] T037 [US1] Implement syntax highlighter service in src-tauri/src/services/highlighter.rs
- [x] T038 [US1] Create highlight configuration loader with caching in highlighter.rs
- [x] T039 [US1] Implement tokenize function returning HighlightToken array in highlighter.rs

### Frontend - MR List (US1)

- [x] T040 [P] [US1] Create MRList container component in src/components/MRList/MRList.tsx
- [x] T041 [P] [US1] Create MRListItem component in src/components/MRList/MRListItem.tsx
- [x] T042 [US1] Implement MR list fetching from local storage via invoke in MRList.tsx
- [x] T043 [US1] Add MR filtering (state, scope) controls in MRList.tsx
- [x] T044 [US1] Create MR list page with layout in src/pages/MRListPage.tsx

### Frontend - Diff Viewer (US1)

- [x] T045 [P] [US1] Create DiffViewer container component in src/components/DiffViewer/DiffViewer.tsx
- [x] T046 [P] [US1] Create DiffLine component with syntax token rendering in src/components/DiffViewer/DiffLine.tsx
- [x] T047 [P] [US1] Create DiffHunk component for grouping lines in src/components/DiffViewer/DiffHunk.tsx
- [x] T048 [US1] Implement virtual scrolling with react-window in DiffViewer.tsx
- [x] T049 [US1] Create FileNavigation component for switching files in src/components/DiffViewer/FileNavigation.tsx
- [x] T050 [US1] Add unified/split view toggle in DiffViewer.tsx
- [x] T051 [US1] Create syntax highlighting CSS classes in src/styles/syntax.css
- [x] T052 [US1] Create MR detail page with diff viewer in src/pages/MRDetailPage.tsx

### Basic Keyboard Navigation (US1)

- [x] T053 [US1] Create useKeyboardNav hook in src/hooks/useKeyboardNav.ts
- [x] T054 [US1] Implement j/k navigation in MR list via useKeyboardNav
- [x] T055 [US1] Implement Enter to open selected MR in MRListPage.tsx
- [x] T056 [US1] Implement n/p for next/prev file in diff view in MRDetailPage.tsx

**Checkpoint**: User Story 1 complete - can browse cached MRs and view syntax-highlighted diffs offline with keyboard navigation

---

## Phase 4: User Story 2 - Approve and Comment with Optimistic Updates (Priority: P2)

**Goal**: Reviewer adds inline comments, approves MR - all actions appear instantly with optimistic updates, queue for background sync

**Independent Test**: Approve MR while offline, add comments, verify instant UI feedback, then verify sync when connectivity returns

### Backend - Sync Queue (US2)

- [x] T057 [US2] Implement sync queue persistence in src-tauri/src/services/sync_queue.rs
- [x] T058 [US2] Add enqueue_action function for adding actions to queue in sync_queue.rs
- [x] T059 [US2] Add get_pending_actions function in sync_queue.rs
- [x] T060 [US2] Implement sync processor for pushing actions to GitLab in src-tauri/src/services/sync_processor.rs

### Backend - Comment Commands (US2)

- [x] T061 [US2] Implement get_comments command in src-tauri/src/commands/comments.rs
- [x] T062 [US2] Implement add_comment command with optimistic insert in src-tauri/src/commands/comments.rs
- [x] T063 [US2] Implement reply_to_comment command in src-tauri/src/commands/comments.rs
- [x] T064 [US2] Implement resolve_discussion command in src-tauri/src/commands/comments.rs
- [x] T065 [US2] Register comment commands in src-tauri/src/lib.rs

### Backend - Approval Commands (US2)

- [x] T066 [US2] Implement approve_mr command with optimistic update in src-tauri/src/commands/approval.rs
- [x] T067 [US2] Implement unapprove_mr command in src-tauri/src/commands/approval.rs
- [x] T068 [US2] Register approval commands in src-tauri/src/lib.rs

### Frontend - Comments (US2)

- [x] T069 [P] [US2] Create CommentPanel container in src/components/CommentPanel/CommentPanel.tsx
- [x] T070 [P] [US2] Create CommentThread component in src/components/CommentPanel/CommentThread.tsx
- [x] T071 [P] [US2] Create CommentInput component in src/components/CommentPanel/CommentInput.tsx
- [x] T072 [US2] Create InlineComment component for diff annotations in src/components/CommentPanel/InlineComment.tsx
- [x] T073 [US2] Integrate inline comments into DiffLine.tsx showing comments at line positions
- [x] T074 [US2] Implement add comment at current line (triggered by 'c' key) in DiffViewer.tsx
- [x] T075 [US2] Add sync status indicator (pending/synced/failed) to comments in CommentThread.tsx

### Frontend - Approval (US2)

- [x] T076 [P] [US2] Create ApprovalButton component in src/components/Approval/ApprovalButton.tsx
- [x] T077 [US2] Implement optimistic approval state update in ApprovalButton.tsx
- [x] T078 [US2] Add approval button to MR detail header in MRDetailPage.tsx

### Sync Status Display (US2)

- [x] T079 [US2] Create useSyncStatus hook in src/hooks/useSyncStatus.ts
- [x] T080 [US2] Create PendingActionsIndicator component in src/components/SyncStatus/PendingActionsIndicator.tsx
- [x] T081 [US2] Add failed action retry button in PendingActionsIndicator.tsx

**Checkpoint**: User Story 2 complete - can approve MRs and add comments with instant feedback, actions queue for sync

---

## Phase 5: User Story 3 - Background Sync of New MRs (Priority: P3)

**Goal**: App continuously monitors GitLab for new/updated MRs, fetches them with diffs and comments, shows non-intrusive notifications

**Independent Test**: Create MR in GitLab, verify it appears in app within sync interval without manual refresh

### Backend - Sync Engine (US3)

- [x] T082 [US3] Implement background sync scheduler in src-tauri/src/services/sync_engine.rs
- [x] T083 [US3] Add MR fetch logic with scope filter (author/reviewer) in sync_engine.rs
- [x] T084 [US3] Implement diff and comments fetch during sync in sync_engine.rs
- [x] T085 [US3] Implement sync queue processing (push pending actions) in sync_engine.rs
- [x] T086 [US3] Add sync logging to sync_log table in sync_engine.rs
- [x] T087 [US3] Implement MR purge on merge/close (FR-005a) in sync_engine.rs

### Backend - Sync Commands (US3)

- [x] T088 [US3] Implement trigger_sync command in src-tauri/src/commands/sync.rs
- [x] T089 [US3] Implement get_sync_status command in src-tauri/src/commands/sync.rs
- [x] T090 [US3] Implement retry_failed_actions command in src-tauri/src/commands/sync.rs
- [x] T091 [US3] Implement discard_failed_action command in src-tauri/src/commands/sync.rs
- [x] T092 [US3] Register sync commands in src-tauri/src/lib.rs

### Backend - Tauri Events (US3)

- [x] T093 [US3] Emit sync-progress events during sync operations in sync_engine.rs
- [x] T094 [US3] Emit mr-updated events when MRs change in sync_engine.rs
- [x] T095 [US3] Emit action-synced events when actions complete in sync_processor.rs

### Frontend - Sync Status (US3)

- [x] T096 [P] [US3] Create SyncStatusBar component in src/components/SyncStatus/SyncStatusBar.tsx
- [x] T097 [P] [US3] Create SyncLogPanel expandable detail view in src/components/SyncStatus/SyncLogPanel.tsx
- [x] T098 [US3] Subscribe to Tauri sync events in useSyncStatus hook
- [x] T099 [US3] Display last sync time and sync-in-progress indicator in SyncStatusBar.tsx
- [x] T100 [US3] Show new/updated MR notification badge in SyncStatusBar.tsx
- [x] T101 [US3] Add manual sync trigger button (Cmd+R shortcut) in SyncStatusBar.tsx

### Settings - Sync Configuration (US3)

- [x] T102 [US3] Implement get_settings and update_settings commands in src-tauri/src/commands/settings.rs
- [x] T103 [US3] Register settings commands in src-tauri/src/lib.rs
- [x] T104 [US3] Add sync interval configuration to Settings page in Settings.tsx

**Checkpoint**: User Story 3 complete - app syncs MRs in background, shows status, handles push of local actions

---

## Phase 6: User Story 4 - Keyboard-Driven Navigation (Priority: P4)

**Goal**: Power users navigate entire app via keyboard, command palette for discoverability, customizable shortcuts

**Independent Test**: Complete full MR review (navigate, read diff, comment, approve) using only keyboard

### Command Palette (US4)

- [ ] T105 [P] [US4] Create CommandPalette container in src/components/CommandPalette/CommandPalette.tsx
- [ ] T106 [P] [US4] Create CommandItem component in src/components/CommandPalette/CommandItem.tsx
- [ ] T107 [US4] Define command registry with all available actions in src/commands/registry.ts
- [ ] T108 [US4] Implement fuzzy search for commands in CommandPalette.tsx
- [ ] T109 [US4] Add Cmd+P shortcut to open command palette in App.tsx

### Keyboard Help (US4)

- [ ] T110 [P] [US4] Create KeyboardHelp overlay component in src/components/KeyboardHelp/KeyboardHelp.tsx
- [ ] T111 [US4] Define default keyboard shortcuts in src/config/shortcuts.ts
- [ ] T112 [US4] Add '?' shortcut to show keyboard help in App.tsx

### Shortcut Customization (US4)

- [ ] T113 [US4] Create shortcut editor UI in Settings page in Settings.tsx
- [ ] T114 [US4] Implement shortcut persistence via update_settings command
- [ ] T115 [US4] Create useCustomShortcuts hook for reading user shortcuts in src/hooks/useCustomShortcuts.ts

### Enhanced Navigation (US4)

- [ ] T116 [US4] Add ] / [ for next/prev change within file in DiffViewer.tsx
- [ ] T117 [US4] Add 'a' shortcut for approve MR in MRDetailPage.tsx
- [ ] T118 [US4] Add 'c' shortcut for add comment at line in DiffViewer.tsx (enhance T074)
- [ ] T119 [US4] Add Escape to close panels/dialogs globally in App.tsx

**Checkpoint**: User Story 4 complete - full keyboard-driven workflow with command palette and customizable shortcuts

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Edge cases, performance, and final polish

### Edge Cases from spec.md

- [ ] T120 Implement cache size warning when approaching limit in sync_engine.rs
- [ ] T121 Implement progressive diff loading for large diffs (>10k lines) in DiffViewer.tsx
- [ ] T122 Handle sync conflicts when MR is merged/closed during local action in sync_processor.rs
- [ ] T123 Handle authentication expiry with re-auth prompt in gitlab_client.rs

### Performance Validation

- [ ] T124 Add performance logging for MR list load time (<200ms target) in MRList.tsx
- [ ] T125 Add performance logging for diff open time (<100ms target) in DiffViewer.tsx
- [ ] T126 Verify RAM usage with 100 cached MRs stays under 500MB

### Additional Language Grammars

- [ ] T127 [P] Add tree-sitter grammars for additional languages (java, c, cpp, ruby, php, swift, kotlin)

### Final Integration

- [ ] T128 Run quickstart.md verification checklist
- [ ] T129 Test complete offline workflow (no network after initial sync)
- [ ] T130 Test optimistic update rollback on sync failure

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3-6)**: All depend on Foundational phase completion
  - US1 (Phase 3): No dependencies on other stories
  - US2 (Phase 4): Builds on US1 (diff viewer, MR detail page)
  - US3 (Phase 5): Independent of US2, but uses sync queue from US2
  - US4 (Phase 6): Builds on all previous UI (command palette covers all actions)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - MVP
- **User Story 2 (P2)**: Depends on US1 (uses DiffViewer, MRDetailPage components)
- **User Story 3 (P3)**: Partially parallel with US2 (sync engine is independent)
- **User Story 4 (P4)**: Depends on US1-US3 (covers all app actions)

### Within Each User Story

- Models before services
- Services before commands
- Commands before frontend components
- Core implementation before integration

### Parallel Opportunities

**Phase 2 (Foundational)**:
- All model files (T009-T013) can run in parallel
- Frontend services (T025-T027) can run in parallel

**Phase 3 (US1)**:
- MRList and DiffViewer components can develop in parallel
- Tree-sitter setup (T036) parallel with backend commands

**Phase 4 (US2)**:
- CommentPanel components (T069-T071) can run in parallel
- ApprovalButton (T076) parallel with comment work

---

## Parallel Example: Phase 2 Foundational

```bash
# Launch all models in parallel:
Task: "Create GitLabInstance model in src-tauri/src/models/gitlab_instance.rs"
Task: "Create MergeRequest model in src-tauri/src/models/merge_request.rs"
Task: "Create Diff and DiffFile models in src-tauri/src/models/diff.rs"
Task: "Create Comment model in src-tauri/src/models/comment.rs"
Task: "Create SyncAction and SyncLog models in src-tauri/src/models/sync_action.rs"

# Launch all frontend services in parallel:
Task: "Create Tauri invoke wrapper with types in src/services/tauri.ts"
Task: "Create GitLab service wrapper in src/services/gitlab.ts"
Task: "Create storage service wrapper in src/services/storage.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001-T005)
2. Complete Phase 2: Foundational (T006-T030)
3. Complete Phase 3: User Story 1 (T031-T056)
4. **STOP and VALIDATE**: Test browsing cached MRs offline
5. Deploy/demo if ready - delivers core value

### Incremental Delivery

1. Setup + Foundational → Foundation ready
2. Add User Story 1 → **MVP**: Browse and view MRs offline-fast
3. Add User Story 2 → Can approve and comment with optimistic updates
4. Add User Story 3 → Automatic background sync
5. Add User Story 4 → Full keyboard-driven workflow
6. Polish → Edge cases and performance validation

### Task Count Summary

| Phase | Tasks | Cumulative |
|-------|-------|------------|
| Phase 1: Setup | 5 | 5 |
| Phase 2: Foundational | 25 | 30 |
| Phase 3: US1 (MVP) | 26 | 56 |
| Phase 4: US2 | 25 | 81 |
| Phase 5: US3 | 23 | 104 |
| Phase 6: US4 | 15 | 119 |
| Phase 7: Polish | 11 | 130 |

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- Each user story is independently testable after completion
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Performance targets: MR list <200ms, diff <100ms, actions <50ms visual feedback
