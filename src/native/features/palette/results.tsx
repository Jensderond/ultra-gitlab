/**
 * Jump targets shared by the toolbar's search field and the ⌘K palette:
 * merge requests, pipeline projects and commands ranked against the typed
 * text, or a single "Open …" row when the text is a GitLab URL.
 */

import { useMemo, useState, type ReactNode, type RefObject } from 'react';
import { api } from '../../api/client';
import { formatKeys } from '../../app/keys';
import { navigate, paths } from '../../app/router';
import { setActiveInstanceId, useActiveInstance, useMyMRs, usePipelineProjects, useReviewMRs } from '../../data/hooks';
import { invalidate } from '../../data/query';
import type { MergeRequest, PipelineProject } from '../../api/types';
import { cx, Spinner, StatusIcon, toast } from '../../ui/components';
import { GearIcon, InboxIcon, KeyboardIcon, PersonIcon, PlusIcon, RefreshIcon } from '../../ui/icons';
import { openShortcuts } from '../shortcuts/ShortcutsSheet';
import { openGitLabLink } from './jump';
import { parseGitLabUrl, rank, tokenize, type Field, type GitLabLink } from './rank';
import './palette.css';

type Group = 'Open' | 'Merge requests' | 'Projects' | 'Commands';

export interface Item {
  key: string;
  group: Group;
  icon: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  shortcut?: string;
  run: () => unknown;
}

interface Command {
  id: string;
  label: string;
  keywords?: string;
  icon: ReactNode;
  shortcut?: string;
  run: () => unknown;
}

const ProjectGlyph = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M4 7.5L12 3l8 4.5v9L12 21l-8-4.5z" />
    <path d="M4 7.5l8 4.5 8-4.5M12 12v9" />
  </svg>
);

const PipelineGlyph = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="5" cy="12" r="2.5" />
    <circle cx="19" cy="12" r="2.5" />
    <circle cx="12" cy="12" r="2.5" />
    <path d="M7.5 12h2M14.5 12h2" />
  </svg>
);

const LinkGlyph = () => (
  <svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
    <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
  </svg>
);

/** Wrap literal matches of the query words in <mark>. */
function highlight(text: string, tokens: string[]): ReactNode {
  if (!tokens.length) return text;
  const lower = text.toLowerCase();
  const hits: [number, number][] = [];
  for (const t of tokens) {
    const i = lower.indexOf(t);
    if (i >= 0) hits.push([i, i + t.length]);
  }
  if (!hits.length) return text;
  hits.sort((a, b) => a[0] - b[0]);
  const out: ReactNode[] = [];
  let pos = 0;
  hits.forEach(([s, e], k) => {
    if (s < pos) return;
    out.push(text.slice(pos, s), <mark key={k} className="pal-hit">{text.slice(s, e)}</mark>);
    pos = e;
  });
  out.push(text.slice(pos));
  return out;
}

const mrFields = (m: MergeRequest): Field[] => [
  { text: m.title },
  { text: `!${m.iid}` },
  { text: String(m.iid), weight: 0.9 },
  { text: m.projectName, weight: 0.7 },
  { text: m.sourceBranch, weight: 0.6 },
  { text: m.authorUsername, weight: 0.6 },
];

const projectFields = (p: PipelineProject): Field[] => [
  { text: p.customName ?? p.name },
  { text: p.nameWithNamespace, weight: 0.8 },
  { text: p.pathWithNamespace, weight: 0.8 },
];

async function refresh() {
  try {
    await api.triggerSync(false);
  } catch (e) {
    toast(`Sync failed: ${(e as Error).message}`, { tone: 'error' });
  }
  await invalidate();
}

/**
 * The rows for `text`. Data is only subscribed while `live` (the popover or
 * palette is open); the inbox has it cached anyway.
 */
