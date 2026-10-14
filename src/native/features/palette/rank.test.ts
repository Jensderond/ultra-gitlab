import { describe, expect, it } from 'vitest';
import { parseDeepLink, parseGitLabUrl, rank, scoreFields, scoreToken } from './rank';

describe('scoreToken', () => {
  it('orders exact > prefix > word start > substring > fuzzy', () => {
    const exact = scoreToken('dark', 'dark');
    const prefix = scoreToken('dark', 'dark mode');
    const word = scoreToken('mode', 'dark mode');
    const sub = scoreToken('ode', 'dark mode');
    const fuzzy = scoreToken('dmt', 'dark mode toggle');
    expect(exact).toBeGreaterThan(prefix);
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(fuzzy);
    expect(fuzzy).toBeGreaterThan(0);
  });

  it('rejects scattered subsequences and missing characters', () => {
    expect(scoreToken('xyz', 'dark mode toggle')).toBe(0);
    expect(scoreToken('ade', 'a' + ' '.repeat(40) + 'de')).toBe(0);
    expect(scoreToken('go', 'add dark mode toggle')).toBe(0);
  });
});

describe('scoreFields / rank', () => {
  const mrs = [
    { title: 'fix: Resolve login redirect loop', iid: 43, project: 'frontend/web-app', author: 'bob' },
    { title: 'feat: Add dark mode toggle to settings', iid: 42, project: 'frontend/web-app', author: 'alice' },
    { title: 'refactor: Extract user service', iid: 44, project: 'backend/api-service', author: 'alice' },
  ];
  const fields = (m: (typeof mrs)[number]) => [
    { text: m.title },
    { text: `!${m.iid}` },
    { text: m.project, weight: 0.7 },
    { text: m.author, weight: 0.6 },
  ];

  it('requires every word to match some field', () => {
    expect(scoreFields('dark alice', fields(mrs[1]))).toBeGreaterThan(0);
    expect(scoreFields('dark bob', fields(mrs[1]))).toBe(0);
  });

  it('ranks the best match first and drops non-matches', () => {
    expect(rank(mrs, 'service', fields).map((m) => m.iid)).toEqual([44]);
    expect(rank(mrs, '!42', fields).map((m) => m.iid)[0]).toBe(42);
    expect(rank(mrs, 'alice', fields).map((m) => m.iid)).toEqual([42, 44]);
  });

  it('respects the limit and returns nothing for an empty query', () => {
    expect(rank(mrs, 'a', fields, 1)).toHaveLength(1);
    expect(rank(mrs, '   ', fields)).toEqual([]);
  });
});

describe('parseGitLabUrl', () => {
  it('recognises MR URLs and canonicalises them', () => {
    expect(parseGitLabUrl(' https://gitlab.com/grp/sub/proj/-/merge_requests/12/diffs?x=1#note_3 ')).toEqual({
      kind: 'mr',
      origin: 'https://gitlab.com',
      host: 'gitlab.com',
      projectPath: 'grp/sub/proj',
      iid: 12,
      webUrl: 'https://gitlab.com/grp/sub/proj/-/merge_requests/12',
    });
  });

  it('recognises pipeline URLs', () => {
    expect(parseGitLabUrl('https://git.x.nl:8443/a/b/-/pipelines/991')).toMatchObject({
      kind: 'pipeline',
      host: 'git.x.nl:8443',
      projectPath: 'a/b',
      pipelineId: 991,
    });
  });

  it('ignores other text', () => {
    expect(parseGitLabUrl('dark mode')).toBeNull();
    expect(parseGitLabUrl('https://gitlab.com/a/b/-/issues/3')).toBeNull();
    expect(parseGitLabUrl('https://gitlab.com/a/b/-/merge_requests/new')).toBeNull();
  });

  it('unwraps ultra-gitlab:// deep links', () => {
    const inner = encodeURIComponent('https://gitlab.com/a/b/-/merge_requests/7');
    expect(parseDeepLink(`ultra-gitlab://open?url=${inner}`)).toMatchObject({ kind: 'mr', iid: 7 });
    expect(parseDeepLink('https://gitlab.com/a/b/-/merge_requests/7')).toBeNull();
  });
});
