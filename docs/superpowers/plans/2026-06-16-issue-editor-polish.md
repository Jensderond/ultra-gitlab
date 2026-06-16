# Issue Description Editor Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add emoji-safe selection, in-editor search, and an essential markdown formatting toolbar to the issue description CodeMirror editor.

**Architecture:** All editor logic lives in `IssueDescriptionEditor.tsx`; styling lives in `IssueDetailPage.css`. Selection and search are CodeMirror extensions added to the existing extension list. The toolbar is React markup rendered above the editor container, and its buttons share command functions with new keymap shortcuts. The built-in search panel is restyled via the existing `EditorView.theme` rather than rebuilt.

**Tech Stack:** React 19, TypeScript, CodeMirror 6 (`@codemirror/view`, `@codemirror/state`, `@codemirror/lang-markdown`, new `@codemirror/search`), Bun.

**Testing note:** This frontend has no unit-test harness (only Playwright e2e + `tsc`), and CodeMirror behavior must run in WKWebView. So each task verifies with `bunx tsc --noEmit` plus a concrete manual check in `bun run tauri dev` (open any issue → click the description → Edit). This matches the spec's testing section.

---

## File Structure

- **Modify** `src/pages/IssueDetailPage/IssueDescriptionEditor.tsx` — add imports, command functions, extensions, keymap shortcuts, toolbar markup, Escape guard.
- **Modify** `src/pages/IssueDetailPage/IssueDetailPage.css` — toolbar styles, selection styles, search-panel theme is in the TS `editorTheme` (CodeMirror requires it there), so CSS only gets the toolbar + card-radius adjustments.
- **Modify** `package.json` / lockfile — add `@codemirror/search`.

---

## Task 1: Add the `@codemirror/search` dependency

**Files:**
- Modify: `package.json`, `bun.lock`

- [ ] **Step 1: Install the package**

Run:
```bash
cd /Users/jens/Sites/ultra-gitlab
bun add @codemirror/search@^6.5.0
```
Expected: `package.json` gains `"@codemirror/search"` under dependencies; `node_modules/@codemirror/search` exists.

- [ ] **Step 2: Verify it resolves**

Run:
```bash
ls node_modules/@codemirror/search/dist/index.js && echo OK
```
Expected: prints `OK`.

- [ ] **Step 3: Commit**

```bash
git add package.json bun.lock
git commit -m "chore: add @codemirror/search dependency"
```

---

## Task 2: Emoji-safe selection via `drawSelection`

**Files:**
- Modify: `src/pages/IssueDetailPage/IssueDescriptionEditor.tsx`

- [ ] **Step 1: Import `drawSelection`**

In the `@codemirror/view` import line (currently `import { EditorView, keymap, placeholder } from '@codemirror/view';`), add `drawSelection`:

```ts
import { EditorView, keymap, placeholder, drawSelection } from '@codemirror/view';
```

- [ ] **Step 2: Add the extension**

In the `extensions: [...]` array (inside `EditorState.create`), add `drawSelection()` immediately after `history(),`:

```ts
          history(),
          drawSelection(),
          keymap.of([...defaultKeymap, ...historyKeymap]),
```

- [ ] **Step 3: Add selection theme rules**

In the `editorTheme` object (the `EditorView.theme({...})` near the top of the file), add these two rules after the `.cm-placeholder` rule:

```ts
  '.cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent-color) 22%, transparent)',
  },
  '&.cm-focused .cm-selectionBackground': {
    backgroundColor: 'color-mix(in srgb, var(--accent-color) 38%, transparent)',
  },
```

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual check**

Run `bun run tauri dev`, open an issue, Edit the description, type a line with an emoji (e.g. `hello 🎉 world`), then shift-select across the emoji. Expected: the whole selection (including the emoji) shows one uniform accent-tinted highlight; the highlight is brighter while the editor is focused.

- [ ] **Step 6: Commit**

```bash
git add src/pages/IssueDetailPage/IssueDescriptionEditor.tsx
git commit -m "feat: emoji-safe selection in issue description editor"
```

