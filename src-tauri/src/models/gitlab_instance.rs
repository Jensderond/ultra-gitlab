//! GitLab instance configuration model.

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Represents a configured GitLab server connection.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct GitLabInstance {
    /// Local database ID.
    pub id: i64,

    /// GitLab instance URL (e.g., `https://gitlab.com`).
    pub url: String,

    /// Display name for the instance (optional).
    pub name: Option<String>,

    /// Personal access token (stored in DB).
    pub token: Option<String>,

    /// Unix timestamp of creation.
    pub created_at: i64,

    /// Authenticated username (cached from GitLab API).
    pub authenticated_username: Option<String>,

    /// Session cookie for downloading avatar images.
    pub session_cookie: Option<String>,
}

/// Data required to create a new GitLab instance.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NewGitLabInstance {
    /// GitLab instance URL.
    pub url: String,

    /// Display name for the instance.
    pub name: Option<String>,
}

impl GitLabInstance {
    /// Normalize the URL by removing trailing slashes.
    pub fn normalize_url(url: &str) -> String {
        url.trim_end_matches('/').to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_url() {
        assert_eq!(
            GitLabInstance::normalize_url("https://gitlab.com/"),
            "https://gitlab.com"
        );
        assert_eq!(
            GitLabInstance::normalize_url("https://gitlab.com"),
            "https://gitlab.com"
        );
        assert_eq!(
            GitLabInstance::normalize_url("https://my.gitlab.server///"),
            "https://my.gitlab.server"
        );
    }
}
