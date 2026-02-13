import type { editor } from 'monaco-editor';
import type { ThemeDefinition } from './types';

/**
 * Convert an rgba() CSS string to #rrggbbaa hex format for Monaco.
 * Passes through strings that are already hex.
 */
function toHexColor(color: string): string {
  const rgbaMatch = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*([\d.]+))?\s*\)$/);
  if (!rgbaMatch) return color;
  const r = parseInt(rgbaMatch[1]).toString(16).padStart(2, '0');
  const g = parseInt(rgbaMatch[2]).toString(16).padStart(2, '0');
  const b = parseInt(rgbaMatch[3]).toString(16).padStart(2, '0');
  const a = rgbaMatch[4] !== undefined
    ? Math.round(parseFloat(rgbaMatch[4]) * 255).toString(16).padStart(2, '0')
    : 'ff';
  return `#${r}${g}${b}${a}`;
}

/**
 * Convert a ThemeDefinition into a Monaco IStandaloneThemeData object.
 *
 * Token rules come directly from the theme's monacoTokenColors array.
 * Editor UI colors are derived from monacoEditorColors plus related
 * theme fields (borders, diff, accent, etc.).
 */
export function themeToMonacoTheme(theme: ThemeDefinition): editor.IStandaloneThemeData {
  const base = theme.type === 'dark' ? 'vs-dark' : 'vs';

  // Build token rules from the ThemeDefinition
  const rules: editor.ITokenThemeRule[] = theme.monacoTokenColors.map((tc) => {
    const rule: editor.ITokenThemeRule = {
      token: tc.token,
      foreground: tc.foreground,
    };
    if (tc.fontStyle) {
      rule.fontStyle = tc.fontStyle;
    }
    return rule;
  });

  // Build editor UI colors from theme fields
  const ec = theme.monacoEditorColors;
  const colors: Record<string, string> = {
    // Editor base
    'editor.background': ec.editorBackground,
    'editor.foreground': ec.editorForeground,
    'editorCursor.foreground': theme.text.secondary,
    'editorCursor.background': ec.editorBackground,

    // Line numbers
    'editorLineNumber.foreground': ec.lineNumberForeground,
    'editorLineNumber.activeForeground': ec.lineNumberActiveForeground,

    // Selection
    'editor.selectionBackground': ec.selectionBackground,
    'editor.inactiveSelectionBackground': ec.selectionBackground + '80',
    'editor.selectionHighlightBackground': ec.selectionBackground + '50',

    // Find matches
    'editor.findMatchBackground': theme.text.secondary + '80',
    'editor.findMatchHighlightBackground': theme.text.secondary + '40',

    // Current line
    'editor.lineHighlightBackground': ec.lineHighlightBackground,
    'editor.lineHighlightBorder': ec.lineHighlightBackground + '00',

    // Indentation guides
    'editorIndentGuide.background': theme.borders.color,
    'editorIndentGuide.activeBackground': theme.extended.fujiGray,

    // Bracket matching
    'editorBracketMatch.background': theme.borders.color,
    'editorBracketMatch.border': theme.accent.color,

    // Whitespace
    'editorWhitespace.foreground': theme.borders.color,

    // Minimap
    'minimap.background': ec.editorBackground,
    'minimap.selectionHighlight': ec.selectionBackground,

    // Scrollbar
    'scrollbarSlider.background': theme.borders.color + '80',
    'scrollbarSlider.hoverBackground': theme.extended.fujiGray + '80',
    'scrollbarSlider.activeBackground': theme.extended.fujiGray,

    // Gutter
    'editorGutter.background': ec.gutterBackground,
    'editorGutter.addedBackground': theme.status.success.color,
    'editorGutter.modifiedBackground': theme.status.warning.color,
    'editorGutter.deletedBackground': theme.status.error.color,

    // Diff editor — rgba values must be converted to hex for Monaco
    'diffEditor.insertedTextBackground': toHexColor(theme.diff.addBg),
    'diffEditor.removedTextBackground': toHexColor(theme.diff.removeBg),
    'diffEditor.insertedLineBackground': toHexColor(theme.diff.addBg),
    'diffEditor.removedLineBackground': toHexColor(theme.diff.removeBg),
    'diffEditor.diagonalFill': theme.borders.color,

    // Diff editor unchanged/collapsed regions
    'diffEditor.unchangedRegionBackground': theme.backgrounds.tertiary,
    'diffEditor.unchangedRegionForeground': theme.text.tertiary,
    'diffEditor.unchangedRegionShadow': theme.backgrounds.primary,
    'diffEditor.unchangedCodeBackground': ec.editorBackground + '00',

    // Focus & links
    focusBorder: theme.accent.color,
    'editorLink.activeForeground': theme.accent.color,

    // Widget (find, command palette)
    'editorWidget.background': ec.editorBackground,
    'editorWidget.foreground': ec.editorForeground,
    'editorWidget.border': theme.borders.color,
    'input.background': theme.backgrounds.tertiary,
    'input.foreground': ec.editorForeground,
    'input.border': theme.borders.color,
    'input.placeholderForeground': theme.extended.fujiGray,
    'inputOption.activeBackground': ec.selectionBackground,
    'inputOption.activeForeground': ec.editorForeground,

    // Dropdown
    'dropdown.background': ec.editorBackground,
    'dropdown.foreground': ec.editorForeground,
    'dropdown.border': theme.borders.color,

    // Lists (autocomplete)
    'list.activeSelectionBackground': ec.selectionBackground,
    'list.activeSelectionForeground': ec.editorForeground,
    'list.hoverBackground': theme.backgrounds.tertiary,
    'list.focusBackground': ec.selectionBackground,
    'list.highlightForeground': theme.accent.color,

    // Overview ruler
    'editorOverviewRuler.addedForeground': theme.status.success.color,
    'editorOverviewRuler.modifiedForeground': theme.status.warning.color,
    'editorOverviewRuler.deletedForeground': theme.status.error.color,
    'editorOverviewRuler.errorForeground': theme.status.error.color,
    'editorOverviewRuler.warningForeground': theme.extended.roninYellow,
    'editorOverviewRuler.infoForeground': theme.accent.color,
    'editorOverviewRuler.bracketMatchForeground': theme.accent.color,
    'editorOverviewRuler.findMatchForeground': theme.text.secondary,
    'editorOverviewRuler.selectionHighlightForeground': ec.selectionBackground,
  };

  return { base, inherit: false, rules, colors };
}

/**
 * Generate a Monaco theme name from a ThemeDefinition id.
 */
export function getMonacoThemeName(theme: ThemeDefinition): string {
  return theme.id;
}
