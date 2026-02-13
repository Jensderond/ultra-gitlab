import type { ThemeDefinition } from './types';

/**
 * Kanagawa Wave — dark theme inspired by "The Great Wave off Kanagawa"
 * by Katsushika Hokusai.
 *
 * Color values extracted from App.css :root and MRDetailPage.css --kw-* variables.
 */
export const kanagawaWave: ThemeDefinition = {
  id: 'kanagawa-wave',
  name: 'Kanagawa Wave',
  type: 'dark',

  backgrounds: {
    primary: '#16161d',
    secondary: '#1f1f28',
    tertiary: '#2a2a37',
    hover: '#363646',
    selected: '#223249',
    dim: '#181820',
  },

  text: {
    primary: '#dcd7ba',
    secondary: '#c8c093',
    tertiary: '#727169',
    muted: '#625e5a',
  },

  borders: {
    color: '#363646',
    colorLight: '#2a2a37',
    light: '#2a2a37',
  },

  accent: {
    color: '#7e9cd8',
    hover: '#7fb4ca',
    bg: '#223249',
    primary: '#7e9cd8',
    primaryHover: '#7fb4ca',
    primaryDark: '#6a89c7',
  },

  focus: {
    ring: 'rgba(126, 156, 216, 0.4)',
  },

  links: {
    color: '#7e9cd8',
  },

  status: {
    error: {
      color: '#c34043',
      bg: 'rgba(195, 64, 67, 0.15)',
      text: '#c34043',
      light: 'rgba(195, 64, 67, 0.12)',
    },
    success: {
      color: '#98bb6c',
      bg: 'rgba(152, 187, 108, 0.15)',
      text: '#98bb6c',
      light: 'rgba(152, 187, 108, 0.12)',
    },
    warning: {
      color: '#e6c384',
      bg: 'rgba(230, 195, 132, 0.15)',
      text: '#e6c384',
      light: 'rgba(230, 195, 132, 0.12)',
    },
    info: {
      color: '#7e9cd8',
      bg: 'rgba(126, 156, 216, 0.15)',
      text: '#7e9cd8',
      light: 'rgba(126, 156, 216, 0.12)',
    },
  },

  diff: {
    addBg: 'rgba(152, 187, 108, 0.12)',
    addHover: 'rgba(152, 187, 108, 0.2)',
    addGutter: 'rgba(152, 187, 108, 0.2)',
    addText: '#98bb6c',
    removeBg: 'rgba(195, 64, 67, 0.12)',
    removeHover: 'rgba(195, 64, 67, 0.2)',
    removeGutter: 'rgba(195, 64, 67, 0.2)',
    removeText: '#c34043',
    gutterBg: '#1a1a22',
    hunkHeaderBg: 'rgba(126, 156, 216, 0.1)',
    hunkHeaderText: '#7e9cd8',
  },

  labels: {
    bg: 'rgba(126, 156, 216, 0.2)',
    text: '#7fb4ca',
  },

  card: {
    bg: '#1f1f28',
  },

  input: {
    bg: '#16161d',
    disabledBg: '#2a2a37',
    codeBg: '#1a1a22',
  },

  overlays: {
    glass: 'rgba(31, 31, 40, 0.95)',
    glassLight: 'rgba(31, 31, 40, 0.75)',
    surface: 'rgba(42, 42, 55, 0.6)',
    surfaceHover: 'rgba(42, 42, 55, 0.9)',
    hover: 'rgba(42, 42, 55, 0.4)',
    divider: 'rgba(54, 54, 70, 0.35)',
    backdrop: 'rgba(22, 22, 29, 0.85)',
    backdropLight: 'rgba(22, 22, 29, 0.5)',
    waveOpacity: '1',
  },

  extended: {
    sakuraPink: '#d27e99',
    springGreen: '#98bb6c',
    carpYellow: '#e6c384',
    boatYellow: '#c0a36e',
    roninYellow: '#ff9e3b',
    surimiOrange: '#ffa066',
    peach: '#e46876',
    crystalBlue: '#a3d4d5',
    springBlue: '#7aa89f',
    fujiGray: '#54546d',
    winterBlue: '#252535',
    waveGlow: 'rgba(126, 156, 216, 0.15)',
    waveGlowStrong: 'rgba(126, 156, 216, 0.3)',
  },

  monacoTokenColors: [
    // Base
    { token: '', foreground: 'dcd7ba' },
    // Comments
    { token: 'comment', foreground: '727169', fontStyle: 'italic' },
    { token: 'comment.line', foreground: '727169', fontStyle: 'italic' },
    { token: 'comment.block', foreground: '727169', fontStyle: 'italic' },
    { token: 'comment.doc', foreground: '727169', fontStyle: 'italic' },
    // Strings
    { token: 'string', foreground: '98bb6c' },
    { token: 'string.quoted', foreground: '98bb6c' },
    { token: 'string.template', foreground: '98bb6c' },
    { token: 'string.regexp', foreground: 'e46876' },
    { token: 'string.escape', foreground: 'e6c384' },
    // Keywords
    { token: 'keyword', foreground: '957fb8' },
    { token: 'keyword.control', foreground: '957fb8' },
    { token: 'keyword.operator', foreground: 'c0a36e' },
    { token: 'keyword.other', foreground: '957fb8' },
    // Functions
    { token: 'entity.name.function', foreground: '7e9cd8' },
    { token: 'support.function', foreground: '7e9cd8' },
    { token: 'function', foreground: '7e9cd8' },
    // Types
    { token: 'entity.name.type', foreground: '7aa89f' },
    { token: 'entity.name.class', foreground: '7aa89f' },
    { token: 'support.type', foreground: '7aa89f' },
    { token: 'type', foreground: '7aa89f' },
    // Variables
    { token: 'variable', foreground: 'dcd7ba' },
    { token: 'variable.parameter', foreground: 'e6c384' },
    { token: 'variable.other', foreground: 'dcd7ba' },
    // Constants
    { token: 'constant', foreground: 'd27e99' },
    { token: 'constant.numeric', foreground: 'd27e99' },
    { token: 'constant.language', foreground: 'd27e99' },
    { token: 'constant.character', foreground: 'd27e99' },
    // Operators
    { token: 'operator', foreground: 'c0a36e' },
    { token: 'punctuation', foreground: '9cabca' },
    // Tags (HTML/JSX)
    { token: 'tag', foreground: '7e9cd8' },
    { token: 'tag.attribute.name', foreground: 'c0a36e' },
    // CSS
    { token: 'attribute.name', foreground: 'c0a36e' },
    { token: 'attribute.value', foreground: '98bb6c' },
    // JSON
    { token: 'string.key.json', foreground: '7e9cd8' },
    { token: 'string.value.json', foreground: '98bb6c' },
    // Markdown
    { token: 'markup.heading', foreground: '7e9cd8', fontStyle: 'bold' },
    { token: 'markup.bold', foreground: 'dcd7ba', fontStyle: 'bold' },
    { token: 'markup.italic', foreground: 'dcd7ba', fontStyle: 'italic' },
    { token: 'markup.underline', foreground: 'dcd7ba', fontStyle: 'underline' },
    { token: 'markup.raw', foreground: '98bb6c' },
    { token: 'markup.quote', foreground: '727169', fontStyle: 'italic' },
    // Diff
    { token: 'inserted', foreground: '98bb6c' },
    { token: 'deleted', foreground: 'c34043' },
    { token: 'changed', foreground: 'e6c384' },
  ],

  monacoEditorColors: {
    editorBackground: '#1f1f28',
    editorForeground: '#dcd7ba',
    selectionBackground: '#2d4f67',
    lineHighlightBackground: '#2a2a37',
    gutterBackground: '#1f1f28',
    lineNumberForeground: '#54546d',
    lineNumberActiveForeground: '#c8c093',
  },

  syntaxHighlight: {
    keyword: '#ff7b72',
    string: '#a5d6ff',
    comment: '#8b949e',
    function: '#d2a8ff',
    type: '#ffa657',
    variable: '#c9d1d9',
    number: '#79c0ff',
    operator: '#ff7b72',
    punctuation: '#c9d1d9',
    tag: '#7ee787',
    attribute: '#7ee787',
    constant: '#79c0ff',
    property: '#79c0ff',
  },
};
