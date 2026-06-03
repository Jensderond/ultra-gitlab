//! Pipelines tab: state and pure view transitions.
//!
//! State lives on `App` (`app.pipelines` / `app.detail_pipes`); rendering lives
//! in `ui/pipelines.rs`. Async spawns and key handling are added in a later
//! task and operate on `&App`/`&mut App`.

use crate::app::App;
use crate::data;
use crate::event::AppEvent;
use crossterm::event::KeyCode;
use ratatui::widgets::ListState;
use std::sync::Arc;
use ultra_gitlab_lib::db::pool::DbPool;

/// Which level of the Pipelines tab drill is showing.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PipeView {
    Projects,
    Pipelines,
    Jobs,
}

/// The add-project search overlay.
#[derive(Debug, Default)]
pub struct SearchState {
    pub query: String,
    pub results: Vec<data::ProjectHit>,
    pub state: ListState,
    pub searching: bool,
}

/// A pending y/N confirmation for a pipeline/job cancel.
#[derive(Debug, Clone)]
pub struct PipeConfirm {
    pub action: PipeAction,
    pub prompt: String,
}

#[derive(Debug, Clone, Copy)]
pub enum PipeAction {
    CancelPipeline { project_id: i64, pipeline_id: i64 },
    CancelJob { project_id: i64, job_id: i64 },
}

/// All Pipelines-tab state, held on `App`.
pub struct PipelinesState {
    pub view: PipeView,
    pub projects: Vec<data::PipeProjectRow>,
    pub proj_state: ListState,
    pub selected_project: Option<i64>,
    pub pipelines: Vec<data::PipeRow>,
    pub pipe_state: ListState,
    pub selected_pipeline: Option<i64>,
    pub jobs: Vec<data::JobRow>,
    pub job_state: ListState,
    pub search: Option<SearchState>,
    pub confirm: Option<PipeConfirm>,
    pub loaded: bool,
}

impl Default for PipelinesState {
    fn default() -> Self {
        PipelinesState {
            view: PipeView::Projects,
            projects: Vec::new(),
            proj_state: ListState::default(),
            selected_project: None,
            pipelines: Vec::new(),
            pipe_state: ListState::default(),
            selected_pipeline: None,
            jobs: Vec::new(),
            job_state: ListState::default(),
            search: None,
            confirm: None,
            loaded: false,
        }
    }
}

impl PipelinesState {
    /// Currently selected project id, if any.
    pub fn selected_project_id(&self) -> Option<i64> {
        self.proj_state
            .selected()
            .and_then(|i| self.projects.get(i))
            .map(|p| p.project_id)
    }

    /// Currently selected pipeline row, if any.
    pub fn selected_pipe(&self) -> Option<&data::PipeRow> {
        self.pipe_state.selected().and_then(|i| self.pipelines.get(i))
    }

    /// Currently selected job row, if any.
    pub fn selected_job(&self) -> Option<&data::JobRow> {
        self.job_state.selected().and_then(|i| self.jobs.get(i))
    }

    /// True if any visible pipeline/job is in flight (drives auto-refresh).
    pub fn has_inflight(&self) -> bool {
        let p = self
            .pipelines
            .iter()
            .any(|r| r.status == "running" || r.status == "pending");
        let j = self
            .jobs
            .iter()
            .any(|r| r.status == "running" || r.status == "pending");
        let proj = self.projects.iter().any(|r| {
            matches!(
                r.status.as_ref().map(|s| s.status.as_str()),
                Some("running") | Some("pending")
            )
        });
        match self.view {
            PipeView::Projects => proj,
            PipeView::Pipelines => p,
            PipeView::Jobs => j,
        }
    }
}

/// Pipelines panel state on the MR detail screen, reset per MR.
#[derive(Default)]
pub struct DetailPipelines {
    pub pipelines: Vec<data::PipeRow>,
    pub pipe_state: ListState,
    /// `Some` => the panel is showing the selected pipeline's jobs inline.
    pub jobs: Option<Vec<data::JobRow>>,
    pub job_state: ListState,
}

impl DetailPipelines {
    pub fn reset(&mut self) {
        self.pipelines.clear();
        self.pipe_state = ListState::default();
        self.jobs = None;
        self.job_state = ListState::default();
    }

    pub fn selected_pipe(&self) -> Option<&data::PipeRow> {
        self.pipe_state.selected().and_then(|i| self.pipelines.get(i))
    }

