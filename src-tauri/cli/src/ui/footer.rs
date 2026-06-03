//! Bottom status/hint bar.

use crate::app::{App, Focus, Screen, Tab};
use ratatui::layout::Rect;
use ratatui::style::{Color, Style};
use ratatui::widgets::Paragraph;
use ratatui::Frame;

pub fn render(f: &mut Frame, app: &App, area: Rect) {
    let hints = match app.screen {
        Screen::List => match app.tab {
            Tab::Review | Tab::Mine => "1/2/3 tabs · j/k move · enter open · r refresh · q quit",
            Tab::Pipelines => match app.pipelines.view {
                crate::pipelines::PipeView::Projects => {
                    "1/2/3 tabs · j/k · enter open · p pin · x remove · n add · o browser · r refresh · q quit"
                }
                crate::pipelines::PipeView::Pipelines => {
                    "j/k · enter jobs · c cancel · o browser · esc back · q quit"
                }
                crate::pipelines::PipeView::Jobs => {
                    "j/k · p play · R retry · c cancel · o browser · esc back · q quit"
                }
            },
        },
        Screen::Detail => {
            // When the pipelines panel is focused, show its keys instead of the
            // file/diff hints so the panel's actions are discoverable.
            if app.focus == Focus::Pipeline {
                if app.detail_pipes.jobs.is_some() {
                    "j/k · p play · R retry · c cancel · o browser · esc back"
                } else {
                    "Tab focus · j/k · enter jobs · o browser · esc back"
                }
            } else {
                match app.tab {
                    Tab::Review => "Tab/→/← focus · j/k scroll · V viewed · a approve/unapprove · esc back",
                    Tab::Mine => "Tab/→/← focus · j/k scroll · V viewed · R rebase · M merge · U undraft · A auto-merge · esc back",
                    Tab::Pipelines => "esc back",
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
