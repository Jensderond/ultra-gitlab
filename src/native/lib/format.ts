/** Formatting helpers shared across screens. */

/** Accepts unix seconds, unix ms, or an ISO string. */
export function toDate(value: number | string | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string') {
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(value < 1e12 ? value * 1000 : value);
}

/** Compact age: `35m`, `2h`, `1d`, `6d`, `3w`, `Jan 4`. */
export function age(value: number | string | null | undefined, now = Date.now()): string {
  const d = toDate(value);
  if (!d) return '';
  const s = Math.max(0, Math.round((now - d.getTime()) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 14) return `${Math.floor(s / 86400)}d`;
  if (s < 86400 * 60) return `${Math.floor(s / (86400 * 7))}w`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Sentence-style relative time: `2 hours ago`, `yesterday`, `just now`. */
export function ago(value: number | string | null | undefined, now = Date.now()): string {
  const d = toDate(value);
  if (!d) return '';
  const s = Math.round((d.getTime() - now) / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const abs = Math.abs(s);
  if (abs < 45) return 'just now';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
  if (abs < 86400 * 365) return rtf.format(Math.round(s / (86400 * 30)), 'month');
  return rtf.format(Math.round(s / (86400 * 365)), 'year');
}

/** Durations as in the design: `38s`, `1m 04s`, `2h 05m`. */
export function duration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '';
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`;
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;
}

/** `+1.2k`-style counts for diff stats. */
export function compact(n: number): string {
  if (n < 1000) return String(n);
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`;
}

export const shortSha = (sha: string | null | undefined) => (sha ?? '').slice(0, 7);

/** `noordkaap/website` → { group: 'noordkaap', name: 'website' }. Handles `Group / Project`. */
export function splitProject(projectName: string): { group: string; name: string; path: string } {
  const parts = projectName.split('/').map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return { group: parts[0] ?? projectName, name: parts[0] ?? projectName, path: projectName };
  return { group: parts[0], name: parts[parts.length - 1], path: parts.join('/') };
}

/** Title-case a slug for display: `noordkaap` → `Noordkaap`, `internal-tools` → `Internal tools`. */
export function humanize(slug: string): string {
  const s = slug.replace(/[-_]+/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const isDraftTitle = (title: string) => /^\s*(\[?draft\]?:?|\(draft\)|wip:?)\s/i.test(title);

export const stripDraft = (title: string) =>
  title.replace(/^\s*(\[?draft\]?:?|\(draft\)|wip:?)\s*/i, '');

export function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Split a file path for display: `src/services/A.php` → { dir: 'src/services', name: 'A.php' }. */
export function splitPath(path: string): { dir: string; name: string } {
  const i = path.lastIndexOf('/');
  return i < 0 ? { dir: '', name: path } : { dir: path.slice(0, i), name: path.slice(i + 1) };
}
