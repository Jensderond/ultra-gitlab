//! Application state and the main event loop.

use crate::data;
use crate::event::AppEvent;
use crate::syntax::Highlighter;
use crate::ui;
use crossterm::event::{Event, EventStream, KeyCode, KeyEventKind};
use futures::StreamExt;
use ratatui::widgets::ListState;
use ratatui::DefaultTerminal;
use std::collections::HashSet;
use std::sync::Arc;
use tokio::sync::mpsc;
use ultra_gitlab_lib::db::pool::DbPool;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Tab {
    Review,
    Mine,
    Pipelines,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Screen {
    List,
    Detail,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Focus {
    Tree,
    Diff,
    Pipeline,
}

pub struct App {
    pub pool: Arc<DbPool>,
    pub instance_id: i64,
    pub username: Option<String>,

    pub tab: Tab,
    pub screen: Screen,
    pub focus: Focus,

    pub review: Vec<data::MrRow>,
    pub mine: Vec<data::MrRow>,
    pub list_state: ListState,

    pub detail: Option<data::DetailData>,
    pub file_state: ListState,
    pub diff_scroll: u16,
    /// Horizontal scroll offset (columns) for the diff. Lets the user pan to see
    /// content cut off past the right border, since diff lines are not wrapped.
    pub diff_hscroll: u16,
    /// Visible height of the diff pane (inside borders), updated each render.
    /// Used to page the diff by PgUp/PgDn in viewport-sized steps.
    pub diff_viewport: u16,
    /// Furthest the diff can pan right (widest line minus pane width), updated
    /// each render so left/right panning can be clamped to actual content.
    pub diff_hscroll_max: u16,
    /// Per-row metadata for the current file's diff, refreshed each render.
    pub diff_rows: Vec<crate::ui::diff::RowMeta>,
    /// Cursor row index into `diff_rows` (the line a comment would target).
    pub diff_cursor: usize,
    /// Visual-range anchor row; `Some` while a range selection is active.
    pub diff_select_anchor: Option<usize>,
    /// A compose request to run after the current key handler returns.
    pub pending: Option<crate::comments::PendingCompose>,
    /// State for the suggestion preview overlay (after editing, before posting).
    pub suggestion: Option<SuggestionPreview>,
    /// Set when the user pressed `m` in the preview to attach a message; the run
    /// loop opens the editor for the message and clears this.
    pub suggestion_message_pending: bool,
    /// new_path of files marked viewed in the current detail (reset per MR).
    pub viewed: HashSet<String>,
    pub pipelines: crate::pipelines::PipelinesState,
    pub detail_pipes: crate::pipelines::DetailPipelines,

    pub status: String,
    pub busy: bool,
    pub should_quit: bool,
    pub confirm: Option<Confirm>,
    /// Request a full terminal clear before the next draw. Set on transitions
    /// (file switch, leaving the detail view) where the frame-diff can leave
    /// stale diff cells behind — clearing forces a complete repaint.
    pub force_clear: bool,

    pub tx: mpsc::UnboundedSender<AppEvent>,
    pub highlighter: Highlighter,
}

/// State for the suggestion preview overlay (after editing, before posting).
#[derive(Debug, Clone)]
pub struct SuggestionPreview {
    pub mr_id: i64,
    pub file_path: String,
    pub original: String,
    pub edited: String,
    pub above: i64,
    pub below: i64,
    pub anchor_old: Option<i64>,
    pub anchor_new: Option<i64>,
    pub refs: ultra_gitlab_lib::core::comments::DiffRefs,
    /// Optional accompanying message note typed via `m`.
    pub message: Option<String>,
}

/// A pending y/n confirmation for a destructive action.
#[derive(Debug, Clone)]
pub struct Confirm {
    pub verb: String,
    pub mr_id: i64,
    pub prompt: String,
}

impl App {
    pub fn new(
        pool: Arc<DbPool>,
        instance_id: i64,
        username: Option<String>,
        tx: mpsc::UnboundedSender<AppEvent>,
    ) -> Self {
        let mut list_state = ListState::default();
        list_state.select(Some(0));
        App {
            pool,
            instance_id,
            username,
            tab: Tab::Review,
            screen: Screen::List,
            focus: Focus::Tree,
            review: Vec::new(),
            mine: Vec::new(),
            list_state,
            detail: None,
            file_state: ListState::default(),
            diff_scroll: 0,
            diff_hscroll: 0,
            diff_viewport: 0,
            diff_hscroll_max: 0,
            diff_rows: Vec::new(),
            diff_cursor: 0,
            diff_select_anchor: None,
            pending: None,
            suggestion: None,
            suggestion_message_pending: false,
            viewed: HashSet::new(),
            pipelines: crate::pipelines::PipelinesState::default(),
            detail_pipes: crate::pipelines::DetailPipelines::default(),
            status: "Loading…".into(),
            busy: true,
            should_quit: false,
            confirm: None,
            force_clear: false,
            tx,
            highlighter: Highlighter::new(),
        }
    }

    /// Rows for the active tab.
    pub fn rows(&self) -> &[data::MrRow] {
        match self.tab {
            Tab::Review => &self.review,
            Tab::Mine => &self.mine,
            Tab::Pipelines => &[],
        }
    }

    /// Spawn the initial list loads for both tabs.
    pub fn load_lists(&mut self) {
        self.busy = true;
        self.status = "Loading…".into();
        spawn_review(self);
        spawn_mine(self);
    }
}

fn spawn_review(app: &App) {
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_review(&pool, inst).await.map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::Review(r));
    });
}

