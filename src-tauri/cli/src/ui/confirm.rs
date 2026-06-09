//! Centered confirmation dialog for destructive actions (merge, cancels).
//!
//! The pending prompt also still replaces the footer hints; this popup makes
//! the question impossible to miss. `y` confirms, any other key cancels.

use ratatui::layout::{Alignment, Rect};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, Clear, Paragraph};
use ratatui::Frame;

pub fn render(f: &mut Frame, prompt: &str, area: Rect) {
    let w = (prompt.chars().count() as u16 + 6).clamp(34, area.width.saturating_sub(4));
    let h = 3u16.min(area.height);
    let x = area.x + (area.width.saturating_sub(w)) / 2;
    let y = area.y + (area.height.saturating_sub(h)) / 2;
    let popup = Rect { x, y, width: w, height: h };
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Confirm ")
        .title_bottom(" y yes · any other key no ")
        .border_style(Style::default().fg(Color::Yellow));
    f.render_widget(Clear, popup);
    f.render_widget(
        Paragraph::new(prompt).alignment(Alignment::Center).block(block),
        popup,
    );
}
