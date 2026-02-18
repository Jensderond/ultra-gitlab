import type { ThemeDefinition } from './types';

/**
 * Kanagawa Light (Lotus) — light theme based on the Lotus variant of
 * the Kanagawa colorscheme by rebelot.
 *
 * Colors sourced from: https://github.com/metapho-re/kanagawa-vscode-theme
 * Palette reference: https://github.com/rebelot/kanagawa.nvim (Lotus)
 */
export const kanagawaLight: ThemeDefinition = {
  id: 'kanagawa-light',
  name: 'Kanagawa Light',
  type: 'light',

  backgrounds: {
    primary: '#f2ecbc',   // editor.background
    secondary: '#e5ddb0', // tab.inactiveBackground
    tertiary: '#F2ECBC',  // editor.lineHighlightBackground
    hover: '#d5cea3',     // dropdown.background / input.background
    selected: '#c7d7e0',  // editor.selectionBackground
    dim: '#e7dba0',       // activityBar.background
  },

  text: {
    primary: '#545464',   // editor.foreground
    secondary: '#43436c', // statusBar.foreground
    tertiary: '#716e61',  // comment foreground
    muted: '#545454',     // editorLineNumber.foreground
  },

  borders: {
    color: '#d5cea3',     // panel.border / sideBar.border
    colorLight: '#e7dba0', // editorHoverWidget.border
    light: '#e4d794',     // sideBarSectionHeader.background
  },

  accent: {
    color: '#DE9800',     // list.highlightForeground
    hover: '#5a7785',     // activityBarBadge.background
    bg: '#e4d794',        // list.activeSelectionBackground
    primary: '#4d699b',
    primaryHover: '#6693bf', // terminal.ansiBrightBlue
    primaryDark: '#43436c',  // lotusInk2
  },

  focus: {
    ring: 'rgba(77, 105, 155, 0.4)',
  },

  links: {
    color: '#5e857a',     // textLink.foreground
  },

  status: {
    error: {
      color: '#e82424',   // editorError.foreground
      bg: 'rgba(232, 36, 36, 0.12)',
      text: '#e82424',
      light: 'rgba(232, 36, 36, 0.08)',
    },
    success: {
      color: '#3b9e12',   // editorGutter.addedBackground
      bg: 'rgba(110, 145, 95, 0.12)',
      text: '#6e915f',
      light: 'rgba(110, 145, 95, 0.08)',
    },
    warning: {
      color: '#e98a00',   // editorWarning.foreground
      bg: 'rgba(233, 138, 0, 0.12)',
      text: '#e98a00',
      light: 'rgba(233, 138, 0, 0.08)',
    },
    info: {
      color: '#4d699b',
      bg: 'rgba(77, 105, 155, 0.12)',
      text: '#4d699b',
      light: 'rgba(77, 105, 155, 0.08)',
    },
  },

  diff: {
    addBg: 'rgba(183, 208, 174, 0.50)',    // diffEditor.insertedTextBackground
    addHover: 'rgba(110, 145, 95, 0.25)',
    addGutter: 'rgba(110, 145, 95, 0.25)',
    addText: '#6e915f',
    removeBg: 'rgba(215, 71, 75, 0.20)',    // editorGutter.deletedBackground
    removeHover: 'rgba(215, 71, 75, 0.28)',
    removeGutter: 'rgba(215, 71, 75, 0.28)',
    removeText: '#d7474b',
    gutterBg: '#e7dba0',
    hunkHeaderBg: 'rgba(77, 105, 155, 0.08)',
    hunkHeaderText: '#4d699b',
  },

  labels: {
    bg: 'rgba(77, 105, 155, 0.15)',
    text: '#4d699b',
  },

  card: {
    bg: '#e5ddb0',
  },

  input: {
    bg: '#d5cea3',        // input.background
    disabledBg: '#e5ddb0',
    codeBg: '#e7dba0',
  },

  overlays: {
    glass: 'rgba(229, 221, 176, 0.95)',
    glassLight: 'rgba(229, 221, 176, 0.80)',
    surface: 'rgba(204, 190, 115, 0.62)',
    surfaceHover: 'rgba(204, 190, 115, 0.80)',
    hover: 'rgba(228, 215, 148, 0.50)',
    divider: 'rgba(84, 84, 100, 0.15)',
    backdrop: 'rgba(242, 236, 188, 0.90)',
    backdropLight: 'rgba(242, 236, 188, 0.70)',
    waveOpacity: '0',
  },

  extended: {
    sakuraPink: '#b35b79',    // terminal.ansiMagenta
    springGreen: '#6e915f',   // terminal.ansiBrightGreen
    carpYellow: '#de9800',    // editorGutter.modifiedBackground
    boatYellow: '#836f4a',    // terminal.ansiBrightYellow
    roninYellow: '#e98a00',   // editorWarning.foreground
    surimiOrange: '#cc6d00',  // constant
    peach: '#d7474b',         // terminal.ansiBrightRed
    crystalBlue: '#6693bf',   // terminal.ansiBrightBlue
    springBlue: '#5e857a',    // terminal.ansiBrightCyan
    fujiGray: '#969585',      // editorLineNumber.foreground
    winterBlue: '#e4d794',    // list.activeSelectionBackground
    waveGlow: 'rgba(242, 207, 119, 0.25)',
    waveGlowStrong: 'rgba(242, 207, 119, 0.4)',
  },

  monacoTokenColors: [
    // Base
    { token: '', foreground: '545464' },
    // Comments
    { token: 'comment', foreground: '716E61', fontStyle: 'italic' },
    { token: 'comment.line', foreground: '716E61', fontStyle: 'italic' },
    { token: 'comment.block', foreground: '716E61', fontStyle: 'italic' },
    { token: 'comment.doc', foreground: '716E61', fontStyle: 'italic' },
    // Strings
    { token: 'string', foreground: '6F894E' },
    { token: 'string.quoted', foreground: '6F894E' },
    { token: 'string.template', foreground: '6F894E' },
    { token: 'string.regexp', foreground: '836F4A' },   // lotusYellow2
    { token: 'string.escape', foreground: '6693BF' },   // escape character
    // Keywords
    { token: 'keyword', foreground: '624C83' },
    { token: 'keyword.control', foreground: '624C83' },
    { token: 'keyword.operator', foreground: '77713F' }, // identifier
    { token: 'keyword.other', foreground: '624C83' },
    // Functions
    { token: 'entity.name.function', foreground: '4D699B' },
    { token: 'support.function', foreground: '4D699B' },
    { token: 'function', foreground: '4D699B' },
    // Types
    { token: 'entity.name.type', foreground: '597B75' },
    { token: 'entity.name.class', foreground: '597B75' },
    { token: 'support.type', foreground: '597B75' },
    { token: 'type', foreground: '597B75' },
    // Variables
    { token: 'variable', foreground: '545464' },
    { token: 'variable.parameter', foreground: '5D57A3' },
    { token: 'variable.other', foreground: '545464' },
    // Constants
    { token: 'constant', foreground: 'CC6D00' },
    { token: 'constant.numeric', foreground: 'B35B79' },
    { token: 'constant.language', foreground: 'CC6D00' },
    { token: 'constant.character', foreground: 'CC6D00' },
    // Operators
    { token: 'operator', foreground: '836F4A' },
    { token: 'punctuation', foreground: '4E8CA2' },      // lotusTeal1
    // Tags (HTML/JSX)
    { token: 'tag', foreground: '77713F' },               // entity.name.tag
    { token: 'tag.attribute.name', foreground: '624C83' }, // entity.other.attribute-name
    // CSS
    { token: 'attribute.name', foreground: '624C83' },
    { token: 'attribute.value', foreground: '6F894E' },
    // JSON
    { token: 'string.key.json', foreground: 'B35B79' },   // JSON Key Level 0
    { token: 'string.value.json', foreground: '6F894E' },
    // Markdown
    { token: 'markup.heading', foreground: '4D699B', fontStyle: 'bold' },
    { token: 'markup.bold', foreground: '545464', fontStyle: 'bold' },
    { token: 'markup.italic', foreground: 'C84053', fontStyle: 'italic' },
    { token: 'markup.underline', foreground: '6693BF', fontStyle: 'underline' },
    { token: 'markup.raw', foreground: '624C83' },
    { token: 'markup.quote', foreground: '716E61', fontStyle: 'italic' },
    // Diff
    { token: 'inserted', foreground: '6E915F' },
    { token: 'deleted', foreground: 'D7474B' },
    { token: 'changed', foreground: 'DE9800' },
  ],

  monacoEditorColors: {
    editorBackground: '#f2ecbc',     // editor.background
    editorForeground: '#545464',
    selectionBackground: '#c7d7e0',  // editor.selectionBackground
    lineHighlightBackground: '#e4d794', // editor.lineHighlightBackground
    gutterBackground: '#f2ecbc',
    lineNumberForeground: '#766b90', // editorLineNumber.foreground
    lineNumberActiveForeground: '#cc6d00', // editorLineNumber.activeForeground
  },

  syntaxHighlight: {
    keyword: '#624c83',
    string: '#6f894e',
    comment: '#716e61',
    function: '#4d699b',
    type: '#597b75',
    variable: '#545464',
    number: '#b35b79',
    operator: '#836f4a',
    punctuation: '#4e8ca2',   // lotusTeal1
    tag: '#77713f',           // entity.name.tag
    attribute: '#624c83',     // entity.other.attribute-name
    constant: '#cc6d00',
    property: '#77713f',      // variable.other.property
  },
};
