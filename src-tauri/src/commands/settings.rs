//! Settings commands for application configuration.
//!
//! These commands provide access to sync and other application settings.
//! Settings are persisted using the tauri-plugin-store.

use crate::commands::companion_settings::CompanionServerSettings;
use crate::error::AppError;
use crate::services::sync_engine::{SyncConfig, SyncHandle};
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;
use tauri::AppHandle;
use tauri::State;
use tauri_plugin_store::StoreExt;
use tokio::sync::RwLock;

/// Store filename for settings.
const SETTINGS_STORE: &str = "settings.json";

/// Key for sync config in the store.
const SYNC_CONFIG_KEY: &str = "sync_config";

/// Key for collapse patterns in the store.
const COLLAPSE_PATTERNS_KEY: &str = "collapse_patterns";

/// Key for theme ID in the store.
const THEME_KEY: &str = "theme";

/// Key for UI font in the store.
const UI_FONT_KEY: &str = "ui_font";

/// Key for display font in the store.
const DISPLAY_FONT_KEY: &str = "display_font";

/// Key for diffs font in the store.
const DIFFS_FONT_KEY: &str = "diffs_font";

/// Key for custom theme colors in the store.
const CUSTOM_THEME_COLORS_KEY: &str = "custom_theme_colors";

/// Key for companion server settings in the store.
const COMPANION_SERVER_KEY: &str = "companion_server";

/// Default theme ID.
const DEFAULT_THEME: &str = "kanagawa-wave";

/// Default UI font.
const DEFAULT_UI_FONT: &str = "Noto Sans JP";

/// Default display font (decorative heading font for page h1s).
const DEFAULT_DISPLAY_FONT: &str = "Cormorant Garamond";

/// Default diffs font (monospace font for code diffs).
const DEFAULT_DIFFS_FONT: &str = "SF Mono";

/// Default glob patterns for identifying generated/lock files.
fn default_collapse_patterns() -> Vec<String> {
    vec![
        "*.lock".to_string(),
        "*-lock.json".to_string(),
        "*.min.js".to_string(),
        "*.min.css".to_string(),
        "*.map".to_string(),
        "*.generated.*".to_string(),
        "package-lock.json".to_string(),
        "bun.lockb".to_string(),
        "yarn.lock".to_string(),
        "pnpm-lock.yaml".to_string(),
        "Cargo.lock".to_string(),
    ]
}

/// Custom theme color inputs (3 hex colors).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomThemeColors {
    pub bg: String,
    pub text: String,
    pub accent: String,
}

/// Application settings.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    /// Sync configuration.
    pub sync: SyncConfig,
    /// Glob patterns for collapsing generated files in the file tree.
    pub collapse_patterns: Vec<String>,
    /// Active theme ID (e.g., "kanagawa-wave", "kanagawa-light", "loved", "custom").
    pub theme: String,
    /// UI font family name.
    pub ui_font: String,
    /// Display font family name (decorative heading font for page h1s).
    pub display_font: String,
    /// Diffs font family name (monospace font for code diffs).
    pub diffs_font: String,
    /// Custom theme input colors (bg, text, accent hex strings). None if no custom theme saved.
    pub custom_theme_colors: Option<CustomThemeColors>,
    /// Companion server settings (mobile web access).
    pub companion_server: CompanionServerSettings,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            sync: SyncConfig::default(),
            collapse_patterns: default_collapse_patterns(),
            theme: DEFAULT_THEME.to_string(),
            ui_font: DEFAULT_UI_FONT.to_string(),
            display_font: DEFAULT_DISPLAY_FONT.to_string(),
            diffs_font: DEFAULT_DIFFS_FONT.to_string(),
            custom_theme_colors: None,
            companion_server: CompanionServerSettings::default(),
        }
    }
}

/// In-memory cache of settings.
static SETTINGS_CACHE: OnceLock<RwLock<AppSettings>> = OnceLock::new();

/// Get the settings cache, initializing if needed.
pub(crate) fn settings_cache() -> &'static RwLock<AppSettings> {
    SETTINGS_CACHE.get_or_init(|| RwLock::new(AppSettings::default()))
}

