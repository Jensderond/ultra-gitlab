# PRD: Token Management & Lifetime Display

## Introduction

Allow users to change the personal access token (PAT) for any configured GitLab instance directly from the Settings page, and display the token's expiration date alongside a "days remaining" indicator. When a token is nearing expiration (< 30 days), show a visual warning so users can rotate their credentials proactively.

## Goals

- Let users update a GitLab PAT inline on the Settings page without deleting and re-adding the instance
- Display token expiration date and days remaining for each instance
- Warn users visually when a token expires within 30 days
- Validate new tokens against the GitLab API before saving (matching existing setup behaviour)

## User Stories

### US-001: Add GitLab API method to fetch token expiration
**Description:** As a developer, I need a backend method to retrieve the current token's expiration date from GitLab so the frontend can display lifetime information.

**Acceptance Criteria:**
- [ ] New method on `GitLabClient` that calls `GET /personal_access_tokens/self` and returns at least `expires_at` (date string or null), `name`, `scopes`, and `active` status
- [ ] Response struct (e.g., `PersonalAccessTokenInfo`) with the relevant fields
- [ ] Handles tokens with no expiration (returns `None` for `expires_at`)
- [ ] Typecheck passes (`cargo check`)

### US-002: Expose token info via Tauri command
**Description:** As a developer, I need a Tauri IPC command that the frontend can call to get token lifetime info for a given instance.

**Acceptance Criteria:**
- [ ] New Tauri command `get_token_info(instance_id)` that loads the instance from the DB, creates a `GitLabClient`, and fetches the token info
- [ ] Returns a typed response with `expires_at: Option<String>`, `name: String`, `scopes: Vec<String>`, `active: bool`
- [ ] Returns a clear error if the instance has no token or the API call fails
- [ ] Command is registered in the Tauri command handler
- [ ] Typecheck passes (`cargo check`)

### US-003: Add "Edit Token" inline UI on Settings page
**Description:** As a user, I want an "Edit Token" button next to each GitLab instance in Settings so I can update my PAT without removing and re-adding the instance.

**Acceptance Criteria:**
- [ ] Each instance item in the Settings list shows an "Edit Token" button/icon
- [ ] Clicking it reveals an inline password input field pre-focused, with Save and Cancel actions
- [ ] The input uses `type="password"` and placeholder `glpat-...`
- [ ] Cancel hides the input and restores the previous view
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-004: Validate and save updated token
**Description:** As a user, I want my new token validated against GitLab before it's saved, so I know it works.

**Acceptance Criteria:**
- [ ] New Tauri command `update_instance_token(instance_id, token)` that validates the token via the GitLab `/user` endpoint then updates the `gitlab_instances` row
- [ ] Frontend calls this command on Save, shows a "Validating..." loading state
- [ ] On success, shows confirmation and collapses the edit input
- [ ] On failure, shows an inline error message (e.g., "Invalid token") without closing the edit input
- [ ] Command is registered in the Tauri command handler
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-005: Display token lifetime on each instance
**Description:** As a user, I want to see when my token expires and how many days are left so I can plan ahead.

**Acceptance Criteria:**
- [ ] Each instance item shows expiration info below the existing metadata (e.g., "Expires Mar 15, 2026 — 38 days left")
- [ ] If the token has no expiration, shows "No expiration"
- [ ] If the token info can't be fetched (e.g., network error), shows nothing or a subtle "Unable to fetch token info" note
- [ ] Token info is fetched when the Settings page mounts
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

### US-006: Show expiration warning badge
**Description:** As a user, I want a visual warning when my token expires within 30 days so I notice before it breaks.

**Acceptance Criteria:**
- [ ] When a token expires in < 30 days, show a yellow warning badge/indicator (e.g., "Expiring soon")
- [ ] When a token is already expired, show a red badge (e.g., "Expired")
- [ ] Badges appear next to the expiration text in the instance list
- [ ] No badge shown when token has > 30 days remaining or no expiration
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

## Functional Requirements

- FR-1: The backend must call `GET /personal_access_tokens/self` on the GitLab API to retrieve token metadata including `expires_at`
- FR-2: A new Tauri command `get_token_info` must return token expiration and metadata for a given instance
- FR-3: A new Tauri command `update_instance_token` must validate a new token via the GitLab API then update the database row
- FR-4: Each instance in the Settings list must display an "Edit Token" button that reveals an inline password input
- FR-5: Token updates must be validated against the GitLab API before persisting (same as initial setup)
- FR-6: Each instance must display the token expiration date and remaining days (e.g., "Expires Mar 15, 2026 — 38 days left")
- FR-7: A yellow warning badge must appear when expiration is < 30 days; a red badge when expired

## Non-Goals

- No automatic token refresh or renewal (GitLab PATs can't be refreshed programmatically)
- No push notifications or system-level alerts for expiring tokens
- No migration of tokens from SQLite to the system keychain (separate effort)
- No bulk token rotation across multiple instances
- No display of token scopes or other metadata beyond expiration

## Design Considerations

- Reuse existing Settings page layout and CSS patterns (`.instance-item`, `.instance-meta`)
- The inline edit should feel lightweight — no modal, just an expanding input row
- Warning badges should use the same colour conventions as the existing "Token missing" indicator
- Token lifetime info should load asynchronously and not block the Settings page render

## Technical Considerations

- GitLab's `GET /personal_access_tokens/self` endpoint requires a valid token and `api` or `read_api` scope — both of which are already required by the app
- Token expiration may be `null` (tokens created without expiry) — handle gracefully
- The `update_instance_token` command should reuse the existing `GitLabClient::validate_token()` logic and then issue an SQL UPDATE (not a full upsert with URL)
- Frontend should call `get_token_info` for all instances in parallel on Settings mount to avoid sequential loading

## Success Metrics

- Users can update a token in < 3 clicks (Edit Token → paste → Save)
- Token lifetime is visible at a glance without navigating to GitLab
- Expiring tokens are visually obvious before they cause sync failures

## Open Questions

- Should token lifetime info also be shown on the MR list sidebar or only on Settings?
- Should the app periodically re-check token expiry in the background (e.g., during sync), or only when the user opens Settings?
