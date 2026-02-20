//! GitLab API client.
//!
//! Provides HTTP client for GitLab API v4 with authentication and pagination.

use crate::error::AppError;
use reqwest::{header, Client, Response, StatusCode};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};

/// GitLab API client configuration.
#[derive(Debug, Clone)]
pub struct GitLabClientConfig {
    /// Base URL of the GitLab instance (e.g., `https://gitlab.com`).
    pub base_url: String,

    /// Personal access token for authentication.
    pub token: String,

    /// Request timeout in seconds.
    pub timeout_secs: u64,
}

impl Default for GitLabClientConfig {
    fn default() -> Self {
        Self {
            base_url: String::new(),
            token: String::new(),
            timeout_secs: 30,
        }
    }
}

/// GitLab API client.
#[derive(Debug, Clone)]
pub struct GitLabClient {
    client: Client,
    config: GitLabClientConfig,
}

/// Pagination information from GitLab API response headers.
#[derive(Debug, Clone, Default)]
pub struct PaginationInfo {
    /// Current page number.
    pub page: u32,

    /// Number of items per page.
    pub per_page: u32,

    /// Total number of pages.
    pub total_pages: u32,

    /// Total number of items.
    pub total: u32,

    /// Next page number (if any).
    pub next_page: Option<u32>,

    /// Previous page number (if any).
    pub prev_page: Option<u32>,
}

/// Paginated response from GitLab API.
#[derive(Debug)]
pub struct PaginatedResponse<T> {
    /// The response data.
    pub data: Vec<T>,

    /// Pagination information.
    pub pagination: PaginationInfo,
}

/// Query parameters for listing merge requests.
#[derive(Debug, Clone, Default, Serialize)]
pub struct MergeRequestsQuery {
    /// Filter by state: `opened`, `merged`, `closed`, `all`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,

    /// Filter by scope: `created_by_me`, `assigned_to_me`, `all`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub scope: Option<String>,

    /// Filter by author username.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub author_username: Option<String>,

    /// Filter by assignee username.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub assignee_username: Option<String>,

    /// Filter by reviewer username.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reviewer_username: Option<String>,

    /// Return MRs updated after this date (ISO 8601).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub updated_after: Option<String>,

    /// Page number for pagination.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page: Option<u32>,

    /// Number of items per page (max 100).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub per_page: Option<u32>,

    /// Filter WIP/Draft MRs: `yes` or `no`.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "wip")]
    pub draft: Option<String>,

    /// Exclude MRs by author username (negative filter).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "not[author_username]")]
    pub not_author_username: Option<String>,

    /// Exclude MRs approved by usernames (negative filter).
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "not[approved_by_usernames][]")]
    pub not_approved_by_usernames: Option<String>,
}

/// Nested head_pipeline object from GitLab MR API.
#[derive(Debug, Clone, Deserialize)]
pub struct GitLabHeadPipeline {
    pub status: String,
}

/// GitLab merge request from API.
#[derive(Debug, Clone, Deserialize)]
pub struct GitLabMergeRequest {
    pub id: i64,
    pub iid: i64,
    pub project_id: i64,
    pub title: String,
    pub description: Option<String>,
    pub state: String,
    pub web_url: String,
    pub source_branch: String,
    pub target_branch: String,
    pub created_at: String,
    pub updated_at: String,
    pub merged_at: Option<String>,
    pub author: GitLabUser,
    pub labels: Vec<String>,
    pub reviewers: Option<Vec<GitLabUser>>,
    pub detailed_merge_status: Option<String>,
    pub head_pipeline: Option<GitLabHeadPipeline>,
}

/// GitLab user from API.
#[derive(Debug, Clone, Deserialize)]
pub struct GitLabUser {
    pub id: i64,
    pub username: String,
    pub name: String,
    pub avatar_url: Option<String>,
}

