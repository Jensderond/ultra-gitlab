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
src/           # React frontend
src-tauri/     # Rust backend
  src/         # Rust source code
  Cargo.toml   # Rust dependencies
```

## Tauri IPC

Use `@tauri-apps/api` for frontend-to-backend communication via `invoke()`.

When doing tests make sure to actually use the real credentials so you can fetch merge requests!

TEST CREDENTIALS can be fetched from credentials.md (not in git)
