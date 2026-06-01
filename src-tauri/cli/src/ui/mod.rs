//! Top-level rendering: tab bar, body, footer.

pub mod footer;
pub mod list;

use crate::app::{App, Screen, Tab};
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Paragraph};
use ratatui::Frame;

pub fn draw(f: &mut Frame, app: &mut App) {
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(1), Constraint::Min(0), Constraint::Length(1)])
        .split(f.area());

    render_tabs(f, app, chunks[0]);

    match app.screen {
        // Lists and detail bodies are added in Phases 5 and 7. For now show a
        // placeholder so the skeleton runs.
        Screen::List => list::render(f, app, chunks[1]),
        Screen::Detail => {
            let p = Paragraph::new("detail view: Phase 7")
                .block(Block::default().borders(Borders::ALL));
            f.render_widget(p, chunks[1]);
        }
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
    ]);
    f.render_widget(Paragraph::new(line), area);
}