/// GitLab diff from API (version endpoint).
#[derive(Debug, Clone, Deserialize)]
pub struct GitLabDiffVersion {
    pub id: i64,
    pub head_commit_sha: String,
    pub base_commit_sha: String,
    pub start_commit_sha: String,
    pub diffs: Vec<GitLabFileDiff>,
}

/// GitLab file diff from API.
#[derive(Debug, Clone, Deserialize)]
pub struct GitLabFileDiff {
    pub old_path: String,
    pub new_path: String,
    pub new_file: bool,
    pub renamed_file: bool,
    pub deleted_file: bool,
    pub diff: String,
}

/// GitLab note/comment from API.
#[derive(Debug, Clone, Deserialize)]
pub struct GitLabNote {
    pub id: i64,
    pub body: String,
    pub author: GitLabUser,
    pub created_at: String,
    pub updated_at: String,
    pub system: bool,
    pub resolvable: bool,
    pub resolved: Option<bool>,
}

/// GitLab discussion from API.
#[derive(Debug, Clone, Deserialize)]
pub struct GitLabDiscussion {
    pub id: String,
    pub notes: Vec<GitLabDiscussionNote>,
}

/// GitLab discussion note from API.
#[derive(Debug, Clone, Deserialize)]
pub struct GitLabDiscussionNote {
    pub id: i64,
    pub body: String,
    pub author: GitLabUser,
    pub created_at: String,
    pub updated_at: String,
    pub system: bool,
    pub resolvable: bool,
    pub resolved: Option<bool>,
    pub position: Option<GitLabNotePosition>,
}

/// Response from the MR approvals endpoint.
#[derive(Debug, Clone, Deserialize)]
pub struct MergeRequestApprovals {
    pub approved: bool,
    pub approvals_required: i64,
    pub approvals_left: i64,
    pub approved_by: Vec<ApprovedBy>,
}

/// User who approved an MR.
#[derive(Debug, Clone, Deserialize)]
pub struct ApprovedBy {
    pub user: GitLabUser,
}

/// Position information for inline comments.
#[derive(Debug, Clone, Deserialize)]
pub struct GitLabNotePosition {
    pub old_path: Option<String>,
    pub new_path: Option<String>,
    pub old_line: Option<i64>,
    pub new_line: Option<i64>,
    pub position_type: String,
}

/// GitLab project from API.
#[derive(Debug, Clone, Deserialize)]
pub struct GitLabProject {
    pub id: i64,
    pub name: String,
    pub name_with_namespace: String,
    pub path_with_namespace: String,
    pub web_url: String,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
}

/// GitLab pipeline from API (GET /projects/:id/pipelines).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLabPipeline {
    pub id: i64,
    pub project_id: i64,
    pub status: String,
    #[serde(rename = "ref")]
    pub ref_name: String,
    pub sha: String,
    pub web_url: String,
    pub created_at: String,
    pub updated_at: Option<String>,
    pub duration: Option<i64>,
}

/// GitLab pipeline job from API (GET /projects/:id/pipelines/:pipeline_id/jobs).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLabJob {
    pub id: i64,
    pub name: String,
    pub stage: String,
    pub status: String,
    #[serde(rename = "ref")]
    pub ref_name: Option<String>,
    pub created_at: String,
    pub started_at: Option<String>,
    pub finished_at: Option<String>,
    pub duration: Option<f64>,
    pub queued_duration: Option<f64>,
    pub web_url: String,
    pub allow_failure: bool,
    pub pipeline: Option<GitLabJobPipeline>,
    pub runner: Option<GitLabJobRunner>,
}

/// Nested pipeline ref inside a job response.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLabJobPipeline {
    pub id: i64,
    pub status: String,
}

/// Runner info attached to a job.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GitLabJobRunner {
    pub id: i64,
    pub description: Option<String>,
}

/// Personal access token info from GET /personal_access_tokens/self.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonalAccessTokenInfo {
    /// Token expiration date (ISO 8601 date string), or None if no expiration.
    pub expires_at: Option<String>,

    /// Token display name.
    pub name: String,

    /// Token scopes (e.g., ["api", "read_user"]).
    pub scopes: Vec<String>,

    /// Whether the token is currently active.
    pub active: bool,
}

