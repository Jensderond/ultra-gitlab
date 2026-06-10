//! Bottom status/hint bar.

use crate::app::{App, Focus, Screen, Tab};
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

pub fn render(f: &mut Frame, app: &App, area: Rect) {
    let hints = match app.screen {
        Screen::List => match app.tab {
            Tab::Review | Tab::Mine => "1/2/3 tabs · enter open · o browser · r refresh · ? help · esc quit",
            Tab::Pipelines => match app.pipelines.view {
                crate::pipelines::PipeView::Projects => {
                    "1/2/3 tabs · enter open · n add · o browser · ? help · esc quit"
                }
                crate::pipelines::PipeView::Pipelines => {
                    "enter jobs · c cancel · o browser · ? help · esc back"
                }
                crate::pipelines::PipeView::Jobs => {
                    "p play · R retry · c cancel · o browser · ? help · esc back"
                }
            },
        },
        Screen::Detail => {
            // When the pipelines panel is focused, show its keys instead of the
            // file/diff hints so the panel's actions are discoverable.
            if app.focus == Focus::Pipeline {
                if app.detail_pipes.jobs.is_some() {
                    "p play · R retry · c cancel · o browser · ? help · esc back"
                } else {
                    "Tab focus · enter jobs · o browser · ? help · esc back"
                }
            } else {
                match app.tab {
                    Tab::Review => "a approve · c comment · v select · s suggest · C threads · o browser · ? help · esc back",
                    Tab::Mine => "R rebase · M merge · c comment · v select · s suggest · C threads · o browser · ? help · esc back",
                    Tab::Pipelines => "? help · esc back",
                }
            }
        }
    };
    let line = if let Some(confirm) = &app.confirm {
        format!(" {}", confirm.prompt)
    } else if let Some(c) = &app.pipelines.confirm {
        format!(" {}", c.prompt)
    } else {
        let spinner = if app.busy { "⏳ " } else { "" };
        format!(" {spinner}{}  |  {hints}", app.status)
    };
    f.render_widget(
        Paragraph::new(line).style(Style::default().fg(Color::Gray)),
        area,
    );
}
