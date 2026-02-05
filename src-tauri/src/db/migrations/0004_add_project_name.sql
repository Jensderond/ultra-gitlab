-- Migration: 0004_add_project_name.sql
-- Adds a column to store the project name (path with namespace) for each MR.
-- Extracted from web_url during sync so it can be displayed in the MR list.

ALTER TABLE merge_requests ADD COLUMN project_name TEXT NOT NULL DEFAULT '';
