//! Application error types for Tauri IPC.
//!
//! These errors are serializable and can be returned from Tauri commands
//! to provide meaningful error messages to the frontend.

use serde::Serialize;
use thiserror::Error;

/// Application-level errors that can be returned from Tauri commands.
///
/// All variants serialize to a structured JSON object for frontend consumption.
#[derive(Debug, Error, Serialize)]
#[serde(tag = "type", content = "details")]
pub enum AppError {
    /// Database operation failed.
    #[error("Database error: {message}")]
    Database {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        operation: Option<String>,
    },

    /// GitLab API request failed.
    #[error("GitLab API error: {message}")]
    GitLabApi {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        status_code: Option<u16>,
        #[serde(skip_serializing_if = "Option::is_none")]
        endpoint: Option<String>,
    },

    /// Network request failed.
    #[error("Network error: {message}")]
    Network { message: String },

    /// Authentication failed or credentials invalid.
    #[error("Authentication error: {message}")]
    Authentication { message: String },

    /// Authentication token expired or revoked - requires re-authentication.
    #[error("Token expired: {message}")]
    AuthenticationExpired {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        instance_id: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        instance_url: Option<String>,
    },

    /// Credential storage operation failed.
    #[error("Credential storage error: {message}")]
    CredentialStorage { message: String },

    /// Requested resource not found.
    #[error("Not found: {resource}")]
    NotFound {
        resource: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        id: Option<String>,
    },

    /// Invalid input provided.
    #[error("Invalid input: {message}")]
    InvalidInput {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        field: Option<String>,
    },

    /// Sync operation failed.
    #[error("Sync error: {message}")]
    Sync {
        message: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        action_id: Option<i64>,
    },

    /// Internal application error.
    #[error("Internal error: {message}")]
    Internal { message: String },
}

impl AppError {
    /// Create a database error with optional operation context.
    pub fn database(message: impl Into<String>) -> Self {
        Self::Database {
            message: message.into(),
            operation: None,
        }
    }

    /// Create a database error with operation context.
    pub fn database_with_op(message: impl Into<String>, operation: impl Into<String>) -> Self {
        Self::Database {
            message: message.into(),
            operation: Some(operation.into()),
        }
    }

    /// Create a GitLab API error.
    pub fn gitlab_api(message: impl Into<String>) -> Self {
        Self::GitLabApi {
            message: message.into(),
            status_code: None,
            endpoint: None,
        }
    }

    /// Create a GitLab API error with status code and endpoint.
    pub fn gitlab_api_full(
        message: impl Into<String>,
        status_code: u16,
        endpoint: impl Into<String>,
    ) -> Self {
        Self::GitLabApi {
            message: message.into(),
            status_code: Some(status_code),
            endpoint: Some(endpoint.into()),
        }
    }

    /// Create a network error.
    pub fn network(message: impl Into<String>) -> Self {
        Self::Network {
            message: message.into(),
        }
    }

    /// Create an authentication error.
    pub fn authentication(message: impl Into<String>) -> Self {
        Self::Authentication {
            message: message.into(),
        }
    }

    /// Create an authentication expired error.
    pub fn authentication_expired(message: impl Into<String>) -> Self {
        Self::AuthenticationExpired {
            message: message.into(),
            instance_id: None,
            instance_url: None,
        }
    }

    /// Create an authentication expired error with instance details.
    pub fn authentication_expired_for_instance(
        message: impl Into<String>,
        instance_id: i64,
        instance_url: impl Into<String>,
    ) -> Self {
        Self::AuthenticationExpired {
            message: message.into(),
            instance_id: Some(instance_id),
            instance_url: Some(instance_url.into()),
        }
    }

    /// Check if this is an authentication expired error.
    pub fn is_authentication_expired(&self) -> bool {
        matches!(self, Self::AuthenticationExpired { .. })
    }

