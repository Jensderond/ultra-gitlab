//! MR detail view: header bar, left-hand changed-file list, right-hand
//! unified diff. The diff styling follows Zed's inline diff approach
//! (dual line-number gutter, subtle tinted backgrounds for adds /
//! removes, hunk headers as a separator bar) — see Zed's
//! `crates/editor/src/git/` for reference.
//!
//! Data lives entirely in the local SQLite cache. The view never goes
//! out to the network — if a file's diff_content is NULL (binary, or
//! the row was synced without per-file content), we show a placeholder.

use gpui::{
    div, prelude::FluentBuilder, px, rgb, Context, EventEmitter, Hsla, InteractiveElement,
    IntoElement, MouseButton, ParentElement, Render, SharedString, StatefulInteractiveElement,
    Styled, Window,
};
use gpui_component::{
    button::{Button, ButtonVariants},
    h_flex, v_flex, ActiveTheme, IconName, Sizable,
};

use super::{format_relative_time, NavigateEvent};
use crate::backend::{Backend, DiffFileEntry, MrDetail};
use crate::diff::{parse_unified, DiffHunk, LineKind};

/// Width of each line-number gutter in the diff view.
const GUTTER_WIDTH: f32 = 52.0;

/// Tinted background for added lines. Sampled from Zed's default theme
/// (created_hunk_background) and dimmed for legibility on dark UI.
const ADD_BG: u32 = 0x143b1f;
/// Tinted background for added line number cells (slightly stronger).
const ADD_BG_GUTTER: u32 = 0x1a5028;
/// Tinted background for removed lines.
const REMOVE_BG: u32 = 0x4a1d24;
/// Tinted background for removed line-number cells.
const REMOVE_BG_GUTTER: u32 = 0x6a2730;
/// Background for the `@@ ... @@` hunk header strip.
const HUNK_HEADER_BG: u32 = 0x1f2937;

pub struct MrDetailView {
    backend: Backend,
    mr_id: i64,
    mr: Option<MrDetail>,
    files: Vec<DiffFileEntry>,
    selected_path: Option<String>,
    hunks: Vec<DiffHunk>,
    /// `None` = no file selected; `Some(None)` = file selected but its
    /// diff_content was NULL (binary etc); `Some(Some(_))` = loaded.
    loaded_for_path: Option<String>,
    diff_status: SharedString,
    is_loading: bool,
}

impl EventEmitter<NavigateEvent> for MrDetailView {}

impl MrDetailView {
    pub fn new(backend: Backend, mr_id: i64, cx: &mut Context<Self>) -> Self {
        let mut this = Self {
            backend,
            mr_id,
            mr: None,
            files: Vec::new(),
            selected_path: None,
            hunks: Vec::new(),
            loaded_for_path: None,
            diff_status: "Loading merge request...".into(),
            is_loading: true,
        };
        this.load_detail(cx);
        this
    }

