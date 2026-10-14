/**
 * Review state that lives on this Mac only: which files you've viewed, your
 * draft comments (until you finish the review) and the head SHA of your last
 * finished review. Consumed by the inbox preview too, so keep the original
 * contract exports (useViewedFiles, useGeneratedMatcher, useDraftCount)
 * stable.
 */

import { useCallback, useMemo } from 'react';
import { api } from '../../api/client';
import type { DiffFile } from '../../api/types';
import { useDiffFiles, useDiffRefs } from '../../data/hooks';
import { getData, useQuery } from '../../data/query';
import { globMatcher } from './glob';
import { readJSON, updateJSON, usePersisted, writeJSON } from './persist';

/* ------------------------------------------------------------------------ */
/* Viewed files                                                             */
/* ------------------------------------------------------------------------ */

interface ViewedEntry {
  /** MR head SHA when the file was marked viewed. */
  sha: string;
  /** change type + line stats, a cheap identity for the file's diff. */
  sig: string;
  /** Hash of the head content, when it was loaded at the time. */
  hash?: string;
}
type ViewedMap = Record<string, ViewedEntry>;

const viewedKey = (mrId: number) => `ug.review.viewed.${mrId}`;

export const fileSignature = (f: Pick<DiffFile, 'changeType' | 'additions' | 'deletions'>) =>
  `${f.changeType}:${f.additions}:${f.deletions}`;

/** Query key of a file's base/head contents (see content.ts). */
export const pairKey = (mrId: number, path: string, headSha: string) =>
  ['mr', mrId, 'pair', path, headSha] as const;

/** FNV-1a, enough to tell two versions of a file apart. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36) + text.length.toString(36);
}

function headContent(mrId: number, path: string, headSha: string): string | undefined {
  return getData<{ head: string }>(pairKey(mrId, path, headSha))?.head;
}

/**
 * Whether a stored "viewed" mark still applies: same head commit, or the
 * file's content (or, when that isn't loaded, its diff stats) is unchanged.
 * A file that changed after you viewed it becomes unviewed again.
 */
function stillViewed(mrId: number, entry: ViewedEntry, file: DiffFile, headSha: string | undefined) {
  if (!headSha || entry.sha === headSha) return true;
  if (entry.hash) {
    const content = headContent(mrId, file.newPath, headSha);
    if (content !== undefined) return hashText(content) === entry.hash;
  }
  return entry.sig === fileSignature(file);
}

/** Files the user has marked viewed for this MR (persisted locally). */
export function useViewedFiles(mrId: number | undefined): {
  viewed: Set<string>;
  toggle: (path: string) => void;
  setViewed: (path: string, viewed: boolean) => void;
} {
  const stored = usePersisted<ViewedMap>(mrId ? viewedKey(mrId) : null);
  const { data: files } = useDiffFiles(mrId);
  const { data: refs } = useDiffRefs(mrId);
  const headSha = refs?.headSha;

  const viewed = useMemo(() => {
    const set = new Set<string>();
    if (!stored || !mrId) return set;
    for (const [path, entry] of Object.entries(stored)) {
      if (!files) {
        set.add(path);
        continue;
      }
      const file = files.find((f) => f.newPath === path);
      if (file && stillViewed(mrId, entry, file, headSha)) set.add(path);
    }
    return set;
  }, [stored, files, headSha, mrId]);

  const setViewed = useCallback(
    (path: string, value: boolean) => {
      if (!mrId) return;
      updateJSON<ViewedMap>(viewedKey(mrId), (prev) => {
        const next = { ...(prev ?? {}) };
        if (!value) {
          delete next[path];
          return next;
        }
        const file = files?.find((f) => f.newPath === path);
        const content = headSha ? headContent(mrId, path, headSha) : undefined;
        next[path] = {
          sha: headSha ?? '',
          sig: file ? fileSignature(file) : '',
          ...(content !== undefined ? { hash: hashText(content) } : {}),
        };
        return next;
      });
    },
    [mrId, files, headSha],
  );

  const toggle = useCallback((path: string) => setViewed(path, !viewed.has(path)), [setViewed, viewed]);

  return { viewed, toggle, setViewed };
}

/* ------------------------------------------------------------------------ */
/* Generated files                                                          */
/* ------------------------------------------------------------------------ */

