-- Migration: 0003_add_user_has_approved.sql
-- Adds a column to track whether the current user has approved each MR.
-- This allows the UI to correctly show "Approved" vs "Approve" button state.

-- Add the column with default value of 0 (false)
ALTER TABLE merge_requests ADD COLUMN user_has_approved INTEGER NOT NULL DEFAULT 0;
