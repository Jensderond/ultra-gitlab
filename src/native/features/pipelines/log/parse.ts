/**
 * GitLab job trace → lines + collapsible sections.
 *
 *   section_start:<unix>:<name>[collapsed=true]\r\e[0K<header>
 *   ...
 *   section_end:<unix>:<name>\r\e[0K
 *
 * Also handles carriage-return overwrites (progress bars), erase-line codes,
 * and the runner's per-line timestamp prefix (GitLab 17.1+:
 * `2024-05-30T14:30:00.000000Z 00O ` with `+` marking a continuation).
 */

import { newAnsiState, parseAnsi, stripAnsi, type Seg } from './ansi';

export interface LogLine {
  /** 1-based display number. */
  n: number;
  /** Plain text (no escapes) — used for search and failure analysis. */
  text: string;
  segs: Seg[];
  /** Innermost section id, or -1 at top level. */
  section: number;
}

export interface LogSection {
  id: number;
  /** Marker name, e.g. `step_script`. */
  key: string;
  /** Header text, e.g. `Executing "step_script" stage of the job script`. */
  title: string;
  /** Asked to start collapsed (`[collapsed=true]`). */
  collapsedHint: boolean;
  parent: number;
  depth: number;
  /** Line index range [from, to) of everything inside (including nested sections). */
  from: number;
  to: number;
  startedAt: number | null;
  endedAt: number | null;
  /** True when no end marker was seen (job still running, or trace cut off). */
  open: boolean;
}

export interface ParsedLog {
  lines: LogLine[];
  sections: LogSection[];
}

const MARKER = /section_(start|end):(\d+):([A-Za-z0-9_.-]+)(\[[^\]]*\])?\r?(?:\x1b\[0?K)*/g;
const RUNNER_TS = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z [0-9a-f]{2}[EO]([+ ])/;

/** Resolve `\r` overwrites: the last non-empty write to the line wins. */
function resolveCR(line: string): string {
  if (line.indexOf('\r') < 0) return line;
  const parts = line.split('\r');
  for (let i = parts.length - 1; i >= 0; i--) {
    if (stripAnsi(parts[i]).trim() !== '') {
      // Keep colour codes opened in earlier writes so state stays right.
      const lead = parts
        .slice(0, i)
        .join('')
        .match(/\x1b\[[0-9;:]*m/g);
      return (lead ? lead.join('') : '') + parts[i];
    }
  }
  return parts.join('');
}

export function humanizeKey(key: string): string {
  const s = key.replace(/[_-]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function parseTrace(trace: string): ParsedLog {
  const lines: LogLine[] = [];
  const sections: LogSection[] = [];
  const stack: LogSection[] = [];
  const state = newAnsiState();
  const raw = trace.split('\n');
  let timestamped: boolean | null = null;

  const current = () => (stack.length ? stack[stack.length - 1].id : -1);

  const emit = (content: string, append: boolean) => {
    const resolved = resolveCR(content);
    const segs = parseAnsi(resolved, state);
    const text = segs.map((s) => s.t).join('');
    if (append && lines.length) {
      const prev = lines[lines.length - 1];
      prev.segs.push(...segs);
      prev.text += text;
      return;
    }
    lines.push({ n: lines.length + 1, text, segs, section: current() });
  };

  for (let r = 0; r < raw.length; r++) {
    let line = raw[r];
    let append = false;
    if (timestamped === null && line.length > 0) timestamped = RUNNER_TS.test(line);
    if (timestamped) {
      const m = RUNNER_TS.exec(line);
      if (m) {
        append = m[1] === '+';
        line = line.slice(m[0].length);
      }
    }
    // The trace ends with a newline; don't render a phantom empty last line.
    if (r === raw.length - 1 && line === '') break;

    if (line.indexOf('section_') < 0) {
      emit(line, append);
      continue;
    }

    MARKER.lastIndex = 0;
    let pos = 0;
    let afterStart: LogSection | null = null;
    let m: RegExpExecArray | null;
    while ((m = MARKER.exec(line))) {
      const before = line.slice(pos, m.index);
      if (stripAnsi(before).trim()) emit(before, false);
      pos = MARKER.lastIndex;
      const ts = Number(m[2]);
      const key = m[3];
      if (m[1] === 'start') {
        const parent = stack[stack.length - 1];
        const section: LogSection = {
          id: sections.length,
          key,
          title: humanizeKey(key),
          collapsedHint: /collapsed=true/.test(m[4] ?? ''),
          parent: parent ? parent.id : -1,
          depth: stack.length,
          from: lines.length,
          to: lines.length,
          startedAt: ts || null,
          endedAt: null,
          open: true,
        };
        sections.push(section);
        stack.push(section);
        afterStart = section;
      } else {
        afterStart = null;
        const at = stack.map((s) => s.key).lastIndexOf(key);
        if (at >= 0) {
          while (stack.length > at) {
            const s = stack.pop()!;
            s.to = lines.length;
            s.endedAt = ts || null;
            s.open = false;
          }
        }
      }
    }
    const rest = line.slice(pos);
    if (afterStart) {
      const title = stripAnsi(resolveCR(rest)).trim();
      if (title) afterStart.title = title;
      // Keep colour state consistent with what the header opened/closed.
      parseAnsi(rest, state);
    } else if (stripAnsi(rest).trim()) {
      emit(rest, false);
    }
  }
  for (const s of stack) s.to = lines.length;
  return { lines, sections };
}

/** Section duration in seconds, if known. `now` (unix s) for still-open sections. */
export function sectionDuration(s: LogSection, now?: number): number | null {
  if (s.startedAt === null) return null;
  if (s.endedAt !== null) return Math.max(0, s.endedAt - s.startedAt);
  return now ? Math.max(0, now - s.startedAt) : null;
}

/** Ids of `id` and all its ancestors. */
export function sectionChain(sections: LogSection[], id: number): number[] {
  const out: number[] = [];
  let cur = id;
  while (cur >= 0 && sections[cur]) {
    out.push(cur);
    cur = sections[cur].parent;
  }
  return out;
}

const parsedCache = new Map<string, ParsedLog>();

/** Parse with a small memo so the summary hook and the log viewer share work. */
export function parseTraceCached(trace: string): ParsedLog {
  const hit = parsedCache.get(trace);
  if (hit) return hit;
  const parsed = parseTrace(trace);
  parsedCache.set(trace, parsed);
  if (parsedCache.size > 6) parsedCache.delete(parsedCache.keys().next().value!);
  return parsed;
}
