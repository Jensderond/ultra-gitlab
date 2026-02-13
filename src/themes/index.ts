export type {
  ThemeDefinition,
  StatusColorGroup,
  DiffColors,
  MonacoTokenColor,
  MonacoEditorColors,
  SyntaxHighlightColors,
  ExtendedPalette,
} from './types';

export { kanagawaWave } from './kanagawa-wave';
export { kanagawaLight } from './kanagawa-light';
export { loved } from './loved';

export { themeToMonacoTheme, getMonacoThemeName } from './monacoAdapter';

export { deriveTheme } from './deriveTheme';
