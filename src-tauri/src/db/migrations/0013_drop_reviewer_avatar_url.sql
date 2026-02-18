-- Migration: 0013_drop_reviewer_avatar_url.sql
-- Remove avatar_url column from mr_reviewers (GitLab avatar URLs require
-- authentication that PATs cannot provide for browser image loading).

ALTER TABLE mr_reviewers DROP COLUMN avatar_url;
