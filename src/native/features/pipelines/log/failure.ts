/**
 * Explain why a job failed, from its parsed trace.
 *
 * Recognises PHPUnit, Jest, Vitest, pytest, Go test, RSpec, ESLint and the
 * TypeScript compiler; anything else falls back to the last meaningful lines
 * before `ERROR: Job failed`. Everything returned is read from the log — never
 * guessed — so the UI can show it as fact.
 */

import type { LogLine, LogSection, ParsedLog } from './parse';

export interface Location {
  path: string;
  line?: number;
  /** Index into `ParsedLog.lines` where the reference was found. */
  at: number;
}

export interface Analysis {
  kind: string | null;
  headline: string | null;
  excerpt: string | null;
  locations: Location[];
  /** Line indices to highlight as errors (sorted). */
  errorLines: number[];
  /** First line worth jumping to. */
  firstError: number | null;
  /** Section that holds the failure (its id), if any. */
  failingSection: number | null;
  exitCode: number | null;
  image: string | null;
  runner: string | null;
}

/* ---------------------------------------------------------------------- */
/* Paths                                                                  */
/* ---------------------------------------------------------------------- */

const PATH = String.raw`((?:\.{1,2}/|/)?(?:[\w@.+-]+/)*[\w@+-][\w@.+-]*\.[A-Za-z][A-Za-z0-9]{0,9})`;
const LOC_PATTERNS: RegExp[] = [
  new RegExp(`${PATH}:(\\d+)(?::\\d+)?`, 'g'), // a/b.php:71, a/b.ts:23:15
  new RegExp(`${PATH}\\((\\d+),\\d+\\)`, 'g'), // tsc: a/b.ts(12,5)
  new RegExp(`File "${PATH}", line (\\d+)`, 'g'), // python traceback
];
const IGNORED_PATH =
  /(^|\/)(node_modules|vendor|site-packages|dist-packages|\.cargo|go\/pkg\/mod|usr\/(lib|local|share))\//;

/** CI checkout dir, e.g. `/builds/group/project`, read from the git step. */
function projectDir(lines: LogLine[]): string | null {
  for (let i = 0; i < Math.min(lines.length, 400); i++) {
    const m = /Git repository in (\/\S+?)\/\.git\/?/.exec(lines[i].text);
    if (m) return m[1];
  }
  return null;
}

