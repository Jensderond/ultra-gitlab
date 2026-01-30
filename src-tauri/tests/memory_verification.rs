//! Memory verification test for SC-008: Application uses less than 500MB RAM with 100 cached MRs.
//!
//! This integration test verifies that memory usage stays under 500MB with 100 MRs cached.

use sysinfo::{Pid, System};
use tempfile::tempdir;

/// Target memory limit: 500MB
const TARGET_MEMORY_BYTES: u64 = 500 * 1024 * 1024;

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

/// Get current process memory usage in bytes.
fn get_process_memory() -> u64 {
    let mut sys = System::new();
    let pid = Pid::from_u32(std::process::id());
    sys.refresh_processes(sysinfo::ProcessesToUpdate::Some(&[pid]), true);
    sys.process(pid).map(|p| p.memory()).unwrap_or(0)
}

#[tokio::test]
async fn test_memory_with_100_cached_mrs() {
    // Create a temporary directory for the database
    let dir = tempdir().unwrap();
    let db_path = dir.path().join("test.db");

    // Initialize the database using the same method as the main app
    let pool = ultra_gitlab_lib::db::initialize(&db_path).await.expect("Failed to initialize database");

    // Record initial memory
    let initial_memory = get_process_memory();
    println!("Initial memory: {} MB", initial_memory as f64 / (1024.0 * 1024.0));

    // Insert test GitLab instance
    let instance_id: i64 = sqlx::query_scalar(
        r#"
        INSERT INTO gitlab_instances (url, name)
        VALUES ('https://test.gitlab.com', 'Test Instance')
        ON CONFLICT (url) DO UPDATE SET name = 'Test Instance'
        RETURNING id
        "#
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to insert instance");

    let base_time = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64;

    // Generate 100 MRs with realistic data
    let mr_count = 100;
    let mut total_diff_files = 0;
    let mut total_comments = 0;

    for i in 0..mr_count {
        let mr_id = 1_000_000i64 + i as i64;
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
        .bind(base_time - (i as i64 * 3600))
        .bind(base_time - (i as i64 * 1800))
        .bind("pending")
        .bind(2)
        .bind(if i % 3 == 0 { 1 } else { 0 })
        .bind("[\"bug\", \"enhancement\", \"needs-review\"]")
        .bind("[\"reviewer1\", \"reviewer2\"]")
        .execute(&pool)
        .await
        .expect("Failed to insert MR");

        // Insert diff metadata
        let base_sha = format!("abc{:06x}", i);
        let head_sha = format!("def{:06x}", i);
        let start_sha = format!("012{:06x}", i);
        let files_per_mr = 8 + (i % 5) as i32;

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
        .execute(&pool)
        .await
        .expect("Failed to insert diff");

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
            .execute(&pool)
            .await
            .expect("Failed to insert diff file");

            total_diff_files += 1;
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
            .bind(format!("This is comment #{} on MR #{}. It provides feedback on the code changes.", comment_idx + 1, i + 1))
            .bind(if is_inline { Some(get_test_file_path(comment_idx % files_per_mr)) } else { None::<String> })
            .bind(if is_inline { Some(10 + comment_idx * 5) } else { None::<i32> })
            .bind(if comment_idx % 4 == 0 { 1 } else { 0 })
            .bind(1)
            .bind(0)
            .bind(base_time - (comment_idx as i64 * 600))
            .bind(base_time - (comment_idx as i64 * 300))
            .execute(&pool)
            .await
            .expect("Failed to insert comment");

            total_comments += 1;
        }
    }

    // Get database size
    let row: (i64,) = sqlx::query_as(
        "SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size()"
    )
    .fetch_one(&pool)
    .await
    .expect("Failed to get database size");
    let db_size_bytes = row.0;

    // Load all data into memory to simulate the app having it cached
    let mrs: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT id, title, description FROM merge_requests"
    )
    .fetch_all(&pool)
    .await
    .expect("Failed to load MRs");

    let diff_files: Vec<(i64, String, String)> = sqlx::query_as(
        "SELECT id, new_path, diff_content FROM diff_files"
    )
    .fetch_all(&pool)
    .await
    .expect("Failed to load diff files");

    let comments: Vec<(i64, String)> = sqlx::query_as(
        "SELECT id, body FROM comments"
    )
    .fetch_all(&pool)
    .await
    .expect("Failed to load comments");

    // Record final memory after loading all data
    let final_memory = get_process_memory();
    let memory_increase = final_memory.saturating_sub(initial_memory);

    // Print diagnostics
    println!("\n=== Memory Verification Report (SC-008) ===");
    println!("MRs generated: {}", mr_count);
    println!("Diff files generated: {}", total_diff_files);
    println!("Comments generated: {}", total_comments);
    println!("Database size: {:.2} MB", db_size_bytes as f64 / (1024.0 * 1024.0));
    println!("");
    println!("Initial memory: {:.2} MB", initial_memory as f64 / (1024.0 * 1024.0));
    println!("Final memory: {:.2} MB", final_memory as f64 / (1024.0 * 1024.0));
    println!("Memory increase: {:.2} MB", memory_increase as f64 / (1024.0 * 1024.0));
    println!("Target limit: {:.2} MB", TARGET_MEMORY_BYTES as f64 / (1024.0 * 1024.0));
    println!("");

    // Keep data in scope to prevent optimization
    assert!(mrs.len() == mr_count);
    assert!(diff_files.len() == total_diff_files);
    assert!(comments.len() == total_comments);

    // Verify memory is under target
    if final_memory < TARGET_MEMORY_BYTES {
        println!("✅ PASS: Memory usage ({:.2} MB) is under target ({:.2} MB)",
            final_memory as f64 / (1024.0 * 1024.0),
            TARGET_MEMORY_BYTES as f64 / (1024.0 * 1024.0)
        );
    } else {
        println!("❌ FAIL: Memory usage ({:.2} MB) exceeds target ({:.2} MB)",
            final_memory as f64 / (1024.0 * 1024.0),
            TARGET_MEMORY_BYTES as f64 / (1024.0 * 1024.0)
        );
    }

    assert!(
        final_memory < TARGET_MEMORY_BYTES,
        "Memory usage ({} bytes / {:.2} MB) exceeds 500MB target",
        final_memory,
        final_memory as f64 / (1024.0 * 1024.0)
    );
}
