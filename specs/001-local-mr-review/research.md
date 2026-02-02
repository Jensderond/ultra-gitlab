# Research: Local-First GitLab MR Review

**Feature Branch**: `001-local-mr-review`
**Date**: 2026-01-30
**Purpose**: Resolve technical decisions for implementation plan

## Summary of Decisions

| Area | Decision | Rationale |
|------|----------|-----------|
| Syntax Highlighting | tree-sitter via Rust crates | Native performance, 20+ language grammars, incremental parsing |
| Local Storage | SQLite via sqlx (async) | 35% faster than filesystem, WAL mode for concurrent access, native Tauri integration |
| HTTP Client | reqwest (blocking) | Simple API, robust error handling, built-in JSON support |
| Credential Storage | tauri-plugin-keyring | Cross-platform keychain access, well-documented, active maintenance |

---

## 1. Tree-Sitter Syntax Highlighting

### Decision
Use `tree-sitter` and `tree-sitter-highlight` Rust crates with pre-built language grammars. Parse in Rust backend, send token arrays to React frontend for rendering.

### Key Implementation Details

**Rust Dependencies**:
```toml
[dependencies]
tree-sitter = "0.25"
tree-sitter-highlight = "0.25"
tree-sitter-javascript = "0.25"
tree-sitter-typescript = "0.25"
tree-sitter-python = "0.25"
tree-sitter-rust = "0.25"
tree-sitter-go = "0.25"
```

**Token Format** (for efficient IPC):
```rust
#[derive(serde::Serialize)]
struct HighlightToken {
    start: usize,
    end: usize,
    class: String,  // e.g., "keyword", "string", "function"
}
```

**Performance Optimizations**:
- Reuse `Highlighter` instances across calls (expensive to create)
- Pre-serialize `HighlightConfiguration` at startup (1000x faster load)
- Chunk large diffs (>1000 lines) for progressive rendering
- Use Tauri channels for streaming large token arrays

**Frontend Requirements**:
- `react-window` for virtual scrolling (critical for 10k+ line diffs)
- Memoized row components to prevent re-renders
- CSS classes matching tree-sitter highlight names

### Alternatives Considered
- **Shiki/Prism in frontend**: Rejected - poor performance for large diffs, blocks main thread
- **Monaco Editor**: Rejected - too heavy for read-only diff viewing
- **CodeMirror 6**: Viable alternative, but tree-sitter offers better Rust integration

---

## 2. SQLite Local Storage

### Decision
Use `sqlx` with async SQLite for local MR caching. Store in Tauri app data directory with WAL mode enabled.

### Key Implementation Details

**Rust Dependencies**:
```toml
[dependencies]
sqlx = { version = "0.8", features = ["runtime-tokio", "sqlite"] }
tokio = { version = "1", features = ["full"] }
```

**SQLite Configuration**:
```sql
PRAGMA journal_mode = WAL;      -- Concurrent readers during sync
PRAGMA synchronous = NORMAL;    -- Balance safety and speed
PRAGMA cache_size = -64000;     -- 64MB cache
PRAGMA page_size = 8192;        -- Optimized for text blobs
```

**Database Location**:
```rust
let db_path = app.path().app_data_dir()?.join("ultra-gitlab.db");
// macOS:   ~/Library/Application Support/com.ultra-gitlab.app/
// Windows: C:\Users\<USER>\AppData\Roaming\com.ultra-gitlab.app/
// Linux:   ~/.local/share/com.ultra-gitlab.app/
```

**Performance Characteristics**:
- Small diffs (<100KB): Sub-millisecond retrieval
- Medium diffs (100KB-1MB): 1-5ms retrieval
- Large diffs (1MB-10MB): 5-50ms retrieval
- SQLite is ~35% faster than filesystem for 10KB blobs

### Schema Design
```sql
-- Core tables
CREATE TABLE gitlab_instances (id, url, name, created_at);
CREATE TABLE merge_requests (id, instance_id, iid, title, state, author_username, ...);
CREATE TABLE diffs (mr_id, content, file_count, additions, deletions, cached_at);
CREATE TABLE comments (id, mr_id, author_username, body, line_number, file_path, ...);
CREATE TABLE sync_queue (id, action_type, mr_id, payload, status, retry_count, ...);
```

### Alternatives Considered
- **rusqlite (sync)**: Rejected - would block UI thread
- **Diesel**: Rejected - steeper learning curve, heavier abstraction
- **File-based storage**: Rejected - no query capability, slower than SQLite

---

## 3. GitLab API Integration

