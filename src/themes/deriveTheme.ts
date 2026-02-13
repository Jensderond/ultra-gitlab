import type { ThemeDefinition, StatusColorGroup } from './types';
import { kanagawaWave } from './kanagawa-wave';
import { kanagawaLight } from './kanagawa-light';

// ---------------------------------------------------------------------------
// HSL helpers — pure functions, no external dependencies
// ---------------------------------------------------------------------------

interface HSL {
  h: number; // 0–360
  s: number; // 0–1
  l: number; // 0–1
}

/** Parse a hex color (#rrggbb or #rgb) into [r, g, b] (0–255). */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  const full = h.length === 3
    ? h[0] + h[0] + h[1] + h[1] + h[2] + h[2]
    : h;
  const n = parseInt(full, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Convert RGB (0–255) to HSL. */
function rgbToHsl(r: number, g: number, b: number): HSL {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
  else if (max === g) h = ((b - r) / d + 2) / 6;
  else h = ((r - g) / d + 4) / 6;
  return { h: h * 360, s, l };
}

/** Convert HSL to RGB (0–255). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360; // normalise hue
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; }
  else if (h < 120) { r = x; g = c; }
  else if (h < 180) { g = c; b = x; }
  else if (h < 240) { g = x; b = c; }
  else if (h < 300) { r = x; b = c; }
  else              { r = c; b = x; }
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

/** Convert HSL values to a hex string (#rrggbb). */
function hslToHex(h: number, s: number, l: number): string {
  const [r, g, b] = hslToRgb(h, s, l);
  return '#' + [r, g, b].map(v => v.toString(16).padStart(2, '0')).join('');
}

/** Parse hex to HSL. */
function hexToHsl(hex: string): HSL {
  const [r, g, b] = hexToRgb(hex);
  return rgbToHsl(r, g, b);
}

/** Clamp a number between 0 and 1. */
function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Shift lightness of a hex color by a delta (-1..1). */
function shiftLightness(hex: string, delta: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, s, clamp01(l + delta));
}

/** Build an rgba() string from a hex color and alpha. */
function rgba(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Relative luminance (0–1) of a hex color, used to detect dark vs light. */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}

/** Rotate hue of a hex color by degrees. */
function rotateHue(hex: string, degrees: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h + degrees, s, l);
}

/** Adjust saturation of a hex color by a delta (-1..1). */
function adjustSaturation(hex: string, delta: number): string {
  const { h, s, l } = hexToHsl(hex);
  return hslToHex(h, clamp01(s + delta), l);
}

// ---------------------------------------------------------------------------
// Derive a status color group from a single base color
// ---------------------------------------------------------------------------

function deriveStatusGroup(color: string, isDark: boolean): StatusColorGroup {
  const bgAlpha = isDark ? 0.15 : 0.12;
  const lightAlpha = isDark ? 0.12 : 0.08;
  return {
    color,
    bg: rgba(color, bgAlpha),
    text: color,
    light: rgba(color, lightAlpha),
  };
}

// ---------------------------------------------------------------------------
// Derive status colors by hue-rotating from the accent
// ---------------------------------------------------------------------------

function deriveStatusColors(accent: string, isDark: boolean) {
  const { s, l } = hexToHsl(accent);

  // Fixed hue targets for each status — independent of accent hue
  // Error: red ~0/360, Success: green ~120, Warning: yellow ~45, Info: blue ~220
  const errorHue = 0;
  const successHue = 120;
  const warningHue = 45;
  const infoHue = 220;

  // Ensure good saturation for status colors
  const statusS = Math.max(s, 0.5);
  const statusL = isDark ? Math.max(l, 0.45) : Math.min(l, 0.45);

  const errorColor = hslToHex(errorHue, statusS, statusL);
  const successColor = hslToHex(successHue, clamp01(statusS - 0.1), statusL);
  const warningColor = hslToHex(warningHue, statusS, isDark ? Math.max(statusL, 0.55) : Math.min(statusL, 0.4));
  const infoHex = hslToHex(infoHue, statusS, statusL);

  return {
    error: deriveStatusGroup(errorColor, isDark),
    success: deriveStatusGroup(successColor, isDark),
    warning: deriveStatusGroup(warningColor, isDark),
    info: deriveStatusGroup(infoHex, isDark),
  };
}

// ---------------------------------------------------------------------------
// deriveTheme — the main export
// ---------------------------------------------------------------------------

/**
 * Derive a complete ThemeDefinition from 3 input colors.
 *
 * Pure function — no side effects, uses only HSL math.
 *
 * @param bg     - Background color (hex, e.g. "#1f1f28")
 * @param text   - Text color (hex, e.g. "#dcd7ba")
 * @param accent - Accent color (hex, e.g. "#7e9cd8")
 */
