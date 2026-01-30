-- Migration: 0002_add_discarded_status.sql
-- Adds 'discarded' as a valid status for sync_queue entries.
-- This status is used when an action is discarded because the MR
-- is no longer actionable (merged, closed, or deleted).

-- SQLite doesn't support ALTER TABLE for CHECK constraints directly,
-- so we need to recreate the table with the new constraint.

-- Step 1: Create a new table with the updated CHECK constraint
CREATE TABLE IF NOT EXISTS sync_queue_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mr_id INTEGER NOT NULL,
    action_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    local_reference_id INTEGER,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'syncing', 'synced', 'failed', 'discarded')),
    retry_count INTEGER NOT NULL DEFAULT 0,
    last_error TEXT,
    created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    synced_at INTEGER,
    FOREIGN KEY (mr_id) REFERENCES merge_requests(id) ON DELETE CASCADE
);

-- Step 2: Copy existing data to the new table
INSERT OR IGNORE INTO sync_queue_new (id, mr_id, action_type, payload, local_reference_id, status, retry_count, last_error, created_at, synced_at)
SELECT id, mr_id, action_type, payload, local_reference_id, status, retry_count, last_error, created_at, synced_at
FROM sync_queue;

-- Step 3: Drop the old table
DROP TABLE IF EXISTS sync_queue;

-- Step 4: Rename the new table to the original name
ALTER TABLE sync_queue_new RENAME TO sync_queue;

-- Step 5: Recreate the index
CREATE INDEX IF NOT EXISTS idx_sync_queue_status ON sync_queue(status, created_at);
