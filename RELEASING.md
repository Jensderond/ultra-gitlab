# Releasing a New Version

## Version Files

Three files contain the version and **must stay in sync**:

| File | Field |
|------|-------|
| `src-tauri/tauri.conf.json` | `"version": "X.Y.Z"` |
| `src-tauri/Cargo.toml` | `version = "X.Y.Z"` |
| `package.json` | `"version": "X.Y.Z"` |

## Release Steps

1. **Update version** in all three files:

   ```bash
   # Example: bumping to 0.2.0
   # Edit src-tauri/tauri.conf.json  →  "version": "0.2.0"
   # Edit src-tauri/Cargo.toml       →  version = "0.2.0"
   # Edit package.json               →  "version": "0.2.0"
   ```

2. **Commit the version bump**:

   ```bash
   git add src-tauri/tauri.conf.json src-tauri/Cargo.toml package.json
   git commit -m "chore: bump version to 0.2.0"
   ```

3. **Tag and push**:

   ```bash
   git tag v0.2.0
   git push origin master --tags
   ```

4. **Wait for CI** — the GitHub Actions workflow builds for macOS (ARM + Intel), Linux, and Windows. Each job uploads artifacts to a **draft** GitHub Release.

5. **Review the draft release** on GitHub → Releases. Edit the release notes if needed, then click **Publish release**.

6. **Users get notified** — the app checks for updates on launch and every hour, and shows a popup asking to update. When published, the updater endpoint (`/releases/latest/download/latest.json`) resolves to the new release automatically.

## First-Time Setup

Before the first release, ensure these are configured:

- [ ] **Signing keys generated**: `bun run tauri signer generate -w ~/.tauri/ultra-gitlab.key`
- [ ] **Public key** added to `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`
- [ ] **GitHub Secrets** added (repo → Settings → Secrets → Actions):
  - `TAURI_SIGNING_PRIVATE_KEY` — contents of `~/.tauri/ultra-gitlab.key`
  - `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` — password (if set during key generation)
- [ ] **Endpoint URL** in `src-tauri/tauri.conf.json` matches your actual GitHub repo path

## How the Updater Works

- On app start + every hour, the app fetches `latest.json` from the GitHub Release
- **Classic UI**: a popup offers the new version with its release notes; "Update now" downloads, installs and relaunches. A gold dot on the Settings gear and the Settings page offer the same.
- **Native UI**: the update downloads in the background (progress under the sidebar), then a sheet asks to restart.
- "Later" hides the popup for an hour, then it asks again. It never opens while someone is typing in a field.
- iOS updates through the App Store / TestFlight and never prompts.