export function useJumpItems(text: string, live: boolean) {
  const [busy, setBusy] = useState(false);
  const link = useMemo(() => parseGitLabUrl(text), [text]);

  const { instance, instances } = useActiveInstance();
  const iid = live ? instance?.id : undefined;
  const review = useReviewMRs(iid).data;
  const mine = useMyMRs(iid).data;
  const projects = usePipelineProjects(iid).data;

  const commands = useMemo<Command[]>(() => {
    const list: Command[] = [
      { id: 'mrs', label: 'Go to Merge requests', keywords: 'inbox review', icon: <InboxIcon size={14} />, shortcut: 'mod+1', run: () => navigate(paths.inbox()) },
      { id: 'mine', label: 'Go to My merge requests', keywords: 'authored mine', icon: <PersonIcon size={14} />, run: () => navigate(paths.inbox('mine')) },
      { id: 'pipelines', label: 'Go to Pipelines', keywords: 'ci jobs', icon: <PipelineGlyph />, shortcut: 'mod+2', run: () => navigate(paths.pipelines()) },
      { id: 'refresh', label: 'Refresh', keywords: 'sync reload', icon: <RefreshIcon size={14} />, shortcut: 'mod+r', run: refresh },
      { id: 'settings', label: 'Settings…', keywords: 'preferences options', icon: <GearIcon size={14} />, shortcut: 'mod+,', run: () => navigate(paths.settings()) },
      { id: 'shortcuts', label: 'Keyboard Shortcuts', keywords: 'keys hotkeys help cheat sheet', icon: <KeyboardIcon size={14} />, shortcut: 'mod+?', run: openShortcuts },
      { id: 'add', label: 'Add GitLab instance…', keywords: 'account connect login token', icon: <PlusIcon size={14} />, run: () => navigate(paths.setup()) },
    ];
    for (const i of instances) {
      if (i.id === instance?.id) continue;
      const name = i.name || new URL(i.url).host;
      list.push({
        id: `instance-${i.id}`,
        label: `Switch to ${name}`,
        keywords: `instance account ${new URL(i.url).host}`,
        icon: <PersonIcon size={14} />,
        run: () => setActiveInstanceId(i.id),
      });
    }
    return list;
  }, [instances, instance?.id]);

  const items = useMemo<Item[]>(() => {
    if (link) {
      const what = link.kind === 'mr' ? `!${link.iid}` : `pipeline #${link.pipelineId}`;
      return [
        {
          key: 'link',
          group: 'Open',
          icon: <LinkGlyph />,
          label: (
            <>
              Open {what} <span className="pal-row__dim">in {link.projectPath}</span>
            </>
          ),
          detail: link.host,
          run: async () => {
            setBusy(true);
            const ok = await openGitLabLink(link);
            setBusy(false);
            return ok;
          },
        },
      ];
    }
    const q = text.trim();
    const tokens = tokenize(q);
    const out: Item[] = [];
    if (q) {
      const seen = new Set<number>();
      const mrs = [...(review ?? []), ...(mine ?? [])].filter((m) => !seen.has(m.id) && seen.add(m.id));
      for (const m of rank(mrs, q, mrFields, 6)) {
        out.push({
          key: `mr-${m.id}`,
          group: 'Merge requests',
          icon: <StatusIcon status={m.headPipelineStatus} size={14} />,
          label: highlight(m.title, tokens),
          detail: (
            <>
              <span className="pal-row__project">{m.projectName.split('/').pop()}</span>
              <span className="mono">!{m.iid}</span>
            </>
          ),
          run: () => navigate(paths.review(m.id)),
        });
      }
      for (const p of rank(projects ?? [], q, projectFields, 4)) {
        out.push({
          key: `project-${p.projectId}`,
          group: 'Projects',
          icon: <ProjectGlyph />,
          label: highlight(p.customName ?? p.name, tokens),
          detail: <span className="mono">{p.pathWithNamespace}</span>,
          run: () => navigate(paths.pipelines(p.projectId)),
        });
      }
    }
    const cmds = q
      ? rank(commands, q, (c) => [{ text: c.label }, { text: c.keywords, weight: 0.7 }], 4)
      : commands;
    for (const c of cmds) {
      out.push({
        key: `cmd-${c.id}`,
        group: 'Commands',
        icon: c.icon,
        label: q ? highlight(c.label, tokens) : c.label,
        shortcut: c.shortcut,
        run: c.run,
      });
    }
    return out;
  }, [link, text, review, mine, projects, commands]);

  return { items, link, busy };
}

/** ↑/↓ (or ⌃N/⌃P) from `current` through `count` rows; null for any other key. */
export function stepFor(e: React.KeyboardEvent, current: number, count: number): number | null {
  const ctrl = e.ctrlKey && !e.metaKey;
  const n = Math.max(count, 1);
  if (e.key === 'ArrowDown' || (ctrl && e.key === 'n')) return (current + 1) % n;
  if (e.key === 'ArrowUp' || (ctrl && e.key === 'p')) return (current - 1 + n) % n;
  return null;
}

export function JumpResults({
  items,
  current,
  busy,
  text,
  link,
  listRef,
  escLabel,
  filterHint = false,
  onHover,
  onRun,
}: {
  items: Item[];
  current: number;
  busy: boolean;
  text: string;
  link: GitLabLink | null;
  listRef: RefObject<HTMLDivElement | null>;
  escLabel: string;
  filterHint?: boolean;
  onHover: (index: number) => void;
  onRun: (item: Item) => void;
}) {
  const groups: { name: Group; items: { item: Item; index: number }[] }[] = [];
  items.forEach((item, index) => {
    const last = groups[groups.length - 1];
    if (last?.name === item.group) last.items.push({ item, index });
    else groups.push({ name: item.group, items: [{ item, index }] });
  });

  return (
    <>
      <div ref={listRef} id="pal-results" className="pal-list" role="listbox" aria-label="Search results">
        {groups.map((g) => (
          <div key={g.name} role="group" aria-label={g.name}>
            <div className="pal-group">{g.name}</div>
            {g.items.map(({ item, index }) => (
              <div
                key={item.key}
                id={`pal-${item.key}`}
                role="option"
                aria-selected={index === current}
                className={cx('pal-row', index === current && 'is-active')}
                onMouseMove={() => index !== current && onHover(index)}
                onClick={() => onRun(item)}
              >
                <span className="pal-row__icon">{busy && item.key === 'link' ? <Spinner size={13} /> : item.icon}</span>
                <span className="pal-row__label">{item.label}</span>
                {item.detail && <span className="pal-row__detail">{item.detail}</span>}
                {item.shortcut && <kbd className="pal-row__kbd">{formatKeys(item.shortcut)}</kbd>}
              </div>
            ))}
          </div>
        ))}
        {items.length === 0 && (
          <div className="pal-empty">No merge requests, projects or commands match “{text.trim()}”.</div>
        )}
      </div>
      <div className="pal-footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> choose
        </span>
        <span>
          <kbd>↩</kbd> open
        </span>
        {filterHint && text && !link && (
          <span>
            <kbd>⇥</kbd> filter list
          </span>
        )}
        <span>
          <kbd>esc</kbd> {escLabel}
        </span>
      </div>
    </>
  );
}
