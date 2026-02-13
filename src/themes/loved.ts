import type { ThemeDefinition } from './types';

/**
 * Loved — a cool-toned dark theme with deep navy backgrounds,
 * soft silver text, and a calming blue accent.
 */
export const loved: ThemeDefinition = {
  id: 'loved',
  name: 'Loved',
  type: 'dark',

  backgrounds: {
    primary: '#121926',
    secondary: '#17202f',
    tertiary: '#1e2a3d',
    hover: '#253449',
    selected: '#2a3f5c',
    dim: '#0f1520',
  },

  text: {
    primary: '#c0c5ce',
    secondary: '#99a4b8',
    tertiary: '#6b7a94',
    muted: '#4e5d73',
  },

  borders: {
    color: '#253449',
    colorLight: '#1e2a3d',
    light: '#1e2a3d',
  },

  accent: {
    color: '#99beff',
    hover: '#b3ceff',
    bg: '#1e3050',
    primary: '#99beff',
    primaryHover: '#b3ceff',
    primaryDark: '#7aa3e8',
  },

  focus: {
    ring: 'rgba(153, 190, 255, 0.4)',
  },

  links: {
    color: '#99beff',
  },

  status: {
    error: {
      color: '#e05252',
      bg: 'rgba(224, 82, 82, 0.15)',
      text: '#e05252',
      light: 'rgba(224, 82, 82, 0.12)',
    },
    success: {
      color: '#97a38f',
      bg: 'rgba(151, 163, 143, 0.15)',
      text: '#97a38f',
      light: 'rgba(151, 163, 143, 0.12)',
    },
    warning: {
      color: '#eabe9a',
      bg: 'rgba(234, 190, 154, 0.15)',
      text: '#eabe9a',
      light: 'rgba(234, 190, 154, 0.12)',
    },
    info: {
      color: '#99beff',
      bg: 'rgba(153, 190, 255, 0.15)',
      text: '#99beff',
      light: 'rgba(153, 190, 255, 0.12)',
    },
  },

  diff: {
    addBg: 'rgba(151, 163, 143, 0.12)',
    addHover: 'rgba(151, 163, 143, 0.2)',
    addGutter: 'rgba(151, 163, 143, 0.2)',
    addText: '#97a38f',
    removeBg: 'rgba(224, 82, 82, 0.12)',
    removeHover: 'rgba(224, 82, 82, 0.2)',
    removeGutter: 'rgba(224, 82, 82, 0.2)',
    removeText: '#e05252',
    gutterBg: '#0f1520',
    hunkHeaderBg: 'rgba(153, 190, 255, 0.1)',
    hunkHeaderText: '#99beff',
  },

  labels: {
    bg: 'rgba(153, 190, 255, 0.2)',
    text: '#b3ceff',
  },

  card: {
    bg: '#17202f',
  },

  input: {
    bg: '#121926',
    disabledBg: '#1e2a3d',
    codeBg: '#0f1520',
  },

  extended: {
    sakuraPink: '#ea7599',
    springGreen: '#97a38f',
    carpYellow: '#eabe9a',
    boatYellow: '#c4a882',
    roninYellow: '#f7987e',
    surimiOrange: '#f7987e',
    peach: '#a67868',
    crystalBlue: '#99beff',
    springBlue: '#7ea9a9',
    fujiGray: '#4e5d73',
    winterBlue: '#1e2a3d',
    waveGlow: 'rgba(153, 190, 255, 0.15)',
    waveGlowStrong: 'rgba(153, 190, 255, 0.3)',
  },

  monacoTokenColors: [
    // Base
    { token: '', foreground: 'c0c5ce' },
    // Comments
    { token: 'comment', foreground: '4e5d73', fontStyle: 'italic' },
    { token: 'comment.line', foreground: '4e5d73', fontStyle: 'italic' },
    { token: 'comment.block', foreground: '4e5d73', fontStyle: 'italic' },
    { token: 'comment.doc', foreground: '4e5d73', fontStyle: 'italic' },
    // Strings
    { token: 'string', foreground: '97a38f' },
    { token: 'string.quoted', foreground: '97a38f' },
    { token: 'string.template', foreground: '97a38f' },
    { token: 'string.regexp', foreground: 'ea7599' },
    { token: 'string.escape', foreground: 'eabe9a' },
    // Keywords
    { token: 'keyword', foreground: 'b18bb1' },
    { token: 'keyword.control', foreground: 'b18bb1' },
    { token: 'keyword.operator', foreground: 'c4a882' },
    { token: 'keyword.other', foreground: 'b18bb1' },
    // Functions
    { token: 'entity.name.function', foreground: '6e94b9' },
    { token: 'support.function', foreground: '6e94b9' },
    { token: 'function', foreground: '6e94b9' },
    // Types
    { token: 'entity.name.type', foreground: '7ea9a9' },
    { token: 'entity.name.class', foreground: '7ea9a9' },
    { token: 'support.type', foreground: '7ea9a9' },
    { token: 'type', foreground: '7ea9a9' },
    // Variables
    { token: 'variable', foreground: 'c0c5ce' },
    { token: 'variable.parameter', foreground: 'eabe9a' },
    { token: 'variable.other', foreground: 'c0c5ce' },
    // Constants
    { token: 'constant', foreground: 'ea7599' },
    { token: 'constant.numeric', foreground: 'ea7599' },
    { token: 'constant.language', foreground: 'ea7599' },
    { token: 'constant.character', foreground: 'ea7599' },
    // Operators
    { token: 'operator', foreground: 'c4a882' },
    { token: 'punctuation', foreground: '99a4b8' },
    // Tags (HTML/JSX)
    { token: 'tag', foreground: '6e94b9' },
    { token: 'tag.attribute.name', foreground: 'c4a882' },
    // CSS
    { token: 'attribute.name', foreground: 'c4a882' },
    { token: 'attribute.value', foreground: '97a38f' },
    // JSON
    { token: 'string.key.json', foreground: '6e94b9' },
    { token: 'string.value.json', foreground: '97a38f' },
    // Markdown
    { token: 'markup.heading', foreground: '99beff', fontStyle: 'bold' },
    { token: 'markup.bold', foreground: 'c0c5ce', fontStyle: 'bold' },
    { token: 'markup.italic', foreground: 'c0c5ce', fontStyle: 'italic' },
    { token: 'markup.underline', foreground: 'c0c5ce', fontStyle: 'underline' },
    { token: 'markup.raw', foreground: '97a38f' },
    { token: 'markup.quote', foreground: '4e5d73', fontStyle: 'italic' },
    // Diff
    { token: 'inserted', foreground: '97a38f' },
    { token: 'deleted', foreground: 'e05252' },
    { token: 'changed', foreground: 'eabe9a' },
  ],

  monacoEditorColors: {
    editorBackground: '#17202f',
    editorForeground: '#c0c5ce',
    selectionBackground: '#2a3f5c',
    lineHighlightBackground: '#1e2a3d',
    gutterBackground: '#17202f',
    lineNumberForeground: '#4e5d73',
    lineNumberActiveForeground: '#99a4b8',
  },

  syntaxHighlight: {
    keyword: '#b18bb1',
    string: '#97a38f',
    comment: '#4e5d73',
    function: '#6e94b9',
    type: '#7ea9a9',
    variable: '#c0c5ce',
    number: '#ea7599',
    operator: '#c4a882',
    punctuation: '#99a4b8',
    tag: '#6e94b9',
    attribute: '#c4a882',
    constant: '#ea7599',
    property: '#99beff',
  },
};
