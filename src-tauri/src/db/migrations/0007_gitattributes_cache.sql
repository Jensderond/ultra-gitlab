-- Migration: 0007_gitattributes_cache.sql
-- Creates a table for caching parsed .gitattributes linguist-generated patterns
-- per project so they can be served instantly without network requests.

CREATE TABLE IF NOT EXISTS gitattributes_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    instance_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    patterns TEXT NOT NULL DEFAULT '[]',
    fetched_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    FOREIGN KEY (instance_id) REFERENCES gitlab_instances(id) ON DELETE CASCADE,
    UNIQUE(instance_id, project_id)
);
