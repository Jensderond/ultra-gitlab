# PRD: Monaco Editor Integration for Code Review

## Introduction

Replace the current custom DiffViewer component with Monaco Editor's diff capabilities to provide a professional-grade code review experience. The current implementation uses tree-sitter for syntax highlighting and a custom React-based diff renderer, which has limitations in syntax highlighting coverage, lacks modern editor features (code folding, minimap, find & replace), and struggles with performance on large diffs.

Monaco Editor, the engine behind VS Code, provides battle-tested diff rendering, superior syntax highlighting for 50+ languages, and built-in features that will significantly improve the review workflow. This integration will be implemented in phases, starting with core diff functionality and progressively adding advanced features.

## Goals

- Replace tree-sitter syntax highlighting with Monaco's superior language support
- Add code folding, minimap, and find & replace capabilities
- Improve performance for large diffs (10k+ lines) using Monaco's virtual rendering
- Support both unified (inline) and side-by-side diff views via Monaco's diff editor
- Integrate inline comments using Monaco's decoration and widget APIs
- Implement Kanagawa Wave theme for consistent visual identity
- Maintain all existing keyboard shortcuts and navigation patterns

## User Stories

### Phase 1: Core Monaco Diff Integration

#### US-001: Set up Monaco Editor package and configuration
**Description:** As a developer, I need Monaco Editor properly configured in the project so it can be used for diff rendering.

**Acceptance Criteria:**
- [ ] Install `@monaco-editor/react` and `monaco-editor` packages
- [ ] Configure Monaco webpack/vite plugin for worker loading
- [ ] Create `MonacoProvider` component for app-wide configuration
- [ ] Monaco loads without console errors
- [ ] Typecheck passes

---

#### US-002: Create Kanagawa Wave theme for Monaco
**Description:** As a user, I want the diff viewer to use the Kanagawa Wave color scheme so the UI has a cohesive, aesthetically pleasing appearance.

**Acceptance Criteria:**
- [ ] Create Monaco theme definition based on Kanagawa Wave palette
- [ ] Theme includes colors for: editor background, line numbers, selection, diff added/removed highlights
- [ ] Syntax highlighting tokens match Kanagawa Wave spec (keywords, strings, comments, functions, etc.)
- [ ] Theme registered and applied on Monaco initialization
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

#### US-003: Create MonacoDiffViewer component with side-by-side view
**Description:** As a reviewer, I want to see file changes in a side-by-side diff view so I can easily compare old and new code.

**Acceptance Criteria:**
- [ ] Create `MonacoDiffViewer` component using Monaco's `DiffEditor`
- [ ] Component accepts `originalContent` and `modifiedContent` props
- [ ] Renders side-by-side diff with synchronized scrolling
- [ ] Displays correct syntax highlighting based on file extension
- [ ] Shows line numbers on both sides
- [ ] Diff additions highlighted in green, deletions in red (Kanagawa palette)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

#### US-004: Add unified (inline) diff view mode
**Description:** As a reviewer, I want to toggle between side-by-side and unified diff views based on my preference or screen size.

**Acceptance Criteria:**
- [ ] Add `viewMode` prop to MonacoDiffViewer: `'unified' | 'split'`
- [ ] Unified mode shows changes inline (deletions above additions)
- [ ] Toggle button switches between modes
- [ ] Current `x` keyboard shortcut works to toggle view mode
- [ ] View mode preference persists during session
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

#### US-005: Integrate MonacoDiffViewer into MRDetailPage
**Description:** As a reviewer, I want the new Monaco diff viewer to replace the current diff viewer so I get the improved experience.

**Acceptance Criteria:**
- [ ] Replace `DiffViewer` import with `MonacoDiffViewer` in MRDetailPage
- [ ] Fetch file content (original and modified) from GitLab API
- [ ] Pass content to MonacoDiffViewer component
- [ ] File navigation still works (n/p keys, click selection)
- [ ] View mode toggle still works
- [ ] Loading and error states display correctly
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

