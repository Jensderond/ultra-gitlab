-- Migration: 0009_create_mr_reviewers.sql
-- Stores per-reviewer approval status for merge requests.

CREATE TABLE IF NOT EXISTS mr_reviewers (
    mr_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    avatar_url TEXT,
    cached_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    PRIMARY KEY (mr_id, username),
    FOREIGN KEY (mr_id) REFERENCES merge_requests(id) ON DELETE CASCADE
);
