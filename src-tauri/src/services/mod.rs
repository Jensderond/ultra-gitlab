//! Business logic services.
//!
//! This module contains the core business logic for interacting with GitLab,
//! managing local storage, and handling background synchronization.
//!
//! Services are designed to be testable and independent of Tauri-specific code.

pub mod credentials;
pub mod gitlab_client;
pub mod highlighter;
pub mod sync_processor;
pub mod sync_queue;

// Submodules will be added as they are implemented:
// pub mod sync_engine;

pub use credentials::CredentialService;
pub use gitlab_client::GitLabClient;
pub use highlighter::SyntaxHighlighter;
