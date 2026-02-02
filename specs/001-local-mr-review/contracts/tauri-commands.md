# Tauri IPC Commands Contract

**Feature Branch**: `001-local-mr-review`
**Date**: 2026-01-30

## Overview

All frontend-backend communication uses Tauri's `invoke()` IPC mechanism. Commands are defined in Rust and called from TypeScript.

---

## Authentication Commands

### `setup_gitlab_instance`

Configure a GitLab instance connection.

**Request**:
```typescript
invoke('setup_gitlab_instance', {
  url: string,        // e.g., "https://gitlab.com"
  token: string,      // Personal Access Token
  name?: string       // Optional display name
})
```

**Response**:
```typescript
{
  id: number,
  url: string,
  name: string | null,
  validated: boolean  // Token validated against GitLab API
}
```

**Errors**:
- `InvalidUrl`: URL is malformed
- `AuthenticationFailed`: Token is invalid or expired
- `NetworkError`: Cannot reach GitLab instance

---

### `get_gitlab_instances`

List all configured GitLab instances.

**Request**:
```typescript
invoke('get_gitlab_instances')
```

**Response**:
```typescript
Array<{
  id: number,
  url: string,
  name: string | null
}>
```

---

### `delete_gitlab_instance`

Remove a GitLab instance and all its cached data.

**Request**:
```typescript
invoke('delete_gitlab_instance', { instanceId: number })
```

**Response**:
```typescript
{ success: boolean }
```

---

## Merge Request Commands

### `get_merge_requests`

Get cached merge requests from local storage.

**Request**:
```typescript
invoke('get_merge_requests', {
  instanceId: number,
  filter?: {
    state?: 'opened' | 'merged' | 'closed' | 'all',
    scope?: 'authored' | 'reviewing' | 'all',
    search?: string
  }
})
```

**Response**:
```typescript
Array<{
  id: number,
  iid: number,
  projectId: number,
  title: string,
  description: string | null,
  authorUsername: string,
  sourceBranch: string,
  targetBranch: string,
  state: 'opened' | 'merged' | 'closed',
  webUrl: string,
  createdAt: number,
  updatedAt: number,
  approvalStatus: 'approved' | 'pending' | 'changes_requested' | null,
  approvalsCount: number | null,
  approvalsRequired: number | null,
  labels: string[],
  reviewers: string[],
  cachedAt: number
}>
```

**Notes**:
- Returns instantly from local cache
- No network request made
- Returns empty array if not yet synced

---

### `get_merge_request_detail`

Get detailed MR information including diff summary.

**Request**:
```typescript
invoke('get_merge_request_detail', {
  mrId: number
})
```

**Response**:
```typescript
{
  mr: MergeRequest,
  diffSummary: {
    fileCount: number,
    additions: number,
    deletions: number,
    files: Array<{
      newPath: string,
      oldPath: string | null,
      changeType: 'added' | 'modified' | 'deleted' | 'renamed',
      additions: number,
      deletions: number
    }>
  },
  pendingActions: number  // Count of local actions not yet synced
}
```

---

### `get_diff_content`

Get the full diff content for an MR.

**Request**:
```typescript
invoke('get_diff_content', {
  mrId: number,
  filePath?: string  // Optional: specific file only
})
```

**Response**:
```typescript
{
  baseHash: string,
  headHash: string,
  content: string,  // Unified diff format
  highlightedTokens?: Array<{
    start: number,
    end: number,
    class: string
  }>
}
```

**Notes**:
- If `filePath` provided, returns only that file's diff
- `highlightedTokens` included when syntax highlighting enabled
- Large diffs may be streamed via events (see Sync Events)

---

### `get_diff_file`

Get diff content for a specific file with syntax highlighting.

**Request**:
```typescript
invoke('get_diff_file', {
  mrId: number,
  filePath: string
})
```

**Response**:
```typescript
{
  filePath: string,
  oldContent: string | null,  // null for new files
  newContent: string | null,  // null for deleted files
  diffHunks: Array<{
    oldStart: number,
    oldCount: number,
    newStart: number,
    newCount: number,
    lines: Array<{
      type: 'add' | 'remove' | 'context',
      content: string,
      oldLineNumber: number | null,
      newLineNumber: number | null,
      tokens: Array<{ start: number, end: number, class: string }>
    }>
  }>
}
```

---

## Comment Commands

### `get_comments`

Get all comments for an MR.

**Request**:
```typescript
invoke('get_comments', {
  mrId: number,
  filePath?: string  // Optional: comments for specific file
})
```

**Response**:
```typescript
Array<{
  id: number,
  discussionId: string | null,
  parentId: number | null,
  authorUsername: string,
  body: string,
  filePath: string | null,
  oldLine: number | null,
  newLine: number | null,
  resolved: boolean,
  system: boolean,
  createdAt: number,
  updatedAt: number,
  isLocal: boolean,      // Not yet synced
  syncStatus: 'synced' | 'pending' | 'failed' | null
}>
```

---

### `add_comment`

Add a new comment (general or inline).

