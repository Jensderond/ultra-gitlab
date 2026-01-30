//! Diff and DiffFile models.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Stores the complete diff content for an MR.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Diff {
    /// Parent MR ID.
    pub mr_id: i64,

    /// Complete unified diff text.
    pub content: String,

    /// Base commit SHA.
    pub base_sha: String,

    /// Head commit SHA.
    pub head_sha: String,

    /// Start commit SHA.
    pub start_sha: String,

    /// Number of changed files.
    pub file_count: i64,

    /// Total lines added.
    pub additions: i64,

    /// Total lines deleted.
    pub deletions: i64,

    /// Cache timestamp (Unix).
    pub cached_at: i64,
}

/// Type of file change.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ChangeType {
    Added,
    Modified,
    Deleted,
    Renamed,
}

impl From<&str> for ChangeType {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "added" => Self::Added,
            "deleted" => Self::Deleted,
            "renamed" => Self::Renamed,
            _ => Self::Modified,
        }
    }
}

impl std::fmt::Display for ChangeType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Added => write!(f, "added"),
            Self::Modified => write!(f, "modified"),
            Self::Deleted => write!(f, "deleted"),
            Self::Renamed => write!(f, "renamed"),
        }
    }
}

/// Individual file change within an MR (for navigation).
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct DiffFile {
    /// Local ID.
    pub id: i64,

    /// Parent MR ID.
    pub mr_id: i64,

    /// Previous file path (for renames/deletes).
    pub old_path: Option<String>,

    /// Current file path.
    pub new_path: String,

    /// Type of change: `added`, `modified`, `deleted`, `renamed`.
    pub change_type: String,

    /// Lines added in this file.
    pub additions: i64,

    /// Lines deleted in this file.
    pub deletions: i64,

    /// Order in diff for navigation.
    pub file_position: i64,

    /// Per-file unified diff content.
    pub diff_content: Option<String>,
}

impl DiffFile {
    /// Parse the change type string into an enum.
    pub fn change_type_enum(&self) -> ChangeType {
        ChangeType::from(self.change_type.as_str())
    }

    /// Get the display path for the file.
    ///
    /// For renamed files, shows "old_path → new_path".
    pub fn display_path(&self) -> String {
        if let (Some(old), ChangeType::Renamed) = (&self.old_path, self.change_type_enum()) {
            format!("{} → {}", old, self.new_path)
        } else {
            self.new_path.clone()
        }
    }

    /// Get the file extension from the new path.
    pub fn extension(&self) -> Option<&str> {
        self.new_path.rsplit('.').next()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_change_type_from_str() {
        assert_eq!(ChangeType::from("added"), ChangeType::Added);
        assert_eq!(ChangeType::from("MODIFIED"), ChangeType::Modified);
        assert_eq!(ChangeType::from("deleted"), ChangeType::Deleted);
        assert_eq!(ChangeType::from("Renamed"), ChangeType::Renamed);
        assert_eq!(ChangeType::from("unknown"), ChangeType::Modified);
    }

    #[test]
    fn test_display_path_renamed() {
        let file = DiffFile {
            id: 1,
            mr_id: 1,
            old_path: Some("old/file.rs".to_string()),
            new_path: "new/file.rs".to_string(),
            change_type: "renamed".to_string(),
            additions: 0,
            deletions: 0,
            file_position: 0,
            diff_content: None,
        };
        assert_eq!(file.display_path(), "old/file.rs → new/file.rs");
    }

    #[test]
    fn test_display_path_not_renamed() {
        let file = DiffFile {
            id: 1,
            mr_id: 1,
            old_path: None,
            new_path: "src/main.rs".to_string(),
            change_type: "modified".to_string(),
            additions: 5,
            deletions: 2,
            file_position: 0,
            diff_content: None,
        };
        assert_eq!(file.display_path(), "src/main.rs");
    }

    #[test]
    fn test_extension() {
        let file = DiffFile {
            id: 1,
            mr_id: 1,
            old_path: None,
            new_path: "src/main.rs".to_string(),
            change_type: "modified".to_string(),
            additions: 0,
            deletions: 0,
            file_position: 0,
            diff_content: None,
        };
        assert_eq!(file.extension(), Some("rs"));
    }
}
