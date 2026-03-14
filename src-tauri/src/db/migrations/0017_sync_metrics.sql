-- Sync metrics for performance instrumentation
CREATE TABLE IF NOT EXISTS sync_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sync_run_id TEXT NOT NULL,
    phase TEXT NOT NULL,
    instance_id INTEGER,
    mr_iid INTEGER,
    duration_ms INTEGER NOT NULL,
    api_calls INTEGER DEFAULT 0,
    items_processed INTEGER DEFAULT 0,
    timestamp INTEGER NOT NULL
);