fn spawn_mine(app: &App) {
    let pool = app.pool.clone();
    let inst = app.instance_id;
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_mine(&pool, inst).await.map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::Mine(r));
    });
}

/// Run the event loop until the user quits.
pub async fn run(
    mut terminal: DefaultTerminal,
    mut app: App,
    mut rx: mpsc::UnboundedReceiver<AppEvent>,
) -> anyhow::Result<()> {
    let mut keys = EventStream::new();
    app.load_lists();
    terminal.draw(|f| ui::draw(f, &mut app))?;

    let mut ticker = tokio::time::interval(std::time::Duration::from_secs(10));
    // The first tick fires immediately; skip it so we don't double-load on start.
    ticker.tick().await;

    loop {
        tokio::select! {
            maybe_key = keys.next() => {
                if let Some(Ok(Event::Key(key))) = maybe_key {
                    if key.kind == KeyEventKind::Press {
                        handle_key(&mut app, key.code);
                        if app.suggestion_message_pending {
                            app.suggestion_message_pending = false;
                            if let Some(mut p) = app.suggestion.take() {
                                if let Some(m) = crate::editor::compose(
                                    "# Message to accompany the suggestion\n\n", "md", true,
                                )? {
                                    p.message = Some(m);
                                }
                                app.suggestion = Some(p);
                                app.force_clear = true;
                                terminal.clear()?;
                            }
                        }
                        if let Some(p) = app.pending.take() {
                            run_compose(&mut terminal, &mut app, p)?;
                        }
                    }
                }
            }
            Some(ev) = rx.recv() => {
                handle_event(&mut app, ev);
            }
            _ = ticker.tick() => {
                on_tick(&mut app);
            }
        }
        if app.should_quit {
            break;
        }
        if app.force_clear {
            terminal.clear()?;
            app.force_clear = false;
        }
        terminal.draw(|f| ui::draw(f, &mut app))?;
    }
    Ok(())
}

/// Periodic refresh: while the active pipelines view has an in-flight
/// pipeline/job, re-fetch it so status changes appear without input.
fn on_tick(app: &mut App) {
    if app.busy {
        return;
    }
    if app.tab == Tab::Pipelines && app.screen == Screen::List && app.pipelines.search.is_none() {
        if app.pipelines.has_inflight() {
            crate::pipelines::reload_active_view(app);
        }
        return;
    }
    if app.screen == Screen::Detail {
        let inflight = app
            .detail_pipes
            .jobs
            .as_ref()
            .map(|jobs| jobs.iter().any(|j| j.status == "running" || j.status == "pending"))
            .unwrap_or_else(|| {
                app.detail_pipes
                    .pipelines
                    .iter()
                    .any(|p| p.status == "running" || p.status == "pending")
            });
        if inflight {
            crate::pipelines::refresh_detail(app);
        }
    }
}

