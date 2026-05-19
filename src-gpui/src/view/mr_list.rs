//! MR list view. Two-pane layout: instance list on the left, MR table on
//! the right, with a "Refresh" button that drives [`Backend::trigger_sync`].
//!
//! Emits [`NavigateEvent::OpenMr`] when a row is double-clicked or the
//! "Open" cell button is pressed. The parent [`super::AppView`] swaps in
//! the detail view in response.
//!
//! Backend calls return `tokio::sync::oneshot::Receiver`s — the GPUI
//! executor can poll them without a Tokio context because `oneshot`
//! doesn't park on the runtime. Anything heavier (broadcast events from
//! the sync engine) is left as a TODO.

use gpui::{
    div, prelude::FluentBuilder, px, AppContext, Context, Entity, EventEmitter, IntoElement,
    ParentElement, Render, SharedString, Styled, Window,
};
use gpui_component::{
    button::{Button, ButtonVariants},
    h_flex,
    sidebar::{Sidebar, SidebarGroup, SidebarHeader, SidebarMenu, SidebarMenuItem},
    table::{Column, ColumnSort, DataTable, TableDelegate, TableEvent, TableState},
    v_flex, ActiveTheme, Disableable, Icon, IconName, Sizable,
};

use super::{format_relative_time, NavigateEvent};
use crate::backend::{Backend, InstanceRow, MrRow};

pub struct MrListView {
    backend: Backend,
    instances: Vec<InstanceRow>,
    selected_instance: Option<i64>,
    /// Mirror of the delegate rows so the event subscriber can look up
    /// the MR id for a clicked row without going through the delegate.
    row_ids: Vec<i64>,
    mrs: Entity<TableState<MrTableDelegate>>,
    status: SharedString,
    is_syncing: bool,
}

impl EventEmitter<NavigateEvent> for MrListView {}

impl MrListView {
    pub fn new(backend: Backend, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let mrs = cx.new(|cx| {
            TableState::new(MrTableDelegate::new(), window, cx)
                .col_movable(false)
                .col_selectable(false)
        });

        cx.subscribe(&mrs, Self::on_table_event).detach();

        let mut this = Self {
            backend,
            instances: Vec::new(),
            selected_instance: None,
            row_ids: Vec::new(),
            mrs,
            status: "Loading instances...".into(),
            is_syncing: false,
        };
        this.load_instances(cx);
        this
    }

    fn on_table_event(
        &mut self,
        _: Entity<TableState<MrTableDelegate>>,
        event: &TableEvent,
        cx: &mut Context<Self>,
    ) {
        if let TableEvent::DoubleClickedRow(idx) = event {
            if let Some(&mr_id) = self.row_ids.get(*idx) {
                cx.emit(NavigateEvent::OpenMr(mr_id));
            }
        }
    }

    fn load_instances(&mut self, cx: &mut Context<Self>) {
        let rx = self.backend.list_instances();
        cx.spawn(async move |this, cx| {
            let instances = rx.await.unwrap_or_default();
            this.update(cx, |this, cx| {
                this.instances = instances;
                if this.selected_instance.is_none() {
                    let default = this
                        .instances
                        .iter()
                        .find(|i| i.is_default)
                        .or_else(|| this.instances.first())
                        .map(|i| i.id);
                    if let Some(id) = default {
                        this.select_instance(id, cx);
                    } else {
                        this.status = "No GitLab instances configured. Run the Tauri app to set one up.".into();
                        cx.notify();
                    }
                }
            })
            .ok();
        })
        .detach();
    }

    fn select_instance(&mut self, id: i64, cx: &mut Context<Self>) {
        self.selected_instance = Some(id);
        self.status = "Loading merge requests...".into();
        cx.notify();
        self.load_mrs(cx);
    }

