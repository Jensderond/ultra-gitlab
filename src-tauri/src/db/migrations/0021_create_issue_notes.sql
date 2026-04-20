-- Migration: 0021_create_issue_notes.sql
-- Caches GitLab issue notes (comments) locally so the Issue Detail page can
-- render without a network round-trip. Rows are upserted on `refresh_issue_detail`
-- and looked up on `list_cached_issue_notes`.

CREATE TABLE IF NOT EXISTS issue_notes (
    id INTEGER NOT NULL,
    instance_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    issue_iid INTEGER NOT NULL,
    body TEXT NOT NULL,
    author_username TEXT NOT NULL,
    author_name TEXT NOT NULL,
    author_avatar_url TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    system INTEGER NOT NULL DEFAULT 0,
    cached_at INTEGER NOT NULL,
    PRIMARY KEY (id, instance_id),
    FOREIGN KEY (instance_id) REFERENCES gitlab_instances(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issue_notes_lookup
    ON issue_notes(instance_id, project_id, issue_iid, created_at);