**Request**:
```typescript
invoke('add_comment', {
  mrId: number,
  body: string,
  position?: {
    filePath: string,
    oldLine?: number,   // For removed lines
    newLine?: number    // For added lines
  }
})
```

**Response**:
```typescript
{
  localId: number,      // Local ID before sync
  syncActionId: number  // ID in sync queue
}
```

**Notes**:
- Comment appears immediately in UI with `isLocal: true`
- Sync engine will push to GitLab asynchronously

---

### `reply_to_comment`

Reply to an existing discussion thread.

**Request**:
```typescript
invoke('reply_to_comment', {
  mrId: number,
  discussionId: string,
  body: string
})
```

**Response**:
```typescript
{
  localId: number,
  syncActionId: number
}
```

---

### `resolve_discussion`

Resolve or unresolve a discussion thread.

**Request**:
```typescript
invoke('resolve_discussion', {
  mrId: number,
  discussionId: string,
  resolved: boolean
})
```

**Response**:
```typescript
{
  syncActionId: number
}
```

---

## Approval Commands

### `approve_mr`

Approve a merge request.

**Request**:
```typescript
invoke('approve_mr', { mrId: number })
```

**Response**:
```typescript
{
  syncActionId: number,
  localStatus: 'approved'  // Optimistic update
}
```

---

### `unapprove_mr`

Remove approval from a merge request.

**Request**:
```typescript
invoke('unapprove_mr', { mrId: number })
```

**Response**:
```typescript
{
  syncActionId: number,
  localStatus: 'pending'
}
```

---

## Sync Commands

### `trigger_sync`

Manually trigger a sync with GitLab.

**Request**:
```typescript
invoke('trigger_sync', {
  instanceId?: number,  // Optional: specific instance
  mrId?: number        // Optional: specific MR
})
```

**Response**:
```typescript
{
  started: boolean,
  queuePosition: number  // 0 if started immediately
}
```

---

### `get_sync_status`

Get current sync status.

**Request**:
```typescript
invoke('get_sync_status')
```

**Response**:
```typescript
{
  isSyncing: boolean,
  lastSyncTime: number | null,
  nextSyncTime: number | null,
  pendingActions: number,
  failedActions: number,
  recentLogs: Array<{
    operation: string,
    status: 'success' | 'error',
    message: string | null,
    timestamp: number
  }>
}
```

---

### `retry_failed_actions`

Retry all failed sync actions.

**Request**:
```typescript
invoke('retry_failed_actions', {
  mrId?: number  // Optional: specific MR only
})
```

**Response**:
```typescript
{
  retriedCount: number
}
```

---

### `discard_failed_action`

Discard a failed sync action (will not sync to GitLab).

**Request**:
```typescript
invoke('discard_failed_action', {
  syncActionId: number
})
```

**Response**:
```typescript
{ success: boolean }
```

---

## Settings Commands

### `get_settings`

Get application settings.

**Request**:
```typescript
invoke('get_settings')
```

**Response**:
```typescript
{
  syncIntervalMinutes: number,
  theme: 'light' | 'dark' | 'system',
  keyboardShortcuts: Record<string, string>,
  diffViewMode: 'unified' | 'split'
}
```

---

### `update_settings`

Update application settings.

**Request**:
```typescript
invoke('update_settings', {
  syncIntervalMinutes?: number,
  theme?: 'light' | 'dark' | 'system',
  keyboardShortcuts?: Record<string, string>,
  diffViewMode?: 'unified' | 'split'
})
```

**Response**:
```typescript
{ success: boolean }
```

---

## Event Subscriptions

### Tauri Event: `sync-progress`

Emitted during sync operations.

**Payload**:
```typescript
{
  type: 'started' | 'progress' | 'completed' | 'error',
  operation: string,
  current?: number,
  total?: number,
  message?: string
}
```

**Usage**:
```typescript
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen<SyncProgressPayload>('sync-progress', (event) => {
  console.log('Sync progress:', event.payload);
});
```

---

### Tauri Event: `mr-updated`

Emitted when an MR is updated locally or from sync.

**Payload**:
```typescript
{
  mrId: number,
  source: 'local' | 'remote',
  changes: ('metadata' | 'diff' | 'comments' | 'approval')[]
}
```

---

### Tauri Event: `action-synced`

Emitted when a local action is synced to GitLab.

**Payload**:
```typescript
{
  syncActionId: number,
  mrId: number,
  actionType: string,
  success: boolean,
  error?: string,
  gitlabId?: number  // GitLab ID of created resource
}
```

---

## Error Codes

All commands may return errors with these codes:

| Code | Description |
|------|-------------|
| `NotFound` | Requested resource not in local cache |
| `NetworkError` | Cannot reach GitLab (for sync operations) |
| `AuthenticationFailed` | Token invalid or expired |
| `ValidationError` | Invalid input parameters |
| `DatabaseError` | Local storage error |
| `SyncConflict` | Action conflicts with remote state |
| `RateLimited` | GitLab API rate limit exceeded |

**Error Response Format**:
```typescript
{
  code: string,
  message: string,
  details?: Record<string, unknown>
}
```
