//! Sync event types for Tauri event emission.
//!
//! These events are emitted during sync operations to allow the frontend
//! to reactively update its state.

use serde::Serialize;

/// Event: sync-progress
/// Emitted during sync operations to report progress.
pub const SYNC_PROGRESS_EVENT: &str = "sync-progress";

/// Event: mr-updated
/// Emitted when an MR is created, updated, or deleted in the local cache.
pub const MR_UPDATED_EVENT: &str = "mr-updated";

/// Event: action-synced
/// Emitted when a local action is successfully synced to GitLab.
pub const ACTION_SYNCED_EVENT: &str = "action-synced";

/// Event: auth-expired
/// Emitted when authentication fails due to an expired or revoked token.
pub const AUTH_EXPIRED_EVENT: &str = "auth-expired";

/// Payload for sync-progress events.
#[derive(Debug, Clone, Serialize)]
pub struct SyncProgressPayload {
    /// Current phase of the sync operation.
    pub phase: SyncPhase,

    /// Progress message.
    pub message: String,

    /// Number of items processed so far (if applicable).
    pub processed: Option<i64>,

    /// Total number of items to process (if applicable).
    pub total: Option<i64>,

    /// Whether an error occurred.
    pub is_error: bool,
}

/// Phase of a sync operation.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SyncPhase {
    /// Starting sync.
    Starting,

    /// Fetching MRs from GitLab.
    FetchingMrs,

    /// Fetching diffs for an MR.
    FetchingDiff,

    /// Fetching comments for an MR.
    FetchingComments,

    /// Pushing local actions to GitLab.
    PushingActions,

    /// Purging closed/merged MRs.
    Purging,

    /// Sync completed.
    Complete,

    /// Sync failed.
    Failed,
}

/// Payload for mr-updated events.
#[derive(Debug, Clone, Serialize)]
pub struct MrUpdatedPayload {
    /// The MR ID that was updated.
    pub mr_id: i64,

    /// Type of update.
    pub update_type: MrUpdateType,

    /// Instance ID the MR belongs to.
    pub instance_id: i64,

    /// MR IID (project-scoped number).
    pub iid: i64,
}

/// Type of MR update.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum MrUpdateType {
    /// MR was created or first synced.
    Created,

    /// MR metadata was updated.
    Updated,

    /// MR diff was updated.
    DiffUpdated,

    /// MR comments were updated.
    CommentsUpdated,

    /// MR was purged (merged/closed).
    Purged,
}

/// Payload for action-synced events.
#[derive(Debug, Clone, Serialize)]
pub struct ActionSyncedPayload {
    /// The action ID that was synced.
    pub action_id: i64,

    /// Type of action.
    pub action_type: String,

    /// Whether the sync was successful.
    pub success: bool,

    /// Error message if failed.
    pub error: Option<String>,

    /// Related MR ID.
    pub mr_id: i64,

    /// Local reference ID (e.g., comment ID).
    pub local_reference_id: Option<i64>,
}

/// Payload for auth-expired events.
#[derive(Debug, Clone, Serialize)]
pub struct AuthExpiredPayload {
    /// The GitLab instance ID with the expired token.
    pub instance_id: i64,

    /// The URL of the GitLab instance.
    pub instance_url: String,

    /// User-friendly message explaining the issue.
    pub message: String,
}
