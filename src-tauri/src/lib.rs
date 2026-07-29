//! Ultra GitLab - Local-first GitLab MR review application.
//!
//! This is the main library for the Tauri backend, exposing IPC commands
//! to the React frontend.

pub mod commands;
pub mod core;
pub mod db;
pub mod error;
pub mod models;
pub mod services;

use commands::{
    cli_status, download_and_install_cli,
    add_comment, approve_mr, cancel_pipeline, cancel_pipeline_job, check_merge_status,
    claim_auto_merge, clear_test_data, get_auto_merge_claim, process_auto_merge_now,
    unclaim_auto_merge,
    claim_auto_run, list_auto_run_claims, unclaim_auto_run,
    snooze_mr, unsnooze_mr,
    delete_comment, delete_gitlab_instance, discard_failed_action, generate_test_data, get_action_counts,
    get_approval_status, get_avatar, get_avatars, get_cache_stats, get_cached_file_pair,
    get_collapse_patterns, get_comments, get_custom_mr_filter,
    get_diagnostics_report, get_diff_content, get_diff_file,
    get_diff_file_metadata, get_diff_files, get_diff_hunks, get_diff_refs, get_file_comments,
    get_file_content, get_file_content_base64, get_gitattributes, get_gitlab_instances,
    get_cached_pipeline_statuses, get_job_trace, get_memory_stats, get_merge_request_detail, get_merge_requests, get_mr_pipelines, list_system_fonts,
    check_notification_permission, get_notification_permission_status,
    request_notification_permission,
    get_mr_reviewers, get_notification_settings, get_pipeline_jobs, get_pipeline_statuses,
    get_project_pipelines, get_settings, get_sync_config, get_sync_settings, get_sync_status,
    add_issue_note, get_cached_issue_detail, get_token_info,
    list_cached_issue_notes, list_cached_issues,
    list_issue_assignee_candidates, list_issue_projects, list_known_users, list_my_merge_requests,
    refresh_issue_detail, set_issue_assignees, set_issue_description, set_issue_state, set_custom_mr_filter,
    list_pipeline_projects, merge_mr, play_pipeline_job,
    resolve_mr_by_web_url, fetch_mr_by_web_url,
    rebase_mr, refresh_avatars, refresh_gitattributes, rename_instance,
    undraft_mr,
    rename_project,
    remove_pipeline_project, reorder_pinned_pipeline_projects, reply_to_comment, resolve_discussion, resolve_project_by_path, retry_failed_actions,
    retry_pipeline_job, search_projects,
    send_native_notification,
    set_default_instance, setup_gitlab_instance,
    sync_my_issues, sync_project_issues,
    test_custom_mr_filter,
    toggle_issue_star, toggle_pin_pipeline_project, toggle_project_star, trigger_sync, unapprove_mr,
    update_collapse_patterns,
    update_custom_theme_colors, update_diffs_font,
    update_display_font, update_has_seen_product_tour,
    update_instance_token, update_keyboard_shortcuts, update_mr_list_condensed,
    update_notification_settings, update_session_cookie, update_settings,
    update_show_draft_mrs, update_show_recently_merged_mrs, update_sync_config,
    update_sync_settings, update_theme, update_ui_font, visit_pipeline_project,
};
use std::sync::Arc;
use services::sync_engine::{SyncConfig, SyncEngine};
use services::sync_events::TauriEmitter;
use tauri::{Manager, WebviewUrl, WebviewWindowBuilder};
#[cfg(desktop)]
use tauri::{
    TitleBarStyle,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
};
#[cfg(desktop)]
use tauri_plugin_aptabase::EventTracker;
use tauri_plugin_log::{Target, TargetKind};
use tauri_plugin_store::StoreExt;
#[cfg(desktop)]
use user_notify::NotificationManager;

