//! Benchmark binary for measuring sync engine performance.
//!
//! Runs N sync cycles against a real GitLab instance and prints timing metrics.
//! Copies credentials from the real app database automatically.
//!
//! Usage: cargo run --bin bench_sync -- [--runs N]

use std::sync::Arc;

use ultra_gitlab_lib::db;
use ultra_gitlab_lib::services::sync_engine::{SyncConfig, SyncEngine};
use ultra_gitlab_lib::services::sync_events::NoopEmitter;

#[tokio::main]
async fn main() {
    env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("warn"))
        .format_timestamp_millis()
        .init();

    let runs: usize = std::env::args()
        .skip_while(|a| a != "--runs")
        .nth(1)
        .and_then(|v| v.parse().ok())
        .unwrap_or(5);

    // Find the real app database to copy credentials from
    let home = std::env::var("HOME").expect("HOME not set");
    let app_db_path = format!(
        "{}/Library/Application Support/com.jens.ultra-gitlab/ultra-gitlab.db",
        home
    );

    // Create a temp directory for the benchmark database
    let bench_dir = std::env::temp_dir().join("ultra-gitlab-bench");
    std::fs::create_dir_all(&bench_dir).expect("Failed to create bench directory");
    let db_path = bench_dir.join("bench.db");

    // Remove old DB to start fresh
    let _ = std::fs::remove_file(&db_path);
    let _ = std::fs::remove_file(db_path.with_extension("db-wal"));
    let _ = std::fs::remove_file(db_path.with_extension("db-shm"));

    eprintln!("=== Sync Engine Benchmark ===");
    eprintln!("Database: {}", db_path.display());
    eprintln!("Runs:     {}", runs);
    eprintln!();

    // Initialize benchmark database with all migrations
    let pool = db::initialize(&db_path)
        .await
        .expect("Failed to initialize database");

    // Copy credentials from the real app database
    let app_pool = db::pool::create_pool(std::path::Path::new(&app_db_path))
        .await
        .expect("Failed to open app database - is the app installed?");

    let instances: Vec<(i64, String, String, Option<String>, Option<String>, Option<String>)> =
        sqlx::query_as(
            "SELECT id, url, name, token, session_cookie, authenticated_username FROM gitlab_instances",
        )
        .fetch_all(&app_pool)
        .await
        .expect("Failed to read instances from app DB");

    eprintln!("Copying {} instance(s) from app database:", instances.len());
    for (id, url, name, token, session_cookie, username) in &instances {
        eprintln!("  #{}: {} ({}) user={}", id, url, name, username.as_deref().unwrap_or("?"));
        sqlx::query(
            "INSERT OR REPLACE INTO gitlab_instances (id, url, name, token, session_cookie, authenticated_username) \
             VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(id)
        .bind(url)
        .bind(name)
        .bind(token)
        .bind(session_cookie)
        .bind(username)
        .execute(&pool)
        .await
        .expect("Failed to insert instance");
    }
    eprintln!();

    // Create engine with no-op emitter and configure to sync both authored + reviewing
    let engine = SyncEngine::new(pool.clone(), Arc::new(NoopEmitter));
    engine
        .set_config(SyncConfig {
            sync_authored: true,
            sync_reviewing: true,
            ..SyncConfig::default()
        })
        .await;

    // Warm-up run (populates cache, establishes connections)
    eprint!("Warm-up run... ");
    match engine.run_sync().await {
        Ok(r) => {
            eprintln!(
                "OK ({} MRs, {}ms, {} errors)",
                r.mr_count, r.duration_ms, r.errors.len()
            );
            for err in &r.errors {
                eprintln!("  Error: {}", err);
            }
        }
        Err(e) => {
            eprintln!("FAILED: {}", e);
            std::process::exit(1);
        }
    }
    eprintln!();

    // Benchmark runs
    let mut durations = Vec::with_capacity(runs);
    let mut api_calls_vec = Vec::with_capacity(runs);
    let mut mr_counts = Vec::with_capacity(runs);

    for i in 1..=runs {
        eprint!("Run {}/{}... ", i, runs);
        match engine.run_sync().await {
            Ok(r) => {
                eprintln!(
                    "{}ms | {} API calls | {} MRs | {} errors",
                    r.duration_ms, r.api_calls, r.mr_count, r.errors.len()
                );
                durations.push(r.duration_ms);
                api_calls_vec.push(r.api_calls);
                mr_counts.push(r.mr_count);
            }
            Err(e) => {
                eprintln!("FAILED: {}", e);
            }
        }
    }

    // Print summary
    eprintln!();
    eprintln!("=== Results ({} runs) ===", durations.len());

    if !durations.is_empty() {
        durations.sort();
        let median_idx = durations.len() / 2;
        let sum: i64 = durations.iter().sum();
        let avg = sum / durations.len() as i64;

        eprintln!("Duration (ms):");
        eprintln!("  min:    {}", durations.first().unwrap());
        eprintln!("  median: {}", durations[median_idx]);
        eprintln!("  avg:    {}", avg);
        eprintln!("  max:    {}", durations.last().unwrap());

        let api_sum: u64 = api_calls_vec.iter().sum();
        let api_avg = api_sum / api_calls_vec.len() as u64;
        eprintln!("API calls (avg): {}", api_avg);
        eprintln!("MR count (last): {}", mr_counts.last().unwrap_or(&0));
    }

    // Also dump per-phase metrics from sync_metrics table
    eprintln!();
    eprintln!(
        "=== Per-Phase Metrics (from sync_metrics table, last {} runs) ===",
        runs
    );

    let phase_stats: Vec<(String, i64, i64, i64, i64)> = sqlx::query_as(
        "SELECT phase, COUNT(*) as cnt, MIN(duration_ms), CAST(AVG(duration_ms) AS INTEGER) as avg_ms, MAX(duration_ms) \
         FROM sync_metrics \
         GROUP BY phase \
         ORDER BY avg_ms DESC",
    )
    .fetch_all(&pool)
    .await
    .unwrap_or_default();

    eprintln!(
        "{:<15} {:>5} {:>8} {:>8} {:>8}",
        "Phase", "Count", "Min", "Avg", "Max"
    );
    eprintln!("{}", "-".repeat(50));
    for (phase, count, min, avg, max) in &phase_stats {
        eprintln!(
            "{:<15} {:>5} {:>7}ms {:>7}ms {:>7}ms",
            phase, count, min, avg, max
        );
    }

    // Clean up
    eprintln!();
    eprintln!("Database kept at: {}", db_path.display());
}
