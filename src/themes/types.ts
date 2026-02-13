/**
 * Theme system type definitions.
 *
 * A ThemeDefinition fully describes the visual appearance of the app,
 * including CSS variable values, Monaco editor colors, and tree-sitter
 * syntax highlighting colors.
 */

// ---------------------------------------------------------------------------
// Status color group (each status has 4 variants)
// ---------------------------------------------------------------------------

export interface StatusColorGroup {
  color: string;
  bg: string;
  text: string;
  light: string;
}

// ---------------------------------------------------------------------------
// Diff colors
// ---------------------------------------------------------------------------

export interface DiffColors {
  addBg: string;
  addHover: string;
  addGutter: string;
  addText: string;
  removeBg: string;
  removeHover: string;
  removeGutter: string;
  removeText: string;
  gutterBg: string;
  hunkHeaderBg: string;
  hunkHeaderText: string;
}

// ---------------------------------------------------------------------------
// Monaco token color entry
// ---------------------------------------------------------------------------

export interface MonacoTokenColor {
  token: string;
  foreground: string;
  fontStyle?: string;
}

// ---------------------------------------------------------------------------
// Monaco editor UI colors
// ---------------------------------------------------------------------------

export interface MonacoEditorColors {
  editorBackground: string;
  editorForeground: string;
  selectionBackground: string;
  lineHighlightBackground: string;
  gutterBackground: string;
  lineNumberForeground: string;
  lineNumberActiveForeground: string;
}

// ---------------------------------------------------------------------------
// Syntax highlight colors (tree-sitter CSS classes)
// ---------------------------------------------------------------------------

export interface SyntaxHighlightColors {
  keyword: string;
  string: string;
  comment: string;
  function: string;
  type: string;
  variable: string;
  number: string;
  operator: string;
  punctuation: string;
  tag: string;
  attribute: string;
  constant: string;
  property: string;
}

// ---------------------------------------------------------------------------
// Overlay / glass effect colors
// ---------------------------------------------------------------------------

export interface OverlayColors {
  /** Strong glass-morphism bg (headers/footers with backdrop-blur) */
  glass: string;
  /** Lighter glass bg */
  glassLight: string;
  /** Interactive surface bg (buttons, form elements) */
  surface: string;
  /** Surface hover state */
  surfaceHover: string;
  /** List item / row hover */
  hover: string;
  /** Decorative dividers between list items */
  divider: string;
  /** Heavy backdrop (modals, loading overlays) */
  backdrop: string;
  /** Lighter backdrop */
  backdropLight: string;
  /** Opacity for wave/decorative SVG pseudo-elements (0–1 as string) */
  waveOpacity: string;
}

// ---------------------------------------------------------------------------
// Extended palette (unique Kanagawa colors)
// ---------------------------------------------------------------------------

export interface ExtendedPalette {
  sakuraPink: string;
  springGreen: string;
  carpYellow: string;
  boatYellow: string;
  roninYellow: string;
  surimiOrange: string;
  peach: string;
  crystalBlue: string;
  springBlue: string;
  fujiGray: string;
  winterBlue: string;
  waveGlow: string;
  waveGlowStrong: string;
}

// ---------------------------------------------------------------------------
// ThemeDefinition — the full theme description
// ---------------------------------------------------------------------------

export interface ThemeDefinition {
  // Metadata
  id: string;
  name: string;
  type: 'dark' | 'light';

  // Core backgrounds
  backgrounds: {
    primary: string;
    secondary: string;
    tertiary: string;
    hover: string;
    selected: string;
    dim: string;
  };

  // Text colors
  text: {
    primary: string;
    secondary: string;
    tertiary: string;
    muted: string;
  };

  // Borders
  borders: {
    color: string;
    colorLight: string;
    light: string;
  };

  // Accent / primary colors
  accent: {
    color: string;
    hover: string;
    bg: string;
    primary: string;
    primaryHover: string;
    primaryDark: string;
  };

  // Focus
  focus: {
    ring: string;
  };

  // Links
  links: {
    color: string;
  };

  // Status colors
  status: {
    error: StatusColorGroup;
    success: StatusColorGroup;
    warning: StatusColorGroup;
    info: StatusColorGroup;
  };

  // Diff colors
  diff: DiffColors;

  // Labels
  labels: {
    bg: string;
    text: string;
  };

  // Card
  card: {
    bg: string;
  };

  // Input / disabled / code backgrounds
  input: {
    bg: string;
    disabledBg: string;
    codeBg: string;
  };

  // Overlay / glass effects
  overlays: OverlayColors;

  // Extended palette
  extended: ExtendedPalette;

  // Monaco editor token colors
  monacoTokenColors: MonacoTokenColor[];

  // Monaco editor UI colors
  monacoEditorColors: MonacoEditorColors;

  // Syntax highlight colors (tree-sitter)
  syntaxHighlight: SyntaxHighlightColors;
}
