-- Cache the latest pipeline status per project so the UI can show
-- the last known state immediately instead of a loading spinner.
CREATE TABLE IF NOT EXISTS pipeline_status_cache (
    project_id INTEGER NOT NULL,
    instance_id INTEGER NOT NULL,
    pipeline_id INTEGER NOT NULL,
    status TEXT NOT NULL,
    ref_name TEXT NOT NULL,
    sha TEXT NOT NULL,
    web_url TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT,
    duration INTEGER,
    cached_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (project_id, instance_id)
);
