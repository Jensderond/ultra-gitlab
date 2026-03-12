-- Add is_default column to gitlab_instances.
-- Only one instance can be the default at a time.
ALTER TABLE gitlab_instances ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
