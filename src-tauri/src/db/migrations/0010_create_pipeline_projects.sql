-- Migration: 0010_create_pipeline_projects.sql
-- Creates a pipeline_projects table for tracking which projects appear on the pipelines dashboard.
-- Supports pinning, visit tracking, and custom sort ordering.

CREATE TABLE IF NOT EXISTS pipeline_projects (
    project_id INTEGER NOT NULL,
    instance_id INTEGER NOT NULL,
    pinned INTEGER NOT NULL DEFAULT 0,
    last_visited_at TEXT,
    sort_order INTEGER,
    PRIMARY KEY (project_id, instance_id),
    FOREIGN KEY (project_id, instance_id) REFERENCES projects(id, instance_id) ON DELETE CASCADE,
    FOREIGN KEY (instance_id) REFERENCES gitlab_instances(id) ON DELETE CASCADE
);
