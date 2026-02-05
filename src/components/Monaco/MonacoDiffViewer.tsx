import { useMemo, useRef, useCallback, useEffect, forwardRef, useImperativeHandle } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { KANAGAWA_THEME_NAME } from "./kanagawaTheme";
import { getLanguageFromPath } from "./languageDetection";

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
      filePath,
      language,
      viewMode = "split",
      onMount,
    },
    ref
  ) {
    const editorRef = useRef<editor.IStandaloneDiffEditor | null>(null);
    const currentChangeIndexRef = useRef<number>(-1);

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

    // Expose ref methods
    useImperativeHandle(ref, () => ({
      goToNextChange,
      goToPreviousChange,
      getEditor: () => editorRef.current,
      getScrollTop,
      setScrollTop,
    }), [goToNextChange, goToPreviousChange, getScrollTop, setScrollTop]);

    // Handle editor mount
    const handleMount: DiffOnMount = useCallback((editor, monaco) => {
      editorRef.current = editor;
      currentChangeIndexRef.current = -1;
      onMount?.(editor, monaco);
    }, [onMount]);

    // Reset change index when content changes
    useEffect(() => {
      currentChangeIndexRef.current = -1;
    }, [originalContent, modifiedContent]);

    return (
    <DiffEditor
      original={originalContent}
      modified={modifiedContent}
      language={detectedLanguage}
      theme={KANAGAWA_THEME_NAME}
      options={{
        // Read-only mode
        readOnly: true,
        originalEditable: false,

        // View mode
        renderSideBySide: viewMode === "split",

        // Line numbers on both sides
        lineNumbers: "on",

        // Diff options
        renderOverviewRuler: true,
        renderIndicators: true,

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
