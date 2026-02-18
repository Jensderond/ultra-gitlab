//! MR reviewer model for per-reviewer approval status.

use serde::Serialize;
use sqlx::FromRow;

/// Per-reviewer approval status for a merge request.
#[derive(Debug, Clone, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct MrReviewer {
    pub mr_id: i64,
    pub username: String,
    /// Status: "approved", "pending", or "changes_requested".
    pub status: String,
    pub cached_at: i64,
}
