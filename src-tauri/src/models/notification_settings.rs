//! Notification settings model.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Notification preferences stored in the local SQLite database.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct NotificationSettings {
    /// Notify when an authored MR has all approvals and pipeline passed.
    pub mr_ready_to_merge: bool,

    /// Notify when a pinned project's pipeline status changes.
    pub pipeline_status_pinned: bool,

    /// Whether to show native OS notifications.
    pub native_notifications_enabled: bool,
}
