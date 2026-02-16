# PRD: Notifications

## Introduction

Add a notification system to Ultra GitLab that alerts users about important events: when their merge requests are ready to merge and when pipelines change status on pinned projects. Notifications are delivered both as native macOS notifications and via an in-app notification bell. This is a fire-and-forget system — notifications are displayed and dismissed, with no persistent history.

A new "Notifications" tab in the Settings page lets users configure which notification types are enabled.

## Goals

- Alert users immediately when one of their MRs becomes ready to merge (all approvals met + pipeline passed)
- Alert users when pipeline status changes on their pinned projects in the Pipelines dashboard
- Deliver notifications via both native OS (macOS Notification Center) and an in-app bell icon
- Provide a Settings tab where users can toggle notification preferences per type
- Keep the system lightweight — no notification history, no persistence, fire-and-forget

## User Stories

### US-001: Add notification preferences storage
**Description:** As a developer, I need to persist notification preferences so they survive app restarts.

**Acceptance Criteria:**
- [ ] Add a `notification_settings` table (or key-value entries in existing settings) storing: `mr_ready_to_merge` (bool, default true), `pipeline_status_pinned` (bool, default true), `native_notifications_enabled` (bool, default true)
- [ ] Add a Tauri command `get_notification_settings` that returns current settings
- [ ] Add a Tauri command `update_notification_settings` that saves changes
- [ ] Defaults are applied on first launch / migration
- [ ] Typecheck passes (`cargo check`)

### US-002: Add Notifications tab to Settings page
**Description:** As a user, I want a Notifications tab in Settings so I can control which notifications I receive.

**Acceptance Criteria:**
- [ ] New "Notifications" section/tab in the Settings page (consistent with existing sections)
- [ ] Toggle for "MR ready to merge" — enable/disable notifications when your MR has all approvals and pipeline passed
- [ ] Toggle for "Pipeline status (pinned projects)" — enable/disable notifications when a pinned project's pipeline status changes
- [ ] Toggle for "Native OS notifications" — master toggle to enable/disable macOS Notification Center delivery
- [ ] Settings persist immediately on toggle (auto-save, like existing sync settings)
- [ ] Typecheck passes (`bunx tsc --noEmit`)
- [ ] **Verify in browser using dev-browser skill**

### US-003: Detect "MR ready to merge" condition
**Description:** As a backend developer, I need logic that detects when an MR transitions to a "ready to merge" state so a notification can be fired.

**Acceptance Criteria:**
- [ ] During sync, after fetching MR data, compare previous and current state for each MR authored by the user
- [ ] "Ready to merge" means: `approval_status == 'approved'` AND `approvals_count >= approvals_required` AND the MR's latest pipeline status is `success`
- [ ] Only fire when the MR was NOT ready before and IS ready now (transition detection, not every sync)
- [ ] Track previously-notified MR IDs in memory (not DB) to avoid duplicate notifications within a session
- [ ] Emit a Tauri event `notification:mr-ready` with MR title, project name, and web URL
- [ ] Typecheck passes (`cargo check`)

### US-004: Detect pipeline status changes on pinned projects
**Description:** As a backend developer, I need logic that detects when a pinned project's pipeline status changes so a notification can be fired.

**Acceptance Criteria:**
- [ ] When pipeline statuses are fetched (during poll refresh), compare previous status to new status for each pinned project
- [ ] Fire notification when status changes (e.g., `running` → `success`, `running` → `failed`, `pending` → `running`)
- [ ] Only fire for pinned projects, not all tracked projects
- [ ] Emit a Tauri event `notification:pipeline-changed` with project name, old status, new status, branch name, and web URL
- [ ] Do not fire on first load (no "previous" status to compare against)
- [ ] Typecheck passes (`cargo check`)

### US-005: Native macOS notification delivery
**Description:** As a user, I want to receive native macOS notifications so I see alerts even when the app is in the background.

**Acceptance Criteria:**
- [ ] Use Tauri's notification plugin (`tauri-plugin-notification`) to send native OS notifications
- [ ] MR ready notification shows: title "MR Ready to Merge", body with MR title and project name
- [ ] Pipeline notification shows: title "Pipeline {status}" (e.g., "Pipeline Failed"), body with project name and branch
- [ ] Clicking a native notification brings the app to the foreground
- [ ] Notifications respect the "Native OS notifications" master toggle from settings
- [ ] Notifications respect per-type toggles (MR ready / pipeline status)
- [ ] Typecheck passes (`cargo check`)

### US-006: In-app notification bell with toast display
**Description:** As a user, I want to see notifications inside the app via a bell icon and brief toast messages so I don't miss events while the app is focused.

