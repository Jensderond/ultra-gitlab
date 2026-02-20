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
pub mod avatar;
pub mod comments;
pub mod companion_server;
pub mod companion_settings;
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
pub use auth::{
    delete_gitlab_instance, get_gitlab_instances, get_token_info, setup_gitlab_instance,
    update_instance_token,
};
pub use avatar::{get_avatar, get_avatars, refresh_avatars, update_session_cookie};
pub use comments::{
    add_comment, get_comments, get_file_comments, reply_to_comment, resolve_discussion,
};
pub use companion_server::{start_companion_server_cmd, stop_companion_server_cmd};
pub use companion_settings::{
    get_companion_qr_svg, get_companion_settings, get_companion_status, regenerate_companion_pin,
    revoke_companion_device, update_companion_settings,
};
pub use diagnostics::{
    clear_test_data, generate_test_data, get_cache_stats, get_diagnostics_report, get_memory_stats,
};
pub use gitattributes::{get_gitattributes, refresh_gitattributes};
pub use mr::{
    check_merge_status, get_cached_file_pair, get_diff_content, get_diff_file,
    get_diff_file_metadata, get_diff_files, get_diff_hunks, get_diff_refs, get_file_content,
    get_file_content_base64, get_merge_request_detail, get_merge_requests, list_my_merge_requests,
    merge_mr, rebase_mr, resolve_mr_by_web_url, fetch_mr_by_web_url,
};
pub use notification_settings::{get_notification_settings, update_notification_settings};
pub use notifications::send_native_notification;
pub use pipeline::{
    cancel_pipeline_job, get_job_trace, get_pipeline_jobs, get_pipeline_statuses,
    get_project_pipelines, list_pipeline_projects, play_pipeline_job, remove_pipeline_project,
    retry_pipeline_job, search_projects, toggle_pin_pipeline_project, visit_pipeline_project,
};
pub use reviewers::get_mr_reviewers;
pub use settings::{
    get_collapse_patterns, get_settings, get_sync_settings, update_collapse_patterns,
    update_custom_theme_colors, update_display_font, update_settings, update_sync_settings,
    update_theme, update_ui_font,
};
pub use sync::{
    discard_failed_action, get_action_counts, get_sync_config, get_sync_status,
    retry_failed_actions, trigger_sync, update_sync_config,
};
