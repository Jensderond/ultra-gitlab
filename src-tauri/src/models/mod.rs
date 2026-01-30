//! Data models for the application.
//!
//! These models represent the core entities stored in the local SQLite database
//! and used for IPC communication with the frontend.
//!
//! All models derive Serialize for Tauri IPC and FromRow for SQLx database queries.

// Submodules will be added as they are implemented:
// pub mod gitlab_instance;
// pub mod merge_request;
// pub mod diff;
// pub mod comment;
// pub mod sync_action;

// Re-exports for convenient access:
// pub use gitlab_instance::GitLabInstance;
// pub use merge_request::MergeRequest;
// pub use diff::{Diff, DiffFile};
// pub use comment::Comment;
// pub use sync_action::{SyncAction, SyncLog};
