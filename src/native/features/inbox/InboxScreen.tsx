/**
 * The review inbox: grouped merge request list + preview pane, inside the
 * home window. Selection lives in the URL (`?mr=ID`), the client filter in
 * `?client=`; list preferences persist in localStorage.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import type { MergeRequest } from '../../api/types';
import { HomeLayout } from '../../app/home/HomeLayout';
import { useKeys } from '../../app/keys';
import { setSearchParams, useRoute } from '../../app/router';
import { useMR } from '../../data/hooks';
import { plural } from '../../lib/format';
import { Pane } from '../../ui/layout';
import { setListFilter, useListFilter } from '../palette/SearchJump';
import {
  copyLink,
  openInGitLab,
  popupMenu,
  registerListKeys,
  snoozeEntries,
  startReview,
} from './actions';
import {
  buildGroups,
  clientKey,
  collapseId,
  clientLabel,
  host,
  isDraft,
  matchesSearch,
  setListPrefs,
  useCollapsed,
  useInboxData,
  useListPrefs,
  viewDef,
} from './model';
import { MRList } from './MRList';
import { Preview } from './Preview';
import './list.css';

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
};

export function InboxScreen({ view, selectedMrId }: { view: string; selectedMrId?: number }) {
  const def = viewDef(view);
  const data = useInboxData();
  const prefs = useListPrefs();
  const search = useListFilter();
  const client = useRoute().query.get('client');

  useEffect(() => registerListKeys(data.instanceId), [data.instanceId]);

  const base = data.views[def.id];
  const keep = useCallback(
    (mr: MergeRequest) => (!client || clientKey(mr) === client) && matchesSearch(mr, search),
    [client, search],
  );
  const items = useMemo(
    () => base.filter((mr) => keep(mr) && !(prefs.hideDrafts && isDraft(mr))),
    [base, keep, prefs.hideDrafts],
  );
  const merged = useMemo(() => (def.id === 'mine' ? data.merged.filter(keep) : []), [def.id, data.merged, keep]);
  const collapsed = useCollapsed();
  const groups = useMemo(
    () =>
      buildGroups(items, merged, prefs).map((g) =>
        g.title && collapsed.has(collapseId(prefs.group, g)) ? { ...g, collapsed: true } : g,
      ),
    [items, merged, prefs, collapsed],
  );
  // Rows the user can see and step through; collapsed groups are skipped.
  const flat = useMemo(() => groups.flatMap((g) => (g.collapsed ? [] : g.items)), [groups]);

  /* Selection ------------------------------------------------------------ */

  const select = useCallback((id: number | null) => setSearchParams({ mr: id }), []);
  const cleared = useRef(false);
  const previousIds = useRef<number[]>([]);
  useEffect(() => {
    cleared.current = false;
  }, [def.id]);

  useEffect(() => {
    const ids = flat.map((m) => m.id);
    const prev = previousIds.current;
    previousIds.current = ids;
    if (data.loading) return;
    if (selectedMrId === undefined) {
      if (!cleared.current && ids.length) select(ids[0]);
      return;
    }
    if (!ids.includes(selectedMrId)) {
      // The selected MR left the list (approved, snoozed, filtered out):
      // move to its neighbour, like Mail does after archiving.
      const at = prev.indexOf(selectedMrId);
      if (at >= 0) select(ids[Math.min(at, ids.length - 1)] ?? null);
    }
  }, [flat, selectedMrId, data.loading, select]);

  const known =
    flat.find((m) => m.id === selectedMrId) ??
    data.open.find((m) => m.id === selectedMrId) ??
    data.merged.find((m) => m.id === selectedMrId);
  const fallback = useMR(known ? undefined : selectedMrId);
  // useQuery keeps the previous key's data while loading: only trust it for this id.
  const selected = known ?? (fallback.data?.id === selectedMrId ? fallback.data : undefined);

  const canApprove = useCallback(
    (mr: MergeRequest) => mr.state === 'opened' && mr.authorUsername !== data.me,
    [data.me],
  );

  /* Keyboard ------------------------------------------------------------- */

  const move = (delta: number) => {
    if (!flat.length) return;
    const at = flat.findIndex((m) => m.id === selectedMrId);
    const next = at < 0 ? (delta > 0 ? 0 : flat.length - 1) : Math.max(0, Math.min(flat.length - 1, at + delta));
    cleared.current = false;
    select(flat[next].id);
  };

  useKeys({
    j: () => move(1),
    k: () => move(-1),
    arrowdown: () => move(1),
    arrowup: () => move(-1),
    home: () => void (flat.length > 0 && select(flat[0].id)),
    end: () => void (flat.length > 0 && select(flat[flat.length - 1].id)),
    enter: (e) => {
      // A button focused from the keyboard handles Return itself; one that
      // merely kept focus after a click (Mac buttons don't take focus) doesn't.
      const el = e.target as HTMLElement | null;
      if (el?.closest?.('button, a, [role="button"]') && el.matches(':focus-visible')) return false;
      if (selected) startReview(selected);
    },
    o: () => void (selected && openInGitLab(selected)),
    'mod+c': (e) => {
      // Let ⌘C copy selected text normally; only copy the link otherwise.
      // (A text field's selection isn't in window.getSelection(), so check focus too.)
      if (!selected || isTyping(e.target) || (window.getSelection()?.toString() ?? '') !== '') return false;
      copyLink(selected);
    },
    s: () => {
      if (!selected || selected.state !== 'opened') return;
      void popupMenu(document.getElementById(`inbox-row-${selected.id}`), snoozeEntries(selected));
    },
    escape: (e) => {
      if (isTyping(e.target)) return false;
      if (selectedMrId === undefined) return false;
      cleared.current = true;
      select(null);
    },
  });

  /* Toolbar -------------------------------------------------------------- */

  const total = base.length + (def.id === 'mine' ? data.merged.length : 0);
  const shown = groups.reduce((n, g) => n + g.items.length, 0);
  const filtered = !!client || !!search.trim() || prefs.hideDrafts;
  const subtitle = [
    shown === total ? plural(total, 'merge request') : `${shown} of ${plural(total, 'merge request')}`,
    host(data.instanceUrl),
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <HomeLayout
      section="mrs"
      title={client ? `${def.label} · ${clientLabel(client, data.open)}` : def.label}
      subtitle={data.loading && !total ? host(data.instanceUrl) : subtitle}
    >
      <div className="inbox">
        <Pane id="inbox-list" defaultWidth={400} min={300} max={640} className="inbox-list-pane" label="Merge requests">
          <MRList
            groups={groups}
            view={def.id}
            me={data.me}
            selectedId={selectedMrId}
            onSelect={(id) => {
              cleared.current = false;
              select(id);
            }}
            onOpen={startReview}
            loading={data.loading}
            error={data.error}
            onRetry={() => void data.refetch()}
            empty={def.empty}
            filtered={filtered && total > 0}
            onClearFilters={() => {
              setListFilter('');
              setListPrefs({ hideDrafts: false });
              setSearchParams({ client: null });
            }}
            client={client}
            clientLabel={client ? clientLabel(client, data.open) : null}
            onClearClient={() => setSearchParams({ client: null })}
            canApprove={canApprove}
          />
        </Pane>
        <Preview
          mr={selected}
          mineMode={def.mine}
          me={data.me}
          loading={!!selectedMrId && !selected && (data.loading || !fallback.error)}
          error={!selected ? fallback.error : undefined}
        />
      </div>
    </HomeLayout>
  );
}
