//! Diagnostic commands for memory and performance verification.
//!
//! These commands are used for testing and validating success criteria:
//! - SC-008: Application uses less than 500MB RAM with 100 cached MRs

use crate::db::pool::DbPool;
use crate::error::AppError;
use serde::Serialize;
use sqlx::Row;
use sysinfo::{Pid, System};
use tauri::State;

/// Memory usage statistics
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MemoryStats {
    /// Current process memory usage in bytes
    pub process_memory_bytes: u64,
    /// Current process memory usage in MB (for easy reading)
    pub process_memory_mb: f64,
    /// System total memory in bytes
    pub system_total_bytes: u64,
    /// System used memory in bytes
    pub system_used_bytes: u64,
    /// Whether memory usage is under the 500MB target (SC-008)
    pub under_target: bool,
    /// The target memory limit in bytes (500MB)
    pub target_bytes: u64,
}

/// Database cache statistics
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheStats {
    /// Number of cached merge requests
    pub mr_count: i64,
    /// Number of cached diff files
    pub diff_file_count: i64,
    /// Number of cached comments
    pub comment_count: i64,
    /// Total database size in bytes
    pub db_size_bytes: i64,
    /// Database size in MB
    pub db_size_mb: f64,
}

/// Combined diagnostics report
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiagnosticsReport {
    pub memory: MemoryStats,
    pub cache: CacheStats,
    /// Timestamp of the report
    pub timestamp: i64,
}

/// Test data generation result
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestDataResult {
    /// Number of MRs generated
    pub mrs_generated: i32,
    /// Number of diff files generated
    pub diff_files_generated: i32,
    /// Number of comments generated
    pub comments_generated: i32,
    /// Time taken in milliseconds
    pub duration_ms: u64,
}

const TARGET_MEMORY_BYTES: u64 = 500 * 1024 * 1024; // 500MB

/// Get current memory usage statistics.
#[tauri::command]
pub async fn get_memory_stats() -> Result<MemoryStats, AppError> {
    let mut sys = System::new();
    sys.refresh_memory();

    let pid = Pid::from_u32(std::process::id());
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);

    let process_memory = sys
        .process(pid)
        .map(|p| p.memory())
        .unwrap_or(0);

    Ok(MemoryStats {
        process_memory_bytes: process_memory,
        process_memory_mb: process_memory as f64 / (1024.0 * 1024.0),
        system_total_bytes: sys.total_memory(),
        system_used_bytes: sys.used_memory(),
        under_target: process_memory < TARGET_MEMORY_BYTES,
        target_bytes: TARGET_MEMORY_BYTES,
    })
}

/// Get database cache statistics.
#[tauri::command]
pub async fn get_cache_stats(pool: State<'_, DbPool>) -> Result<CacheStats, AppError> {

    // Get counts
    let mr_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM merge_requests")
        .fetch_one(pool.inner())
        .await?;

    let diff_file_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM diff_files")
        .fetch_one(pool.inner())
        .await?;

    let comment_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM comments")
        .fetch_one(pool.inner())
        .await?;

    // Get database size
    let row = sqlx::query("SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()")
        .fetch_one(pool.inner())
        .await?;
    let db_size_bytes: i64 = row.get("size");

    Ok(CacheStats {
        mr_count,
        diff_file_count,
        comment_count,
        db_size_bytes,
        db_size_mb: db_size_bytes as f64 / (1024.0 * 1024.0),
    })
}

/// Get a full diagnostics report.
#[tauri::command]
pub async fn get_diagnostics_report(pool: State<'_, DbPool>) -> Result<DiagnosticsReport, AppError> {
    let memory = get_memory_stats().await?;
    let cache = get_cache_stats(pool).await?;

    let timestamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    Ok(DiagnosticsReport {
        memory,
        cache,
        timestamp,
    })
}