/// Suspend the TUI, run the editor for a pending compose, and dispatch the post.
fn run_compose(
    terminal: &mut DefaultTerminal,
    app: &mut App,
    p: crate::comments::PendingCompose,
) -> anyhow::Result<()> {
    let iid = app.detail.as_ref().map(|d| d.row.iid).unwrap_or(0);
    let (seed, ext, strip) = crate::comments::seed_for(&p, iid);
    let edited = crate::editor::compose(&seed, ext, strip)?;
    app.force_clear = true;
    terminal.clear()?;
    match (p, edited) {
        (_, None) => app.status = "Cancelled".into(),
        (crate::comments::PendingCompose::Suggestion {
            mr_id, file_path, original, above, below, anchor_old, anchor_new, refs,
        }, Some(edited)) => {
            app.suggestion = Some(crate::app::SuggestionPreview {
                mr_id, file_path, original, edited, above, below, anchor_old, anchor_new, refs, message: None,
            });
        }
        (p, Some(body)) => {
            crate::comments::post(app, p, body);
            app.busy = true;
            app.status = "Posting comment…".into();
        }
    }
    Ok(())
}

fn handle_event(app: &mut App, ev: AppEvent) {
    match ev {
        AppEvent::Review(Ok(rows)) => {
            app.review = rows;
            app.busy = false;
            app.status = "Ready".into();
        }
        AppEvent::Mine(Ok(rows)) => {
            app.mine = rows;
            app.busy = false;
            app.status = "Ready".into();
        }
        AppEvent::Detail(Ok(d)) => {
            app.busy = false;
            app.status = if d.live { "Loaded diff (live)".into() } else { "Ready".into() };
            app.file_state.select(Some(0));
            app.diff_scroll = 0;
            app.diff_hscroll = 0;
            app.diff_cursor = 0;
            app.diff_select_anchor = None;
            app.viewed.clear();
            app.detail = Some(d);
        }
        AppEvent::ActionDone(verb, Ok(msg)) => {
            app.busy = false;
            app.status = format!("{verb}: {msg}");
            // For approve the UI already updated optimistically (see
            // actions::approve_optimistic); the reload just reconciles with the
            // server. Other actions rely on the reload to reflect their result.
            app.load_lists();
        }
        AppEvent::PipeProjects(Ok(rows)) => {
            app.busy = false;
            app.status = "Ready".into();
            if app.pipelines.proj_state.selected().is_none() && !rows.is_empty() {
                app.pipelines.proj_state.select(Some(0));
            }
            app.pipelines.projects = rows;
            app.pipelines.loaded = true;
            crate::pipelines::clamp_selection(
                &mut app.pipelines.proj_state,
                app.pipelines.projects.len(),
            );
            crate::pipelines::spawn_refresh_statuses(app);
        }
        AppEvent::PipeStatuses(Ok(pairs)) => {
            for (pid, st) in pairs {
                if let Some(row) = app
                    .pipelines
                    .projects
                    .iter_mut()
                    .find(|p| p.project_id == pid)
                {
                    row.status = Some(st);
                }
            }
        }
        AppEvent::PipeList(Ok(rows)) => {
            app.busy = false;
            app.status = "Ready".into();
            app.pipelines.pipelines = rows;
            if app.pipelines.pipe_state.selected().is_none()
                && !app.pipelines.pipelines.is_empty()
            {
                app.pipelines.pipe_state.select(Some(0));
            }
            crate::pipelines::clamp_selection(
                &mut app.pipelines.pipe_state,
                app.pipelines.pipelines.len(),
            );
        }
        AppEvent::PipeJobs(Ok(rows)) => {
            app.busy = false;
            app.status = "Ready".into();
            app.pipelines.jobs = rows;
            if app.pipelines.job_state.selected().is_none() && !app.pipelines.jobs.is_empty() {
                app.pipelines.job_state.select(Some(0));
            }
            crate::pipelines::clamp_selection(
                &mut app.pipelines.job_state,
                app.pipelines.jobs.len(),
            );
        }
        AppEvent::PipeSearch(Ok(rows)) => {
            if let Some(s) = app.pipelines.search.as_mut() {
                s.results = rows;
                s.searching = false;
                if s.state.selected().is_none() && !s.results.is_empty() {
                    s.state.select(Some(0));
                }
            }
        }
        AppEvent::PipeActionDone(Ok(msg)) => {
            app.busy = false;
            app.status = msg;
            crate::pipelines::reload_active_view(app);
        }
        AppEvent::MrPipes(Ok(rows)) => {
            app.detail_pipes.pipelines = rows;
            if app.detail_pipes.pipe_state.selected().is_none()
                && !app.detail_pipes.pipelines.is_empty()
            {
                app.detail_pipes.pipe_state.select(Some(0));
            }
        }
        AppEvent::MrPipeJobs(Ok(rows)) => {
            app.detail_pipes.jobs = Some(rows);
            app.detail_pipes.job_state.select(Some(0));
        }
        AppEvent::CommentPosted(Ok(_mr_id)) => {
            app.busy = false;
            app.status = "Comment posted".into();
        }
        AppEvent::CommentPosted(Err(e)) => {
            app.busy = false;
            app.status = format!("Comment failed: {e}");
        }
        AppEvent::PipeProjects(Err(e))
        | AppEvent::PipeStatuses(Err(e))
        | AppEvent::PipeList(Err(e))
        | AppEvent::PipeJobs(Err(e))
        | AppEvent::PipeSearch(Err(e))
        | AppEvent::PipeActionDone(Err(e))
        | AppEvent::MrPipes(Err(e))
        | AppEvent::MrPipeJobs(Err(e)) => {
            app.busy = false;
            app.status = format!("Error: {e}");
        }
        AppEvent::Review(Err(e))
        | AppEvent::Mine(Err(e))
        | AppEvent::Detail(Err(e)) => {
            app.busy = false;
            app.status = format!("Error: {e}");
        }
        AppEvent::ActionDone(verb, Err(e)) => {
            app.busy = false;
            app.status = format!("{verb} failed: {e}");
            // The optimistic approve removed the row up front; reload to bring it
            // back since the request never landed.
            if verb == "approve" {
                app.load_lists();
            }
        }
    }
}