export function makeRelativizer(lines: LogLine[]) {
  const dir = projectDir(lines);
  return (path: string): string => {
    let p = path;
    if (dir && p.startsWith(dir + '/')) p = p.slice(dir.length + 1);
    else p = p.replace(/^\/builds\/[^/]+\/[^/]+\//, '');
    return p.replace(/^\.\//, '');
  };
}

function findLocations(
  lines: LogLine[],
  indices: Iterable<number>,
  rel: (p: string) => string,
  max = 12,
): Location[] {
  const out: Location[] = [];
  const seen = new Set<string>();
  for (const i of indices) {
    const text = lines[i]?.text;
    if (!text || (text.indexOf('/') < 0 && text.indexOf('.') < 0)) continue;
    for (const re of LOC_PATTERNS) {
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(text))) {
        const before = text.slice(Math.max(0, m.index - 3), m.index);
        if (before.endsWith('://') || before.endsWith('//')) continue;
        const raw = m[1];
        if (IGNORED_PATH.test(raw) || raw.startsWith('node:')) continue;
        // Absolute paths outside the checkout are system files.
        const path = rel(raw);
        if (path.startsWith('/')) continue;
        if (!/[/.]/.test(path) || /^\d/.test(path)) continue;
        const line = Number(m[2]) || undefined;
        const key = `${path}:${line ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ path, line, at: i });
        if (out.length >= max) return out;
      }
    }
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* Helpers                                                                */
/* ---------------------------------------------------------------------- */

const range = (from: number, to: number) => Array.from({ length: Math.max(0, to - from) }, (_, k) => from + k);

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function ofTotal(failed: number, total: number | null, noun = 'test') {
  if (total && total >= failed) return `${failed} of ${total} ${total === 1 ? noun : `${noun}s`} failed`;
  return `${plural(failed, noun)} failed`;
}

function clip(text: string, max = 220) {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/** Search from the end — summaries sit at the bottom. */
function lastMatch(lines: LogLine[], re: RegExp, from = 0): { i: number; m: RegExpExecArray } | null {
  for (let i = lines.length - 1; i >= from; i--) {
    const m = re.exec(lines[i].text);
    if (m) return { i, m };
  }
  return null;
}

function firstMatch(lines: LogLine[], re: RegExp, from = 0): { i: number; m: RegExpExecArray } | null {
  for (let i = from; i < lines.length; i++) {
    const m = re.exec(lines[i].text);
    if (m) return { i, m };
  }
  return null;
}

interface Detected {
  kind: string;
  headline: string;
  excerptLines: number[];
  errorLines: number[];
  /** Lines to scan for file references, most relevant first. */
  locationLines: number[];
  /** Pre-formatted excerpt when it can't be read straight off lines. */
  excerpt?: string;
}

/** Collect following lines that belong to a failure block, until a blank gap or a stopper. */
function block(lines: LogLine[], start: number, max: number, stop?: RegExp): number[] {
  const out: number[] = [];
  let blanks = 0;
  for (let i = start; i < lines.length && out.length < max; i++) {
    const t = lines[i].text;
    if (!t.trim()) {
      if (++blanks >= 2 && out.length) break;
      continue;
    }
    if (i > start && stop?.test(t)) break;
    blanks = 0;
    out.push(i);
  }
  return out;
}

/* ---------------------------------------------------------------------- */
/* Detectors                                                              */
/* ---------------------------------------------------------------------- */

function phpunit(lines: LogLine[]): Detected | null {
  const sum = lastMatch(lines, /^Tests: (\d+), Assertions: \d+(?:, Errors: (\d+))?(?:, Failures: (\d+))?/);
  const head = firstMatch(lines, /^There (?:was|were) \d+ (?:failure|error)s?:/);
  if (!sum && !head) return null;
  const total = sum ? Number(sum.m[1]) : null;
  const failed = sum ? Number(sum.m[2] ?? 0) + Number(sum.m[3] ?? 0) : null;
  const first = firstMatch(lines, /^\d+\) \S+/, head?.i ?? 0);
  const excerpt: string[] = [];
  const excerptLines: number[] = [];
  const errorLines: number[] = [];
  if (first) {
    const name = first.m[0].replace(/^\d+\)\s*/, '').replace(/^.*\\/, '');
    const parts = name.split('::');
    excerpt.push(parts.length === 2 ? `${parts[0]}::\n${parts[1]}` : name);
    errorLines.push(first.i);
    const body = block(lines, first.i + 1, 6, /^(\/|\.\/|\w[\w/]*\.php:\d+|\d+\) )/);
    for (const i of body.slice(0, 3)) {
      excerpt.push(lines[i].text.trim());
      errorLines.push(i);
    }
    excerptLines.push(first.i, ...body);
  }
  const failuresLine = lastMatch(lines, /^(FAILURES!|ERRORS!)$/);
  if (failuresLine) errorLines.push(failuresLine.i);
  if (sum) errorLines.push(sum.i);
  const n = failed ?? (head ? Number(/\d+/.exec(head.m[0])![0]) : 1);
  return {
    kind: 'phpunit',
    headline: ofTotal(n, total),
    excerpt: excerpt.join('\n'),
    excerptLines,
    errorLines,
    locationLines: first ? range(first.i, Math.min(lines.length, first.i + 40)) : [],
  };
}

function jest(lines: LogLine[]): Detected | null {
  const sum = lastMatch(lines, /^Tests:\s+(?:(\d+) failed, )?(?:\d+ \w+, )*(\d+) total/);
  const bullet = firstMatch(lines, /^\s*● (?!Console)(.+)/);
  if (!sum && !bullet) return null;
  if (!bullet && !/failed/.test(sum!.m[0])) return null;
  const failed = sum?.m[1] ? Number(sum.m[1]) : 1;
  const total = sum ? Number(sum.m[2]) : null;
  const excerpt: string[] = [];
  const errorLines: number[] = [];
  const excerptLines: number[] = [];
  if (bullet) {
    excerpt.push(bullet.m[1].trim());
    errorLines.push(bullet.i);
    excerptLines.push(bullet.i);
    // Message lines come first, then a code frame (`> 23 |`) and a stack (`at …`).
    let phase: 'message' | 'frame' | 'stack' = 'message';
    for (let i = bullet.i + 1; i < Math.min(lines.length, bullet.i + 40); i++) {
      const t = lines[i].text.trim();
      if (/^●/.test(t)) break;
      if (!t) {
        if (phase === 'stack') break;
        continue;
      }
      if (/^at /.test(t)) {
        phase = 'stack';
        continue;
      }
      if (phase === 'stack') break;
      if (/^(>\s*)?\d+ \|/.test(t) || /^\|/.test(t)) {
        phase = 'frame';
        if (/^>/.test(t)) errorLines.push(i);
        continue;
      }
      if (phase === 'message' && excerpt.length < 4) {
        excerpt.push(t);
        errorLines.push(i);
        excerptLines.push(i);
      }
    }
  }
  const fileLine = firstMatch(lines, /^\s*FAIL\s+\S+/);
  if (fileLine) errorLines.push(fileLine.i);
  if (sum) errorLines.push(sum.i);
  const suites = lastMatch(lines, /^Test Suites:.*failed/);
  if (suites) errorLines.push(suites.i);
  return {
    kind: 'jest',
    headline: ofTotal(failed, total),
    excerpt: excerpt.slice(0, 4).join('\n'),
    excerptLines,
    errorLines,
    locationLines: bullet ? range(bullet.i, Math.min(lines.length, bullet.i + 60)) : [],
  };
}

function vitest(lines: LogLine[]): Detected | null {
  const sum = lastMatch(lines, /^\s*Tests\s+(\d+) failed(?: \| (\d+) passed)?.*?\((\d+)\)/);
  if (!sum) return null;
  const failed = Number(sum.m[1]);
  const total = Number(sum.m[3]);
  const fail = firstMatch(lines, /^\s*(?:FAIL|×|✗)\s+(.+)/);
  const excerpt: string[] = [];
  const errorLines = [sum.i];
  const excerptLines: number[] = [];
  if (fail) {
    excerpt.push(fail.m[1].replace(/\s+\d+ms$/, '').trim());
    errorLines.push(fail.i);
    excerptLines.push(fail.i);
    const err = firstMatch(lines, /^\s*(\w*Error|AssertionError|Error):?\s.+/, fail.i + 1);
    if (err && err.i < fail.i + 30) {
      excerpt.push(err.m[0].trim());
      errorLines.push(err.i);
      excerptLines.push(err.i);
    }
  }
  const from = fail?.i ?? Math.max(0, sum.i - 80);
  return {
    kind: 'vitest',
    headline: ofTotal(failed, total),
    excerpt: excerpt.join('\n'),
    excerptLines,
    errorLines,
    locationLines: range(from, Math.min(lines.length, from + 60)),
  };
}

function pytest(lines: LogLine[]): Detected | null {
  const sum = lastMatch(lines, /^=+ .*\b(failed|errors?)\b.* in [\d.]+s/);
  if (!sum) return null;
  const count = (word: string) => Number(new RegExp(`(\\d+) ${word}`).exec(sum.m[0])?.[1] ?? 0);
  const failed = count('failed') + count('errors?');
  if (!failed) return null;
  const total = failed + count('passed');
  const errorLines = [sum.i];
  const excerptLines: number[] = [];
  const excerpt: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/^(FAILED|ERROR) \S+::/.test(lines[i].text)) {
      errorLines.push(i);
      if (excerpt.length < 3) {
        excerpt.push(lines[i].text.replace(/^(FAILED|ERROR) /, '').trim());
        excerptLines.push(i);
      }
    } else if (/^E\s{2,}/.test(lines[i].text)) errorLines.push(i);
  }
  const header = firstMatch(lines, /^_{3,} .+ _{3,}$/);
  const locFrom = header?.i ?? Math.max(0, sum.i - 100);
  return {
    kind: 'pytest',
    headline: ofTotal(failed, total),
    excerpt: excerpt.join('\n'),
    excerptLines,
    errorLines,
    locationLines: range(locFrom, sum.i + 1),
  };
}

function gotest(lines: LogLine[]): Detected | null {
  const fails: number[] = [];
  let passes = 0;
  for (let i = 0; i < lines.length; i++) {
    const t = lines[i].text;
    if (/^\s*--- FAIL: /.test(t)) fails.push(i);
    else if (/^\s*--- PASS: /.test(t)) passes++;
  }
  const build = firstMatch(lines, /^FAIL\s+\S+\s+\[(build|setup) failed\]/);
  if (!fails.length && !build) return null;
  if (!fails.length && build) {
    const errs = range(Math.max(0, build.i - 8), build.i).filter((i) => /\.go:\d+:\d+: /.test(lines[i].text));
    return {
      kind: 'go',
      headline: 'Go build failed',
      excerpt: errs.slice(0, 3).map((i) => lines[i].text.trim()).join('\n'),
      excerptLines: errs,
      errorLines: [...errs, build.i],
      locationLines: errs,
    };
  }
  const top = fails.filter((i) => !/^\s/.test(lines[i].text));
  const counted = top.length || fails.length;
  const first = fails[0];
  const excerpt = [lines[first].text.trim().replace(/^--- FAIL: /, '').replace(/ \([\d.]+s\)$/, '')];
  const excerptLines = [first];
  const errorLines = [...fails];
  // Assertion output is printed (indented) right before the --- FAIL line.
  for (let i = first - 1; i >= Math.max(0, first - 8); i--) {
    const t = lines[i].text;
    if (/^\s+\S+\.go:\d+: /.test(t)) {
      excerpt.splice(1, 0, t.trim());
      excerptLines.push(i);
      errorLines.push(i);
    } else if (/^(=== RUN|--- )/.test(t.trim())) break;
  }
  return {
    kind: 'go',
    headline: ofTotal(counted, passes ? passes + counted : null),
    excerpt: excerpt.slice(0, 4).join('\n'),
    excerptLines,
    errorLines,
    locationLines: range(Math.max(0, first - 10), Math.min(lines.length, first + 10)),
  };
}

function rspec(lines: LogLine[]): Detected | null {
  const sum = lastMatch(lines, /^(\d+) examples?, (\d+) failures?/);
  if (!sum || sum.m[2] === '0') return null;
  const failed = Number(sum.m[2]);
  const total = Number(sum.m[1]);
  const head = firstMatch(lines, /^Failures:\s*$/);
  const first = firstMatch(lines, /^\s+1\) (.+)/, head?.i ?? 0);
  const excerpt: string[] = [];
  const excerptLines: number[] = [];
  const errorLines = [sum.i];
  if (first) {
    excerpt.push(first.m[1].trim());
    excerptLines.push(first.i);
    errorLines.push(first.i);
    for (const i of block(lines, first.i + 1, 6, /^\s+(#|\d+\))/).slice(0, 3)) {
      excerpt.push(lines[i].text.trim());
      excerptLines.push(i);
      errorLines.push(i);
    }
  }
  for (let i = sum.i; i < lines.length; i++) if (/^rspec \.\//.test(lines[i].text)) errorLines.push(i);
  const from = first?.i ?? sum.i;
  return {
    kind: 'rspec',
    headline: ofTotal(failed, total, 'example'),
    excerpt: excerpt.join('\n'),
    excerptLines,
    errorLines,
    locationLines: range(from, Math.min(lines.length, from + 40)),
  };
}

function eslint(lines: LogLine[], rel: (p: string) => string): Detected | null {
  const sum = lastMatch(lines, /^✖ (\d+) problems? \((\d+) errors?, (\d+) warnings?\)/);
  if (!sum || sum.m[2] === '0') return null;
  const errors = Number(sum.m[2]);
  let file: string | null = null;
  const rows: { i: number; text: string; loc: string }[] = [];
  const errorLines = [sum.i];
  for (let i = Math.max(0, sum.i - 2000); i < sum.i; i++) {
    const t = lines[i].text;
    if (/^\S.*\.\w+$/.test(t) && !/\s/.test(t.trim())) file = rel(t.trim());
    const m = /^\s+(\d+):(\d+)\s+error\s+(.+?)\s{2,}(\S+)$/.exec(t);
    if (m && file) {
      errorLines.push(i);
      rows.push({ i, text: `${m[3]} (${m[4]})`, loc: `${file}:${m[1]}` });
    }
  }
  return {
    kind: 'eslint',
    headline: `ESLint found ${plural(errors, 'error')}`,
    excerpt: rows
      .slice(0, 3)
      .map((r) => `${r.loc}  ${r.text}`)
      .join('\n'),
    excerptLines: rows.slice(0, 3).map((r) => r.i),
    errorLines,
    locationLines: [],
    // ESLint's stylish format puts the path on its own line; synthesise locations below.
  };
}

function tsc(lines: LogLine[]): Detected | null {
  const errs: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (/(?:\(\d+,\d+\): |:\d+:\d+ - )error TS\d+:/.test(lines[i].text)) errs.push(i);
  }
  if (!errs.length) return null;
  const found = lastMatch(lines, /^Found (\d+) errors?/);
  const n = found ? Number(found.m[1]) : errs.length;
  return {
    kind: 'tsc',
    headline: `${plural(n, 'TypeScript error')}`,
    excerpt: errs
      .slice(0, 3)
      .map((i) => lines[i].text.trim())
      .join('\n'),
    excerptLines: errs.slice(0, 3),
    errorLines: found ? [...errs, found.i] : errs,
    locationLines: errs,
  };
}

/* ---------------------------------------------------------------------- */
/* Generic fallback                                                       */
/* ---------------------------------------------------------------------- */

const HOUSEKEEPING = /^(upload_artifacts|after_script|cleanup|archive_cache|save_cache|restore_cache)/;
const NOISE = /^(Uploading artifacts|Cleaning up|Running after_script|Saving cache|Creating cache|Not uploading cache|WARNING: |section_)/;

function generic(lines: LogLine[], sections: LogSection[], jobFailed: number | null): Detected | null {
  if (jobFailed === null) return null;
  // Walk back from the failure, skipping after-script / artifact housekeeping.
  const picked: number[] = [];
  for (let i = jobFailed - 1; i >= 0 && picked.length < 5; i--) {
    const sec = sections[lines[i].section];
    if (sec && HOUSEKEEPING.test(sec.key)) continue;
    const t = lines[i].text.trim();
    if (!t || NOISE.test(t)) continue;
    picked.unshift(i);
  }
  if (!picked.length) return null;
  // Lines that look like errors are the ones to highlight; else highlight all picked.
  const errorish = picked.filter((i) =>
    /error|fail|fatal|exception|denied|refused|not found|no such|cannot|could not|unable|invalid|problem/i.test(lines[i].text),
  );
  return {
    kind: 'generic',
    headline: '',
    excerpt: picked.map((i) => clip(lines[i].text.trim())).join('\n'),
    excerptLines: picked,
    errorLines: errorish.length ? errorish : picked.slice(-2),
    locationLines: picked,
  };
}

/* ---------------------------------------------------------------------- */
/* Entry                                                                  */
/* ---------------------------------------------------------------------- */

export function analyzeLog(log: ParsedLog, jobName?: string): Analysis {
  const { lines, sections } = log;
  const rel = makeRelativizer(lines);

  const failedAt = lastMatch(lines, /^ERROR: Job failed(?:: (?:exit code|command terminated with exit code) (\d+))?/);
  const exitCode = failedAt?.m[1] ? Number(failedAt.m[1]) : null;
  const image = firstMatch(lines, /Using (?:Docker|docker|Kubernetes|kubernetes) executor with image (\S+)/);
  const runnerName = firstMatch(lines, /^\s*on (\S+) /);

  const detected =
    phpunit(lines) ??
    jest(lines) ??
    vitest(lines) ??
    pytest(lines) ??
    rspec(lines) ??
    gotest(lines) ??
    eslint(lines, rel) ??
    tsc(lines) ??
    generic(lines, sections, failedAt?.i ?? null);

  const errorSet = new Set(detected?.errorLines ?? []);
  if (failedAt) errorSet.add(failedAt.i);
  const errorLines = [...errorSet].sort((a, b) => a - b);
  const anchors =
    detected && detected.kind !== 'generic' && detected.excerptLines.length
      ? detected.excerptLines
      : (detected?.errorLines ?? []);
  const firstError = anchors.length ? Math.min(...anchors) : failedAt ? failedAt.i : null;

  let locations: Location[] = [];
  if (detected?.kind === 'eslint') {
    // Re-read the stylish rows to pair them with their file headers.
    let file: string | null = null;
    for (let i = 0; i < lines.length && locations.length < 12; i++) {
      const t = lines[i].text;
      if (/^\S.*\.\w+$/.test(t) && !/\s/.test(t.trim())) file = rel(t.trim());
      const m = /^\s+(\d+):(\d+)\s+error\s/.exec(t);
      if (m && file) locations.push({ path: file, line: Number(m[1]), at: i });
    }
  } else if (detected) {
    locations = findLocations(lines, detected.locationLines, rel);
  }

  let headline = detected?.headline || null;
  if (!headline && failedAt) {
    const who = jobName ?? 'The job';
    headline = exitCode !== null ? `${who} exited with code ${exitCode}` : `${who} failed`;
  }

  const anchor = firstError ?? failedAt?.i ?? null;
  const failingSection = anchor !== null ? lines[anchor]?.section ?? null : null;

  return {
    kind: detected?.kind ?? null,
    headline,
    excerpt: detected?.excerpt ? detected.excerpt : null,
    locations,
    errorLines,
    firstError,
    failingSection: failingSection !== null && failingSection >= 0 ? failingSection : null,
    exitCode,
    image: image ? image.m[1].replace(/\s*\.\.\.$/, '') : null,
    runner: runnerName ? runnerName.m[1] : null,
  };
}

/** Does a log location refer to `changedPath` (tolerating absolute/relative prefixes)? */
export function samePath(location: string, changedPath: string): boolean {
  if (location === changedPath) return true;
  return location.endsWith(`/${changedPath}`) || changedPath.endsWith(`/${location}`);
}

/** Scan arbitrary line indices for file references (for inline cards). */
export function locationsIn(log: ParsedLog, indices: Iterable<number>, max = 40): Location[] {
  return findLocations(log.lines, indices, makeRelativizer(log.lines), max);
}
