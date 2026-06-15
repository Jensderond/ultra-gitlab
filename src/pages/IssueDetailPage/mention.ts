/**
 * Pure helpers for @mention autocomplete in the issue comment composer.
 * Kept free of React so the (fiddly) token detection can be unit-tested.
 */

import type { KnownUser } from '../../types';

export interface MentionToken {
  /** Index of the `@` in the text. */
  start: number;
  /** The text typed after the `@` (without it); may be empty. */
  query: string;
}

/** Characters allowed inside a username after the `@`. */
const MENTION_CHAR = /[A-Za-z0-9_.-]/;

/**
 * Inspect `text` around the cursor and return the active mention token when the
 * cursor sits inside an `@mention` currently being typed; otherwise `null`.
 *
 * The `@` must be at the start of the text or immediately preceded by
 * whitespace, so email-like `a@b` does NOT trigger a mention. Any whitespace
 * between the `@` and the cursor closes the token.
 */
export function detectMention(text: string, cursor: number): MentionToken | null {
  // Walk left from the cursor over mention-legal characters.
  let i = cursor - 1;
  while (i >= 0 && MENTION_CHAR.test(text[i])) {
    i--;
  }
  // The character we stopped on must be the `@`.
  if (i < 0 || text[i] !== '@') return null;
  // The `@` must start the text or follow whitespace.
  if (i > 0 && !/\s/.test(text[i - 1])) return null;
  return { start: i, query: text.slice(i + 1, cursor) };
}

/**
 * Filter and rank mention candidates for `query` (case-insensitive). Prefix
 * matches on username or display name rank above substring matches. An empty
 * query returns the first `limit` users.
 */
export function filterMentionUsers(
  users: KnownUser[],
  query: string,
  limit = 8,
): KnownUser[] {
  const q = query.toLowerCase();
  if (!q) return users.slice(0, limit);

  const prefix: KnownUser[] = [];
  const substring: KnownUser[] = [];
  for (const u of users) {
    const username = u.username.toLowerCase();
    const name = (u.name ?? '').toLowerCase();
    if (username.startsWith(q) || name.startsWith(q)) {
      prefix.push(u);
    } else if (username.includes(q) || name.includes(q)) {
      substring.push(u);
    }
  }
  return [...prefix, ...substring].slice(0, limit);
}

/**
 * Merge mention candidates from several sources into one deduped, sorted list.
 * Dedupes by username, keeping the first non-empty display name seen — so a
 * GitLab project member (which carries a real name like "Jens de Rond") fills
 * in the name for a username we had only seen bare in the local cache. This is
 * what lets typing `@jens` match the user whose username is `@derond`.
 */
export function mergeMentionUsers(
  ...sources: Array<{ username: string; name: string | null }>[]
): KnownUser[] {
  const byUsername = new Map<string, KnownUser>();
  for (const source of sources) {
    for (const u of source) {
      const existing = byUsername.get(u.username);
      if (!existing) {
        byUsername.set(u.username, { username: u.username, name: u.name ?? null });
      } else if (!existing.name && u.name) {
        existing.name = u.name;
      }
    }
  }
  return [...byUsername.values()].sort((a, b) =>
    a.username.localeCompare(b.username, undefined, { sensitivity: 'base' }),
  );
}

/**
 * Apply a chosen mention: replace the `@query` token with `@username ` and
 * report the new value plus where the cursor should land.
 */
export function applyMention(
  value: string,
  token: MentionToken,
  username: string,
): { value: string; cursor: number } {
  const before = value.slice(0, token.start);
  const after = value.slice(token.start + 1 + token.query.length);
  const insert = `@${username} `;
  return { value: before + insert + after, cursor: before.length + insert.length };
}
