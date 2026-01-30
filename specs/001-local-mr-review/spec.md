# Feature Specification: Local-First GitLab MR Review

**Feature Branch**: `001-local-mr-review`
**Created**: 2026-01-30
**Status**: Draft
**Input**: User description: "Local-first GitLab MR review tool with background sync, keyboard shortcuts, and tree-sitter syntax highlighting"

## Clarifications

### Session 2026-01-30

- Q: Which MRs should the system sync by default? → A: Sync MRs where user is author or assigned reviewer
- Q: How should sync conflicts be resolved? → A: Auto-merge non-conflicting; silently discard conflicting local actions
- Q: What features are explicitly out of scope? → A: Merging MRs, pipeline/CI triggers, and issue management (review tool only)
- Q: How long should cached MR data be retained? → A: Keep only open MRs; purge immediately when merged/closed
- Q: What level of sync activity visibility should the UI provide? → A: Summary status bar with expandable detail log (last 50 operations)
- Q: What is the UX philosophy for loading states? → A: No loading spinners; all MRs and diffs must be pre-cached locally before display

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Browse and Review MRs Offline-Fast (Priority: P1)

A developer opens the application to review pending merge requests. The MR list loads instantly from local cache, showing all MRs with their current status. The user navigates through MRs using keyboard shortcuts, viewing diffs with proper syntax highlighting. All interactions feel instantaneous because data is served from local storage.

**Why this priority**: This is the core value proposition. Without fast, local-first MR browsing and diff viewing, the tool offers no advantage over the GitLab web interface.

**Independent Test**: Can be fully tested by loading the app with a pre-populated local cache and navigating MRs entirely offline. Delivers immediate value by enabling fast code review.

**Acceptance Scenarios**:

1. **Given** the application has previously synced MRs, **When** the user launches the app, **Then** the MR list displays within 200ms without network activity
2. **Given** an MR is selected, **When** the user presses the "view diff" shortcut, **Then** the diff view opens within 100ms with syntax-highlighted code
3. **Given** the user is viewing a diff, **When** they press navigation shortcuts (j/k or arrow keys), **Then** the cursor moves between changed lines instantly
4. **Given** network is unavailable, **When** the user browses cached MRs, **Then** all previously synced data remains accessible

---

### User Story 2 - Approve and Comment with Optimistic Updates (Priority: P2)

A reviewer reads through an MR diff, adds inline comments, and approves the MR. Each action appears completed immediately in the UI. The system queues these actions and syncs them to GitLab in the background. If sync fails, the user is notified but their work is preserved locally.

**Why this priority**: Approvals and comments are the primary output of code review. Optimistic updates make the tool feel native and fast, differentiating it from web-based alternatives.

**Independent Test**: Can be tested by approving an MR while offline, then verifying the approval syncs when connectivity returns.

**Acceptance Scenarios**:

1. **Given** the user is viewing an MR, **When** they press the approve shortcut, **Then** the UI immediately shows "Approved" status without waiting for server response
2. **Given** the user adds an inline comment, **When** they submit it, **Then** the comment appears in the diff view instantly and is queued for background sync
3. **Given** pending actions exist in the sync queue, **When** network becomes available, **Then** actions sync to GitLab within 30 seconds
4. **Given** a sync fails, **When** the user views the MR, **Then** they see a visual indicator of pending/failed sync with retry option

---

### User Story 3 - Background Sync of New MRs (Priority: P3)

The application continuously monitors GitLab for new merge requests in the background. When new MRs appear or existing ones are updated, the app fetches them with their diffs and comments, storing everything locally. The user sees a notification of new/updated MRs without interrupting their current work.

**Why this priority**: Background sync enables the "always ready" experience but depends on the core review functionality (P1) and action handling (P2) being in place first.

**Independent Test**: Can be tested by creating an MR in GitLab and verifying it appears in the app within the sync interval without manual refresh.

**Acceptance Scenarios**:

1. **Given** the app is running, **When** a new MR is created on GitLab, **Then** it appears in the local MR list within 5 minutes
2. **Given** background sync is running, **When** a new MR is detected, **Then** the diff and all comments are fetched and stored locally
3. **Given** the user is reviewing an MR, **When** background sync completes, **Then** a non-intrusive notification shows the count of new/updated MRs
4. **Given** the sync interval is configurable, **When** the user sets it to 2 minutes, **Then** sync checks occur every 2 minutes

---

### User Story 4 - Keyboard-Driven Navigation (Priority: P4)

Power users navigate the entire application using only keyboard shortcuts. Common actions like switching between MRs, jumping to files, adding comments, and approving are all accessible via memorable key combinations. A command palette provides discoverability for less common actions.

**Why this priority**: Keyboard navigation is essential for power users but builds on top of the core MR viewing functionality.

**Independent Test**: Can be tested by performing a complete MR review (navigate, read diff, comment, approve) without using mouse.

**Acceptance Scenarios**:

1. **Given** the MR list is displayed, **When** the user presses j/k, **Then** the selection moves down/up through the list
2. **Given** the user presses a modifier+p shortcut, **When** the command palette opens, **Then** they can search and execute any available action
3. **Given** the user is in the diff view, **When** they press 'c', **Then** an inline comment input appears at the current line
4. **Given** shortcuts are customizable, **When** the user rebinds a shortcut, **Then** the new binding takes effect immediately

---

### Edge Cases

