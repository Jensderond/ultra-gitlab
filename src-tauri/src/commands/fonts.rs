//! System font enumeration command.

use crate::error::AppError;
use serde::Serialize;
use std::sync::OnceLock;

/// A system font family name.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemFont {
    pub family: String,
}

/// Cached system font list — fonts don't change mid-session.
static SYSTEM_FONTS: OnceLock<Vec<SystemFont>> = OnceLock::new();

fn enumerate_system_fonts() -> Vec<SystemFont> {
    let mut db = fontdb::Database::new();
    db.load_system_fonts();

    let mut families: Vec<String> = db
        .faces()
        .filter_map(|face| {
            face.families
                .first()
                .map(|(name, _)| name.clone())
        })
        .filter(|name| !name.starts_with('.') && !name.starts_with('@'))
        .collect();

    families.sort_unstable_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    families.dedup();

    families
        .into_iter()
        .map(|family| SystemFont { family })
        .collect()
}

/// List all system fonts installed on the OS.
#[tauri::command]
pub async fn list_system_fonts() -> Result<Vec<SystemFont>, AppError> {
    let fonts = SYSTEM_FONTS.get_or_init(enumerate_system_fonts);
    Ok(fonts.clone())
}