#### US-006: Add minimap to diff viewer
**Description:** As a reviewer, I want a minimap showing the full file structure so I can quickly navigate to different sections.

**Acceptance Criteria:**
- [ ] Enable Monaco minimap on the modified (right) side
- [ ] Minimap shows diff decorations (green/red regions)
- [ ] Clicking minimap navigates to that position
- [ ] Minimap can be toggled on/off via settings or keyboard shortcut
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

#### US-007: Add code folding support
**Description:** As a reviewer, I want to collapse unchanged code regions so I can focus on the actual changes.

**Acceptance Criteria:**
- [ ] Enable Monaco's built-in code folding
- [ ] Fold/unfold icons appear in gutter for foldable regions
- [ ] Unchanged regions between diff hunks can be collapsed
- [ ] Folding state preserved when switching between files
- [ ] Keyboard shortcuts for fold/unfold work (Ctrl+Shift+[ / ])
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

#### US-008: Add find and replace functionality
**Description:** As a reviewer, I want to search within the diff so I can quickly find specific code patterns or text.

**Acceptance Criteria:**
- [ ] Ctrl/Cmd+F opens Monaco's find widget
- [ ] Search highlights matches in both original and modified panes
- [ ] Find next/previous (F3/Shift+F3 or Enter/Shift+Enter) works
- [ ] Search is scoped to current file
- [ ] Replace functionality disabled (read-only mode)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### Phase 2: Comments Integration

#### US-009: Display existing comments using Monaco decorations
**Description:** As a reviewer, I want to see existing comments inline in the diff so I can follow the discussion in context.

**Acceptance Criteria:**
- [ ] Fetch comments for current file from backend
- [ ] Render comment indicators in Monaco's glyph margin (line with comment icon)
- [ ] Comments decorated with subtle background highlight on the line
- [ ] Multiple comments on same line show count badge
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

#### US-010: Show comment content in Monaco hover widget
**Description:** As a reviewer, I want to hover over a comment indicator to see the comment content without leaving my position.

**Acceptance Criteria:**
- [ ] Hovering over comment glyph shows Monaco hover widget
- [ ] Hover displays: author, timestamp, comment body (markdown rendered)
- [ ] Multiple comments show as stacked in hover
- [ ] Hover stays open while mouse is over it
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

#### US-011: Add comment via Monaco widget
**Description:** As a reviewer, I want to add comments on specific lines using an inline widget so I don't lose my context.

**Acceptance Criteria:**
- [ ] Clicking gutter or pressing `c` on a line opens comment input widget
- [ ] Widget appears below the target line as Monaco view zone
- [ ] Textarea for comment body with markdown support
- [ ] Submit button posts comment to GitLab API
- [ ] Cancel button or Escape closes widget without saving
- [ ] After submit, new comment appears in decorations
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

#### US-012: Support comment threads (replies)
**Description:** As a reviewer, I want to reply to existing comments to continue a discussion thread.

**Acceptance Criteria:**
- [ ] Clicking a comment decoration expands full thread as view zone
- [ ] Thread shows all replies in chronological order
- [ ] Reply input field at bottom of thread
- [ ] Submitting reply adds to thread and syncs with GitLab
- [ ] Thread can be collapsed back to decoration
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### Phase 3: Performance & Polish

#### US-013: Optimize large file loading
**Description:** As a reviewer, I want large diffs to load quickly so I'm not blocked waiting for the editor.

**Acceptance Criteria:**
- [ ] Files >10k lines load within 500ms (Monaco handles virtual rendering)
- [ ] Show loading skeleton while content is fetched
- [ ] Progressive loading for very large files (fetch visible range first)
- [ ] Memory usage stays reasonable (<200MB for 50k line files)
- [ ] Typecheck passes
- [ ] Performance verified with large test files

---