fn handle_key(app: &mut App, code: KeyCode) {
    // Pipeline cancel confirmation intercepts keys first when active.
    if app.tab == Tab::Pipelines || app.screen == Screen::Detail {
        if let Some(c) = app.pipelines.confirm.clone() {
            match code {
                KeyCode::Char('y') | KeyCode::Char('Y') => {
                    app.pipelines.confirm = None;
                    crate::pipelines::run_confirmed(app, c.action);
                }
                _ => {
                    app.pipelines.confirm = None;
                    app.status = "Cancelled".into();
                }
            }
            return;
        }
    }

    // Confirmation prompt intercepts keys first.
    if let Some(confirm) = app.confirm.clone() {
        match code {
            KeyCode::Char('y') | KeyCode::Char('Y') => {
                app.confirm = None;
                crate::actions::dispatch(app, &confirm.verb, confirm.mr_id);
            }
            _ => {
                app.confirm = None;
                app.status = "Cancelled".into();
            }
        }
        return;
    }

    // The suggestion preview overlay captures keys while open, before the normal
    // screen dispatch (so its keys aren't also read as detail-screen actions).
    if app.suggestion.is_some() {
        handle_suggestion_key(app, code);
        return;
    }

    match app.screen {
        Screen::List => handle_list_key(app, code),
        Screen::Detail => handle_detail_key(app, code),
    }
}

