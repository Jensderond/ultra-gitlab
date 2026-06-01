-- Migration: 0023_add_mr_assigned_to_me.sql
-- Flags merge requests assigned to the authenticated user. Set during sync by
-- matching the authenticated user's id against the MR's assignees. Lets the
-- "My MRs" list surface MRs authored by someone else (e.g. Renovate bot) but
-- assigned to the user, while keeping them out of the reviewing queue.

ALTER TABLE merge_requests ADD COLUMN assigned_to_me INTEGER NOT NULL DEFAULT 0;
