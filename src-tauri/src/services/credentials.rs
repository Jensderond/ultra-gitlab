//! Credential storage service using the OS keychain.
//!
//! This module provides secure storage for GitLab personal access tokens
//! using the system's native credential storage (Keychain on macOS,
//! Credential Manager on Windows, Secret Service on Linux).

use crate::error::AppError;
use keyring::Entry;

/// Service name used in the keychain.
const SERVICE_NAME: &str = "ultra-gitlab";

/// Credential storage operations.
pub struct CredentialService;

impl CredentialService {
    /// Store a token for a GitLab instance.
    ///
    /// # Arguments
    /// * `instance_url` - The GitLab instance URL (used as the account identifier)
    /// * `token` - The personal access token to store
    pub fn store_token(instance_url: &str, token: &str) -> Result<(), AppError> {
        let entry = Self::get_entry(instance_url)?;

        entry
            .set_password(token)
            .map_err(|e| AppError::credential_storage(format!("Failed to store token: {}", e)))
    }

    /// Retrieve a token for a GitLab instance.
    ///
    /// # Arguments
    /// * `instance_url` - The GitLab instance URL
    ///
    /// # Returns
    /// The stored token, or an error if not found
    pub fn get_token(instance_url: &str) -> Result<String, AppError> {
        let entry = Self::get_entry(instance_url)?;

        entry.get_password().map_err(|e| match e {
            keyring::Error::NoEntry => {
                AppError::not_found_with_id("credential", instance_url)
            }
            _ => AppError::credential_storage(format!("Failed to retrieve token: {}", e)),
        })
    }

    /// Delete a token for a GitLab instance.
    ///
    /// # Arguments
    /// * `instance_url` - The GitLab instance URL
    ///
    /// This operation is idempotent - deleting a non-existent token is not an error.
    pub fn delete_token(instance_url: &str) -> Result<(), AppError> {
        let entry = Self::get_entry(instance_url)?;

        match entry.delete_credential() {
            Ok(()) => Ok(()),
            Err(keyring::Error::NoEntry) => Ok(()), // Idempotent: already deleted
            Err(e) => Err(AppError::credential_storage(format!(
                "Failed to delete token: {}",
                e
            ))),
        }
    }

    /// Check if a token exists for a GitLab instance.
    ///
    /// # Arguments
    /// * `instance_url` - The GitLab instance URL
    ///
    /// # Returns
    /// true if a token exists, false otherwise
    pub fn has_token(instance_url: &str) -> Result<bool, AppError> {
        let entry = Self::get_entry(instance_url)?;

        match entry.get_password() {
            Ok(_) => Ok(true),
            Err(keyring::Error::NoEntry) => Ok(false),
            Err(e) => Err(AppError::credential_storage(format!(
                "Failed to check token: {}",
                e
            ))),
        }
    }

    /// Create a keyring entry for the given instance URL.
    fn get_entry(instance_url: &str) -> Result<Entry, AppError> {
        // Normalize the URL to use as the account name
        let account = normalize_url(instance_url);

        Entry::new(SERVICE_NAME, &account).map_err(|e| {
            AppError::credential_storage(format!("Failed to create keyring entry: {}", e))
        })
    }
}

/// Normalize a URL for use as an account identifier.
///
/// Removes trailing slashes and converts to lowercase.
fn normalize_url(url: &str) -> String {
    url.trim_end_matches('/').to_lowercase()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_url() {
        assert_eq!(
            normalize_url("https://gitlab.com/"),
            "https://gitlab.com"
        );
        assert_eq!(
            normalize_url("HTTPS://GitLab.COM"),
            "https://gitlab.com"
        );
        assert_eq!(
            normalize_url("https://my.gitlab.server///"),
            "https://my.gitlab.server"
        );
    }

    // Note: Integration tests for actual keychain operations would require
    // a test keychain or mocking. These are best done as manual tests or
    // in a CI environment with proper keychain access.
}
