-- Migration: 0001_initial_schema.sql
-- Creates the initial database schema for local MR caching.

-- GitLab instance configuration
CREATE TABLE IF NOT EXISTS gitlab_instances (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    url TEXT NOT NULL UNIQUE,
    name TEXT,
    token TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Merge requests with metadata
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

CREATE INDEX IF NOT EXISTS idx_mr_state ON merge_requests(state);
CREATE INDEX IF NOT EXISTS idx_mr_updated ON merge_requests(updated_at DESC);

-- Complete diff content for an MR
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

-- Individual file changes within an MR
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

CREATE INDEX IF NOT EXISTS idx_diff_files_mr ON diff_files(mr_id);

-- Comments and discussions on MRs
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

CREATE INDEX IF NOT EXISTS idx_comments_mr ON comments(mr_id);
CREATE INDEX IF NOT EXISTS idx_comments_file ON comments(mr_id, file_path);

-- Queue for pending sync actions
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

CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);

-- Log of recent sync operations
CREATE TABLE IF NOT EXISTS sync_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    operation TEXT NOT NULL,
    status TEXT NOT NULL,
    mr_id INTEGER,
    message TEXT,
    duration_ms INTEGER,
    timestamp INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_sync_log_timestamp ON sync_log(timestamp DESC);
