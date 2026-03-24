-- Migration: 0018_add_state_changed_at.sql
-- Adds state_changed_at column to track when an MR transitioned to merged/closed.
-- This enables 24-hour retention of merged/closed MRs before hard-purge,
-- so users see a proper "merged"/"closed" banner instead of "Not found".

ALTER TABLE merge_requests ADD COLUMN state_changed_at INTEGER;

-- Back-fill: any MR already in merged/closed state gets a timestamp of now
-- so they'll be cleaned up in 24h rather than lingering forever.
UPDATE merge_requests
SET state_changed_at = strftime('%s', 'now')
WHERE state IN ('merged', 'closed') AND state_changed_at IS NULL;
