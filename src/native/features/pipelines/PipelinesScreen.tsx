/**
 * Pipelines dashboard (`/pipelines?project=&filter=failing|running`).
 *
 * Middle pane: pinned + recently visited projects, grouped Failing / Running /
 * Passed / Other (pinned first). Right pane: the selected project's recent
 * pipelines and the selected pipeline's stages and jobs.
 *
 * Keys: J/K/↑/↓ move, ↩ opens the pipeline, P pins, ⌘N adds a project.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { api, openExternal } from '../../api/client';
import type { PipelineProject, PipelineStatus } from '../../api/types';
import { HomeLayout } from '../../app/home/HomeLayout';
import { formatKeys, useKeys } from '../../app/keys';
import { setSearchParams, useRoute } from '../../app/router';
import { useActiveInstance } from '../../data/hooks';
import { invalidate, setData } from '../../data/query';
import { age, duration, plural, shortSha } from '../../lib/format';
import {
  Button,
  copyText,
  cx,
  EmptyState,
  Segmented,
  showContextMenu,
  Spinner,
  StatusIcon,
  toast,
} from '../../ui/components';
import { PinIcon, PlusIcon } from '../../ui/icons';
import { Pane } from '../../ui/layout';
import { useListFilter } from '../palette/SearchJump';
import { AddProjectSheet } from './AddProjectSheet';
import { groupOf, pipelineDuration, usePipelineDashboardData, type Group } from './model';
import { openPipeline, ProjectPane } from './ProjectPane';
import './dashboard.css';

const GROUPS: { id: Group; label: string }[] = [
  { id: 'failing', label: 'Failing' },
  { id: 'running', label: 'Running' },
  { id: 'passed', label: 'Passed' },
  { id: 'other', label: 'Other' },
];

type Filter = 'all' | 'failing' | 'running';

interface Row {
  project: PipelineProject;
  status?: PipelineStatus;
  group: Group;
}

const displayName = (p: PipelineProject) => p.customName ?? p.name;
const namespaceOf = (p: PipelineProject) => p.pathWithNamespace.split('/').slice(0, -1).join('/');

function ProjectRow({
  row,
  selected,
  onSelect,
  onOpen,
  onMenu,
}: {
  row: Row;
  selected: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onMenu: (e: React.MouseEvent) => void;
}) {
  const { project: p, status: s } = row;
  return (
    <div
      id={`pl-project-${p.projectId}`}
      role="option"
      aria-selected={selected}
      className={cx('pl-row', selected && 'is-selected')}
      onMouseDown={onSelect}
      onDoubleClick={onOpen}
      onContextMenu={(e) => {
        onSelect();
        onMenu(e);
      }}
    >
      <span className="pl-row__icon">
        <StatusIcon status={s?.status ?? null} size={16} />
      </span>
      <div className="pl-row__main">
        <div className="pl-row__line">
          <span className="pl-row__name">
            {displayName(p)}
            {p.pinned && (
              <span className="pl-row__pin" aria-label="Pinned">
                <PinIcon size={11} />
              </span>
            )}
          </span>
          <span className="pl-row__age tabular">{s ? age(s.createdAt) : ''}</span>
        </div>
        <div className="pl-row__line pl-row__sub">
          <span className="pl-row__meta">
            <span className="mono pl-row__ns">{namespaceOf(p) || p.pathWithNamespace}</span>
            {s && (
              <>
                <span className="pl-row__ref mono" title={s.refName}>
                  {s.refName}
                </span>
                <span className="mono pl-row__sha">{shortSha(s.sha)}</span>
              </>
            )}
            {!s && <span>No pipelines</span>}
          </span>
          <span className="pl-row__dur tabular">{s ? duration(pipelineDuration(s)) : ''}</span>
        </div>
      </div>
    </div>
  );
}

export function PipelinesScreen({ projectId, filter }: { projectId?: number; filter?: string }) {
  const { instance } = useActiveInstance();
  const instanceId = instance?.id;
  const { projects, statuses } = usePipelineDashboardData(instanceId);
  const search = useListFilter().trim().toLowerCase();
  const route = useRoute();
  const pipelineParam = Number(route.query.get('pipeline')) || undefined;
  const activeFilter: Filter = filter === 'failing' || filter === 'running' ? filter : 'all';
  const [adding, setAdding] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const rows = useMemo(() => {
    const list: Row[] = (projects.data ?? []).map((project) => {
      const status = statuses.map.get(project.projectId);
      return { project, status, group: groupOf(status?.status) };
    });
    const filtered = list.filter((r) => {
      if (activeFilter !== 'all' && r.group !== activeFilter) return false;
      if (!search) return true;
      const p = r.project;
      return [p.name, p.customName ?? '', p.pathWithNamespace, r.status?.refName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(search);
    });
    filtered.sort((a, b) => {
      if (a.project.pinned !== b.project.pinned) return a.project.pinned ? -1 : 1;
      if (a.project.pinned) return (a.project.sortOrder ?? 0) - (b.project.sortOrder ?? 0);
      return displayName(a.project).localeCompare(displayName(b.project));
    });
    return GROUPS.map((g) => ({ ...g, rows: filtered.filter((r) => r.group === g.id) })).filter((g) => g.rows.length);
  }, [projects.data, statuses.map, activeFilter, search]);

  const flat = useMemo(() => rows.flatMap((g) => g.rows), [rows]);
  const selected = flat.find((r) => r.project.projectId === projectId) ?? flat[0];
  const selectedProject =
    selected?.project ?? (projects.data ?? []).find((p) => p.projectId === projectId) ?? undefined;

  useEffect(() => {
    if (!selected) return;
    document.getElementById(`pl-project-${selected.project.projectId}`)?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const select = (id: number) => {
    if (id !== selected?.project.projectId) setSearchParams({ project: id, pipeline: null });
  };
  const move = (dir: 1 | -1) => {
    if (!flat.length) return;
    const at = selected ? flat.indexOf(selected) : -1;
    const next = flat[Math.max(0, Math.min(flat.length - 1, at + dir))];
    if (next) select(next.project.projectId);
  };
  const openLatest = (row: Row | undefined, pipelineId?: number) => {
    if (!row || !instanceId) return;
    const id = pipelineId ?? row.status?.id;
    if (id) openPipeline(instanceId, row.project.projectId, id);
  };

  const projectsKey = ['pipelines', 'projects', instanceId];
  const togglePin = async (p: PipelineProject) => {
    if (!instanceId) return;
    setData<PipelineProject[]>(projectsKey, (prev) =>
      (prev ?? []).map((x) => (x.projectId === p.projectId ? { ...x, pinned: !x.pinned } : x)),
    );
    try {
      await api.togglePinProject(instanceId, p.projectId);
    } catch (e) {
      toast(`Couldn’t change the pin: ${(e as Error).message}`, { tone: 'error' });
    }
    void invalidate(projectsKey);
  };
  const remove = async (p: PipelineProject) => {
    if (!instanceId) return;
    setData<PipelineProject[]>(projectsKey, (prev) => (prev ?? []).filter((x) => x.projectId !== p.projectId));
    try {
      await api.removeProject(instanceId, p.projectId);
      toast(`Removed ${displayName(p)} from the dashboard`);
    } catch (e) {
      toast(`Couldn’t remove ${displayName(p)}: ${(e as Error).message}`, { tone: 'error' });
    }
    void invalidate(projectsKey);
  };

  const menu = (row: Row) => (e: React.MouseEvent) =>
    void showContextMenu(e, [
      ...(row.status ? [{ label: 'Open latest pipeline', action: () => openLatest(row) }, { separator: true as const }] : []),
      { label: row.project.pinned ? 'Unpin' : 'Pin', action: () => void togglePin(row.project) },
      { label: 'Remove from dashboard', action: () => void remove(row.project) },
      { separator: true },
      { label: 'Open in GitLab', action: () => void openExternal(row.project.webUrl) },
      { label: 'Copy URL', action: () => void copyText(row.project.webUrl, 'Copied project URL') },
    ]);

  const notOnButton = () => !(document.activeElement as HTMLElement | null)?.closest('button, a, [role="button"]');
  useKeys(
    {
      j: () => move(1),
      k: () => move(-1),
      arrowdown: () => move(1),
      arrowup: () => move(-1),
      enter: () => (notOnButton() ? openLatest(selected, pipelineParam) : false),
      p: () => selected && void togglePin(selected.project),
      'mod+n': () => setAdding(true),
    },
    { enabled: !adding },
  );

  const host = instance ? new URL(instance.url).host : '';
  const count = projects.data?.length ?? 0;

  return (
    <HomeLayout
      section="pipelines"
      title="Pipelines"
      subtitle={projects.data ? `${plural(count, 'project')}${host ? ` · ${host}` : ''}` : host}
    >
      <Pane id="pl-projects" defaultWidth={360} min={260} max={560} className="pl-projects" label="Projects">
        <div className="pl-projects__bar">
          <Segmented<Filter>
            size="sm"
            label="Filter"
            value={activeFilter}
            onChange={(v) => setSearchParams({ filter: v === 'all' ? null : v })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'failing', label: 'Failing' },
              { value: 'running', label: 'Running' },
            ]}
          />
          <div className="pl-grow" />
          {statuses.fetching && <Spinner size={12} />}
          <Button
            size="sm"
            variant="plain"
            icon={<PlusIcon size={13} />}
            onClick={() => setAdding(true)}
            title={`Add a project (${formatKeys('mod+n')})`}
          >
            Add project
          </Button>
        </div>
        <div
          ref={listRef}
          className="pl-list"
          role="listbox"
          tabIndex={0}
          aria-label="Projects"
          aria-activedescendant={selected ? `pl-project-${selected.project.projectId}` : undefined}
        >
          {projects.error && !projects.data ? (
            <EmptyState
              title="Couldn’t load your projects"
              message={projects.error.message}
              action={<Button onClick={() => void projects.refetch()}>Try again</Button>}
            />
          ) : projects.loading ? (
            <div className="pl-list__loading">
              <Spinner />
            </div>
          ) : !count ? (
            <EmptyState
              title="No projects yet"
              message="Add the projects whose pipelines you want to keep an eye on."
              action={
                <Button variant="primary" icon={<PlusIcon size={13} />} onClick={() => setAdding(true)}>
                  Add project
                </Button>
              }
            />
          ) : !flat.length ? (
            <EmptyState
              title={search ? 'No matching projects' : activeFilter === 'failing' ? 'Nothing is failing' : 'Nothing is running'}
              message={search ? `Nothing matches “${search}”.` : 'All quiet on the pipelines you follow.'}
            />
          ) : (
            rows.map((g) => (
              <div key={g.id} role="group" aria-label={g.label}>
                <div className="pl-group">
                  <span>{g.label}</span>
                  <span className="pl-group__count tabular">{g.rows.length}</span>
                </div>
                {g.rows.map((r) => (
                  <ProjectRow
                    key={r.project.projectId}
                    row={r}
                    selected={r === selected}
                    onSelect={() => {
                      select(r.project.projectId);
                      listRef.current?.focus();
                    }}
                    onOpen={() => openLatest(r)}
                    onMenu={menu(r)}
                  />
                ))}
              </div>
            ))
          )}
        </div>
      </Pane>
      <div className="pl-right">
        {instanceId && selectedProject ? (
          <ProjectPane
            key={selectedProject.projectId}
            instanceId={instanceId}
            project={selectedProject}
            pipelineId={pipelineParam}
            onTogglePin={() => void togglePin(selectedProject)}
          />
        ) : (
          count > 0 && <EmptyState title="No project selected" message="Pick a project to see its pipelines." />
        )}
      </div>
      {instanceId && (
        <AddProjectSheet
          open={adding}
          onClose={() => setAdding(false)}
          instanceId={instanceId}
          existing={new Set((projects.data ?? []).map((p) => p.projectId))}
          onAdded={(id) => {
            void invalidate(['pipelines', 'statuses', instanceId]);
            setSearchParams({ project: id, pipeline: null, filter: null });
          }}
        />
      )}
    </HomeLayout>
  );
}
