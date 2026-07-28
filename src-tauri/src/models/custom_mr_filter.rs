//! Custom MR filter model (issue #28).

use serde::{Deserialize, Serialize};
use sqlx::FromRow;

/// Per-instance user-defined MR sync filter. When enabled, sync fetches a
/// fourth scope (state=opened, scope=all) narrowed by these optional params,
/// in addition to the authored/reviewing/assigned scopes.
#[derive(Debug, Clone, Serialize, Deserialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct CustomMrFilter {
    pub instance_id: i64,
    /// Whether the filter participates in sync.
    pub enabled: bool,
    /// GitLab `wip` param: "yes" (only drafts), "no" (exclude drafts), None = any.
    pub draft: Option<String>,
    /// Only MRs authored by this username.
    pub author_username: Option<String>,
    /// Exclude MRs authored by this username.
    pub not_author_username: Option<String>,
    /// Comma-separated label names (GitLab AND-semantics).
    pub labels: Option<String>,
    pub updated_at: i64,
}
