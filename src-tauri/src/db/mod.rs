//! Database layer for local SQLite storage.
//!
//! This module handles all database operations including:
//! - Connection pool management with WAL mode
//! - Schema migrations
//! - Query helpers

pub mod file_cache;
pub mod pool;

use std::path::{Path, PathBuf};
use thiserror::Error;

/// Database-related errors.
#[derive(Debug, Error)]
pub enum DbError {
    #[error("SQLite error: {0}")]
    Sqlite(#[from] sqlx::Error),

    #[error("Migration error: {0}")]
    Migration(String),

    #[error("Database not initialized")]
    NotInitialized,
}

/// Get the path to the SQLite database file.
///
/// The database is stored in the Tauri app data directory.
pub fn get_db_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("ultra-gitlab.db")
}

/// Initialize the database: create the file if needed and run migrations.
///
/// # Arguments
/// * `db_path` - Path to the SQLite database file
///
/// # Returns
/// A connection pool configured with WAL mode
pub async fn initialize(db_path: &Path) -> Result<pool::DbPool, DbError> {
    // Ensure parent directory exists
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| {
            DbError::Migration(format!("Failed to create database directory: {}", e))
        })?;
    }

    // Create the connection pool
    let pool = pool::create_pool(db_path).await?;

    // Run migrations
    run_migrations(&pool).await?;

    Ok(pool)
}

/// Available migrations in order.
const MIGRATIONS: &[(&str, &str)] = &[
    ("0001_initial_schema", include_str!("migrations/0001_initial_schema.sql")),
    ("0002_add_discarded_status", include_str!("migrations/0002_add_discarded_status.sql")),
    ("0003_add_user_has_approved", include_str!("migrations/0003_add_user_has_approved.sql")),
    ("0004_add_project_name", include_str!("migrations/0004_add_project_name.sql")),
    ("0005_create_projects_table", include_str!("migrations/0005_create_projects_table.sql")),
    ("0006_file_content_cache", include_str!("migrations/0006_file_content_cache.sql")),
    ("0007_gitattributes_cache", include_str!("migrations/0007_gitattributes_cache.sql")),
    ("0008_add_authenticated_username", include_str!("migrations/0008_add_authenticated_username.sql")),
    ("0009_create_mr_reviewers", include_str!("migrations/0009_create_mr_reviewers.sql")),
];

/// Run all pending database migrations.
async fn run_migrations(pool: &pool::DbPool) -> Result<(), DbError> {
    // Get a connection from the pool
    let mut conn = pool.acquire().await?;

    // Create migrations table if it doesn't exist
    sqlx::query(
        r#"
        CREATE TABLE IF NOT EXISTS _migrations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            applied_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )
        "#,
    )
    .execute(&mut *conn)
    .await?;

    // Run each migration if not already applied
    for (name, sql) in MIGRATIONS {
        let applied: Option<(i64,)> = sqlx::query_as(
            "SELECT id FROM _migrations WHERE name = ?",
        )
        .bind(*name)
        .fetch_optional(&mut *conn)
        .await?;

        if applied.is_none() {
            // Parse and run SQL statements
            for statement in parse_sql_statements(sql) {
                sqlx::query(&statement).execute(&mut *conn).await?;
            }

            // Record the migration
            sqlx::query("INSERT INTO _migrations (name) VALUES (?)")
                .bind(*name)
                .execute(&mut *conn)
                .await?;
        }
    }

    Ok(())
}

/// Parse SQL statements from a migration file.
///
/// This handles:
/// - Comments (lines starting with --)
/// - Semicolons inside parentheses (e.g., `strftime('%s', 'now')`)
/// - Multi-line statements
fn parse_sql_statements(sql: &str) -> Vec<String> {
    let mut statements = Vec::new();
    let mut current_statement = String::new();
    let mut paren_depth: i32 = 0;

    for line in sql.lines() {
        let trimmed = line.trim();

        // Skip comment-only lines
        if trimmed.starts_with("--") {
            continue;
        }

        // Remove inline comments
        let line_without_comment = if let Some(idx) = line.find("--") {
            &line[..idx]
        } else {
            line
        };

        for ch in line_without_comment.chars() {
            match ch {
                '(' => {
                    paren_depth += 1;
                    current_statement.push(ch);
                }
                ')' => {
                    paren_depth = paren_depth.saturating_sub(1);
                    current_statement.push(ch);
                }
                ';' if paren_depth == 0 => {
                    // End of statement
                    let stmt = current_statement.trim().to_string();
                    if !stmt.is_empty() {
                        statements.push(stmt);
                    }
                    current_statement.clear();
                }
                _ => {
                    current_statement.push(ch);
                }
            }
        }

        // Add a space between lines to preserve formatting
        if !current_statement.is_empty() {
            current_statement.push(' ');
        }
    }

    // Handle any remaining statement without trailing semicolon
    let final_stmt = current_statement.trim().to_string();
    if !final_stmt.is_empty() {
        statements.push(final_stmt);
    }

    statements
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_initialize_creates_database() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        let pool = initialize(&db_path).await.unwrap();

        // Verify the database file was created
        assert!(db_path.exists());

        // Verify tables were created
        let tables: Vec<(String,)> = sqlx::query_as(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name != '_migrations' ORDER BY name",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        let table_names: Vec<&str> = tables.iter().map(|(n,)| n.as_str()).collect();
        assert!(table_names.contains(&"gitlab_instances"));
        assert!(table_names.contains(&"merge_requests"));
        assert!(table_names.contains(&"diffs"));
        assert!(table_names.contains(&"diff_files"));
        assert!(table_names.contains(&"comments"));
        assert!(table_names.contains(&"sync_queue"));
        assert!(table_names.contains(&"sync_log"));
    }

    #[tokio::test]
    async fn test_migrations_are_idempotent() {
        let dir = tempdir().unwrap();
        let db_path = dir.path().join("test.db");

        // Initialize twice
        let _pool1 = initialize(&db_path).await.unwrap();
        let pool2 = initialize(&db_path).await.unwrap();

        // Should still have exactly the right number of migrations
        let count: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM _migrations")
            .fetch_one(&pool2)
            .await
            .unwrap();
        assert_eq!(count.0, MIGRATIONS.len() as i64);
    }
}
