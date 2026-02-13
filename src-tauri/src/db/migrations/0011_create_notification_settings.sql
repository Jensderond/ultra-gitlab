-- Notification settings: single-row pattern with defaults
CREATE TABLE IF NOT EXISTS notification_settings (
    id INTEGER PRIMARY KEY DEFAULT 1,
    mr_ready_to_merge INTEGER NOT NULL DEFAULT 1,
    pipeline_status_pinned INTEGER NOT NULL DEFAULT 1,
    native_notifications_enabled INTEGER NOT NULL DEFAULT 1
);

-- Seed default row
INSERT OR IGNORE INTO notification_settings (id) VALUES (1);
