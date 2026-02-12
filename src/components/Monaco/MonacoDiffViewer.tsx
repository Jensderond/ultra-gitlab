import { useMemo, useRef, useCallback, useEffect, forwardRef, useImperativeHandle, useState } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { KANAGAWA_THEME_NAME } from "./kanagawaTheme";
import { getLanguageFromPath } from "./languageDetection";

/** Information about the current cursor position */
export interface CursorPosition {
  line: number;
  isOriginal: boolean;
}

/** Information about a line selection in the diff viewer */
export interface LineSelection {
  /** Starting line number */
  startLine: number;
  /** Ending line number */
  endLine: number;
  /** Whether the selection is on the original (old) side */
  isOriginal: boolean;
  /** The selected text content */
  text: string;
}

/** Ref handle for MonacoDiffViewer */
export interface MonacoDiffViewerRef {
  /** Navigate to next change */
  goToNextChange: () => void;
  /** Navigate to previous change */
  goToPreviousChange: () => void;
  /** Get the underlying diff editor instance */
  getEditor: () => editor.IStandaloneDiffEditor | null;
  /** Get current scroll position */
  getScrollTop: () => number;
  /** Set scroll position */
  setScrollTop: (top: number) => void;
  /** Get current cursor position */
  getCursorPosition: () => CursorPosition | null;
  /** Get the currently selected lines (for suggestion support) */
  getSelectedLines: () => LineSelection | null;
  /** Collapse unchanged regions back to initial state (5 lines context) */
  collapseUnchanged: () => void;
  /** Expand all regions, showing the complete file */
  expandAll: () => void;
  /** Save the current view state (scroll, cursor, collapsed regions) */
  saveViewState: () => editor.IDiffEditorViewState | null;
  /** Restore a previously saved view state */
  restoreViewState: (state: editor.IDiffEditorViewState | null) => void;
  /** Force recalculate layout (needed after display:none → visible transitions) */
  layout: () => void;
}

/** Comment data for a line */
export interface LineComment {
  id: number;
  line: number;
  isOldLine?: boolean;
  authorUsername: string;
  body: string;
  createdAt: number;
  resolved?: boolean;
}

interface MonacoDiffViewerProps {
  /** Original file content (left side) */
  originalContent: string;
  /** Modified file content (right side) */
  modifiedContent: string;
  /** File path for language detection */
  filePath: string;
  /** Optional language override (takes precedence over auto-detection) */
  language?: string;
  /** View mode: split (side-by-side) or unified (inline) */
  viewMode?: "split" | "unified";
  /** Comments to display in the gutter */
  comments?: LineComment[];
  /** Callback when editor mounts */
  onMount?: DiffOnMount;
}

/**
 * Monaco-based diff viewer component.
 * Displays side-by-side or unified diff with syntax highlighting.
 */