    fn load_mrs(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.selected_instance else { return };
        let rx = self.backend.list_mrs(id);
        let table = self.mrs.clone();
        cx.spawn(async move |this, cx| {
            let mrs = rx.await.unwrap_or_default();
            let count = mrs.len();
            let ids: Vec<i64> = mrs.iter().map(|r| r.id).collect();
            let _ = table.update(cx, |state, cx| {
                state.delegate_mut().set_rows(mrs);
                cx.notify();
            });
            this.update(cx, |this, cx| {
                this.row_ids = ids;
                this.status = if count == 0 {
                    "No open MRs in cache. Try Refresh to pull from GitLab.".into()
                } else {
                    format!("{count} open merge requests").into()
                };
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    fn refresh(&mut self, cx: &mut Context<Self>) {
        if self.is_syncing {
            return;
        }
        self.is_syncing = true;
        self.status = "Syncing from GitLab...".into();
        cx.notify();

        let rx = self.backend.trigger_sync();
        cx.spawn(async move |this, cx| {
            let _ = rx.await;
            // The sync engine returns immediately once the request is queued;
            // we wait a beat, then reload from the local cache. A proper
            // implementation would subscribe to mr-updated events.
            cx.background_executor()
                .timer(std::time::Duration::from_secs(2))
                .await;
            this.update(cx, |this, cx| {
                this.is_syncing = false;
                this.load_mrs(cx);
            })
            .ok();
        })
        .detach();
    }
}

impl Render for MrListView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let selected = self.selected_instance;
        let instance_items: Vec<SidebarMenuItem> = self
            .instances
            .iter()
            .map(|inst| {
                let id = inst.id;
                let label: SharedString = inst.name.clone().into();
                SidebarMenuItem::new(label)
                    .icon(IconName::Github)
                    .active(Some(id) == selected)
                    .on_click(cx.listener(move |this, _, _, cx| {
                        this.select_instance(id, cx);
                    }))
            })
            .collect();

        let header_title: SharedString = self
            .selected_instance
            .and_then(|id| self.instances.iter().find(|i| i.id == id))
            .map(|i| i.name.clone().into())
            .unwrap_or_else(|| "Ultra GitLab".into());

        h_flex()
            .size_full()
            .bg(cx.theme().background)
            .child(
                Sidebar::new("ultra-gitlab-sidebar")
                    .w(px(240.))
                    .header(
                        SidebarHeader::new()
                            .child(
                                div()
                                    .flex()
                                    .items_center()
                                    .justify_center()
                                    .size_8()
                                    .flex_shrink_0()
                                    .rounded(cx.theme().radius)
                                    .bg(cx.theme().sidebar_primary)
                                    .text_color(cx.theme().sidebar_primary_foreground)
                                    .child(Icon::new(IconName::GalleryVerticalEnd)),
                            )
                            .child(
                                v_flex()
                                    .flex_1()
                                    .overflow_hidden()
                                    .child("Ultra GitLab")
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(cx.theme().muted_foreground)
                                            .child("GPUI experiment"),
                                    ),
                            ),
                    )
                    .child(SidebarGroup::new("Instances").child(SidebarMenu::new().children(instance_items))),
            )
            .child(
                v_flex()
                    .h_full()
                    .flex_1()
                    .min_w_0()
                    .child(
                        h_flex()
                            .px_4()
                            .py_3()
                            .border_b_1()
                            .border_color(cx.theme().border)
                            .items_center()
                            .justify_between()
                            .child(
                                v_flex()
                                    .child(
                                        div()
                                            .text_color(cx.theme().foreground)
                                            .child(header_title),
                                    )
                                    .child(
                                        div()
                                            .text_xs()
                                            .text_color(cx.theme().muted_foreground)
                                            .child(self.status.clone()),
                                    ),
                            )
                            .child(
                                Button::new("refresh")
                                    .primary()
                                    .small()
                                    .label(if self.is_syncing { "Syncing..." } else { "Refresh" })
                                    .when(self.is_syncing, |b| b.disabled(true))
                                    .on_click(cx.listener(|this, _, _, cx| this.refresh(cx))),
                            ),
                    )
                    .child(
                        div()
                            .size_full()
                            .child(DataTable::new(&self.mrs).bordered(false).stripe(true)),
                    ),
            )
    }
}

// ---------- table delegate ----------

struct MrTableDelegate {
    rows: Vec<MrRow>,
    columns: Vec<Column>,
}

impl MrTableDelegate {
    fn new() -> Self {
        Self {
            rows: Vec::new(),
            columns: vec![
                Column::new("iid", "IID").width(70.).sortable(),
                Column::new("title", "Title").width(440.).sortable(),
                Column::new("project", "Project").width(220.).sortable(),
                Column::new("author", "Author").width(140.).sortable(),
                Column::new("branch", "Source → Target").width(260.),
                Column::new("updated", "Updated")
                    .width(140.)
                    .sortable()
                    .sort(ColumnSort::Descending),
            ],
        }
    }

    fn set_rows(&mut self, rows: Vec<MrRow>) {
        self.rows = rows;
    }
}

impl TableDelegate for MrTableDelegate {
    fn columns_count(&self, _cx: &gpui::App) -> usize {
        self.columns.len()
    }

    fn rows_count(&self, _cx: &gpui::App) -> usize {
        self.rows.len()
    }

    fn column(&self, col_ix: usize, _cx: &gpui::App) -> Column {
        self.columns[col_ix].clone()
    }

    fn render_td(
        &mut self,
        row_ix: usize,
        col_ix: usize,
        _window: &mut Window,
        cx: &mut Context<TableState<Self>>,
    ) -> impl IntoElement {
        let Some(mr) = self.rows.get(row_ix) else {
            return div().into_any_element();
        };

        let theme = cx.theme();
        match col_ix {
            0 => div()
                .text_xs()
                .text_color(theme.muted_foreground)
                .child(format!("!{}", mr.iid))
                .into_any_element(),
            1 => div()
                .text_sm()
                .text_color(theme.foreground)
                .truncate()
                .child(mr.title.clone())
                .into_any_element(),
            2 => div()
                .text_xs()
                .text_color(theme.muted_foreground)
                .truncate()
                .child(mr.project_name.clone())
                .into_any_element(),
            3 => div()
                .text_xs()
                .text_color(theme.muted_foreground)
                .child(mr.author_username.clone())
                .into_any_element(),
            4 => div()
                .text_xs()
                .text_color(theme.muted_foreground)
                .truncate()
                .child(format!("{} → {}", mr.source_branch, mr.target_branch))
                .into_any_element(),
            5 => div()
                .text_xs()
                .text_color(theme.muted_foreground)
                .child(format_relative_time(mr.updated_at))
                .into_any_element(),
            _ => div().into_any_element(),
        }
    }

    fn perform_sort(
        &mut self,
        col_ix: usize,
        sort: ColumnSort,
        _window: &mut Window,
        _cx: &mut Context<TableState<Self>>,
    ) {
        let descending = matches!(sort, ColumnSort::Descending);
        match col_ix {
            0 => self.rows.sort_by_key(|r| r.iid),
            1 => self.rows.sort_by(|a, b| a.title.cmp(&b.title)),
            2 => self.rows.sort_by(|a, b| a.project_name.cmp(&b.project_name)),
            3 => self.rows.sort_by(|a, b| a.author_username.cmp(&b.author_username)),
            5 => self.rows.sort_by_key(|r| r.updated_at),
            _ => {}
        }
        if descending {
            self.rows.reverse();
        }
    }
}