    fn load_detail(&mut self, cx: &mut Context<Self>) {
        let rx = self.backend.load_mr_detail(self.mr_id);
        cx.spawn(async move |this, cx| {
            let bundle = match rx.await {
                Ok(b) => b,
                Err(_) => return,
            };
            this.update(cx, |this, cx| {
                this.mr = bundle.mr;
                this.files = bundle.files;
                this.is_loading = false;
                if this.files.is_empty() {
                    this.diff_status = if this.mr.is_some() {
                        "No diff cached. Run a sync from the MR list and try again.".into()
                    } else {
                        "Merge request not found in cache.".into()
                    };
                } else {
                    let first = this.files[0].new_path.clone();
                    this.select_file(first, cx);
                }
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn select_file(&mut self, path: String, cx: &mut Context<Self>) {
        if self.selected_path.as_deref() == Some(&path) {
            return;
        }
        self.selected_path = Some(path.clone());
        self.hunks.clear();
        self.loaded_for_path = None;
        self.diff_status = "Loading diff...".into();
        cx.notify();

        let rx = self.backend.load_diff_content(self.mr_id, path.clone());
        cx.spawn(async move |this, cx| {
            let content = rx.await.ok().flatten();
            this.update(cx, |this, cx| {
                // Late-arriving selection? Ignore if the user moved on.
                if this.selected_path.as_deref() != Some(&path) {
                    return;
                }
                match content {
                    Some(body) if !body.is_empty() => {
                        this.hunks = parse_unified(&body);
                        this.diff_status = format!("{} hunks", this.hunks.len()).into();
                    }
                    Some(_) => {
                        this.hunks.clear();
                        this.diff_status =
                            "No diff content cached for this file (binary or large file).".into();
                    }
                    None => {
                        this.hunks.clear();
                        this.diff_status = "File not found in cached diff.".into();
                    }
                }
                this.loaded_for_path = Some(path.clone());
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn emit_back(&mut self, cx: &mut Context<Self>) {
        cx.emit(NavigateEvent::Back);
    }

    // ---------- render helpers ----------

    fn render_header(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let (title, subtitle) = match &self.mr {
            Some(mr) => (
                format!("!{} · {}", mr.iid, mr.title),
                format!(
                    "{} · {} → {} · by @{} · updated {}",
                    mr.project_name,
                    mr.source_branch,
                    mr.target_branch,
                    mr.author_username,
                    format_relative_time(mr.updated_at),
                ),
            ),
            None if self.is_loading => ("Loading...".to_string(), String::new()),
            None => ("Not found".to_string(), String::new()),
        };

        let state_badge = self.mr.as_ref().map(|mr| state_badge(&mr.state));

        h_flex()
            .px_4()
            .py_3()
            .gap_3()
            .border_b_1()
            .border_color(theme.border)
            .items_center()
            .child(
                Button::new("back")
                    .ghost()
                    .small()
                    .icon(IconName::ArrowLeft)
                    .label("Back")
                    .on_click(cx.listener(|this, _, _, cx| this.emit_back(cx))),
            )
            .child(
                v_flex()
                    .flex_1()
                    .min_w_0()
                    .child(
                        div()
                            .text_color(theme.foreground)
                            .truncate()
                            .child(title),
                    )
                    .child(
                        div()
                            .text_xs()
                            .text_color(theme.muted_foreground)
                            .truncate()
                            .child(subtitle),
                    ),
            )
            .when_some(state_badge, |this, badge| this.child(badge))
    }

    fn render_file_panel(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        let selected = self.selected_path.clone();

        let header = h_flex()
            .px_3()
            .py_2()
            .gap_2()
            .items_center()
            .justify_between()
            .border_b_1()
            .border_color(theme.border)
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child("Changes"),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(format!("{} files", self.files.len())),
            );

        let list = v_flex().w_full().children(self.files.iter().enumerate().map(
            |(idx, file)| {
                let is_selected = selected.as_deref() == Some(file.new_path.as_str());
                let path = file.new_path.clone();
                let display = file.display_path();
                let badge_color = change_color(&file.change_type);
                let change_letter = change_letter(&file.change_type);
                let additions = file.additions;
                let deletions = file.deletions;
                let row_bg = if is_selected {
                    theme.accent
                } else if idx % 2 == 0 {
                    theme.background
                } else {
                    theme.muted
                };

                h_flex()
                    .id(("file-row", idx))
                    .px_3()
                    .py_1p5()
                    .gap_2()
                    .items_center()
                    .bg(row_bg)
                    .when(is_selected, |this| {
                        this.text_color(theme.accent_foreground)
                    })
                    .hover(|this| this.bg(theme.accent.opacity(0.5)))
                    .on_mouse_down(MouseButton::Left, cx.listener(move |this, _, _, cx| {
                        this.select_file(path.clone(), cx);
                    }))
                    .child(
                        div()
                            .w(px(16.0))
                            .text_xs()
                            .text_color(badge_color)
                            .child(change_letter),
                    )
                    .child(
                        div()
                            .flex_1()
                            .min_w_0()
                            .text_xs()
                            .truncate()
                            .child(display),
                    )
                    .child(
                        h_flex()
                            .flex_none()
                            .gap_1()
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(rgb(0x4ade80))
                                    .child(format!("+{additions}")),
                            )
                            .child(
                                div()
                                    .text_xs()
                                    .text_color(rgb(0xf87171))
                                    .child(format!("-{deletions}")),
                            ),
                    )
            },
        ));

        v_flex()
            .w(px(300.))
            .h_full()
            .flex_none()
            .border_r_1()
            .border_color(theme.border)
            .child(header)
            .child(
                div()
                    .id("file-list-scroll")
                    .flex_1()
                    .overflow_y_scroll()
                    .child(list),
            )
    }

    fn render_diff_panel(&self, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();

        let header = h_flex()
            .px_4()
            .py_2()
            .gap_2()
            .items_center()
            .justify_between()
            .border_b_1()
            .border_color(theme.border)
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .truncate()
                    .child(
                        self.selected_path
                            .clone()
                            .unwrap_or_else(|| "No file selected".into()),
                    ),
            )
            .child(
                div()
                    .text_xs()
                    .text_color(theme.muted_foreground)
                    .child(self.diff_status.clone()),
            );

        let body: gpui::AnyElement = if self.hunks.is_empty() {
            div()
                .size_full()
                .flex()
                .items_center()
                .justify_center()
                .text_color(theme.muted_foreground)
                .text_sm()
                .child(self.diff_status.clone())
                .into_any_element()
        } else {
            v_flex()
                .w_full()
                .children(self.hunks.iter().enumerate().map(|(i, h)| {
                    self.render_hunk(i, h, cx).into_any_element()
                }))
                .into_any_element()
        };

        v_flex()
            .flex_1()
            .min_w_0()
            .h_full()
            .child(header)
            .child(
                div()
                    .id("diff-scroll")
                    .flex_1()
                    .overflow_scroll()
                    .child(body),
            )
    }

    fn render_hunk(
        &self,
        idx: usize,
        hunk: &DiffHunk,
        cx: &mut Context<Self>,
    ) -> impl IntoElement {
        let theme = cx.theme();

        let header = h_flex()
            .id(("hunk-header", idx))
            .w_full()
            .px_2()
            .py_1()
            .bg(rgb(HUNK_HEADER_BG))
            .text_xs()
            .text_color(theme.muted_foreground)
            .font_family("monospace")
            .child(div().w(px(GUTTER_WIDTH * 2.0)).child(""))
            .child(div().child(hunk.header.clone()));

        let lines = hunk.lines.iter().enumerate().map(|(j, line)| {
            let (row_bg, gutter_bg, sign, sign_color): (Hsla, Hsla, &str, Hsla) = match line.kind {
                LineKind::Add => (
                    Hsla::from(rgb(ADD_BG)),
                    Hsla::from(rgb(ADD_BG_GUTTER)),
                    "+",
                    Hsla::from(rgb(0x4ade80)),
                ),
                LineKind::Remove => (
                    Hsla::from(rgb(REMOVE_BG)),
                    Hsla::from(rgb(REMOVE_BG_GUTTER)),
                    "-",
                    Hsla::from(rgb(0xf87171)),
                ),
                LineKind::Context => (
                    theme.background,
                    theme.background,
                    " ",
                    theme.muted_foreground,
                ),
            };

            let old_ln = line
                .old_line
                .map(|n| n.to_string())
                .unwrap_or_default();
            let new_ln = line
                .new_line
                .map(|n| n.to_string())
                .unwrap_or_default();

            h_flex()
                .id(("diff-line", idx * 100_000 + j))
                .w_full()
                .bg(row_bg)
                .text_color(theme.foreground)
                .text_xs()
                .font_family("monospace")
                .child(
                    div()
                        .w(px(GUTTER_WIDTH))
                        .flex_none()
                        .px_2()
                        .text_right()
                        .bg(gutter_bg)
                        .text_color(theme.muted_foreground)
                        .child(old_ln),
                )
                .child(
                    div()
                        .w(px(GUTTER_WIDTH))
                        .flex_none()
                        .px_2()
                        .text_right()
                        .bg(gutter_bg)
                        .text_color(theme.muted_foreground)
                        .child(new_ln),
                )
                .child(
                    div()
                        .w(px(16.0))
                        .flex_none()
                        .text_center()
                        .text_color(sign_color)
                        .child(sign),
                )
                .child(
                    div()
                        .flex_1()
                        .pr_4()
                        .whitespace_nowrap()
                        .child(line.content.clone()),
                )
        });

        v_flex().w_full().child(header).children(lines)
    }
}

impl Render for MrDetailView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        v_flex()
            .size_full()
            .bg(cx.theme().background)
            .child(self.render_header(cx))
            .child(
                h_flex()
                    .flex_1()
                    .min_h_0()
                    .child(self.render_file_panel(cx))
                    .child(self.render_diff_panel(cx)),
            )
    }
}

fn change_color(change_type: &str) -> gpui::Rgba {
    match change_type {
        "added" => rgb(0x4ade80),
        "modified" => rgb(0xfbbf24),
        "deleted" => rgb(0xf87171),
        "renamed" => rgb(0x60a5fa),
        _ => rgb(0x9ca3af),
    }
}

fn change_letter(change_type: &str) -> &'static str {
    match change_type {
        "added" => "A",
        "modified" => "M",
        "deleted" => "D",
        "renamed" => "R",
        _ => "?",
    }
}

fn state_badge(state: &str) -> gpui::AnyElement {
    let (label, fg, bg) = match state {
        "opened" => ("Open", 0xffffff, 0x16a34a),
        "merged" => ("Merged", 0xffffff, 0x7c3aed),
        "closed" => ("Closed", 0xffffff, 0xdc2626),
        other => (other, 0xffffff, 0x6b7280),
    };
    div()
        .px_2()
        .py_0p5()
        .rounded(px(4.0))
        .text_xs()
        .bg(rgb(bg))
        .text_color(rgb(fg))
        .child(SharedString::from(label.to_string()))
        .into_any_element()
}