#### US-014: Add diff navigation shortcuts
**Description:** As a reviewer, I want keyboard shortcuts to jump between changes so I can review efficiently.

**Acceptance Criteria:**
- [ ] `]` key jumps to next diff hunk
- [ ] `[` key jumps to previous diff hunk
- [ ] Navigation wraps around at file boundaries
- [ ] Current change highlighted briefly after navigation
- [ ] Works in both unified and split view modes
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

#### US-015: Preserve scroll position and state
**Description:** As a reviewer, I want my position preserved when switching between files so I don't lose context.

**Acceptance Criteria:**
- [ ] Scroll position saved when leaving a file
- [ ] Position restored when returning to previously viewed file
- [ ] Fold states preserved per file
- [ ] State cleared when MR changes or user explicitly resets
- [ ] Typecheck passes

---

#### US-016: Add "viewed" status integration
**Description:** As a reviewer, I want to mark files as viewed and have that status visible in the navigation.

**Acceptance Criteria:**
- [ ] `v` key marks current file as viewed
- [ ] Viewed files show checkmark in file navigation (existing behavior)
- [ ] Viewed status optionally synced to GitLab (if API supports)
- [ ] Viewed files can be filtered/hidden in navigation
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

### Phase 4: Advanced Features (Future)

#### US-017: Add inline suggestions capability
**Description:** As a reviewer, I want to suggest specific code changes inline so authors can apply them directly.

**Acceptance Criteria:**
- [ ] "Suggest change" option when adding comment
- [ ] Opens Monaco editor for suggestion text
- [ ] Suggestion stored as special comment format
- [ ] Displayed as diff-within-diff in comment widget
- [ ] Author can apply suggestion with one click (future MR)
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

#### US-018: Support multiple theme options
**Description:** As a user, I want to choose between different editor themes based on my preference.

**Acceptance Criteria:**
- [ ] Theme selector in settings with options: Kanagawa Wave, VS Dark, VS Light
- [ ] Theme preference persisted to local storage
- [ ] Theme applied immediately on change
- [ ] All themes have proper diff highlighting colors
- [ ] Typecheck passes
- [ ] Verify in browser using dev-browser skill

---

## Functional Requirements

### Core Editor
- FR-1: Monaco Editor must be loaded asynchronously to not block initial page render
- FR-2: Diff editor must support both `inline` and `sideBySide` render modes
- FR-3: Syntax highlighting must auto-detect from file extension (fallback to plaintext)
- FR-4: Editor must be read-only (no direct file editing during review)
- FR-5: Minimap must show diff decorations (additions/deletions as colored regions)
- FR-6: Code folding must work for language constructs and unchanged diff regions

### Comments
- FR-7: Comments must be displayed using Monaco's IEditorDecorationsCollection API
- FR-8: Comment widgets must use Monaco's IContentWidget or IViewZone APIs
- FR-9: Comment glyph margin decorations must be clickable
- FR-10: Comment input must support markdown with preview

### Navigation
- FR-11: All existing keyboard shortcuts must continue to work (n, p, ], [, x, a, v, c, Escape)
- FR-12: Diff hunk navigation must use Monaco's `editor.getLineChanges()` API
- FR-13: File navigation must remain in separate sidebar component (not in Monaco)