fn handle_suggestion_key(app: &mut App, code: KeyCode) {
    match code {
        KeyCode::Char('p') => {
            if let Some(p) = app.suggestion.take() {
                let body = build_suggestion_body(&p);
                let pending = crate::comments::PendingCompose::Inline {
                    mr_id: p.mr_id,
                    file_path: p.file_path,
                    old_line: p.anchor_old,
                    new_line: p.anchor_new,
                    refs: p.refs,
                };
                crate::comments::post(app, pending, body);
                app.busy = true;
                app.status = "Posting suggestion…".into();
            }
        }
        KeyCode::Char('e') => {
            // Re-open the editor on the edited content; rebuild the preview.
            if let Some(p) = app.suggestion.take() {
                app.pending = Some(crate::comments::PendingCompose::Suggestion {
                    mr_id: p.mr_id,
                    file_path: p.file_path,
                    original: p.edited, // edit again starts from the current edit
                    above: p.above,
                    below: p.below,
                    anchor_old: p.anchor_old,
                    anchor_new: p.anchor_new,
                    refs: p.refs,
                });
            }
        }
        KeyCode::Char('m') => {
            app.suggestion_message_pending = true;
        }
        KeyCode::Esc => {
            app.suggestion = None;
            app.status = "Cancelled".into();
        }
        _ => {}
    }
}

/// Combine the optional message note and the suggestion block into one note body.
fn build_suggestion_body(p: &SuggestionPreview) -> String {
    use ultra_gitlab_lib::core::comments::build_suggestion_block;
    let block = build_suggestion_block(&p.edited, p.above, p.below);
    match &p.message {
        Some(m) if !m.is_empty() => format!("{m}\n\n{block}"),
        _ => block,
    }
}

fn handle_list_key(app: &mut App, code: KeyCode) {
    // While the add-project overlay is open, all keys go to the overlay.
    if app.tab == Tab::Pipelines && app.pipelines.search.is_some() {
        crate::pipelines::handle_key(app, code);
        return;
    }

    // Global keys: tab switch + quit work in every list tab.
    match code {
        KeyCode::Char('q') => {
            app.should_quit = true;
            return;
        }
        KeyCode::Char('1') => {
            switch_tab(app, Tab::Review);
            return;
        }
        KeyCode::Char('2') => {
            switch_tab(app, Tab::Mine);
            return;
        }
        KeyCode::Char('3') => {
            switch_tab(app, Tab::Pipelines);
            return;
        }
        KeyCode::Tab => {
            toggle_tab(app);
            return;
        }
        _ => {}
    }

    if app.tab == Tab::Pipelines {
        crate::pipelines::handle_key(app, code);
        return;
    }

    match code {
        KeyCode::Char('j') | KeyCode::Down => move_selection(app, 1),
        KeyCode::Char('k') | KeyCode::Up => move_selection(app, -1),
        KeyCode::Char('r') => app.load_lists(),
        KeyCode::Enter => open_detail(app),
        _ => {}
    }
}

fn switch_tab(app: &mut App, tab: Tab) {
    app.tab = tab;
    app.list_state.select(Some(0));
    if tab == Tab::Pipelines && !app.pipelines.loaded {
        crate::pipelines::enter_tab(app);
    }
}

