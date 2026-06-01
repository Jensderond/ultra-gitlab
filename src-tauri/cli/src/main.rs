//! `ultra` — terminal UI for Ultra GitLab.

mod db_path;

use anyhow::Context;
use ultra_gitlab_lib::core;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    // Crude flag parse: support `--db <path>` only for now.
    let mut args = std::env::args().skip(1);
    let mut db_flag = None;
    while let Some(a) = args.next() {
        if a == "--db" {
            db_flag = args.next();
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
    let user = core::authenticated_username(&pool, instance_id).await?;

    println!(
        "Connected to {} as {} (instance {})",
        path.display(),
        user.as_deref().unwrap_or("<unknown>"),
        instance_id
    );
    Ok(())
}
