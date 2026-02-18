/**
 * ThemeProvider — applies a ThemeDefinition to :root CSS variables at runtime.
 *
 * Wraps the app and provides theme context. On mount and theme change,
 * all CSS variable values from the active ThemeDefinition are written
 * to document.documentElement.style.
 *
 * Loads the persisted theme ID from the Rust settings store on startup.
 */

import { createContext, useEffect, useReducer, useCallback, type ReactNode } from 'react';
import type { ThemeDefinition } from '../themes/types';
import { kanagawaWave } from '../themes/kanagawa-wave';
import { kanagawaLight } from '../themes/kanagawa-light';
import { loved } from '../themes/loved';
import { invoke, updateTheme as persistTheme, updateUiFont as persistUiFont, updateDisplayFont as persistDisplayFont, updateCustomThemeColors as persistCustomColors, type CustomThemeColors } from '../services/tauri';
import { deriveTheme } from '../themes/deriveTheme';
import type { Theme } from '../types';

/** Available UI font options. */
export const UI_FONTS = [
  { id: 'Noto Sans JP', label: 'Noto Sans JP', family: "'Noto Sans JP', -apple-system, sans-serif", googleFont: 'Noto+Sans+JP:wght@300;400;500;600;700' },
  { id: 'Cormorant Garamond', label: 'Cormorant Garamond', family: "'Cormorant Garamond', Georgia, serif", googleFont: 'Cormorant+Garamond:wght@300;400;500;600;700' },
  { id: 'Inter', label: 'Inter', family: "'Inter', -apple-system, sans-serif", googleFont: 'Inter:wght@300;400;500;600;700' },
  { id: 'SF Pro', label: 'SF Pro', family: "-apple-system, BlinkMacSystemFont, 'Helvetica Neue', sans-serif", googleFont: null },
  { id: 'System Default', label: 'System Default', family: "system-ui, -apple-system, sans-serif", googleFont: null },
] as const;

/** All available preset themes keyed by ID. */
export const THEME_PRESETS: Record<string, ThemeDefinition> = {
  'kanagawa-wave': kanagawaWave,
  'kanagawa-light': kanagawaLight,
  'loved': loved,
};

export interface ThemeContextValue {
  theme: ThemeDefinition;
  setTheme: (theme: ThemeDefinition) => void;
  /** Switch to a preset theme by ID and persist the choice. */
  setThemeById: (id: Theme) => void;
  /** Current UI font ID. */
  uiFont: string;
  /** Switch UI font and persist the choice. */
  setUiFont: (fontId: string) => void;
  /** Current display font ID. */
  displayFont: string;
  /** Switch display font and persist the choice. */
  setDisplayFont: (fontId: string) => void;
  /** Saved custom theme colors (null if none saved). */
  customColors: CustomThemeColors | null;
  /** Apply a custom theme from 3 colors (live preview, does NOT persist). */
  previewCustomTheme: (colors: CustomThemeColors) => void;
  /** Save the custom theme colors and switch to the custom theme. */
  saveCustomTheme: (colors: CustomThemeColors) => void;
  /** Delete the saved custom theme and revert to default preset. */
  deleteCustomTheme: () => void;
}

export const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Map a ThemeDefinition to a flat record of CSS variable name → value.
 */