### Theme
- FR-14: Kanagawa Wave theme must be the default
- FR-15: Theme must define all Monaco token colors for consistent highlighting
- FR-16: Diff colors must be: additions (#76946a with 20% opacity bg), deletions (#c34043 with 20% opacity bg)

### Performance
- FR-17: Initial diff render must complete in <200ms for files under 5k lines
- FR-18: Monaco workers must be loaded from local bundle (not CDN)
- FR-19: Only one Monaco editor instance should exist at a time (dispose on file change)

## Non-Goals (Out of Scope)

- **Editing capability**: Users cannot edit files directly in the review view (suggestions are separate)
- **Multi-file diff view**: Single file at a time (file tabs not in scope)
- **Git blame integration**: Line-by-line blame annotations not included
- **Custom language definitions**: Only Monaco's built-in language support
- **Real-time collaboration**: No presence indicators or live cursors
- **Offline comment drafts**: Comments require connectivity (existing behavior)
- **Image diff**: Binary/image files not handled by Monaco integration

## Design Considerations

### UI Layout
- Monaco editor replaces the current `DiffViewer` component area
- File navigation sidebar remains unchanged
- Header with MR info and approval button remains unchanged
- Footer with keyboard hints updated to reflect Monaco shortcuts

### Kanagawa Wave Palette (Reference)
```
Background:       #1f1f28 (sumiInk3)
Foreground:       #dcd7ba (fujiWhite)
Selection:        #2d4f67 (waveBlue2)
Line Numbers:     #54546d (sumiInk6)
Comments:         #727169 (fujiGray)
Strings:          #98bb6c (springGreen)
Keywords:         #957fb8 (oniViolet)
Functions:        #7e9cd8 (crystalBlue)
Diff Added BG:    #76946a33 (springGreen @ 20%)
Diff Removed BG:  #c3404333 (autumnRed @ 20%)
Diff Added Line:  #76946a (springGreen)
Diff Removed Line:#c34043 (autumnRed)
```

### Component Architecture
```
MRDetailPage
├── Header (unchanged)
├── Content
│   ├── FileNavigation (unchanged)
│   └── MonacoDiffViewer (new)
│       ├── Monaco DiffEditor
│       ├── CommentDecorations
│       └── CommentWidgets
└── Footer (updated shortcuts)
```

## Technical Considerations

### Dependencies
- `@monaco-editor/react` - React wrapper for Monaco
- `monaco-editor` - Core Monaco package
- Vite plugin for Monaco worker bundling

### Monaco Configuration
```typescript
// Key Monaco options for diff editor
{
  readOnly: true,
  renderSideBySide: true | false, // based on viewMode
  enableSplitViewResizing: true,
  minimap: { enabled: true, side: 'right' },
  folding: true,
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  automaticLayout: true,
}
```

### File Content Fetching
- Need new API endpoint or GitLab API integration to fetch raw file content
- Current implementation fetches parsed diff hunks; Monaco needs full file content
- May need to fetch: `base_sha` version and `head_sha` version of each file

### State Management
- Per-file state: scroll position, fold states, expanded comments
- Session state: view mode preference, theme preference
- Consider using React context or zustand for Monaco-related state

## Success Metrics

- Diff viewer loads in <200ms for typical files (<2k lines)
- Large files (10k+ lines) load in <500ms
- Users can navigate changes with keyboard at same speed or faster than current implementation
- Comment workflow (view, add, reply) works without page navigation
- No increase in memory usage compared to current virtual scrolling implementation
- Zero regressions in existing keyboard navigation

## Open Questions

1. **File content API**: Does GitLab API provide raw file content at specific SHA, or do we need to fetch via git blob endpoints?
2. **Comment position mapping**: How do Monaco line numbers map to GitLab's old_line/new_line for comments?
3. **Unified view implementation**: Does Monaco's DiffEditor support true unified view, or do we need to simulate it?
4. **Theme hot-reloading**: Should theme changes apply immediately or require page refresh?
5. **Worker bundling**: What's the optimal Vite configuration for Monaco workers to minimize bundle size?

## Implementation Phases Summary

| Phase | Stories | Focus | Est. Complexity |
|-------|---------|-------|-----------------|
| 1 | US-001 to US-008 | Core Monaco integration, views, navigation features | Medium-High |
| 2 | US-009 to US-012 | Comments via decorations and widgets | Medium |
| 3 | US-013 to US-016 | Performance optimization and polish | Medium |
| 4 | US-017 to US-018 | Advanced features (suggestions, themes) | Low-Medium |

Recommend completing Phase 1 before moving to Phase 2, as comments depend on stable editor integration.
