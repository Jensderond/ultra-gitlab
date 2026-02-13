import type { ThemeDefinition } from './types';

/**
 * Loved — a cool-toned dark theme with deep navy backgrounds,
 * soft silver text, and a signature pink accent.
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
    color: '#ea7599',
    hover: '#ee8fad',
    bg: 'rgba(234, 117, 153, 0.15)',
    primary: '#ea7599',
    primaryHover: '#ee8fad',
    primaryDark: '#d4637f',
  },

  focus: {
    ring: 'rgba(234, 117, 153, 0.4)',
  },

  links: {
    color: '#ea7599',
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
    bg: 'rgba(234, 117, 153, 0.2)',
    text: '#ee8fad',
  },

  card: {
    bg: '#17202f',
  },

  input: {
    bg: '#121926',
    disabledBg: '#1e2a3d',
    codeBg: '#0f1520',
  },

  overlays: {
    glass: 'rgba(23, 32, 47, 0.95)',
    glassLight: 'rgba(23, 32, 47, 0.75)',
    surface: 'rgba(30, 42, 61, 0.6)',
    surfaceHover: 'rgba(30, 42, 61, 0.9)',
    hover: 'rgba(30, 42, 61, 0.4)',
    divider: 'rgba(37, 52, 73, 0.35)',
    backdrop: 'rgba(18, 25, 38, 0.85)',
    backdropLight: 'rgba(18, 25, 38, 0.5)',
    waveOpacity: '0',
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
    fujiGray: '#64727d',
    winterBlue: '#1e2a3d',
    waveGlow: 'rgba(153, 190, 255, 0.15)',
    waveGlowStrong: 'rgba(153, 190, 255, 0.3)',
  },

  monacoTokenColors: [
    // Base
    { token: '', foreground: 'c0c5ce' },
    // Comments
    { token: 'comment', foreground: '64727d', fontStyle: 'italic' },
    { token: 'comment.line', foreground: '64727d', fontStyle: 'italic' },
    { token: 'comment.block', foreground: '64727d', fontStyle: 'italic' },
    { token: 'comment.doc', foreground: '64727d', fontStyle: 'italic' },
    // Strings
    { token: 'string', foreground: '97a38f' },
    { token: 'string.quoted', foreground: '97a38f' },
    { token: 'string.template', foreground: '97a38f' },
    { token: 'string.regexp', foreground: 'ea7599' },
    { token: 'string.escape', foreground: 'eabe9a' },
    // Keywords
    { token: 'keyword', foreground: 'b18bb1' },
    { token: 'keyword.control', foreground: 'b18bb1' },
    { token: 'keyword.operator', foreground: 'c0c5ce' },
    { token: 'keyword.other', foreground: 'b18bb1' },
    // Functions
    { token: 'entity.name.function', foreground: '6e94b9' },
    { token: 'support.function', foreground: '7ea9a9' },
    { token: 'function', foreground: '6e94b9' },
    // Types (entity.name → orange in original)
    { token: 'entity.name.type', foreground: 'f7987e' },
    { token: 'entity.name.class', foreground: 'f7987e' },
    { token: 'support.type', foreground: 'f7987e' },
    { token: 'type', foreground: 'f7987e' },
    // Variables (pink in original)
    { token: 'variable', foreground: 'ea7599' },
    { token: 'variable.parameter', foreground: 'ea7599' },
    { token: 'variable.other', foreground: 'ea7599' },
    // Constants (yellow in original)
    { token: 'constant', foreground: 'eabe9a' },
    { token: 'constant.numeric', foreground: 'eabe9a' },
    { token: 'constant.language', foreground: 'eabe9a' },
    { token: 'constant.character', foreground: 'eabe9a' },
    // Operators (editorForeground in original)
    { token: 'operator', foreground: 'c0c5ce' },
    { token: 'punctuation', foreground: 'c0c5ce' },
    // Tags (pink in original)
    { token: 'tag', foreground: 'ea7599' },
    { token: 'tag.attribute.name', foreground: 'eabe9a' },
    // CSS
    { token: 'attribute.name', foreground: 'eabe9a' },
    { token: 'attribute.value', foreground: '97a38f' },
    // JSON (keys are pink in original)
    { token: 'string.key.json', foreground: 'ea7599' },
    { token: 'string.value.json', foreground: '97a38f' },
    // Markdown (headings are pink in original)
    { token: 'markup.heading', foreground: 'ea7599', fontStyle: 'bold' },
    { token: 'markup.bold', foreground: 'c0c5ce', fontStyle: 'bold' },
    { token: 'markup.italic', foreground: 'c0c5ce', fontStyle: 'italic' },
    { token: 'markup.underline', foreground: 'c0c5ce', fontStyle: 'underline' },
    { token: 'markup.raw', foreground: '97a38f' },
    { token: 'markup.quote', foreground: '64727d', fontStyle: 'italic' },
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
    lineNumberForeground: '#75809590',
    lineNumberActiveForeground: '#99a4b8',
  },

  syntaxHighlight: {
    keyword: '#b18bb1',
    string: '#97a38f',
    comment: '#64727d',
    function: '#6e94b9',
    type: '#f7987e',
    variable: '#ea7599',
    number: '#eabe9a',
    operator: '#c0c5ce',
    punctuation: '#c0c5ce',
    tag: '#ea7599',
    attribute: '#eabe9a',
    constant: '#eabe9a',
    property: '#a67868',
  },
};
