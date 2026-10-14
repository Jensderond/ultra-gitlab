/**
 * Tiny fuzzy-ish ranking for the search field. No dependencies, no allocation
 * per character beyond lowercasing — fast enough to rank a few thousand rows
 * on every keystroke.
 *
 * Scores (higher is better, 0 = no match):
 *   exact 100 · prefix 80 · word-start substring 60 · substring 40
 *   · compact subsequence (e.g. "dmt" → "dark mode toggle") 1–25
 */

const isWordChar = (c: string | undefined) => !!c && /[a-z0-9]/i.test(c);

/** Score one lowercase token against one lowercase text. */
export function scoreToken(token: string, text: string): number {
  if (!token) return 1;
  if (!text) return 0;
  if (text === token) return 100;
  if (text.startsWith(token)) return 80;
  const idx = text.indexOf(token);
  if (idx > 0) {
    // Prefer a hit at a word start ("mode" in "dark mode") over mid-word ("ode").
    for (let i = idx; i >= 0; i = text.indexOf(token, i + 1)) {
      if (!isWordChar(text[i - 1])) return 60;
    }
    return 40;
  }
  // Two letters match nearly anything as a subsequence; require a substring.
  if (token.length < 3) return 0;
  return fuzzy(token, text);
}

/** Subsequence match rewarding word-start hits and penalising gaps. */
function fuzzy(token: string, text: string): number {
  let ti = 0;
  let score = 0;
  let last = -1;
  let first = -1;
  for (let i = 0; i < text.length && ti < token.length; i++) {
    if (text[i] !== token[ti]) continue;
    if (first < 0) first = i;
    const boundary = !isWordChar(text[i - 1]);
    score += boundary ? 3 : last === i - 1 ? 2 : 0.5;
    last = i;
    ti++;
  }
  if (ti < token.length) return 0;
  const span = last - first + 1;
  // Scattered matches across a long title aren't what anybody meant.
  if (span > token.length * 3 + 3) return 0;
  return Math.max(1, Math.min(25, Math.round(score * (token.length / span) * 3)));
}

export interface Field {
  text: string | null | undefined;
  /** Multiplier for this field (title 1, branch 0.6, …). */
  weight?: number;
}

/**
 * Score a multi-word query against several fields of one record. Every word
 * must match some field; the record's score is the sum of each word's best.
 */
export function scoreFields(query: string, fields: Field[]): number {
  const tokens = tokenize(query);
  if (tokens.length === 0) return 0;
  const texts = fields.map((f) => ({ text: (f.text ?? '').toLowerCase(), weight: f.weight ?? 1 }));
  let total = 0;
  for (const token of tokens) {
    let best = 0;
    for (const f of texts) {
      const s = scoreToken(token, f.text) * f.weight;
      if (s > best) best = s;
    }
    if (best <= 0) return 0;
    total += best;
  }
  return total;
}

export function tokenize(query: string): string[] {
  return query.toLowerCase().trim().split(/\s+/).filter(Boolean);
}

/** Rank records by `scoreFields`, best first, dropping non-matches. Stable for ties. */
export function rank<T>(items: readonly T[], query: string, fields: (item: T) => Field[], limit = Infinity): T[] {
  const scored: { item: T; score: number; i: number }[] = [];
  items.forEach((item, i) => {
    const score = scoreFields(query, fields(item));
    if (score > 0) scored.push({ item, score, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map((s) => s.item);
}

/* ------------------------------------------------------------------------ */
/* GitLab URLs                                                              */
/* ------------------------------------------------------------------------ */

export type GitLabLink =
  | { kind: 'mr'; origin: string; host: string; projectPath: string; iid: number; webUrl: string }
  | { kind: 'pipeline'; origin: string; host: string; projectPath: string; pipelineId: number; webUrl: string };

/**
 * Recognise a pasted GitLab merge request or pipeline URL. Tolerates trailing
 * tabs (`/diffs`), query strings and fragments. Returns the canonical web URL.
 */
export function parseGitLabUrl(input: string): GitLabLink | null {
  const raw = input.trim();
  if (!/^https?:\/\//i.test(raw) || /\s/.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const mr = /^\/(.+?)\/-\/merge_requests\/(\d+)(?:\/|$)/.exec(url.pathname);
  if (mr) {
    const projectPath = decodeURIComponent(mr[1]);
    const iid = Number(mr[2]);
    return {
      kind: 'mr',
      origin: url.origin,
      host: url.host,
      projectPath,
      iid,
      webUrl: `${url.origin}/${projectPath}/-/merge_requests/${iid}`,
    };
  }
  const pl = /^\/(.+?)\/-\/pipelines\/(\d+)(?:\/|$)/.exec(url.pathname);
  if (pl) {
    const projectPath = decodeURIComponent(pl[1]);
    const pipelineId = Number(pl[2]);
    return {
      kind: 'pipeline',
      origin: url.origin,
      host: url.host,
      projectPath,
      pipelineId,
      webUrl: `${url.origin}/${projectPath}/-/pipelines/${pipelineId}`,
    };
  }
  return null;
}

/** `ultra-gitlab://open?url=<encoded GitLab URL>` → the GitLab link inside. */
export function parseDeepLink(input: string): GitLabLink | null {
  try {
    const url = new URL(input);
    if (url.protocol !== 'ultra-gitlab:') return null;
    const inner = url.searchParams.get('url');
    return inner ? parseGitLabUrl(inner) : null;
  } catch {
    return null;
  }
}
