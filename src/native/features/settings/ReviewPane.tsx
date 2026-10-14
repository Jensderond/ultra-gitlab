/** Settings → Review: diff layout, collapsed-file patterns, extra MRs to sync. */

import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../../api/client';
import { useActiveInstance } from '../../data/hooks';
import { invalidate, setData, useQuery } from '../../data/query';
import type { CustomMrFilter } from '../../api/types';
import { Button, Segmented, Spinner, Switch, toast } from '../../ui/components';
import { XIcon } from '../../ui/icons';
import { Group, Row, Select, TextField } from './form';
import { useDiffViewMode } from './prefs';
import { hostOf } from './TokenSheet';

/** Mirrors `default_collapse_patterns()` in src-tauri/src/commands/settings.rs. */
const DEFAULT_PATTERNS = [
  '*.lock',
  '*-lock.json',
  '*.min.js',
  '*.min.css',
  '*.map',
  '*.generated.*',
  'package-lock.json',
  'bun.lockb',
  'yarn.lock',
  'pnpm-lock.yaml',
  'Cargo.lock',
];

export function ReviewPane() {
  const [mode, setMode] = useDiffViewMode();
  return (
    <>
      <Group title="Diffs">
        <Row label="Default layout" description="You can switch per review with the toolbar.">
          <Segmented
            label="Default diff layout"
            size="sm"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'unified', label: 'Unified' },
              { value: 'split', label: 'Side by side' },
            ]}
          />
        </Row>
      </Group>
      <CollapsePatterns />
      <CustomFilter />
    </>
  );
}

/* ------------------------------------------------------------------------ */

function CollapsePatterns() {
  const { data: patterns } = useQuery(['settings', 'collapse-patterns'], api.collapsePatterns, { staleTime: 60_000 });
  const [draft, setDraft] = useState('');

  const save = async (next: string[]) => {
    setData(['settings', 'collapse-patterns'], next);
    try {
      await api.updateCollapsePatterns(next);
    } catch (e) {
      toast(`Couldn't save patterns: ${(e as Error).message}`, { tone: 'error' });
    }
    void invalidate(['settings']);
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    const p = draft.trim();
    if (!p || !patterns) return;
    if (!patterns.includes(p)) void save([...patterns, p]);
    setDraft('');
  };

  const isDefault =
    !!patterns && patterns.length === DEFAULT_PATTERNS.length && patterns.every((p, i) => p === DEFAULT_PATTERNS[i]);

  return (
    <Group
      title="Collapsed files"
      footer={
        <>
          Files matching these patterns start collapsed in a review, so lockfiles and generated code stay out of the
          way. Projects can add more with <code>linguist-generated</code> in <code>.gitattributes</code>.
        </>
      }
    >
      {!patterns ? (
        <div className="st-loading st-loading--row">
          <Spinner />
        </div>
      ) : (
        <>
          <div className="st-patterns" role="list" aria-label="Collapse patterns">
            {patterns.length === 0 && <span className="st-muted st-patterns__empty">No patterns — every file starts expanded.</span>}
            {patterns.map((p) => (
              <span key={p} role="listitem" className="st-pattern">
                <span className="mono">{p}</span>
                <button
                  type="button"
                  className="st-pattern__remove"
                  aria-label={`Remove ${p}`}
                  title={`Remove ${p}`}
                  onClick={() => void save(patterns.filter((x) => x !== p))}
                >
                  <XIcon size={10} strokeWidth={2.6} />
                </button>
              </span>
            ))}
          </div>
          <form className="st-row st-patterns__add" onSubmit={add}>
            <TextField
              aria-label="New pattern"
              className="mono st-patterns__input"
              placeholder="Add a pattern, e.g. *.snap or dist/**"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
            />
            <Button size="sm" type="submit" disabled={!draft.trim()}>
              Add
            </Button>
            <Button size="sm" variant="plain" disabled={isDefault} onClick={() => void save(DEFAULT_PATTERNS)}>
              Restore defaults
            </Button>
          </form>
        </>
      )}
    </Group>
  );
}

/* ------------------------------------------------------------------------ */

const emptyFilter = (instanceId: number): CustomMrFilter => ({
  instanceId,
  enabled: false,
  draft: 'no',
  authorUsername: null,
  notAuthorUsername: null,
  labels: null,
  updatedAt: 0,
});

const nullIfBlank = (v: string | null) => (v && v.trim() ? v.trim() : null);
const normalize = (f: CustomMrFilter): CustomMrFilter => ({
  ...f,
  authorUsername: nullIfBlank(f.authorUsername),
  notAuthorUsername: nullIfBlank(f.notAuthorUsername),
  labels: nullIfBlank(f.labels),
});