fn handle_detail_key(app: &mut App, code: KeyCode) {
    match code {
        KeyCode::Esc | KeyCode::Char('q') => {
            if app.focus == Focus::Pipeline && app.detail_pipes.jobs.is_some() {
                // Back out of the inline jobs view to the pipeline list first.
                app.detail_pipes.jobs = None;
            } else {
                app.screen = Screen::List;
                app.detail = None;
                app.detail_pipes.reset();
                app.force_clear = true;
            }
        }
        KeyCode::Tab => {
            app.focus = match app.focus {
                Focus::Tree => Focus::Diff,
                Focus::Diff => Focus::Pipeline,
                Focus::Pipeline => Focus::Tree,
            };
        }
        // In the diff, Right/Left pan horizontally to reveal content cut off past
        // the borders; from elsewhere they jump focus (l→diff, h→files). Once the
        // diff is panned fully back to column 0, Left returns to the file tree.
        KeyCode::Right | KeyCode::Char('l') => match app.focus {
            Focus::Diff => {
                app.diff_hscroll =
                    app.diff_hscroll.saturating_add(HSCROLL_STEP).min(app.diff_hscroll_max);
            }
            _ => app.focus = Focus::Diff,
        },
        KeyCode::Left | KeyCode::Char('h') => match app.focus {
            Focus::Diff if app.diff_hscroll > 0 => {
                app.diff_hscroll = app.diff_hscroll.saturating_sub(HSCROLL_STEP);
            }
            _ => app.focus = Focus::Tree,
        },
        KeyCode::Home if app.focus == Focus::Diff => app.diff_hscroll = 0,
        KeyCode::Char('V') => mark_viewed_and_advance(app),
        KeyCode::Char('j') | KeyCode::Down => match app.focus {
            Focus::Tree => move_file(app, 1),
            Focus::Diff => move_cursor(app, 1),
            Focus::Pipeline => crate::pipelines::handle_detail_key(app, KeyCode::Char('j')),
        },
        KeyCode::Char('k') | KeyCode::Up => match app.focus {
            Focus::Tree => move_file(app, -1),
            Focus::Diff => move_cursor(app, -1),
            Focus::Pipeline => crate::pipelines::handle_detail_key(app, KeyCode::Char('k')),
        },
        KeyCode::PageDown if app.focus == Focus::Diff => {
            app.diff_scroll = app.diff_scroll.saturating_add(diff_page_step(app));
        }
        KeyCode::PageUp if app.focus == Focus::Diff => {
            app.diff_scroll = app.diff_scroll.saturating_sub(diff_page_step(app));
        }
        KeyCode::Char('c') if app.focus == Focus::Tree => {
            if let Some(d) = &app.detail {
                app.pending = Some(crate::comments::PendingCompose::General { mr_id: d.row.id });
            }
        }
        KeyCode::Char('c') if app.focus == Focus::Diff => {
            start_inline_comment(app);
        }
        KeyCode::Char('v') if app.focus == Focus::Diff => {
            app.diff_select_anchor = match app.diff_select_anchor {
                Some(_) => None,
                None => Some(app.diff_cursor),
            };
        }
        KeyCode::Char('s') if app.focus == Focus::Diff => start_suggestion(app),
        other => {
            if app.focus == Focus::Pipeline {
                crate::pipelines::handle_detail_key(app, other);
            } else {
                crate::actions::handle_action_key(app, other);
            }
        }
    }
}

/// Build a pending inline-comment compose from the cursor's anchor row.
fn start_inline_comment(app: &mut App) {
    // Collect all needed owned values while the borrow of `app.detail` is active,
    // then release that borrow before writing `app.pending` / `app.status`.
    enum Setup {
        Ready { mr_id: i64, file_path: String, refs: ultra_gitlab_lib::core::comments::DiffRefs },
        NoRefs,
        NoDetail,
    }
    let setup = match &app.detail {
        None => Setup::NoDetail,
        Some(d) => match d.diff_refs.clone() {
            None => Setup::NoRefs,
            Some(refs) => {
                let sel = app.file_state.selected().unwrap_or(0);
                match d.files.get(sel) {
                    None => Setup::NoDetail,
                    Some(file) => Setup::Ready { mr_id: d.row.id, file_path: file.new_path.clone(), refs },
                }
            }
        },
    };
    // Borrow of `app.detail` is released here.
    let (mr_id, file_path, refs) = match setup {
        Setup::Ready { mr_id, file_path, refs } => (mr_id, file_path, refs),
        Setup::NoRefs => {
            app.status = "No diff refs available for inline comments".into();
            return;
        }
        Setup::NoDetail => return,
    };

    // Anchor is the last row of the selection (matches the desktop default).
    let (_, hi) = app.diff_selection_bounds();
    let Some(row) = app.diff_rows.get(hi) else { return };
    let Some((old_line, new_line)) = crate::comments::position_for(row) else {
        app.status = "Pick a code line to comment on".into();
        return;
    };
    app.pending = Some(crate::comments::PendingCompose::Inline {
        mr_id,
        file_path,
        old_line,
        new_line,
        refs,
    });
}

