//! MR list table for the active tab.

use crate::app::{App, Tab};
use crate::data::MrRow;
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem};
use ratatui::Frame;

fn pipeline_glyph(status: Option<&str>) -> Span<'static> {
    let (sym, color) = match status {
        Some("success") => ("●", Color::Green),
        Some("failed") => ("●", Color::Red),
        Some("running") => ("●", Color::Yellow),
        Some(_) => ("●", Color::DarkGray),
        None => ("·", Color::DarkGray),
    };
    Span::styled(sym, Style::default().fg(color))
}

fn approval_span(row: &MrRow) -> Span<'static> {
    let txt = format!("{}/{}", row.approvals_count, row.approvals_required.max(0));
    let color = if row.approvals_count >= row.approvals_required && row.approvals_required > 0 {
        Color::Green
    } else {
        Color::DarkGray
    };
    Span::styled(txt, Style::default().fg(color))
}

fn row_line(row: &MrRow, mine: bool) -> Line<'static> {
    let mut spans = vec![
        pipeline_glyph(row.pipeline.as_deref()),
        Span::raw(" "),
        approval_span(row),
        Span::raw("  "),
        Span::styled(
            format!("{:<28}", truncate(&row.project_name, 28)),
            Style::default().fg(Color::Blue),
        ),
        Span::raw(" "),
        Span::raw(truncate(&row.title, 60)),
    ];
    if mine && row.is_draft {
        spans.push(Span::styled(" [draft]", Style::default().fg(Color::Yellow)));
    }
    if !mine {
        spans.push(Span::styled(
            format!("  @{}", row.author),
            Style::default().fg(Color::DarkGray),
        ));
    }
    Line::from(spans)
}

fn truncate(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        s.to_string()
    } else {
        let mut out: String = s.chars().take(max.saturating_sub(1)).collect();
        out.push('…');
        out
    }
}

pub fn render(f: &mut Frame, app: &mut App, area: Rect) {
    let mine = app.tab == Tab::Mine;
    let title = if mine { " Mine " } else { " Review " };
    let rows = app.rows();
    if rows.is_empty() {
        let msg = if app.busy {
            "Loading…"
        } else {
            "No merge requests. Press r to refresh (desktop app keeps the cache fresh)."
        };
        let block = Block::default().borders(Borders::ALL).title(title);
        f.render_widget(ratatui::widgets::Paragraph::new(msg).block(block), area);
        return;
    }
    let items: Vec<ListItem> = rows.iter().map(|r| ListItem::new(row_line(r, mine))).collect();
    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(title))
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, area, &mut app.list_state);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn row(title: &str) -> MrRow {
        MrRow {
            id: 1,
            iid: 1,
            project_name: "group/project".into(),
            title: title.into(),
            author: "alice".into(),
            source_branch: "feat".into(),
            target_branch: "main".into(),
            state: "opened".into(),
            approvals_count: 1,
            approvals_required: 2,
            pipeline: Some("success".into()),
            is_draft: false,
            user_has_approved: false,
        }
    }

    #[test]
    fn truncate_adds_ellipsis() {
        assert_eq!(truncate("abcdef", 4), "abc…");
        assert_eq!(truncate("abc", 4), "abc");
    }

    #[test]
    fn row_line_contains_title() {
        let line = row_line(&row("Fix the bug"), false);
        let text: String = line.spans.iter().map(|s| s.content.as_ref()).collect();
        assert!(text.contains("Fix the bug"));
        assert!(text.contains("@alice"));
    }
}