export function deriveTheme(bg: string, text: string, accent: string): ThemeDefinition {
  const isDark = luminance(bg) < 0.2;
  const dir = isDark ? 1 : -1; // lightness shift direction

  // --- Backgrounds ---
  const bgSecondary = shiftLightness(bg, dir * 0.04);
  const bgTertiary  = shiftLightness(bg, dir * 0.08);
  const bgHover     = shiftLightness(bg, dir * 0.12);
  const bgSelected  = adjustSaturation(shiftLightness(accent, isDark ? -0.25 : 0.25), -0.3);
  const bgDim       = shiftLightness(bg, -dir * 0.02);

  // --- Text shades ---
  const textSecondary = shiftLightness(text, -dir * 0.08);
  const textTertiary  = shiftLightness(text, -dir * 0.18);
  const textMuted     = shiftLightness(text, -dir * 0.28);

  // --- Borders ---
  const borderColor      = bgHover;
  const borderColorLight = bgTertiary;
  const borderLight      = bgTertiary;

  // --- Accent variants ---
  const accentHover       = shiftLightness(accent, dir * 0.06);
  const accentBg          = adjustSaturation(shiftLightness(accent, isDark ? -0.25 : 0.25), -0.3);
  const accentPrimaryDark = shiftLightness(accent, -dir * 0.06);

  // --- Focus ---
  const focusRing = rgba(accent, 0.4);

  // --- Status colors ---
  const status = deriveStatusColors(accent, isDark);

  // --- Diff colors from status ---
  const diffAddColor    = status.success.color;
  const diffRemoveColor = status.error.color;
  const diffAddBgAlpha    = isDark ? 0.12 : 0.15;
  const diffRemoveBgAlpha = isDark ? 0.12 : 0.12;

  // --- Extended palette via hue rotation ---
  const { h: accentH, s: accentS, l: accentL } = hexToHsl(accent);
  const extPink       = hslToHex(accentH - 120, clamp01(accentS + 0.1), accentL);
  const extGreen      = hslToHex(120, clamp01(accentS - 0.1), accentL);
  const extYellow     = hslToHex(45, accentS, isDark ? Math.max(accentL, 0.55) : Math.min(accentL, 0.4));
  const extBoatYellow = shiftLightness(extYellow, -0.1);
  const extRonin      = hslToHex(25, clamp01(accentS + 0.2), isDark ? 0.62 : 0.42);
  const extOrange     = hslToHex(18, clamp01(accentS + 0.2), isDark ? 0.60 : 0.40);
  const extPeach      = hslToHex(355, clamp01(accentS + 0.1), isDark ? 0.55 : 0.40);
  const extCrystal    = shiftLightness(accent, dir * 0.1);
  const extSpringBlue = adjustSaturation(rotateHue(accent, -30), -0.15);
  const extFuji       = textMuted;
  const extWinter     = bgTertiary;

  // --- Monaco/syntax: use nearest preset ---
  const preset = isDark ? kanagawaWave : kanagawaLight;

  const theme: ThemeDefinition = {
    id: 'custom',
    name: 'Custom',
    type: isDark ? 'dark' : 'light',

    backgrounds: {
      primary: bg,
      secondary: bgSecondary,
      tertiary: bgTertiary,
      hover: bgHover,
      selected: bgSelected,
      dim: bgDim,
    },

    text: {
      primary: text,
      secondary: textSecondary,
      tertiary: textTertiary,
      muted: textMuted,
    },

    borders: {
      color: borderColor,
      colorLight: borderColorLight,
      light: borderLight,
    },

    accent: {
      color: accent,
      hover: accentHover,
      bg: accentBg,
      primary: accent,
      primaryHover: accentHover,
      primaryDark: accentPrimaryDark,
    },

    focus: {
      ring: focusRing,
    },

    links: {
      color: accent,
    },

    status,

    diff: {
      addBg: rgba(diffAddColor, diffAddBgAlpha),
      addHover: rgba(diffAddColor, diffAddBgAlpha + 0.08),
      addGutter: rgba(diffAddColor, diffAddBgAlpha + 0.08),
      addText: diffAddColor,
      removeBg: rgba(diffRemoveColor, diffRemoveBgAlpha),
      removeHover: rgba(diffRemoveColor, diffRemoveBgAlpha + 0.08),
      removeGutter: rgba(diffRemoveColor, diffRemoveBgAlpha + 0.08),
      removeText: diffRemoveColor,
      gutterBg: bgDim,
      hunkHeaderBg: rgba(accent, 0.1),
      hunkHeaderText: accent,
    },

    labels: {
      bg: rgba(accent, 0.2),
      text: accentHover,
    },

    card: {
      bg: bgSecondary,
    },

    input: {
      bg: bg,
      disabledBg: bgTertiary,
      codeBg: bgDim,
    },

    overlays: {
      glass: rgba(bgSecondary, isDark ? 0.95 : 0.95),
      glassLight: rgba(bgSecondary, isDark ? 0.75 : 0.80),
      surface: rgba(bgTertiary, isDark ? 0.6 : 0.50),
      surfaceHover: rgba(bgTertiary, isDark ? 0.9 : 0.80),
      hover: rgba(bgTertiary, isDark ? 0.4 : 0.50),
      divider: rgba(text, isDark ? 0.08 : 0.10),
      backdrop: rgba(bg, isDark ? 0.85 : 0.90),
      backdropLight: rgba(bg, isDark ? 0.5 : 0.70),
      waveOpacity: '0',
    },

    extended: {
      sakuraPink: extPink,
      springGreen: extGreen,
      carpYellow: extYellow,
      boatYellow: extBoatYellow,
      roninYellow: extRonin,
      surimiOrange: extOrange,
      peach: extPeach,
      crystalBlue: extCrystal,
      springBlue: extSpringBlue,
      fujiGray: extFuji,
      winterBlue: extWinter,
      waveGlow: rgba(accent, 0.15),
      waveGlowStrong: rgba(accent, 0.3),
    },

    // Use nearest preset's token colors based on bg luminance
    monacoTokenColors: preset.monacoTokenColors,
    monacoEditorColors: {
      editorBackground: bgSecondary,
      editorForeground: text,
      selectionBackground: bgSelected,
      lineHighlightBackground: bgTertiary,
      gutterBackground: bgSecondary,
      lineNumberForeground: textMuted,
      lineNumberActiveForeground: textSecondary,
    },

    syntaxHighlight: preset.syntaxHighlight,
  };

  return theme;
}
