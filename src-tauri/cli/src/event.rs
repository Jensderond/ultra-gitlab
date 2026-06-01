//! Async results delivered to the UI loop over an mpsc channel.

use crate::data::{DetailData, MrRow};

/// A message produced by a background task and consumed by the event loop.
#[derive(Debug)]
pub enum AppEvent {
    Review(Result<Vec<MrRow>, String>),
    Mine(Result<Vec<MrRow>, String>),
    Detail(Result<DetailData, String>),
    /// (verb, result) for an action like "merge", "approve".
    ActionDone(String, Result<String, String>),
}
