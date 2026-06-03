//! Top-level rendering: tab bar, body, footer.

pub mod detail;
pub mod diff;
pub mod footer;
pub mod list;

use crate::app::{App, Screen, Tab};
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

pub fn draw(f: &mut Frame, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(0), Constraint::Length(1)])
        .split(f.area());

    render_tabs(f, app, chunks[0]);

    match app.screen {
        Screen::List => list::render(f, app, chunks[1]),
        Screen::Detail => detail::render(f, app, chunks[1]),
    }

    footer::render(f, app, chunks[2]);
}

fn render_tabs(f: &mut Frame, app: &App, area: ratatui::layout::Rect) {
    let sel = Style::default().fg(Color::Black).bg(Color::Cyan).add_modifier(Modifier::BOLD);
    let unsel = Style::default().fg(Color::Cyan);
    let span = |label, active| {
        Span::styled(format!(" {label} "), if active { sel } else { unsel })
    };
    let line = Line::from(vec![
        span("1 Review", app.tab == Tab::Review),
        Span::raw(" "),
        span("2 Mine", app.tab == Tab::Mine),
        Span::raw("   "),
        Span::styled(
            app.username.as_deref().map(|u| format!("@{u}")).unwrap_or_default(),
            Style::default().fg(Color::DarkGray),
        ),
    ]);
    f.render_widget(Paragraph::new(line), area);
}

/// Map a pipeline/job status string to a glyph and color, shared by the list,
/// pipelines, and detail views. `None` status renders a dim dot.
pub fn status_style(status: Option<&str>) -> (&'static str, Color) {
    match status {
        Some("success") => ("●", Color::Green),
        Some("failed") => ("●", Color::Red),
        Some("running") => ("●", Color::Yellow),
        Some("pending") | Some("created") | Some("waiting_for_resource") | Some("preparing")
        | Some("scheduled") => ("●", Color::Cyan),
        Some("canceled") | Some("skipped") => ("●", Color::DarkGray),
        Some("manual") => ("◆", Color::Magenta),
        Some(_) => ("●", Color::DarkGray),
        None => ("·", Color::DarkGray),
    }
}
