/**
 * Lightweight ANSI SGR escape code parser.
 *
 * Converts ANSI-colored text into an array of styled segments
 * that React can render as <span> elements.
 *
 * Supports: standard 8/16 colors, 256-color, bold, dim, italic, underline.
 * Strips non-SGR escape sequences (cursor movement, etc.) so they
 * don't appear as raw text.
 */

export interface AnsiSegment {
  text: string;
  style: React.CSSProperties;
}

/** Standard 8-color palette (normal intensity). */
const COLORS_NORMAL: Record<number, string> = {
  0: '#1e1e1e', // black
  1: '#cd3131', // red
  2: '#0dbc79', // green
  3: '#e5e510', // yellow
  4: '#2472c8', // blue
  5: '#bc3fbc', // magenta
  6: '#11a8cd', // cyan
  7: '#e5e5e5', // white
};

/** Standard 8-color palette (bright/bold intensity). */
const COLORS_BRIGHT: Record<number, string> = {
  0: '#666666', // bright black
  1: '#f14c4c', // bright red
  2: '#23d18b', // bright green
  3: '#f5f543', // bright yellow
  4: '#3b8eea', // bright blue
  5: '#d670d6', // bright magenta
  6: '#29b8db', // bright cyan
  7: '#ffffff', // bright white
};

/**
 * Build the 256-color lookup table.
 * 0-7: standard, 8-15: bright, 16-231: 6x6x6 color cube, 232-255: grayscale.
 */
function build256ColorTable(): string[] {
  const table: string[] = [];
  for (let i = 0; i < 8; i++) table.push(COLORS_NORMAL[i]);
  for (let i = 0; i < 8; i++) table.push(COLORS_BRIGHT[i]);
  // 6x6x6 color cube
  const levels = [0, 95, 135, 175, 215, 255];
  for (let r = 0; r < 6; r++) {
    for (let g = 0; g < 6; g++) {
      for (let b = 0; b < 6; b++) {
        table.push(`rgb(${levels[r]},${levels[g]},${levels[b]})`);
      }
    }
  }
  // Grayscale ramp 232-255
  for (let i = 0; i < 24; i++) {
    const v = 8 + i * 10;
    table.push(`rgb(${v},${v},${v})`);
  }
  return table;
}

const COLOR_256 = build256ColorTable();

interface AnsiState {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  fg: string | null;
  bg: string | null;
}

function defaultState(): AnsiState {
  return { bold: false, dim: false, italic: false, underline: false, fg: null, bg: null };
}

function stateToStyle(s: AnsiState): React.CSSProperties {
  const style: React.CSSProperties = {};
  if (s.bold) style.fontWeight = 'bold';
  if (s.dim) style.opacity = 0.6;
  if (s.italic) style.fontStyle = 'italic';
  if (s.underline) style.textDecoration = 'underline';
  if (s.fg) style.color = s.fg;
  if (s.bg) style.backgroundColor = s.bg;
  return style;
}

function resolveColor(params: number[], idx: number): [string | null, number] {
  const base = params[idx];
  // Extended color: 38;5;N (256-color) or 38;2;R;G;B (truecolor)
  if (params[idx + 1] === 5 && idx + 2 < params.length) {
    const n = params[idx + 2];
    return [n >= 0 && n < 256 ? COLOR_256[n] : null, idx + 3];
  }
  if (params[idx + 1] === 2 && idx + 4 < params.length) {
    return [`rgb(${params[idx + 2]},${params[idx + 3]},${params[idx + 4]})`, idx + 5];
  }
  // Shouldn't reach here if called correctly, but handle gracefully
  void base;
  return [null, idx + 1];
}

function applyParams(state: AnsiState, params: number[]): void {
  let i = 0;
  while (i < params.length) {
    const p = params[i];
    if (p === 0) {
      Object.assign(state, defaultState());
      i++;
    } else if (p === 1) { state.bold = true; i++; }
    else if (p === 2) { state.dim = true; i++; }
    else if (p === 3) { state.italic = true; i++; }
    else if (p === 4) { state.underline = true; i++; }
    else if (p === 22) { state.bold = false; state.dim = false; i++; }
    else if (p === 23) { state.italic = false; i++; }
    else if (p === 24) { state.underline = false; i++; }
    else if (p >= 30 && p <= 37) {
      state.fg = state.bold ? COLORS_BRIGHT[p - 30] : COLORS_NORMAL[p - 30];
      i++;
    } else if (p === 38) {
      const [color, next] = resolveColor(params, i);
      state.fg = color;
      i = next;
    } else if (p === 39) { state.fg = null; i++; }
    else if (p >= 40 && p <= 47) {
      state.bg = COLORS_NORMAL[p - 40];
      i++;
    } else if (p === 48) {
      const [color, next] = resolveColor(params, i);
      state.bg = color;
      i = next;
    } else if (p === 49) { state.bg = null; i++; }
    else if (p >= 90 && p <= 97) {
      state.fg = COLORS_BRIGHT[p - 90];
      i++;
    } else if (p >= 100 && p <= 107) {
      state.bg = COLORS_BRIGHT[p - 100];
      i++;
    } else {
      i++; // skip unknown
    }
  }
}

/**
 * Strip GitLab CI section markers (section_start/section_end escape sequences).
 * These look like: \x1b[0Ksection_start:timestamp:name\r\x1b[0K
 */
function stripSectionMarkers(input: string): string {
  return input.replace(/section_(start|end):\d+:[^\r\n]*\r?/g, '');
}

/**
 * Parse a single line of ANSI-escaped text into styled segments.
 *
 * Unlike `parseAnsi()`, this does NOT strip section markers — the caller
 * is responsible for that. It also accepts (and mutates) an existing
 * `AnsiState` so that styles carry across lines.
 */
export function parseAnsiLine(
  line: string,
  state: AnsiState = defaultState(),
): AnsiSegment[] {
  const segments: AnsiSegment[] = [];

  const regex = /\x1b(?:\[([0-9;]*)([A-Za-z])|][^\x07\x1b]*(?:\x07|\x1b\\)|[^[\]])|([^\x1b]+)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(line)) !== null) {
    const [, csiParams, csiFinal, text] = match;

    if (text !== undefined) {
      const parts = text.split('\r');
      const visibleText = parts[parts.length - 1];
      if (visibleText.length > 0) {
        const style = stateToStyle(state);
        const last = segments.length > 0 ? segments[segments.length - 1] : null;
        if (last && stylesEqual(last.style, style)) {
          last.text += visibleText;
        } else {
          segments.push({ text: visibleText, style });
        }
      }
    } else if (csiFinal === 'm' && csiParams !== undefined) {
      const nums = csiParams.length === 0 ? [0] : csiParams.split(';').map(Number);
      applyParams(state, nums);
    }
  }

  return segments;
}

/** Create a fresh default ANSI state. Exported for use by logLineParser. */
export function createAnsiState(): AnsiState {
  return defaultState();
}

/**
 * Parse ANSI-escaped text into an array of styled segments.
 *
 * - Recognizes CSI SGR sequences (ESC [ ... m) for colors/attributes.
 * - Strips all other CSI/OSC/escape sequences so they don't appear as raw text.
 * - Handles \r by resetting the current line (carriage return behavior).
 */
export function parseAnsi(input: string): AnsiSegment[] {
  const cleaned = stripSectionMarkers(input);
  return parseAnsiLine(cleaned);
}

function stylesEqual(a: React.CSSProperties, b: React.CSSProperties): boolean {
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if ((a as Record<string, unknown>)[k] !== (b as Record<string, unknown>)[k]) return false;
  }
  return true;
}
