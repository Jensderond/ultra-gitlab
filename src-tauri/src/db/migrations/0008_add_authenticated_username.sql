-- Migration: 0008_add_authenticated_username.sql
-- Stores the authenticated username for each GitLab instance.
-- This is used for optimistic comment display before sync completes.

ALTER TABLE gitlab_instances ADD COLUMN authenticated_username TEXT;