/// Load settings from store, using defaults if not found.
pub(crate) async fn load_settings(app: &AppHandle) -> Result<AppSettings, AppError> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| AppError::internal(format!("Failed to open settings store: {}", e)))?;

    // Try to load sync config
    let sync = match store.get(SYNC_CONFIG_KEY) {
        Some(value) => serde_json::from_value(value.clone()).unwrap_or_default(),
        None => SyncConfig::default(),
    };

    // Try to load collapse patterns
    let collapse_patterns = match store.get(COLLAPSE_PATTERNS_KEY) {
        Some(value) => {
            serde_json::from_value(value.clone()).unwrap_or_else(|_| default_collapse_patterns())
        }
        None => default_collapse_patterns(),
    };

    // Try to load theme
    let theme = match store.get(THEME_KEY) {
        Some(value) => {
            serde_json::from_value(value.clone()).unwrap_or_else(|_| DEFAULT_THEME.to_string())
        }
        None => DEFAULT_THEME.to_string(),
    };

    // Try to load UI font
    let ui_font = match store.get(UI_FONT_KEY) {
        Some(value) => {
            serde_json::from_value(value.clone()).unwrap_or_else(|_| DEFAULT_UI_FONT.to_string())
        }
        None => DEFAULT_UI_FONT.to_string(),
    };

    // Try to load display font
    let display_font = match store.get(DISPLAY_FONT_KEY) {
        Some(value) => serde_json::from_value(value.clone())
            .unwrap_or_else(|_| DEFAULT_DISPLAY_FONT.to_string()),
        None => DEFAULT_DISPLAY_FONT.to_string(),
    };

    // Try to load diffs font
    let diffs_font = match store.get(DIFFS_FONT_KEY) {
        Some(value) => serde_json::from_value(value.clone())
            .unwrap_or_else(|_| DEFAULT_DIFFS_FONT.to_string()),
        None => DEFAULT_DIFFS_FONT.to_string(),
    };

    // Try to load custom theme colors
    let custom_theme_colors = match store.get(CUSTOM_THEME_COLORS_KEY) {
        Some(value) => serde_json::from_value(value.clone()).ok(),
        None => None,
    };

    // Try to load companion server settings
    let companion_server = match store.get(COMPANION_SERVER_KEY) {
        Some(value) => serde_json::from_value(value.clone()).unwrap_or_default(),
        None => CompanionServerSettings::default(),
    };

    Ok(AppSettings {
        sync,
        collapse_patterns,
        theme,
        ui_font,
        display_font,
        diffs_font,
        custom_theme_colors,
        companion_server,
    })
}

/// Save settings to store.
pub(crate) async fn save_settings(app: &AppHandle, settings: &AppSettings) -> Result<(), AppError> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| AppError::internal(format!("Failed to open settings store: {}", e)))?;

    // Save sync config
    let sync_value = serde_json::to_value(&settings.sync)?;
    store.set(SYNC_CONFIG_KEY, sync_value);

    // Save collapse patterns
    let collapse_value = serde_json::to_value(&settings.collapse_patterns)?;
    store.set(COLLAPSE_PATTERNS_KEY, collapse_value);

    // Save theme
    let theme_value = serde_json::to_value(&settings.theme)?;
    store.set(THEME_KEY, theme_value);

    // Save UI font
    let ui_font_value = serde_json::to_value(&settings.ui_font)?;
    store.set(UI_FONT_KEY, ui_font_value);

    // Save display font
    let display_font_value = serde_json::to_value(&settings.display_font)?;
    store.set(DISPLAY_FONT_KEY, display_font_value);

    // Save diffs font
    let diffs_font_value = serde_json::to_value(&settings.diffs_font)?;
    store.set(DIFFS_FONT_KEY, diffs_font_value);

    // Save custom theme colors
    let custom_theme_value = serde_json::to_value(&settings.custom_theme_colors)?;
    store.set(CUSTOM_THEME_COLORS_KEY, custom_theme_value);

    // Save companion server settings
    let companion_value = serde_json::to_value(&settings.companion_server)?;
    store.set(COMPANION_SERVER_KEY, companion_value);

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
    sync_handle: State<'_, SyncHandle>,
    sync_config: SyncConfig,
) -> Result<(), AppError> {
    // Get current settings
    let mut settings = load_settings(&app).await?;

    // Update sync config
    settings.sync = sync_config.clone();

    // Save
    save_settings(&app, &settings).await?;

    // Update cache
    *settings_cache().write().await = settings;

    // Notify the running sync engine so it picks up the new interval
    sync_handle.update_config(sync_config).await?;

    Ok(())
}

