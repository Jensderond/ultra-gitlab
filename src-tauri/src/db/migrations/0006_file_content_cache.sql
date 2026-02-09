-- Migration: 0006_file_content_cache.sql
-- Creates tables for caching full file content (base + head versions)
-- during background sync so file viewing in the diff viewer is instant.

-- Deduplicated blob storage keyed by SHA-256 hash of file content
CREATE TABLE IF NOT EXISTS file_blobs (
    sha TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    size_bytes INTEGER NOT NULL,
    cached_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
);

-- Tracks which file versions belong to which MR
CREATE TABLE IF NOT EXISTS file_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mr_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    version_type TEXT NOT NULL CHECK (version_type IN ('base', 'head')),
    sha TEXT NOT NULL REFERENCES file_blobs(sha),
    instance_id TEXT NOT NULL,
    project_id INTEGER NOT NULL,
    UNIQUE(mr_id, file_path, version_type)
);

CREATE INDEX IF NOT EXISTS idx_file_versions_mr ON file_versions(mr_id);