    pub fn selected_job(&self) -> Option<&data::JobRow> {
        self.jobs
            .as_ref()
            .and_then(|jobs| self.job_state.selected().and_then(|i| jobs.get(i)))
    }
}

/// Clamp a ListState selection within `len` after a list changes.
pub fn clamp_selection(state: &mut ListState, len: usize) {
    if len == 0 {
        state.select(None);
    } else {
        let cur = state.selected().unwrap_or(0).min(len - 1);
        state.select(Some(cur));
    }
}

/// Move a ListState selection by `delta`, clamped to `[0, len)`.
pub fn move_in_list(state: &mut ListState, len: usize, delta: i32) {
    if len == 0 {
        return;
    }
    let cur = state.selected().unwrap_or(0) as i32;
    let next = (cur + delta).clamp(0, len as i32 - 1) as usize;
    state.select(Some(next));
}

/// Entering the Pipelines tab: load projects if not yet loaded.
pub fn enter_tab(app: &mut App) {
    app.busy = true;
    app.status = "Loading pipelines…".into();
    spawn_load_projects(app);
}

pub fn spawn_load_projects(app: &App) {
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_pipeline_projects(&pool, inst)
            .await
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::PipeProjects(r));
    });
}

/// Refresh live statuses for all currently-listed projects.
pub fn spawn_refresh_statuses(app: &App) {
    let ids: Vec<i64> = app.pipelines.projects.iter().map(|p| p.project_id).collect();
    if ids.is_empty() {
        return;
    }
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_project_statuses(&pool, inst, ids)
            .await
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::PipeStatuses(r));
    });
}

pub fn spawn_load_pipelines(app: &App, project_id: i64) {
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_project_pipelines(&pool, inst, project_id)
            .await
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::PipeList(r));
    });
}

pub fn spawn_load_jobs(app: &App, project_id: i64, pipeline_id: i64) {
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_pipeline_jobs(&pool, inst, project_id, pipeline_id)
            .await
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::PipeJobs(r));
    });
}

pub fn spawn_search(app: &App, query: String) {
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::search_pipeline_projects(&pool, inst, query)
            .await
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::PipeSearch(r));
    });
}

/// Spawn a fire-and-reload action (pin/remove/add/play/retry/cancel).
fn spawn_action<F, Fut>(app: &mut App, label: &str, f: F)
where
    F: FnOnce(Arc<DbPool>, i64) -> Fut + Send + 'static,
    Fut: std::future::Future<Output = Result<String, String>> + Send + 'static,
{
    app.busy = true;
    app.status = format!("{label}…");
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = f(pool, inst).await;
        let _ = tx.send(AppEvent::PipeActionDone(r));
    });
}

/// After a successful action, reload whichever view is active.
pub fn reload_active_view(app: &mut App) {
    match app.pipelines.view {
        PipeView::Projects => spawn_load_projects(app),
        PipeView::Pipelines => {
            if let Some(pid) = app.pipelines.selected_project {
                spawn_load_pipelines(app, pid);
            }
        }
        PipeView::Jobs => {
            if let (Some(pid), Some(plid)) =
                (app.pipelines.selected_project, app.pipelines.selected_pipeline)
            {
                spawn_load_jobs(app, pid, plid);
            }
        }
    }
}

/// Run a confirmed cancel.
pub fn run_confirmed(app: &mut App, action: PipeAction) {
    match action {
        PipeAction::CancelPipeline { project_id, pipeline_id } => {
            spawn_action(app, "cancel pipeline", move |pool, inst| async move {
                ultra_gitlab_lib::core::pipelines::cancel_pipeline(&pool, inst, project_id, pipeline_id)
                    .await
                    .map(|_| "pipeline canceled".to_string())
                    .map_err(|e| e.to_string())
            });
        }
        PipeAction::CancelJob { project_id, job_id } => {
            spawn_action(app, "cancel job", move |pool, inst| async move {
                ultra_gitlab_lib::core::pipelines::cancel_job(&pool, inst, project_id, job_id)
                    .await
                    .map(|_| "job canceled".to_string())
                    .map_err(|e| e.to_string())
            });
        }
    }
}

