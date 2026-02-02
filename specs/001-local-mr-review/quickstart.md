# Quickstart: Local-First GitLab MR Review

**Feature Branch**: `001-local-mr-review`
**Date**: 2026-01-30

## Prerequisites

- **Bun** (latest) - Package manager
- **Rust** (stable) - Via rustup
- **Node.js** 18+ - For Vite
- **Platform SDKs** (for Tauri):
  - macOS: Xcode Command Line Tools
  - Windows: Build Tools for Visual Studio, WebView2
  - Linux: webkit2gtk, build-essential

## Quick Setup

```bash
# Clone and enter project
cd ultra-gitlab

# Install frontend dependencies
bun install

# Development mode (hot reload)
bun run tauri dev

# Build for production
bun run tauri build
```

## Configuration

### GitLab Instance Setup

1. Launch the application
2. Click "Add GitLab Instance" or press `Cmd+,` (settings)
3. Enter:
   - **URL**: Your GitLab instance (e.g., `https://gitlab.com`)
   - **Personal Access Token**: Token with `read_api`, `write_api` scopes
   - **Name**: Optional display name
4. Click "Connect" - the app validates and stores credentials securely

### Keyboard Shortcuts

| Action | Shortcut |
|--------|----------|
| Navigate MR list | `j` / `k` (down/up) |
| Open selected MR | `Enter` |
| Next/prev file in diff | `n` / `p` |
| Next/prev change in diff | `]` / `[` |
| Add inline comment | `c` |
| Approve MR | `a` |
| Open command palette | `Cmd+P` / `Ctrl+P` |
| Trigger manual sync | `Cmd+R` / `Ctrl+R` |
| Show keyboard help | `?` |

## Development

### Project Structure

```
ultra-gitlab/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── services/           # Tauri command wrappers
│   ├── hooks/              # React hooks
│   └── types/              # TypeScript types
├── src-tauri/              # Rust backend
│   ├── src/
│   │   ├── commands/       # Tauri IPC handlers
│   │   ├── models/         # Data structures
│   │   ├── services/       # Business logic
│   │   └── db/             # SQLite management
│   └── migrations/         # Database migrations
└── specs/                  # Feature specifications
```

### Running Tests

```bash
# Frontend tests
bun run test

# Rust tests
cd src-tauri && cargo test

# Type checking
bun run typecheck

# Linting
bun run lint
```

### Database Location

Local cache stored at:
- **macOS**: `~/Library/Application Support/com.ultra-gitlab.app/ultra-gitlab.db`
- **Windows**: `%APPDATA%\com.ultra-gitlab.app\ultra-gitlab.db`
- **Linux**: `~/.local/share/com.ultra-gitlab.app/ultra-gitlab.db`

### Debugging

```bash
# Enable Rust logging
RUST_LOG=debug bun run tauri dev

# Frontend debugging
# Open DevTools: View > Toggle Developer Tools
```

## Verification

After setup, verify the following works:

1. **Connection**: GitLab instance shows as connected
2. **Initial Sync**: MRs appear in list (check sync status bar)
3. **Offline Access**: MRs accessible with network disabled
4. **Keyboard Navigation**: `j`/`k` navigates MR list
5. **Diff Viewing**: Select MR, see syntax-highlighted diff
6. **Comments**: View existing comments on MRs
7. **Approval**: Approve button shows immediate feedback

## Troubleshooting

### "Authentication Failed"
- Verify token has `read_api` and `api` scopes
- Check token hasn't expired
- Ensure URL includes protocol (`https://`)

### "No MRs Found"
- Wait for initial sync to complete (check status bar)
- Verify you have MRs where you're author or reviewer
- Try manual sync: `Cmd+R`

### "Sync Failed"
- Check network connectivity
- Verify GitLab instance is reachable
- Check sync log for specific error (click status bar)

### "Diff Not Loading"
- Large diffs may take longer to process
- Check if MR has been synced (not just metadata)
- Try manual sync for specific MR

## Next Steps

- Review [spec.md](./spec.md) for full requirements
- See [data-model.md](./data-model.md) for entity details
- Check [contracts/tauri-commands.md](./contracts/tauri-commands.md) for API reference
