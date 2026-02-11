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
    add_comment, approve_mr, clear_test_data, delete_gitlab_instance, discard_failed_action,
    generate_test_data, get_action_counts, get_approval_status, get_cache_stats,
    get_cached_file_pair, get_collapse_patterns, get_comments, get_diagnostics_report,
    get_diff_content, get_diff_file, get_diff_file_metadata, get_diff_files, get_diff_hunks,
    get_diff_refs, get_file_comments, get_file_content, get_file_content_base64,
    get_gitattributes, get_gitlab_instances, get_memory_stats, get_merge_request_detail,
    get_merge_requests, get_settings, get_sync_config, get_sync_settings, get_sync_status,
    get_mr_reviewers, get_token_info, refresh_gitattributes, reply_to_comment,
    resolve_discussion, retry_failed_actions, setup_gitlab_instance, trigger_sync,
    unapprove_mr, update_collapse_patterns, update_instance_token, update_settings,
    update_sync_config, update_sync_settings,
};
use services::sync_engine::{SyncConfig, SyncEngine};
use tauri::{Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

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

            println!("Database path: {}", db_path.display());

            // Run async initialization in a blocking context
            let app_handle = app.handle().clone();
            let (pool, sync_handle) = tauri::async_runtime::block_on(async {
                let pool = db::initialize(&db_path)
                    .await
                    .expect("Failed to initialize database");

                // Start background sync engine (needs active Tokio runtime for tokio::spawn)
                let sync_handle = SyncEngine::start_background(pool.clone(), SyncConfig::default(), app_handle);
                eprintln!("[sync] Background sync engine started");

                (pool, sync_handle)
            });

            // Store state for use in commands
            app.manage(pool);
            app.manage(sync_handle);

            // Create window with transparent titlebar
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Ultra Gitlab")
                .inner_size(800.0, 600.0)
                .hidden_title(true)
                .title_bar_style(TitleBarStyle::Transparent)
                .build()?;

            // Set macOS window background color to match app theme (#16161d)
            #[cfg(target_os = "macos")]
            {
                #[allow(deprecated)]
                {
                    use cocoa::appkit::{NSColor, NSWindow};
                    use cocoa::base::{id, nil};
                    let ns_win: id = win.ns_window().unwrap() as id;
                    unsafe {
                        let bg_color = NSColor::colorWithSRGBRed_green_blue_alpha_(
                            nil,
                            22.0 / 255.0,
                            22.0 / 255.0,
                            29.0 / 255.0,
                            1.0,
                        );
                        ns_win.setBackgroundColor_(bg_color);
                    }
                }
            }

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
            get_diff_files,
            get_diff_file,
            get_diff_file_metadata,
            get_diff_hunks,
            get_diff_refs,
            get_file_content,
            get_file_content_base64,
            get_cached_file_pair,
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
            get_collapse_patterns,
            update_collapse_patterns,
            // Gitattributes cache
            get_gitattributes,
            refresh_gitattributes,
            // Diagnostics (memory and performance verification)
            get_memory_stats,
            get_cache_stats,
            get_diagnostics_report,
            generate_test_data,
            clear_test_data,
            get_token_info,
            update_instance_token,
            // Reviewers
            get_mr_reviewers,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
