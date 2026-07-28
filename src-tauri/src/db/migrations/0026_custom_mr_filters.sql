-- Custom MR filter: one user-defined sync scope per instance (issue #28)
CREATE TABLE IF NOT EXISTS custom_mr_filters (
    instance_id         INTEGER PRIMARY KEY
                        REFERENCES gitlab_instances(id) ON DELETE CASCADE,
    enabled             INTEGER NOT NULL DEFAULT 0,
    draft               TEXT,     -- 'yes' | 'no' | NULL = any
    author_username     TEXT,     -- include only MRs by this author
    not_author_username TEXT,     -- exclude MRs by this author
    labels              TEXT,     -- comma-separated; GitLab AND-semantics
    updated_at          INTEGER NOT NULL
);
