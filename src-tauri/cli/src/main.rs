//! `ultra` — terminal UI for Ultra GitLab.

mod actions;
mod app;
mod data;
mod db_path;
mod event;
mod syntax;
mod ui;

use anyhow::Context;
use std::sync::Arc;
use tokio::sync::mpsc;
use ultra_gitlab_lib::core;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let mut db_flag = None;
    while let Some(a) = args.next() {
        if a == "--db" {
            db_flag = args.next();
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
