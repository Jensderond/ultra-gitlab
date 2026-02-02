# Data Model: Local-First GitLab MR Review

**Feature Branch**: `001-local-mr-review`
**Date**: 2026-01-30

## Entity Overview

```
GitLabInstance 1──* MergeRequest 1──1 Diff
                          │
                          ├──* DiffFile
                          │
                          ├──* Comment
                          │
                          └──* SyncAction
```

---

## Entities

### GitLabInstance

Represents a configured GitLab server connection.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PK, AUTO | Local database ID |
| url | TEXT | UNIQUE, NOT NULL | GitLab instance URL (e.g., `https://gitlab.com`) |
| name | TEXT | | Display name for the instance |
| created_at | INTEGER | NOT NULL | Unix timestamp of creation |

**Indexes**: `url` (unique)

---

### MergeRequest

Represents a GitLab merge request with metadata.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PK | GitLab MR ID (global) |
| instance_id | INTEGER | FK(GitLabInstance), NOT NULL | Parent GitLab instance |
| iid | INTEGER | NOT NULL | Project-scoped MR number |
| project_id | INTEGER | NOT NULL | GitLab project ID |
| title | TEXT | NOT NULL | MR title |
| description | TEXT | | MR description (Markdown) |
| author_username | TEXT | NOT NULL | Author's GitLab username |
| source_branch | TEXT | NOT NULL | Branch being merged |
| target_branch | TEXT | NOT NULL | Destination branch |
| state | TEXT | NOT NULL | `opened`, `merged`, `closed` |
| web_url | TEXT | NOT NULL | URL to MR in GitLab web UI |
| created_at | INTEGER | NOT NULL | MR creation timestamp |
| updated_at | INTEGER | NOT NULL | MR last update timestamp |
| merged_at | INTEGER | | Merge timestamp (if merged) |
| approval_status | TEXT | | `approved`, `pending`, `changes_requested` |
| approvals_required | INTEGER | | Number of approvals needed |
| approvals_count | INTEGER | | Current approval count |
| labels | TEXT | | JSON array of labels |
| reviewers | TEXT | | JSON array of reviewer usernames |
| cached_at | INTEGER | NOT NULL | When this data was cached locally |

**Indexes**:
- `(instance_id, iid)` UNIQUE
- `state`
- `updated_at DESC`

**State Transitions**:
```
opened → merged   (via GitLab merge)
opened → closed   (via GitLab close)
closed → opened   (via GitLab reopen)
```

---

### Diff

Stores the complete diff content for an MR.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| mr_id | INTEGER | PK, FK(MergeRequest) | Parent MR |
| content | TEXT | NOT NULL | Complete unified diff text |
| base_sha | TEXT | NOT NULL | Base commit SHA |
| head_sha | TEXT | NOT NULL | Head commit SHA |
| start_sha | TEXT | NOT NULL | Start commit SHA |
| file_count | INTEGER | NOT NULL | Number of changed files |
| additions | INTEGER | NOT NULL | Total lines added |
| deletions | INTEGER | NOT NULL | Total lines deleted |
| cached_at | INTEGER | NOT NULL | Cache timestamp |

**Storage Notes**:
- `content` can be large (10MB+ for big diffs)
- SQLite TEXT handles up to 2GB per field
- WAL mode ensures reads don't block during updates

---

### DiffFile

Individual file change within an MR (for navigation).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PK, AUTO | Local ID |
| mr_id | INTEGER | FK(MergeRequest), NOT NULL | Parent MR |
| old_path | TEXT | | Previous file path (for renames/deletes) |
| new_path | TEXT | NOT NULL | Current file path |
| change_type | TEXT | NOT NULL | `added`, `modified`, `deleted`, `renamed` |
| additions | INTEGER | NOT NULL | Lines added in this file |
| deletions | INTEGER | NOT NULL | Lines deleted in this file |
| file_position | INTEGER | NOT NULL | Order in diff for navigation |
| diff_content | TEXT | | Per-file unified diff |

**Indexes**:
- `mr_id`
- `(mr_id, file_position)`

---

### Comment