function themeToCssVars(t: ThemeDefinition): Record<string, string> {
  return {
    // Backgrounds
    '--bg-primary': t.backgrounds.primary,
    '--bg-secondary': t.backgrounds.secondary,
    '--bg-tertiary': t.backgrounds.tertiary,
    '--bg-dim': t.backgrounds.dim,
    '--bg-hover': t.backgrounds.hover,
    '--bg-selected': t.backgrounds.selected,

    // Text
    '--text-primary': t.text.primary,
    '--text-secondary': t.text.secondary,
    '--text-tertiary': t.text.tertiary,
    '--text-muted': t.text.muted,

    // Borders
    '--border-color': t.borders.color,
    '--border-color-light': t.borders.colorLight,
    '--border-light': t.borders.light,

    // Accent
    '--accent-color': t.accent.color,
    '--accent-hover': t.accent.hover,
    '--accent-bg': t.accent.bg,
    '--primary-color': t.accent.primary,
    '--primary-hover': t.accent.primaryHover,
    '--primary-dark': t.accent.primaryDark,

    // Focus
    '--focus-ring': t.focus.ring,

    // Links
    '--link-color': t.links.color,

    // Status - error
    '--error-color': t.status.error.color,
    '--error-bg': t.status.error.bg,
    '--error-text': t.status.error.text,
    '--error-light': t.status.error.light,

    // Status - success
    '--success-color': t.status.success.color,
    '--success-bg': t.status.success.bg,

    // Status - warning
    '--warning-color': t.status.warning.color,
    '--warning-bg': t.status.warning.bg,
    '--warning-text': t.status.warning.text,
    '--warning-light': t.status.warning.light,

    // Status - info
    '--info-bg': t.status.info.bg,
    '--info-text': t.status.info.text,

    // Diff
    '--diff-add-bg': t.diff.addBg,
    '--diff-add-hover': t.diff.addHover,
    '--diff-add-gutter': t.diff.addGutter,
    '--diff-add-text': t.diff.addText,
    '--diff-remove-bg': t.diff.removeBg,
    '--diff-remove-hover': t.diff.removeHover,
    '--diff-remove-gutter': t.diff.removeGutter,
    '--diff-remove-text': t.diff.removeText,
    '--gutter-bg': t.diff.gutterBg,
    '--hunk-header-bg': t.diff.hunkHeaderBg,
    '--hunk-header-text': t.diff.hunkHeaderText,

    // Labels
    '--label-bg': t.labels.bg,
    '--label-text': t.labels.text,

    // Card
    '--card-bg': t.card.bg,

    // Input
    '--input-bg': t.input.bg,
    '--disabled-bg': t.input.disabledBg,
    '--code-bg': t.input.codeBg,

    // Overlay / glass effects
    '--overlay-glass': t.overlays.glass,
    '--overlay-glass-light': t.overlays.glassLight,
    '--overlay-surface': t.overlays.surface,
    '--overlay-surface-hover': t.overlays.surfaceHover,
    '--overlay-hover': t.overlays.hover,
    '--overlay-divider': t.overlays.divider,
    '--overlay-backdrop': t.overlays.backdrop,
    '--overlay-backdrop-light': t.overlays.backdropLight,
    '--wave-decoration-opacity': t.overlays.waveOpacity,

    // Extended palette
    '--accent-pink': t.extended.sakuraPink,
    '--accent-green': t.extended.springBlue,
    '--accent-crystal': t.extended.crystalBlue,
    '--accent-warm-yellow': t.extended.boatYellow,
    '--accent-ronin': t.extended.roninYellow,
    '--accent-orange': t.extended.surimiOrange,
    '--accent-peach': t.extended.peach,
    '--bg-winter': t.extended.winterBlue,
    '--text-fuji': t.extended.fujiGray,
    '--wave-glow': t.extended.waveGlow,
    '--wave-glow-strong': t.extended.waveGlowStrong,

    // Syntax highlighting (tree-sitter)
    '--syntax-keyword': t.syntaxHighlight.keyword,
    '--syntax-string': t.syntaxHighlight.string,
    '--syntax-comment': t.syntaxHighlight.comment,
    '--syntax-function': t.syntaxHighlight.function,
    '--syntax-type': t.syntaxHighlight.type,
    '--syntax-variable': t.syntaxHighlight.variable,
    '--syntax-number': t.syntaxHighlight.number,
    '--syntax-operator': t.syntaxHighlight.operator,
    '--syntax-punctuation': t.syntaxHighlight.punctuation,
    '--syntax-tag': t.syntaxHighlight.tag,
    '--syntax-attribute': t.syntaxHighlight.attribute,
    '--syntax-constant': t.syntaxHighlight.constant,
    '--syntax-property': t.syntaxHighlight.property,
    // Extra syntax vars not in SyntaxHighlightColors but used by syntax.css
    '--syntax-string-special': t.syntaxHighlight.attribute,
    '--syntax-embedded-bg': t.accent.bg,
  };
}

interface ThemeProviderProps {
  children: ReactNode;
}

/**
 * Load a Google Font by injecting a <link> into <head>.
 * Returns a cleanup function to remove the link.
 * No-op for system fonts (googleFont === null).
 */
