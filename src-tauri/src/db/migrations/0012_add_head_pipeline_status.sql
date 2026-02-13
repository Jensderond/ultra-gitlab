-- Add head_pipeline_status column to merge_requests for tracking pipeline state.
-- Used for "MR ready to merge" notification detection.
ALTER TABLE merge_requests ADD COLUMN head_pipeline_status TEXT;
