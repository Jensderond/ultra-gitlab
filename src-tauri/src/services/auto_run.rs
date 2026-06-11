//! Pure decision logic for the auto-run manual job feature.
//!
//! Separated from the sync engine so the trigger table from the design spec
//! (docs/superpowers/specs/2026-06-11-auto-run-manual-jobs-design.md) can be
//! unit-tested without any I/O.

/// What the processor should do with one armed job on this tick.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutoRunDecision {
    /// All prior stages succeeded and the job is playable: play it now.
    Play,
    /// Pipeline still in progress (or blocked earlier): check again next tick.
    Wait,
    /// Pipeline reached terminal failure; the job will never become playable.
    /// Disarm and notify the user.
    DisarmPipelineFailed,
    /// The job left the `manual` state some other way (played in the GitLab
    /// UI, superseded, ...). Disarm silently.
    DisarmJobGone,
}

/// Decide based on the pipeline-level status and the armed job's status.
///
/// A `when: manual` job only reaches status `manual` once its stage is
/// reached, and pipeline `success`/`manual` guarantees no earlier stage
/// failed — together that is exactly "all prior stages succeeded".
pub fn decide(pipeline_status: &str, job_status: &str) -> AutoRunDecision {
    if matches!(pipeline_status, "failed" | "canceled" | "skipped") {
        return AutoRunDecision::DisarmPipelineFailed;
    }
    match job_status {
        "manual" => match pipeline_status {
            // `success`: pipeline done, the manual job was allow_failure so
            // it didn't block. `manual`: pipeline blocked waiting on it.
            "success" | "manual" => AutoRunDecision::Play,
            _ => AutoRunDecision::Wait,
        },
        // Job's stage not reached yet (earlier stages running, or blocked on
        // an earlier manual job).
        "created" | "scheduled" => AutoRunDecision::Wait,
        // Anything else (running, success, pending, ...) means someone or
        // something already started it.
        _ => AutoRunDecision::DisarmJobGone,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn plays_when_pipeline_settled_green_and_job_manual() {
        assert_eq!(decide("success", "manual"), AutoRunDecision::Play);
        assert_eq!(decide("manual", "manual"), AutoRunDecision::Play);
    }

    #[test]
    fn waits_while_pipeline_in_progress() {
        assert_eq!(decide("running", "manual"), AutoRunDecision::Wait);
        assert_eq!(decide("pending", "manual"), AutoRunDecision::Wait);
        assert_eq!(decide("created", "manual"), AutoRunDecision::Wait);
        assert_eq!(decide("waiting_for_resource", "manual"), AutoRunDecision::Wait);
        assert_eq!(decide("preparing", "manual"), AutoRunDecision::Wait);
    }

    #[test]
    fn waits_while_job_stage_not_reached() {
        assert_eq!(decide("running", "created"), AutoRunDecision::Wait);
        // Pipeline blocked on an EARLIER manual job; ours not reachable yet.
        assert_eq!(decide("manual", "created"), AutoRunDecision::Wait);
        assert_eq!(decide("running", "scheduled"), AutoRunDecision::Wait);
    }

    #[test]
    fn disarms_with_notification_on_pipeline_failure() {
        assert_eq!(decide("failed", "manual"), AutoRunDecision::DisarmPipelineFailed);
        assert_eq!(decide("canceled", "manual"), AutoRunDecision::DisarmPipelineFailed);
        assert_eq!(decide("skipped", "manual"), AutoRunDecision::DisarmPipelineFailed);
        // Pipeline failure wins regardless of job status.
        assert_eq!(decide("failed", "skipped"), AutoRunDecision::DisarmPipelineFailed);
        assert_eq!(decide("canceled", "created"), AutoRunDecision::DisarmPipelineFailed);
    }

    #[test]
    fn disarms_silently_when_job_already_ran() {
        assert_eq!(decide("running", "running"), AutoRunDecision::DisarmJobGone);
        assert_eq!(decide("success", "success"), AutoRunDecision::DisarmJobGone);
        assert_eq!(decide("running", "pending"), AutoRunDecision::DisarmJobGone);
        assert_eq!(decide("success", "skipped"), AutoRunDecision::DisarmJobGone);
    }
}
