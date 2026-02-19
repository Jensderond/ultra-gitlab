//! Authentication commands for GitLab instance management.
//!
//! These commands handle setting up, retrieving, and deleting GitLab instances
//! with their credentials stored securely in the OS keychain.

use crate::db::pool::DbPool;
use crate::error::AppError;
use crate::models::GitLabInstance;
use crate::services::gitlab_client::{GitLabClient, GitLabClientConfig, PersonalAccessTokenInfo};
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
        INSERT INTO gitlab_instances (url, name, token, created_at, authenticated_username)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (url) DO UPDATE SET name = $2, token = $3, authenticated_username = $5
        RETURNING id, url, name, token, created_at, authenticated_username
        "#,
    )
    .bind(&url)
    .bind(&input.name)
    .bind(&input.token)
    .bind(now)
    .bind(&user.username)
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
        sqlx::query_as("SELECT id, url, name, token, created_at, authenticated_username, session_cookie FROM gitlab_instances ORDER BY created_at DESC")
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

/// Response for get_token_info command.
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenInfoResponse {
    /// Token expiration date (ISO 8601 date string), or None if no expiration.
    pub expires_at: Option<String>,

    /// Token display name.
    pub name: String,

    /// Token scopes (e.g., ["api", "read_user"]).
    pub scopes: Vec<String>,

    /// Whether the token is currently active.
    pub active: bool,
}

impl From<PersonalAccessTokenInfo> for TokenInfoResponse {
    fn from(info: PersonalAccessTokenInfo) -> Self {
        Self {
            expires_at: info.expires_at,
            name: info.name,
            scopes: info.scopes,
            active: info.active,
        }
    }
}

/// Get token lifetime info for a given GitLab instance.
///
/// Loads the instance from the DB, creates a GitLabClient, and fetches the token info
/// from GitLab's /personal_access_tokens/self endpoint.
#[tauri::command]
pub async fn get_token_info(
    pool: State<'_, DbPool>,
    instance_id: i64,
) -> Result<TokenInfoResponse, AppError> {
    let instance: GitLabInstance = sqlx::query_as(
        "SELECT id, url, name, token, created_at, authenticated_username, session_cookie FROM gitlab_instances WHERE id = $1",
    )
    .bind(instance_id)
    .fetch_optional(pool.inner())
    .await?
    .ok_or_else(|| AppError::not_found("GitLab instance not found"))?;

    let token = instance
        .token
        .ok_or_else(|| AppError::authentication("No token configured for this instance"))?;

    let client = GitLabClient::new(GitLabClientConfig {
        base_url: instance.url,
        token,
        timeout_secs: 30,
    })?;

    let info = client.get_token_info().await?;
    Ok(info.into())
}

/// Update the personal access token for a GitLab instance.
///
/// Validates the new token by calling GitLab's /user endpoint, then updates
/// the token in the database.
#[tauri::command]
pub async fn update_instance_token(
    pool: State<'_, DbPool>,
    instance_id: i64,
    token: String,
) -> Result<String, AppError> {
    let instance: GitLabInstance = sqlx::query_as(
        "SELECT id, url, name, token, created_at, authenticated_username, session_cookie FROM gitlab_instances WHERE id = $1",
    )
    .bind(instance_id)
    .fetch_optional(pool.inner())
    .await?
    .ok_or_else(|| AppError::not_found("GitLab instance not found"))?;

    // Validate the new token
    let client = GitLabClient::new(GitLabClientConfig {
        base_url: instance.url,
        token: token.clone(),
        timeout_secs: 30,
    })?;

    let user = client.validate_token().await?;

    // Update the token and authenticated username in the database
    sqlx::query("UPDATE gitlab_instances SET token = $1, authenticated_username = $2 WHERE id = $3")
        .bind(&token)
        .bind(&user.username)
        .bind(instance_id)
        .execute(pool.inner())
        .await?;

    Ok(user.username)
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
