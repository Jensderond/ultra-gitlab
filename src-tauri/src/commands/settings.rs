//! Settings commands for application configuration.
//!
//! These commands provide access to sync and other application settings.
//! Settings are persisted using the tauri-plugin-store.

use crate::error::AppError;
use crate::services::sync_engine::SyncConfig;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use tauri::AppHandle;
use tauri_plugin_store::StoreExt;
use tokio::sync::RwLock;

/// Store filename for settings.
const SETTINGS_STORE: &str = "settings.json";

/// Key for sync config in the store.
const SYNC_CONFIG_KEY: &str = "sync_config";

/// Application settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    /// Sync configuration.
    pub sync: SyncConfig,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            sync: SyncConfig::default(),
        }
    }
}

/// In-memory cache of settings.
static SETTINGS_CACHE: OnceLock<RwLock<AppSettings>> = OnceLock::new();

/// Get the settings cache, initializing if needed.
fn settings_cache() -> &'static RwLock<AppSettings> {
    SETTINGS_CACHE.get_or_init(|| RwLock::new(AppSettings::default()))
}

/// Load settings from store, using defaults if not found.
async fn load_settings(app: &AppHandle) -> Result<AppSettings, AppError> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| AppError::internal(format!("Failed to open settings store: {}", e)))?;

    // Try to load sync config
    let sync = match store.get(SYNC_CONFIG_KEY) {
        Some(value) => serde_json::from_value(value.clone()).unwrap_or_default(),
        None => SyncConfig::default(),
    };

    Ok(AppSettings { sync })
}

/// Save settings to store.
async fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), AppError> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| AppError::internal(format!("Failed to open settings store: {}", e)))?;

    // Save sync config
    let sync_value = serde_json::to_value(&settings.sync)?;
    store.set(SYNC_CONFIG_KEY, sync_value);

    // Persist to disk
    store
        .save()
        .map_err(|e| AppError::internal(format!("Failed to save settings: {}", e)))?;

    Ok(())
}

/// Get the current application settings.
///
/// # Returns
/// Current settings (loads from store on first call)
#[tauri::command]
pub async fn get_settings(app: AppHandle) -> Result<AppSettings, AppError> {
    // Load from store (always load fresh to ensure consistency)
    let settings = load_settings(&app).await?;

    // Update cache
    *settings_cache().write().await = settings.clone();

    Ok(settings)
}

/// Update application settings.
///
/// # Arguments
/// * `settings` - New settings to save
#[tauri::command]
pub async fn update_settings(app: AppHandle, settings: AppSettings) -> Result<(), AppError> {
    // Save to store
    save_settings(&app, &settings).await?;

    // Update cache
    *settings_cache().write().await = settings;

    Ok(())
}

/// Get the current sync configuration.
///
/// Convenience method that returns just the sync config.
///
/// # Returns
/// Current sync settings
#[tauri::command]
pub async fn get_sync_settings(app: AppHandle) -> Result<SyncConfig, AppError> {
    let settings = get_settings(app).await?;
    Ok(settings.sync)
}

/// Update the sync configuration.
///
/// Convenience method that updates just the sync config.
///
/// # Arguments
/// * `sync_config` - New sync settings
#[tauri::command]
pub async fn update_sync_settings(
    app: AppHandle,
    sync_config: SyncConfig,
) -> Result<(), AppError> {
    // Get current settings
    let mut settings = load_settings(&app).await?;

    // Update sync config
    settings.sync = sync_config;

    // Save
    save_settings(&app, &settings).await?;

    // Update cache
    *settings_cache().write().await = settings;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let settings = AppSettings::default();
        assert!(!settings.sync.sync_authored); // Don't sync own MRs by default
        assert!(settings.sync.sync_reviewing);
        assert_eq!(settings.sync.interval_secs, 300);
    }
}