/// Load jobs for a pipeline shown in the MR-detail panel.
pub fn spawn_detail_jobs(app: &App, project_id: i64, pipeline_id: i64) {
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_pipeline_jobs(&pool, inst, project_id, pipeline_id)
            .await
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::MrPipeJobs(r));
    });
}

/// Re-fetch the MR-detail panel's current view (pipeline list or inline jobs).
pub fn refresh_detail(app: &mut App) {
    let Some(mr_id) = app.detail.as_ref().map(|d| d.row.id) else { return };
    if app.detail_pipes.jobs.is_some() {
        if let Some(pipe) = app.detail_pipes.selected_pipe() {
            let (pid, plid) = (pipe.project_id, pipe.id);
            spawn_detail_jobs(app, pid, plid);
            return;
        }
    }
    let pool = app.pool.clone();
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_mr_pipelines(&pool, mr_id)
            .await
            .map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::MrPipes(r));
    });
}

/// Keys while the MR-detail pipelines panel is focused. Esc is handled by the
/// detail-screen key dispatcher (app.rs), not here.
pub fn handle_detail_key(app: &mut App, code: KeyCode) {
    // Inline jobs mode.
    if app.detail_pipes.jobs.is_some() {
        let job_len = app.detail_pipes.jobs.as_ref().map(|j| j.len()).unwrap_or(0);
        let project_id = app
            .detail_pipes
            .selected_pipe()
            .map(|p| p.project_id)
            .unwrap_or(0);
        match code {
            KeyCode::Char('j') | KeyCode::Down => {
                move_in_list(&mut app.detail_pipes.job_state, job_len, 1)
            }
            KeyCode::Char('k') | KeyCode::Up => {
                move_in_list(&mut app.detail_pipes.job_state, job_len, -1)
            }
            KeyCode::Char('o') => {
                if let Some(j) = app.detail_pipes.selected_job() {
                    let _ = crate::util::open_url(&j.web_url);
                }
            }
            KeyCode::Char('p') => {
                if let Some(j) = app.detail_pipes.selected_job() {
                    let job_id = j.id;
                    spawn_action(app, "play", move |pool, inst| async move {
                        ultra_gitlab_lib::core::pipelines::play_job(&pool, inst, project_id, job_id)
                            .await
                            .map(|_| "job started".to_string())
                            .map_err(|e| e.to_string())
                    });
                }
            }
            KeyCode::Char('R') => {
                if let Some(j) = app.detail_pipes.selected_job() {
                    let job_id = j.id;
                    spawn_action(app, "retry", move |pool, inst| async move {
                        ultra_gitlab_lib::core::pipelines::retry_job(&pool, inst, project_id, job_id)
                            .await
                            .map(|_| "job retried".to_string())
                            .map_err(|e| e.to_string())
                    });
                }
            }
            KeyCode::Char('c') => {
                if let Some(j) = app.detail_pipes.selected_job() {
                    app.pipelines.confirm = Some(PipeConfirm {
                        action: PipeAction::CancelJob {
                            project_id,
                            job_id: j.id,
                        },
                        prompt: format!("Cancel job {}? (y/N)", j.name),
                    });
                    app.status = "Cancel job? Press y to confirm.".into();
                }
            }
            _ => {}
        }
        return;
    }

    // Pipeline list mode.
    let len = app.detail_pipes.pipelines.len();
    match code {
        KeyCode::Char('j') | KeyCode::Down => move_in_list(&mut app.detail_pipes.pipe_state, len, 1),
        KeyCode::Char('k') | KeyCode::Up => move_in_list(&mut app.detail_pipes.pipe_state, len, -1),
        KeyCode::Char('o') => {
            if let Some(p) = app.detail_pipes.selected_pipe() {
                let _ = crate::util::open_url(&p.web_url);
            }
        }
        KeyCode::Enter => {
            if let Some(p) = app.detail_pipes.selected_pipe() {
                let (pid, plid) = (p.project_id, p.id);
                app.detail_pipes.jobs = Some(Vec::new());
                app.detail_pipes.job_state = ListState::default();
                app.status = "Loading jobs…".into();
                spawn_detail_jobs(app, pid, plid);
            }
        }
        _ => {}
    }
}

/// Handle a key while the Pipelines tab is active (and no global key matched).
pub fn handle_key(app: &mut App, code: KeyCode) {
    if app.pipelines.search.is_some() {
        handle_search_key(app, code);
        return;
    }
    match app.pipelines.view {
        PipeView::Projects => handle_projects_key(app, code),
        PipeView::Pipelines => handle_pipelines_key(app, code),
        PipeView::Jobs => handle_jobs_key(app, code),
    }
}

