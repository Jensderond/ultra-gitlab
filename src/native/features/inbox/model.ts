/**
 * Inbox data model: which merge requests belong in which view, how the list
 * is grouped and sorted, and the per-row hints ("Waiting 6 days", "Large").
 * Shared by the inbox screen and the home sidebar (counts, clients, open MRs per person).
 */

import { useMemo, useSyncExternalStore } from 'react';
import type { MergeRequest } from '../../api/types';
import { useActiveInstance, useMyMRs, useReviewMRs, useSettings } from '../../data/hooks';
import { humanize, isDraftTitle, splitProject } from '../../lib/format';

export type ViewId = 'review' | 'returned' | 'mine' | 'ready' | 'approved' | 'snoozed';

export interface ViewDef {
  id: ViewId;
  label: string;
  /** Author-focused views: the preview shows merge actions. */
  mine: boolean;
  empty: { title: string; message: string };
}

export const VIEWS: ViewDef[] = [
  {
    id: 'review',
    label: 'Needs my review',
    mine: false,
    empty: {
      title: 'Nothing waiting for your review',
      message: 'Merge requests that need your eyes will show up here.',
    },
  },
  {
    id: 'returned',
    label: 'Returned to me',
    mine: true,
    empty: {
      title: 'Nothing returned to you',
      message: 'When a reviewer requests changes on one of your merge requests, it lands here.',
    },
  },
  {
    id: 'mine',
    label: 'My open MRs',
    mine: true,
    empty: {
      title: 'No open merge requests',
      message: 'Merge requests you author or are assigned to show up here.',
    },
  },
  {
    id: 'ready',
    label: 'Approved, ready to merge',
    mine: true,
    empty: {
      title: 'Nothing ready to merge',
      message: 'Your approved merge requests with a passing pipeline land here.',
    },
  },
  {
    id: 'approved',
    label: 'Approved by me',
    mine: false,
    empty: {
      title: 'Nothing approved yet',
      message: 'Open merge requests you have approved stay here until they merge.',
    },
  },
  {
    id: 'snoozed',
    label: 'Snoozed',
    mine: false,
    empty: {
      title: 'Nothing snoozed',
      message: 'Press S on a merge request to put it away until later.',
    },
  },
];

export const viewDef = (id: string): ViewDef => VIEWS.find((v) => v.id === id) ?? VIEWS[0];

/* ------------------------------------------------------------------------ */
/* Predicates                                                               */
/* ------------------------------------------------------------------------ */

export const isSnoozed = (mr: MergeRequest, nowMs = Date.now()) =>
  mr.snoozedUntil != null && mr.snoozedUntil * 1000 > nowMs;

export const isDraft = (mr: MergeRequest) => isDraftTitle(mr.title) || /^\s*(draft|wip):/i.test(mr.title);

export const isApproved = (mr: MergeRequest) =>
  mr.approvalStatus === 'approved' ||
  (mr.approvalsRequired != null && mr.approvalsRequired > 0 && (mr.approvalsCount ?? 0) >= mr.approvalsRequired);

export const approvalsLeft = (mr: MergeRequest) =>
  Math.max(0, (mr.approvalsRequired ?? 0) - (mr.approvalsCount ?? 0));

export const pipelineFailed = (mr: MergeRequest) => mr.headPipelineStatus === 'failed';

/** `https://host/group/sub/project/-/merge_requests/1` → `group/sub/project`. */
export function projectPath(mr: MergeRequest): string {
  try {
    const p = new URL(mr.webUrl).pathname.split('/-/')[0].replace(/^\/+|\/+$/g, '');
    if (p) return p;
  } catch {
    /* fall through */
  }
  return splitProject(mr.projectName).path;
}

/** Top-level groups that only bucket clients: the client is the group below. */
const CLIENT_CONTAINERS = new Set(['customers']);