    /// Get the instance ID if this is an authentication expired error.
    pub fn get_expired_instance_id(&self) -> Option<i64> {
        match self {
            Self::AuthenticationExpired { instance_id, .. } => *instance_id,
            _ => None,
        }
    }

    /// Get the instance URL if this is an authentication expired error.
    pub fn get_expired_instance_url(&self) -> Option<&str> {
        match self {
            Self::AuthenticationExpired { instance_url, .. } => instance_url.as_deref(),
            _ => None,
        }
    }

    /// Create a credential storage error.
    pub fn credential_storage(message: impl Into<String>) -> Self {
        Self::CredentialStorage {
            message: message.into(),
        }
    }

    /// Create a not found error.
    pub fn not_found(resource: impl Into<String>) -> Self {
        Self::NotFound {
            resource: resource.into(),
            id: None,
        }
    }

    /// Create a not found error with ID.
    pub fn not_found_with_id(resource: impl Into<String>, id: impl Into<String>) -> Self {
        Self::NotFound {
            resource: resource.into(),
            id: Some(id.into()),
        }
    }

    /// Create an invalid input error.
    pub fn invalid_input(message: impl Into<String>) -> Self {
        Self::InvalidInput {
            message: message.into(),
            field: None,
        }
    }

    /// Create an invalid input error with field name.
    pub fn invalid_input_field(message: impl Into<String>, field: impl Into<String>) -> Self {
        Self::InvalidInput {
            message: message.into(),
            field: Some(field.into()),
        }
    }

    /// Create a sync error.
    pub fn sync(message: impl Into<String>) -> Self {
        Self::Sync {
            message: message.into(),
            action_id: None,
        }
    }

    /// Create a sync error with action ID.
    pub fn sync_with_action(message: impl Into<String>, action_id: i64) -> Self {
        Self::Sync {
            message: message.into(),
            action_id: Some(action_id),
        }
    }

    /// Create an internal error.
    pub fn internal(message: impl Into<String>) -> Self {
        Self::Internal {
            message: message.into(),
        }
    }
}

// Conversions from common error types

impl From<sqlx::Error> for AppError {
    fn from(err: sqlx::Error) -> Self {
        Self::database(err.to_string())
    }
}

impl From<reqwest::Error> for AppError {
    fn from(err: reqwest::Error) -> Self {
        if err.is_timeout() {
            Self::network("Request timed out")
        } else if err.is_connect() {
            Self::network("Failed to connect to server")
        } else if err.is_status() {
            Self::gitlab_api(format!("HTTP error: {}", err))
        } else {
            Self::network(err.to_string())
        }
    }
}

impl From<serde_json::Error> for AppError {
    fn from(err: serde_json::Error) -> Self {
        Self::internal(format!("JSON error: {}", err))
    }
}

impl From<crate::db::DbError> for AppError {
    fn from(err: crate::db::DbError) -> Self {
        Self::database(err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_error_serialization() {
        let err = AppError::database("connection failed");
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"type\":\"Database\""));
        assert!(json.contains("connection failed"));
    }

    #[test]
    fn test_gitlab_api_error_full() {
        let err = AppError::gitlab_api_full("Not Found", 404, "/api/v4/merge_requests");
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"status_code\":404"));
        assert!(json.contains("/api/v4/merge_requests"));
    }

    #[test]
    fn test_not_found_with_id() {
        let err = AppError::not_found_with_id("MergeRequest", "123");
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("\"resource\":\"MergeRequest\""));
        assert!(json.contains("\"id\":\"123\""));
    }

    #[test]
    fn test_optional_fields_not_serialized() {
        let err = AppError::database("error");
        let json = serde_json::to_string(&err).unwrap();
        // operation is None, so should not appear
        assert!(!json.contains("operation"));
    }

    #[test]
    fn test_display_impl() {
        let err = AppError::authentication("invalid token");
        assert_eq!(
            format!("{}", err),
            "Authentication error: invalid token"
        );
    }
}
