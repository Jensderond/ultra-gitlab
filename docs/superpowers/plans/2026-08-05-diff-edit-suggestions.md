# Diff Edit Mode → GitLab Suggestions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users author GitLab suggestion comments by editing the diff in place (pierre 1.3 Edit mode), via a floating "Suggest edit" button on the MRDetailPage diff pane.

**Architecture:** A floating control enters edit mode on the existing `MultiFileDiff` (wrapped in pierre's `EditProvider`). On confirm, a pure line-diff (`computeEditedRegion`) between the original new-side content and the edited content yields one region + replacement, which feeds the existing `buildGitLabSuggestionBlock` → `CommentOverlay` → `addInlineComment` path unchanged.

**Tech Stack:** React 19, TypeScript, `@pierre/diffs` 1.3.3 (`/react`, `/edit` subpath exports), vitest (unit), Playwright chromium (e2e), Tauri 2 WKWebView (manual gate).

**Spec:** `docs/superpowers/specs/2026-08-05-diff-edit-suggestions-design.md`

## Global Constraints

- Package manager is **bun**: `bun install`, `bunx tsc --noEmit`, `bunx vitest run`, `bunx playwright test`.
- `@pierre/diffs` manifest version: `^1.3.3` (1.3.3 is already what the lockfile resolves; the manifest bump is documentation-of-reality).
- Desktop-only: every edit-mode UI element is hidden when `isIOS` (`src/services/transport.ts`) is true.
- One suggestion per edit session; disjoint edits collapse to the full first-to-last changed span.
- Nothing posts to GitLab without an explicit submit in `CommentOverlay`.
- Line numbers in `computeEditedRegion` results are **1-based** and refer to the **new side** of the diff.
- All MR hotkeys must be inert while edit mode is active, except Escape (which cancels edit mode). Do not rely on `e.target.isContentEditable` — pierre's editor lives in a shadow root and events retarget to the `DIFFS-CONTAINER` host.
- The pre-commit hook runs eslint + playwright and regenerates screenshot PNGs; commits are slow — that's expected. Check `git status` before each commit: unrelated changes (bun.lock, screenshots, skills dirs) are already dirty in this repo — never sweep them into a task commit; always `git add` explicit paths.

---

### Task 1: `computeEditedRegion` pure util (TDD)

**Files:**
- Modify: `src/utils/gitlabSuggestions.ts` (append new function; existing exports unchanged)
- Create: `src/utils/gitlabSuggestions.test.ts`
- Modify: `package.json` (add `"test": "vitest run"` to scripts)

**Interfaces:**
- Consumes: nothing new.
- Produces (Task 5 relies on these exact shapes):
  ```ts
  export interface EditedRegion {
    startLine: number;   // 1-based, inclusive, new side
    endLine: number;     // 1-based, inclusive
    replacement: string; // '' means "delete these lines"
  }
  export function computeEditedRegion(original: string, edited: string): EditedRegion | null;
  ```
  Returns `null` when contents are identical after `\r\n` → `\n` normalization.

- [ ] **Step 1: Add the test script**

In `package.json` scripts (next to `"test:e2e"`), add:

```json
"test": "vitest run",
```

- [ ] **Step 2: Write the failing tests**

Create `src/utils/gitlabSuggestions.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { computeEditedRegion } from './gitlabSuggestions';

describe('computeEditedRegion', () => {
  it('returns null for identical content', () => {
    expect(computeEditedRegion('a\nb\nc', 'a\nb\nc')).toBeNull();
  });

  it('returns null for identical content with CRLF differences', () => {
    expect(computeEditedRegion('a\r\nb\r\nc', 'a\nb\nc')).toBeNull();
  });

  it('detects a single-line change', () => {
    expect(computeEditedRegion('a\nb\nc', 'a\nB\nc')).toEqual({
      startLine: 2,
      endLine: 2,
      replacement: 'B',
    });
  });

  it('detects a change on the last line', () => {
    expect(computeEditedRegion('a\nb', 'a\nB')).toEqual({
      startLine: 2,
      endLine: 2,
      replacement: 'B',
    });
  });

  it('detects a multi-line block change', () => {
    expect(computeEditedRegion('a\nb\nc\nd', 'a\nX\nY\nd')).toEqual({
      startLine: 2,
      endLine: 3,
      replacement: 'X\nY',
    });
  });

  it('detects a change that grows the line count', () => {
    expect(computeEditedRegion('a\nb\nc', 'a\nX\nY\nZ\nc')).toEqual({
      startLine: 2,
      endLine: 2,
      replacement: 'X\nY\nZ',
    });
  });

  it('expands a pure insertion in the middle to include the line above', () => {
    expect(computeEditedRegion('a\nb\nc', 'a\nX\nb\nc')).toEqual({
      startLine: 1,
      endLine: 1,
      replacement: 'a\nX',
    });
  });

  it('expands a pure insertion at the top to include the line below', () => {
    expect(computeEditedRegion('a\nb', 'X\na\nb')).toEqual({
      startLine: 1,
      endLine: 1,
      replacement: 'X\na',
    });
  });

  it('expands a pure insertion at the bottom to include the line above', () => {
    expect(computeEditedRegion('a\nb', 'a\nb\nX')).toEqual({
      startLine: 2,
      endLine: 2,
      replacement: 'b\nX',
    });
  });

  it('returns an empty replacement for a pure deletion', () => {
    expect(computeEditedRegion('a\nb\nc', 'a\nc')).toEqual({
      startLine: 2,
      endLine: 2,
      replacement: '',
    });
  });

  it('collapses disjoint edits to the full span', () => {
    expect(computeEditedRegion('a\nb\nc\nd\ne', 'a\nB\nc\nD\ne')).toEqual({
      startLine: 2,
      endLine: 4,
      replacement: 'B\nc\nD',
    });
  });

  it('handles files with trailing newlines', () => {
    expect(computeEditedRegion('a\nb\n', 'a\nB\n')).toEqual({
      startLine: 2,
      endLine: 2,
      replacement: 'B',
    });
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `bunx vitest run src/utils/gitlabSuggestions.test.ts`
Expected: FAIL — `computeEditedRegion` is not exported.

- [ ] **Step 4: Implement `computeEditedRegion`**

Append to `src/utils/gitlabSuggestions.ts`:

```ts
export interface EditedRegion {
  /** 1-based, inclusive, on the new side of the diff. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
  /** Replacement text for the region; '' means "delete these lines". */
  replacement: string;
}

/**
 * Line-diff the original new-side content against the edited content and
 * return the single changed region (full span if edits are disjoint).
 *
 * GitLab suggestions must replace at least one existing line, so pure
 * insertions are expanded to include an adjacent original line, repeated
 * unchanged in the replacement.
 */
export function computeEditedRegion(original: string, edited: string): EditedRegion | null {
  const origLines = original.replace(/\r\n/g, '\n').split('\n');
  const editLines = edited.replace(/\r\n/g, '\n').split('\n');

  let start = 0;
  const maxStart = Math.min(origLines.length, editLines.length);
  while (start < maxStart && origLines[start] === editLines[start]) start++;

  let origEnd = origLines.length - 1;
  let editEnd = editLines.length - 1;
  while (origEnd >= start && editEnd >= start && origLines[origEnd] === editLines[editEnd]) {
    origEnd--;
    editEnd--;
  }

  if (start > origEnd && start > editEnd) return null;

  let replacement = editLines.slice(start, editEnd + 1).join('\n');

  if (origEnd < start) {
    // Pure insertion: expand to replace one adjacent original line.
    if (start > 0) {
      const lineAbove = start; // 1-based number of the line above the insertion
      return { startLine: lineAbove, endLine: lineAbove, replacement: `${origLines[start - 1]}\n${replacement}` };
    }
    return { startLine: 1, endLine: 1, replacement: `${replacement}\n${origLines[0]}` };
  }

  return { startLine: start + 1, endLine: origEnd + 1, replacement };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `bunx vitest run src/utils/gitlabSuggestions.test.ts`
Expected: all PASS.

- [ ] **Step 6: Typecheck and commit**

```bash
bunx tsc --noEmit
git add src/utils/gitlabSuggestions.ts src/utils/gitlabSuggestions.test.ts package.json
git commit -m "feat(suggestions): computeEditedRegion line-diff util"
```

---

### Task 2: `editMode` in the view reducer (TDD)

**Files:**
- Modify: `src/pages/MRDetailPage/viewReducer.ts`
- Create: `src/pages/MRDetailPage/viewReducer.test.ts`

**Interfaces:**
- Consumes: existing `ViewState` / `ViewAction` in `viewReducer.ts`.
- Produces (Tasks 4–5 rely on these):
  - `ViewState.editMode: boolean` (initial `false`)
  - Actions: `{ type: 'ENTER_EDIT_MODE' }`, `{ type: 'EXIT_EDIT_MODE' }`
  - `SELECT_FILE` and `SET_VIEW_MODE` both force `editMode: false`.

Note: the reducer function `viewReducer` is currently module-private. Export it (`export function viewReducer`) so the test can drive it directly; `useViewReducer` stays unchanged.

- [ ] **Step 1: Write the failing tests**

Create `src/pages/MRDetailPage/viewReducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { viewReducer, initialViewState } from './viewReducer';

describe('viewReducer editMode', () => {
  it('starts with editMode off', () => {
    expect(initialViewState.editMode).toBe(false);
  });

  it('enters and exits edit mode', () => {
    const entered = viewReducer(initialViewState, { type: 'ENTER_EDIT_MODE' });
    expect(entered.editMode).toBe(true);
    const exited = viewReducer(entered, { type: 'EXIT_EDIT_MODE' });
    expect(exited.editMode).toBe(false);
  });

  it('leaves edit mode when a file is selected', () => {
    const entered = viewReducer(initialViewState, { type: 'ENTER_EDIT_MODE' });
    const next = viewReducer(entered, {
      type: 'SELECT_FILE',
      path: 'src/other.ts',
      index: 1,
      hasSavedState: false,
    });
    expect(next.editMode).toBe(false);
  });

  it('leaves edit mode when the view mode changes', () => {
    const entered = viewReducer(initialViewState, { type: 'ENTER_EDIT_MODE' });
    const next = viewReducer(entered, { type: 'SET_VIEW_MODE', mode: 'split' });
    expect(next.editMode).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `bunx vitest run src/pages/MRDetailPage/viewReducer.test.ts`
Expected: FAIL — `viewReducer` not exported / `editMode` missing.

- [ ] **Step 3: Implement**

In `src/pages/MRDetailPage/viewReducer.ts`:

1. Add to `ViewState`: `editMode: boolean;`
2. Add to `ViewAction` union:
   ```ts
   | { type: 'ENTER_EDIT_MODE' }
   | { type: 'EXIT_EDIT_MODE' }
   ```
3. Add to `initialViewState`: `editMode: false,`
4. Change `function viewReducer` to `export function viewReducer`.
5. In the `SELECT_FILE` case's returned object add `editMode: false,`; in `SET_VIEW_MODE` return `{ ...state, viewMode: action.mode, editMode: false }`.
6. Add cases:
   ```ts
   case 'ENTER_EDIT_MODE':
     return { ...state, editMode: true };
   case 'EXIT_EDIT_MODE':
     return { ...state, editMode: false };
   ```

- [ ] **Step 4: Run tests to verify they pass**

Run: `bunx vitest run src/pages/MRDetailPage/viewReducer.test.ts`
Expected: all PASS. Also run `bunx vitest run` (both test files) and `bunx tsc --noEmit`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MRDetailPage/viewReducer.ts src/pages/MRDetailPage/viewReducer.test.ts
git commit -m "feat(mr-detail): editMode state in view reducer"
```

---

### Task 3: Edit-mode support in `PierreDiffViewer` + highlighter preload hook

**Files:**
- Modify: `package.json` (`"@pierre/diffs": "^1.2.12"` → `"^1.3.3"`)
- Modify: `src/components/PierreDiffViewer/PierreDiffViewer.tsx`
- Create: `src/hooks/useHighlighterPreload.ts`

**Interfaces:**
- Consumes (verified against installed `@pierre/diffs@1.3.3` typings):
  - `EditProvider`, `type CreateEditor` from `@pierre/diffs/react`
  - `Editor`, `type EditorOptions` from `@pierre/diffs/edit`
  - `preloadHighlighter({ themes, langs }): Promise<void>` and `getFiletypeFromFileName(fileName): SupportedLanguages` from `@pierre/diffs`
  - `MultiFileDiff` props `edit?: boolean` and `editorOptions?: EditorOptions<LAnnotation>`
  - Editor `onChange?: (file: FileContents, lineAnnotations, event) => void`
- Produces (Tasks 4–5 rely on these):
  - `PierreDiffViewerProps` gains:
    ```ts
    /** Render the diff with pierre's in-place editor active (new side editable). */
    editMode?: boolean;
    /** Fires with the full edited new-side contents on every editor change. */
    onEditContentChange?: (contents: string) => void;
    ```
  - `useHighlighterPreload(filePath: string | null, enabled: boolean): boolean` — true once the main-thread highlighter grammar for this file is loaded.

- [ ] **Step 1: Align the manifest with the installed version**

In `package.json` change `"@pierre/diffs": "^1.2.12"` to `"@pierre/diffs": "^1.3.3"`, then run `bun install`. The lockfile already resolves 1.3.3, so this should be a no-op install.

Verify no duplicate pierre entries (the `@codemirror/state` incident): `grep -c '"@pierre/diffs@' bun.lock` should print `1`.

- [ ] **Step 2: Create the preload hook**

Create `src/hooks/useHighlighterPreload.ts`:

```ts
import { useEffect, useState } from 'react';
import { preloadHighlighter, getFiletypeFromFileName } from '@pierre/diffs';

/**
 * Preload the main-thread highlighter grammar for a file.
 *
 * Pierre's editor tokenizes on the main thread (the worker pool only covers
 * read-only renders) and silently drops keystrokes typed before its grammar
 * loads — so edit mode must stay unavailable until this resolves.
 */
export function useHighlighterPreload(filePath: string | null, enabled: boolean): boolean {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!enabled || !filePath) {
      setReady(false);
      return;
    }
    let cancelled = false;
    setReady(false);
    preloadHighlighter({
      themes: ['pierre-dark', 'pierre-light'],
      langs: [getFiletypeFromFileName(filePath)],
    })
      .then(() => {
        if (!cancelled) setReady(true);
      })
      .catch(() => {
        // Stay not-ready: the edit button remains disabled, diff stays usable read-only.
      });
    return () => {
      cancelled = true;
    };
  }, [filePath, enabled]);

  return ready;
}
```

- [ ] **Step 3: Wire edit mode into `PierreDiffViewer`**

In `src/components/PierreDiffViewer/PierreDiffViewer.tsx`:

1. Add imports:
   ```ts
   import { EditProvider, type CreateEditor } from '@pierre/diffs/react';
   import { Editor, type EditorOptions } from '@pierre/diffs/edit';
   ```
2. Add to `PierreDiffViewerProps` (doc comments as in Interfaces above):
   ```ts
   editMode?: boolean;
   onEditContentChange?: (contents: string) => void;
   ```
3. Destructure both in the component signature.
4. Inside the component, add a stable ref + factories (near the existing `onDeleteRef` block):
   ```ts
   const onEditContentChangeRef = useRef(onEditContentChange);
   onEditContentChangeRef.current = onEditContentChange;

   const createEditor = useCallback<CreateEditor<LineComment>>(
     (surfaceOptions) => new Editor<LineComment>({ persistState: false, ...surfaceOptions }),
     [],
   );

   const editorOptions = useMemo<EditorOptions<LineComment>>(
     () => ({
       onChange: (file) => onEditContentChangeRef.current?.(file.contents),
     }),
     [],
   );
   ```
5. In the `options` memo, suspend line interactions while editing:
   - `onLineNumberClick: onLineClick && !editMode ? handleLineNumberClick : undefined`
   - `enableLineSelection: !editMode`
   - Add `editMode` to the memo's dependency array.
6. Wrap the return value:
   ```tsx
   return (
     <EditProvider createEditor={createEditor}>
       <MultiFileDiff
         oldFile={oldFile}
         newFile={newFile}
         options={options}
         edit={editMode}
         editorOptions={editorOptions}
         lineAnnotations={lineAnnotations}
         renderAnnotation={lineAnnotations ? renderAnnotation : undefined}
         renderHeaderMetadata={renderHeaderMetadata}
         selectedLines={selectedLines}
       />
     </EditProvider>
   );
   ```
   `EditProvider` is inert while `edit` is false, so the read-only path is unchanged.

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean. (If `Editor<LineComment>` generic instantiation errors, use `new Editor({ persistState: false, ...surfaceOptions })` and let inference from `CreateEditor<LineComment>` type the options.)

- [ ] **Step 5: Commit**

```bash
git add package.json bun.lock src/components/PierreDiffViewer/PierreDiffViewer.tsx src/hooks/useHighlighterPreload.ts
git commit -m "feat(diff-viewer): pierre 1.3 edit mode support + highlighter preload hook"
```

---

### Task 4: `SuggestEditControls` + `MRDiffContent` wiring + CSS

**Files:**
- Create: `src/pages/MRDetailPage/SuggestEditControls.tsx`
- Modify: `src/pages/MRDetailPage/MRDiffContent.tsx`
- Modify: `src/pages/MRDetailPage.css` (append styles)

**Interfaces:**
- Consumes: `isIOS` from `src/services/transport.ts`; `isImageFile` from `src/utils/languageDetection` (already imported in MRDiffContent); `PierreDiffViewer` props from Task 3.
- Produces (Task 5 relies on these):
  - `SuggestEditControlsProps`:
    ```ts
    interface SuggestEditControlsProps {
      editMode: boolean;
      /** Highlighter grammar loaded — entering edit mode is safe. */
      editReady: boolean;
      /** Content differs from the original — confirm is meaningful. */
      hasEdits: boolean;
      onEnter: () => void;
      onConfirm: () => void;
      onCancel: () => void;
    }
    ```
  - `MRDiffContentProps` gains:
    ```ts
    editMode?: boolean;
    editReady?: boolean;
    hasEdits?: boolean;
    onEnterEditMode?: () => void;
    onConfirmEdit?: () => void;
    onCancelEdit?: () => void;
    onEditContentChange?: (contents: string) => void;
    ```

- [ ] **Step 1: Create the controls component**

Create `src/pages/MRDetailPage/SuggestEditControls.tsx`:

```tsx
interface SuggestEditControlsProps {
  editMode: boolean;
  /** Highlighter grammar loaded — entering edit mode is safe. */
  editReady: boolean;
  /** Content differs from the original — confirm is meaningful. */
  hasEdits: boolean;
  onEnter: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Floating pill in the diff pane that enters/leaves suggestion edit mode. */
export default function SuggestEditControls({
  editMode,
  editReady,
  hasEdits,
  onEnter,
  onConfirm,
  onCancel,
}: SuggestEditControlsProps) {
  return (
    <div className="suggest-edit-controls">
      {!editMode ? (
        <button
          className="suggest-edit-btn"
          onClick={onEnter}
          disabled={!editReady}
          title={editReady ? 'Edit the diff to author a suggestion' : 'Preparing editor…'}
        >
          Suggest edit
        </button>
      ) : (
        <>
          <button className="suggest-edit-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="suggest-edit-confirm"
            onClick={onConfirm}
            disabled={!hasEdits}
            title={hasEdits ? 'Turn your edit into a suggestion comment' : 'Make an edit first'}
          >
            Create suggestion
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Wire through `MRDiffContent`**

In `src/pages/MRDetailPage/MRDiffContent.tsx`:

1. Add imports:
   ```ts
   import SuggestEditControls from './SuggestEditControls';
   import { isIOS } from '../../services/transport';
   ```
2. Add the new optional props from the Interfaces block to `MRDiffContentProps` and destructure them.
3. Compute visibility just above the return (after the `mainStyle` line):
   ```ts
   const showSuggestEdit =
     !isIOS &&
     !isImageFile(selectedFile) &&
     !fileContentLoading &&
     !fileContentError &&
     !!diffRefs &&
     !!onEnterEditMode;
   ```
4. Pass to the `PierreDiffViewer` element: `editMode={editMode}` and `onEditContentChange={onEditContentChange}`.
5. Render the controls as the last child inside `<main>` (after the `PierreDiffViewer` block):
   ```tsx
   {showSuggestEdit && (
     <SuggestEditControls
       editMode={!!editMode}
       editReady={!!editReady}
       hasEdits={!!hasEdits}
       onEnter={onEnterEditMode!}
       onConfirm={onConfirmEdit ?? (() => {})}
       onCancel={onCancelEdit ?? (() => {})}
     />
   )}
   ```

- [ ] **Step 3: Add styles**

Append to `src/pages/MRDetailPage.css` (match existing token/naming conventions in that file — inspect how it styles buttons and use the same CSS variables for surface, border, and accent colors):

```css
/* Floating suggest-edit controls (bottom-right of diff pane) */
.suggest-edit-controls {
  position: sticky;
  bottom: 16px;
  z-index: 10;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 0 16px;
  pointer-events: none;
}

.suggest-edit-controls button {
  pointer-events: auto;
  padding: 6px 14px;
  border-radius: 999px;
  font-size: 13px;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
}

.suggest-edit-controls button:disabled {
  cursor: default;
  opacity: 0.6;
}
```

Then the button treatments (the page's Kanagawa theme tokens — same file uses `--accent-color`, `--border-color`, `--bg-secondary`, `--overlay-glass`, `--wave-glow`, `--text-primary`, `--text-secondary`):

```css
.suggest-edit-btn,
.suggest-edit-confirm {
  background: var(--bg-secondary);
  border: 1px solid var(--wave-glow-strong);
  color: var(--accent-color);
}

.suggest-edit-btn:hover:not(:disabled),
.suggest-edit-confirm:hover:not(:disabled) {
  border-color: var(--accent-color);
}

.suggest-edit-cancel {
  background: var(--overlay-glass);
  border: 1px solid var(--border-color);
  color: var(--text-secondary);
}

.suggest-edit-cancel:hover {
  color: var(--text-primary);
}
```

Per the settings design preference: quiet states, no gradients or accent bars.

- [ ] **Step 4: Typecheck**

Run: `bunx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MRDetailPage/SuggestEditControls.tsx src/pages/MRDetailPage/MRDiffContent.tsx src/pages/MRDetailPage.css
git commit -m "feat(mr-detail): floating suggest-edit controls in diff pane"
```

---

### Task 5: MRDetailPage orchestration + hotkey suspension

**Files:**
- Modify: `src/pages/MRDetailPage/index.tsx`
- Modify: `src/pages/MRDetailPage/useMRKeyboard.ts`

**Interfaces:**
- Consumes:
  - `computeEditedRegion` (Task 1), reducer actions (Task 2), `useHighlighterPreload` (Task 3), `MRDiffContent` props (Task 4)
  - `buildGitLabSuggestionBlock(selection, anchorLine?)` and `CommentOverlayRef.open(position, selection, initialText?)` — both existing
- Produces:
  - `UseMRKeyboardOptions` gains:
    ```ts
    editMode: boolean;
    onExitEditMode: () => void;
    ```

- [ ] **Step 1: Wire state and handlers in `index.tsx`**

1. Add imports:
   ```ts
   import { isIOS } from '../../services/transport';
   import { isImageFile } from '../../utils/languageDetection';
   import { useHighlighterPreload } from '../../hooks/useHighlighterPreload';
   import { buildGitLabSuggestionBlock, computeEditedRegion } from '../../utils/gitlabSuggestions';
   ```
2. Below the `useViewReducer()` line, add:
   ```ts
   const [editedContent, setEditedContent] = useState<string | null>(null);
   const editReady = useHighlighterPreload(
     view.selectedFile,
     !isIOS && !!view.selectedFile && !isImageFile(view.selectedFile),
   );
   const hasEdits = editedContent !== null && editedContent !== fileContent.modified;

   const enterEditMode = useCallback(() => {
     setEditedContent(null);
     dispatch({ type: 'ENTER_EDIT_MODE' });
   }, [dispatch]);

   const cancelEditMode = useCallback(() => {
     dispatch({ type: 'EXIT_EDIT_MODE' });
     setEditedContent(null);
   }, [dispatch]);

   const confirmEdit = useCallback(() => {
     if (editedContent === null) return;
     const region = computeEditedRegion(fileContent.modified, editedContent);
     dispatch({ type: 'EXIT_EDIT_MODE' });
     setEditedContent(null);
     if (!region) return;
     const selection = {
       startLine: region.startLine,
       endLine: region.endLine,
       isOriginal: false,
       text: region.replacement,
     };
     const suggestionText = buildGitLabSuggestionBlock({
       startLine: region.startLine,
       endLine: region.endLine,
       text: region.replacement,
     });
     commentOverlayRef.current?.open(
       { line: region.endLine, isOriginal: false },
       selection,
       suggestionText,
     );
   }, [editedContent, fileContent.modified, dispatch]);
   ```
   (`useState` is already imported; `commentOverlayRef` already exists.)
3. `fileContent.modified` must be captured at edit-entry time? No — the file content for the selected file is stable while editing (edit mode exits on file switch via the reducer), so reading it at confirm time is correct.
4. Pass to `<MRDiffContent … />`:
   ```tsx
   editMode={view.editMode}
   editReady={editReady}
   hasEdits={hasEdits}
   onEnterEditMode={enterEditMode}
   onConfirmEdit={confirmEdit}
   onCancelEdit={cancelEditMode}
   onEditContentChange={setEditedContent}
   ```
5. Pass to `useMRKeyboard({ … })`: `editMode: view.editMode,` and `onExitEditMode: cancelEditMode,`.
6. Guard the Cmd+D drawer effect: hold the flag in a ref (`const editModeRef = useRef(view.editMode); editModeRef.current = view.editMode;` above the effect) and add `if (editModeRef.current) return;` as the first line of the handler — the effect's empty dependency array stays valid.

- [ ] **Step 2: Suspend hotkeys in `useMRKeyboard.ts`**

1. Add `editMode: boolean;` and `onExitEditMode: () => void;` to `UseMRKeyboardOptions` and destructure them.
2. Every `useHotkey` call **except Escape** gets `{ enabled: !editMode }` as its options argument. The two calls that already pass options merge the flag:
   - toggle-view-mode: `{ enabled: !isSmallScreen && !editMode }`
   - All plain calls (next/prev/jump aliases, approve, snooze, open-in-browser, copy-link, mark-viewed, toggle-generated, add-comment, add-suggestion, filter-files): append `, { enabled: !editMode }`.
   This is a blanket suspension because pierre's editor is a contentEditable inside a shadow root: window-level handlers see `e.target` retargeted to the `DIFFS-CONTAINER` host, so hotkey libraries' input detection cannot see that the user is typing.
3. Escape handler — cancel edit mode first:
   ```ts
   useHotkey(parseHotkey(getKey('go-back') ?? 'Escape'), () => {
     if (editMode) {
       trackShortcut('Escape', 'cancel_edit_mode', 'mr_detail');
       onExitEditMode();
     } else if (commentOverlayRef.current?.isVisible()) {
       trackShortcut('Escape', 'close_comment_overlay', 'mr_detail');
       commentOverlayRef.current.close();
     } else if (!document.querySelector('.keyboard-help-overlay')) {
       trackShortcut('Escape', 'go_back', 'mr_detail');
       onEscapeBack();
     }
   }, { ignoreInputs: false });
   ```

- [ ] **Step 3: Typecheck and unit tests**

Run: `bunx tsc --noEmit && bunx vitest run`
Expected: clean, all unit tests pass.

- [ ] **Step 4: Smoke-check in the browser**

Run `bun run dev`, open an MR detail page (e2e fixture routes work: `/mrs/101`), and verify: pill appears bottom-right → click → diff becomes editable → type on an added line → "Create suggestion" enables → confirm → overlay opens pre-filled with a `suggestion:` block. Cancel path: content reverts to original when leaving edit mode (pierre discards the document because `persistState: false`).

**If cancel leaves edited text visible** in the read-only render: add a remount key. In `index.tsx` add `const [editSession, setEditSession] = useState(0);`, increment it inside `cancelEditMode` and `confirmEdit` (`setEditSession((s) => s + 1);`), pass it through `MRDiffContent` as a new `editSessionKey?: number` prop, and set `key={editSessionKey}` on the `PierreDiffViewer` element. This forces a fresh render from the original contents at the cost of scroll position on exit.

- [ ] **Step 5: Commit**

```bash
git add src/pages/MRDetailPage/index.tsx src/pages/MRDetailPage/useMRKeyboard.ts
git commit -m "feat(mr-detail): edit-the-diff suggestion authoring flow"
```

---

### Task 6: E2E coverage

**Files:**
- Modify: `e2e/mr-detail-suggestions.spec.ts`

**Interfaces:**
- Consumes: fixture MR at `/mrs/101` whose default file renders `function Component() {` on new-side line 4 (see existing test in the same file); `dragSelectAddedLines` helper (existing); UI classes from Task 4 (`.suggest-edit-btn`, `.suggest-edit-confirm`, `.suggest-edit-cancel`); overlay classes `.comment-input-overlay`, `.comment-textarea` (existing).

- [ ] **Step 1: Add a caret-placement helper**

Append below `dragSelectAddedLines` in `e2e/mr-detail-suggestions.spec.ts`:

```ts
async function clickCodeLine(page: Page, line: number) {
  const diffContainer = page.locator('diffs-container');
  const box = await diffContainer.evaluate((element, target) => {
    const gutter = element.shadowRoot?.querySelector(`[data-column-number="${target}"]`);
    if (!(gutter instanceof HTMLElement)) throw new Error(`Line ${target} not found`);
    const rect = gutter.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }, line);
  // Click well to the right of the gutter to land in the code column.
  await page.mouse.click(box.x + box.width + 160, box.y + box.height / 2);
}
```

- [ ] **Step 2: Write the tests**

Append a new describe block:

```ts
test.describe('MR Detail Suggest Edit mode', () => {
  test('editing the diff produces a pre-filled suggestion in the overlay', async ({ page }) => {
    await page.goto('/mrs/101');
    await expect(page.locator('diffs-container')).toBeVisible({ timeout: 15_000 });

    const editBtn = page.locator('.suggest-edit-btn');
    await expect(editBtn).toBeEnabled({ timeout: 15_000 }); // waits for highlighter preload
    await editBtn.click();

    await expect(page.locator('.suggest-edit-confirm')).toBeVisible();
    await expect(page.locator('.suggest-edit-confirm')).toBeDisabled();

    await clickCodeLine(page, 4);
    await page.keyboard.press('End');
    await page.keyboard.type(' // edited');

    const confirmBtn = page.locator('.suggest-edit-confirm');
    await expect(confirmBtn).toBeEnabled();
    await confirmBtn.click();

    await expect(page.locator('.comment-input-overlay')).toBeVisible();
    const expected = [
      '```suggestion:-0+0',
      'function Component() { // edited',
      '```',
      '',
    ].join('\n');
    await expect(page.locator('.comment-textarea')).toHaveValue(expected);
  });

  test('escape cancels edit mode and reverts content', async ({ page }) => {
    await page.goto('/mrs/101');
    await expect(page.locator('diffs-container')).toBeVisible({ timeout: 15_000 });

    const editBtn = page.locator('.suggest-edit-btn');
    await expect(editBtn).toBeEnabled({ timeout: 15_000 });
    await editBtn.click();

    await clickCodeLine(page, 4);
    await page.keyboard.press('End');
    await page.keyboard.type(' // discarded');
    await page.keyboard.press('Escape');

    await expect(page.locator('.suggest-edit-btn')).toBeVisible();
    await expect(page.locator('.comment-input-overlay')).not.toBeVisible();
    await expect(page.locator('diffs-container')).not.toContainText('// discarded');
  });

  test('file-navigation hotkeys are inert while editing', async ({ page }) => {
    await page.goto('/mrs/101');
    await expect(page.locator('diffs-container')).toBeVisible({ timeout: 15_000 });

    const activeFile = page.locator('.file-nav-item.selected').first();
    const before = await activeFile.textContent();

    const editBtn = page.locator('.suggest-edit-btn');
    await expect(editBtn).toBeEnabled({ timeout: 15_000 });
    await editBtn.click();
    await clickCodeLine(page, 4);
    await page.keyboard.press('j'); // next-file hotkey — must type into the editor instead

    await expect(activeFile).toHaveText(before ?? '');
    await page.keyboard.press('Escape');
  });
});
```

(`.file-nav-item.selected` is the verified marker class from `src/components/FileNavigation/FileNavigation.tsx:194`.)

- [ ] **Step 3: Run and iterate**

Run: `bunx playwright test e2e/mr-detail-suggestions.spec.ts`
Expected: all pass. Iterate on locators (shadow-DOM piercing, caret placement offset) as needed — the assertions themselves are the contract. If typing into the shadow contentEditable proves flaky via `clickCodeLine`, focus it explicitly first: `page.locator('diffs-container [contenteditable="true"]').click()` then navigate with keyboard.

- [ ] **Step 4: Run the full e2e suite**

Run: `bunx playwright test`
Expected: no regressions (existing suggestion test in the same file must still pass — line selection is disabled only *during* edit mode).

- [ ] **Step 5: Commit**

```bash
git add e2e/mr-detail-suggestions.spec.ts
git commit -m "test(e2e): suggest-edit mode flow, cancel, and hotkey suspension"
```

---

### Task 7: Manual WKWebView gate (required before merge)

**Files:** none (verification only; update memory + spec status afterwards)

This is the check that killed the previous pierre-editor attempt. Playwright runs chromium; the shipped app runs WKWebView, where selection overlays historically drifted.

- [ ] **Step 1: Launch the real app**

Run: `bun run tauri dev` (fetch real MR data — the GitLab token lives in the app's SQLite DB, not `credentials.md`; see memory `gitlab-test-token-location.md`).

- [ ] **Step 2: Verification checklist**

Open a real MR with a reviewable file, then verify each:

1. "Suggest edit" pill appears bottom-right and enables within ~2s.
2. Enter edit mode; click into several lines: the caret lands where clicked and is visible.
3. Make a selection by dragging across 2–3 lines: the selection overlay matches the actual text (no x-offset drift). Test specifically on: a long line that soft-wraps, and a line containing emoji or non-ASCII (add one temporarily if the file has none).
4. Type at line ends and mid-line; undo (Cmd+Z) and redo (Cmd+Shift+Z) behave.
5. Hotkeys (`j`, `k`, `s`, `a`, `x`) do nothing while editing; Escape cancels; content reverts.
6. Confirm flow: edit a line → Create suggestion → overlay pre-filled → submit → comment appears on the correct line in GitLab (check the web UI).
7. Split view: repeat steps 2–4 in split mode. If split view misbehaves, hide the pill when `viewMode === 'split'` (scope cut per spec) rather than blocking.

- [ ] **Step 3: Record the outcome**

- **Pass:** update the memory file `pierre-diffs-editor.md` (WKWebView note: edit mode in diff views verified working in 1.3.3 as of 2026-08) and mark the spec's manual-gate requirement satisfied in the spec doc (Status line).
- **Fail (selection drift or dropped input):** stop; per spec, fall back to the CodeMirror-overlay approach. Revert Tasks 3–6 UI exposure by hiding the pill (`showSuggestEdit` → `false`) in one commit, and record findings in the same memory file.
