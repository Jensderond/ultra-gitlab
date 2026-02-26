-- Migration: 0015_fix_mr_unique_constraint.sql
-- Fix UNIQUE constraint on merge_requests: iid is project-scoped, not instance-scoped.
-- The old UNIQUE(instance_id, iid) caused MRs from different projects with the same
-- iid to overwrite each other. The correct key is (instance_id, project_id, iid).
--
-- SQLite cannot ALTER a UNIQUE constraint, so we rebuild the table.
-- First, purge all MR data (it will be re-synced on next startup).

-- Delete child records (order matters for FK constraints)
DELETE FROM sync_queue;
DELETE FROM mr_reviewers;
DELETE FROM file_versions;
DELETE FROM file_blobs WHERE sha NOT IN (SELECT sha FROM file_versions);
DELETE FROM diff_files;
DELETE FROM diffs;
DELETE FROM comments;
DELETE FROM merge_requests;

-- Rebuild merge_requests with the corrected UNIQUE constraint
DROP TABLE IF EXISTS merge_requests;

CREATE TABLE merge_requests (
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
    user_has_approved INTEGER,
    project_name TEXT,
    head_pipeline_status TEXT,
    FOREIGN KEY (instance_id) REFERENCES gitlab_instances(id) ON DELETE CASCADE,
    UNIQUE(instance_id, project_id, iid)
);

CREATE INDEX IF NOT EXISTS idx_mr_state ON merge_requests(state);
CREATE INDEX IF NOT EXISTS idx_mr_updated ON merge_requests(updated_at DESC);
