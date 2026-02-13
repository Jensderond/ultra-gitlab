/**
 * ThemeProvider — applies a ThemeDefinition to :root CSS variables at runtime.
 *
 * Wraps the app and provides theme context. On mount and theme change,
 * all CSS variable values from the active ThemeDefinition are written
 * to document.documentElement.style.
 *
 * Loads the persisted theme ID from the Rust settings store on startup.
 */

import { createContext, useEffect, useState, useCallback, type ReactNode } from 'react';
import type { ThemeDefinition } from '../themes/types';
import { kanagawaWave } from '../themes/kanagawa-wave';
import { kanagawaLight } from '../themes/kanagawa-light';
import { loved } from '../themes/loved';
import { invoke, updateTheme as persistTheme } from '../services/tauri';
import type { Theme } from '../types';

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

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<ThemeDefinition>(kanagawaWave);

  // Load persisted theme on mount
  useEffect(() => {
    invoke<{ theme?: string }>('get_settings')
      .then((settings) => {
        const id = settings.theme || 'kanagawa-wave';
        const def = THEME_PRESETS[id];
        if (def) setThemeState(def);
      })
      .catch(() => {
        // Fall back to default (already set)
      });
  }, []);

  const setTheme = useCallback((newTheme: ThemeDefinition) => {
    setThemeState(newTheme);
  }, []);

  const setThemeById = useCallback((id: Theme) => {
    const def = THEME_PRESETS[id];
    if (def) {
      setThemeState(def);
      persistTheme(id).catch(console.error);
    }
  }, []);

  // Apply CSS variables whenever theme changes
  useEffect(() => {
    const vars = themeToCssVars(theme);
    const root = document.documentElement;
    for (const [prop, value] of Object.entries(vars)) {
      root.style.setProperty(prop, value);
    }
  }, [theme]);

  return (
    <ThemeContext value={{ theme, setTheme, setThemeById }}>
      {children}
    </ThemeContext>
  );
}
