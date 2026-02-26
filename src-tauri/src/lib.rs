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
    add_comment, approve_mr, cancel_pipeline, cancel_pipeline_job, check_merge_status, clear_test_data,
    delete_comment, delete_gitlab_instance, discard_failed_action, generate_test_data, get_action_counts,
    get_approval_status, get_avatar, get_avatars, get_cache_stats, get_cached_file_pair,
    get_collapse_patterns, get_comments, get_companion_qr_svg, get_companion_settings,
    get_companion_status, get_diagnostics_report, get_diff_content, get_diff_file,
    get_diff_file_metadata, get_diff_files, get_diff_hunks, get_diff_refs, get_file_comments,
    get_file_content, get_file_content_base64, get_gitattributes, get_gitlab_instances,
    get_job_trace, get_memory_stats, get_merge_request_detail, get_merge_requests,
    get_mr_reviewers, get_notification_settings, get_pipeline_jobs, get_pipeline_statuses,
    get_project_pipelines, get_settings, get_sync_config, get_sync_settings, get_sync_status,
    get_token_info, list_my_merge_requests, list_pipeline_projects, merge_mr, play_pipeline_job,
    resolve_mr_by_web_url, fetch_mr_by_web_url,
    rebase_mr, refresh_avatars, refresh_gitattributes, regenerate_companion_pin,
    remove_pipeline_project, reply_to_comment, resolve_discussion, retry_failed_actions,
    retry_pipeline_job, revoke_companion_device, search_projects, send_native_notification,
    setup_gitlab_instance, start_companion_server_cmd, stop_companion_server_cmd,
    toggle_pin_pipeline_project, trigger_sync, unapprove_mr, update_collapse_patterns,
    update_companion_settings, update_custom_theme_colors, update_display_font,
    update_instance_token, update_notification_settings, update_session_cookie, update_settings,
    update_sync_config, update_sync_settings, update_theme, update_ui_font, visit_pipeline_project,
};
use services::companion_server;
use services::sync_engine::{SyncConfig, SyncEngine};
use tauri::{
    Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_store::StoreExt;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_notification::init())
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

                // Load persisted sync config from settings store (fall back to defaults)
                let sync_config: SyncConfig = app_handle
                    .store("settings.json")
                    .ok()
                    .and_then(|store| store.get("sync_config"))
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();
                eprintln!(
                    "[sync] Loaded sync config: sync_authored={}, sync_reviewing={}",
                    sync_config.sync_authored, sync_config.sync_reviewing
                );

                // Start background sync engine (needs active Tokio runtime for tokio::spawn)
                let sync_handle =
                    SyncEngine::start_background(pool.clone(), sync_config, app_handle);
                eprintln!("[sync] Background sync engine started");

                (pool, sync_handle)
            });

            // Store state for use in commands
            app.manage(pool.clone());
            app.manage(sync_handle.clone());

            // Auto-start companion server if enabled in settings
            {
                use commands::companion_settings::CompanionServerSettings;
                let companion_settings: CompanionServerSettings = app
                    .handle()
                    .store("settings.json")
                    .ok()
                    .and_then(|store| store.get("companion_server"))
                    .and_then(|v| serde_json::from_value(v.clone()).ok())
                    .unwrap_or_default();

                if companion_settings.enabled {
                    let port = companion_settings.port;
                    let pool_clone = pool.clone();
                    let sync_clone = sync_handle.clone();
                    let app_handle_clone = app.handle().clone();

                    // Resolve frontend dist path (must match resolve_frontend_dist in commands)
                    let resource_dir = app.path().resource_dir().ok();
                    let frontend_dist = resource_dir
                        .map(|p| p.join("companion-dist"))
                        .filter(|p| p.join("index.html").exists())
                        .or_else(|| {
                            let dev = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                                .join("../dist");
                            dev.join("index.html").exists().then_some(dev)
                        });

                    if let Some(dist_path) = frontend_dist {
                        tauri::async_runtime::spawn(async move {
                            match companion_server::start_companion_server(
                                port,
                                dist_path,
                                pool_clone,
                                sync_clone,
                                app_handle_clone,
                            )
                            .await
                            {
                                Ok(()) => eprintln!("[companion] Auto-started on port {}", port),
                                Err(e) => eprintln!("[companion] Auto-start failed: {}", e),
                            }
                        });
                    } else {
                        eprintln!("[companion] Auto-start skipped: frontend dist not found");
                    }
                }
            }

            // Create window with transparent titlebar
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Ultra Gitlab")
                .inner_size(800.0, 600.0)
                .hidden_title(true)
                .title_bar_style(TitleBarStyle::Transparent)
                .build()?;

            // Set macOS window background color to match sidebar/titlebar (#1f1f28)
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
                            31.0 / 255.0,
                            31.0 / 255.0,
                            40.0 / 255.0,
                            1.0,
                        );
                        ns_win.setBackgroundColor_(bg_color);
                    }
                }
            }

            // System tray icon (macOS: hide-on-close, all platforms: quick access)
            let show_item = MenuItemBuilder::with_id("show", "Show Ultra Gitlab").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit Ultra Gitlab").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&show_item)
                .item(&quit_item)
                .build()?;

            let tray_icon = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().expect("app icon not configured"))
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .on_menu_event(|app_handle, event| match event.id().as_ref() {
                    "show" => {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => {
                        app_handle.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            // Prevent the tray icon handle from being dropped (which removes the icon)
            app.manage(tray_icon);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            setup_gitlab_instance,
            get_gitlab_instances,
            delete_gitlab_instance,
            get_merge_requests,
            list_my_merge_requests,
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
            delete_comment,
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
            // Deep-link
            resolve_mr_by_web_url,
            fetch_mr_by_web_url,
            // Merge
            merge_mr,
            check_merge_status,
            rebase_mr,
            // Reviewers
            get_mr_reviewers,
            // Notifications
            get_notification_settings,
            update_notification_settings,
            send_native_notification,
            // Pipeline dashboard
            list_pipeline_projects,
            visit_pipeline_project,
            toggle_pin_pipeline_project,
            remove_pipeline_project,
            search_projects,
            get_pipeline_statuses,
            get_project_pipelines,
            get_pipeline_jobs,
            get_job_trace,
            play_pipeline_job,
            retry_pipeline_job,
            cancel_pipeline_job,
            cancel_pipeline,
            // Theme & Font
            update_theme,
            update_ui_font,
            update_display_font,
            update_custom_theme_colors,
            // Companion server
            get_companion_settings,
            get_companion_qr_svg,
            get_companion_status,
            update_companion_settings,
            regenerate_companion_pin,
            revoke_companion_device,
            start_companion_server_cmd,
            stop_companion_server_cmd,
            // Avatars
            get_avatar,
            get_avatars,
            update_session_cookie,
            refresh_avatars,
        ])
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        });
}
