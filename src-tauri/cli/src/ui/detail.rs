//! Detail screen: MR header on top, file tree (left) + diff (right) below.

use crate::app::{App, Focus};
use crate::ui::diff;
use crate::ui::status_style;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap};
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

    let left = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
        .split(panes[0]);

    render_tree(f, app, &detail, left[0]);
    render_pipelines_panel(f, app, left[1]);
    // Track the diff pane's inner height (minus borders) so PgUp/PgDn can page.
    app.diff_viewport = panes[1].height.saturating_sub(2);
    render_diff(f, app, &detail, panes[1]);

    if let Some(prev) = app.suggestion.clone() {
        render_suggestion_preview(f, &prev, area);
    }

    if app.overlay.is_some() {
        render_discussions(f, app, area);
    }
}

fn render_suggestion_preview(f: &mut Frame, p: &crate::app::SuggestionPreview, area: Rect) {
    use ratatui::widgets::Clear;
    use ultra_gitlab_lib::core::comments::build_suggestion_block;
    let block_text = build_suggestion_block(&p.edited, p.above, p.below);
    let mut lines: Vec<Line> = Vec::new();
    for l in p.original.lines() {
        lines.push(Line::from(Span::styled(format!("- {l}"), Style::default().fg(Color::Red))));
    }
    for l in p.edited.lines() {
        lines.push(Line::from(Span::styled(format!("+ {l}"), Style::default().fg(Color::Green))));
    }
    lines.push(Line::from(""));
    if let Some(m) = &p.message {
        lines.push(Line::from(Span::styled(format!("message: {m}"), Style::default().fg(Color::Cyan))));
        lines.push(Line::from(""));
    }
    for l in block_text.lines() {
        lines.push(Line::from(Span::styled(l.to_string(), Style::default().fg(Color::DarkGray))));
    }
    let title = format!(" Suggestion preview · {} ", p.file_path);
    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .title_bottom(" p:post  e:edit  m:message  esc:cancel ")
        .border_style(Style::default().fg(Color::Cyan));
    // Centered popup covering most of the area.
    let w = area.width.saturating_sub(8).min(100);
    let h = (lines.len() as u16 + 2).min(area.height.saturating_sub(4));
    let x = area.x + (area.width.saturating_sub(w)) / 2;
    let y = area.y + (area.height.saturating_sub(h)) / 2;
    let popup = Rect { x, y, width: w, height: h };
    f.render_widget(Clear, popup);
    f.render_widget(Paragraph::new(lines).block(block).wrap(Wrap { trim: false }), popup);
}

fn render_header(f: &mut Frame, detail: &crate::data::DetailData, area: Rect) {
    let r = &detail.row;
    let title = Line::from(vec![
        Span::styled(format!("!{} ", r.iid), Style::default().fg(Color::DarkGray)),
        Span::styled(r.title.clone(), Style::default().add_modifier(Modifier::BOLD)),
    ]);
    let mut meta_spans = vec![
        Span::styled(r.project_name.clone(), Style::default().fg(Color::Blue)),
        Span::raw("  "),
        Span::styled(format!("{} → {}", r.source_branch, r.target_branch), Style::default().fg(Color::DarkGray)),
        Span::raw("  "),
        Span::raw(format!("approvals {}/{}", r.approvals_count, r.approvals_required.max(0))),
        Span::raw("  "),
        Span::raw(format!("pipeline {}", r.pipeline.as_deref().unwrap_or("-"))),
    ];
    if r.auto_merge {
        meta_spans.push(Span::styled(
            "  auto-merge ✓",
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        ));
    }
    let meta = Line::from(meta_spans);
    let block = Block::default().borders(Borders::ALL);
    f.render_widget(Paragraph::new(vec![title, meta]).block(block).wrap(Wrap { trim: true }), area);
}

