//! Merge request model.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// State of a merge request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MergeRequestState {
    Opened,
    Merged,
    Closed,
}

impl From<&str> for MergeRequestState {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "merged" => Self::Merged,
            "closed" => Self::Closed,
            _ => Self::Opened,
        }
    }
}

impl std::fmt::Display for MergeRequestState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Opened => write!(f, "opened"),
            Self::Merged => write!(f, "merged"),
            Self::Closed => write!(f, "closed"),
        }
    }
}

/// Approval status of a merge request.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ApprovalStatus {
    Approved,
    Pending,
    ChangesRequested,
}

impl From<&str> for ApprovalStatus {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "approved" => Self::Approved,
            "changes_requested" => Self::ChangesRequested,
            _ => Self::Pending,
        }
    }
}

/// Represents a GitLab merge request with metadata.
///
/// Note: `labels` and `reviewers` are stored as JSON strings in SQLite
/// but deserialized to Vec<String> for use.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct MergeRequest {
    /// GitLab MR ID (global).
    pub id: i64,

    /// Parent GitLab instance ID.
    pub instance_id: i64,

    /// Project-scoped MR number.
    pub iid: i64,

    /// GitLab project ID.
    pub project_id: i64,

    /// Project path with namespace (e.g., "group/project").
    #[sqlx(default)]
    pub project_name: String,

    /// MR title.
    pub title: String,

    /// MR description (Markdown).
    pub description: Option<String>,

    /// Author's GitLab username.
    pub author_username: String,

    /// Branch being merged.
    pub source_branch: String,

    /// Destination branch.
    pub target_branch: String,

    /// Current state: `opened`, `merged`, `closed`.
    pub state: String,

    /// URL to MR in GitLab web UI.
    pub web_url: String,

    /// MR creation timestamp (Unix).
    pub created_at: i64,

    /// MR last update timestamp (Unix).
    pub updated_at: i64,

    /// Merge timestamp (Unix, if merged).
    pub merged_at: Option<i64>,

    /// Approval status: `approved`, `pending`, `changes_requested`.
    pub approval_status: Option<String>,

    /// Number of approvals needed.
    pub approvals_required: Option<i64>,

    /// Current approval count.
    pub approvals_count: Option<i64>,

    /// JSON array of labels.
    pub labels: String,

    /// JSON array of reviewer usernames.
    pub reviewers: String,

    /// When this data was cached locally (Unix).
    pub cached_at: i64,

    /// Whether the current user has approved this MR.
    #[sqlx(default)]
    pub user_has_approved: bool,
}

impl MergeRequest {
    /// Parse the state string into an enum.
    pub fn state_enum(&self) -> MergeRequestState {
        MergeRequestState::from(self.state.as_str())
    }

    /// Parse the approval status string into an enum.
    pub fn approval_status_enum(&self) -> Option<ApprovalStatus> {
        self.approval_status.as_ref().map(|s| ApprovalStatus::from(s.as_str()))
    }

    /// Parse labels from JSON string.
    pub fn labels_vec(&self) -> Vec<String> {
        serde_json::from_str(&self.labels).unwrap_or_default()
    }

    /// Parse reviewers from JSON string.
    pub fn reviewers_vec(&self) -> Vec<String> {
        serde_json::from_str(&self.reviewers).unwrap_or_default()
    }

    /// Check if the MR is open.
    pub fn is_open(&self) -> bool {
        self.state_enum() == MergeRequestState::Opened
    }

    /// Check if the MR is approved.
    pub fn is_approved(&self) -> bool {
        self.approval_status_enum() == Some(ApprovalStatus::Approved)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_state_from_str() {
        assert_eq!(MergeRequestState::from("opened"), MergeRequestState::Opened);
        assert_eq!(MergeRequestState::from("MERGED"), MergeRequestState::Merged);
        assert_eq!(MergeRequestState::from("Closed"), MergeRequestState::Closed);
        assert_eq!(MergeRequestState::from("unknown"), MergeRequestState::Opened);
    }

    #[test]
    fn test_state_display() {
        assert_eq!(MergeRequestState::Opened.to_string(), "opened");
        assert_eq!(MergeRequestState::Merged.to_string(), "merged");
        assert_eq!(MergeRequestState::Closed.to_string(), "closed");
    }
}
