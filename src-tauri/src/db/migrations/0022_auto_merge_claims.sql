-- Migration: 0022_auto_merge_claims.sql
-- Tracks merge requests the user has "claimed" for auto-merge. The background
-- sync engine polls each claim, rebases when needed, and POSTs the merge once
-- GitLab reports the MR as mergeable.

CREATE TABLE IF NOT EXISTS auto_merge_claims (
    mr_id INTEGER PRIMARY KEY,
    claimed_at INTEGER NOT NULL,
    last_status TEXT,
    last_error TEXT,
    last_attempt_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (mr_id) REFERENCES merge_requests(id) ON DELETE CASCADE
);