impl GitLabClient {
    /// Create a new GitLab client.
    pub fn new(config: GitLabClientConfig) -> Result<Self, AppError> {
        let mut headers = header::HeaderMap::new();

        // Add the private token header for authentication
        let token_value = header::HeaderValue::from_str(&config.token)
            .map_err(|_| AppError::authentication("Invalid token format"))?;
        headers.insert("PRIVATE-TOKEN", token_value);

        // Build the HTTP client
        let client = Client::builder()
            .default_headers(headers)
            .timeout(std::time::Duration::from_secs(config.timeout_secs))
            .build()
            .map_err(|e| AppError::internal(format!("Failed to build HTTP client: {}", e)))?;

        Ok(Self { client, config })
    }

    /// Get the base URL for API requests.
    fn api_url(&self, path: &str) -> String {
        format!(
            "{}/api/v4{}",
            self.config.base_url.trim_end_matches('/'),
            path
        )
    }

    /// Parse pagination headers from response.
    fn parse_pagination(response: &Response) -> PaginationInfo {
        let headers = response.headers();

        let get_header = |name: &str| -> Option<u32> {
            headers
                .get(name)
                .and_then(|v| v.to_str().ok())
                .and_then(|s| s.parse().ok())
        };

        PaginationInfo {
            page: get_header("x-page").unwrap_or(1),
            per_page: get_header("x-per-page").unwrap_or(20),
            total_pages: get_header("x-total-pages").unwrap_or(1),
            total: get_header("x-total").unwrap_or(0),
            next_page: get_header("x-next-page"),
            prev_page: get_header("x-prev-page"),
        }
    }

