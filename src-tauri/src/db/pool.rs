//! SQLite connection pool with WAL mode.
//!
//! Provides a thread-safe connection pool for SQLite with Write-Ahead Logging (WAL)
//! enabled for concurrent read access during writes.

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions, SqliteSynchronous};
use sqlx::{Pool, Sqlite};
use std::path::Path;
use std::str::FromStr;

/// Type alias for the SQLite connection pool.
pub type DbPool = Pool<Sqlite>;

/// Create a new connection pool with WAL mode enabled.
///
/// WAL mode provides:
/// - Concurrent reads during writes
/// - Better performance for read-heavy workloads
/// - Crash recovery
///
/// # Arguments
/// * `db_path` - Path to the SQLite database file
///
/// # Returns
/// A connection pool ready for use
pub async fn create_pool(db_path: &Path) -> Result<DbPool, sqlx::Error> {
    let db_url = format!("sqlite:{}", db_path.display());

    let connect_options = SqliteConnectOptions::from_str(&db_url)?
        // Create the database file if it doesn't exist
        .create_if_missing(true)
        // Enable WAL mode for concurrent access
        .journal_mode(SqliteJournalMode::Wal)
        // NORMAL synchronous mode balances safety and performance
        .synchronous(SqliteSynchronous::Normal)
        // Enable foreign key constraints
        .foreign_keys(true)
        // Increase busy timeout to handle concurrent access
        .busy_timeout(std::time::Duration::from_secs(30))
        // Auto-checkpoint WAL every 1000 pages (~4MB) to prevent WAL bloat
        .pragma("wal_autocheckpoint", "1000")
        // Memory-map the first 64MB for faster reads and fewer I/O errors
        .pragma("mmap_size", "67108864");

    let pool = SqlitePoolOptions::new()
        // Max connections: SQLite handles concurrency via WAL, so we keep this moderate
        .max_connections(5)
        // Min connections: Keep at least one connection warm
        .min_connections(1)
        // Connection timeout
        .acquire_timeout(std::time::Duration::from_secs(10))
        .connect_with(connect_options)
        .await?;

    // Verify WAL mode is enabled
    let mode: (String,) = sqlx::query_as("PRAGMA journal_mode")
        .fetch_one(&pool)
        .await?;

    debug_assert!(
        mode.0.to_lowercase() == "wal",
        "WAL mode should be enabled, got: {}",
        mode.0
    );

    Ok(pool)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_create_pool_with_wal() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        let pool = create_pool(&db_path).await.unwrap();

        // Verify WAL mode
        let mode: (String,) = sqlx::query_as("PRAGMA journal_mode")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(mode.0.to_lowercase(), "wal");

        // Verify foreign keys are enabled
        let fk: (i64,) = sqlx::query_as("PRAGMA foreign_keys")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(fk.0, 1);
    }

    #[tokio::test]
    async fn test_pool_creates_database_file() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("subdir/test.db");

        // Parent directory doesn't exist yet
        assert!(!db_path.parent().unwrap().exists());

        // Pool creation should fail if parent doesn't exist
        // (create_if_missing only creates the file, not directories)
        let result = create_pool(&db_path).await;
        assert!(result.is_err());

        // Create parent directory first
        std::fs::create_dir_all(db_path.parent().unwrap()).unwrap();

        // Now pool creation should succeed
        let pool = create_pool(&db_path).await.unwrap();
        assert!(db_path.exists());

        // Basic query should work
        let result: (i64,) = sqlx::query_as("SELECT 1").fetch_one(&pool).await.unwrap();
        assert_eq!(result.0, 1);
    }
}
