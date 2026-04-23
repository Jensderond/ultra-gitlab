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
    get_cached_pipeline_statuses, get_job_trace, get_memory_stats, get_merge_request_detail, get_merge_requests, list_system_fonts,
    get_mr_reviewers, get_notification_settings, get_pipeline_jobs, get_pipeline_statuses,
    get_project_pipelines, get_settings, get_sync_config, get_sync_settings, get_sync_status,
    add_issue_note, get_cached_issue_detail, get_token_info,
    list_cached_issue_notes, list_cached_issues,
    list_issue_assignee_candidates, list_issue_projects, list_my_merge_requests,
    refresh_issue_detail, set_issue_assignees, set_issue_state,
    list_pipeline_projects, merge_mr, play_pipeline_job,
    resolve_mr_by_web_url, fetch_mr_by_web_url,
    rebase_mr, refresh_avatars, refresh_gitattributes, regenerate_companion_pin, rename_instance,
    rename_project, set_companion_pin,
    remove_pipeline_project, reorder_pinned_pipeline_projects, reply_to_comment, resolve_discussion, resolve_project_by_path, retry_failed_actions,
    retry_pipeline_job, revoke_companion_device, search_projects,
    send_native_notification,
    set_default_instance, setup_gitlab_instance, start_companion_server_cmd, stop_companion_server_cmd,
    sync_my_issues, sync_project_issues,
    toggle_issue_star, toggle_pin_pipeline_project, toggle_project_star, trigger_sync, unapprove_mr,
    update_collapse_patterns,
    update_companion_settings, update_custom_theme_colors, update_diffs_font,
    update_display_font,
    update_instance_token, update_keyboard_shortcuts, update_notification_settings,
    update_session_cookie, update_settings, update_sync_config, update_sync_settings,
    update_theme, update_ui_font, visit_pipeline_project,
};
use services::companion_server;
use std::sync::Arc;
use services::sync_engine::{SyncConfig, SyncEngine};
use services::sync_events::TauriEmitter;
use tauri::{
    Manager, TitleBarStyle, WebviewUrl, WebviewWindowBuilder,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
use tauri_plugin_aptabase::EventTracker;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_store::StoreExt;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // tauri-plugin-aptabase calls tokio::spawn during plugin setup, which requires the
    // current thread to have an active Tokio context. We create the runtime here,
    // register it with Tauri's async_runtime, and enter it on the main thread so that
    // tokio::spawn works. The setup hook must NOT call tauri::async_runtime::block_on
    // while the guard is live (would deadlock); use spawn + sync channel instead.
    let rt = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
        .expect("Failed to create Tokio runtime");
    tauri::async_runtime::set(rt.handle().clone());
    let _rt_guard = rt.enter();

    tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Webview),
                ])
                .build(),
        )
        .plugin(tauri_plugin_aptabase::Builder::new("A-EU-7406096367").build())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // Initialize database
            let app_data_dir = app
                .path()
                .app_data_dir()
                .expect("Failed to get app data directory");

            let db_path = db::get_db_path(&app_data_dir);

            log::info!("Database path: {}", db_path.display());

            // Async initialization via spawn + channel.
            // Cannot use tauri::async_runtime::block_on here because the main thread
            // has already entered the Tokio runtime (required for aptabase's tokio::spawn
            // in its plugin setup); block_on would deadlock in that context.
            let app_handle = app.handle().clone();

            // Load persisted sync config from settings store (fall back to defaults)
            let sync_config: SyncConfig = app_handle
                .store("settings.json")
                .ok()
                .and_then(|store| store.get("sync_config"))
                .and_then(|v| serde_json::from_value(v.clone()).ok())
                .unwrap_or_default();
            log::info!(
                "[sync] Loaded sync config: interval_secs={}, max_mrs_per_sync={}",
                sync_config.interval_secs, sync_config.max_mrs_per_sync
            );

            let (init_tx, init_rx) = std::sync::mpsc::sync_channel(1);
            tauri::async_runtime::spawn(async move {
                let pool = db::initialize(&db_path)
                    .await
                    .expect("Failed to initialize database");

                // Start background sync engine (needs active Tokio runtime for tokio::spawn)
                let sync_handle =
                    SyncEngine::start_background(pool.clone(), sync_config, Arc::new(TauriEmitter(app_handle)));
                log::info!("[sync] Background sync engine started");

                let _ = init_tx.send((pool, sync_handle));
            });
            let (pool, sync_handle) = init_rx.recv().expect("Failed to initialize app");

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
                                Ok(()) => log::info!("[companion] Auto-started on port {}", port),
                                Err(e) => log::error!("[companion] Auto-start failed: {}", e),
                            }
                        });
                    } else {
                        log::warn!("[companion] Auto-start skipped: frontend dist not found");
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

            let _ = app.track_event("app_started", None);

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            greet,
            setup_gitlab_instance,
            get_gitlab_instances,
            delete_gitlab_instance,
            rename_instance,
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
            update_keyboard_shortcuts,
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
            set_default_instance,
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
            // Issues
            sync_my_issues,
            sync_project_issues,
            get_cached_issue_detail,
            list_cached_issues,
            list_cached_issue_notes,
            list_issue_projects,
            toggle_issue_star,
            toggle_project_star,
            rename_project,
            refresh_issue_detail,
            add_issue_note,
            set_issue_assignees,
            set_issue_state,
            list_issue_assignee_candidates,
            // Pipeline dashboard
            list_pipeline_projects,
            visit_pipeline_project,
            toggle_pin_pipeline_project,
            remove_pipeline_project,
            reorder_pinned_pipeline_projects,
            search_projects,
            get_pipeline_statuses,
            get_cached_pipeline_statuses,
            get_project_pipelines,
            get_pipeline_jobs,
            get_job_trace,
            play_pipeline_job,
            retry_pipeline_job,
            cancel_pipeline_job,
            cancel_pipeline,
            resolve_project_by_path,
            // Theme & Font
            list_system_fonts,
            update_theme,
            update_ui_font,
            update_display_font,
            update_diffs_font,
            update_custom_theme_colors,
            // Companion server
            get_companion_settings,
            get_companion_qr_svg,
            get_companion_status,
            update_companion_settings,
            regenerate_companion_pin,
            set_companion_pin,
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
                    let _ = window.track_event("window_closed", None);
                    let _ = window.hide();
                    api.prevent_close();
                }
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            match event {
                tauri::RunEvent::Reopen { .. } => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                tauri::RunEvent::Exit => {
                    let _ = app_handle.track_event("app_exited", None);
                    app_handle.flush_events_blocking();
                }
                _ => {}
            }
        });
}
