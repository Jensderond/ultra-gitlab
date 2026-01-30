//! Business logic services.
//!
//! This module contains the core business logic for interacting with GitLab,
//! managing local storage, and handling background synchronization.
//!
//! Services are designed to be testable and independent of Tauri-specific code.

pub mod credentials;
pub mod gitlab_client;
pub mod highlighter;
pub mod sync_engine;
pub mod sync_events;
pub mod sync_processor;
pub mod sync_queue;

pub use credentials::CredentialService;
pub use gitlab_client::GitLabClient;
pub use highlighter::SyntaxHighlighter;
pub use sync_engine::{SyncConfig, SyncEngine, SyncLogEntry, SyncResult, SyncStatus};
pub use sync_events::{
    ActionSyncedPayload, MrUpdateType, MrUpdatedPayload, SyncPhase, SyncProgressPayload,
    ACTION_SYNCED_EVENT, MR_UPDATED_EVENT, SYNC_PROGRESS_EVENT,
};
