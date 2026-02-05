import type * as Monaco from "monaco-editor";

/**
 * Kanagawa Wave theme for Monaco Editor.
 * Based on the popular Neovim colorscheme.
 * @see https://github.com/rebelot/kanagawa.nvim
 */
export const kanagawaWaveTheme: Monaco.editor.IStandaloneThemeData = {
  base: "vs-dark",
  inherit: false,
  rules: [
    // Base tokens
    { token: "", foreground: "dcd7ba", background: "1f1f28" },

    // Comments
    { token: "comment", foreground: "727169", fontStyle: "italic" },
    { token: "comment.line", foreground: "727169", fontStyle: "italic" },
    { token: "comment.block", foreground: "727169", fontStyle: "italic" },
    { token: "comment.doc", foreground: "727169", fontStyle: "italic" },

    // Strings
    { token: "string", foreground: "98bb6c" },
    { token: "string.quoted", foreground: "98bb6c" },
    { token: "string.template", foreground: "98bb6c" },
    { token: "string.regexp", foreground: "e46876" },
    { token: "string.escape", foreground: "e6c384" },

    // Keywords
    { token: "keyword", foreground: "957fb8" },
    { token: "keyword.control", foreground: "957fb8" },
    { token: "keyword.operator", foreground: "c0a36e" },
    { token: "keyword.other", foreground: "957fb8" },

    // Functions
    { token: "entity.name.function", foreground: "7e9cd8" },
    { token: "support.function", foreground: "7e9cd8" },
    { token: "function", foreground: "7e9cd8" },

    // Types
    { token: "entity.name.type", foreground: "7aa89f" },
    { token: "entity.name.class", foreground: "7aa89f" },
    { token: "support.type", foreground: "7aa89f" },
    { token: "type", foreground: "7aa89f" },

    // Variables
    { token: "variable", foreground: "dcd7ba" },
    { token: "variable.parameter", foreground: "e6c384" },
    { token: "variable.other", foreground: "dcd7ba" },

    // Constants
    { token: "constant", foreground: "d27e99" },
    { token: "constant.numeric", foreground: "d27e99" },
    { token: "constant.language", foreground: "d27e99" },
    { token: "constant.character", foreground: "d27e99" },

    // Operators
    { token: "operator", foreground: "c0a36e" },
    { token: "punctuation", foreground: "9cabca" },

    // Tags (HTML/JSX)
    { token: "tag", foreground: "7e9cd8" },
    { token: "tag.attribute.name", foreground: "c0a36e" },

    // CSS
    { token: "attribute.name", foreground: "c0a36e" },
    { token: "attribute.value", foreground: "98bb6c" },

    // JSON
    { token: "string.key.json", foreground: "7e9cd8" },
    { token: "string.value.json", foreground: "98bb6c" },

    // Markdown
    { token: "markup.heading", foreground: "7e9cd8", fontStyle: "bold" },
    { token: "markup.bold", fontStyle: "bold" },
    { token: "markup.italic", fontStyle: "italic" },
    { token: "markup.underline", fontStyle: "underline" },
    { token: "markup.raw", foreground: "98bb6c" },
    { token: "markup.quote", foreground: "727169", fontStyle: "italic" },

    // Diff specific
    { token: "inserted", foreground: "98bb6c" },
    { token: "deleted", foreground: "c34043" },
    { token: "changed", foreground: "e6c384" },
  ],
  colors: {
    // Editor base colors
    "editor.background": "#1f1f28",
    "editor.foreground": "#dcd7ba",
    "editorCursor.foreground": "#c8c093",
    "editorCursor.background": "#1f1f28",

    // Line numbers
    "editorLineNumber.foreground": "#54546d",
    "editorLineNumber.activeForeground": "#c8c093",

    // Selection
    "editor.selectionBackground": "#2d4f67",
    "editor.inactiveSelectionBackground": "#2d4f6780",
    "editor.selectionHighlightBackground": "#2d4f6750",

    // Find matches
    "editor.findMatchBackground": "#c8c09380",
    "editor.findMatchHighlightBackground": "#c8c09340",

    // Current line
    "editor.lineHighlightBackground": "#2a2a37",
    "editor.lineHighlightBorder": "#2a2a3700",

    // Indentation guides
    "editorIndentGuide.background": "#363646",
    "editorIndentGuide.activeBackground": "#54546d",

    // Bracket matching
    "editorBracketMatch.background": "#363646",
    "editorBracketMatch.border": "#7e9cd8",

    // Whitespace
    "editorWhitespace.foreground": "#363646",

    // Minimap
    "minimap.background": "#1f1f28",
    "minimap.selectionHighlight": "#2d4f67",

    // Scrollbar
    "scrollbarSlider.background": "#36364680",
    "scrollbarSlider.hoverBackground": "#54546d80",
    "scrollbarSlider.activeBackground": "#54546d",

    // Gutter
    "editorGutter.background": "#1f1f28",
    "editorGutter.addedBackground": "#76946a",
    "editorGutter.modifiedBackground": "#dca561",
    "editorGutter.deletedBackground": "#c34043",

    // Diff editor specific
    "diffEditor.insertedTextBackground": "#76946a33",
    "diffEditor.removedTextBackground": "#c3404333",
    "diffEditor.insertedLineBackground": "#76946a22",
    "diffEditor.removedLineBackground": "#c3404322",
    "diffEditor.diagonalFill": "#363646",

    // Widget (find, command palette, etc.)
    "editorWidget.background": "#1f1f28",
    "editorWidget.foreground": "#dcd7ba",
    "editorWidget.border": "#363646",
    "input.background": "#2a2a37",
    "input.foreground": "#dcd7ba",
    "input.border": "#363646",
    "input.placeholderForeground": "#54546d",
    "inputOption.activeBackground": "#2d4f67",
    "inputOption.activeForeground": "#dcd7ba",

    // Dropdown
    "dropdown.background": "#1f1f28",
    "dropdown.foreground": "#dcd7ba",
    "dropdown.border": "#363646",

    // Lists (autocomplete, etc.)
    "list.activeSelectionBackground": "#2d4f67",
    "list.activeSelectionForeground": "#dcd7ba",
    "list.hoverBackground": "#2a2a37",
    "list.focusBackground": "#2d4f67",
    "list.highlightForeground": "#7e9cd8",

    // Overview ruler (right sidebar indicators)
    "editorOverviewRuler.addedForeground": "#76946a",
    "editorOverviewRuler.modifiedForeground": "#dca561",
    "editorOverviewRuler.deletedForeground": "#c34043",
    "editorOverviewRuler.errorForeground": "#e82424",
    "editorOverviewRuler.warningForeground": "#ff9e3b",
    "editorOverviewRuler.infoForeground": "#7e9cd8",
    "editorOverviewRuler.bracketMatchForeground": "#7e9cd8",
    "editorOverviewRuler.findMatchForeground": "#c8c093",
    "editorOverviewRuler.selectionHighlightForeground": "#2d4f67",
  },
};

export const KANAGAWA_THEME_NAME = "kanagawa-wave";
