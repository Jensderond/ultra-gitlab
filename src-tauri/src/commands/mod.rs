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
//! - `diagnostics`: Memory and performance verification

pub mod approval;
pub mod auth;
pub mod comments;
pub mod diagnostics;
pub mod gitattributes;
pub mod mr;
pub mod notification_settings;
pub mod notifications;
pub mod pipeline;
pub mod reviewers;
pub mod settings;
pub mod sync;

// Re-export commands for registration in lib.rs
pub use approval::{approve_mr, get_approval_status, unapprove_mr};
pub use auth::{delete_gitlab_instance, get_gitlab_instances, get_token_info, setup_gitlab_instance, update_instance_token};
pub use comments::{add_comment, get_comments, get_file_comments, reply_to_comment, resolve_discussion};
pub use diagnostics::{clear_test_data, generate_test_data, get_cache_stats, get_diagnostics_report, get_memory_stats};
pub use gitattributes::{get_gitattributes, refresh_gitattributes};
pub use mr::{check_merge_status, get_cached_file_pair, get_diff_content, get_diff_file, get_diff_file_metadata, get_diff_files, get_diff_hunks, get_diff_refs, get_file_content, get_file_content_base64, get_merge_request_detail, get_merge_requests, list_my_merge_requests, merge_mr, rebase_mr};
pub use notification_settings::{get_notification_settings, update_notification_settings};
pub use notifications::send_native_notification;
pub use pipeline::{list_pipeline_projects, visit_pipeline_project, toggle_pin_pipeline_project, remove_pipeline_project, search_projects, get_pipeline_statuses, get_pipeline_jobs, play_pipeline_job, retry_pipeline_job, cancel_pipeline_job};
pub use reviewers::get_mr_reviewers;
pub use settings::{get_collapse_patterns, get_settings, get_sync_settings, update_collapse_patterns, update_custom_theme_colors, update_settings, update_sync_settings, update_theme, update_ui_font};
pub use sync::{
    discard_failed_action, get_action_counts, get_sync_config, get_sync_status,
    retry_failed_actions, trigger_sync, update_sync_config,
};
