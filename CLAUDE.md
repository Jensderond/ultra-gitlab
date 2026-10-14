# Ultra GitLab

Tauri v2 desktop application with React 19, TypeScript, and Vite.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite 7
- **Backend**: Tauri 2 (Rust)
- **Package Manager**: Bun

## Commands

```bash
# Install dependencies
bun install

# Development (frontend only)
bun run dev

# Development (full Tauri app)
bun run tauri dev

# Build for production
bun run tauri build
```

## Project Structure

```
src/           # React frontend (classic UI)
  main.tsx     # Loader: boots the classic or native UI (see uiVariant.ts)
  native/      # Native UI beta (desktop only), self-contained
src-tauri/     # Rust backend (shared by both UIs)
  src/         # Rust source code
  Cargo.toml   # Rust dependencies
e2e/           # Classic UI Playwright tests
  native/      # Native UI Playwright tests (own fixtures)
```

## Two UIs, one build

The classic UI and the native UI beta ship in the same build. Users opt in from
classic Settings → Native UI (beta) and switch back from native Settings →
General. The choice is stored as `ui_variant` in `settings.json` and read by
the backend at startup (`commands/ui_variant.rs`): it builds the matching
window (native = transparent + sidebar vibrancy) and injects
`window.__ULTRA_UI__` for `src/uiVariant.ts`. Switching relaunches the app.
iOS always boots classic. In a plain browser, `?ui=native` picks the native UI.

Never import across the two UIs (`src/native/**` ↔ the rest of `src/`); only
`src/uiVariant.ts` is shared. Each UI's CSS is global, so a stray import would
leak styles into the other.

## Tauri IPC

Use `@tauri-apps/api` for frontend-to-backend communication via `invoke()`.

When doing tests make sure to actually use the real credentials so you can fetch merge requests!

TEST CREDENTIALS can be fetched from credentials.md (not in git)

## Active Technologies
- TypeScript 5.8+ (frontend), Rust stable (backend via Tauri 2) + React 19, Tauri 2, tree-sitter (syntax highlighting), SQLite (local storage) (001-local-mr-review)
- SQLite via Tauri for MR cache and credentials (001-local-mr-review)

## Recent Changes
- 001-local-mr-review: Added TypeScript 5.8+ (frontend), Rust stable (backend via Tauri 2) + React 19, Tauri 2, tree-sitter (syntax highlighting), SQLite (local storage)
