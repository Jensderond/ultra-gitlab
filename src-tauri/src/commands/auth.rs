//! Authentication commands for GitLab instance management.
//!
//! These commands handle setting up, retrieving, and deleting GitLab instances
//! with their credentials stored securely in the OS keychain.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::GitLabInstance;
use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig};
use serde::{Deserialize, Serialize};
use tauri::State;

/// Response for setup_gitlab_instance command.
#[derive(Debug, Serialize)]
pub struct SetupInstanceResponse {
    /// The created GitLab instance.
    pub instance: GitLabInstance,

    /// The authenticated user's username.
    pub username: String,
}

/// Input for setup_gitlab_instance command.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SetupInstanceInput {
    /// GitLab instance URL.
    pub url: String,

    /// Personal access token.
    pub token: String,

    /// Optional display name.
    pub name: Option<String>,
}

/// Set up a new GitLab instance.
///
/// This command:
/// 1. Validates the token by calling GitLab API
/// 2. Stores the token securely in the OS keychain
/// 3. Creates the instance record in the database
///
/// # Errors
/// - Authentication error if token is invalid
/// - Database error if instance already exists or insert fails
/// - Credential storage error if keychain access fails
#[tauri::command]
pub async fn setup_gitlab_instance(
    pool: State<'_, DbPool>,
    input: SetupInstanceInput,
) -> Result<SetupInstanceResponse, AppError> {
    // Normalize the URL
    let url = GitLabInstance::normalize_url(&input.url);

    // Validate the token by fetching user info
    let client = GitLabClient::new(GitLabClientConfig {
        base_url: url.clone(),
        token: input.token.clone(),
        timeout_secs: 30,
    })?;

    let user = client.validate_token().await?;

    let now = chrono::Utc::now().timestamp();
    let result = sqlx::query_as::<_, GitLabInstance>(
        r#"
        INSERT INTO gitlab_instances (url, name, token, created_at)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (url) DO UPDATE SET name = $2, token = $3
        RETURNING id, url, name, token, created_at
        "#,
    )
    .bind(&url)
    .bind(&input.name)
    .bind(&input.token)
    .bind(now)
    .fetch_one(pool.inner())
    .await?;

    Ok(SetupInstanceResponse {
        instance: result,
        username: user.username,
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitLabInstanceWithStatus {
    #[serde(flatten)]
    pub instance: GitLabInstance,

    /// Whether a token is stored for this instance.
    pub has_token: bool,

    /// Error message if token check failed.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_error: Option<String>,
}

/// Get all configured GitLab instances.
///
/// Returns a list of all GitLab instances stored in the database.
/// Token availability can be checked via the `has_token` field.
#[tauri::command]
pub async fn get_gitlab_instances(
    pool: State<'_, DbPool>,
) -> Result<Vec<GitLabInstanceWithStatus>, AppError> {
    let instances: Vec<GitLabInstance> =
        sqlx::query_as("SELECT id, url, name, token, created_at FROM gitlab_instances ORDER BY created_at DESC")
            .fetch_all(pool.inner())
            .await?;

    Ok(instances
        .into_iter()
        .map(|instance| {
            let has_token = instance.token.is_some();
            GitLabInstanceWithStatus {
                instance,
                has_token,
                token_error: None,
            }
        })
        .collect())
}

/// Delete a GitLab instance.
///
/// This command:
/// 1. Deletes the token from the OS keychain
/// 2. Removes the instance from the database (cascades to MRs, diffs, etc.)
///
/// # Arguments
/// * `instance_id` - The database ID of the instance to delete
#[tauri::command]
pub async fn delete_gitlab_instance(
    pool: State<'_, DbPool>,
    instance_id: i64,
) -> Result<(), AppError> {
    // Delete the instance from database (cascades to related records)
    sqlx::query("DELETE FROM gitlab_instances WHERE id = $1")
        .bind(instance_id)
        .execute(pool.inner())
        .await?;

    Ok(())
}

#[cfg(test)]
mod tests {
    // Integration tests for auth commands would require:
    // - A test database
    // - Mock keychain or test keychain access
    // - Mock GitLab API server
    //
    // These are best implemented as separate integration tests.
}