**Acceptance Criteria:**
- [ ] Bell icon in the app header/sidebar area (near sync status or top-right)
- [ ] When a notification fires, show a toast/snackbar that auto-dismisses after ~5 seconds
- [ ] Toast for MR ready: shows MR title, project name, and a "View" link that opens the MR web URL
- [ ] Toast for pipeline: shows project name, new status, branch, and a "View" link that opens the pipeline URL
- [ ] Bell icon shows a temporary dot/badge when a toast is active (clears when toast dismisses)
- [ ] Multiple toasts stack vertically (max 3 visible, older ones dismissed)
- [ ] Typecheck passes (`bunx tsc --noEmit`)
- [ ] **Verify in browser using dev-browser skill**

### US-007: Wire notification events to delivery layer
**Description:** As a developer, I need to connect the Rust-emitted notification events to both the native OS delivery and the in-app toast system.

**Acceptance Criteria:**
- [ ] Frontend listens to `notification:mr-ready` and `notification:pipeline-changed` Tauri events
- [ ] On event receipt, check notification settings to determine which delivery channels are enabled
- [ ] If native notifications enabled + type enabled → send native notification via Tauri notification plugin
- [ ] Always show in-app toast when type is enabled (in-app delivery is always on if the type toggle is on)
- [ ] Typecheck passes (`bunx tsc --noEmit`)

## Functional Requirements

- FR-1: The system must store notification preferences (MR ready, pipeline status, native OS toggle) that persist across restarts
- FR-2: The Settings page must include a Notifications section with toggles for each notification type and native OS delivery
- FR-3: The system must detect when a user's MR transitions to "ready to merge" (all approvals met + pipeline succeeded) during sync
- FR-4: The system must detect when a pinned project's pipeline status changes during pipeline polling
- FR-5: The system must send native macOS notifications via Tauri's notification plugin when enabled
- FR-6: The system must display in-app toast notifications that auto-dismiss after ~5 seconds
- FR-7: The system must show a bell icon with a temporary activity indicator when notifications fire
- FR-8: Notification detection must be transition-based (state change only), not on every sync cycle
- FR-9: Clicking "View" in a toast must open the relevant web URL (MR or pipeline) in the default browser
- FR-10: All notification type toggles default to enabled on fresh install

## Non-Goals (Out of Scope)

- No notification history or persistence — this is fire-and-forget
- No notification sound customization
- No per-project or per-MR notification granularity (all MRs or none, all pinned pipelines or none)
- No notification for MRs you're reviewing (only MRs you authored)
- No notification grouping or batching
- No "do not disturb" scheduling
- No notification for unpinned pipeline projects
- No cross-device notification sync

## Design Considerations

- The bell icon should match the existing sidebar/header design language
- Toast notifications should appear in a consistent corner (bottom-right or top-right) and not overlap the main content
- Settings toggles should follow the same pattern as existing sync scope checkboxes in Settings
- Keep the notification text concise — MR title may need truncation for long titles

## Technical Considerations

- **Tauri notification plugin**: Use `tauri-plugin-notification` for native macOS notifications. Must be added to `Cargo.toml` and registered in `src-tauri/src/lib.rs`
- **MR ready detection**: Runs inside `sync_engine.rs` after MR fetch phase. Needs access to previous MR state (in-memory cache of `approval_status` + pipeline status per MR)
- **Pipeline detection**: Runs in the frontend `PipelinesPage` polling logic or in a new Rust service. The frontend already tracks `statuses` state — comparing old vs. new on each refresh is straightforward
- **Event flow**: Rust emits `notification:*` events → Frontend event listeners → check settings → dispatch to native + toast
- **Settings storage**: Can reuse the existing settings key-value pattern (if one exists) or add a simple `notification_settings` table
- **No new sync overhead**: MR ready detection piggybacks on the existing sync cycle; pipeline detection piggybacks on existing poll refresh

## Success Metrics

- Users are notified within one sync cycle (~1-5 minutes) when their MR becomes ready to merge
- Users are notified within one poll cycle (~30s-2min) when a pinned pipeline status changes
- Native notifications appear in macOS Notification Center when the app is backgrounded
- In-app toasts are visible and auto-dismiss without user action

## Open Questions

- Should clicking a native macOS notification navigate within the app (e.g., open the MR detail page) or just bring the app to the foreground?
- Should pipeline notifications distinguish between "important" transitions (e.g., → failed) and "routine" ones (e.g., → running)?
- Should the bell icon live in the sidebar header area or in a top-level app bar?
