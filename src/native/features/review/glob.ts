/**
 * A small glob matcher with .gitattributes / .gitignore semantics:
 *
 *   *.lock            matches the file name at any depth
 *   web/dist/**       anchored to the repository root (contains a slash)
 *   dist/             a directory anywhere, and everything inside it
 *   **\/generated/*   `**` spans directories, `*` and `?` stay inside one
 *   [abc] [!abc]      character classes
 */

const cache = new Map<string, RegExp | null>();

export function globToRegExp(pattern: string): RegExp | null {
  const hit = cache.get(pattern);
  if (hit !== undefined) return hit;

  let p = pattern.trim();
  let result: RegExp | null = null;
  if (p && !p.startsWith('#') && !p.startsWith('!')) {
    let dirOnly = false;
    if (p.endsWith('/')) {
      dirOnly = true;
      p = p.replace(/\/+$/, '');
    }
    const anchored = p.includes('/');
    p = p.replace(/^\/+/, '');

    let re = '';
    for (let i = 0; i < p.length; i++) {
      const c = p[i];
      if (c === '*') {
        if (p[i + 1] === '*') {
          const atSegmentStart = i === 0 || p[i - 1] === '/';
          if (atSegmentStart && p[i + 2] === '/') {
            re += '(?:.*/)?';
            i += 2;
          } else {
            re += '.*';
            i += 1;
          }
        } else {
          re += '[^/]*';
        }
      } else if (c === '?') {
        re += '[^/]';
      } else if (c === '[') {
        const end = p.indexOf(']', i + 2);
        if (end > i) {
          let cls = p.slice(i + 1, end).replace(/\\/g, '\\\\');
          if (cls.startsWith('!')) cls = `^${cls.slice(1)}`;
          re += `[${cls}]`;
          i = end;
        } else {
          re += '\\[';
        }
      } else {
        re += c.replace(/[.+^${}()|\\\]]/g, '\\$&');
      }
    }
    const prefix = anchored ? '^' : '(?:^|/)';
    // A pattern naming a directory also covers everything inside it.
    const suffix = dirOnly ? '/' : '(?:$|/)';
    try {
      result = new RegExp(prefix + re + suffix);
    } catch {
      result = null;
    }
  }
  cache.set(pattern, result);
  return result;
}

/** Build a predicate from a list of glob patterns. */
export function globMatcher(patterns: string[]): (path: string) => boolean {
  const res = patterns.map(globToRegExp).filter((r): r is RegExp => r !== null);
  if (res.length === 0) return () => false;
  return (path) => {
    const p = path.replace(/^\/+/, '');
    return res.some((r) => r.test(p));
  };
}