fn handle_projects_key(app: &mut App, code: KeyCode) {
    let len = app.pipelines.projects.len();
    match code {
        KeyCode::Char('j') | KeyCode::Down => move_in_list(&mut app.pipelines.proj_state, len, 1),
        KeyCode::Char('k') | KeyCode::Up => move_in_list(&mut app.pipelines.proj_state, len, -1),
        KeyCode::Char('r') => {
            spawn_load_projects(app);
            app.status = "Refreshing…".into();
        }
        KeyCode::Char('n') => {
            app.pipelines.search = Some(SearchState::default());
            app.status = "Search projects to add (esc to cancel)".into();
        }
        KeyCode::Char('p') => {
            if let Some(pid) = app.pipelines.selected_project_id() {
                spawn_action(app, "toggle pin", move |pool, inst| async move {
                    ultra_gitlab_lib::core::pipelines::toggle_pin(&pool, inst, pid)
                        .await
                        .map(|_| "pin toggled".to_string())
                        .map_err(|e| e.to_string())
                });
            }
        }
        KeyCode::Char('x') => {
            if let Some(pid) = app.pipelines.selected_project_id() {
                spawn_action(app, "remove", move |pool, inst| async move {
                    ultra_gitlab_lib::core::pipelines::remove_project(&pool, inst, pid)
                        .await
                        .map(|_| "project removed".to_string())
                        .map_err(|e| e.to_string())
                });
            }
        }
        KeyCode::Char('o') => {
            if let Some(p) = app
                .pipelines
                .proj_state
                .selected()
                .and_then(|i| app.pipelines.projects.get(i))
            {
                let _ = crate::util::open_url(&p.web_url);
            }
        }
        KeyCode::Enter => {
            if let Some(pid) = app.pipelines.selected_project_id() {
                app.pipelines.selected_project = Some(pid);
                app.pipelines.view = PipeView::Pipelines;
                app.pipelines.pipelines.clear();
                app.pipelines.pipe_state.select(None);
                app.busy = true;
                app.status = "Loading pipelines…".into();
                spawn_load_pipelines(app, pid);
            }
        }
        _ => {}
    }
}

fn handle_pipelines_key(app: &mut App, code: KeyCode) {
    let len = app.pipelines.pipelines.len();
    match code {
        KeyCode::Char('j') | KeyCode::Down => move_in_list(&mut app.pipelines.pipe_state, len, 1),
        KeyCode::Char('k') | KeyCode::Up => move_in_list(&mut app.pipelines.pipe_state, len, -1),
        KeyCode::Esc => {
            app.pipelines.view = PipeView::Projects;
        }
        KeyCode::Char('o') => {
            if let Some(p) = app.pipelines.selected_pipe() {
                let _ = crate::util::open_url(&p.web_url);
            }
        }
        KeyCode::Char('c') => {
            if let Some(p) = app.pipelines.selected_pipe() {
                app.pipelines.confirm = Some(PipeConfirm {
                    action: PipeAction::CancelPipeline {
                        project_id: p.project_id,
                        pipeline_id: p.id,
                    },
                    prompt: format!("Cancel pipeline #{}? (y/N)", p.id),
                });
                app.status = "Cancel pipeline? Press y to confirm.".into();
            }
        }
        KeyCode::Enter => {
            if let Some(p) = app.pipelines.selected_pipe() {
                let (pid, plid) = (p.project_id, p.id);
                app.pipelines.selected_pipeline = Some(plid);
                app.pipelines.view = PipeView::Jobs;
                app.pipelines.jobs.clear();
                app.pipelines.job_state.select(None);
                app.busy = true;
                app.status = "Loading jobs…".into();
                spawn_load_jobs(app, pid, plid);
            }
        }
        _ => {}
    }
}

