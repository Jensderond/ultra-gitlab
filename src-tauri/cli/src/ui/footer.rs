//! Bottom status/hint bar.

use crate::app::{App, Screen};
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

pub fn render(f: &mut Frame, app: &App, area: Rect) {
    let hints = match app.screen {
        Screen::List => "1/2 tabs · j/k move · enter open · r refresh · q quit",
        Screen::Detail => {
            "tab focus · j/k scroll · a approve · R rebase · M merge · U undraft · A auto-merge · esc back"
        }
    };
    let line = if let Some(confirm) = &app.confirm {
        format!(" {}", confirm.prompt)
    } else {
        let spinner = if app.busy { "⏳ " } else { "" };
        format!(" {spinner}{}  |  {hints}", app.status)
    };
    f.render_widget(
        Paragraph::new(line).style(Style::default().fg(Color::Gray)),
        area,
    );
}
