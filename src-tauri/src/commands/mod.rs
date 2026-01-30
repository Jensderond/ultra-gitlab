//! Tauri IPC command handlers.
//!
//! This module contains all commands exposed to the frontend via Tauri's invoke system.
//! Commands are organized by functionality:
//! - `auth`: GitLab instance authentication and management
//! - `mr`: Merge request retrieval and display
//! - `comments`: Comment and discussion management
//! - `approval`: MR approval/unapproval
//! - `sync`: Background synchronization control
//! - `settings`: Application settings management

pub mod auth;

// Submodules will be added as they are implemented:
// pub mod mr;
// pub mod comments;
// pub mod approval;
// pub mod sync;
// pub mod settings;

// Re-export commands for registration in lib.rs
pub use auth::{delete_gitlab_instance, get_gitlab_instances, setup_gitlab_instance};