### Decision
Use `reqwest` blocking client with `PRIVATE-TOKEN` header authentication. Wrap in typed Rust client with proper error handling.

### Key Implementation Details

**Rust Dependencies**:
```toml
[dependencies]
reqwest = { version = "0.12", features = ["blocking", "json"] }
thiserror = "2.0"
```

**Authentication**:
```rust
client.get(url)
    .header("PRIVATE-TOKEN", token)
    .send()
```

**Key Endpoints**:
| Operation | Endpoint |
|-----------|----------|
| List MRs | `GET /projects/:id/merge_requests?state=opened&scope=assigned_to_me` |
| MR Details | `GET /projects/:id/merge_requests/:iid` |
| Diffs | `GET /projects/:id/merge_requests/:iid/diffs` |
| Discussions | `GET /projects/:id/merge_requests/:iid/discussions` |
| Approve | `POST /projects/:id/merge_requests/:iid/approve` |
| Add Comment | `POST /projects/:id/merge_requests/:iid/discussions` |

**Pagination**:
- Use `per_page=100` (max) for efficiency
- Check `X-Next-Page` header for more pages
- Over 10,000 items: `X-Total` header not returned

**Rate Limiting**:
- Instance-dependent; implement exponential backoff
- Cache responses aggressively

### Error Handling
```rust
#[derive(thiserror::Error)]
pub enum Error {
    #[error("HTTP request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("GitLab API error: {0}")]
    GitLab(String),
    #[error("Authentication failed")]
    Unauthorized,
}

// Required for Tauri commands
impl serde::Serialize for Error { ... }
```

### Alternatives Considered
- **reqwest async**: Viable, but blocking is simpler for Tauri commands
- **surf**: Less mature, smaller ecosystem
- **ureq**: Lighter, but less feature-rich

---

## 4. Secure Credential Storage

### Decision
Use `tauri-plugin-keyring` for cross-platform keychain access. Fall back to encrypted file storage when keychain unavailable.

### Key Implementation Details

**Rust Dependencies**:
```toml
[dependencies]
tauri-plugin-keyring = "2"
```

**Frontend Dependencies**:
```json
{
  "dependencies": {
    "tauri-plugin-keyring-api": "^2"
  }
}
```

**Platform Support**:
| Platform | Backend |
|----------|---------|
| macOS | Keychain |
| Windows | Credential Manager |
| Linux | Secret Service (GNOME Keyring/KWallet) |

**Tauri Capabilities** (`src-tauri/capabilities/keyring.json`):
```json
{
  "identifier": "keyring-capability",
  "permissions": [
    "keyring:allow-get-password",
    "keyring:allow-set-password",
    "keyring:allow-delete-password"
  ]
}
```

**Usage**:
```typescript
import { getPassword, setPassword, deletePassword } from "tauri-plugin-keyring-api";

const SERVICE = "ultra-gitlab";
const KEY = "gitlab_pat";

await setPassword(SERVICE, KEY, token);
const token = await getPassword(SERVICE, KEY);
```

**Fallback Strategy**:
When keychain unavailable (headless Linux, containers):
1. Detect failure on first access
2. Warn user about reduced security
3. Store encrypted token in app data directory
4. Use machine-specific key for encryption

### Alternatives Considered
- **tauri-plugin-stronghold**: Rejected - being deprecated in Tauri v3
- **tauri-plugin-secure-storage**: Viable alternative, less documentation
- **File-based only**: Rejected - insufficient security for PATs

---

## Implementation Priority

1. **SQLite + Migrations**: Foundation for all data storage
2. **GitLab Client**: Enables fetching real MR data
3. **Credential Storage**: Required before storing tokens
4. **Tree-sitter**: Can be added after basic diff viewing works

---

## Resources

### Tree-sitter
- [Tree-sitter Documentation](https://tree-sitter.github.io/tree-sitter/)
- [tree-sitter-highlight crate](https://docs.rs/tree-sitter-highlight)

### SQLite
- [sqlx Documentation](https://docs.rs/sqlx)
- [SQLite WAL Mode](https://sqlite.org/wal.html)
- [Tauri SQL Plugin](https://v2.tauri.app/plugin/sql/)

### GitLab API
- [Merge Requests API](https://docs.gitlab.com/api/merge_requests/)
- [Discussions API](https://docs.gitlab.com/api/discussions/)
- [Approvals API](https://docs.gitlab.com/api/merge_request_approvals/)

### Credentials
- [tauri-plugin-keyring](https://github.com/HuakunShen/tauri-plugin-keyring)
- [Rust keyring crate](https://docs.rs/keyring)