---

## Task 3: In-editor search (extension, keymap, panel theme, Escape guard)

**Files:**
- Modify: `src/pages/IssueDetailPage/IssueDescriptionEditor.tsx`

- [ ] **Step 1: Import search APIs**

Add a new import line after the `@codemirror/lang-markdown` import:

```ts
import { search, searchKeymap, highlightSelectionMatches, openSearchPanel } from '@codemirror/search';
```

(`openSearchPanel` is used by the toolbar button in Task 5; import it now so search is self-contained.)

- [ ] **Step 2: Add search extensions**

In the `extensions: [...]` array, add these two lines right after the `drawSelection(),` line from Task 2:

```ts
          search({ top: true }),
          highlightSelectionMatches(),
```

- [ ] **Step 3: Add `searchKeymap` to the keymap**

Change the existing non-highest keymap line from:

```ts
          keymap.of([...defaultKeymap, ...historyKeymap]),
```
to:
```ts
          keymap.of([...defaultKeymap, ...historyKeymap, ...searchKeymap]),
```

- [ ] **Step 4: Theme the search panel**

In the `editorTheme` object, add these rules after the selection rules from Task 2:

```ts
  '.cm-panels': {
    backgroundColor: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    borderColor: 'var(--border-color)',
  },
  '.cm-panels.cm-panels-top': {
    borderBottom: '1px solid var(--border-color)',
  },
  '.cm-panel.cm-search': {
    padding: '8px 10px',
    fontFamily: 'inherit',
    fontSize: '12px',
  },
  '.cm-panel.cm-search label': {
    fontSize: '12px',
    color: 'var(--text-secondary)',
  },
  '.cm-panel.cm-search input, .cm-panel.cm-search button': {
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border-color)',
    borderRadius: '4px',
    padding: '2px 6px',
    fontFamily: 'inherit',
  },
  '.cm-panel.cm-search button': {
    cursor: 'pointer',
    color: 'var(--text-secondary)',
  },
  '.cm-panel.cm-search button:hover': {
    color: 'var(--text-primary)',
    borderColor: 'var(--accent-color)',
  },
  '.cm-panel.cm-search button[name="close"]': {
    border: 'none',
    backgroundColor: 'transparent',
    fontSize: '16px',
  },
  '.cm-searchMatch': {
    backgroundColor: 'color-mix(in srgb, var(--accent-color) 28%, transparent)',
  },
  '.cm-searchMatch.cm-searchMatch-selected': {
    backgroundColor: 'color-mix(in srgb, var(--accent-color) 55%, transparent)',
  },
```

- [ ] **Step 5: Guard Escape so it closes the search panel before cancelling**

Replace the existing `handleKeyDown` function:

```ts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Must not bubble to the view-level handler, which would close the page.
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.stopPropagation();
    }
  };
```

with:

```ts
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      // Always stop the key here so it never reaches the page-level handler
      // (which would close the dialog).
      e.stopPropagation();
      // CodeMirror's search keymap calls preventDefault when it closes an open
      // search panel. In that case, swallow the key and keep editing.
      if (e.defaultPrevented) return;
      e.preventDefault();
      onCancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.stopPropagation();
    }
  };
```

- [ ] **Step 6: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors. (`openSearchPanel` is imported but unused until Task 5; if the lint/tsc config errors on unused imports, proceed to Task 5 in the same change before committing — but `tsc --noEmit` with default `noUnusedLocals` off will pass. If it fails on unused, temporarily reference it; Task 5 removes the need.)

- [ ] **Step 7: Manual check**

In `bun run tauri dev`, edit a description containing a long list/table. Press `⌘F`: a themed search panel appears at the top matching the app colors. Type a term — matches highlight, `Enter`/`⌘G` cycles through them. Press `Esc`: the panel closes and you stay in the editor. Press `Esc` again (no panel): editing cancels as before. Confirm `⌘Enter` still saves.

- [ ] **Step 8: Commit**

