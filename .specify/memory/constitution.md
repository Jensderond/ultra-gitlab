<!--
SYNC IMPACT REPORT
==================
Version change: N/A → 1.0.0 (Initial ratification)
Modified principles: N/A (initial)
Added sections:
  - Core Principles (5 principles)
  - Technology Standards
  - Quality Gates
  - Security Requirements
  - Governance
Removed sections: N/A
Templates requiring updates:
  - .specify/templates/plan-template.md ✅ (compatible - uses generic Constitution Check)
  - .specify/templates/spec-template.md ✅ (compatible - no constitution references)
  - .specify/templates/tasks-template.md ✅ (compatible - no constitution references)
Follow-up TODOs: None
-->

# Ultra GitLab Constitution

## Core Principles

### I. Type Safety First

All code MUST be written with strict TypeScript configuration. This applies to both the React frontend and any TypeScript utilities.

- TypeScript `strict` mode MUST be enabled in `tsconfig.json`
- Use of `any` type is FORBIDDEN except when interfacing with untyped third-party libraries (must be documented)
- All function parameters and return types MUST be explicitly typed
- Prefer `unknown` over `any` when type is genuinely uncertain
- Exhaustive type checking MUST be used for discriminated unions (use `never` in default cases)
- Rust backend code MUST leverage the type system to prevent runtime errors

**Rationale**: Type safety catches errors at compile time, improves IDE support, and serves as living documentation. In a desktop application handling GitLab data, type mismatches can cause silent failures.

### II. Test-Driven Development

Tests MUST be written before implementation for all non-trivial features. The Red-Green-Refactor cycle is mandatory.

- Write failing tests first that describe expected behavior
- Implement minimum code to make tests pass
- Refactor while keeping tests green
- Unit test coverage MUST meet Quality Gate thresholds
- Integration tests MUST cover Tauri IPC communication between frontend and backend
- E2E tests SHOULD cover critical user workflows

**Rationale**: TDD ensures code is testable by design, provides regression protection, and creates executable documentation of expected behavior.

### III. Component-Based Architecture

The frontend MUST be built using modular, reusable components with clear boundaries and single responsibilities.

- Each component MUST have a single, well-defined purpose
- Components MUST be independently testable
- Shared state MUST be managed through explicit props or designated state management
- Component files MUST NOT exceed 300 lines; extract sub-components when approaching this limit
- Presentational and container logic SHOULD be separated
- Tauri commands MUST be wrapped in typed service modules, not called directly from components

**Rationale**: Component isolation enables parallel development, simplifies testing, and makes the codebase navigable as it grows.

### IV. Rust-First for Performance

Performance-critical operations and system interactions MUST be implemented in the Rust backend, not the frontend.

- File system operations MUST go through Tauri commands
- Network requests to GitLab API SHOULD be handled by Rust for better error handling and caching
- CPU-intensive data transformations MUST be performed in Rust
- The frontend MUST remain responsive; long-running operations MUST be async with progress feedback
- Memory-sensitive operations MUST leverage Rust's ownership model

**Rationale**: Tauri's Rust backend provides native performance and security. Keeping heavy operations in Rust ensures the UI remains responsive and the application performs well.

### V. Simplicity and YAGNI

Start with the simplest solution that works. Do not add features, abstractions, or complexity until proven necessary.

- No premature optimization; measure before optimizing
- No abstraction layers until the same pattern appears three times
- Prefer standard library and well-maintained dependencies over custom implementations
- Configuration MUST have sensible defaults; only expose settings users actually need
- Delete dead code immediately; do not comment it out

**Rationale**: Complexity is the enemy of maintainability. Every abstraction has a cost. Simple code is easier to understand, test, and modify.

## Technology Standards

The following technology choices are mandatory for this project:

| Layer | Technology | Version | Notes |
|-------|------------|---------|-------|
| Framework | Tauri | 2.x | Desktop application shell |
| Frontend | React | 19.x | UI library |
| Language (FE) | TypeScript | 5.x | Strict mode required |
| Language (BE) | Rust | Latest stable | Via Tauri |
| Build Tool | Vite | 7.x | Frontend bundling |
| Package Manager | Bun | Latest | Dependency management |
| Linting | ESLint + Biome | Latest | Code quality |
| Formatting | Biome/Prettier | Latest | Consistent style |

**Dependency Policy**:
- New dependencies MUST be justified in PR description
- Prefer dependencies with >1000 GitHub stars and active maintenance
- Security advisories MUST be addressed within 7 days
- Dependency updates SHOULD be performed monthly

## Quality Gates

All code MUST pass these gates before merge:

| Gate | Requirement | Enforcement |
|------|-------------|-------------|
| Type Check | Zero TypeScript errors | `bun run typecheck` |
| Lint | Zero errors, warnings reviewed | `bun run lint` |
| Unit Tests | All pass, coverage >= 70% | `bun run test` |
| Build | Successful compilation | `bun run tauri build` |
| Rust Check | `cargo clippy` with zero warnings | CI pipeline |

**Pre-commit Requirements**:
- Format check MUST pass
- Lint check MUST pass
- Type check MUST pass

**PR Requirements**:
- All CI checks MUST pass
- At least one approval required
- No unresolved review comments

## Security Requirements

As a desktop application handling GitLab credentials and repository data:

- GitLab tokens MUST be stored in the system keychain via Tauri's secure storage, NEVER in plain text files
- All IPC commands MUST validate input parameters
- Network requests MUST use HTTPS exclusively
- Sensitive data MUST NOT be logged; use redaction for debugging
- CSP (Content Security Policy) MUST be configured to prevent XSS
- File system access MUST be scoped to necessary directories only
- Dependencies MUST be audited for known vulnerabilities before release

**Authentication**:
- Support GitLab Personal Access Tokens as primary auth method
- Token scope MUST be validated to ensure minimum required permissions
- Implement token refresh/expiry handling

## Governance

This constitution supersedes all other development practices for the Ultra GitLab project.

**Amendment Process**:
1. Propose amendment via PR to this file
2. Document rationale for change
3. Require approval from project maintainer(s)
4. Update version according to semantic versioning:
   - MAJOR: Principle removal or fundamental redefinition
   - MINOR: New principle or significant expansion
   - PATCH: Clarifications, typo fixes, non-semantic changes
5. Update `LAST_AMENDED_DATE` to amendment merge date

**Compliance**:
- All PRs MUST be verified against constitution principles
- Code reviews MUST check for constitution compliance
- Violations MUST be documented and justified in PR if unavoidable
- See `CLAUDE.md` for runtime development guidance

**Version**: 1.0.0 | **Ratified**: 2026-01-30 | **Last Amended**: 2026-01-30