/// Wrapper around the notification manager for Tauri state management.
#[cfg(desktop)]
pub struct NotificationManagerState(pub Arc<dyn NotificationManager>);

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

    let builder = tauri::Builder::default()
        .plugin(
            tauri_plugin_log::Builder::new()
                .targets([
                    Target::new(TargetKind::Stdout),
                    Target::new(TargetKind::LogDir { file_name: None }),
                    Target::new(TargetKind::Webview),
                ])
                .level_for("sqlx", log::LevelFilter::Warn)
                .level_for("sqlx::query", log::LevelFilter::Warn)
                .level_for("hyper", log::LevelFilter::Warn)
                .level_for("hyper_util", log::LevelFilter::Warn)
                .level_for("reqwest", log::LevelFilter::Warn)
                .build(),
        )
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_store::Builder::new().build());

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_aptabase::Builder::new("A-EU-7406096367").build())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init());

    #[cfg(mobile)]
    let builder = builder.plugin(tauri_plugin_haptics::init());

    builder
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

            // Initialize native notification manager (user-notify). Desktop-only:
            // the crate isn't available on iOS/Android.
            #[cfg(desktop)]
            {
                use services::sync_events::NOTIFICATION_CLICKED_EVENT;
                let notification_manager = user_notify::get_notification_manager(
                    "com.jens.ultra-gitlab".to_string(),
                    None,
                );

                // Register click callback — emits a Tauri event so the frontend can navigate.
                let click_handle = app.handle().clone();
                if let Err(e) = notification_manager.register(
                    Box::new(move |response| {
                        if let Some(route) = response.user_info.get("route") {
                            use tauri::Emitter;
                            let payload = serde_json::json!({ "route": route });
                            if let Err(e) = click_handle.emit(NOTIFICATION_CLICKED_EVENT, payload) {
                                log::warn!("Failed to emit notification click event: {}", e);
                            }
                        }
                    }),
                    vec![], // no custom action categories for now
                ) {
                    log::error!("Failed to register notification callback: {}", e);
                }

                // Log current permission state at startup (don't request — let the user trigger that from Settings)
                let perm_manager = notification_manager.clone();
                tauri::async_runtime::spawn(async move {
                    match perm_manager.get_notification_permission_state().await {
                        Ok(granted) => log::info!("[notifications] Permission state: granted={}", granted),
                        Err(e) => log::warn!("[notifications] Failed to check permission: {}", e),
                    }
                });

                app.manage(NotificationManagerState(notification_manager));
            }

            // Create window with transparent titlebar (desktop); mobile gets a plain window
            #[cfg(desktop)]
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Ultra Gitlab")
                .inner_size(800.0, 600.0)
                .hidden_title(true)
                .title_bar_style(TitleBarStyle::Transparent)
                .build()?;
            #[cfg(mobile)]
            let win = WebviewWindowBuilder::new(app, "main", WebviewUrl::default()).build()?;

            // iOS: enable the native edge-swipe-to-go-back gesture. Safe because
            // the app uses BrowserRouter — every navigate() call already pushes a
            // real history entry, so this operates on the same back/forward stack.
            #[cfg(target_os = "ios")]
            win.with_webview(|webview| {
                unsafe {
                    use objc2::runtime::AnyObject;
                    use objc2::msg_send;
                    let webview_ptr = webview.inner() as *mut AnyObject;
                    let _: () = msg_send![webview_ptr, setAllowsBackForwardNavigationGestures: true];
                }
            })?;

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
            #[cfg(desktop)]
            {
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
            }

            #[cfg(desktop)]
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
            update_mr_list_condensed,
            update_has_seen_product_tour,
            update_show_draft_mrs,
            update_show_recently_merged_mrs,
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
            undraft_mr,
            get_mr_pipelines,
            // Auto-merge
            claim_auto_merge,
            unclaim_auto_merge,
            get_auto_merge_claim,
            process_auto_merge_now,
            snooze_mr,
            unsnooze_mr,
            // Auto-run
            claim_auto_run,
            unclaim_auto_run,
            list_auto_run_claims,
            // Reviewers
            get_mr_reviewers,
            // Custom MR Filter
            get_custom_mr_filter,
            set_custom_mr_filter,
            test_custom_mr_filter,
            // Notifications
            get_notification_settings,
            update_notification_settings,
            check_notification_permission,
            get_notification_permission_status,
            request_notification_permission,
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
            set_issue_description,
            set_issue_state,
            list_issue_assignee_candidates,
            list_known_users,
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
            // Avatars
            get_avatar,
            get_avatars,
            update_session_cookie,
            refresh_avatars,
            // CLI installer
            cli_status,
            download_and_install_cli,
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
            #[cfg(not(target_os = "macos"))]
            let _ = (window, event);
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            #[cfg(mobile)]
            let _ = &app_handle;
            match event {
                #[cfg(target_os = "macos")]
                tauri::RunEvent::Reopen { .. } => {
                    if let Some(window) = app_handle.get_webview_window("main") {
                        let _ = window.show();
                        let _ = window.set_focus();
                    }
                }
                tauri::RunEvent::Exit => {
                    #[cfg(desktop)]
                    {
                        let _ = app_handle.track_event("app_exited", None);
                        app_handle.flush_events_blocking();
                    }
                }
                _ => {}
            }
        });
}
