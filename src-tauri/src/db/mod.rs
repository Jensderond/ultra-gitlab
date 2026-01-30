//! Database layer for local SQLite storage.
//!
//! This module handles all database operations including:
//! - Connection pool management with WAL mode
//! - Schema migrations
//! - Query helpers

// Submodules will be added as they are implemented:
// pub mod pool;
// pub mod migrations;

use std::path::PathBuf;

/// Get the path to the SQLite database file.
///
/// The database is stored in the Tauri app data directory.
pub fn get_db_path(app_data_dir: &PathBuf) -> PathBuf {
    app_data_dir.join("ultra-gitlab.db")
}
