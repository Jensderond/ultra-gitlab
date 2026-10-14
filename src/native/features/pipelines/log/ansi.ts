/**
 * ANSI SGR → styled segments.
 *
 * Handles 16 colours (as classes that map to `--log-ansi-*` tokens), 256-colour
 * and truecolor (as inline rgb), bold / dim / italic / underline / inverse.
 * Every other escape sequence (cursor movement, erase-line, OSC hyperlinks) is
 * dropped. State carries across lines, like a terminal.
 */

export interface Seg {
  /** Visible text. */
  t: string;
  /** Class names (`a-fg1 a-b` …), absent when unstyled. */
  c?: string;
  /** Inline colours for 256/truecolor. */
  s?: { color?: string; background?: string };
}

export interface AnsiState {
  fg: number | string | null;
  bg: number | string | null;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}

export const newAnsiState = (): AnsiState => ({
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
});

const CUBE = [0, 95, 135, 175, 215, 255];

/** 256-colour index → 0..15 (palette class) or an rgb string. */
function color256(n: number): number | string {
  if (n < 16) return n;
  if (n < 232) {
    const i = n - 16;
    return `rgb(${CUBE[Math.floor(i / 36)]},${CUBE[Math.floor(i / 6) % 6]},${CUBE[i % 6]})`;
  }
  const v = 8 + (n - 232) * 10;
  return `rgb(${v},${v},${v})`;
}

function applySgr(state: AnsiState, params: string) {
  const p = params === '' ? [0] : params.split(/[;:]/).map((x) => (x === '' ? 0 : Number(x)));
  for (let i = 0; i < p.length; i++) {
    const n = p[i];
    if (n === 0) Object.assign(state, newAnsiState());
    else if (n === 1) state.bold = true;
    else if (n === 2) state.dim = true;
    else if (n === 3) state.italic = true;
    else if (n === 4) state.underline = true;
    else if (n === 7) state.inverse = true;
    else if (n === 21 || n === 22) {
      state.bold = false;
      state.dim = false;
    } else if (n === 23) state.italic = false;
    else if (n === 24) state.underline = false;
    else if (n === 27) state.inverse = false;
    else if (n >= 30 && n <= 37) state.fg = n - 30;
    else if (n >= 90 && n <= 97) state.fg = n - 90 + 8;
    else if (n === 39) state.fg = null;
    else if (n >= 40 && n <= 47) state.bg = n - 40;
    else if (n >= 100 && n <= 107) state.bg = n - 100 + 8;
    else if (n === 49) state.bg = null;
    else if (n === 38 || n === 48) {
      let value: number | string | null = null;
      if (p[i + 1] === 5 && p[i + 2] !== undefined) {
        value = color256(p[i + 2]);
        i += 2;
      } else if (p[i + 1] === 2 && p[i + 4] !== undefined) {
        value = `rgb(${p[i + 2]},${p[i + 3]},${p[i + 4]})`;
        i += 4;
      }
      if (value !== null) {
        if (n === 38) state.fg = value;
        else state.bg = value;
      }
    }
  }
}

function styleOf(state: AnsiState): Pick<Seg, 'c' | 's'> {
  let fg = state.fg;
  let bg = state.bg;
  if (state.inverse) {
    fg = state.bg ?? 'inv-fg';
    bg = state.fg ?? 'inv-bg';
  }
  const classes: string[] = [];
  let s: Seg['s'];
  // Bold low colours render bright, like most terminals.
  if (typeof fg === 'number') classes.push(`a-fg${state.bold && fg < 8 ? fg + 8 : fg}`);
  else if (fg === 'inv-fg') classes.push('a-fg-inv');
  else if (fg) s = { color: fg };
  if (typeof bg === 'number') classes.push(`a-bg${bg}`);
  else if (bg === 'inv-bg') classes.push('a-bg-inv');
  else if (bg) s = { ...s, background: bg };
  if (state.bold) classes.push('a-b');
  if (state.dim) classes.push('a-d');
  if (state.italic) classes.push('a-i');
  if (state.underline) classes.push('a-u');
  return { c: classes.length ? classes.join(' ') : undefined, s };
}

// CSI (any final byte), OSC (terminated by BEL or ST), and lone two-byte escapes.
const ESCAPES = /\x1b\[([0-9;:?]*)([@-~])|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]/g;

/** Parse one line into segments, mutating `state`. */
export function parseAnsi(line: string, state: AnsiState): Seg[] {
  if (line.indexOf('\x1b') < 0) {
    if (!line) return [];
    const st = styleOf(state);
    return [{ t: line, ...st }];
  }
  const out: Seg[] = [];
  let last = 0;
  ESCAPES.lastIndex = 0;
  let m: RegExpExecArray | null;
  const push = (text: string) => {
    if (!text) return;
    const st = styleOf(state);
    const prev = out[out.length - 1];
    if (prev && prev.c === st.c && prev.s === undefined && st.s === undefined) prev.t += text;
    else out.push({ t: text, ...st });
  };
  while ((m = ESCAPES.exec(line))) {
    push(line.slice(last, m.index));
    if (m[2] === 'm') applySgr(state, m[1]);
    last = ESCAPES.lastIndex;
  }
  push(line.slice(last));
  return out;
}

/** Remove every escape sequence. */
export function stripAnsi(line: string): string {
  return line.indexOf('\x1b') < 0 ? line : line.replace(ESCAPES, '');
}
