//! Data models for the application.
//!
//! These models represent the core entities stored in the local SQLite database
//! and used for IPC communication with the frontend.
//!
//! All models derive Serialize for Tauri IPC and FromRow for SQLx database queries.

pub mod comment;
pub mod diff;
pub mod gitlab_instance;
pub mod merge_request;
pub mod mr_reviewer;
pub mod pipeline_project;
pub mod project;
pub mod sync_action;

// Re-exports for convenient access
pub use comment::{Comment, LineType, NewComment};
pub use diff::{ChangeType, Diff, DiffFile};
pub use gitlab_instance::{GitLabInstance, NewGitLabInstance};
pub use merge_request::{ApprovalStatus, MergeRequest, MergeRequestState};
pub use mr_reviewer::MrReviewer;
pub use pipeline_project::PipelineProject;
pub use project::Project;
pub use sync_action::{ActionType, LogStatus, SyncAction, SyncLog, SyncStatus};
