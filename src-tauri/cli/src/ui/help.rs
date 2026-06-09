//! The `?` keybinding-help overlay: a centered popup listing all bindings for
//! the current screen, so the footer can stay short.

use crate::app::{App, Screen, Tab};
use ratatui::layout::Rect;
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::{Line, Span};
use ratatui::widgets::{Block, Borders, Clear, Paragraph};
use ratatui::Frame;

/// One section: a heading plus `(keys, description)` rows.
type Section = (&'static str, &'static [(&'static str, &'static str)]);

const LIST_SECTIONS: &[Section] = &[
    ("Global", &[
        ("1 / 2 / 3", "switch tab"),
        ("tab", "cycle tabs"),
        ("q", "quit"),
    ]),
    ("Merge requests", &[
        ("j / k, ↓ / ↑", "move selection"),
        ("enter", "open MR"),
        ("o", "open MR in browser"),
        ("r", "refresh"),
    ]),
];

const PIPELINES_SECTIONS: &[Section] = &[
    ("Global", &[
        ("1 / 2 / 3", "switch tab"),
        ("tab", "cycle tabs"),
        ("q", "quit (projects) / back (drill-down)"),
    ]),
    ("Projects", &[
        ("j / k, ↓ / ↑", "move selection"),
        ("enter", "open project's pipelines"),
        ("n", "add a project"),
        ("p", "pin / unpin"),
        ("x", "remove project"),
        ("o", "open in browser"),
        ("r", "refresh"),
    ]),
    ("Pipelines", &[
        ("enter", "open jobs"),
        ("c", "cancel pipeline"),
        ("o", "open in browser"),
        ("q / esc", "back to projects"),
    ]),
    ("Jobs", &[
        ("p", "play manual job"),
        ("R", "retry job"),
        ("c", "cancel job"),
        ("o", "open in browser"),
        ("q / esc", "back to pipelines"),
    ]),
];

const DETAIL_COMMON: &[Section] = &[
    ("Navigation", &[
        ("tab", "cycle focus: files → diff → pipelines"),
        ("h / l, ← / →", "focus files / diff; pan the diff"),
        ("j / k, ↓ / ↑", "move file / diff cursor"),
        ("PgUp / PgDn", "page the diff"),
        ("home", "reset diff panning"),
        ("q / esc", "back"),
    ]),
    ("Files & diff", &[
        ("g", "show / hide ignored files"),
        ("o", "open MR in browser"),
        ("v / V", "select a line range (vim visual)"),
        ("c", "comment: general on files, inline on diff"),
        ("s", "suggestion on cursor line / selection"),
        ("C", "discussions overlay"),
    ]),
    ("Discussions overlay", &[
        ("j / k", "move between threads"),
        ("r", "reply to thread"),
        ("R", "resolve / unresolve"),
        ("o", "open MR in browser"),
        ("esc", "close"),
    ]),
    ("Pipelines panel", &[
        ("enter", "open jobs"),
        ("p", "play manual job"),
        ("R", "retry job"),
        ("c", "cancel"),
        ("o", "open in browser"),
        ("esc", "back / close jobs"),
    ]),
];

const REVIEW_ACTIONS: Section = ("Review actions", &[
    ("a", "approve / unapprove"),
]);

const MINE_ACTIONS: Section = ("Mine actions", &[
    ("R", "rebase"),
    ("M", "merge (confirm with y)"),
    ("U", "mark ready (undraft)"),
    ("A", "toggle auto-merge claim"),
]);

/// Sections for the current screen/tab.
fn sections(app: &App) -> Vec<Section> {
    match app.screen {
        Screen::List => match app.tab {
            Tab::Pipelines => PIPELINES_SECTIONS.to_vec(),
            _ => LIST_SECTIONS.to_vec(),
        },
        Screen::Detail => {
            let mut out = DETAIL_COMMON.to_vec();
            let actions = match app.tab {
                Tab::Mine => MINE_ACTIONS,
                _ => REVIEW_ACTIONS,
            };
            // Actions belong right after the files & diff keys.
            out.insert(2, actions);
            out
        }
    }
}

pub fn render(f: &mut Frame, app: &App, area: Rect) {
    let key_style = Style::default().fg(Color::Cyan);
    let head_style = Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD);

    let mut lines: Vec<Line> = Vec::new();
    for (i, (heading, rows)) in sections(app).into_iter().enumerate() {
        if i > 0 {
            lines.push(Line::from(""));
        }
        lines.push(Line::from(Span::styled(heading, head_style)));
        for (keys, desc) in rows {
            lines.push(Line::from(vec![
                Span::styled(format!("  {keys:<16}"), key_style),
                Span::raw(*desc),
            ]));
        }
    }

    let w = 64u16.min(area.width.saturating_sub(4));
    let h = (lines.len() as u16 + 2).min(area.height.saturating_sub(2));
    let x = area.x + (area.width.saturating_sub(w)) / 2;
    let y = area.y + (area.height.saturating_sub(h)) / 2;
    let popup = Rect { x, y, width: w, height: h };
    let block = Block::default()
        .borders(Borders::ALL)
        .title(" Keys ")
        .title_bottom(" ?/esc close ")
        .border_style(Style::default().fg(Color::Cyan));
    f.render_widget(Clear, popup);
    f.render_widget(Paragraph::new(lines).block(block), popup);
}
