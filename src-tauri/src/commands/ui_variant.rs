//! Which frontend the app boots: the classic UI or the native UI beta.
//!
//! Both UIs ship in the same build. The choice lives in the settings store
//! under `ui_variant` and is read once at startup, because the two need a
//! differently built window (the native UI uses a transparent window with
//! sidebar vibrancy, which can't be toggled on a live window). The frontend
//! switches by calling `set_ui_variant` and relaunching.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Runtime};
use tauri_plugin_store::StoreExt;

const SETTINGS_STORE: &str = "settings.json";
const UI_VARIANT_KEY: &str = "ui_variant";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UiVariant {
    #[default]
    Classic,
    Native,
}

impl UiVariant {
    pub fn as_str(self) -> &'static str {
        match self {
            UiVariant::Classic => "classic",
            UiVariant::Native => "native",
        }
    }
}

/// The variant to boot. Mobile always gets the classic UI (the native UI is
/// desktop-only); anything unreadable falls back to classic.
pub fn load_ui_variant<R: Runtime>(app: &AppHandle<R>) -> UiVariant {
    if cfg!(mobile) {
        return UiVariant::Classic;
    }
    app.store(SETTINGS_STORE)
        .ok()
        .and_then(|store| store.get(UI_VARIANT_KEY))
        .and_then(|v| serde_json::from_value(v).ok())
        .unwrap_or_default()
}

/// Persist the UI to boot next launch. The caller relaunches the app.
#[tauri::command]
pub async fn set_ui_variant(app: AppHandle, variant: UiVariant) -> Result<(), AppError> {
    let store = app
        .store(SETTINGS_STORE)
        .map_err(|e| AppError::internal(format!("Failed to open settings store: {}", e)))?;
    store.set(UI_VARIANT_KEY, serde_json::json!(variant));
    store
        .save()
        .map_err(|e| AppError::internal(format!("Failed to save settings: {}", e)))?;
    log::info!("[ui] Next launch boots the {} UI", variant.as_str());
    Ok(())
}