Inline comment or discussion on a diff.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PK | GitLab note/comment ID |
| mr_id | INTEGER | FK(MergeRequest), NOT NULL | Parent MR |
| discussion_id | TEXT | | GitLab discussion thread ID |
| parent_id | INTEGER | FK(Comment) | Parent comment for replies |
| author_username | TEXT | NOT NULL | Comment author |
| body | TEXT | NOT NULL | Comment content (Markdown) |
| file_path | TEXT | | File path for inline comments |
| old_line | INTEGER | | Line in old version (for deletions) |
| new_line | INTEGER | | Line in new version (for additions) |
| line_type | TEXT | | `added`, `removed`, `context` |
| resolved | BOOLEAN | NOT NULL, DEFAULT 0 | Thread resolution status |
| resolvable | BOOLEAN | NOT NULL, DEFAULT 1 | Can this comment be resolved |
| system | BOOLEAN | NOT NULL, DEFAULT 0 | System-generated comment |
| created_at | INTEGER | NOT NULL | Creation timestamp |
| updated_at | INTEGER | NOT NULL | Last update timestamp |
| cached_at | INTEGER | NOT NULL | Cache timestamp |
| is_local | BOOLEAN | NOT NULL, DEFAULT 0 | Pending sync to GitLab |

**Indexes**:
- `mr_id`
- `(mr_id, file_path)`
- `discussion_id`

**Comment Types**:
- **General comment**: `file_path` is NULL
- **Inline comment**: `file_path` + (`old_line` or `new_line`)
- **Reply**: `parent_id` is set

---

### SyncAction

Queued local actions pending synchronization to GitLab.

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PK, AUTO | Local action ID |
| mr_id | INTEGER | FK(MergeRequest), NOT NULL | Target MR |
| action_type | TEXT | NOT NULL | `approve`, `comment`, `reply`, `resolve`, `unresolve` |
| payload | TEXT | NOT NULL | JSON payload for GitLab API |
| local_reference_id | INTEGER | | Local Comment.id for comments |
| status | TEXT | NOT NULL, DEFAULT 'pending' | `pending`, `syncing`, `synced`, `failed` |
| retry_count | INTEGER | NOT NULL, DEFAULT 0 | Number of sync attempts |
| last_error | TEXT | | Last error message |
| created_at | INTEGER | NOT NULL | When action was created locally |
| synced_at | INTEGER | | When successfully synced |

**Indexes**:
- `status`
- `(status, created_at)`

**Status Transitions**:
```
pending → syncing   (sync engine picks up)
syncing → synced    (GitLab confirms)
syncing → failed    (after max retries)
syncing → pending   (retry scheduled)
```

---

### SyncLog

Log of recent sync operations (for status bar display).

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| id | INTEGER | PK, AUTO | Log entry ID |
| operation | TEXT | NOT NULL | `fetch_mrs`, `fetch_diff`, `push_comment`, etc. |
| status | TEXT | NOT NULL | `success`, `error` |
| mr_id | INTEGER | | Related MR (if applicable) |
| message | TEXT | | Details or error message |
| duration_ms | INTEGER | | Operation duration |
| timestamp | INTEGER | NOT NULL | When operation occurred |

**Indexes**:
- `timestamp DESC`

**Retention**: Keep last 50 entries; purge older on each sync.

---

## Validation Rules

### MergeRequest
- `state` must be one of: `opened`, `merged`, `closed`
- `iid` must be positive integer
- `source_branch` ≠ `target_branch`

### Comment
- If `file_path` is set, at least one of `old_line` or `new_line` must be set
- `body` must not be empty
- `line_type` must be one of: `added`, `removed`, `context`, or NULL

### SyncAction
- `action_type` must be one of: `approve`, `comment`, `reply`, `resolve`, `unresolve`
- `payload` must be valid JSON
- `retry_count` ≤ 5 before marking as `failed`

---

## TypeScript Interfaces

