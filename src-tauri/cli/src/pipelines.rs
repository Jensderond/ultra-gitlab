//! Pipelines tab: state and pure view transitions.
//!
//! State lives on `App` (`app.pipelines` / `app.detail_pipes`); rendering lives
//! in `ui/pipelines.rs`. Async spawns and key handling are added in a later
//! task and operate on `&App`/`&mut App`.

use crate::data;
use ratatui::widgets::ListState;

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
