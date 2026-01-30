//! Sync action and sync log models.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Type of sync action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ActionType {
    Approve,
    Comment,
    Reply,
    Resolve,
    Unresolve,
}

impl From<&str> for ActionType {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "approve" => Self::Approve,
            "comment" => Self::Comment,
            "reply" => Self::Reply,
            "resolve" => Self::Resolve,
            "unresolve" => Self::Unresolve,
            _ => Self::Comment, // Default fallback
        }
    }
}

impl std::fmt::Display for ActionType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Approve => write!(f, "approve"),
            Self::Comment => write!(f, "comment"),
            Self::Reply => write!(f, "reply"),
            Self::Resolve => write!(f, "resolve"),
            Self::Unresolve => write!(f, "unresolve"),
        }
    }
}

/// Status of a sync action.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SyncStatus {
    Pending,
    Syncing,
    Synced,
    Failed,
    /// Action was discarded because the MR is no longer actionable (merged/closed/deleted).
    Discarded,
}

impl From<&str> for SyncStatus {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "pending" => Self::Pending,
            "syncing" => Self::Syncing,
            "synced" => Self::Synced,
            "failed" => Self::Failed,
            "discarded" => Self::Discarded,
            _ => Self::Pending,
        }
    }
}

impl std::fmt::Display for SyncStatus {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Pending => write!(f, "pending"),
            Self::Syncing => write!(f, "syncing"),
            Self::Synced => write!(f, "synced"),
            Self::Failed => write!(f, "failed"),
            Self::Discarded => write!(f, "discarded"),
        }
    }
}

/// Queued local action pending synchronization to GitLab.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SyncAction {
    /// Local action ID.
    pub id: i64,

    /// Target MR ID.
    pub mr_id: i64,

    /// Type of action: `approve`, `comment`, `reply`, `resolve`, `unresolve`.
    pub action_type: String,

    /// JSON payload for GitLab API.
    pub payload: String,

    /// Local Comment.id for comments (optional).
    pub local_reference_id: Option<i64>,

    /// Status: `pending`, `syncing`, `synced`, `failed`.
    pub status: String,

    /// Number of sync attempts.
    pub retry_count: i64,

    /// Last error message (optional).
    pub last_error: Option<String>,

    /// When action was created locally (Unix).
    pub created_at: i64,

    /// When successfully synced (Unix, optional).
    pub synced_at: Option<i64>,
}

impl SyncAction {
    /// Maximum retry attempts before marking as failed.
    pub const MAX_RETRIES: i64 = 5;

    /// Parse the action type string into an enum.
    pub fn action_type_enum(&self) -> ActionType {
        ActionType::from(self.action_type.as_str())
    }

    /// Parse the status string into an enum.
    pub fn status_enum(&self) -> SyncStatus {
        SyncStatus::from(self.status.as_str())
    }

    /// Check if the action can be retried.
    pub fn can_retry(&self) -> bool {
        self.status_enum() == SyncStatus::Failed && self.retry_count < Self::MAX_RETRIES
    }

    /// Check if the action is pending or in progress.
    pub fn is_pending(&self) -> bool {
        matches!(self.status_enum(), SyncStatus::Pending | SyncStatus::Syncing)
    }
}

/// Status of a sync log entry.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStatus {
    Success,
    Error,
}

impl From<&str> for LogStatus {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "success" => Self::Success,
            _ => Self::Error,
        }
    }
}

/// Log of recent sync operations.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct SyncLog {
    /// Log entry ID.
    pub id: i64,

    /// Operation type: `fetch_mrs`, `fetch_diff`, `push_comment`, etc.
    pub operation: String,

    /// Status: `success`, `error`.
    pub status: String,

    /// Related MR ID (optional).
    pub mr_id: Option<i64>,

    /// Details or error message.
    pub message: Option<String>,

    /// Operation duration in milliseconds.
    pub duration_ms: Option<i64>,

    /// When operation occurred (Unix).
    pub timestamp: i64,
}

impl SyncLog {
    /// Maximum number of log entries to keep.
    pub const MAX_ENTRIES: i64 = 50;

    /// Parse the status string into an enum.
    pub fn status_enum(&self) -> LogStatus {
        LogStatus::from(self.status.as_str())
    }

    /// Check if this log entry represents an error.
    pub fn is_error(&self) -> bool {
        self.status_enum() == LogStatus::Error
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_action_type_from_str() {
        assert_eq!(ActionType::from("approve"), ActionType::Approve);
        assert_eq!(ActionType::from("COMMENT"), ActionType::Comment);
        assert_eq!(ActionType::from("reply"), ActionType::Reply);
        assert_eq!(ActionType::from("resolve"), ActionType::Resolve);
        assert_eq!(ActionType::from("unresolve"), ActionType::Unresolve);
    }

    #[test]
    fn test_sync_status_from_str() {
        assert_eq!(SyncStatus::from("pending"), SyncStatus::Pending);
        assert_eq!(SyncStatus::from("SYNCING"), SyncStatus::Syncing);
        assert_eq!(SyncStatus::from("synced"), SyncStatus::Synced);
        assert_eq!(SyncStatus::from("failed"), SyncStatus::Failed);
        assert_eq!(SyncStatus::from("discarded"), SyncStatus::Discarded);
    }

    #[test]
    fn test_sync_status_display() {
        assert_eq!(SyncStatus::Pending.to_string(), "pending");
        assert_eq!(SyncStatus::Syncing.to_string(), "syncing");
        assert_eq!(SyncStatus::Synced.to_string(), "synced");
        assert_eq!(SyncStatus::Failed.to_string(), "failed");
        assert_eq!(SyncStatus::Discarded.to_string(), "discarded");
    }

    #[test]
    fn test_can_retry() {
        let mut action = SyncAction {
            id: 1,
            mr_id: 1,
            action_type: "comment".to_string(),
            payload: "{}".to_string(),
            local_reference_id: None,
            status: "failed".to_string(),
            retry_count: 0,
            last_error: None,
            created_at: 0,
            synced_at: None,
        };

        assert!(action.can_retry());

        action.retry_count = 5;
        assert!(!action.can_retry());

        action.retry_count = 0;
        action.status = "synced".to_string();
        assert!(!action.can_retry());
    }

    #[test]
    fn test_is_pending() {
        let mut action = SyncAction {
            id: 1,
            mr_id: 1,
            action_type: "approve".to_string(),
            payload: "{}".to_string(),
            local_reference_id: None,
            status: "pending".to_string(),
            retry_count: 0,
            last_error: None,
            created_at: 0,
            synced_at: None,
        };

        assert!(action.is_pending());

        action.status = "syncing".to_string();
        assert!(action.is_pending());

        action.status = "synced".to_string();
        assert!(!action.is_pending());

        action.status = "failed".to_string();
        assert!(!action.is_pending());
    }
}
