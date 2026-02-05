import { useMemo } from "react";
import { DiffEditor, type DiffOnMount } from "@monaco-editor/react";
import { KANAGAWA_THEME_NAME } from "./kanagawaTheme";
import { getLanguageFromPath } from "./languageDetection";

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
export function MonacoDiffViewer({
  originalContent,
  modifiedContent,
  filePath,
  language,
  viewMode = "split",
  onMount,
}: MonacoDiffViewerProps) {
  // Detect language from file path, fallback to plaintext
  const detectedLanguage = useMemo(
    () => language ?? getLanguageFromPath(filePath),
    [language, filePath]
  );

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
        minimap: { enabled: false },
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
      onMount={onMount}
    />
  );
}

export default MonacoDiffViewer;
