//! Bridge between the Tauri-free `ultra_gitlab_lib` backend (SQLite + sync
//! engine) and the GPUI UI thread.
//!
//! GPUI runs its own executor; SQLx and the sync engine require a Tokio
//! runtime. We keep a dedicated multi-thread Tokio runtime alive on a
//! background thread, hand its [`Handle`] to GPUI, and bridge results back
//! into the UI thread with `oneshot` channels (the GPUI executor can poll
//! `tokio::sync::oneshot::Receiver` without needing Tokio context).
//!
//! The sync engine is started with [`NoopEmitter`] for now — driving UI
//! refreshes happens explicitly via the "Refresh" button in the UI, which
//! calls [`Backend::trigger_sync`]. Wiring a proper `EventEmitter` that pipes
//! into a GPUI signal is the obvious next step but out of scope for the
//! initial experiment.

use std::path::PathBuf;
use std::sync::Arc;

use tokio::runtime::{Handle, Runtime};
use tokio::sync::oneshot;

use ultra_gitlab_lib::db::{self, pool::DbPool};
use ultra_gitlab_lib::services::sync_engine::{SyncConfig, SyncEngine, SyncHandle};
use ultra_gitlab_lib::services::sync_events::NoopEmitter;

/// Lightweight projection of `merge_requests` used by the UI.
#[derive(Debug, Clone)]
#[allow(dead_code)] // id/state/web_url are kept for future actions (open, navigate).
pub struct MrRow {
    pub id: i64,
    pub iid: i64,
    pub project_name: String,
    pub title: String,
    pub author_username: String,
    pub source_branch: String,
    pub target_branch: String,
    pub state: String,
    pub updated_at: i64,
    pub web_url: String,
}

/// Lightweight projection of `gitlab_instances` used by the UI.
#[derive(Debug, Clone)]
#[allow(dead_code)] // url shown in tooltip once that wires up
pub struct InstanceRow {
    pub id: i64,
    pub name: String,
    pub url: String,
    pub is_default: bool,
}

/// Owned handle to the backend. Cheap to clone.
#[derive(Clone)]
pub struct Backend {
    pool: DbPool,
    rt: Handle,
    sync: SyncHandle,
}

impl Backend {
    /// Initialize the database, start the background sync engine, and
    /// return a handle the UI can talk to. Blocks until the runtime is
    /// ready; the runtime itself is leaked so it lives for the lifetime
    /// of the process.
    pub fn start(db_path: PathBuf) -> anyhow::Result<Self> {
        let rt = Runtime::new()?;
        let rt_handle = rt.handle().clone();

        let (pool, sync) = rt.block_on(async {
            let pool = db::initialize(&db_path).await?;
            let sync = SyncEngine::start_background(
                pool.clone(),
                SyncConfig::default(),
                Arc::new(NoopEmitter),
            );
            Ok::<_, anyhow::Error>((pool, sync))
        })?;

        // Leak the runtime so background tasks keep running for the lifetime
        // of the process. Without this the runtime drops at end-of-scope and
        // cancels every spawned task, which would tear the sync engine down.
        Box::leak(Box::new(rt));

        Ok(Self {
            pool,
            rt: rt_handle,
            sync,
        })
    }

    /// Fetch all GitLab instances. Returns a oneshot that the UI awaits.
    pub fn list_instances(&self) -> oneshot::Receiver<Vec<InstanceRow>> {
        let pool = self.pool.clone();
        let (tx, rx) = oneshot::channel();
        self.rt.spawn(async move {
            let rows: Vec<(i64, String, String, bool)> = sqlx::query_as(
                r#"SELECT id, name, url, is_default
                   FROM gitlab_instances
                   ORDER BY is_default DESC, name ASC"#,
            )
            .fetch_all(&pool)
            .await
            .unwrap_or_default();

            let instances = rows
                .into_iter()
                .map(|(id, name, url, is_default)| InstanceRow {
                    id,
                    name,
                    url,
                    is_default,
                })
                .collect();
            let _ = tx.send(instances);
        });
        rx
    }

    /// Fetch the open MR list for an instance. Returns a oneshot the UI awaits.
    ///
    /// Mirrors the SQL used by `commands::mr::get_merge_requests` but reads
    /// only the columns the table cares about, so we can keep `MrRow` simple.
    pub fn list_mrs(&self, instance_id: i64) -> oneshot::Receiver<Vec<MrRow>> {
        let pool = self.pool.clone();
        let (tx, rx) = oneshot::channel();
        self.rt.spawn(async move {
            let rows: Vec<(
                i64,
                i64,
                Option<String>,
                String,
                String,
                String,
                String,
                String,
                String,
                i64,
            )> = sqlx::query_as(
                r#"
                SELECT
                    mr.id,
                    mr.iid,
                    COALESCE(p.name_with_namespace, mr.project_name) AS project_name,
                    mr.title,
                    mr.author_username,
                    mr.source_branch,
                    mr.target_branch,
                    mr.state,
                    mr.web_url,
                    mr.updated_at
                FROM merge_requests mr
                LEFT JOIN projects p
                    ON p.id = mr.project_id AND p.instance_id = mr.instance_id
                WHERE mr.instance_id = ?1
                  AND mr.state = 'opened'
                ORDER BY mr.updated_at DESC
                "#,
            )
            .bind(instance_id)
            .fetch_all(&pool)
            .await
            .unwrap_or_default();

            let mrs = rows
                .into_iter()
                .map(
                    |(
                        id,
                        iid,
                        project_name,
                        title,
                        author_username,
                        source_branch,
                        target_branch,
                        state,
                        web_url,
                        updated_at,
                    )| MrRow {
                        id,
                        iid,
                        project_name: project_name.unwrap_or_else(|| "<unknown>".into()),
                        title,
                        author_username,
                        source_branch,
                        target_branch,
                        state,
                        web_url,
                        updated_at,
                    },
                )
                .collect();
            let _ = tx.send(mrs);
        });
        rx
    }

    /// Ask the sync engine to run a sync cycle immediately. Returns a
    /// oneshot that resolves once the request has been queued (not when
    /// the sync finishes — the engine reports completion via events).
    pub fn trigger_sync(&self) -> oneshot::Receiver<()> {
        let sync = self.sync.clone();
        let (tx, rx) = oneshot::channel();
        self.rt.spawn(async move {
            if let Err(e) = sync.trigger_sync().await {
                log::warn!("trigger_sync failed: {e}");
            }
            let _ = tx.send(());
        });
        rx
    }
}

/// Resolve the SQLite database path. Defaults to
/// `$HOME/.local/share/ultra-gitlab/ultra-gitlab.db`. Override with
/// `ULTRA_GITLAB_DB`. Honors the macOS Tauri location too so that
/// running the GPUI experiment against an existing Tauri install
/// "just works" for testing.
pub fn resolve_db_path() -> PathBuf {
    if let Ok(p) = std::env::var("ULTRA_GITLAB_DB") {
        return PathBuf::from(p);
    }

    if let Ok(home) = std::env::var("HOME") {
        let mac = PathBuf::from(&home)
            .join("Library/Application Support/com.jens.ultra-gitlab/ultra-gitlab.db");
        if mac.exists() {
            return mac;
        }

        let linux = PathBuf::from(&home)
            .join(".local/share/com.jens.ultra-gitlab/ultra-gitlab.db");
        if linux.exists() {
            return linux;
        }

        return PathBuf::from(home).join(".local/share/ultra-gitlab/ultra-gitlab.db");
    }

    PathBuf::from("./ultra-gitlab.db")
}
