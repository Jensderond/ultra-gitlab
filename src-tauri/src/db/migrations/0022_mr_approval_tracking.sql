-- Migration: 0022_mr_approval_tracking.sql
-- Adds updated_at column to file_versions (for detecting changes since approval)
-- and a table to track per-MR approval checkpoints.

ALTER TABLE file_versions ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_file_versions_updated_at
  ON file_versions(mr_id, version_type, updated_at);

CREATE TABLE IF NOT EXISTS mr_approval_checkpoints (
    mr_id INTEGER PRIMARY KEY,
    approved_at INTEGER NOT NULL
);
