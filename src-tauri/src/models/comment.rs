//! Comment model for MR discussions.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Type of line in a diff where a comment is placed.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LineType {
    Added,
    Removed,
    Context,
}

impl From<&str> for LineType {
    fn from(s: &str) -> Self {
        match s.to_lowercase().as_str() {
            "added" => Self::Added,
            "removed" => Self::Removed,
            _ => Self::Context,
        }
    }
}

/// Inline comment or discussion on a diff.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
pub struct Comment {
    /// GitLab note/comment ID.
    pub id: i64,

    /// Parent MR ID.
    pub mr_id: i64,

    /// GitLab discussion thread ID (optional).
    pub discussion_id: Option<String>,

    /// Parent comment ID for replies (optional).
    pub parent_id: Option<i64>,

    /// Comment author's username.
    pub author_username: String,

    /// Comment content (Markdown).
    pub body: String,

    /// File path for inline comments (optional).
    pub file_path: Option<String>,

    /// Line in old version (for deletions).
    pub old_line: Option<i64>,

    /// Line in new version (for additions).
    pub new_line: Option<i64>,

    /// Type of line: `added`, `removed`, `context`.
    pub line_type: Option<String>,

    /// Thread resolution status.
    pub resolved: bool,

    /// Can this comment be resolved.
    pub resolvable: bool,

    /// System-generated comment (not user-authored).
    pub system: bool,

    /// Creation timestamp (Unix).
    pub created_at: i64,

    /// Last update timestamp (Unix).
    pub updated_at: i64,

    /// Cache timestamp (Unix).
    pub cached_at: i64,

    /// Whether this is a local comment pending sync.
    pub is_local: bool,
}

impl Comment {
    /// Check if this is an inline comment (associated with a file).
    pub fn is_inline(&self) -> bool {
        self.file_path.is_some()
    }

    /// Check if this is a reply to another comment.
    pub fn is_reply(&self) -> bool {
        self.parent_id.is_some()
    }

    /// Check if this is a general comment (not inline).
    pub fn is_general(&self) -> bool {
        self.file_path.is_none() && self.parent_id.is_none()
    }

    /// Parse the line type string into an enum.
    pub fn line_type_enum(&self) -> Option<LineType> {
        self.line_type.as_ref().map(|s| LineType::from(s.as_str()))
    }

    /// Get the line number to display (prefers new_line for additions, old_line for deletions).
    pub fn display_line(&self) -> Option<i64> {
        match self.line_type_enum() {
            Some(LineType::Removed) => self.old_line.or(self.new_line),
            _ => self.new_line.or(self.old_line),
        }
    }
}

/// Data required to create a new local comment.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewComment {
    /// Parent MR ID.
    pub mr_id: i64,

    /// Comment content (Markdown).
    pub body: String,

    /// File path for inline comments.
    pub file_path: Option<String>,

    /// Line in old version.
    pub old_line: Option<i64>,

    /// Line in new version.
    pub new_line: Option<i64>,

    /// Type of line.
    pub line_type: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_comment(file_path: Option<&str>, parent_id: Option<i64>) -> Comment {
        Comment {
            id: 1,
            mr_id: 1,
            discussion_id: None,
            parent_id,
            author_username: "user".to_string(),
            body: "Test comment".to_string(),
            file_path: file_path.map(String::from),
            old_line: None,
            new_line: Some(10),
            line_type: Some("added".to_string()),
            resolved: false,
            resolvable: true,
            system: false,
            created_at: 0,
            updated_at: 0,
            cached_at: 0,
            is_local: false,
        }
    }

    #[test]
    fn test_is_inline() {
        let inline = make_comment(Some("src/main.rs"), None);
        assert!(inline.is_inline());

        let general = make_comment(None, None);
        assert!(!general.is_inline());
    }

    #[test]
    fn test_is_reply() {
        let reply = make_comment(None, Some(123));
        assert!(reply.is_reply());

        let not_reply = make_comment(None, None);
        assert!(!not_reply.is_reply());
    }

    #[test]
    fn test_is_general() {
        let general = make_comment(None, None);
        assert!(general.is_general());

        let inline = make_comment(Some("file.rs"), None);
        assert!(!inline.is_general());

        let reply = make_comment(None, Some(1));
        assert!(!reply.is_general());
    }

    #[test]
    fn test_display_line() {
        let mut comment = make_comment(Some("file.rs"), None);
        comment.new_line = Some(10);
        comment.old_line = Some(8);
        comment.line_type = Some("added".to_string());
        assert_eq!(comment.display_line(), Some(10));

        comment.line_type = Some("removed".to_string());
        assert_eq!(comment.display_line(), Some(8));
    }
}