/// Generate test data for memory verification (SC-008).
///
/// Creates realistic test data with:
/// - 100 merge requests
/// - ~10 files per MR with diff content
/// - ~5 comments per MR
#[tauri::command]
pub async fn generate_test_data(
    pool: State<'_, DbPool>,
    mr_count: Option<i32>,
) -> Result<TestDataResult, AppError> {
    let start = std::time::Instant::now();
    let count = mr_count.unwrap_or(100);

    // First, ensure we have a test GitLab instance
    let instance_id: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO gitlab_instances (url, name)
        VALUES ('https://test.gitlab.com', 'Test Instance')
        ON CONFLICT (url) DO UPDATE SET name = 'Test Instance'
        RETURNING id
        "#
    )
    .fetch_one(pool.inner())
    .await?;

    let mut mrs_generated = 0;
    let mut diff_files_generated = 0;
    let mut comments_generated = 0;

    let base_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    for i in 0..count {
        let mr_id = 1_000_000 + i as i64; // Use high IDs to avoid conflicts
        let iid = 100 + i as i64;
        let project_id = 1000;

        // Insert merge request
        sqlx::query(
            r#"
            INSERT OR REPLACE INTO merge_requests (
                id, instance_id, iid, project_id, title, description,
                author_username, source_branch, target_branch, state, web_url,
                created_at, updated_at, approval_status, approvals_required, approvals_count,
                labels, reviewers
            ) VALUES (
                ?, ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?, ?, ?, ?,
                ?, ?
            )
            "#
        )
        .bind(mr_id)
        .bind(instance_id)
        .bind(iid)
        .bind(project_id)
        .bind(format!("Test MR #{}: Implement feature XYZ-{}", i + 1, i))
        .bind(format!("This is a test merge request description for MR #{}. It contains multiple paragraphs of text to simulate realistic content.\n\n## Changes\n- Added new feature\n- Fixed bug\n- Updated documentation", i + 1))
        .bind("test-user")
        .bind(format!("feature/test-branch-{}", i))
        .bind("main")
        .bind("opened")
        .bind(format!("https://test.gitlab.com/project/mr/{}", iid))
        .bind(base_time - (i as i64 * 3600)) // Stagger creation times
        .bind(base_time - (i as i64 * 1800)) // Stagger update times
        .bind("pending")
        .bind(2)
        .bind(if i % 3 == 0 { 1 } else { 0 })
        .bind("[\"bug\", \"enhancement\", \"needs-review\"]")
        .bind("[\"reviewer1\", \"reviewer2\"]")
        .execute(pool.inner())
        .await?;

        mrs_generated += 1;

        // Insert diff metadata
        let base_sha = format!("abc{:06x}", i);
        let head_sha = format!("def{:06x}", i);
        let start_sha = format!("012{:06x}", i);

        // Generate realistic diff content
        let files_per_mr = 8 + (i % 5) as i32; // 8-12 files per MR

        sqlx::query(
            r#"
            INSERT OR REPLACE INTO diffs (mr_id, content, base_sha, head_sha, start_sha, file_count, additions, deletions)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            "#
        )
        .bind(mr_id)
        .bind(generate_diff_content(files_per_mr))
        .bind(&base_sha)
        .bind(&head_sha)
        .bind(&start_sha)
        .bind(files_per_mr)
        .bind(50 + (i % 100) as i32)
        .bind(20 + (i % 50) as i32)
        .execute(pool.inner())
        .await?;

        // Insert individual diff files
        for file_idx in 0..files_per_mr {
            let file_path = get_test_file_path(file_idx);
            let change_type = match file_idx % 4 {
                0 => "added",
                1 => "modified",
                2 => "deleted",
                _ => "modified",
            };

            sqlx::query(
                r#"
                INSERT INTO diff_files (
                    mr_id, old_path, new_path, change_type, additions, deletions, file_position, diff_content
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                "#
            )
            .bind(mr_id)
            .bind(if change_type == "added" { None } else { Some(&file_path) })
            .bind(&file_path)
            .bind(change_type)
            .bind(10 + (file_idx % 20) as i32)
            .bind(5 + (file_idx % 10) as i32)
            .bind(file_idx)
            .bind(generate_file_diff_content(&file_path, 10 + file_idx % 15))
            .execute(pool.inner())
            .await?;

            diff_files_generated += 1;
        }

        // Insert comments (3-7 per MR)
        let comments_per_mr = 3 + (i % 5) as i32;
        for comment_idx in 0..comments_per_mr {
            let comment_id = mr_id * 1000 + comment_idx as i64;
            let discussion_id = format!("disc-{}-{}", mr_id, comment_idx / 2);
            let is_inline = comment_idx % 2 == 0;

            sqlx::query(
                r#"
                INSERT OR REPLACE INTO comments (
                    id, mr_id, discussion_id, author_username, body,
                    file_path, new_line, resolved, resolvable, system, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                "#
            )
            .bind(comment_id)
            .bind(mr_id)
            .bind(&discussion_id)
            .bind(format!("reviewer{}", (comment_idx % 3) + 1))
            .bind(format!("This is comment #{} on MR #{}. It provides feedback on the code changes. Consider refactoring this section for better readability.", comment_idx + 1, i + 1))
            .bind(if is_inline { Some(get_test_file_path(comment_idx % files_per_mr)) } else { None::<String> })
            .bind(if is_inline { Some(10 + comment_idx * 5) } else { None::<i32> })
            .bind(if comment_idx % 4 == 0 { 1 } else { 0 })
            .bind(1)
            .bind(0)
            .bind(base_time - (comment_idx as i64 * 600))
            .bind(base_time - (comment_idx as i64 * 300))
            .execute(pool.inner())
            .await?;

            comments_generated += 1;
        }
    }

    let duration = start.elapsed();

    Ok(TestDataResult {
        mrs_generated,
        diff_files_generated,
        comments_generated,
        duration_ms: duration.as_millis() as u64,
    })
}

/// Clear all test data (MRs with IDs >= 1,000,000).
#[tauri::command]
pub async fn clear_test_data(pool: State<'_, DbPool>) -> Result<i64, AppError> {
    let result = sqlx::query("DELETE FROM merge_requests WHERE id >= 1000000")
        .execute(pool.inner())
        .await?;

    Ok(result.rows_affected() as i64)
}

/// Generate realistic diff content for a given number of files.
fn generate_diff_content(file_count: i32) -> String {
    let mut content = String::new();
    for i in 0..file_count {
        let path = get_test_file_path(i);
        content.push_str(&format!("diff --git a/{path} b/{path}\n"));
        content.push_str(&format!("index abc123..def456 100644\n"));
        content.push_str(&format!("--- a/{path}\n"));
        content.push_str(&format!("+++ b/{path}\n"));
        content.push_str("@@ -1,10 +1,15 @@\n");
        content.push_str(" // Existing code\n");
        content.push_str(" function example() {\n");
        content.push_str("-    console.log('old code');\n");
        content.push_str("+    console.log('new code');\n");
        content.push_str("+    // Added new functionality\n");
        content.push_str("+    return processData();\n");
        content.push_str(" }\n");
        content.push_str("\n");
    }
    content
}

/// Generate realistic diff content for a single file with syntax.
fn generate_file_diff_content(file_path: &str, lines: i32) -> String {
    let mut content = String::new();

    // Determine language-appropriate content
    let is_ts = file_path.ends_with(".ts") || file_path.ends_with(".tsx");
    let is_py = file_path.ends_with(".py");
    let is_rs = file_path.ends_with(".rs");

    content.push_str(&format!("@@ -1,{} +1,{} @@\n", lines, lines + 5));

    if is_ts {
        content.push_str(" import { useState, useEffect } from 'react';\n");
        content.push_str(" \n");
        content.push_str("-export function OldComponent() {\n");
        content.push_str("+export function NewComponent({ data }: Props) {\n");
        content.push_str("+  const [state, setState] = useState(null);\n");
        content.push_str("+  \n");
        content.push_str("   return (\n");
        content.push_str("-    <div>Old content</div>\n");
        content.push_str("+    <div className=\"container\">\n");
        content.push_str("+      {data.map(item => <Item key={item.id} {...item} />)}\n");
        content.push_str("+    </div>\n");
        content.push_str("   );\n");
        content.push_str(" }\n");
    } else if is_py {
        content.push_str(" def process_data(items: list) -> dict:\n");
        content.push_str("-    result = {}\n");
        content.push_str("+    result: dict[str, Any] = {}\n");
        content.push_str("     for item in items:\n");
        content.push_str("-        result[item.id] = item.value\n");
        content.push_str("+        result[item.id] = process_item(item)\n");
        content.push_str("+    return result\n");
    } else if is_rs {
        content.push_str(" pub fn process_data(items: &[Item]) -> HashMap<String, Value> {\n");
        content.push_str("-    let mut result = HashMap::new();\n");
        content.push_str("+    let mut result: HashMap<String, Value> = HashMap::with_capacity(items.len());\n");
        content.push_str("     for item in items {\n");
        content.push_str("-        result.insert(item.id.clone(), item.value.clone());\n");
        content.push_str("+        result.insert(item.id.clone(), process_item(item)?);\n");
        content.push_str("     }\n");
        content.push_str("+    Ok(result)\n");
        content.push_str(" }\n");
    } else {
        // Generic content
        for i in 0..lines {
            if i % 5 == 0 {
                content.push_str(&format!("-// Line {} removed\n", i));
                content.push_str(&format!("+// Line {} updated\n", i));
            } else {
                content.push_str(&format!(" // Line {} unchanged\n", i));
            }
        }
    }

    content
}

/// Get a realistic file path for test data.
fn get_test_file_path(index: i32) -> String {
    let paths = [
        "src/components/Button/Button.tsx",
        "src/components/Modal/Modal.tsx",
        "src/hooks/useAuth.ts",
        "src/services/api.ts",
        "src/utils/helpers.ts",
        "src/pages/Dashboard.tsx",
        "src/App.tsx",
        "tests/unit/Button.test.tsx",
        "scripts/build.py",
        "src-tauri/src/main.rs",
        "src-tauri/src/commands.rs",
        "src/styles/main.css",
    ];

    paths[(index as usize) % paths.len()].to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_get_memory_stats() {
        let stats = get_memory_stats().await.unwrap();
        assert!(stats.process_memory_bytes > 0);
        assert!(stats.system_total_bytes > 0);
    }

    #[test]
    fn test_generate_diff_content() {
        let content = generate_diff_content(3);
        assert!(content.contains("diff --git"));
        assert!(content.lines().count() > 20);
    }

    #[test]
    fn test_get_test_file_path() {
        let path = get_test_file_path(0);
        assert!(path.ends_with(".tsx"));

        let path2 = get_test_file_path(8);
        assert!(path2.ends_with(".py"));
    }
}