/**
 * The "client" is the top-level group (`noordkaap/website` → `noordkaap`),
 * except under a client container, where it's the next level down
 * (`customers/eshuis/webshop` → `customers/eshuis`). Keys keep the container
 * so `customers/redkiwi` can't collide with a top-level `redkiwi` group.
 */
export function clientKey(mr: MergeRequest): string {
  const parts = projectPath(mr).split('/');
  return parts.length > 2 && CLIENT_CONTAINERS.has(parts[0].toLowerCase()) ? `${parts[0]}/${parts[1]}` : parts[0];
}

/**
 * GitLab's display name for each path level, once the backend has cached the
 * project and `projectName` is its `name_with_namespace`
 * (`Customers / Gemeente Utrecht / Website Utrecht.nl`). Null while
 * `projectName` is still the bare path.
 */
function namespaceNames(mr: MergeRequest): string[] | null {
  if (!mr.projectName.includes(' / ')) return null;
  const names = mr.projectName.split(' / ').map((n) => n.trim());
  return names.length === projectPath(mr).split('/').length ? names : null;
}

const slugLabel = (slug: string) => (/[A-Z\s.]/.test(slug) ? slug : humanize(slug));

/** `Gemeente Utrecht`, falling back to the humanized slug (`Gemeente utrecht`). */
export function clientName(mr: MergeRequest): string {
  const key = clientKey(mr);
  const depth = key.split('/').length;
  return namespaceNames(mr)?.[depth - 1] ?? slugLabel(key.slice(key.lastIndexOf('/') + 1));
}

/** The display name for a client key, taken from any MR under it. */
export function clientLabel(key: string, mrs: readonly MergeRequest[]): string {
  const mr = mrs.find((m) => clientKey(m) === key);
  return mr ? clientName(mr) : slugLabel(key.slice(key.lastIndexOf('/') + 1));
}

/** `Website Utrecht.nl`, falling back to the path slug (`website`). */
export function projectTitle(mr: MergeRequest): string {
  return namespaceNames(mr)?.pop() ?? projectPath(mr).split('/').pop()!;
}

export const host = (url: string | undefined) => {
  if (!url) return '';
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
};

/* ------------------------------------------------------------------------ */
/* Data                                                                     */
/* ------------------------------------------------------------------------ */

// A clock that ticks every minute so snoozes lapse and ages stay honest.
let minute = Math.floor(Date.now() / 60_000);
const clockListeners = new Set<() => void>();
if (typeof window !== 'undefined') {
  setInterval(() => {
    const m = Math.floor(Date.now() / 60_000);
    if (m !== minute) {
      minute = m;
      clockListeners.forEach((l) => l());
    }
  }, 5_000);
}
export function useMinute(): number {
  return useSyncExternalStore(
    (l) => {
      clockListeners.add(l);
      return () => clockListeners.delete(l);
    },
    () => minute,
  );
}

export interface InboxData {
  instanceId: number | undefined;
  instanceUrl: string | undefined;
  me: string | null;
  views: Record<ViewId, MergeRequest[]>;
  /** Recently merged MRs of mine (shown at the bottom of "My open MRs"). */
  merged: MergeRequest[];
  /** Every open MR we know of, deduplicated (for clients and open MRs per person). */
  open: MergeRequest[];
  loading: boolean;
  error: Error | undefined;
  refetch: () => Promise<void>;
}

