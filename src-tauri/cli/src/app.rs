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
    /// new_path of files marked viewed in the current detail (reset per MR).
    pub viewed: HashSet<String>,

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
            viewed: HashSet::new(),
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

    loop {
        tokio::select! {
            maybe_key = keys.next() => {
                if let Some(Ok(Event::Key(key))) = maybe_key {
                    if key.kind == KeyEventKind::Press {
                        handle_key(&mut app, key.code);
                    }
                }
            }
            Some(ev) = rx.recv() => {
                handle_event(&mut app, ev);
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

    match app.screen {
        Screen::List => handle_list_key(app, code),
        Screen::Detail => handle_detail_key(app, code),
    }
}

fn handle_list_key(app: &mut App, code: KeyCode) {
    match code {
        KeyCode::Char('q') => app.should_quit = true,
        KeyCode::Tab => toggle_tab(app),
        KeyCode::Char('1') => {
            app.tab = Tab::Review;
            app.list_state.select(Some(0));
        }
        KeyCode::Char('2') => {
            app.tab = Tab::Mine;
            app.list_state.select(Some(0));
        }
        KeyCode::Char('j') | KeyCode::Down => move_selection(app, 1),
        KeyCode::Char('k') | KeyCode::Up => move_selection(app, -1),
        KeyCode::Char('r') => app.load_lists(),
        KeyCode::Enter => open_detail(app),
        _ => {}
    }
}

fn handle_detail_key(app: &mut App, code: KeyCode) {
    match code {
        KeyCode::Esc | KeyCode::Char('q') => {
            app.screen = Screen::List;
            app.detail = None;
            app.force_clear = true;
        }
        KeyCode::Tab => {
            app.focus = match app.focus {
                Focus::Tree => Focus::Diff,
                Focus::Diff => Focus::Tree,
            };
        }
        // Right (or vim l) jumps into the diff to scroll it; Left (or h) back to files.
        KeyCode::Right | KeyCode::Char('l') => app.focus = Focus::Diff,
        KeyCode::Left | KeyCode::Char('h') => app.focus = Focus::Tree,
        KeyCode::Char('V') => mark_viewed_and_advance(app),
        KeyCode::Char('j') | KeyCode::Down => match app.focus {
            Focus::Tree => move_file(app, 1),
            Focus::Diff => app.diff_scroll = app.diff_scroll.saturating_add(1),
        },
        KeyCode::Char('k') | KeyCode::Up => match app.focus {
            Focus::Tree => move_file(app, -1),
            Focus::Diff => app.diff_scroll = app.diff_scroll.saturating_sub(1),
        },
        // Actions handled in Task 8.
        other => crate::actions::handle_action_key(app, other),
    }
}

fn toggle_tab(app: &mut App) {
    app.tab = match app.tab {
        Tab::Review => Tab::Mine,
        Tab::Mine => Tab::Review,
    };
    app.list_state.select(Some(0));
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
    let pool = app.pool.clone();
    let tx = app.tx.clone();
    tokio::spawn(async move {
        let r = data::load_detail(&pool, mr_id).await.map_err(|e| e.to_string());
        let _ = tx.send(AppEvent::Detail(r));
    });
}
