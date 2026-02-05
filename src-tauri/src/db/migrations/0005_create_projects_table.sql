-- Migration: 0005_create_projects_table.sql
-- Creates a normalized projects table for caching GitLab project metadata.
-- Project titles (name_with_namespace) are displayed on MR cards instead of URL-derived paths.

CREATE TABLE IF NOT EXISTS projects (
    id INTEGER NOT NULL,
    instance_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    name_with_namespace TEXT NOT NULL,
    path_with_namespace TEXT NOT NULL,
    web_url TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT,
    PRIMARY KEY (id, instance_id),
    FOREIGN KEY (instance_id) REFERENCES gitlab_instances(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_projects_instance ON projects(instance_id);
