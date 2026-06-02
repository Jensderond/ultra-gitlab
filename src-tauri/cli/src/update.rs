//! Self-update via GitHub releases (the `ultra update` subcommand).

use self_update::cargo_crate_version;

/// Download the latest released `ultra` from GitHub and replace this binary.
///
/// Uses the GitHub "latest" release, which EXCLUDES pre-releases — so only
/// versions you've promoted to "Latest" in the GitHub UI are installed. The
/// release asset must be `ultra-<target-triple>.tar.gz` containing the `ultra`
/// binary (matched by target triple + bin name).
pub fn run_update() -> anyhow::Result<()> {
    let status = self_update::backends::github::Update::configure()
        .repo_owner("Jensderond")
        .repo_name("ultra-gitlab")
        .bin_name("ultra")
        .show_download_progress(true)
        .current_version(cargo_crate_version!())
        .build()?
        .update()?;
    if status.updated() {
        println!("Updated to {}", status.version());
    } else {
        println!("Already up to date ({})", status.version());
    }
    Ok(())
}
