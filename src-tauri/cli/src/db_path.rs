//! Resolve the SQLite database path the desktop app uses, so the CLI shares it.
//!
//! Order of precedence: `--db <path>` flag, `ULTRA_GITLAB_DB` env var, then the
//! default Tauri app-data location: `<data_dir>/<identifier>/ultra-gitlab.db`.
//! The identifier matches `src-tauri/tauri.conf.json`.

use std::path::PathBuf;

const IDENTIFIER: &str = "com.jens.ultra-gitlab";
const DB_FILE: &str = "ultra-gitlab.db";

/// Resolve the database path from an optional explicit override.
/// `flag` is the value of `--db` if passed on the command line.
pub fn resolve_db_path(flag: Option<String>) -> anyhow::Result<PathBuf> {
    if let Some(p) = flag {
        return Ok(PathBuf::from(p));
    }
    if let Ok(p) = std::env::var("ULTRA_GITLAB_DB") {
        return Ok(PathBuf::from(p));
    }
    let data = dirs::data_dir()
        .ok_or_else(|| anyhow::anyhow!("could not determine OS data directory"))?;
    Ok(data.join(IDENTIFIER).join(DB_FILE))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn flag_wins() {
        let p = resolve_db_path(Some("/tmp/x.db".into())).unwrap();
        assert_eq!(p, PathBuf::from("/tmp/x.db"));
    }

    #[test]
    fn default_ends_with_identifier_and_file() {
        // Ensure the env-var tier doesn't shadow the default-path tier under test.
        std::env::remove_var("ULTRA_GITLAB_DB");
        let p = resolve_db_path(None).unwrap();
        assert!(p.ends_with(format!("{IDENTIFIER}/{DB_FILE}")));
    }
}