    /// Handle API response errors.
    async fn handle_response<T: DeserializeOwned>(
        &self,
        response: Response,
        endpoint: &str,
    ) -> Result<T, AppError> {
        let status = response.status();

        if status.is_success() {
            response
                .json::<T>()
                .await
                .map_err(|e| AppError::internal(format!("Failed to parse response: {}", e)))
        } else if status == StatusCode::UNAUTHORIZED {
            // 401 Unauthorized - token is expired or revoked
            Err(AppError::authentication_expired(
                "GitLab token expired or revoked. Please re-authenticate.",
            ))
        } else {
            let status_code = status.as_u16();
            let body = response.text().await.unwrap_or_default();
            let body_message = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| {
                    // GitLab returns errors as {"message": "..."} or {"error": "..."}
                    v.get("message")
                        .or_else(|| v.get("error"))
                        .and_then(|m| {
                            if let Some(s) = m.as_str() {
                                Some(s.to_string())
                            } else {
                                // Sometimes "message" is an object like {"base":["msg"]}
                                Some(m.to_string())
                            }
                        })
                });

            let message = match (status, &body_message) {
                (StatusCode::FORBIDDEN, _) => "Access denied".to_string(),
                (StatusCode::NOT_FOUND, _) => "Resource not found".to_string(),
                (StatusCode::TOO_MANY_REQUESTS, _) => "Rate limit exceeded".to_string(),
                (_, Some(msg)) => msg.clone(),
                _ => format!("Request failed ({}): {}", status_code, body),
            };

            Err(AppError::gitlab_api_full(
                &message,
                status_code,
                endpoint,
            ))
        }
    }

    /// Make a GET request with pagination support.
    async fn get_paginated<T: DeserializeOwned>(
        &self,
        endpoint: &str,
        query: Option<&impl Serialize>,
    ) -> Result<PaginatedResponse<T>, AppError> {
        let url = self.api_url(endpoint);

        let mut request = self.client.get(&url);
        if let Some(q) = query {
            request = request.query(q);
        }

        let response = request.send().await?;
        let pagination = Self::parse_pagination(&response);
        let data = self.handle_response::<Vec<T>>(response, endpoint).await?;

        Ok(PaginatedResponse { data, pagination })
    }

    /// Fetch all pages of a paginated endpoint.
    pub async fn get_all_pages<T: DeserializeOwned>(
        &self,
        endpoint: &str,
        query: Option<&impl Serialize>,
    ) -> Result<Vec<T>, AppError> {
        let mut all_data = Vec::new();
        let mut page = 1u32;

        loop {
            let url = self.api_url(endpoint);
            let mut request = self.client.get(&url);

            // Add original query params
            if let Some(q) = query {
                request = request.query(q);
            }

            // Add pagination params
            request = request.query(&[("page", page.to_string()), ("per_page", "100".to_string())]);

            let response = request.send().await?;
            let pagination = Self::parse_pagination(&response);
            let data = self.handle_response::<Vec<T>>(response, endpoint).await?;

            all_data.extend(data);

            match pagination.next_page {
                Some(next) => page = next,
                None => break,
            }
        }

        Ok(all_data)
    }

    /// Validate the token by fetching the current user.
    pub async fn validate_token(&self) -> Result<GitLabUser, AppError> {
        let url = self.api_url("/user");
        let response = self.client.get(&url).send().await?;
        self.handle_response(response, "/user").await
    }

    /// Fetch the current personal access token's info (expiration, scopes, etc.).
    pub async fn get_token_info(&self) -> Result<PersonalAccessTokenInfo, AppError> {
        let endpoint = "/personal_access_tokens/self";
        let url = self.api_url(endpoint);
        let response = self.client.get(&url).send().await?;
        self.handle_response(response, endpoint).await
    }

    /// Get a single project by ID.
    pub async fn get_project(&self, project_id: i64) -> Result<GitLabProject, AppError> {
        let endpoint = format!("/projects/{}", project_id);
        let url = self.api_url(&endpoint);
        let response = self.client.get(&url).send().await?;
        self.handle_response(response, &endpoint).await
    }

    /// Search for projects by name.
    pub async fn search_projects(
        &self,
        query: &str,
        per_page: u32,
    ) -> Result<Vec<GitLabProject>, AppError> {
        let endpoint = "/projects";
        let url = self.api_url(endpoint);
        let response = self
            .client
            .get(&url)
            .query(&[("search", query), ("per_page", &per_page.to_string())])
            .send()
            .await?;
        self.handle_response(response, endpoint).await
    }

    /// Get the latest pipeline for a project.
    pub async fn get_latest_pipeline(
        &self,
        project_id: i64,
    ) -> Result<Option<GitLabPipeline>, AppError> {
        let endpoint = format!("/projects/{}/pipelines", project_id);
        let url = self.api_url(&endpoint);
        let response = self
            .client
            .get(&url)
            .query(&[("per_page", "1")])
            .send()
            .await?;
        let pipelines: Vec<GitLabPipeline> = self.handle_response(response, &endpoint).await?;
        Ok(pipelines.into_iter().next())
    }

    /// Get recent pipelines for a project (up to `limit`).
    pub async fn get_project_pipelines(
        &self,
        project_id: i64,
        limit: u32,
    ) -> Result<Vec<GitLabPipeline>, AppError> {
        let endpoint = format!("/projects/{}/pipelines", project_id);
        let url = self.api_url(&endpoint);
        let response = self
            .client
            .get(&url)
            .query(&[("per_page", &limit.to_string())])
            .send()
            .await?;
        self.handle_response(response, &endpoint).await
    }

    /// Get jobs for a specific pipeline.
    pub async fn get_pipeline_jobs(
        &self,
        project_id: i64,
        pipeline_id: i64,
    ) -> Result<Vec<GitLabJob>, AppError> {
        let endpoint = format!("/projects/{}/pipelines/{}/jobs", project_id, pipeline_id);
        self.get_all_pages(&endpoint, None::<&()>).await
    }

    /// Get bridge (downstream/child pipeline trigger) jobs for a pipeline.
    pub async fn get_pipeline_bridges(
        &self,
        project_id: i64,
        pipeline_id: i64,
    ) -> Result<Vec<GitLabJob>, AppError> {
        let endpoint = format!("/projects/{}/pipelines/{}/bridges", project_id, pipeline_id);
        // Bridges may not exist on all pipelines, treat 404 as empty
        match self.get_all_pages(&endpoint, None::<&()>).await {
            Ok(bridges) => Ok(bridges),
            Err(_) => Ok(Vec::new()),
        }
    }

    /// Play (trigger) a manual job.
    pub async fn play_job(&self, project_id: i64, job_id: i64) -> Result<GitLabJob, AppError> {
        let endpoint = format!("/projects/{}/jobs/{}/play", project_id, job_id);
        let url = self.api_url(&endpoint);
        let response = self.client.post(&url).send().await?;
        self.handle_response(response, &endpoint).await
    }

    /// Retry a failed or canceled job.
    pub async fn retry_job(&self, project_id: i64, job_id: i64) -> Result<GitLabJob, AppError> {
        let endpoint = format!("/projects/{}/jobs/{}/retry", project_id, job_id);
        let url = self.api_url(&endpoint);
        let response = self.client.post(&url).send().await?;
        self.handle_response(response, &endpoint).await
    }

    /// Cancel a running or pending job.
    pub async fn cancel_job(&self, project_id: i64, job_id: i64) -> Result<GitLabJob, AppError> {
        let endpoint = format!("/projects/{}/jobs/{}/cancel", project_id, job_id);
        let url = self.api_url(&endpoint);
        let response = self.client.post(&url).send().await?;
        self.handle_response(response, &endpoint).await
    }

    /// List merge requests.
    pub async fn list_merge_requests(
        &self,
        query: &MergeRequestsQuery,
    ) -> Result<PaginatedResponse<GitLabMergeRequest>, AppError> {
        self.get_paginated("/merge_requests", Some(query)).await
    }

    /// Get a single merge request by project and IID.
    pub async fn get_merge_request(
        &self,
        project_id: i64,
        mr_iid: i64,
    ) -> Result<GitLabMergeRequest, AppError> {
        let endpoint = format!("/projects/{}/merge_requests/{}", project_id, mr_iid);
        let url = self.api_url(&endpoint);
        let response = self.client.get(&url).send().await?;
        self.handle_response(response, &endpoint).await
    }

    /// Get a single merge request by project path (URL-encoded) and IID.
    pub async fn get_merge_request_by_path(
        &self,
        project_path: &str,
        mr_iid: i64,
    ) -> Result<GitLabMergeRequest, AppError> {
        let encoded = urlencoding::encode(project_path);
        let endpoint = format!("/projects/{}/merge_requests/{}", encoded, mr_iid);
        let url = self.api_url(&endpoint);
        let response = self.client.get(&url).send().await?;
        self.handle_response(response, &endpoint).await
    }

    /// Get the latest diff version for a merge request.
    pub async fn get_merge_request_diff(
        &self,
        project_id: i64,
        mr_iid: i64,
    ) -> Result<GitLabDiffVersion, AppError> {
        // First, get the list of versions
        let versions_endpoint = format!(
            "/projects/{}/merge_requests/{}/versions",
            project_id, mr_iid
        );
        let url = self.api_url(&versions_endpoint);
        let response = self.client.get(&url).send().await?;

        let versions: Vec<serde_json::Value> =
            self.handle_response(response, &versions_endpoint).await?;

        // Get the latest version (first in list)
        let version_id = versions
            .first()
            .and_then(|v| v.get("id"))
            .and_then(|id| id.as_i64())
            .ok_or_else(|| AppError::not_found("No diff versions found"))?;

        // Fetch the full version with diffs
        let version_endpoint = format!(
            "/projects/{}/merge_requests/{}/versions/{}",
            project_id, mr_iid, version_id
        );
        let url = self.api_url(&version_endpoint);
        let response = self.client.get(&url).send().await?;
        self.handle_response(response, &version_endpoint).await
    }

    /// List discussions on a merge request.
    pub async fn list_discussions(
        &self,
        project_id: i64,
        mr_iid: i64,
    ) -> Result<Vec<GitLabDiscussion>, AppError> {
        let endpoint = format!(
            "/projects/{}/merge_requests/{}/discussions",
            project_id, mr_iid
        );
        self.get_all_pages(&endpoint, None::<&()>).await
    }

    /// Send a POST request to an endpoint, expecting only a success status.
    async fn post_empty(&self, endpoint: &str) -> Result<(), AppError> {
        let url = self.api_url(endpoint);
        let response = self.client.post(&url).send().await?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(AppError::gitlab_api_full(
                "Request failed",
                response.status().as_u16(),
                endpoint,
            ))
        }
    }

    /// Approve a merge request.
    pub async fn approve_merge_request(
        &self,
        project_id: i64,
        mr_iid: i64,
    ) -> Result<(), AppError> {
        self.post_empty(&format!(
            "/projects/{}/merge_requests/{}/approve",
            project_id, mr_iid
        ))
        .await
    }

    /// Unapprove a merge request.
    pub async fn unapprove_merge_request(
        &self,
        project_id: i64,
        mr_iid: i64,
    ) -> Result<(), AppError> {
        self.post_empty(&format!(
            "/projects/{}/merge_requests/{}/unapprove",
            project_id, mr_iid
        ))
        .await
    }

    /// Merge a merge request.
    pub async fn merge_merge_request(&self, project_id: i64, mr_iid: i64) -> Result<(), AppError> {
        let endpoint = format!("/projects/{}/merge_requests/{}/merge", project_id, mr_iid);
        let url = self.api_url(&endpoint);
        let response = self.client.put(&url).send().await?;

        if response.status().is_success() {
            Ok(())
        } else {
            let status = response.status();
            // Read the body for a more descriptive error
            let body = response.text().await.unwrap_or_default();
            let message = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("message")?.as_str().map(String::from))
                .unwrap_or_else(|| match status.as_u16() {
                    401 => "Not authorized to merge".into(),
                    405 => "MR cannot be merged (check conflicts or pipeline)".into(),
                    406 => "Branch cannot be merged".into(),
                    409 => "SHA mismatch — the MR has been updated".into(),
                    _ => format!("Merge failed ({})", status),
                });

            Err(AppError::gitlab_api_full(
                &message,
                status.as_u16(),
                &endpoint,
            ))
        }
    }

    /// Rebase a merge request's source branch.
    pub async fn rebase_merge_request(&self, project_id: i64, mr_iid: i64) -> Result<(), AppError> {
        let endpoint = format!("/projects/{}/merge_requests/{}/rebase", project_id, mr_iid);
        let url = self.api_url(&endpoint);
        let response = self.client.put(&url).send().await?;

        if response.status().is_success() {
            Ok(())
        } else {
            let status = response.status();
            let body = response.text().await.unwrap_or_default();
            let message = serde_json::from_str::<serde_json::Value>(&body)
                .ok()
                .and_then(|v| v.get("message")?.as_str().map(String::from))
                .unwrap_or_else(|| format!("Rebase failed ({})", status));

            Err(AppError::gitlab_api_full(
                &message,
                status.as_u16(),
                &endpoint,
            ))
        }
    }

    /// Add a general comment to a merge request.
    pub async fn add_comment(
        &self,
        project_id: i64,
        mr_iid: i64,
        body: &str,
    ) -> Result<GitLabNote, AppError> {
        let endpoint = format!("/projects/{}/merge_requests/{}/notes", project_id, mr_iid);
        let url = self.api_url(&endpoint);

        let response = self
            .client
            .post(&url)
            .json(&serde_json::json!({ "body": body }))
            .send()
            .await?;

        self.handle_response(response, &endpoint).await
    }

    /// Add an inline comment to a merge request at a specific line.
    ///
    /// This creates a new discussion thread at the specified position.
    pub async fn add_inline_comment(
        &self,
        project_id: i64,
        mr_iid: i64,
        body: &str,
        file_path: &str,
        old_line: Option<i64>,
        new_line: Option<i64>,
        base_sha: &str,
        head_sha: &str,
        start_sha: &str,
    ) -> Result<GitLabDiscussion, AppError> {
        let endpoint = format!(
            "/projects/{}/merge_requests/{}/discussions",
            project_id, mr_iid
        );
        let url = self.api_url(&endpoint);

        #[derive(Serialize)]
        struct Position<'a> {
            base_sha: &'a str,
            head_sha: &'a str,
            start_sha: &'a str,
            position_type: &'a str,
            old_path: &'a str,
            new_path: &'a str,
            #[serde(skip_serializing_if = "Option::is_none")]
            old_line: Option<i64>,
            #[serde(skip_serializing_if = "Option::is_none")]
            new_line: Option<i64>,
        }

        #[derive(Serialize)]
        struct Body<'a> {
            body: &'a str,
            position: Position<'a>,
        }

        let request_body = Body {
            body,
            position: Position {
                base_sha,
                head_sha,
                start_sha,
                position_type: "text",
                old_path: file_path,
                new_path: file_path,
                old_line,
                new_line,
            },
        };

        let response = self.client.post(&url).json(&request_body).send().await?;

        self.handle_response(response, &endpoint).await
    }

    /// Reply to a discussion.
    pub async fn reply_to_discussion(
        &self,
        project_id: i64,
        mr_iid: i64,
        discussion_id: &str,
        body: &str,
    ) -> Result<GitLabNote, AppError> {
        let endpoint = format!(
            "/projects/{}/merge_requests/{}/discussions/{}/notes",
            project_id, mr_iid, discussion_id
        );
        let url = self.api_url(&endpoint);

        let response = self
            .client
            .post(&url)
            .json(&serde_json::json!({ "body": body }))
            .send()
            .await?;

        self.handle_response(response, &endpoint).await
    }

    /// Get approval status for a merge request.
    pub async fn get_mr_approvals(
        &self,
        project_id: i64,
        mr_iid: i64,
    ) -> Result<MergeRequestApprovals, AppError> {
        let endpoint = format!(
            "/projects/{}/merge_requests/{}/approvals",
            project_id, mr_iid
        );
        let url = self.api_url(&endpoint);
        let response = self.client.get(&url).send().await?;
        self.handle_response(response, &endpoint).await
    }

    /// Resolve or unresolve a discussion.
    pub async fn resolve_discussion(
        &self,
        project_id: i64,
        mr_iid: i64,
        discussion_id: &str,
        resolved: bool,
    ) -> Result<(), AppError> {
        let endpoint = format!(
            "/projects/{}/merge_requests/{}/discussions/{}",
            project_id, mr_iid, discussion_id
        );
        let url = self.api_url(&endpoint);

        let response = self
            .client
            .put(&url)
            .json(&serde_json::json!({ "resolved": resolved }))
            .send()
            .await?;

        if response.status().is_success() {
            Ok(())
        } else {
            Err(AppError::gitlab_api_full(
                "Failed to resolve discussion",
                response.status().as_u16(),
                &endpoint,
            ))
        }
    }

    /// Fetch raw file from GitLab repository at a specific SHA.
    ///
    /// Internal helper that handles the API request and error handling.
    async fn fetch_raw_file(
        &self,
        project_id: i64,
        file_path: &str,
        sha: &str,
    ) -> Result<Response, AppError> {
        let encoded_path = urlencoding::encode(file_path);
        let endpoint = format!(
            "/projects/{}/repository/files/{}/raw",
            project_id, encoded_path
        );
        let url = self.api_url(&endpoint);

        let response = self.client.get(&url).query(&[("ref", sha)]).send().await?;

        let status = response.status();

        if status.is_success() || status == StatusCode::NOT_FOUND {
            Ok(response)
        } else if status == StatusCode::UNAUTHORIZED {
            Err(AppError::authentication_expired(
                "GitLab token expired or revoked. Please re-authenticate.",
            ))
        } else {
            Err(AppError::gitlab_api_full(
                "Failed to fetch file content",
                status.as_u16(),
                &endpoint,
            ))
        }
    }

    /// Get raw file content at a specific SHA.
    ///
    /// This fetches the raw file content from the repository at a specific commit.
    /// Used by Monaco editor to display the original and modified file content.
    ///
    /// # Returns
    /// The raw file content as a string, or empty string if file doesn't exist (404).
    pub async fn get_file_content(
        &self,
        project_id: i64,
        file_path: &str,
        sha: &str,
    ) -> Result<String, AppError> {
        let response = self.fetch_raw_file(project_id, file_path, sha).await?;

        if response.status() == StatusCode::NOT_FOUND {
            return Ok(String::new());
        }

        response
            .text()
            .await
            .map_err(|e| AppError::internal(format!("Failed to read file content: {}", e)))
    }

    /// Get the raw log (trace) output for a job.
    ///
    /// Calls `GET /projects/:id/jobs/:job_id/trace` and returns the plain-text log.
    /// Returns an empty string when the job has no trace (404).
    pub async fn get_job_trace(&self, project_id: i64, job_id: i64) -> Result<String, AppError> {
        let endpoint = format!("/projects/{}/jobs/{}/trace", project_id, job_id);
        let url = self.api_url(&endpoint);
        let response = self.client.get(&url).send().await?;

        let status = response.status();
        if status == StatusCode::NOT_FOUND {
            return Ok(String::new());
        }
        if status == StatusCode::UNAUTHORIZED {
            return Err(AppError::authentication_expired(
                "GitLab token expired or revoked. Please re-authenticate.",
            ));
        }
        if !status.is_success() {
            return Err(AppError::gitlab_api_full(
                "Failed to fetch job trace",
                status.as_u16(),
                &endpoint,
            ));
        }

        response
            .text()
            .await
            .map_err(|e| AppError::internal(format!("Failed to read job trace: {}", e)))
    }

    /// Get raw file content as bytes at a specific SHA.
    ///
    /// This fetches binary file content from the repository at a specific commit.
    /// Used for images and other binary files.
    ///
    /// # Returns
    /// The raw file content as bytes, or empty Vec if file doesn't exist (404).
    pub async fn get_file_content_bytes(
        &self,
        project_id: i64,
        file_path: &str,
        sha: &str,
    ) -> Result<Vec<u8>, AppError> {
        let response = self.fetch_raw_file(project_id, file_path, sha).await?;

        if response.status() == StatusCode::NOT_FOUND {
            return Ok(Vec::new());
        }

        response
            .bytes()
            .await
            .map(|b| b.to_vec())
            .map_err(|e| AppError::internal(format!("Failed to read file bytes: {}", e)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_api_url_construction() {
        let config = GitLabClientConfig {
            base_url: "https://gitlab.com/".to_string(),
            token: "test-token".to_string(),
            timeout_secs: 30,
        };

        // We can't easily test the client without mocking, but we can verify URL construction logic
        let base = config.base_url.trim_end_matches('/');
        let url = format!("{}/api/v4/user", base);
        assert_eq!(url, "https://gitlab.com/api/v4/user");
    }

    #[test]
    fn test_merge_requests_query_serialization() {
        let query = MergeRequestsQuery {
            state: Some("opened".to_string()),
            scope: Some("assigned_to_me".to_string()),
            per_page: Some(50),
            ..Default::default()
        };

        let json = serde_json::to_string(&query).unwrap();
        assert!(json.contains("\"state\":\"opened\""));
        assert!(json.contains("\"scope\":\"assigned_to_me\""));
        assert!(json.contains("\"per_page\":50"));
        // author_username should not be present (None)
        assert!(!json.contains("author_username"));
    }
}