```bash
git add src/pages/IssueDetailPage/IssueDescriptionEditor.tsx
git commit -m "feat: themed in-editor search for issue description editor"
```

---

## Task 4: Markdown formatting command functions + keyboard shortcuts

**Files:**
- Modify: `src/pages/IssueDetailPage/IssueDescriptionEditor.tsx`

- [ ] **Step 1: Import `EditorSelection`**

In the `@codemirror/state` import line (currently `import { Compartment, EditorState, Prec } from '@codemirror/state';`), add `EditorSelection`:

```ts
import { Compartment, EditorState, Prec, EditorSelection } from '@codemirror/state';
```

- [ ] **Step 2: Add module-level command functions**

Add these functions at module scope, immediately after the `markdownHighlight` definition (before `export function IssueDescriptionEditor`):

```ts
/**
 * Wrap each selection range in `before`/`after` markers. With an empty
 * selection the markers are inserted and the caret is placed between them.
 */
function wrapSelection(view: EditorView, before: string, after: string) {
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to);
      const insert = before + text + after;
      const anchor = range.from + before.length;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(anchor, anchor + text.length),
      };
    })
  );
  view.focus();
}

/**
 * Replace the selection with a markdown link, placing the caret on the URL
 * placeholder so it can be typed over immediately.
 */
function insertLink(view: EditorView) {
  view.dispatch(
    view.state.changeByRange((range) => {
      const text = view.state.sliceDoc(range.from, range.to);
      const label = text || 'text';
      const insert = `[${label}](url)`;
      // [ + label + ]( = 3 + label.length chars before the url placeholder.
      const urlStart = range.from + 3 + label.length;
      return {
        changes: { from: range.from, to: range.to, insert },
        range: EditorSelection.range(urlStart, urlStart + 'url'.length),
      };
    })
  );
  view.focus();
}

/**
 * Toggle a `- ` bullet prefix on every line touched by the main selection.
 * If every touched line already has a bullet, the bullets are removed.
 */
function toggleBulletList(view: EditorView) {
  const { state } = view;
  const range = state.selection.main;
  const startLine = state.doc.lineAt(range.from);
  const endLine = state.doc.lineAt(range.to);
  const lines = [];
  for (let n = startLine.number; n <= endLine.number; n++) {
    lines.push(state.doc.line(n));
  }
  const bulletRe = /^(\s*)- /;
  const allBulleted = lines.every((line) => bulletRe.test(line.text));
  const changes = lines.map((line) => {
    if (allBulleted) {
      const match = line.text.match(bulletRe);
      const indent = match ? match[1].length : 0;
      const markerEnd = match ? match[0].length : 0;
      return { from: line.from + indent, to: line.from + markerEnd, insert: '' };
    }
    return { from: line.from, to: line.from, insert: '- ' };
  });
  view.dispatch({ changes });
  view.focus();
}
```

- [ ] **Step 3: Add keyboard shortcuts to the highest-precedence keymap**

In the `Prec.highest(keymap.of([ ... ]))` block, add three bindings after the existing `Mod-Enter` object (the `latestRef` is already in scope and tracks `busy`):

```ts
              {
                key: 'Mod-b',
                run: (v) => {
                  if (!latestRef.current.busy) wrapSelection(v, '**', '**');
                  return true;
                },
              },
              {
                key: 'Mod-i',
                run: (v) => {
                  if (!latestRef.current.busy) wrapSelection(v, '_', '_');
                  return true;
                },
              },
              {
                key: 'Mod-k',
                run: (v) => {
                  if (!latestRef.current.busy) insertLink(v);
                  return true;
                },
              },
```

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Manual check**

In `bun run tauri dev`, edit a description. Select a word and press `⌘B` → it becomes `**word**` with the word still selected. Press `⌘I` on a selection → `_word_`. With no selection press `⌘B` → `****` with caret between the markers. Press `⌘K` on a selected word → `[word](url)` with `url` selected. Confirm `⌘Enter` still saves and `Esc` still cancels.

