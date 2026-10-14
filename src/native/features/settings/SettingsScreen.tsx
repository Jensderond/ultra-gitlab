/**
 * Settings, shaped like a macOS Settings window: icon tabs in the toolbar,
 * grouped forms below. Every control writes straight to the backend — there
 * is no Save button, except where a change needs confirming.
 *
 * ⌘, opens it; Esc or ⌘W returns to the previous screen. The tab lives in
 * `?tab=` (replace-navigation, so Back leaves Settings in one step).
 */

import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useKeys } from '../../app/keys';
import { setSearchParams, useRoute } from '../../app/router';
import { Button, cx, Spacer, Toolbar } from '../../ui/components';
import { CommentIcon, GearIcon, PersonIcon } from '../../ui/icons';
import { Body, Scroll, Window } from '../../ui/layout';
import { AccountsPane } from './AccountsPane';
import { leave } from './leave';
import { GeneralPane } from './GeneralPane';
import { NotificationsPane } from './NotificationsPane';
import { ReviewPane } from './ReviewPane';
import './settings.css';

type Tab = 'general' | 'accounts' | 'review' | 'notifications';

const BellIcon = ({ size = 18 }: { size?: number }) => (
  <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" />
    <path d="M10 20.5a2 2 0 0 0 4 0" />
  </svg>
);

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: 'general', label: 'General', icon: <GearIcon size={18} /> },
  { id: 'accounts', label: 'Accounts', icon: <PersonIcon size={18} strokeWidth={1.8} /> },
  { id: 'review', label: 'Review', icon: <CommentIcon size={18} strokeWidth={1.8} /> },
  { id: 'notifications', label: 'Notifications', icon: <BellIcon /> },
];

export function SettingsScreen() {
  const { query } = useRoute();
  const param = query.get('tab') as Tab | null;
  const tab: Tab = TABS.some((t) => t.id === param) ? param! : 'general';
  const tabsRef = useRef<HTMLDivElement>(null);

  useKeys({
    escape: () => {
      // First Esc leaves a text field, like a native form; the next one closes Settings.
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT')) {
        el.blur();
        return;
      }
      leave();
    },
    'mod+w': () => leave(),
  });

  const select = (id: Tab) => setSearchParams({ tab: id === 'general' ? null : id });

  const onTabKey = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = TABS.findIndex((t) => t.id === tab);
    const next = TABS[(i + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    select(next.id);
    tabsRef.current?.querySelector<HTMLElement>(`[data-tab="${next.id}"]`)?.focus();
  };

  return (
    <Window className="st-window">
      <Toolbar className="st-toolbar">
        <div className="st-toolbar__side">
          <span className="st-toolbar__title">Settings</span>
        </div>
        <Spacer />
        <div ref={tabsRef} className="st-tabs" role="tablist" aria-label="Settings sections" onKeyDown={onTabKey}>
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              data-tab={t.id}
              aria-selected={t.id === tab}
              tabIndex={t.id === tab ? 0 : -1}
              className={cx('st-tab', t.id === tab && 'is-on')}
              onClick={() => select(t.id)}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </div>
        <Spacer />
        <div className="st-toolbar__side st-toolbar__side--end">
          <Button size="sm" onClick={leave} title="Close Settings (esc)">
            Done
          </Button>
        </div>
      </Toolbar>
      <Body>
        <Scroll className="st-scroll">
          <div className="st-page" role="tabpanel" aria-label={TABS.find((t) => t.id === tab)!.label}>
            {tab === 'general' && <GeneralPane />}
            {tab === 'accounts' && <AccountsPane />}
            {tab === 'review' && <ReviewPane />}
            {tab === 'notifications' && <NotificationsPane />}
          </div>
        </Scroll>
      </Body>
    </Window>
  );
}
