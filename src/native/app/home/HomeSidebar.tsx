/**
 * The home window's source list, shared by the inbox and the pipelines
 * dashboard: review views with counts, pipeline shortcuts, clients (top-level
 * groups) and how many open MRs each teammate has. Owned by the inbox feature.
 */

import { useMemo, useState, type ReactNode } from 'react';
import { usePipelineCounts } from '../../features/pipelines/shared';
import { clientKey, clientLabel, useInboxData, viewDef, VIEWS } from '../../features/inbox/model';
import { useAvatars } from '../../data/hooks';
import { UpdateButton } from '../../features/updates/UpdateButton';
import { Avatar, colorFor, cx, StatusIcon } from '../../ui/components';
import { ChevronDown } from '../../ui/icons';
import { Sidebar, SidebarItem } from '../../ui/layout';
import { navigate, paths, setSearchParams, useRoute } from '../router';
import type { HomeSection } from './HomeLayout';
import '../../features/inbox/sidebar.css';

const COLLAPSED_KEY = 'ug.sidebar.collapsed';

function readCollapsed(): string[] {
  try {
    return JSON.parse(localStorage.getItem(COLLAPSED_KEY) ?? '[]');
  } catch {
    return [];
  }
}

/** A source-list section whose header hides/shows it, like Finder's. */
function Section({
  id,
  title,
  collapsed,
  onToggle,
  children,
}: {
  id: string;
  title: string;
  collapsed: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
}) {
  return (
    <div className={cx('ui-sidebar-section inbox-side-section', collapsed && 'is-collapsed')}>
      <button
        type="button"
        className="inbox-side-head"
        aria-expanded={!collapsed}
        onClick={() => onToggle(id)}
        title={collapsed ? `Show ${title}` : `Hide ${title}`}
      >
        <span>{title}</span>
        <ChevronDown size={11} className="inbox-side-head__chev" />
      </button>
      {!collapsed && children}
    </div>
  );
}

export function HomeSidebar({ section }: { section: HomeSection }) {
  const route = useRoute();
  const data = useInboxData();
  const counts = usePipelineCounts(data.instanceId);
  const [collapsed, setCollapsed] = useState<string[]>(readCollapsed);

  const inInbox = section === 'mrs';
  const view = viewDef(inInbox ? (route.segments[1] ?? 'review') : 'review').id;
  const client = inInbox ? route.query.get('client') : null;
  const pipelineFilter = section === 'pipelines' ? route.query.get('filter') : null;

  const toggle = (id: string) => {
    const next = collapsed.includes(id) ? collapsed.filter((c) => c !== id) : [...collapsed, id];
    setCollapsed(next);
    try {
      localStorage.setItem(COLLAPSED_KEY, JSON.stringify(next));
    } catch {
      /* storage unavailable */
    }
  };

  const goView = (id: string) => {
    const qs = client ? `?client=${encodeURIComponent(client)}` : '';
    navigate(`${paths.inbox(id)}${qs}`);
  };

  const clients = useMemo(() => {
    const keys = [...new Set(data.open.map(clientKey))];
    const inView = data.views[view];
    return keys
      .map((key) => ({ key, label: clientLabel(key), count: inView.filter((m) => clientKey(m) === key).length }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [data.open, data.views, view]);

  const team = useMemo(() => {
    const authored = new Map<string, number>();
    for (const mr of data.open) authored.set(mr.authorUsername, (authored.get(mr.authorUsername) ?? 0) + 1);
    return [...authored.entries()]
      .map(([username, open]) => ({ username, open }))
      .sort((a, b) => b.open - a.open || a.username.localeCompare(b.username))
      .slice(0, 8);
  }, [data.open]);
  const avatars = useAvatars(
    data.instanceId,
    team.map((t) => t.username),
  );

  const pickClient = (key: string) => {
    if (inInbox) setSearchParams({ client: client === key ? null : key, mr: null });
    else navigate(`${paths.inbox('review')}?client=${encodeURIComponent(key)}`);
  };

  return (
    <Sidebar>
      <div className="ui-sidebar-section">
        <div className="ui-sidebar-section__head">
          <span>Review</span>
        </div>
        {VIEWS.map((v) => {
          const n = data.views[v.id].length;
          // Quiet views only appear when they have something in them.
          if ((v.id === 'snoozed' || v.id === 'approved') && n === 0 && !(inInbox && view === v.id)) return null;
          return (
            <SidebarItem
              key={v.id}
              label={v.label}
              count={data.loading ? null : n}
              active={inInbox && view === v.id}
              onClick={() => goView(v.id)}
            />
          );
        })}
      </div>

      <Section id="pipelines" title="Pipelines" collapsed={collapsed.includes('pipelines')} onToggle={toggle}>
        <SidebarItem
          label="All projects"
          active={section === 'pipelines' && !pipelineFilter}
          onClick={() => navigate(paths.pipelines())}
        />
        <SidebarItem
          icon={<StatusIcon status="failed" size={14} />}
          label="Failing"
          count={counts.failing}
          active={pipelineFilter === 'failing'}
          onClick={() => navigate('/pipelines?filter=failing')}
        />
        <SidebarItem
          icon={<StatusIcon status="running" size={14} />}
          label="Running"
          count={counts.running}
          active={pipelineFilter === 'running'}
          onClick={() => navigate('/pipelines?filter=running')}
        />
      </Section>

      {clients.length > 0 && (
        <Section id="clients" title="Clients" collapsed={collapsed.includes('clients')} onToggle={toggle}>
          {clients.map((c) => (
            <SidebarItem
              key={c.key}
              icon={<span className="inbox-dot" style={{ background: colorFor(c.key) }} aria-hidden="true" />}
              label={c.label}
              count={c.count || null}
              active={client === c.key}
              onClick={() => pickClient(c.key)}
              title={client === c.key ? 'Show all clients' : `Only show ${c.label}`}
            />
          ))}
        </Section>
      )}

      {team.length > 0 && (
        <Section id="team" title="Open MRs per person" collapsed={collapsed.includes('team')} onToggle={toggle}>
          <div className="inbox-team">
            {team.map((t) => (
              <div
                key={t.username}
                className="inbox-team__row"
                title={`${t.username} has ${t.open} open merge request${t.open === 1 ? '' : 's'}`}
              >
                <Avatar username={t.username} src={avatars?.[t.username]} size={22} />
                <div className="inbox-team__body">
                  <div className="inbox-team__line">
                    <span className="inbox-team__name">
                      {t.username}
                      {t.username === data.me && <span className="inbox-team__you"> (you)</span>}
                    </span>
                    <span className="inbox-team__count tabular">{t.open} open</span>
                  </div>
                  <div className="inbox-team__track">
                    <div
                      className={cx('inbox-team__bar', t.open > 4 && 'is-busy')}
                      style={{ width: `${Math.min(100, t.open * 15)}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      <UpdateButton />
    </Sidebar>
  );
}