- [ ] **Step 6: Commit**

```bash
git add src/pages/IssueDetailPage/IssueDescriptionEditor.tsx
git commit -m "feat: markdown formatting commands and shortcuts in issue editor"
```

---

## Task 5: Formatting toolbar UI + search button

**Files:**
- Modify: `src/pages/IssueDetailPage/IssueDescriptionEditor.tsx`
- Modify: `src/pages/IssueDetailPage/IssueDetailPage.css`

- [ ] **Step 1: Add a toolbar-action helper inside the component**

Inside `IssueDescriptionEditor`, after the `handleSave` function, add a helper that runs a command on the live view (guards on `busy`):

```ts
  const runCommand = (fn: (view: EditorView) => void) => {
    const view = viewRef.current;
    if (!busy && view) fn(view);
  };
```

- [ ] **Step 2: Render the toolbar above the editor container**

Replace the JSX return's opening (from `<div className="issue-description-editor">` through the editor container `<div ... onKeyDown={handleKeyDown} />`) so the toolbar sits inside the card, above the CodeMirror container. Replace:

```tsx
    <div className="issue-description-editor">
      <div
        ref={containerRef}
        className="issue-description-editor-cm"
        onKeyDown={handleKeyDown}
      />
```

with:

```tsx
    <div className="issue-description-editor">
      <div className="issue-description-editor-shell">
        <div className="issue-description-editor-toolbar" role="toolbar" aria-label="Formatting">
          <button
            type="button"
            className="editor-tool-button"
            title="Bold (⌘B)"
            aria-label="Bold"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runCommand((v) => wrapSelection(v, '**', '**'))}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M7 5h6a3.5 3.5 0 0 1 0 7H7zM7 12h7a3.5 3.5 0 0 1 0 7H7z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className="editor-tool-button"
            title="Italic (⌘I)"
            aria-label="Italic"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runCommand((v) => wrapSelection(v, '_', '_'))}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M10 5h7M7 19h7M14 5l-4 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
          <button
            type="button"
            className="editor-tool-button"
            title="Inline code"
            aria-label="Inline code"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runCommand((v) => wrapSelection(v, '`', '`'))}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 8l-4 4 4 4M15 8l4 4-4 4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className="editor-tool-button"
            title="Link (⌘K)"
            aria-label="Link"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runCommand(insertLink)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M10 14a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1 1M14 10a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1-1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          <button
            type="button"
            className="editor-tool-button"
            title="Bulleted list"
            aria-label="Bulleted list"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runCommand(toggleBulletList)}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M9 6h11M9 12h11M9 18h11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="4.5" cy="6" r="1.5" fill="currentColor" />
              <circle cx="4.5" cy="12" r="1.5" fill="currentColor" />
              <circle cx="4.5" cy="18" r="1.5" fill="currentColor" />
            </svg>
          </button>
          <button
            type="button"
            className="editor-tool-button editor-tool-button--end"
            title="Find (⌘F)"
            aria-label="Find"
            disabled={busy}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => runCommand((v) => openSearchPanel(v))}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="11" cy="11" r="6" stroke="currentColor" strokeWidth="2" />
              <path d="M20 20l-4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <div
          ref={containerRef}
          className="issue-description-editor-cm"
          onKeyDown={handleKeyDown}
        />
      </div>
```

Note: the existing `</div>` that previously closed `.issue-description-editor` still closes it after the actions block — you have added one new wrapper `.issue-description-editor-shell` that must be closed. Ensure the closing `</div>` for `.issue-description-editor-shell` is placed right after the `issue-description-editor-cm` div and before `.issue-description-editor-actions`. The final structure is:

```tsx
    <div className="issue-description-editor">
      <div className="issue-description-editor-shell">
        <div className="issue-description-editor-toolbar" ...>...</div>
        <div ref={containerRef} className="issue-description-editor-cm" onKeyDown={handleKeyDown} />
      </div>
      <div className="issue-description-editor-actions">...</div>
    </div>
```

