//! Async results delivered to the UI loop over an mpsc channel.

use crate::data::{
    DetailData, JobRow, MrRow, PipeProjectRow, PipeRow, PipeStatus, ProjectHit,
};

/// A message produced by a background task and consumed by the event loop.
#[derive(Debug)]
pub enum AppEvent {
    Review(Result<Vec<MrRow>, String>),
    Mine(Result<Vec<MrRow>, String>),
    Detail(Result<DetailData, String>),
    /// (verb, result) for an action like "merge", "approve".
    ActionDone(String, Result<String, String>),

    // Pipelines tab
    PipeProjects(Result<Vec<PipeProjectRow>, String>),
    PipeStatuses(Result<Vec<(i64, PipeStatus)>, String>),
    PipeList(Result<Vec<PipeRow>, String>),
    PipeJobs(Result<Vec<JobRow>, String>),
    PipeSearch(Result<Vec<ProjectHit>, String>),
    /// Result message after pin/remove/add/play/retry/cancel.
    PipeActionDone(Result<String, String>),

    // MR detail pipelines panel
    MrPipes(Result<Vec<PipeRow>, String>),
    MrPipeJobs(Result<Vec<JobRow>, String>),

    /// Result of posting a comment/reply (Ok(mr_id) to refresh, or error).
    CommentPosted(Result<i64, String>),
}