export function useInboxData(): InboxData {
  const { instance } = useActiveInstance();
  const me = instance?.authenticatedUsername ?? null;
  const review = useReviewMRs(instance?.id);
  const mine = useMyMRs(instance?.id, true);
  // Settings › General decides whether recently merged MRs show under My open MRs.
  const showMerged = useSettings().data?.showRecentlyMergedMrs ?? true;
  const now = useMinute();

  const derived = useMemo(() => {
    const nowMs = now * 60_000 + 59_999;
    const reviewList = (review.data ?? []).filter((m) => m.state === 'opened' && m.authorUsername !== me);
    const mineAll = mine.data ?? [];
    const mineOpen = mineAll.filter((m) => m.state === 'opened');
    const merged = showMerged ? mineAll.filter((m) => m.state === 'merged') : [];
    const seen = new Set<number>();
    const open: MergeRequest[] = [];
    for (const m of [...reviewList, ...mineOpen]) {
      if (seen.has(m.id)) continue;
      seen.add(m.id);
      open.push(m);
    }
    const views: Record<ViewId, MergeRequest[]> = {
      review: reviewList.filter((m) => !m.userHasApproved && !isSnoozed(m, nowMs)),
      returned: mineOpen.filter((m) => m.approvalStatus === 'changes_requested' && !isSnoozed(m, nowMs)),
      mine: mineOpen,
      ready: mineOpen.filter((m) => isApproved(m) && !pipelineFailed(m) && !isDraft(m)),
      approved: reviewList.filter((m) => m.userHasApproved),
      // Deduplicated: an MR can be both assigned to me and waiting for my review.
      snoozed: open.filter((m) => isSnoozed(m, nowMs)),
    };
    return { views, merged, open };
  }, [review.data, mine.data, me, now, showMerged]);

  return {
    instanceId: instance?.id,
    instanceUrl: instance?.url,
    me,
    ...derived,
    loading: review.loading || mine.loading,
    error: review.error ?? mine.error,
    refetch: async () => {
      await Promise.all([review.refetch(), mine.refetch()]);
    },
  };
}

/* ------------------------------------------------------------------------ */
/* List preferences                                                         */
/* ------------------------------------------------------------------------ */

export type GroupBy = 'client' | 'project' | 'none';
export type SortBy = 'oldest' | 'newest' | 'updated';

export const GROUP_LABELS: Record<GroupBy, string> = { client: 'Client', project: 'Project', none: 'None' };
export const SORT_LABELS: Record<SortBy, string> = {
  oldest: 'Oldest waiting',
  newest: 'Newest',
  updated: 'Recently updated',
};

export interface ListPrefs {
  group: GroupBy;
  sort: SortBy;
  hideDrafts: boolean;
}

const PREFS_KEY = 'ug.inbox.prefs';
const DEFAULT_PREFS: ListPrefs = { group: 'project', sort: 'oldest', hideDrafts: false };
let prefs: ListPrefs = (() => {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
  } catch {
    return DEFAULT_PREFS;
  }
})();
const prefListeners = new Set<() => void>();

export function setListPrefs(patch: Partial<ListPrefs>) {
  prefs = { ...prefs, ...patch };
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* storage unavailable */
  }
  prefListeners.forEach((l) => l());
}

export function useListPrefs(): ListPrefs {
  return useSyncExternalStore(
    (l) => {
      prefListeners.add(l);
      return () => prefListeners.delete(l);
    },
    () => prefs,
  );
}

/* ------------------------------------------------------------------------ */
/* Collapsed groups                                                         */
/* ------------------------------------------------------------------------ */

const COLLAPSED_KEY = 'ug.inbox.collapsed';
let collapsed: ReadonlySet<string> = (() => {
  try {
    const ids: unknown = JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : []);
  } catch {
    return new Set<string>();
  }
})();
const collapsedListeners = new Set<() => void>();

/**
 * Collapse state survives switching Group, but a project and a client are
 * different groups even when their keys match, so the mode is part of the id.
 * "Merged recently" is the same group in every mode.
 */
export function collapseId(groupBy: GroupBy, g: MRGroup): string {
  return g.merged ? 'merged' : `${groupBy}:${g.key}`;
}

export function setCollapsed(ids: string[], value: boolean) {
  const next = new Set(collapsed);
  for (const id of ids) {
    if (value) next.add(id);
    else next.delete(id);
  }
  collapsed = next;
  try {
    localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
  } catch {
    /* storage unavailable */
  }
  collapsedListeners.forEach((l) => l());
}

export function useCollapsed(): ReadonlySet<string> {
  return useSyncExternalStore(
    (l) => {
      collapsedListeners.add(l);
      return () => collapsedListeners.delete(l);
    },
    () => collapsed,
  );
}

