//! `ultra` — terminal UI for Ultra GitLab.

mod actions;
mod app;
mod comments;
mod data;
mod db_path;
mod editor;
mod event;
mod pipelines;
mod syntax;
mod ui;
mod update;
mod util;

use anyhow::Context;
use std::sync::Arc;
use tokio::sync::mpsc;
use ultra_gitlab_lib::core;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();

    // `ultra update` self-updates and exits (no DB / TUI). Blocking, so run it
    // off the async runtime.
    if args.first().map(String::as_str) == Some("update") {
        return tokio::task::spawn_blocking(update::run_update).await?;
    }

    let mut db_flag = None;
    let mut it = args.into_iter();
    while let Some(a) = it.next() {
        if a == "--db" {
            db_flag = it.next();
        } else if let Some(v) = a.strip_prefix("--db=") {
            db_flag = Some(v.to_string());
        }
    }

    let path = db_path::resolve_db_path(db_flag)?;
    if !path.exists() {
        anyhow::bail!(
            "Database not found at {}.\nRun the Ultra GitLab desktop app and sign in first.",
            path.display()
        );
    }
    let pool = ultra_gitlab_lib::db::initialize(&path)
        .await
        .with_context(|| format!("opening database at {}", path.display()))?;
    let instance_id = core::default_instance_id(&pool)
        .await?
        .context("No GitLab instance configured. Sign in via the desktop app first.")?;
    let username = core::authenticated_username(&pool, instance_id).await?;

    let (tx, rx) = mpsc::unbounded_channel();
    let app = app::App::new(Arc::new(pool), instance_id, username, tx);

    let terminal = ratatui::init();
    let result = app::run(terminal, app, rx).await;
    ratatui::restore();
    result
}
