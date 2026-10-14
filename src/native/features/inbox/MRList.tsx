/**
 * The middle pane: filter bar (Group / Sort popup buttons, Hide drafts) and
 * the grouped merge request list.
 */

import { memo, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import type { MergeRequest } from '../../api/types';
import { useDiffFiles } from '../../data/hooks';
import { age, compact, plural, stripDraft, toDate } from '../../lib/format';
import { Button, cx, EmptyState, Spinner, StatusIcon, Tag, type Tone } from '../../ui/components';
import { ChevronDown, InboxIcon, WarningIcon, XIcon } from '../../ui/icons';
import { isTauri } from '../../api/client';
import { popupMenu, rowMenu } from './actions';
import {
  approvalsLeft,
  formatSnooze,
  GROUP_LABELS,
  isApproved,
  isDraft,
  pipelineFailed,
  projectPath,
  setListPrefs,
  SORT_LABELS,
  useListPrefs,
  type GroupBy,
  type MRGroup,
  type SortBy,
  type ViewId,
} from './model';
import './list.css';

/* ------------------------------------------------------------------------ */
/* Filter bar                                                               */
/* ------------------------------------------------------------------------ */

function cycle<T extends string>(options: T[], value: T): T {
  return options[(options.indexOf(value) + 1) % options.length];
}

function FilterBar({
  client,
  clientLabel,
  onClearClient,
}: {
  client: string | null;
  clientLabel: string | null;
  onClearClient: () => void;
}) {
  const prefs = useListPrefs();

  const groupMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const options = Object.keys(GROUP_LABELS) as GroupBy[];
    if (!isTauri) return setListPrefs({ group: cycle(options, prefs.group) });
    void popupMenu(
      e.currentTarget,
      options.map((g) => ({ label: GROUP_LABELS[g], checked: prefs.group === g, action: () => setListPrefs({ group: g }) })),
    );
  };
  const sortMenu = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const options = Object.keys(SORT_LABELS) as SortBy[];
    if (!isTauri) return setListPrefs({ sort: cycle(options, prefs.sort) });
    void popupMenu(
      e.currentTarget,
      options.map((s) => ({ label: SORT_LABELS[s], checked: prefs.sort === s, action: () => setListPrefs({ sort: s }) })),
    );
  };

  return (
    <div className="inbox-filters">
      <button type="button" className="inbox-popup" onClick={groupMenu} aria-haspopup="menu">
        Group: {GROUP_LABELS[prefs.group]}
        <ChevronDown size={10} />
      </button>
      <button type="button" className="inbox-popup" onClick={sortMenu} aria-haspopup="menu">
        Sort: {SORT_LABELS[prefs.sort]}
        <ChevronDown size={10} />
      </button>
      <button
        type="button"
        className={cx('inbox-popup', prefs.hideDrafts && 'is-on')}
        aria-pressed={prefs.hideDrafts}
        onClick={() => setListPrefs({ hideDrafts: !prefs.hideDrafts })}
      >
        Hide drafts
      </button>
      {client && (
        <button type="button" className="inbox-popup is-on inbox-client-chip" onClick={onClearClient} title="Show all clients">
          {clientLabel}
          <XIcon size={10} />
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Rows                                                                     */
/* ------------------------------------------------------------------------ */

interface RowTag {
  label: string;
  tone: Tone;
}

function rowTags(
  mr: MergeRequest,
  me: string | null,
  view: ViewId,
  stats: { lines: number; files: number } | null,
): RowTag[] {
  if (mr.state === 'merged') return [{ label: 'Merged', tone: 'ok' }];
  const tags: RowTag[] = [];
  const mine = mr.authorUsername === me;
  const draft = isDraft(mr);
  if (draft) tags.push({ label: 'Draft', tone: 'neutral' });
  if (!mine && me && mr.reviewers.includes(me)) tags.push({ label: 'Assigned to you', tone: 'accent' });
  if (view === 'snoozed' && mr.snoozedUntil) {
    tags.push({ label: `Until ${formatSnooze(mr.snoozedUntil)}`, tone: 'neutral' });
  }
  if (!mine && mr.userHasApproved) tags.push({ label: 'Approved by you', tone: 'ok' });
  if (pipelineFailed(mr)) tags.push({ label: 'Pipeline failed', tone: 'warn' });
  const changes = mr.approvalStatus === 'changes_requested';
  if (mine && changes) tags.push({ label: 'Changes requested', tone: 'warn' });
  else if (mine && isApproved(mr)) tags.push({ label: 'Approved', tone: 'ok' });
  const left = approvalsLeft(mr);
  if (left > 0 && !changes) tags.push({ label: `${plural(left, 'approval')} left`, tone: 'neutral' });
  const created = toDate(mr.createdAt);
  const days = created ? Math.floor((Date.now() - created.getTime()) / 86_400_000) : 0;
  if (days > 3 && !draft) tags.push({ label: `Waiting ${days} days`, tone: 'warn' });
  if (stats) {
    if (stats.lines > 500 || stats.files > 30) tags.push({ label: 'Large', tone: 'neutral' });
    else if (stats.lines < 30) tags.push({ label: 'Quick review', tone: 'neutral' });
  }
  return tags;
}

const Row = memo(function Row({
  mr,
  me,
  view,
  selected,
  showProject,
  onSelect,
  onOpen,
  canApprove,
}: {
  mr: MergeRequest;
  me: string | null;
  view: ViewId;
  selected: boolean;
  showProject: boolean;
  onSelect: (id: number) => void;
  onOpen: (mr: MergeRequest) => void;
  canApprove: boolean;
}) {
  const { data: files } = useDiffFiles(mr.id);
  const stats =
    files && files.length
      ? {
          adds: files.reduce((n, f) => n + f.additions, 0),
          dels: files.reduce((n, f) => n + f.deletions, 0),
          files: files.length,
        }
      : null;
  const tags = rowTags(mr, me, view, stats && { lines: stats.adds + stats.dels, files: stats.files });
  const status = mr.state === 'merged' ? 'success' : mr.headPipelineStatus;
  const when = mr.state === 'merged' && mr.mergedAt ? mr.mergedAt : mr.createdAt;
  const whenDate = toDate(when);

  return (
    <div
      id={`inbox-row-${mr.id}`}
      role="option"
      aria-selected={selected}
      className={cx('inbox-row', selected && 'is-selected', mr.state === 'merged' && 'is-merged')}
      onMouseDown={(e) => e.button === 0 && onSelect(mr.id)}
      onDoubleClick={() => onOpen(mr)}
      onContextMenu={(e) => {
        onSelect(mr.id);
        void popupMenu(e, rowMenu(mr, { canApprove }));
      }}
    >
      <span className="inbox-row__status">
        <StatusIcon status={status} />
      </span>
      <div className="inbox-row__body">
        <div className="inbox-row__head">
          <span className="inbox-row__title">{stripDraft(mr.title)}</span>
          <span
            className="inbox-row__age tabular"
            title={whenDate ? `${mr.state === 'merged' ? 'Merged' : 'Opened'} ${whenDate.toLocaleString()}` : undefined}
          >
            {age(when)}
          </span>
        </div>
        <div className="inbox-row__meta">
          <span className="mono">!{mr.iid}</span>
          {showProject && <span className="mono inbox-row__project">{projectPath(mr).split('/').pop()}</span>}
          {mr.authorUsername !== me && <span className="inbox-row__author">{mr.authorUsername}</span>}
          {stats && (
            <>
              <span className="mono tabular">
                <span className="inbox-add">+{compact(stats.adds)}</span>{' '}
                <span className="inbox-del">−{compact(stats.dels)}</span>
              </span>
              <span className="tabular">{plural(stats.files, 'file')}</span>
            </>
          )}
        </div>
        {tags.length > 0 && (
          <div className="inbox-row__tags">
            {tags.map((t) => (
              <Tag key={t.label} tone={t.tone}>
                {t.label}
              </Tag>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});

/* ------------------------------------------------------------------------ */
/* List                                                                     */
/* ------------------------------------------------------------------------ */

export function MRList({
  groups,
  view,
  me,
  selectedId,
  onSelect,
  onOpen,
  loading,
  error,
  onRetry,
  empty,
  filtered,
  onClearFilters,
  client,
  clientLabel,
  onClearClient,
  canApprove,
}: {
  groups: MRGroup[];
  view: ViewId;
  me: string | null;
  selectedId: number | undefined;
  onSelect: (id: number) => void;
  onOpen: (mr: MergeRequest) => void;
  loading: boolean;
  error: Error | undefined;
  onRetry: () => void;
  empty: { title: string; message: string };
  filtered: boolean;
  onClearFilters: () => void;
  client: string | null;
  clientLabel: string | null;
  onClearClient: () => void;
  canApprove: (mr: MergeRequest) => boolean;
}) {
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the selected row in view as the selection moves (J/K, arrows).
  useEffect(() => {
    if (!selectedId) return;
    document.getElementById(`inbox-row-${selectedId}`)?.scrollIntoView({ block: 'nearest' });
  }, [selectedId]);

  const count = groups.reduce((n, g) => n + g.items.length, 0);

  let content;
  if (count > 0) {
    content = groups.map((g) => (
      <div key={g.key} role="group" aria-label={g.title || 'Merge requests'} className="inbox-group">
        {(g.title || g.detail) && (
          // Keyed on its text: WKWebView doesn't always repaint a stuck sticky
          // header whose text changes in place, so a search that narrows the
          // group kept showing the previous project path. Remounting repaints.
          <div key={`${g.title}|${g.detail ?? ''}`} className={cx('inbox-group__head', g.merged && 'is-merged')}>
            <span className="inbox-group__title">{g.title}</span>
            {g.detail && <span className="inbox-group__detail mono">{g.detail}</span>}
          </div>
        )}
        {g.items.map((mr) => (
          <Row
            key={mr.id}
            mr={mr}
            me={me}
            view={view}
            selected={mr.id === selectedId}
            showProject={g.showProject}
            onSelect={onSelect}
            onOpen={onOpen}
            canApprove={canApprove(mr)}
          />
        ))}
      </div>
    ));
  } else if (error) {
    content = (
      <EmptyState
        icon={<WarningIcon size={28} />}
        title="Couldn't load merge requests"
        message={error.message}
        action={<Button onClick={onRetry}>Try again</Button>}
      />
    );
  } else if (loading) {
    content = (
      <div className="inbox-loading">
        <Spinner /> Loading merge requests…
      </div>
    );
  } else if (filtered) {
    content = (
      <EmptyState
        title="No matches"
        message="No merge requests in this view match your filters."
        action={<Button onClick={onClearFilters}>Clear filters</Button>}
      />
    );
  } else {
    content = <EmptyState icon={<InboxIcon size={30} />} title={empty.title} message={empty.message} />;
  }

  return (
    <>
      <FilterBar client={client} clientLabel={clientLabel} onClearClient={onClearClient} />
      <div
        ref={scroller}
        className="inbox-list"
        role="listbox"
        aria-label="Merge requests"
        aria-activedescendant={selectedId ? `inbox-row-${selectedId}` : undefined}
        tabIndex={0}
      >
        {content}
      </div>
    </>
  );
}