export const MonacoDiffViewer = forwardRef<MonacoDiffViewerRef, MonacoDiffViewerProps>(
  function MonacoDiffViewer(
    {
      originalContent,
      modifiedContent,
      comments = [],
      filePath,
      language,
      viewMode = "split",
      onMount,
    },
    ref
  ) {
    const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
    const currentChangeIndexRef = useRef<number>(-1);
    const keyForwardDisposablesRef = useRef<{ dispose(): void }[]>([]);
    const [editorReady, setEditorReady] = useState(false);

    // Detect language from file path, fallback to plaintext
    const detectedLanguage = useMemo(
      () => language ?? getLanguageFromPath(filePath),
      [language, filePath]
    );

    // Get line changes from the diff editor
    const getLineChanges = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return [];

      const lineChanges = editor.getLineChanges();
      return lineChanges || [];
    }, []);

    // Navigate to a specific change by index
    const goToChange = useCallback((index: number) => {
      const editor = editorRef.current;
      if (!editor) return;

      const changes = getLineChanges();
      if (changes.length === 0) return;

      // Wrap around
      let targetIndex = index;
      if (targetIndex < 0) targetIndex = changes.length - 1;
      if (targetIndex >= changes.length) targetIndex = 0;

      currentChangeIndexRef.current = targetIndex;
      const change = changes[targetIndex];

      // Get the modified editor to scroll to the change
      const modifiedEditor = editor.getModifiedEditor();
      const lineNumber = change.modifiedStartLineNumber || change.originalStartLineNumber || 1;

      modifiedEditor.revealLineInCenter(lineNumber);
      modifiedEditor.setPosition({ lineNumber, column: 1 });
    }, [getLineChanges]);

    // Navigate to next change
    const goToNextChange = useCallback(() => {
      goToChange(currentChangeIndexRef.current + 1);
    }, [goToChange]);

    // Navigate to previous change
    const goToPreviousChange = useCallback(() => {
      goToChange(currentChangeIndexRef.current - 1);
    }, [goToChange]);

    // Get current scroll position
    const getScrollTop = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return 0;
      return editor.getModifiedEditor().getScrollTop();
    }, []);

    // Set scroll position
    const setScrollTop = useCallback((top: number) => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.getModifiedEditor().setScrollTop(top);
    }, []);

    // Collapse unchanged regions back to initial state
    const collapseUnchanged = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.updateOptions({
        hideUnchangedRegions: {
          enabled: true,
          contextLineCount: 5,
          minimumLineCount: 3,
          revealLineCount: 20,
        },
      });
    }, []);

    // Expand all regions, showing the complete file
    const expandAll = useCallback(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.updateOptions({
        hideUnchangedRegions: { enabled: false },
      });
    }, []);

    // Save view state (scroll, cursor, collapsed regions)
    const saveViewState = useCallback((): editor.IDiffEditorViewState | null => {
      const ed = editorRef.current;
      if (!ed) return null;
      return ed.saveViewState();
    }, []);

    // Restore view state
    const restoreViewState = useCallback((state: editor.IDiffEditorViewState | null) => {
      const ed = editorRef.current;
      if (!ed || !state) return;
      ed.restoreViewState(state);
    }, []);

    // Force recalculate layout (needed after display:none → visible)
    const layout = useCallback(() => {
      editorRef.current?.layout();
    }, []);

    // Get current cursor position
    const getCursorPosition = useCallback((): CursorPosition | null => {
      const editor = editorRef.current;
      if (!editor) return null;

      // Check if modified editor has focus
      const modifiedEditor = editor.getModifiedEditor();
      const originalEditor = editor.getOriginalEditor();

      // Try modified editor first (more common)
      const modifiedPos = modifiedEditor.getPosition();
      if (modifiedPos && modifiedEditor.hasTextFocus()) {
        return { line: modifiedPos.lineNumber, isOriginal: false };
      }

      // Check original editor
      const originalPos = originalEditor.getPosition();
      if (originalPos && originalEditor.hasTextFocus()) {
        return { line: originalPos.lineNumber, isOriginal: true };
      }

      // Fallback to modified position if no focus
      if (modifiedPos) {
        return { line: modifiedPos.lineNumber, isOriginal: false };
      }

      return null;
    }, []);

    // Get the currently selected lines for suggestion support
    const getSelectedLines = useCallback((): LineSelection | null => {
      const diffEditor = editorRef.current;
      if (!diffEditor) return null;

      const modifiedEditor = diffEditor.getModifiedEditor();
      const originalEditor = diffEditor.getOriginalEditor();

      // Check modified editor first
      for (const [ed, isOriginal] of [[modifiedEditor, false], [originalEditor, true]] as const) {
        const selection = ed.getSelection();
        if (selection && !selection.isEmpty()) {
          const model = ed.getModel();
          if (!model) continue;

          const startLine = selection.startLineNumber;
          const endLine = selection.endLineNumber;
          // Get the full lines content (not just the selection within lines)
          const lines: string[] = [];
          for (let i = startLine; i <= endLine; i++) {
            lines.push(model.getLineContent(i));
          }

          return {
            startLine,
            endLine,
            isOriginal,
            text: lines.join('\n'),
          };
        }
      }

      // Fallback to cursor line on modified editor
      const pos = modifiedEditor.getPosition();
      if (pos) {
        const model = modifiedEditor.getModel();
        if (model) {
          return {
            startLine: pos.lineNumber,
            endLine: pos.lineNumber,
            isOriginal: false,
            text: model.getLineContent(pos.lineNumber),
          };
        }
      }

      return null;
    }, []);

    // Expose ref methods
    useImperativeHandle(ref, () => ({
      goToNextChange,
      goToPreviousChange,
      getEditor: () => editorRef.current,
      getScrollTop,
      setScrollTop,
      getCursorPosition,
      getSelectedLines,
      collapseUnchanged,
      expandAll,
      saveViewState,
      restoreViewState,
      layout,
    }), [goToNextChange, goToPreviousChange, getScrollTop, setScrollTop, getCursorPosition, getSelectedLines, collapseUnchanged, expandAll, saveViewState, restoreViewState, layout]);

    // Handle editor mount
    const handleMount: DiffOnMount = useCallback((editor, monaco) => {
      editorRef.current = editor;
      currentChangeIndexRef.current = -1;

      // Clean up any previous disposables (e.g. from HMR)
      for (const d of keyForwardDisposablesRef.current) d.dispose();
      keyForwardDisposablesRef.current = [];

      // Forward single-letter keypresses from read-only sub-editors to window.
      // Without this, Monaco intercepts them (showing a "Cannot edit in read-only
      // editor" toast) and they never reach the app-level keyboard handler.
      const forwardKeys = (ed: editor.ICodeEditor) =>
        ed.onKeyDown((e) => {
          if (e.ctrlKey || e.metaKey || e.altKey) return;
          const key = e.browserEvent.key;
          if (key.length === 1 && key >= 'a' && key <= 'z') {
            e.preventDefault();
            e.stopPropagation();
            window.dispatchEvent(
              new KeyboardEvent('keydown', { key, code: e.browserEvent.code, bubbles: true })
            );
          }
        });

      keyForwardDisposablesRef.current.push(
        forwardKeys(editor.getModifiedEditor()),
        forwardKeys(editor.getOriginalEditor()),
      );

      setEditorReady(true);
      onMount?.(editor, monaco);
    }, [onMount]);

    // Clean up key forwarding disposables on unmount
    useEffect(() => {
      return () => {
        for (const d of keyForwardDisposablesRef.current) d.dispose();
        keyForwardDisposablesRef.current = [];
      };
    }, []);

    // Reset change index when content changes
    useEffect(() => {
      currentChangeIndexRef.current = -1;
    }, [originalContent, modifiedContent]);

    // Add comment decorations to the editor
    useEffect(() => {
      const editor = editorRef.current;
      if (!editorReady || !editor || comments.length === 0) return;

      const modifiedEditor = editor.getModifiedEditor();
      const originalEditor = editor.getOriginalEditor();

      // Group comments by line
      const modifiedLineComments = new Map<number, LineComment[]>();
      const originalLineComments = new Map<number, LineComment[]>();

      for (const comment of comments) {
        if (comment.isOldLine) {
          const existing = originalLineComments.get(comment.line) || [];
          existing.push(comment);
          originalLineComments.set(comment.line, existing);
        } else {
          const existing = modifiedLineComments.get(comment.line) || [];
          existing.push(comment);
          modifiedLineComments.set(comment.line, existing);
        }
      }

      // Helper to format comment timestamp
      const formatTime = (ts: number) => {
        const date = new Date(ts * 1000);
        return date.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit",
        });
      };

      // Helper to create hover content for comments
      const createHoverContent = (lineComments: LineComment[]) => {
        return lineComments.map((c) => ({
          value: `**@${c.authorUsername}** · ${formatTime(c.createdAt)}${c.resolved ? " ✅" : ""}\n\n${c.body}`,
          isTrusted: true,
        }));
      };

      // Create decorations for modified editor
      const modifiedDecorations: editor.IModelDeltaDecoration[] = [];
      for (const [line, lineComments] of modifiedLineComments) {
        modifiedDecorations.push({
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          options: {
            isWholeLine: true,
            linesDecorationsClassName: "comment-indicator",
            glyphMarginClassName: "comment-glyph",
            glyphMarginHoverMessage: createHoverContent(lineComments),
            className: "comment-line-highlight",
          },
        });
      }

      // Create decorations for original editor
      const originalDecorations: editor.IModelDeltaDecoration[] = [];
      for (const [line, lineComments] of originalLineComments) {
        originalDecorations.push({
          range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
          options: {
            isWholeLine: true,
            linesDecorationsClassName: "comment-indicator",
            glyphMarginClassName: "comment-glyph",
            glyphMarginHoverMessage: createHoverContent(lineComments),
            className: "comment-line-highlight",
          },
        });
      }

      // Apply decorations
      const modifiedCollection = modifiedEditor.createDecorationsCollection(modifiedDecorations);
      const originalCollection = originalEditor.createDecorationsCollection(originalDecorations);

      return () => {
        modifiedCollection.clear();
        originalCollection.clear();
      };
    }, [comments, editorReady]);

    // When a file is new (empty original), pass identical content for both
    // sides so Monaco shows no diff color overlays (green/red).
    const isNewFile = !originalContent;
    const effectiveOriginal = isNewFile ? modifiedContent : originalContent;

    return (
    <DiffEditor
      original={effectiveOriginal}
      modified={modifiedContent}
      language={detectedLanguage}
      theme={KANAGAWA_THEME_NAME}
      options={{
        // Read-only mode
        readOnly: true,
        originalEditable: false,

        // View mode
        renderSideBySide: viewMode === "split",
        useInlineViewWhenSpaceIsLimited: false,

        // Line numbers on both sides
        lineNumbers: "on",

        // Diff options
        renderOverviewRuler: true,
        renderIndicators: true,

        // Collapse unchanged regions (show only 5 lines of context around changes)
        hideUnchangedRegions: {
          enabled: true,
          contextLineCount: 5,
          minimumLineCount: 3,
          revealLineCount: 20,
        },

        // Editor appearance
        minimap: {
          enabled: true,
          side: "right",
          showSlider: "mouseover",
          renderCharacters: false,
        },
        scrollBeyondLastLine: false,
        fontSize: 13,
        fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
        fontLigatures: false,

        // Navigation
        folding: true,
        foldingHighlight: true,
        showFoldingControls: "always",

        // Scroll behavior
        smoothScrolling: true,
        mouseWheelScrollSensitivity: 1,

        // Selection
        selectionHighlight: true,
        occurrencesHighlight: "singleFile",

        // Whitespace
        renderWhitespace: "selection",

        // Gutter
        glyphMargin: true,
        lineDecorationsWidth: 10,

        // Performance
        automaticLayout: true,
      }}
      onMount={handleMount}
    />
    );
  }
);

export default MonacoDiffViewer;