- What happens when the local cache exceeds available disk space? System MUST warn when cache approaches configurable limit and offer to prune old MRs.
- How does the system handle MRs with very large diffs (>10,000 lines)? Large diffs MUST load progressively, showing visible portions first.
- What happens when an MR is merged/closed on GitLab while the user has pending local actions? System MUST detect conflicts during sync and notify user of stale actions.
- How does the system handle concurrent edits (user comments while someone else updates the MR)? System MUST auto-merge non-conflicting changes and silently discard conflicting local actions (e.g., comment on deleted line).
- What happens when GitLab authentication expires? System MUST prompt for re-authentication without losing pending local changes.

## Requirements *(mandatory)*

### Functional Requirements

**Local-First Data Management**

- **FR-001**: System MUST store all fetched MR data (metadata, diffs, comments, approvals) in local persistent storage
- **FR-002**: System MUST serve all read operations from local storage without network requests
- **FR-003**: System MUST maintain a sync queue for all write operations (comments, approvals, reactions)
- **FR-004**: System MUST process the sync queue in order when network is available, with automatic retry on failure
- **FR-005**: System MUST preserve pending changes across application restarts
- **FR-005a**: System MUST purge cached MR data immediately when an MR is merged or closed; only open MRs are retained locally

**Background Synchronization**

- **FR-006**: System MUST fetch new and updated MRs where the user is author or assigned reviewer at a configurable interval (default: 5 minutes)
- **FR-007**: System MUST fetch complete diff content for each MR during sync (proactive caching; diffs are never fetched on-demand)
- **FR-008**: System MUST fetch all comments, discussions, and approval states for each MR
- **FR-009**: System MUST display sync status via a summary status bar (last sync time, sync in progress, errors) with an expandable detail log showing the last 50 sync operations
- **FR-010**: Users MUST be able to manually trigger a sync at any time

**Diff Viewing**

- **FR-011**: System MUST display diffs with syntax highlighting powered by tree-sitter grammars
- **FR-012**: System MUST support side-by-side and unified diff views
- **FR-013**: System MUST allow navigation between changed files within an MR
- **FR-014**: System MUST highlight inline comments at their respective line positions
- **FR-015**: System MUST support collapsing/expanding unchanged code regions

**Review Actions**

- **FR-016**: Users MUST be able to approve MRs with immediate UI feedback (optimistic update)
- **FR-017**: Users MUST be able to add inline comments on specific lines of the diff
- **FR-018**: Users MUST be able to reply to existing comment threads
- **FR-019**: Users MUST be able to resolve/unresolve discussion threads
- **FR-020**: System MUST visually distinguish between synced and pending-sync actions

**Keyboard Navigation**

- **FR-021**: All primary actions MUST be accessible via keyboard shortcuts
- **FR-022**: System MUST provide a command palette for action discovery and execution
- **FR-023**: Users MUST be able to customize keyboard shortcuts
- **FR-024**: System MUST display available shortcuts in a help overlay (triggered by '?' key)

**User Experience (No-Spinner Philosophy)**

- **FR-024a**: System MUST NOT display loading spinners for MR list or diff views; all content is served from pre-cached local data
- **FR-024b**: System MUST only show loading indicators during initial setup (first sync) or explicit manual sync requests
- **FR-024c**: If cached data is unavailable for a requested view, system MUST show "Not yet synced" placeholder rather than triggering on-demand fetch with spinner

**Authentication**

- **FR-025**: System MUST authenticate with GitLab using Personal Access Tokens
- **FR-026**: System MUST store tokens securely in the operating system's credential store
- **FR-027**: System MUST support multiple GitLab instances (self-hosted and gitlab.com)

### Key Entities

- **MergeRequest**: Represents a GitLab MR with metadata (title, author, status, source/target branches, labels, reviewers), relationships to Diffs and Comments
- **Diff**: The changed files in an MR, including file paths, change type (added/modified/deleted), and line-by-line content with syntax tokens
- **Comment**: An inline comment or discussion on a diff, including author, content, line reference, resolution status, and replies
- **SyncAction**: A queued local action (approval, comment, reply) pending synchronization, including action type, payload, retry count, and status
- **GitLabInstance**: A configured GitLab server with URL, authentication credentials, and sync settings

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: MR list displays within 200ms of application launch when cache exists
- **SC-002**: Diff view opens within 100ms of user request for cached MRs
- **SC-003**: User actions (approve, comment) show visual completion within 50ms
- **SC-004**: 95% of background syncs complete within 60 seconds for repositories with <100 open MRs
- **SC-005**: Application remains responsive (no UI freezes >100ms) during background sync operations
- **SC-006**: Users can complete a full review cycle (read diff, add 3 comments, approve) in under 5 minutes using only keyboard
- **SC-007**: Pending actions survive application crash/restart with 100% reliability
- **SC-008**: Application uses less than 500MB RAM with 100 cached MRs
- **SC-009**: Syntax highlighting covers at least 20 common programming languages
- **SC-010**: Zero loading spinners shown during normal operation (MR browsing, diff viewing) after initial sync completes

## Assumptions

- Users have valid GitLab Personal Access Tokens with appropriate scopes (read_api, write_api minimum)
- Target GitLab instances support API v4
- Users have sufficient disk space for local MR cache (estimated 10-50MB per MR with full diffs)
- Tree-sitter grammars are available for languages used in target repositories
- Default sync interval of 5 minutes balances freshness with API rate limits
- Keyboard shortcut defaults follow vim-style conventions (j/k navigation, common in developer tools)

## Out of Scope

This is a **review-focused tool**. The following features are explicitly excluded:

- **Merging MRs**: Users review and approve only; actual merge actions are performed in GitLab web UI
- **Pipeline/CI management**: Pipeline status is view-only; no triggering, retrying, or canceling jobs
- **Issue management**: No issue creation, linking, or tracking functionality
- **Repository browsing**: No file tree navigation outside of MR diffs
- **Code editing**: Read-only diff viewing; no inline code modifications
