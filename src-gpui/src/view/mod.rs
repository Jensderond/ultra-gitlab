//! Top-level UI module for the GPUI frontend.
//!
//! - [`AppView`] is the root view shown inside the window's `Root`. It
//!   owns whichever child view is currently routed to (list or detail)
//!   and listens for [`NavigateEvent`]s from those children.
//! - [`MrListView`] is the open-MR table.
//! - [`MrDetailView`] is the MR detail + diff view.

mod app;
mod mr_detail;
mod mr_list;

use chrono::TimeZone;
use gpui::actions;

pub use app::AppView;
pub use mr_detail::MrDetailView;
pub use mr_list::MrListView;

actions!(ultra_gitlab_gpui, [Quit]);

/// Cross-view navigation signal. Children emit; [`AppView`] listens.
#[derive(Debug, Clone, Copy)]
pub enum NavigateEvent {
    OpenMr(i64),
    Back,
}

/// Compact relative time formatter shared by the list and detail views.
pub fn format_relative_time(ts: i64) -> String {
    let Some(then) = chrono::Utc.timestamp_opt(ts, 0).single() else {
        return String::new();
    };
    let now = chrono::Utc::now();
    let delta = now.signed_duration_since(then);

    if delta.num_seconds() < 60 {
        "just now".into()
    } else if delta.num_minutes() < 60 {
        format!("{}m ago", delta.num_minutes())
    } else if delta.num_hours() < 24 {
        format!("{}h ago", delta.num_hours())
    } else if delta.num_days() < 30 {
        format!("{}d ago", delta.num_days())
    } else {
        then.format("%Y-%m-%d").to_string()
    }
}
