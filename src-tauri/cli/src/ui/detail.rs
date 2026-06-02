//! Detail screen: MR header on top, file tree (left) + diff (right) below.

use crate::app::{App, Focus};
use crate::ui::diff;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph, Wrap};
use ratatui::Frame;

pub fn render(f: &mut Frame, app: &mut App, area: Rect) {
    let Some(detail) = app.detail.clone() else {
        f.render_widget(
            Paragraph::new("Loading diff…").block(Block::default().borders(Borders::ALL)),
            area,
        );
        return;
    };

    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(4), Constraint::Min(0)])
        .split(area);

    render_header(f, &detail, rows[0]);

    let panes = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(32), Constraint::Percentage(68)])
        .split(rows[1]);

    render_tree(f, app, &detail, panes[0]);
    render_diff(f, app, &detail, panes[1]);
}

fn render_header(f: &mut Frame, detail: &crate::data::DetailData, area: Rect) {
    let r = &detail.row;
    let title = Line::from(vec![
        Span::styled(format!("!{} ", r.iid), Style::default().fg(Color::DarkGray)),
        Span::styled(r.title.clone(), Style::default().add_modifier(Modifier::BOLD)),
    ]);
    let meta = Line::from(vec![
        Span::styled(r.project_name.clone(), Style::default().fg(Color::Blue)),
        Span::raw("  "),
        Span::styled(format!("{} → {}", r.source_branch, r.target_branch), Style::default().fg(Color::DarkGray)),
        Span::raw("  "),
        Span::raw(format!("approvals {}/{}", r.approvals_count, r.approvals_required.max(0))),
        Span::raw("  "),
        Span::raw(format!("pipeline {}", r.pipeline.as_deref().unwrap_or("-"))),
    ]);
    let block = Block::default().borders(Borders::ALL);
    f.render_widget(Paragraph::new(vec![title, meta]).block(block).wrap(Wrap { trim: true }), area);
}

fn render_tree(f: &mut Frame, app: &mut App, detail: &crate::data::DetailData, area: Rect) {
    let items: Vec<ListItem> = detail
        .files
        .iter()
        .map(|file| {
            let viewed = app.viewed.contains(&file.new_path);
            let sym = match file.change_type.as_str() {
                "added" => Span::styled("A ", Style::default().fg(Color::Green)),
                "deleted" => Span::styled("D ", Style::default().fg(Color::Red)),
                "renamed" => Span::styled("R ", Style::default().fg(Color::Yellow)),
                _ => Span::styled("M ", Style::default().fg(Color::Cyan)),
            };
            let path_style = if viewed {
                Style::default().fg(Color::DarkGray)
            } else {
                Style::default()
            };
            let mut spans = vec![sym, Span::styled(file.new_path.clone(), path_style)];
            if file.additions > 0 || file.deletions > 0 {
                spans.push(Span::styled(
                    format!("  +{}", file.additions),
                    Style::default().fg(Color::Green),
                ));
                spans.push(Span::styled(
                    format!(" -{}", file.deletions),
                    Style::default().fg(Color::Red),
                ));
            }
            if viewed {
                spans.push(Span::styled("  ✓", Style::default().fg(Color::Green)));
            }
            ListItem::new(Line::from(spans))
        })
        .collect();
    let focused = app.focus == Focus::Tree;
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Files ")
        .border_style(border_style(focused));
    let list = List::new(items)
        .block(block)
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, area, &mut app.file_state);
}

fn render_diff(f: &mut Frame, app: &App, detail: &crate::data::DetailData, area: Rect) {
    let focused = app.focus == Focus::Diff;
    let sel = app.file_state.selected().unwrap_or(0);
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Diff ")
        .border_style(border_style(focused));

    let Some(file) = detail.files.get(sel) else {
        f.render_widget(Paragraph::new("No file selected").block(block), area);
        return;
    };
    let text = diff::render_diff(&app.highlighter, &file.new_path, &file.diff_content);
    f.render_widget(
        Paragraph::new(text).block(block).scroll((app.diff_scroll, 0)),
        area,
    );
}

fn border_style(focused: bool) -> Style {
    if focused {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    }
}
