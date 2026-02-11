# PRD: My MRs Screen & Global Navigation Sidebar

## Introduction

Add a "My MRs" screen that shows merge requests authored by the current user, focused on tracking approval status and comments rather than code review. Introduce a global icon sidebar (~80px) for navigating between the MR list, My MRs, and Settings — replacing the current direct-route navigation pattern with a persistent, always-visible navigation rail.

## Goals

- Provide authors a dedicated view to monitor the status of their own merge requests
- Show per-reviewer approval status at a glance (who approved, who hasn't)
- Surface all comments (inline + general) so authors can track feedback without opening code diffs
- Introduce a consistent global navigation pattern via an icon sidebar
- Keep the code review tab accessible but secondary — authors rarely need to review their own diffs

## User Stories

### US-001: Add global navigation sidebar
**Description:** As a user, I want a persistent icon sidebar so that I can quickly switch between the MR list, My MRs, and Settings without relying on keyboard shortcuts alone.

**Acceptance Criteria:**
- [ ] Sidebar is ~80px wide, rendered on the left edge of the app on all pages
- [ ] First icon: MR list (navigates to `/mrs`)
- [ ] Second icon: My MRs (navigates to `/my-mrs`)
- [ ] Bottom-pinned icon: Settings cog (navigates to `/settings`)
- [ ] Active page is visually indicated (highlight/accent on the active icon)
- [ ] Sidebar is visible on every screen (MR list, My MRs, Settings, detail views)
- [ ] Existing page layouts shift right to accommodate the sidebar
- [ ] Typecheck passes (`bunx tsc --noEmit`)
- [ ] **Verify in browser using dev-browser skill**

### US-002: Add Cmd+M / Ctrl+M shortcut to navigate to My MRs
**Description:** As a user, I want to press Cmd+M (macOS) / Ctrl+M (Linux/Windows) to jump to the My MRs screen from anywhere in the app.

**Acceptance Criteria:**
- [ ] Cmd+M / Ctrl+M navigates to `/my-mrs` from any screen
- [ ] Shortcut is registered in the global keyboard shortcut system
- [ ] Shortcut appears in the keyboard help overlay (`?` key)
- [ ] Shortcut is listed in the command palette (Cmd+P)
- [ ] If already on My MRs, shortcut is a no-op (no re-render/flash)
- [ ] Typecheck passes

### US-003: Create My MRs page with author-filtered MR list
**Description:** As a user, I want to see a list of merge requests I authored so that I can monitor their progress.

**Acceptance Criteria:**
- [ ] New route `/my-mrs` renders the My MRs page
- [ ] Page queries only **open** MRs where `author_username` matches the authenticated user of the selected instance
- [ ] MR list shows: state badge, MR IID, project name, title, relative time, branch info, labels
- [ ] Draft/WIP MRs are visually distinguished via a `::after` pseudo-element on the MR list item (brown-orange color)
- [ ] Shows approval summary per MR (e.g., "2/3 approved") inline in the list
- [ ] Supports keyboard navigation (j/k/↑/↓ to move, Enter to open)
- [ ] Supports multiple instances (instance selector if >1 configured)
- [ ] Shows empty state when user has no authored MRs
- [ ] Typecheck passes
- [ ] **Verify in browser using dev-browser skill**

### US-004: My MR detail view — Overview tab with per-reviewer approvals
**Description:** As an MR author, I want to see exactly who has approved, who hasn't, and who requested changes so I know what's blocking my MR.

**Acceptance Criteria:**
- [ ] Selecting an MR from the My MRs list opens a detail view
- [ ] Default tab is "Overview"
- [ ] Overview tab shows: MR title, description, state, branches, labels
- [ ] Shows a reviewer list with each reviewer's name/username and their individual status (approved / pending / changes requested)
- [ ] Approvals required vs. approvals received is visible (e.g., "2 of 3 required approvals")
- [ ] Typecheck passes
- [ ] **Verify in browser using dev-browser skill**

### US-005: My MR detail view — Comments tab
**Description:** As an MR author, I want to see all comments and discussions on my MR so I can respond to feedback.

**Acceptance Criteria:**
- [ ] Comments tab shows all comments for the MR (both inline code comments and general discussion)
- [ ] Each comment shows: author, timestamp, body (rendered markdown), file path + line (if inline)
- [ ] Comments are grouped by discussion thread
- [ ] Resolved vs. unresolved threads are visually distinguished
- [ ] Thread count or unresolved count shown on the tab label (e.g., "Comments (3)")
- [ ] Typecheck passes
- [ ] **Verify in browser using dev-browser skill**

### US-006: My MR detail view — Code tab (secondary)
**Description:** As an MR author, I occasionally want to look at the code diff of my own MR.

**Acceptance Criteria:**
- [ ] A "Code" tab is available in the My MR detail view
- [ ] Code tab reuses the existing diff viewer / file navigation from MRDetailPage
- [ ] Tab is not the default — user must explicitly switch to it
- [ ] Typecheck passes
- [ ] **Verify in browser using dev-browser skill**

### US-007: Fetch and store per-reviewer approval data
**Description:** As a developer, I need to fetch individual reviewer approval statuses from the GitLab API so the frontend can display them.

**Acceptance Criteria:**
- [ ] Rust backend fetches approval rules or merge request approvals endpoint from GitLab API
- [ ] Stores per-reviewer data: reviewer username, approval status, avatar URL (if available)
- [ ] Data is cached locally in SQLite (new table or extension of existing)
- [ ] Data refreshes on sync cycle
- [ ] Tauri command `get_mr_reviewers(mrId)` exposes data to frontend
- [ ] Typecheck passes (`cargo check` for Rust)

## Functional Requirements

- FR-1: The app must render a persistent ~80px icon sidebar on the left edge with navigation icons for MR List, My MRs, and Settings
- FR-2: The active page must be visually indicated in the sidebar
- FR-3: Cmd+M / Ctrl+M must navigate to the My MRs screen from any page
- FR-4: The My MRs page must filter merge requests to only show **open** MRs authored by the authenticated user
- FR-4a: Draft/WIP MRs must be visually distinguished with a brown-orange `::after` indicator on the list item
- FR-5: The My MRs list must display approval summary (count) per MR inline
- FR-6: Selecting an MR from My MRs must open a detail view with three tabs: Overview (default), Comments, Code
- FR-7: The Overview tab must show per-reviewer approval status (reviewer name + approved/pending/changes_requested)
- FR-8: The Comments tab must show all comments (inline + general), grouped by discussion thread, with resolved/unresolved distinction
- FR-9: The Code tab must reuse the existing diff viewer components from MRDetailPage
- FR-10: The My MRs list must support keyboard navigation (j/k/Enter) consistent with the existing MR list
- FR-11: The backend must fetch and cache per-reviewer approval data from the GitLab API

## Non-Goals

- No ability to approve/unapprove from the My MRs screen (that's a reviewer action, not an author action)
- No ability to post or reply to comments from the My MRs screen (read-only view of comments for now)
- No merge/close actions from this screen
- No notification system or badges for new comments/approvals
- No filtering/sorting within the My MRs list (e.g., by project) in this iteration — only open MRs shown
- No collapsible/resizable sidebar — fixed width
- No "awaiting review" status for requested-but-not-responded reviewers

## Design Considerations

- **Sidebar icons:** Use simple, recognizable icons — a list/inbox icon for MR List, a user/person icon for My MRs, a cog/gear for Settings
- **Sidebar layout:** Icons centered vertically in ~80px column, Settings icon pinned to bottom
- **Active state:** Accent color background or left-edge indicator bar on the active icon
- **Tab design in detail view:** Horizontal tabs below the MR header — "Overview", "Comments (N)", "Code"
- **Reviewer list:** Table or card layout with avatar placeholder, username, and status icon/badge per reviewer
- **Comment threads:** Collapsible thread groups with file path breadcrumb for inline comments
- **Draft/WIP indicator:** MR list items for draft MRs use a `::after` pseudo-element with a brown-orange color (consistent with "work in progress" semantics)
- **Reuse:** The MR list item component can be adapted for My MRs (remove the `userHasApproved` filter, add approval summary)

## Technical Considerations

- **GitLab API for reviewer approvals:** The `/projects/:id/merge_requests/:iid/approval_state` endpoint provides per-rule, per-reviewer approval status. Alternatively, `/projects/:id/merge_requests/:iid/approvals` gives a simpler list. Investigate which provides the needed granularity.
- **New DB table:** `mr_reviewers` table with columns: `mr_id`, `username`, `status` (approved/pending/changes_requested), `avatar_url`, `cached_at`
- **Author filtering:** Use existing `author_username` field in `merge_requests` table, matched against `authenticated_username` from `gitlab_instances`
- **Existing component reuse:**
  - `MRList` / `MRListItem` — adapt for My MRs list (different filter, add approval count)
  - `MonacoDiffViewer` / file nav — reuse wholesale for Code tab
  - `useKeyboardNav` — reuse for list navigation
- **Router changes:** Add `/my-mrs` and `/my-mrs/:id` routes in App.tsx
- **Sidebar component:** New `AppSidebar` component wrapping all page content via layout route or App.tsx

## Success Metrics

- User can see all their authored MRs and per-reviewer approval status within 2 clicks (or 1 shortcut)
- Comments tab surfaces all discussion threads without needing to open code diffs
- Navigation between MR List, My MRs, and Settings is always one click away via sidebar
- No regression in existing MR list or detail page performance

## Resolved Questions

1. **Sidebar visibility:** Sidebar is always visible on every screen, including Settings.
2. **MR state filter:** Only open MRs are shown in the My MRs list.
3. **Comment interaction:** Read-only for now. No replying from this screen.
4. **Draft/WIP MRs:** Distinguished via a brown-orange `::after` pseudo-element on the list item.
5. **Awaiting review:** Not needed — only show reviewers who have actively responded (approved / changes requested / pending based on approval rules).