fn handle_jobs_key(app: &mut App, code: KeyCode) {
    let len = app.pipelines.jobs.len();
    let project_id = app.pipelines.selected_project.unwrap_or(0);
    match code {
        KeyCode::Char('j') | KeyCode::Down => move_in_list(&mut app.pipelines.job_state, len, 1),
        KeyCode::Char('k') | KeyCode::Up => move_in_list(&mut app.pipelines.job_state, len, -1),
        KeyCode::Esc => {
            app.pipelines.view = PipeView::Pipelines;
        }
        KeyCode::Char('o') => {
            if let Some(j) = app.pipelines.selected_job() {
                let _ = crate::util::open_url(&j.web_url);
            }
        }
        KeyCode::Char('p') => {
            if let Some(j) = app.pipelines.selected_job() {
                let job_id = j.id;
                spawn_action(app, "play", move |pool, inst| async move {
                    ultra_gitlab_lib::core::pipelines::play_job(&pool, inst, project_id, job_id)
                        .await
                        .map(|_| "job started".to_string())
                        .map_err(|e| e.to_string())
                });
            }
        }
        KeyCode::Char('R') => {
            if let Some(j) = app.pipelines.selected_job() {
                let job_id = j.id;
                spawn_action(app, "retry", move |pool, inst| async move {
                    ultra_gitlab_lib::core::pipelines::retry_job(&pool, inst, project_id, job_id)
                        .await
                        .map(|_| "job retried".to_string())
                        .map_err(|e| e.to_string())
                });
            }
        }
        KeyCode::Char('c') => {
            if let Some(j) = app.pipelines.selected_job() {
                app.pipelines.confirm = Some(PipeConfirm {
                    action: PipeAction::CancelJob {
                        project_id,
                        job_id: j.id,
                    },
                    prompt: format!("Cancel job {}? (y/N)", j.name),
                });
                app.status = "Cancel job? Press y to confirm.".into();
            }
        }
        _ => {}
    }
}

fn handle_search_key(app: &mut App, code: KeyCode) {
    let Some(search) = app.pipelines.search.as_mut() else { return };
    match code {
        KeyCode::Esc => {
            app.pipelines.search = None;
            app.status = "Ready".into();
        }
        KeyCode::Backspace => {
            search.query.pop();
        }
        KeyCode::Char(c) => {
            search.query.push(c);
        }
        KeyCode::Down => move_in_list(&mut search.state, search.results.len(), 1),
        KeyCode::Up => move_in_list(&mut search.state, search.results.len(), -1),
        KeyCode::Enter => {
            if !search.results.is_empty() {
                if let Some(hit) = search.state.selected().and_then(|i| search.results.get(i)) {
                    let pid = hit.id;
                    app.pipelines.search = None;
                    spawn_action(app, "add project", move |pool, inst| async move {
                        ultra_gitlab_lib::core::pipelines::add_project(&pool, inst, pid)
                            .await
                            .map(|_| "project added".to_string())
                            .map_err(|e| e.to_string())
                    });
                    return;
                }
            }
            let q = search.query.clone();
            if !q.is_empty() {
                search.searching = true;
                spawn_search(app, q);
            }
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proj(id: i64, status: Option<&str>) -> data::PipeProjectRow {
        data::PipeProjectRow {
            project_id: id,
            name: format!("group/p{id}"),
            web_url: "http://x".into(),
            pinned: false,
            status: status.map(|s| data::PipeStatus {
                status: s.into(),
                ref_name: "main".into(),
                sha: "abc".into(),
                web_url: "http://x".into(),
                duration: None,
            }),
        }
    }

    #[test]
    fn move_in_list_clamps() {
        let mut s = ListState::default();
        s.select(Some(0));
        move_in_list(&mut s, 3, -1);
        assert_eq!(s.selected(), Some(0));
        move_in_list(&mut s, 3, 1);
        assert_eq!(s.selected(), Some(1));
        move_in_list(&mut s, 3, 10);
        assert_eq!(s.selected(), Some(2));
    }

    #[test]
    fn has_inflight_checks_active_view() {
        let mut st = PipelinesState::default();
        st.projects = vec![proj(1, Some("running")), proj(2, Some("success"))];
        st.view = PipeView::Projects;
        assert!(st.has_inflight());
        st.projects = vec![proj(1, Some("success"))];
        assert!(!st.has_inflight());
    }

    #[test]
    fn clamp_selection_handles_empty() {
        let mut s = ListState::default();
        s.select(Some(5));
        clamp_selection(&mut s, 0);
        assert_eq!(s.selected(), None);
        s.select(Some(5));
        clamp_selection(&mut s, 3);
        assert_eq!(s.selected(), Some(2));
    }
}