/** Always collapsed: lockfiles, minified bundles, build output, generated code. */
export const DEFAULT_GENERATED_PATTERNS = [
  'composer.lock',
  'package-lock.json',
  'npm-shrinkwrap.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'bun.lock',
  'bun.lockb',
  'Gemfile.lock',
  'Cargo.lock',
  'poetry.lock',
  'Pipfile.lock',
  'uv.lock',
  'go.sum',
  'Podfile.lock',
  'mix.lock',
  'flake.lock',
  'packages.lock.json',
  '*.min.js',
  '*.min.css',
  '*.js.map',
  '*.css.map',
  'dist/',
  'node_modules/',
  '__generated__/',
  '*.generated.*',
  '*.pb.go',
  '*_pb2.py',
];

/** Predicate for generated / vendored files (lockfiles, dist bundles…) for this MR's project. */
export function useGeneratedMatcher(
  instanceId: number | undefined,
  projectId: number | undefined,
): (path: string) => boolean {
  const { data: userPatterns } = useQuery(['settings', 'collapse-patterns'], api.collapsePatterns, {
    staleTime: 5 * 60_000,
  });
  const { data: attributes } = useQuery(
    instanceId && projectId ? ['gitattributes', instanceId, projectId] : null,
    () => api.gitattributes(instanceId!, projectId!),
    { staleTime: 10 * 60_000 },
  );
  return useMemo(
    () => globMatcher([...DEFAULT_GENERATED_PATTERNS, ...(userPatterns ?? []), ...(attributes ?? [])]),
    [userPatterns, attributes],
  );
}

/* ------------------------------------------------------------------------ */
/* Draft comments                                                           */
/* ------------------------------------------------------------------------ */

export type LineKind = 'add' | 'del' | 'context';

export interface Draft {
  id: string;
  body: string;
  createdAt: number;
  /** New inline comment: file + line on one side of the diff. */
  filePath?: string;
  side?: 'old' | 'new';
  line?: number;
  lineKind?: LineKind;
  /** First line of a multi-line comment (`line` is the last). */
  from?: { side: 'old' | 'new'; line: number };
  /** Reply to an existing discussion. */
  discussionId?: string;
  parentId?: number;
}

const EMPTY_DRAFTS: Draft[] = [];
const draftsKey = (mrId: number) => `ug.review.drafts.${mrId}`;

export function readDrafts(mrId: number): Draft[] {
  return readJSON<Draft[]>(draftsKey(mrId)) ?? EMPTY_DRAFTS;
}

export function useDrafts(mrId: number | undefined) {
  const drafts = usePersisted<Draft[]>(mrId ? draftsKey(mrId) : null) ?? EMPTY_DRAFTS;
  const key = mrId ? draftsKey(mrId) : null;

  const add = useCallback(
    (draft: Omit<Draft, 'id' | 'createdAt'>) => {
      if (!key) return;
      const full: Draft = {
        ...draft,
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: Math.floor(Date.now() / 1000),
      };
      updateJSON<Draft[]>(key, (prev) => [...(prev ?? []), full]);
    },
    [key],
  );
  const update = useCallback(
    (id: string, body: string) => {
      if (!key) return;
      updateJSON<Draft[]>(key, (prev) => (prev ?? []).map((d) => (d.id === id ? { ...d, body } : d)));
    },
    [key],
  );
  const remove = useCallback(
    (id: string) => {
      if (!key) return;
      updateJSON<Draft[]>(key, (prev) => {
        const next = (prev ?? []).filter((d) => d.id !== id);
        return next.length ? next : undefined;
      });
    },
    [key],
  );

  return { drafts, add, update, remove };
}

export function removeDrafts(mrId: number, ids: string[]) {
  updateJSON<Draft[]>(draftsKey(mrId), (prev) => {
    const next = (prev ?? []).filter((d) => !ids.includes(d.id));
    return next.length ? next : undefined;
  });
}

/** Number of draft (not yet published) review comments for this MR. */
export function useDraftCount(mrId: number | undefined): number {
  return useDrafts(mrId).drafts.length;
}

/* ------------------------------------------------------------------------ */
/* Last finished review                                                     */
/* ------------------------------------------------------------------------ */

export interface LastReview {
  sha: string;
  at: number;
}

const lastReviewKey = (mrId: number) => `ug.review.last.${mrId}`;

/** The head SHA you last finished a review at (for "Since my last review"). */
export function useLastReview(mrId: number | undefined): LastReview | undefined {
  return usePersisted<LastReview>(mrId ? lastReviewKey(mrId) : null);
}

export function recordReview(mrId: number, sha: string) {
  writeJSON<LastReview>(lastReviewKey(mrId), { sha, at: Math.floor(Date.now() / 1000) });
}
