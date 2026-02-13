import type { ThemeDefinition } from './types';

/**
 * Kanagawa Light (Lotus) — light theme based on the Lotus variant of
 * the Kanagawa colorscheme by rebelot.
 *
 * Warm off-white backgrounds, dark ink text, and muted natural accent colors
 * for comfortable use in bright environments.
 *
 * Palette reference: https://github.com/rebelot/kanagawa.nvim (Lotus)
 */
export const kanagawaLight: ThemeDefinition = {
  id: 'kanagawa-light',
  name: 'Kanagawa Light',
  type: 'light',

  backgrounds: {
    primary: '#f2ecbc',   // lotusWhite3 — main background
    secondary: '#e5ddb0', // lotusWhite2 — cards, sidebar
    tertiary: '#dcd5ac',  // lotusWhite1 — hover rows, highlights
    hover: '#d5cea3',     // lotusWhite0 — hover states
    selected: '#c9cbd1',  // lotusViolet3 — selection
    dim: '#e7dba0',       // lotusWhite4 — gutter / dimmed bg
  },

  text: {
    primary: '#545464',   // lotusInk1 — main text
    secondary: '#43436c', // lotusInk2 — dimmed text
    tertiary: '#5e5b50',  // darkened lotusGray2 — tertiary text (5.5:1 on cream bg)
    muted: '#787669',     // darkened lotusGray3 — comments, muted (3.9:1 on cream bg)
  },

  borders: {
    color: '#d5cea3',     // lotusWhite0
    colorLight: '#dcd5ac', // lotusWhite1
    light: '#e5ddb0',     // lotusWhite2
  },

  accent: {
    color: '#4d699b',     // lotusBlue4 — primary accent
    hover: '#4e8ca2',     // lotusTeal1 — accent hover
    bg: '#c7d7e0',        // lotusBlue1 — accent background
    primary: '#4d699b',   // lotusBlue4
    primaryHover: '#4e8ca2', // lotusTeal1
    primaryDark: '#43436c',  // lotusInk2 — darker accent for contrast
  },

  focus: {
    ring: 'rgba(77, 105, 155, 0.4)', // lotusBlue4 with opacity
  },

  links: {
    color: '#4d699b',     // lotusBlue4
  },

  status: {
    error: {
      color: '#c84053',   // lotusRed
      bg: 'rgba(200, 64, 83, 0.12)',
      text: '#c84053',
      light: 'rgba(200, 64, 83, 0.08)',
    },
    success: {
      color: '#6f894e',   // lotusGreen
      bg: 'rgba(111, 137, 78, 0.12)',
      text: '#6f894e',
      light: 'rgba(111, 137, 78, 0.08)',
    },
    warning: {
      color: '#cc6d00',   // lotusOrange
      bg: 'rgba(204, 109, 0, 0.12)',
      text: '#cc6d00',
      light: 'rgba(204, 109, 0, 0.08)',
    },
    info: {
      color: '#4d699b',   // lotusBlue4
      bg: 'rgba(77, 105, 155, 0.12)',
      text: '#4d699b',
      light: 'rgba(77, 105, 155, 0.08)',
    },
  },

  diff: {
    addBg: 'rgba(111, 137, 78, 0.10)',    // lotusGreen — gentle tint
    addHover: 'rgba(111, 137, 78, 0.18)',
    addGutter: 'rgba(111, 137, 78, 0.18)',
    addText: '#6f894e',
    removeBg: 'rgba(200, 64, 83, 0.20)',   // lotusRed — 20% on cream
    removeHover: 'rgba(200, 64, 83, 0.28)',
    removeGutter: 'rgba(200, 64, 83, 0.28)',
    removeText: '#c84053',
    gutterBg: '#e7dba0',                    // lotusWhite4
    hunkHeaderBg: 'rgba(77, 105, 155, 0.08)',
    hunkHeaderText: '#4d699b',
  },

  labels: {
    bg: 'rgba(77, 105, 155, 0.15)',
    text: '#4d699b',
  },

  card: {
    bg: '#e5ddb0',        // lotusWhite2
  },

  input: {
    bg: '#f2ecbc',        // lotusWhite3 — same as primary bg
    disabledBg: '#e5ddb0', // lotusWhite2
    codeBg: '#e7dba0',     // lotusWhite4
  },

  overlays: {
    glass: 'rgba(229, 221, 176, 0.95)',
    glassLight: 'rgba(229, 221, 176, 0.80)',
    surface: 'rgba(213, 206, 163, 0.50)',
    surfaceHover: 'rgba(213, 206, 163, 0.80)',
    hover: 'rgba(220, 213, 172, 0.50)',
    divider: 'rgba(84, 84, 100, 0.15)',
    backdrop: 'rgba(242, 236, 188, 0.90)',
    backdropLight: 'rgba(242, 236, 188, 0.70)',
    waveOpacity: '0',
  },

  extended: {
    sakuraPink: '#b35b79',    // lotusPink
    springGreen: '#6f894e',   // lotusGreen
    carpYellow: '#de9800',    // lotusYellow3
    boatYellow: '#836f4a',    // lotusYellow2
    roninYellow: '#e98a00',   // lotusOrange2
    surimiOrange: '#cc6d00',  // lotusOrange
    peach: '#d7474b',         // lotusRed2
    crystalBlue: '#9fb5c9',   // lotusBlue3
    springBlue: '#597b75',    // lotusAqua
    fujiGray: '#787669',      // darkened lotusGray3
    winterBlue: '#dcd5ac',    // lotusWhite1 — muted bg
    waveGlow: 'rgba(77, 105, 155, 0.1)',
    waveGlowStrong: 'rgba(77, 105, 155, 0.2)',
  },

  monacoTokenColors: [
    // Base
    { token: '', foreground: '545464' },        // lotusInk1
    // Comments
    { token: 'comment', foreground: '787669', fontStyle: 'italic' },       // lotusGray3
    { token: 'comment.line', foreground: '787669', fontStyle: 'italic' },
    { token: 'comment.block', foreground: '787669', fontStyle: 'italic' },
    { token: 'comment.doc', foreground: '787669', fontStyle: 'italic' },
    // Strings
    { token: 'string', foreground: '6f894e' },          // lotusGreen
    { token: 'string.quoted', foreground: '6f894e' },
    { token: 'string.template', foreground: '6f894e' },
    { token: 'string.regexp', foreground: 'c84053' },   // lotusRed
    { token: 'string.escape', foreground: 'de9800' },   // lotusYellow3
    // Keywords
    { token: 'keyword', foreground: '624c83' },          // lotusViolet4
    { token: 'keyword.control', foreground: '624c83' },
    { token: 'keyword.operator', foreground: '836f4a' }, // lotusYellow2
    { token: 'keyword.other', foreground: '624c83' },
    // Functions
    { token: 'entity.name.function', foreground: '4d699b' }, // lotusBlue4
    { token: 'support.function', foreground: '4d699b' },
    { token: 'function', foreground: '4d699b' },
    // Types
    { token: 'entity.name.type', foreground: '597b75' },  // lotusAqua
    { token: 'entity.name.class', foreground: '597b75' },
    { token: 'support.type', foreground: '597b75' },
    { token: 'type', foreground: '597b75' },
    // Variables
    { token: 'variable', foreground: '545464' },           // lotusInk1
    { token: 'variable.parameter', foreground: '5d57a3' }, // lotusBlue5
    { token: 'variable.other', foreground: '545464' },
    // Constants
    { token: 'constant', foreground: 'cc6d00' },           // lotusOrange
    { token: 'constant.numeric', foreground: 'b35b79' },   // lotusPink
    { token: 'constant.language', foreground: 'cc6d00' },
    { token: 'constant.character', foreground: 'cc6d00' },
    // Operators
    { token: 'operator', foreground: '836f4a' },            // lotusYellow2
    { token: 'punctuation', foreground: '635f54' },         // lotusGray2
    // Tags (HTML/JSX)
    { token: 'tag', foreground: '4d699b' },                 // lotusBlue4
    { token: 'tag.attribute.name', foreground: '836f4a' },  // lotusYellow2
    // CSS
    { token: 'attribute.name', foreground: '836f4a' },
    { token: 'attribute.value', foreground: '6f894e' },
    // JSON
    { token: 'string.key.json', foreground: '4d699b' },
    { token: 'string.value.json', foreground: '6f894e' },
    // Markdown
    { token: 'markup.heading', foreground: '4d699b', fontStyle: 'bold' },
    { token: 'markup.bold', foreground: '545464', fontStyle: 'bold' },
    { token: 'markup.italic', foreground: '545464', fontStyle: 'italic' },
    { token: 'markup.underline', foreground: '545464', fontStyle: 'underline' },
    { token: 'markup.raw', foreground: '6f894e' },
    { token: 'markup.quote', foreground: '787669', fontStyle: 'italic' },
    // Diff
    { token: 'inserted', foreground: '6f894e' },
    { token: 'deleted', foreground: 'c84053' },
    { token: 'changed', foreground: 'de9800' },
  ],

  monacoEditorColors: {
    editorBackground: '#e5ddb0',     // lotusWhite2 — editor bg
    editorForeground: '#545464',     // lotusInk1
    selectionBackground: '#b5cbd2',  // lotusBlue2
    lineHighlightBackground: '#dcd5ac', // lotusWhite1
    gutterBackground: '#e5ddb0',     // lotusWhite2
    lineNumberForeground: '#787669', // darkened lotusGray3
    lineNumberActiveForeground: '#545464', // lotusInk1
  },

  syntaxHighlight: {
    keyword: '#624c83',     // lotusViolet4
    string: '#6f894e',      // lotusGreen
    comment: '#787669',     // darkened lotusGray3
    function: '#4d699b',    // lotusBlue4
    type: '#597b75',        // lotusAqua
    variable: '#545464',    // lotusInk1
    number: '#b35b79',      // lotusPink
    operator: '#836f4a',    // lotusYellow2
    punctuation: '#635f54', // darkened lotusGray2
    tag: '#4d699b',         // lotusBlue4
    attribute: '#836f4a',   // lotusYellow2
    constant: '#cc6d00',    // lotusOrange
    property: '#4e8ca2',    // lotusTeal1
  },
};