function CustomFilter() {
  const { instances, instance } = useActiveInstance();
  const [picked, setPicked] = useState<number | null>(null);
  const instanceId = picked ?? instance?.id;
  const target = instances.find((i) => i.id === instanceId);
  const saved = useQuery(instanceId ? ['settings', 'custom-filter', instanceId] : null, () =>
    api.customMrFilter(instanceId!),
  );
  const [filter, setFilter] = useState<CustomMrFilter | null>(null);
  const [count, setCount] = useState<{ n: number } | { error: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Load the stored filter into the form when it arrives / the instance changes.
  useEffect(() => {
    if (!instanceId || saved.loading) return;
    setFilter(saved.data ?? emptyFilter(instanceId));
  }, [instanceId, saved.data, saved.loading]);

  // Live match count while editing an enabled filter (debounced).
  useEffect(() => {
    if (!filter?.enabled) {
      setCount(null);
      return;
    }
    let stale = false;
    const t = setTimeout(() => {
      api
        .testCustomMrFilter(normalize(filter))
        .then((n) => !stale && setCount({ n }))
        .catch((e: Error) => !stale && setCount({ error: e.message }));
    }, 500);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [filter]);

  if (!target || !filter || filter.instanceId !== target.id) {
    return (
      <Group title="Also sync">
        <div className="st-loading st-loading--row">
          <Spinner />
        </div>
      </Group>
    );
  }

  const base = saved.data ?? emptyFilter(target.id);
  const dirty = JSON.stringify(normalize({ ...filter, updatedAt: 0 })) !== JSON.stringify(normalize({ ...base, updatedAt: 0 }));
  const update = (patch: Partial<CustomMrFilter>) => setFilter({ ...filter, ...patch });

  const save = async () => {
    setBusy(true);
    try {
      await api.setCustomMrFilter(normalize(filter));
      await invalidate(['settings', 'custom-filter', target.id]);
      toast('Filter saved — syncing matching merge requests');
      if (filter.enabled) api.triggerSync(false).catch(() => {});
    } catch (e) {
      toast(`Couldn't save the filter: ${(e as Error).message}`, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const off = !filter.enabled;
  const countText =
    count === null
      ? null
      : 'error' in count
        ? `Couldn't check the filter: ${count.error}`
        : `${count.n}${count.n >= 100 ? '+' : ''} open merge request${count.n === 1 ? '' : 's'} match right now.`;

  return (
    <Group
      title="Also sync"
      footer={
        <span className="st-filter-footer">
          <span className={count && 'error' in count ? 'st-warn-text' : undefined}>
            {countText ?? 'Besides merge requests you review or wrote, sync open ones that match a filter — handy for following a team or a label.'}
          </span>
          <Button size="sm" variant="primary" disabled={!dirty} busy={busy} onClick={() => void save()}>
            Save filter
          </Button>
        </span>
      }
    >
      {instances.length > 1 && (
        <Row label="GitLab instance" htmlFor="st-filter-instance">
          <Select id="st-filter-instance" value={target.id} onChange={(e) => setPicked(Number(e.target.value))}>
            {instances.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name || hostOf(i.url)}
              </option>
            ))}
          </Select>
        </Row>
      )}
      <Row label="Sync merge requests matching a filter">
        <Switch label="Sync merge requests matching a filter" checked={filter.enabled} onChange={(v) => update({ enabled: v })} />
      </Row>
      <Row label="Drafts" htmlFor="st-filter-draft">
        <Select
          id="st-filter-draft"
          disabled={off}
          value={filter.draft ?? ''}
          onChange={(e) => update({ draft: e.target.value || null })}
        >
          <option value="no">Leave out drafts</option>
          <option value="">Include drafts</option>
          <option value="yes">Only drafts</option>
        </Select>
      </Row>
      <Row label="Author" description="Only merge requests by this username." htmlFor="st-filter-author">
        <TextField
          id="st-filter-author"
          disabled={off}
          placeholder="Anyone"
          value={filter.authorUsername ?? ''}
          onChange={(e) => update({ authorUsername: e.target.value })}
        />
      </Row>
      <Row label="Not by" description="Leave out merge requests by this username." htmlFor="st-filter-not-author">
        <TextField
          id="st-filter-not-author"
          disabled={off}
          placeholder="Nobody"
          value={filter.notAuthorUsername ?? ''}
          onChange={(e) => update({ notAuthorUsername: e.target.value })}
        />
      </Row>
      <Row label="Labels" description="Comma-separated; merge requests need all of them." htmlFor="st-filter-labels">
        <TextField
          id="st-filter-labels"
          disabled={off}
          placeholder="Any labels"
          value={filter.labels ?? ''}
          onChange={(e) => update({ labels: e.target.value })}
        />
      </Row>
    </Group>
  );
}
