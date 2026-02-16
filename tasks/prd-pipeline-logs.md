# PRD: Pipeline Job Log Viewer

## Introduction

Add the ability to view job logs (traces) directly within Ultra GitLab. When a user clicks a job on the PipelineDetailPage, they navigate to a dedicated JobLogPage that displays the full log output with ANSI color rendering. For running jobs, the log streams in real-time via polling with an auto-scroll "follow" mode, so users can watch builds progress without leaving the app or opening GitLab in a browser.

## Goals

- Let users view the full log output for any pipeline job without leaving Ultra GitLab
- Stream logs in real-time for running jobs by polling the GitLab trace API
- Render ANSI escape codes as colored text (matching GitLab's terminal color output)
- Provide a "follow" mode that auto-scrolls to the bottom as new output arrives
- Keep logs in memory during the session (no persistent caching)

## User Stories

### US-001: Add Rust command to fetch job trace
**Description:** As a developer, I need a backend command that fetches the raw log output for a job from GitLab's API so the frontend can display it.

**Acceptance Criteria:**
- [ ] New `get_job_trace` command in `src-tauri/src/commands/pipeline.rs`
- [ ] Calls `GET /projects/:id/jobs/:job_id/trace` on the GitLab API
- [ ] Returns the raw log text as a `String`
- [ ] Registered in `commands/mod.rs` and `lib.rs` `generate_handler!`
- [ ] Handles 404 (no log available) gracefully with an empty string or clear error
- [ ] Typecheck passes (`cargo check`)

### US-002: Create JobLogPage route and navigation
**Description:** As a user, I want to click a job on the PipelineDetailPage and navigate to a full-page log view so I can focus on reading the output.

**Acceptance Criteria:**
- [ ] New route: `/pipelines/:projectId/:pipelineId/jobs/:jobId`
- [ ] New page component: `src/pages/JobLogPage.tsx` with corresponding CSS
- [ ] Clicking a job row on PipelineDetailPage navigates to this route (carries `instanceId`, job name, and job status as search params)
- [ ] Back button/Escape key returns to the PipelineDetailPage
- [ ] Page header shows: job name, status badge, duration, and stage
- [ ] Route registered in `App.tsx`
- [ ] Typecheck passes (`bunx tsc --noEmit`)
- [ ] Verify in browser using dev-browser skill

### US-003: Fetch and display job log with ANSI color support
**Description:** As a user, I want to see the job's log output with terminal colors preserved so I can read it as easily as in a real terminal.

**Acceptance Criteria:**
- [ ] On page load, fetches the job trace via the `get_job_trace` command
- [ ] Renders ANSI escape codes as colored `<span>` elements (standard 8/16/256 colors + bold/dim/italic/underline)
- [ ] Uses a monospace font in a dark terminal-style container
- [ ] Shows a loading spinner while the initial fetch is in progress
- [ ] Shows an empty state message if the job has no log output (e.g., "manual" or "created" jobs)
- [ ] Typecheck passes (`bunx tsc --noEmit`)
- [ ] Verify in browser using dev-browser skill

### US-004: Stream logs for running jobs via polling
**Description:** As a user, I want to watch a running job's log update in real-time so I can monitor build progress live.

**Acceptance Criteria:**
- [ ] When the job status is `running`, `pending`, or `created`, polls the trace endpoint every 3 seconds
- [ ] Appends only new content (tracks byte offset of last fetch, uses string length comparison or content diffing)
- [ ] Stops polling when the job finishes (detect status change by re-fetching job metadata periodically)
- [ ] Pauses polling when the browser tab/window is not visible (use `document.visibilitychange`)
- [ ] Shows a "Live" indicator badge in the header when actively streaming
- [ ] Typecheck passes (`bunx tsc --noEmit`)
- [ ] Verify in browser using dev-browser skill

### US-005: Follow mode with auto-scroll
**Description:** As a user, I want the log to auto-scroll to the bottom as new lines appear so I don't have to manually scroll down during a running job.

**Acceptance Criteria:**
- [ ] "Follow" toggle button visible in the log toolbar (enabled by default for running jobs)
- [ ] When follow is ON, the log container auto-scrolls to the bottom on each new content update
- [ ] When the user manually scrolls up, follow mode automatically disables
- [ ] When the user scrolls back to the bottom, follow mode re-enables
- [ ] Follow button visually indicates its current state (on/off)
- [ ] Typecheck passes (`bunx tsc --noEmit`)
- [ ] Verify in browser using dev-browser skill

### US-006: Add tauri service wrapper and types
**Description:** As a developer, I need the frontend service layer updated so the new command is accessible from React.

**Acceptance Criteria:**
- [ ] New `getJobTrace` function in `src/services/tauri.ts` wrapping the `get_job_trace` invoke
- [ ] Re-exported from `src/services/index.ts`
- [ ] Typecheck passes (`bunx tsc --noEmit`)

## Functional Requirements

- FR-1: `GET /projects/:id/jobs/:job_id/trace` endpoint called via Rust backend, returning raw text
- FR-2: New route `/pipelines/:projectId/:pipelineId/jobs/:jobId` renders the JobLogPage
- FR-3: Clicking a job row on PipelineDetailPage navigates to the job log route
- FR-4: ANSI escape codes in the log output are parsed and rendered as styled `<span>` elements
- FR-5: Log container uses monospace font on a dark background (terminal aesthetic)
- FR-6: For active jobs (running/pending/created), poll the trace endpoint every 3 seconds
- FR-7: Polling appends only new content rather than re-rendering the entire log
- FR-8: Polling pauses when the window is not visible and resumes when it regains focus
- FR-9: Polling stops when the job reaches a terminal status (success/failed/canceled/skipped)
- FR-10: Follow mode auto-scrolls to the bottom of the log on new content
- FR-11: Follow mode disengages when the user scrolls up, re-engages when they scroll to the bottom
- FR-12: Page header displays job name, status badge, stage, duration, and a "Live" indicator when streaming
- FR-13: Back navigation (button + Escape key) returns to PipelineDetailPage
- FR-14: Log content is held in React state (in-memory only, no SQLite persistence)

## Non-Goals

- No collapsible log sections (GitLab `section_start`/`section_end` markers) — future enhancement
- No log search/filter/find within the log text
- No log downloading or copying to clipboard
- No WebSocket-based streaming (polling is sufficient for v1)
- No caching of logs in SQLite — in-memory only
- No multi-job log viewing (one job at a time)
- No syntax highlighting beyond ANSI colors

## Design Considerations

- **Terminal aesthetic**: Dark background (#1e1e1e or similar), monospace font (system monospace or JetBrains Mono if available), matching the existing app's dark theme
- **Status badges**: Reuse existing status dot/label patterns from PipelineDetailPage
- **Layout**: Full-width log container below a compact header bar, maximizing vertical space for log content
- **Follow button**: Positioned in a sticky toolbar at the top of the log area
- **"Live" badge**: Pulsing indicator (reuse `pipelinePulse` animation) next to the job status when streaming

## Technical Considerations

- **ANSI parsing**: Use an ANSI-to-HTML library (e.g., `ansi-to-html` npm package) or write a lightweight parser for SGR sequences. GitLab logs primarily use standard 8-color and 256-color ANSI codes.
- **Incremental rendering**: For large logs, appending only new text to a pre-rendered container avoids re-rendering thousands of lines on each poll. Consider using `dangerouslySetInnerHTML` on a single container or a ref-based DOM append approach.
- **Scroll detection**: Use `IntersectionObserver` or scroll event listener on the log container to detect if the user is at the bottom (for follow mode toggling).
- **Byte offset tracking**: Track the length of the previously fetched trace string. On each poll, if the new response is longer, extract and render only the new suffix. GitLab's trace endpoint returns the full log each time, so diffing by length is the simplest approach.
- **Memory management**: Very large logs (>10MB) could impact performance. Consider truncating the displayed head of the log if it exceeds a threshold, keeping only the most recent N lines visible.
- **Job status refresh**: Poll job metadata (via existing `getPipelineJobs`) at a slower interval (e.g., every 10 seconds) to detect when a running job finishes, then stop log polling.

## Success Metrics

- Users can view a job's full log within 2 clicks from the PipelineDetailPage
- Running job logs update in real-time with ≤3 second latency
- ANSI colors render correctly for standard GitLab CI output
- No performance degradation for logs under 50,000 lines
- Follow mode correctly tracks the bottom of the log without jank

## Open Questions

- Should we add a line-number gutter to the log display? (Could help with referencing specific lines but adds complexity)
- What is the maximum log size we should handle before showing a "log too large" warning? (GitLab caps at ~4MB for the trace API)
- Should the job status in the header update live (requiring a secondary poll), or is it acceptable to show the status as-of-navigation?
