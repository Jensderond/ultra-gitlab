-- Per-MR snooze state: hides an MR from the review list until snooze_until.
CREATE TABLE IF NOT EXISTS mr_snoozes (
    mr_id INTEGER PRIMARY KEY,
    snoozed_at INTEGER NOT NULL,
    snooze_until INTEGER NOT NULL,
    FOREIGN KEY (mr_id) REFERENCES merge_requests(id) ON DELETE CASCADE
);
