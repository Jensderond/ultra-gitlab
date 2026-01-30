//! Tauri IPC command handlers.
//!
//! This module contains all commands exposed to the frontend via Tauri's invoke system.
//! Commands are organized by functionality:
//! - `auth`: GitLab instance authentication and management
//! - `mr`: Merge request retrieval and display
//! - `comments`: Comment and discussion management
//! - `approval`: MR approval/unapproval
//! - `sync`: Background synchronization control
//! - `settings`: Application settings management

pub mod approval;
pub mod auth;
pub mod comments;
pub mod mr;
pub mod settings;
pub mod sync;

// Re-export commands for registration in lib.rs
pub use approval::{approve_mr, get_approval_status, unapprove_mr};
pub use auth::{delete_gitlab_instance, get_gitlab_instances, setup_gitlab_instance};
pub use comments::{add_comment, get_comments, get_file_comments, reply_to_comment, resolve_discussion};
pub use mr::{get_diff_content, get_diff_file, get_merge_request_detail, get_merge_requests};
pub use settings::{get_settings, get_sync_settings, update_settings, update_sync_settings};
pub use sync::{
    discard_failed_action, get_action_counts, get_sync_config, get_sync_status,
    retry_failed_actions, trigger_sync, update_sync_config,
};
