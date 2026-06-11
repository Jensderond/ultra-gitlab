//! Pipelines tab rendering: projects → pipelines → jobs, plus the add-project
//! search overlay.

use crate::app::App;
use crate::pipelines::PipeView;
use crate::ui::status_style;
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph};
use ratatui::Frame;

pub fn render(f: &mut Frame, app: &mut App, area: Rect) {
    match app.pipelines.view {
        PipeView::Projects => render_projects(f, app, area),
        PipeView::Pipelines => render_pipelines(f, app, area),
        PipeView::Jobs => render_jobs(f, app, area),
    }
    if app.pipelines.search.is_some() {
        render_search(f, app, area);
    }
}

fn glyph(status: Option<&str>) -> Span<'static> {
    let (sym, color) = status_style(status);
    Span::styled(sym, Style::default().fg(color))
}

fn fmt_duration(secs: Option<i64>) -> String {
    match secs {
        Some(s) if s > 0 => format!("{}m{:02}s", s / 60, s % 60),
        _ => "-".to_string(),
    }
}

fn render_projects(f: &mut Frame, app: &mut App, area: Rect) {
    if app.pipelines.projects.is_empty() {
        let msg = if app.busy {
            "Loading…"
        } else {
            "No projects pinned. Press n to search and add a project."
        };
        let block = Block::default().borders(Borders::ALL).title(" Pipelines ");
        f.render_widget(Paragraph::new(msg).block(block), area);
        return;
    }
    let items: Vec<ListItem> = app
        .pipelines
        .projects
        .iter()
        .map(|p| {
            let pin = if p.pinned {
                Span::styled("📌 ", Style::default())
            } else {
                Span::raw("   ")
            };
            let st = p.status.as_ref();
            let mut spans = vec![
                glyph(st.map(|s| s.status.as_str())),
                Span::raw(" "),
                pin,
                Span::styled(p.name.clone(), Style::default().fg(Color::Blue)),
            ];
            if let Some(s) = st {
                spans.push(Span::raw("  "));
                spans.push(Span::styled(
                    s.status.clone(),
                    Style::default().fg(Color::DarkGray),
                ));
                spans.push(Span::styled(
                    format!("  {}", s.ref_name),
                    Style::default().fg(Color::DarkGray),
                ));
            }
            ListItem::new(Line::from(spans))
        })
        .collect();
    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Pipelines · Projects "),
        )
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, area, &mut app.pipelines.proj_state);
}

fn render_pipelines(f: &mut Frame, app: &mut App, area: Rect) {
    if app.pipelines.pipelines.is_empty() {
        let msg = if app.busy { "Loading…" } else { "No pipelines." };
        let block = Block::default().borders(Borders::ALL).title(" Pipelines ");
        f.render_widget(Paragraph::new(msg).block(block), area);
        return;
    }
    let items: Vec<ListItem> = app
        .pipelines
        .pipelines
        .iter()
        .map(|p| {
            let spans = vec![
                glyph(Some(p.status.as_str())),
                Span::raw(" "),
                Span::styled(format!("#{}", p.id), Style::default().fg(Color::Cyan)),
                Span::raw("  "),
                Span::styled(p.status.clone(), Style::default().fg(Color::DarkGray)),
                Span::raw("  "),
                Span::raw(p.ref_name.clone()),
                Span::raw("  "),
                Span::styled(p.sha.clone(), Style::default().fg(Color::DarkGray)),
                Span::raw("  "),
                Span::styled(fmt_duration(p.duration), Style::default().fg(Color::DarkGray)),
            ];
            ListItem::new(Line::from(spans))
        })
        .collect();
    let list = List::new(items)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Pipelines · esc: back "),
        )
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, area, &mut app.pipelines.pipe_state);
}

fn render_jobs(f: &mut Frame, app: &mut App, area: Rect) {
    if app.pipelines.jobs.is_empty() {
        let msg = if app.busy { "Loading…" } else { "No jobs." };
        let block = Block::default().borders(Borders::ALL).title(" Jobs ");
        f.render_widget(Paragraph::new(msg).block(block), area);
        return;
    }
    let items: Vec<ListItem> = app.pipelines.jobs.iter().map(job_line).collect();
    let crumbs: Vec<String> = app
        .pipelines
        .jobs_stack
        .iter()
        .map(|c| c.label.clone())
        .collect();
    let title = if crumbs.len() > 1 {
        format!(" Jobs · {} · p play · R retry · c cancel · esc back ", crumbs.join(" › "))
    } else {
        " Jobs · p play · R retry · c cancel · esc back ".to_string()
    };
    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(title))
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, area, &mut app.pipelines.job_state);
}

/// Render one job row; bridge (trigger) jobs show a `»` marker and their
/// downstream pipeline's status.
pub fn job_line(j: &crate::data::JobRow) -> ListItem<'static> {
    let mut spans = vec![
        glyph(Some(j.status.as_str())),
        Span::raw(" "),
        Span::styled(format!("{:<10}", j.stage), Style::default().fg(Color::DarkGray)),
        Span::raw(" "),
    ];
    if j.is_bridge {
        spans.push(Span::styled("» ", Style::default().fg(Color::Cyan)));
    }
    spans.push(Span::raw(j.name.clone()));
    spans.push(Span::raw("  "));
    spans.push(Span::styled(j.status.clone(), Style::default().fg(Color::DarkGray)));
    if let Some(ds) = &j.downstream {
        let (_, color) = crate::ui::status_style(Some(ds.status.as_str()));
        spans.push(Span::styled(
            format!("  ↓ #{} {}", ds.pipeline_id, ds.status),
            Style::default().fg(color),
        ));
        spans.push(Span::styled(
            "  enter: downstream",
            Style::default().fg(Color::DarkGray),
        ));
    } else if j.is_bridge {
        spans.push(Span::styled(
            "  (trigger · no downstream)",
            Style::default().fg(Color::DarkGray),
        ));
    }
    if j.allow_failure {
        spans.push(Span::styled(
            " (allowed to fail)",
            Style::default().fg(Color::DarkGray),
        ));
    }
    ListItem::new(Line::from(spans))
}

fn render_search(f: &mut Frame, app: &mut App, area: Rect) {
    let Some(search) = app.pipelines.search.as_mut() else { return };
    let w = area.width.saturating_mul(3) / 4;
    let h = (search.results.len() as u16 + 4).clamp(6, area.height.saturating_sub(2));
    let x = area.x + (area.width.saturating_sub(w)) / 2;
    let y = area.y + (area.height.saturating_sub(h)) / 2;
    let popup = Rect { x, y, width: w, height: h };

    f.render_widget(Clear, popup);

    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Length(3), Constraint::Min(0)])
        .split(popup);

    let query_line = Line::from(vec![
        Span::styled("Search: ", Style::default().fg(Color::DarkGray)),
        Span::raw(search.query.clone()),
        Span::styled("▌", Style::default().fg(Color::Cyan)),
    ]);
    f.render_widget(
        Paragraph::new(query_line).block(
            Block::default()
                .borders(Borders::ALL)
                .title(" Add project (enter: search/add · esc: cancel) "),
        ),
        chunks[0],
    );

    let items: Vec<ListItem> = search
        .results
        .iter()
        .map(|h| ListItem::new(Line::from(Span::raw(h.name.clone()))))
        .collect();
    let list = List::new(items)
        .block(Block::default().borders(Borders::ALL).title(" Results "))
        .highlight_style(Style::default().add_modifier(Modifier::REVERSED))
        .highlight_symbol("▌");
    f.render_stateful_widget(list, chunks[1], &mut search.state);
}