/// Build a pending suggestion compose from the cursor's range, seeded with the
/// selected new-side source so the editor opens on the existing code.
fn start_suggestion(app: &mut App) {
    // Extract all owned values from the `app.detail` borrow first, then release
    // it before reading other `app` fields / mutating `app` (borrow checker).
    enum Setup {
        Ready { mr_id: i64, file_path: String, diff_content: String, refs: ultra_gitlab_lib::core::comments::DiffRefs },
        NoRefs,
        NoDetail,
    }
    let setup = match &app.detail {
        None => Setup::NoDetail,
        Some(d) => match d.diff_refs.clone() {
            None => Setup::NoRefs,
            Some(refs) => {
                let sel = app.file_state.selected().unwrap_or(0);
                match d.files.get(sel) {
                    None => Setup::NoDetail,
                    Some(file) => Setup::Ready {
                        mr_id: d.row.id,
                        file_path: file.new_path.clone(),
                        diff_content: file.diff_content.clone(),
                        refs,
                    },
                }
            }
        },
    };
    // Borrow of `app.detail` is released here.
    let (mr_id, file_path, diff_content, refs) = match setup {
        Setup::Ready { mr_id, file_path, diff_content, refs } => (mr_id, file_path, diff_content, refs),
        Setup::NoRefs => {
            app.status = "No diff refs available for suggestions".into();
            return;
        }
        Setup::NoDetail => return,
    };

    let (lo, hi) = app.diff_selection_bounds();
    let Some(seed) = crate::comments::suggestion_seed(&app.diff_rows, lo, hi) else {
        app.status = "Suggestions need a new-side line (not a pure deletion)".into();
        return;
    };
    // Gather the original new-side text from the selected rows for the preview.
    let original = crate::comments::selection_text(&app.diff_rows, &diff_content, lo, hi);
    let (above, below) = ultra_gitlab_lib::core::comments::suggestion_offsets(
        seed.start_line,
        seed.end_line,
        seed.anchor_line,
    );
    app.pending = Some(crate::comments::PendingCompose::Suggestion {
        mr_id,
        file_path,
        original,
        above,
        below,
        anchor_old: None,
        anchor_new: Some(seed.anchor_line),
        refs,
    });
}

fn toggle_tab(app: &mut App) {
    let next = match app.tab {
        Tab::Review => Tab::Mine,
        Tab::Mine => Tab::Pipelines,
        Tab::Pipelines => Tab::Review,
    };
    switch_tab(app, next);
}

fn move_selection(app: &mut App, delta: i32) {
    let len = app.rows().len();
    if len == 0 {
        return;
    }
    let cur = app.list_state.selected().unwrap_or(0) as i32;
    let next = (cur + delta).clamp(0, len as i32 - 1) as usize;
    app.list_state.select(Some(next));
}

/// Columns panned per Left/Right press in the diff. A few columns at a time
/// feels responsive without overshooting short lines.
const HSCROLL_STEP: u16 = 8;

/// One PgUp/PgDn jump: a near-full page of the diff pane, keeping a line of
/// overlap for context. Falls back to a sane default before the first render.
fn diff_page_step(app: &App) -> u16 {
    app.diff_viewport.saturating_sub(1).max(10)
}

/// First selectable row index, or 0 if none.
pub fn first_selectable(rows: &[crate::ui::diff::RowMeta]) -> usize {
    rows.iter().position(|r| r.selectable()).unwrap_or(0)
}

impl App {
    /// Inclusive `(low, high)` highlight bounds: the visual range if active,
    /// else just the cursor row.
    pub fn diff_selection_bounds(&self) -> (usize, usize) {
        match self.diff_select_anchor {
            Some(a) => (a.min(self.diff_cursor), a.max(self.diff_cursor)),
            None => (self.diff_cursor, self.diff_cursor),
        }
    }
}