/* ------------------------------------------------------------------------ */
/* Filtering, sorting, grouping                                             */
/* ------------------------------------------------------------------------ */

export function matchesSearch(mr: MergeRequest, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const hay = [
    mr.title,
    mr.authorUsername,
    mr.projectName,
    projectPath(mr),
    mr.sourceBranch,
    `!${mr.iid}`,
    ...mr.labels,
    ...mr.reviewers,
  ]
    .join('\n')
    .toLowerCase();
  return query.split(/\s+/).every((word) => hay.includes(word));
}

const sorters: Record<SortBy, (a: MergeRequest, b: MergeRequest) => number> = {
  oldest: (a, b) => a.createdAt - b.createdAt,
  newest: (a, b) => b.createdAt - a.createdAt,
  updated: (a, b) => b.updatedAt - a.updatedAt,
};

export interface MRGroup {
  key: string;
  title: string;
  /** Right-aligned mono detail: project path, or "3 projects". */
  detail?: string;
  /** Show the project on each row (when a group spans projects). */
  showProject: boolean;
  items: MergeRequest[];
  merged?: boolean;
  /** Header clicked shut: rows are hidden and skipped by J/K. */
  collapsed?: boolean;
}

export function buildGroups(
  items: MergeRequest[],
  merged: MergeRequest[],
  { group, sort }: Pick<ListPrefs, 'group' | 'sort'>,
): MRGroup[] {
  const sorted = [...items].sort(sorters[sort]);
  const groups: MRGroup[] = [];
  if (group === 'none') {
    if (sorted.length) groups.push({ key: 'all', title: '', showProject: true, items: sorted });
  } else {
    const byKey = new Map<string, MRGroup>();
    for (const mr of sorted) {
      const key = group === 'client' ? clientKey(mr) : projectPath(mr);
      let g = byKey.get(key);
      if (!g) {
        // By project, the project leads and the client is context; by client,
        // the client leads and the path tells a single project apart.
        g =
          group === 'project'
            ? { key, title: projectTitle(mr), detail: clientName(mr), showProject: false, items: [] }
            : { key, title: clientName(mr), detail: projectPath(mr), showProject: false, items: [] };
        byKey.set(key, g);
        groups.push(g);
      }
      g.items.push(mr);
    }
    if (group === 'client') {
      for (const g of groups) {
        const projects = new Set(g.items.map(projectPath));
        if (projects.size > 1) {
          g.detail = `${projects.size} projects`;
          g.showProject = true;
        }
      }
    }
  }
  if (merged.length) {
    groups.push({
      key: 'merged',
      title: 'Merged recently',
      showProject: true,
      merged: true,
      items: [...merged].sort((a, b) => (b.mergedAt ?? 0) - (a.mergedAt ?? 0)),
    });
  }
  return groups;
}

/* ------------------------------------------------------------------------ */
/* Snooze                                                                   */
/* ------------------------------------------------------------------------ */

export interface SnoozePreset {
  label: string;
  until: (now: Date) => number;
}

const atNine = (d: Date) => {
  const x = new Date(d);
  x.setHours(9, 0, 0, 0);
  return Math.floor(x.getTime() / 1000);
};

export const SNOOZE_PRESETS: SnoozePreset[] = [
  { label: '1 Hour', until: (now) => Math.floor(now.getTime() / 1000) + 3600 },
  {
    label: 'Tomorrow 9:00',
    until: (now) => {
      const d = new Date(now);
      d.setDate(d.getDate() + 1);
      return atNine(d);
    },
  },
  {
    label: 'Next Monday 9:00',
    until: (now) => {
      const d = new Date(now);
      d.setDate(d.getDate() + (((8 - d.getDay()) % 7) || 7));
      return atNine(d);
    },
  },
];

export function formatSnooze(untilSeconds: number): string {
  const d = new Date(untilSeconds * 1000);
  const now = new Date();
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return time;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return `tomorrow ${time}`;
  return `${d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}