- [ ] **Step 3: Move the border from the cm container onto the shell**

In `IssueDetailPage.css`, replace the `.issue-description-editor-cm` and `:focus-within` rules:

```css
.issue-description-editor-cm {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  overflow: hidden;
  box-sizing: border-box;
}

.issue-description-editor-cm:focus-within {
  border-color: var(--accent-color);
}
```

with:

```css
.issue-description-editor-shell {
  width: 100%;
  border: 1px solid var(--border-color);
  border-radius: 6px;
  background: var(--bg-primary);
  overflow: hidden;
  box-sizing: border-box;
}

.issue-description-editor-shell:focus-within {
  border-color: var(--accent-color);
}

.issue-description-editor-cm {
  width: 100%;
  box-sizing: border-box;
}
```

- [ ] **Step 4: Add toolbar + button styles**

In `IssueDetailPage.css`, add after the `.issue-description-editor-shell:focus-within` rule:

```css
.issue-description-editor-toolbar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px 6px;
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
}

.editor-tool-button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--text-secondary);
  cursor: pointer;
}

.editor-tool-button:hover:not(:disabled) {
  background: var(--bg-primary);
  color: var(--text-primary);
}

.editor-tool-button:disabled {
  opacity: 0.4;
  cursor: default;
}

.editor-tool-button--end {
  margin-left: auto;
}
```

- [ ] **Step 5: Typecheck**

Run: `bunx tsc --noEmit`
Expected: no errors (and `openSearchPanel` is now used).

- [ ] **Step 6: Manual check**

In `bun run tauri dev`, edit a description. Confirm: a toolbar strip with five formatting icons and a right-aligned search icon sits flush above the editor as one card. Clicking each button applies formatting without losing the text cursor (because `onMouseDown` preventDefault keeps focus). The search icon opens the search panel. Toolbar buttons are dimmed and inert while saving (`busy`). Border highlights in accent color on focus.

- [ ] **Step 7: Commit**

```bash
git add src/pages/IssueDetailPage/IssueDescriptionEditor.tsx src/pages/IssueDetailPage/IssueDetailPage.css
git commit -m "feat: formatting toolbar for issue description editor"
```

---

## Task 6: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Typecheck the whole project**

Run: `bunx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Lint the changed files**

Run: `bunx eslint src/pages/IssueDetailPage/IssueDescriptionEditor.tsx`
Expected: no new errors (pre-existing warnings elsewhere are acceptable).

- [ ] **Step 3: Run the full manual checklist from the spec**

In `bun run tauri dev`, on an issue description (use one with a long markdown table for search):
1. Selection spans an emoji with a uniform highlight.
2. `⌘F` opens the themed panel; search highlights and navigates matches in the table.
3. Each toolbar button works with a selection and with an empty caret.
4. Bulleted-list button toggles on, then off, across a multi-line selection.
5. `Esc` closes the search panel when open; `Esc` cancels editing when no panel.
6. `⌘Enter` saves; Cancel works; all buttons disabled while saving.

- [ ] **Step 4: Final commit if any cleanup was needed**

```bash
git add -A
git commit -m "chore: issue editor polish verification cleanup"
```
(Skip if nothing changed.)

---

## Self-Review Notes

- **Spec coverage:** Feature 1 → Task 2; Feature 2 → Tasks 1, 3 (+ search button in Task 5); Feature 3 → Tasks 4 (commands/shortcuts) + 5 (toolbar UI). Escape-vs-search guard → Task 3 Step 5. Manual test list → Task 6.
- **Type consistency:** `wrapSelection(view, before, after)`, `insertLink(view)`, `toggleBulletList(view)`, and `runCommand(fn)` signatures are used identically in their definitions (Task 4 / Task 5 Step 1) and call sites (Task 4 Step 3 keymap, Task 5 Step 2 toolbar). `openSearchPanel` imported in Task 3, first used in Task 5.
- **No placeholders:** every code step shows complete code; the only "url"/"text" strings are intentional markdown placeholders inserted into the document.
