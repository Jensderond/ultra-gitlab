//! Install the `ultra` CLI binary from the latest GitHub release into the
//! user's PATH (~/.local/bin). Separate from the desktop app's auto-updater.

use crate::error::AppError;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;

const REPO: &str = "Jensderond/ultra-gitlab";
const ASSET: &str = "ultra-aarch64-apple-darwin.tar.gz";
const BIN_NAME: &str = "ultra";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliInstallResult {
    pub version: String,
    pub path: String,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliStatus {
    pub installed: bool,
    pub path: String,
}

#[derive(Deserialize)]
struct GhRelease {
    tag_name: String,
    assets: Vec<GhAsset>,
}

#[derive(Deserialize)]
struct GhAsset {
    name: String,
    browser_download_url: String,
}

fn install_dir() -> Result<PathBuf, AppError> {
    let home = std::env::var("HOME")
        .map_err(|_| AppError::internal("HOME environment variable not set"))?;
    Ok(PathBuf::from(home).join(".local/bin"))
}

/// Report whether the CLI is already installed in ~/.local/bin.
///
/// Note: we deliberately do not report whether the install dir is on the
/// user's `$PATH`. A GUI app launched via `launchd` inherits a stripped-down
/// environment that omits PATH entries set in shell rc files, so any such
/// check yields false positives. We only report what we can verify.
#[tauri::command]
pub async fn cli_status() -> Result<CliStatus, AppError> {
    let dir = install_dir()?;
    let bin = dir.join(BIN_NAME);
    Ok(CliStatus {
        installed: bin.exists(),
        path: bin.to_string_lossy().into_owned(),
    })
}

/// Download the latest released `ultra` CLI and install it to ~/.local/bin.
#[tauri::command]
pub async fn download_and_install_cli() -> Result<CliInstallResult, AppError> {
    let client = reqwest::Client::builder()
        .user_agent("ultra-gitlab-desktop")
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|e| AppError::network(format!("HTTP client: {e}")))?;

    // 1. Latest (non-prerelease) release.
    let rel: GhRelease = client
        .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| AppError::network(format!("Fetching latest release: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::network(format!("GitHub API error: {e}")))?
        .json()
        .await
        .map_err(|e| AppError::network(format!("Parsing release JSON: {e}")))?;

    // 2. Find the CLI asset.
    let asset = rel
        .assets
        .iter()
        .find(|a| a.name == ASSET)
        .ok_or_else(|| {
            AppError::not_found(format!(
                "The latest release ({}) has no '{ASSET}'. Promote a release that bundles the CLI to Latest first.",
                rel.tag_name
            ))
        })?;

    // 3. Download the tarball.
    let bytes = client
        .get(&asset.browser_download_url)
        .send()
        .await
        .map_err(|e| AppError::network(format!("Downloading CLI: {e}")))?
        .error_for_status()
        .map_err(|e| AppError::network(format!("Download failed: {e}")))?
        .bytes()
        .await
        .map_err(|e| AppError::network(format!("Reading download: {e}")))?;

    // 4. Extract `ultra` to ~/.local/bin.
    let dir = install_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| AppError::internal(format!("Creating {}: {e}", dir.display())))?;
    let bin_path = dir.join(BIN_NAME);
    extract_ultra(&bytes, &bin_path)?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&bin_path, std::fs::Permissions::from_mode(0o755))
            .map_err(|e| AppError::internal(format!("chmod: {e}")))?;
    }

    let version = rel.tag_name.trim_start_matches('v').to_string();
    let message = format!("Installed ultra {version} to {}", bin_path.display());

    Ok(CliInstallResult {
        version,
        path: bin_path.to_string_lossy().into_owned(),
        message,
    })
}

/// Extract the `ultra` entry from a .tar.gz into `dest`.
fn extract_ultra(tar_gz: &[u8], dest: &std::path::Path) -> Result<(), AppError> {
    use std::ffi::OsStr;
    let decoder = flate2::read::GzDecoder::new(tar_gz);
    let mut archive = tar::Archive::new(decoder);
    let entries = archive
        .entries()
        .map_err(|e| AppError::internal(format!("Reading archive: {e}")))?;
    for entry in entries {
        let mut entry = entry.map_err(|e| AppError::internal(format!("Archive entry: {e}")))?;
        let is_ultra = entry
            .path()
            .map(|p| p.file_name() == Some(OsStr::new(BIN_NAME)))
            .unwrap_or(false);
        if is_ultra {
            entry
                .unpack(dest)
                .map_err(|e| AppError::internal(format!("Extracting {BIN_NAME}: {e}")))?;
            return Ok(());
        }
    }
    Err(AppError::internal(format!(
        "'{BIN_NAME}' not found in the downloaded archive"
    )))
}