```typescript
// Frontend types matching Rust models

interface MergeRequest {
  id: number;
  iid: number;
  projectId: number;
  title: string;
  description: string | null;
  authorUsername: string;
  sourceBranch: string;
  targetBranch: string;
  state: 'opened' | 'merged' | 'closed';
  webUrl: string;
  createdAt: number;
  updatedAt: number;
  mergedAt: number | null;
  approvalStatus: 'approved' | 'pending' | 'changes_requested' | null;
  approvalsRequired: number | null;
  approvalsCount: number | null;
  labels: string[];
  reviewers: string[];
}

interface DiffFile {
  id: number;
  mrId: number;
  oldPath: string | null;
  newPath: string;
  changeType: 'added' | 'modified' | 'deleted' | 'renamed';
  additions: number;
  deletions: number;
  filePosition: number;
}

interface Comment {
  id: number;
  mrId: number;
  discussionId: string | null;
  parentId: number | null;
  authorUsername: string;
  body: string;
  filePath: string | null;
  oldLine: number | null;
  newLine: number | null;
  resolved: boolean;
  system: boolean;
  createdAt: number;
  updatedAt: number;
  isLocal: boolean;
}

interface SyncAction {
  id: number;
  mrId: number;
  actionType: 'approve' | 'comment' | 'reply' | 'resolve' | 'unresolve';
  status: 'pending' | 'syncing' | 'synced' | 'failed';
  retryCount: number;
  lastError: string | null;
  createdAt: number;
}

interface SyncStatus {
  lastSyncTime: number | null;
  isSyncing: boolean;
  pendingActionsCount: number;
  failedActionsCount: number;
  recentLogs: SyncLogEntry[];
}

interface SyncLogEntry {
  id: number;
  operation: string;
  status: 'success' | 'error';
  message: string | null;
  timestamp: number;
}
```

---

## SQLite Migration

```sql
-- Migration: 0001_initial_schema.sql

CREATE TABLE IF NOT EXISTS gitlab_instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    name TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE TABLE IF NOT EXISTS merge_requests (
    id INTEGER PRIMARY KEY,
    instance_id INTEGER NOT NULL,
    iid INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    author_username TEXT NOT NULL,
    source_branch TEXT NOT NULL,
    target_branch TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('opened', 'merged', 'closed')),
    web_url TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    merged_at INTEGER,
    approval_status TEXT,
    approvals_required INTEGER,
    approvals_count INTEGER,
    labels TEXT DEFAULT '[]',
    reviewers TEXT DEFAULT '[]',
    cached_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (instance_id) REFERENCES gitlab_instances(id) ON DELETE CASCADE,
    UNIQUE(instance_id, iid)
);

CREATE INDEX idx_mr_state ON merge_requests(state);
CREATE INDEX idx_mr_updated ON merge_requests(updated_at DESC);

CREATE TABLE IF NOT EXISTS diffs (
    mr_id INTEGER PRIMARY KEY,
    content TEXT NOT NULL,
    base_sha TEXT NOT NULL,
    head_sha TEXT NOT NULL,
    start_sha TEXT NOT NULL,
    file_count INTEGER NOT NULL,
    additions INTEGER NOT NULL,
    deletions INTEGER NOT NULL,
    cached_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (mr_id) REFERENCES merge_requests(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS diff_files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mr_id INTEGER NOT NULL,
    old_path TEXT,
    new_path TEXT NOT NULL,
    change_type TEXT NOT NULL CHECK (change_type IN ('added', 'modified', 'deleted', 'renamed')),
    additions INTEGER NOT NULL,
    deletions INTEGER NOT NULL,
    file_position INTEGER NOT NULL,
    diff_content TEXT,
    FOREIGN KEY (mr_id) REFERENCES merge_requests(id) ON DELETE CASCADE
);

CREATE INDEX idx_diff_files_mr ON diff_files(mr_id);

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY,
    mr_id INTEGER NOT NULL,
    discussion_id TEXT,
    parent_id INTEGER,
    author_username TEXT NOT NULL,
    body TEXT NOT NULL,
    file_path TEXT,
    old_line INTEGER,
    new_line INTEGER,
    line_type TEXT,
    resolved INTEGER NOT NULL DEFAULT 0,
    resolvable INTEGER NOT NULL DEFAULT 1,
    system INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    cached_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    is_local INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (mr_id) REFERENCES merge_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
);

CREATE INDEX idx_comments_mr ON comments(mr_id);
CREATE INDEX idx_comments_file ON comments(mr_id, file_path);

CREATE TABLE IF NOT EXISTS sync_queue (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mr_id INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    local_reference_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'synced', 'failed')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    synced_at INTEGER,
    FOREIGN KEY (mr_id) REFERENCES merge_requests(id) ON DELETE CASCADE
);

CREATE INDEX idx_sync_queue_status ON sync_queue(status, created_at);

CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation TEXT NOT NULL,
    status TEXT NOT NULL,
    mr_id INTEGER,
    message TEXT,
    duration_ms INTEGER,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX idx_sync_log_timestamp ON sync_log(timestamp DESC);
```