/// Get the current collapse patterns.
///
/// Convenience method that returns just the collapse patterns.
///
/// # Returns
/// Current collapse patterns
#[tauri::command]
pub async fn get_collapse_patterns(app: AppHandle) -> Result<Vec<String>, AppError> {
    let settings = get_settings(app).await?;
    Ok(settings.collapse_patterns)
}

/// Update the collapse patterns.
///
/// Convenience method that updates just the collapse patterns.
///
/// # Arguments
/// * `patterns` - New list of glob patterns
#[tauri::command]
pub async fn update_collapse_patterns(
    app: AppHandle,
    patterns: Vec<String>,
) -> Result<(), AppError> {
    let mut settings = load_settings(&app).await?;
    settings.collapse_patterns = patterns;
    save_settings(&app, &settings).await?;
    *settings_cache().write().await = settings;
    Ok(())
}

/// Update the active theme.
///
/// Convenience method that updates just the theme ID.
///
/// # Arguments
/// * `theme_id` - The new theme ID (e.g. "kanagawa-wave", "kanagawa-light", "loved", "custom")
#[tauri::command]
pub async fn update_theme(app: AppHandle, theme_id: String) -> Result<(), AppError> {
    let mut settings = load_settings(&app).await?;
    settings.theme = theme_id;
    save_settings(&app, &settings).await?;
    *settings_cache().write().await = settings;
    Ok(())
}

/// Update the UI font.
///
/// Convenience method that updates just the UI font family name.
///
/// # Arguments
/// * `font` - The font family name (e.g. "Noto Sans JP", "Inter", "System Default")
#[tauri::command]
pub async fn update_ui_font(app: AppHandle, font: String) -> Result<(), AppError> {
    let mut settings = load_settings(&app).await?;
    settings.ui_font = font;
    save_settings(&app, &settings).await?;
    *settings_cache().write().await = settings;
    Ok(())
}

/// Update the display font.
///
/// Convenience method that updates just the display font family name.
///
/// # Arguments
/// * `font` - The font family name (e.g. "Cormorant Garamond", "Inter", "System Default")
#[tauri::command]
pub async fn update_display_font(app: AppHandle, font: String) -> Result<(), AppError> {
    let mut settings = load_settings(&app).await?;
    settings.display_font = font;
    save_settings(&app, &settings).await?;
    *settings_cache().write().await = settings;
    Ok(())
}

/// Update the diffs font.
///
/// Convenience method that updates just the diffs (code) font family name.
///
/// # Arguments
/// * `font` - The font family name (e.g. "SF Mono", "JetBrains Mono", "System Default")
#[tauri::command]
pub async fn update_diffs_font(app: AppHandle, font: String) -> Result<(), AppError> {
    let mut settings = load_settings(&app).await?;
    settings.diffs_font = font;
    save_settings(&app, &settings).await?;
    *settings_cache().write().await = settings;
    Ok(())
}

/// Update the custom theme colors.
///
/// Convenience method that updates just the custom theme color inputs.
/// Pass `None` to delete the saved custom theme.
///
/// # Arguments
/// * `colors` - The 3 hex color inputs (bg, text, accent), or null to delete
#[tauri::command]
pub async fn update_custom_theme_colors(
    app: AppHandle,
    colors: Option<CustomThemeColors>,
) -> Result<(), AppError> {
    let mut settings = load_settings(&app).await?;
    settings.custom_theme_colors = colors;
    save_settings(&app, &settings).await?;
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

    #[test]
    fn test_default_collapse_patterns() {
        let settings = AppSettings::default();
        assert!(!settings.collapse_patterns.is_empty());
        assert!(settings.collapse_patterns.contains(&"*.lock".to_string()));
        assert!(settings
            .collapse_patterns
            .contains(&"package-lock.json".to_string()));
        assert!(settings
            .collapse_patterns
            .contains(&"Cargo.lock".to_string()));
    }
}