fn render_tree(f: &mut Frame, app: &mut App, detail: &crate::data::DetailData, area: Rect) {
    let vis = crate::app::visible_indices(detail, app.show_ignored);
    let items: Vec<ListItem> = vis
        .iter()
        .map(|&i| {
            let file = &detail.files[i];
            let is_ignored = detail.ignored.contains(&file.new_path);
            let sym = match file.change_type.as_str() {
                "added" => Span::styled("A ", Style::default().fg(Color::Green)),
                "deleted" => Span::styled("D ", Style::default().fg(Color::Red)),
                "renamed" => Span::styled("R ", Style::default().fg(Color::Yellow)),
                _ => Span::styled("M ", Style::default().fg(Color::Cyan)),
            };
            // Ignored files are only ever rendered here when revealed; dim them
            // so they read as secondary, mirroring the desktop's greyed-out look.
            let path_style = if is_ignored {
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
            if is_ignored {
                spans.push(Span::styled(
                    "  ignored",
                    Style::default().fg(Color::DarkGray).add_modifier(Modifier::ITALIC),
                ));
            }
            ListItem::new(Line::from(spans))
        })
        .collect();
    let focused = app.focus == Focus::Tree;
    // Surface how many files are ignored and the toggle, like the desktop's
    // "+N hidden" / "N generated" affordance.
    let ignored_count = detail.ignored.len();
    let title = if ignored_count == 0 {
        " Files ".to_string()
    } else if app.show_ignored {
        format!(" Files · {ignored_count} ignored (g) ")
    } else {
        format!(" Files · +{ignored_count} hidden (g) ")
    };
    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(border_style(focused));
    let list = List::new(items)
        .block(block)
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, area, &mut app.file_state);
}

fn render_diff(f: &mut Frame, app: &mut App, detail: &crate::data::DetailData, area: Rect) {
    let focused = app.focus == Focus::Diff;
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Diff ")
        .border_style(border_style(focused));

    let file = crate::app::selected_file_index(app, detail).and_then(|i| detail.files.get(i));
    let Some(file) = file else {
        app.diff_hscroll_max = 0;
        // Distinguish "all files are ignored and hidden" from a plain empty
        // selection, pointing the user at the toggle.
        let msg = if !detail.files.is_empty() && !app.show_ignored {
            "All files are ignored — press g to show them."
        } else {
            "No file selected"
        };
        f.render_widget(Paragraph::new(msg).block(block), area);
        return;
    };
    let model = diff::render_diff(&app.highlighter, &file.new_path, &file.diff_content);
    let mut text = model.text;
    app.diff_rows = model.rows;

    // Gutter markers: place a ● on lines that have a discussion thread.
    let marks: std::collections::HashSet<(bool, i64)> = app
        .discussions
        .as_ref()
        .map(|threads| {
            threads
                .iter()
                .filter(|t| t.file_path.as_deref() == Some(file.new_path.as_str()))
                .filter_map(|t| {
                    t.new_line
                        .map(|n| (false, n))
                        .or_else(|| t.old_line.map(|o| (true, o)))
                })
                .collect()
        })
        .unwrap_or_default();
    if !marks.is_empty() {
        for (i, line) in text.lines.iter_mut().enumerate() {
            let Some(meta) = app.diff_rows.get(i) else { continue };
            let has = meta
                .new_line
                .map(|n| marks.contains(&(false, n)))
                .unwrap_or(false)
                || meta.old_line.map(|o| marks.contains(&(true, o))).unwrap_or(false);
            if has {
                if let Some(first) = line.spans.first_mut() {
                    // The gutter span is "{:>4} {:>4} " (10 chars); place a ● at col 0.
                    let mut g: String = first.content.to_string();
                    if !g.is_empty() {
                        g.replace_range(0..1, "●");
                        first.content = g.into();
                        first.style = first.style.fg(Color::Yellow);
                    }
                }
            }
        }
    }

    // Clamp the cursor to a selectable row after a re-render.
    if !app.diff_rows.is_empty()
        && (app.diff_cursor >= app.diff_rows.len()
            || !app.diff_rows[app.diff_cursor].selectable())
    {
        app.diff_cursor = crate::app::first_selectable(&app.diff_rows);
    }
    let (lo, hi) = app.diff_selection_bounds();
    for (i, line) in text.lines.iter_mut().enumerate() {
        if i >= lo && i <= hi {
            let bg = if i == app.diff_cursor { Color::Rgb(60, 60, 90) } else { Color::Rgb(40, 40, 60) };
            line.spans.iter_mut().for_each(|s| s.style = s.style.bg(bg));
        }
    }
    let inner_w = area.width.saturating_sub(2);
    let max_w = text.lines.iter().map(|l| l.width()).max().unwrap_or(0) as u16;
    app.diff_hscroll_max = max_w.saturating_sub(inner_w);
    let hscroll = app.diff_hscroll.min(app.diff_hscroll_max);
    app.diff_hscroll = hscroll;
    f.render_widget(
        Paragraph::new(text).block(block).scroll((app.diff_scroll, hscroll)),
        area,
    );
}

