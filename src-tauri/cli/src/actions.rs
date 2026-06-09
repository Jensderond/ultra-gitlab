//! Action dispatch on the detail screen.
//!
//! Review tab: `a` approve / unapprove (toggles on the row's current state).
//! Mine tab:   `R` rebase, `M` merge (confirmed), `U` undraft,
//!             `A` toggle the auto-merge claim.
//! All actions run as background tasks; results arrive via AppEvent::ActionDone.

use crate::app::{App, Confirm, Focus, Screen, Tab};
use crate::event::AppEvent;
use crossterm::event::KeyCode;
use std::sync::Arc;
use ultra_gitlab_lib::core::mr_actions;
use ultra_gitlab_lib::db::auto_merge;
use ultra_gitlab_lib::db::pool::DbPool;

/// Current MR id on the detail screen, if any.
fn current_mr(app: &App) -> Option<i64> {
    app.detail.as_ref().map(|d| d.row.id)
}

pub fn handle_action_key(app: &mut App, code: KeyCode) {
    let Some(mr_id) = current_mr(app) else { return };
    match (app.tab, code) {
        (Tab::Review, KeyCode::Char('a')) => {
            let approved = app.detail.as_ref().map(|d| d.row.user_has_approved).unwrap_or(false);
            if approved {
                dispatch(app, "unapprove", mr_id);
            } else {
                approve_optimistic(app, mr_id);
            }
        }
        (Tab::Mine, KeyCode::Char('R')) => dispatch(app, "rebase", mr_id),
        (Tab::Mine, KeyCode::Char('U')) => dispatch(app, "undraft", mr_id),
        (Tab::Mine, KeyCode::Char('A')) => {
            // Toggle on the claim state the detail loaded. Flip the header
            // indicator right away; the list reload on ActionDone reconciles,
            // and a failure rolls the flag back (see handle_event).
            let claimed = app.detail.as_ref().map(|d| d.row.auto_merge).unwrap_or(false);
            if let Some(d) = app.detail.as_mut() {
                d.row.auto_merge = !claimed;
            }
            let verb = if claimed { "cancel auto-merge" } else { "auto-merge" };
            dispatch(app, verb, mr_id);
        }
        (Tab::Mine, KeyCode::Char('M')) => {
            let prompt = app
                .detail
                .as_ref()
                .map(|d| format!("Merge !{} into {} now?", d.row.iid, d.row.target_branch))
                .unwrap_or_else(|| "Merge this MR now?".into());
            app.confirm = Some(Confirm { verb: "merge".into(), mr_id, prompt });
        }
        _ => {}
    }
}

/// Approve instantly: drop the MR from the review list and return to it right
/// away, then fire the GitLab request + DB write in the background. The list
/// reload on `ActionDone` reconciles with the server; a failure restores the row.
fn approve_optimistic(app: &mut App, mr_id: i64) {
    app.review.retain(|r| r.id != mr_id);
    app.screen = Screen::List;
    app.focus = Focus::Tree;
    app.detail = None;
    app.force_clear = true;
    // Keep the selection within the (now shorter) list.
    if app.review.is_empty() {
        app.list_state.select(None);
    } else {
        let sel = app.list_state.selected().unwrap_or(0).min(app.review.len() - 1);
        app.list_state.select(Some(sel));
    }
    dispatch(app, "approve", mr_id);
    app.status = "Approved · syncing…".into();
}

/// Spawn the background task for a confirmed/triggered action.
pub fn dispatch(app: &mut App, verb: &str, mr_id: i64) {
    app.busy = true;
    app.status = format!("{verb}…");
    let pool = app.pool.clone();
    let tx = app.tx.clone();
    let verb = verb.to_string();
    tokio::spawn(async move {
        let result = run(&pool, &verb, mr_id).await;
        let _ = tx.send(AppEvent::ActionDone(verb, result));
    });
}

async fn run(pool: &Arc<DbPool>, verb: &str, mr_id: i64) -> Result<String, String> {
    let pool = pool.as_ref();
    match verb {
        "approve" => mr_actions::approve(pool, mr_id).await.map(|_| "approved".to_string()).map_err(|e| e.to_string()),
        "unapprove" => mr_actions::unapprove(pool, mr_id).await.map(|_| "unapproved".to_string()).map_err(|e| e.to_string()),
        "rebase" => mr_actions::rebase(pool, mr_id).await.map(|_| "rebase requested".to_string()).map_err(|e| e.to_string()),
        "merge" => mr_actions::merge(pool, mr_id).await.map(|_| "merged".to_string()).map_err(|e| e.to_string()),
        "undraft" => mr_actions::undraft(pool, mr_id).await.map(|t| format!("ready: {t}")).map_err(|e| e.to_string()),
        "auto-merge" => {
            let now = chrono::Utc::now().timestamp();
            auto_merge::upsert_claim(pool, mr_id, now).await
                .map(|_| "auto-merge claimed (desktop will process)".to_string())
                .map_err(|e| e.to_string())
        }
        "cancel auto-merge" => {
            auto_merge::delete_claim(pool, mr_id).await
                .map(|_| "auto-merge claim removed".to_string())
                .map_err(|e| e.to_string())
        }
        other => Err(format!("unknown action {other}")),
    }
}