function loadGoogleFont(googleFont: string | null): (() => void) | undefined {
  if (!googleFont) return undefined;
  const id = `google-font-${googleFont.replace(/[^a-zA-Z0-9]/g, '-')}`;
  if (document.getElementById(id)) return undefined;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?family=${googleFont}&display=swap`;
  document.head.appendChild(link);
  return () => link.remove();
}

interface ThemeState {
  theme: ThemeDefinition;
  uiFont: string;
  displayFont: string;
  customColors: CustomThemeColors | null;
}

type ThemeAction =
  | { type: 'INIT'; theme: ThemeDefinition; uiFont: string; displayFont: string; customColors: CustomThemeColors | null }
  | { type: 'SET_THEME'; theme: ThemeDefinition }
  | { type: 'SET_UI_FONT'; uiFont: string }
  | { type: 'SET_DISPLAY_FONT'; displayFont: string }
  | { type: 'SAVE_CUSTOM'; colors: CustomThemeColors; theme: ThemeDefinition }
  | { type: 'DELETE_CUSTOM' };

function themeReducer(state: ThemeState, action: ThemeAction): ThemeState {
  switch (action.type) {
    case 'INIT':
      return { theme: action.theme, uiFont: action.uiFont, displayFont: action.displayFont, customColors: action.customColors };
    case 'SET_THEME':
      return { ...state, theme: action.theme };
    case 'SET_UI_FONT':
      return { ...state, uiFont: action.uiFont };
    case 'SET_DISPLAY_FONT':
      return { ...state, displayFont: action.displayFont };
    case 'SAVE_CUSTOM':
      return { ...state, customColors: action.colors, theme: action.theme };
    case 'DELETE_CUSTOM':
      return { ...state, customColors: null, theme: kanagawaWave };
  }
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [state, dispatch] = useReducer(themeReducer, {
    theme: kanagawaWave,
    uiFont: 'Noto Sans JP',
    displayFont: 'Cormorant Garamond',
    customColors: null,
  });

  const { theme, uiFont, displayFont, customColors } = state;

  // Load persisted theme, font, and custom colors on mount
  useEffect(() => {
    invoke<{ theme?: string; uiFont?: string; displayFont?: string; customThemeColors?: CustomThemeColors | null }>('get_settings')
      .then((settings) => {
        const id = settings.theme || 'kanagawa-wave';
        const savedColors = settings.customThemeColors ?? null;
        const font = settings.uiFont || 'Noto Sans JP';
        const dFont = settings.displayFont || 'Cormorant Garamond';

        let resolvedTheme: ThemeDefinition = kanagawaWave;
        if (id === 'custom' && savedColors) {
          resolvedTheme = deriveTheme(savedColors.bg, savedColors.text, savedColors.accent);
        } else {
          const def = THEME_PRESETS[id];
          if (def) resolvedTheme = def;
        }

        dispatch({ type: 'INIT', theme: resolvedTheme, uiFont: font, displayFont: dFont, customColors: savedColors });

        // Eager-load the saved fonts
        const fontDef = UI_FONTS.find(f => f.id === font);
        if (fontDef) loadGoogleFont(fontDef.googleFont);
        const displayFontDef = UI_FONTS.find(f => f.id === dFont);
        if (displayFontDef) loadGoogleFont(displayFontDef.googleFont);
      })
      .catch(() => {
        // Fall back to defaults (already set)
      });
  }, []);

  const setTheme = useCallback((newTheme: ThemeDefinition) => {
    dispatch({ type: 'SET_THEME', theme: newTheme });
  }, []);

  const setThemeById = useCallback((id: Theme) => {
    if (id === 'custom' && customColors) {
      dispatch({ type: 'SET_THEME', theme: deriveTheme(customColors.bg, customColors.text, customColors.accent) });
      persistTheme(id).catch(console.error);
      return;
    }
    const def = THEME_PRESETS[id];
    if (def) {
      dispatch({ type: 'SET_THEME', theme: def });
      persistTheme(id).catch(console.error);
    }
  }, [customColors]);

  const setUiFont = useCallback((fontId: string) => {
    dispatch({ type: 'SET_UI_FONT', uiFont: fontId });
    const fontDef = UI_FONTS.find(f => f.id === fontId);
    if (fontDef) loadGoogleFont(fontDef.googleFont);
    persistUiFont(fontId).catch(console.error);
  }, []);

  const setDisplayFont = useCallback((fontId: string) => {
    dispatch({ type: 'SET_DISPLAY_FONT', displayFont: fontId });
    const fontDef = UI_FONTS.find(f => f.id === fontId);
    if (fontDef) loadGoogleFont(fontDef.googleFont);
    persistDisplayFont(fontId).catch(console.error);
  }, []);

  const previewCustomTheme = useCallback((colors: CustomThemeColors) => {
    dispatch({ type: 'SET_THEME', theme: deriveTheme(colors.bg, colors.text, colors.accent) });
  }, []);

  const saveCustomTheme = useCallback((colors: CustomThemeColors) => {
    dispatch({ type: 'SAVE_CUSTOM', colors, theme: deriveTheme(colors.bg, colors.text, colors.accent) });
    persistTheme('custom').catch(console.error);
    persistCustomColors(colors).catch(console.error);
  }, []);

  const deleteCustomTheme = useCallback(() => {
    dispatch({ type: 'DELETE_CUSTOM' });
    persistTheme('kanagawa-wave').catch(console.error);
    persistCustomColors(null).catch(console.error);
  }, []);

  // Apply CSS variables whenever theme changes
  useEffect(() => {
    const vars = themeToCssVars(theme);
    const root = document.documentElement;
    for (const [prop, value] of Object.entries(vars)) {
      root.style.setProperty(prop, value);
    }
  }, [theme]);

  // Apply font-family to :root whenever uiFont changes
  useEffect(() => {
    const fontDef = UI_FONTS.find(f => f.id === uiFont);
    if (fontDef) {
      document.documentElement.style.setProperty('font-family', fontDef.family);
    }
  }, [uiFont]);

  // Apply --font-display to :root whenever displayFont changes
  useEffect(() => {
    const fontDef = UI_FONTS.find(f => f.id === displayFont);
    if (fontDef) {
      document.documentElement.style.setProperty('--font-display', fontDef.family);
    }
  }, [displayFont]);

  return (
    <ThemeContext value={{ theme, setTheme, setThemeById, uiFont, setUiFont, displayFont, setDisplayFont, customColors, previewCustomTheme, saveCustomTheme, deleteCustomTheme }}>
      {children}
    </ThemeContext>
  );
}
