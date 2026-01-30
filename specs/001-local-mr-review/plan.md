# Implementation Plan: Local-First GitLab MR Review

**Branch**: `001-local-mr-review` | **Date**: 2026-01-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/001-local-mr-review/spec.md`

## Summary

Build a local-first GitLab merge request review tool using Tauri 2. The application provides instant access to cached MRs with syntax-highlighted diffs, keyboard-driven navigation, and background synchronization with GitLab. All data is served from local storage for sub-200ms response times, with optimistic updates for review actions.

## Technical Context

**Language/Version**: TypeScript 5.8+ (frontend), Rust stable (backend via Tauri 2)
**Primary Dependencies**: React 19, Tauri 2, tree-sitter (syntax highlighting), SQLite (local storage)
**Storage**: SQLite via Tauri for MR cache, system keychain for credentials
**Testing**: Vitest (frontend unit/integration), cargo test (Rust), Playwright (E2E)
**Target Platform**: macOS, Windows, Linux (desktop via Tauri)
**Project Type**: Tauri desktop app (React frontend + Rust backend)
**Performance Goals**: MR list <200ms, diff view <100ms, actions <50ms visual feedback
**Constraints**: <500MB RAM with 100 cached MRs, offline-capable, no loading spinners
**Scale/Scope**: Single-user desktop app, 100+ open MRs, 10k+ line diffs

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Type Safety First | ✅ PASS | TypeScript strict mode enabled, Rust types for IPC |
| II. Test-Driven Development | ✅ PASS | Vitest for frontend, cargo test for Rust, E2E with Playwright |
| III. Component-Based Architecture | ✅ PASS | React components with Tauri command wrappers in services |
| IV. Rust-First for Performance | ✅ PASS | GitLab API calls, SQLite, diff parsing all in Rust |
| V. Simplicity and YAGNI | ✅ PASS | No premature abstractions, SQLite over complex DB |

**Security Requirements Addressed**:
- GitLab tokens stored in system keychain (Tauri secure storage)
- IPC commands validate input parameters
- HTTPS-only for GitLab API calls
- CSP configured in Tauri

## Project Structure

### Documentation (this feature)

```text
specs/001-local-mr-review/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output (Tauri IPC contracts)
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
src/                            # React frontend
├── components/                 # UI components
│   ├── MRList/                # Merge request list view
│   ├── DiffViewer/            # Diff viewing with syntax highlighting
│   ├── CommentPanel/          # Inline comments and discussions
│   ├── CommandPalette/        # Keyboard command palette
│   └── SyncStatus/            # Sync status bar and log
├── pages/                      # Top-level page components
├── services/                   # Tauri command wrappers (typed)
│   ├── gitlab.ts              # GitLab API service wrapper
│   ├── sync.ts                # Sync queue management
│   └── storage.ts             # Local storage service
├── hooks/                      # React hooks
│   ├── useKeyboardNav.ts      # Keyboard navigation hook
│   └── useSyncStatus.ts       # Sync status subscription
├── stores/                     # State management (if needed)
└── types/                      # TypeScript type definitions

src-tauri/                      # Rust backend
├── src/
│   ├── lib.rs                 # Tauri plugin exports
│   ├── main.rs                # Entry point
│   ├── commands/              # Tauri IPC commands
│   │   ├── mod.rs
│   │   ├── gitlab.rs          # GitLab API commands
│   │   ├── sync.rs            # Sync operations
│   │   └── storage.rs         # Local storage commands
│   ├── models/                # Data models
│   │   ├── mod.rs
│   │   ├── merge_request.rs   # MR entity
│   │   ├── diff.rs            # Diff and file changes
│   │   ├── comment.rs         # Comments and discussions
│   │   └── sync_action.rs     # Pending sync actions
│   ├── services/              # Business logic
│   │   ├── mod.rs
│   │   ├── gitlab_client.rs   # GitLab API client
│   │   ├── sync_engine.rs     # Background sync engine
│   │   └── cache.rs           # SQLite cache management
│   └── db/                    # Database
│       ├── mod.rs
│       ├── migrations/        # SQLite migrations
│       └── queries.rs         # SQL queries
└── Cargo.toml

tests/                          # Tests
├── unit/                      # Frontend unit tests
├── integration/               # Frontend integration tests
└── e2e/                       # End-to-end tests (Playwright)
```

**Structure Decision**: Tauri desktop app structure with React frontend in `src/` and Rust backend in `src-tauri/`. This matches the existing project layout and Constitution requirements for Rust-first performance-critical operations.

## Complexity Tracking

No constitution violations requiring justification. The design follows all five principles.