/// Move the diff cursor by `delta`, skipping non-selectable rows (hunk headers,
/// blanks). Returns the new cursor index. Pure over the rows so it is testable.
fn next_selectable(rows: &[crate::ui::diff::RowMeta], from: usize, delta: i32) -> usize {
    if rows.is_empty() {
        return 0;
    }
    let len = rows.len() as i32;
    let mut i = from as i32;
    loop {
        let n = i + delta;
        if n < 0 || n >= len {
            // No selectable row found in that direction; stay at `from`.
            return from;
        }
        i = n;
        if rows[i as usize].selectable() {
            return i as usize;
        }
    }
}

fn move_cursor(app: &mut App, delta: i32) {
    if app.diff_rows.is_empty() {
        return;
    }
    app.diff_cursor = next_selectable(&app.diff_rows, app.diff_cursor, delta);
    // Keep the cursor within the viewport by nudging the scroll offset.
    let cur = app.diff_cursor as u16;
    let top = app.diff_scroll;
    let h = app.diff_viewport.max(1);
    if cur < top {
        app.diff_scroll = cur;
    } else if cur >= top + h {
        app.diff_scroll = cur.saturating_sub(h - 1);
    }
}

fn move_file(app: &mut App, delta: i32) {
    let Some(d) = &app.detail else { return };
    let len = d.files.len();
    if len == 0 {
        return;
    }
    let cur = app.file_state.selected().unwrap_or(0) as i32;
    let next = (cur + delta).clamp(0, len as i32 - 1) as usize;
    app.file_state.select(Some(next));
    app.diff_scroll = 0;
    app.diff_hscroll = 0;
    app.diff_cursor = 0;
    app.diff_select_anchor = None;
    app.force_clear = true;
}

/// Mark the selected file viewed, then select the next not-yet-viewed file
/// (wrapping around). If every file is viewed, the selection stays put.
fn mark_viewed_and_advance(app: &mut App) {
    let paths: Vec<String> = match &app.detail {
        Some(d) if !d.files.is_empty() => d.files.iter().map(|f| f.new_path.clone()).collect(),
        _ => return,
    };
    let len = paths.len();
    let cur = app.file_state.selected().unwrap_or(0).min(len - 1);
    app.viewed.insert(paths[cur].clone());
    let next = (1..=len)
        .map(|off| (cur + off) % len)
        .find(|&i| !app.viewed.contains(&paths[i]));
    if let Some(i) = next {
        app.file_state.select(Some(i));
        app.diff_scroll = 0;
        app.diff_hscroll = 0;
        app.diff_cursor = 0;
        app.diff_select_anchor = None;
        app.force_clear = true;
    } else {
        app.status = "All files viewed".into();
    }
}

fn open_detail(app: &mut App) {
    let Some(sel) = app.list_state.selected() else { return };
    let Some(row) = app.rows().get(sel) else { return };
    let mr_id = row.id;
    app.screen = Screen::Detail;
    app.focus = Focus::Tree;
    app.detail = None;
    app.busy = true;
    app.status = "Loading diff…".into();
    app.detail_pipes.reset();
    let pool = app.pool.clone();
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_detail(&pool, mr_id).await.map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::Detail(r));
    });
    let pool2 = app.pool.clone();
    let tx2 = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_mr_pipelines(&pool2, mr_id)
            .await
            .map_err(|e| e.to_string());
        let _ = tx2.send(AppEvent::MrPipes(r));
    });
}

#[cfg(test)]
mod tests {
    use super::next_selectable;
    use crate::ui::diff::{RowKind, RowMeta};

    fn r(kind: RowKind) -> RowMeta {
        RowMeta { kind, old_line: None, new_line: None }
    }

    #[test]
    fn cursor_skips_hunk_and_blank() {
        let rows = vec![
            r(RowKind::Hunk),
            r(RowKind::Context),
            r(RowKind::Add),
            r(RowKind::Blank),
            r(RowKind::Hunk),
            r(RowKind::Context),
        ];
        // from index 2 (Add), +1 skips Blank+Hunk to land on index 5 (Context).
        assert_eq!(next_selectable(&rows, 2, 1), 5);
        // moving up from 5 lands on 2.
        assert_eq!(next_selectable(&rows, 5, -1), 2);
        // at the top, moving up stays put.
        assert_eq!(next_selectable(&rows, 1, -1), 1);
    }
}
