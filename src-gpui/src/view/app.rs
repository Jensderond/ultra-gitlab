//! Root view that swaps between [`MrListView`] and [`MrDetailView`] in
//! response to [`NavigateEvent`]s.
//!
//! GPUI doesn't have a router primitive — composition is by holding an
//! `Entity<T>` per route. We keep the list entity alive across detail
//! visits so re-opening the list is instant and preserves scroll/sort.

use gpui::{div, AppContext, Context, Entity, IntoElement, ParentElement, Render, Styled, Window};
use gpui_component::ActiveTheme;

use super::{MrDetailView, MrListView, NavigateEvent};
use crate::backend::Backend;

enum Screen {
    List,
    Detail(Entity<MrDetailView>),
}

pub struct AppView {
    backend: Backend,
    list: Entity<MrListView>,
    screen: Screen,
}

impl AppView {
    pub fn new(backend: Backend, window: &mut Window, cx: &mut Context<Self>) -> Self {
        let list = cx.new(|cx| MrListView::new(backend.clone(), window, cx));
        cx.subscribe(&list, Self::on_navigate).detach();
        Self {
            backend,
            list,
            screen: Screen::List,
        }
    }

    fn on_navigate(
        &mut self,
        _: Entity<MrListView>,
        event: &NavigateEvent,
        cx: &mut Context<Self>,
    ) {
        match event {
            NavigateEvent::OpenMr(id) => self.open_detail(*id, cx),
            NavigateEvent::Back => self.screen = Screen::List,
        }
        cx.notify();
    }

    fn on_detail_navigate(
        &mut self,
        _: Entity<MrDetailView>,
        event: &NavigateEvent,
        cx: &mut Context<Self>,
    ) {
        if matches!(event, NavigateEvent::Back) {
            self.screen = Screen::List;
            cx.notify();
        }
    }

    fn open_detail(&mut self, mr_id: i64, cx: &mut Context<Self>) {
        let backend = self.backend.clone();
        let detail = cx.new(|cx| MrDetailView::new(backend, mr_id, cx));
        cx.subscribe(&detail, Self::on_detail_navigate).detach();
        self.screen = Screen::Detail(detail);
    }
}

impl Render for AppView {
    fn render(&mut self, _: &mut Window, cx: &mut Context<Self>) -> impl IntoElement {
        let theme = cx.theme();
        div()
            .size_full()
            .bg(theme.background)
            .text_color(theme.foreground)
            .child(match &self.screen {
                Screen::List => self.list.clone().into_any_element(),
                Screen::Detail(d) => d.clone().into_any_element(),
            })
    }
}
