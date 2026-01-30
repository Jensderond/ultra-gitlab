//! Ultra GitLab - Local-first GitLab MR review application.
//!
//! This is the main library for the Tauri backend, exposing IPC commands
//! to the React frontend.

pub mod commands;
pub mod db;
pub mod error;
pub mod models;
pub mod services;

use commands::{
    add_comment, approve_mr, delete_gitlab_instance, discard_failed_action, get_action_counts,
    get_approval_status, get_comments, get_diff_content, get_diff_file, get_diff_file_metadata,
    get_diff_hunks, get_file_comments, get_gitlab_instances, get_merge_request_detail,
    get_merge_requests, get_settings, get_sync_config, get_sync_settings, get_sync_status,
    reply_to_comment, resolve_discussion, retry_failed_actions, setup_gitlab_instance,
    trigger_sync, unapprove_mr, update_settings, update_sync_config, update_sync_settings,
};
use tauri::Manager;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .setup(|app| {
            // Initialize database
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            let db_path = db::get_db_path(&app_data_dir);

            // Run async initialization in a blocking context
            let pool = tauri::async_runtime::block_on(async {
                db::initialize(&db_path)
                    .await
                    .expect("Failed to initialize database")
            });

            // Store the pool in app state for use in commands
            app.manage(pool);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            setup_gitlab_instance,
            get_gitlab_instances,
            delete_gitlab_instance,
            get_merge_requests,
            get_merge_request_detail,
            get_diff_content,
            get_diff_file,
            get_diff_file_metadata,
            get_diff_hunks,
            get_comments,
            get_file_comments,
            add_comment,
            reply_to_comment,
            resolve_discussion,
            approve_mr,
            unapprove_mr,
            get_approval_status,
            get_action_counts,
            trigger_sync,
            get_sync_status,
            retry_failed_actions,
            discard_failed_action,
            get_sync_config,
            update_sync_config,
            get_settings,
            update_settings,
            get_sync_settings,
            update_sync_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
