-- Migration: 0019_create_issues_and_starring.sql
-- Adds GitLab issues tracking plus star + custom_name columns on projects.
-- Issues can be assigned to the authenticated user across any project; projects
-- can be starred to keep them prominent in the issues dashboard.

-- --------------------------------------------------------------------------
-- Projects: add starred flag and user-chosen custom_name (falls back to name
-- when null/empty). The original GitLab name/name_with_namespace/path are
-- preserved so the UI can show it on hover when a custom name is set.
-- --------------------------------------------------------------------------
ALTER TABLE projects ADD COLUMN starred INTEGER NOT NULL DEFAULT 0;
ALTER TABLE projects ADD COLUMN custom_name TEXT;

-- --------------------------------------------------------------------------
-- Issues: cached GitLab issue metadata scoped to an instance.
-- --------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS issues (
    id INTEGER NOT NULL,
    instance_id INTEGER NOT NULL,
    iid INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    title TEXT NOT NULL,
    description TEXT,
    state TEXT NOT NULL,
    web_url TEXT NOT NULL,
    author_username TEXT NOT NULL,
    assignee_usernames TEXT NOT NULL DEFAULT '[]',
    labels TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    closed_at INTEGER,
    due_date TEXT,
    confidential INTEGER NOT NULL DEFAULT 0,
    user_notes_count INTEGER NOT NULL DEFAULT 0,
    starred INTEGER NOT NULL DEFAULT 0,
    assigned_to_me INTEGER NOT NULL DEFAULT 0,
    cached_at INTEGER NOT NULL,
    PRIMARY KEY (id, instance_id),
    FOREIGN KEY (instance_id) REFERENCES gitlab_instances(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_issues_instance ON issues(instance_id);
CREATE INDEX IF NOT EXISTS idx_issues_project ON issues(project_id, instance_id);
CREATE INDEX IF NOT EXISTS idx_issues_assigned ON issues(instance_id, assigned_to_me);
CREATE INDEX IF NOT EXISTS idx_issues_starred ON issues(instance_id, starred);
