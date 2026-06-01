//! Action dispatch (approve / rebase / merge / undraft / auto-merge).
//! Fleshed out in Phase 8; placeholders keep the event loop compiling.

use crate::app::App;
use crossterm::event::KeyCode;

/// Handle an action key on the detail screen. No-op until Phase 8.
pub fn handle_action_key(_app: &mut App, _code: KeyCode) {}

/// Run a confirmed action. No-op until Phase 8.
pub fn dispatch(_app: &mut App, _verb: &str, _mr_id: i64) {}