fn render_pipelines_panel(f: &mut Frame, app: &mut App, area: Rect) {
    let focused = app.focus == Focus::Pipeline;
    let busy = app.busy;
    let glyph = |status: Option<&str>| {
        let (sym, color) = status_style(status);
        Span::styled(sym, Style::default().fg(color))
    };

    // Inline jobs mode.
    if let Some(jobs) = app.detail_pipes.jobs.clone() {
        let block = Block::default()
            .borders(Borders::ALL)
            .title(" Pipeline jobs · esc back ")
            .border_style(border_style(focused));
        if jobs.is_empty() {
            // Enter seeds `Some(vec![])` before the fetch resolves, so distinguish
            // "still loading" from "fetched, no jobs" via the busy flag.
            let msg = if busy { "Loading…" } else { "No jobs" };
            f.render_widget(Paragraph::new(msg).block(block), area);
            return;
        }
        let items: Vec<ListItem> = jobs
            .iter()
            .map(|j| {
                ListItem::new(Line::from(vec![
                    glyph(Some(j.status.as_str())),
                    Span::raw(" "),
                    Span::styled(format!("{:<8}", j.stage), Style::default().fg(Color::DarkGray)),
                    Span::raw(" "),
                    Span::raw(j.name.clone()),
                ]))
            })
            .collect();
        let list = List::new(items)
            .block(block)
            .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
            .highlight_symbol("▌");
        f.render_stateful_widget(list, area, &mut app.detail_pipes.job_state);
        return;
    }

    // Pipeline list mode.
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Pipelines · enter jobs ")
        .border_style(border_style(focused));
    if app.detail_pipes.pipelines.is_empty() {
        f.render_widget(Paragraph::new("No pipelines").block(block), area);
        return;
    }
    let items: Vec<ListItem> = app
        .detail_pipes
        .pipelines
        .iter()
        .map(|p| {
            ListItem::new(Line::from(vec![
                glyph(Some(p.status.as_str())),
                Span::raw(" "),
                Span::styled(format!("#{}", p.id), Style::default().fg(Color::Cyan)),
                Span::raw("  "),
                Span::styled(p.status.clone(), Style::default().fg(Color::DarkGray)),
            ]))
        })
        .collect();
    let list = List::new(items)
        .block(block)
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, area, &mut app.detail_pipes.pipe_state);
}

fn border_style(focused: bool) -> Style {
    if focused {
        Style::default().fg(Color::Cyan)
    } else {
        Style::default().fg(Color::DarkGray)
    }
}

fn render_discussions(f: &mut Frame, app: &mut App, area: Rect) {
    let threads = app.discussions.clone().unwrap_or_default();
    let items: Vec<ListItem> = if threads.is_empty() {
        vec![ListItem::new("No discussions")]
    } else {
        threads
            .iter()
            .map(|t| {
                let loc = match (&t.file_path, t.new_line.or(t.old_line)) {
                    (Some(f), Some(l)) => format!("{f}:{l}"),
                    _ => "General".to_string(),
                };
                let status = if t.resolvable {
                    if t.resolved { "  [resolved]" } else { "  [unresolved]" }
                } else { "" };
                let mut lines = vec![Line::from(vec![
                    Span::styled(loc, Style::default().fg(Color::Blue)),
                    Span::styled(status.to_string(), Style::default().fg(Color::DarkGray)),
                ])];
                for n in t.notes.iter().filter(|n| !n.system) {
                    let first = n.body.lines().next().unwrap_or("");
                    lines.push(Line::from(format!("  @{}: {}", n.author, first)));
                }
                ListItem::new(lines)
            })
            .collect()
    };
    let w = area.width.saturating_sub(6).min(110);
    let h = area.height.saturating_sub(4);
    let x = area.x + (area.width.saturating_sub(w)) / 2;
    let y = area.y + (area.height.saturating_sub(h)) / 2;
    let popup = Rect { x, y, width: w, height: h };
    let block = Block::default()
        .borders(Borders::ALL)
        .title(format!(" Discussions ({}) ", threads.len()))
        .title_bottom(" j/k move · r reply · R resolve · esc close ")
        .border_style(Style::default().fg(Color::Cyan));
    f.render_widget(Clear, popup);
    let list = List::new(items)
        .block(block)
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    if let Some(o) = app.overlay.as_mut() {
        f.render_stateful_widget(list, popup, &mut o.state);
    }
}
