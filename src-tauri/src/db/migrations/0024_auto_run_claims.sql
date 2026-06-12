-- Migration: 0024_auto_run_claims.sql
-- Tracks manual pipeline jobs the user has "armed" for auto-run. The
-- background sync engine polls each claim and plays the job via the GitLab
-- API once the rest of the pipeline has completed successfully. Standalone
-- table (no FK): pipelines and jobs are not persisted locally.

CREATE TABLE IF NOT EXISTS auto_run_claims (
    instance_id INTEGER NOT NULL,
    project_id INTEGER NOT NULL,
    pipeline_id INTEGER NOT NULL,
    job_id INTEGER NOT NULL,
    job_name TEXT NOT NULL,
    ref_name TEXT,
    claimed_at INTEGER NOT NULL,
    last_status TEXT,
    last_error TEXT,
    last_attempt_at INTEGER,
    attempts INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (instance_id, project_id, job_id)
);
