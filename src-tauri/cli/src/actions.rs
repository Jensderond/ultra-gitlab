//! Action dispatch on the detail screen.
//!
//! Review tab: `a` approve / unapprove (toggles on the row's current state).
//! Mine tab:   `R` rebase, `M` merge (confirmed), `U` undraft, `A` auto-merge.
//! All actions run as background tasks; results arrive via AppEvent::ActionDone.

use crate::app::{App, Confirm, Tab};
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
            dispatch(app, if approved { "unapprove" } else { "approve" }, mr_id);
        }
        (Tab::Mine, KeyCode::Char('R')) => dispatch(app, "rebase", mr_id),
        (Tab::Mine, KeyCode::Char('U')) => dispatch(app, "undraft", mr_id),
        (Tab::Mine, KeyCode::Char('A')) => dispatch(app, "auto-merge", mr_id),
        (Tab::Mine, KeyCode::Char('M')) => {
            app.confirm = Some(Confirm {
                verb: "merge".into(),
                mr_id,
                prompt: "Merge this MR now? (y/N)".into(),
            });
            app.status = "Merge this MR now? Press y to confirm.".into();
        }
        _ => {}
    }
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
        other => Err(format!("unknown action {other}")),
    }
}
