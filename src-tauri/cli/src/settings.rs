//! Read the desktop app's user settings that the CLI honours.
//!
//! The desktop persists settings via `tauri-plugin-store` to a `settings.json`
//! file that lives alongside the SQLite database in the app data directory. The
//! CLI shares that database, so it reads the same store to pick up the user's
//! collapse (ignore) glob patterns — keeping "ignored diffs" identical between
//! the two frontends without any extra configuration.

use std::path::Path;

/// Store filename, matching `SETTINGS_STORE` in the desktop's settings command.
const STORE_FILE: &str = "settings.json";

/// Key for the collapse-patterns list in the store.
const COLLAPSE_PATTERNS_KEY: &str = "collapse_patterns";

/// Default glob patterns for generated/lock files. Mirrors
/// `default_collapse_patterns()` in `src-tauri/src/commands/settings.rs`, used
/// when the store has no explicit list (fresh installs, never opened settings).
pub fn default_collapse_patterns() -> Vec<String> {
    [
        "*.lock",
        "*-lock.json",
        "*.min.js",
        "*.min.css",
        "*.map",
        "*.generated.*",
        "package-lock.json",
        "bun.lockb",
        "yarn.lock",
        "pnpm-lock.yaml",
        "Cargo.lock",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect()
}

/// Load the user's collapse patterns from the store next to `db_path`.
///
/// The store sits beside the database (the desktop writes both into the same
/// app-data directory). Any failure — missing file, malformed JSON, absent key
/// — falls back to the built-in defaults so the CLI always has a sensible set.
pub fn load_collapse_patterns(db_path: &Path) -> Vec<String> {
    let Some(store_path) = db_path.parent().map(|dir| dir.join(STORE_FILE)) else {
        return default_collapse_patterns();
    };
    let Ok(text) = std::fs::read_to_string(&store_path) else {
        return default_collapse_patterns();
    };
    let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
        return default_collapse_patterns();
    };
    match json.get(COLLAPSE_PATTERNS_KEY).and_then(|v| v.as_array()) {
        Some(arr) => arr
            .iter()
            .filter_map(|v| v.as_str().map(String::from))
            .collect(),
        None => default_collapse_patterns(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_store(dir: &Path, contents: &str) {
        let mut f = std::fs::File::create(dir.join(STORE_FILE)).unwrap();
        f.write_all(contents.as_bytes()).unwrap();
    }

    #[test]
    fn missing_store_yields_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let db = dir.path().join("ultra-gitlab.db");
        assert_eq!(load_collapse_patterns(&db), default_collapse_patterns());
    }

    #[test]
    fn reads_patterns_from_store() {
        let dir = tempfile::tempdir().unwrap();
        write_store(
            dir.path(),
            r#"{ "theme": "x", "collapse_patterns": ["project/**/*.yaml", "*.lock"] }"#,
        );
        let db = dir.path().join("ultra-gitlab.db");
        assert_eq!(
            load_collapse_patterns(&db),
            vec!["project/**/*.yaml".to_string(), "*.lock".to_string()]
        );
    }

    #[test]
    fn malformed_json_yields_defaults() {
        let dir = tempfile::tempdir().unwrap();
        write_store(dir.path(), "{not json");
        let db = dir.path().join("ultra-gitlab.db");
        assert_eq!(load_collapse_patterns(&db), default_collapse_patterns());
    }

    #[test]
    fn absent_key_yields_defaults() {
        let dir = tempfile::tempdir().unwrap();
        write_store(dir.path(), r#"{ "theme": "kanagawa-wave" }"#);
        let db = dir.path().join("ultra-gitlab.db");
        assert_eq!(load_collapse_patterns(&db), default_collapse_patterns());
    }
}
