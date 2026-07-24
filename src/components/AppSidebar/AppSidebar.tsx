/**
 * Global navigation sidebar.
 *
 * Persistent icon sidebar on the left edge for app-wide navigation.
 */

import { useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import { Tray, User, GitMerge, Target, Gear } from '@phosphor-icons/react';
import { isTauri } from '../../services/transport';
import { trackShortcut } from '../../services/analytics';
import './AppSidebar.css';

interface AppSidebarProps {
  updateAvailable?: boolean;
  hasApprovedMRs?: boolean;
}

interface NavItem {
  path: string;
  /** Match paths starting with this prefix for active state */
  matchPrefix: string;
  label: string;
  icon: React.ReactNode;
  bottom?: boolean;
}

const navItems: NavItem[] = [
  { path: '/mrs', matchPrefix: '/mrs', label: 'Reviews', icon: <Tray size={22} weight="bold" /> },
  { path: '/my-mrs', matchPrefix: '/my-mrs', label: 'My MRs', icon: <User size={22} weight="bold" /> },
  { path: '/pipelines', matchPrefix: '/pipelines', label: 'Pipelines', icon: <GitMerge size={22} weight="bold" /> },
  { path: '/issues', matchPrefix: '/issues', label: 'Issues', icon: <Target size={22} weight="bold" /> },
  { path: '/settings', matchPrefix: '/settings', label: 'Settings', icon: <Gear size={22} weight="bold" />, bottom: true },
];

function isEditableTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

export function AppSidebar({ updateAvailable, hasApprovedMRs }: AppSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (item: NavItem) => {
    return location.pathname === item.path || location.pathname.startsWith(item.matchPrefix + '/');
  };

  const visibleItems = isTauri ? navItems : navItems.filter(item => item.path !== '/settings' && item.path !== '/pipelines');
  const topItems = visibleItems.filter(item => !item.bottom);
  const bottomItems = visibleItems.filter(item => item.bottom);

  const [cmdHeld, setCmdHeld] = useState(false);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (e.key === 'Meta' || e.key === 'Control') setCmdHeld(true);
    }
    function handleKeyUp(e: KeyboardEvent) {
      if (e.key === 'Meta' || e.key === 'Control') setCmdHeld(false);
    }
    function handleBlur() {
      setCmdHeld(false);
    }
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  useEffect(() => {
    function handleDigitNav(e: KeyboardEvent) {
      if (isEditableTarget(e.target)) return;
      if (e.repeat) return;
      if (!(e.metaKey || e.ctrlKey) || e.shiftKey) return;
      if (!e.code.startsWith('Digit') || e.code === 'Digit0') return;

      const digit = e.code.slice('Digit'.length);
      const index = parseInt(digit, 10) - 1;
      if (index < 0 || index >= topItems.length) return;

      e.preventDefault();
      trackShortcut(`Mod+${digit}`, 'navigate_sidebar', 'global');
      navigate(topItems[index].path);
    }
    window.addEventListener('keydown', handleDigitNav);
    return () => window.removeEventListener('keydown', handleDigitNav);
  }, [topItems, navigate]);

  return (
    <nav className="app-sidebar">
      <div className="app-sidebar-top" data-tour="sidebar-nav">
        {topItems.map((item, index) => (
          <button
            key={item.path}
            className={`app-sidebar-item ${isActive(item) ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
            title={item.label}
          >
            {item.icon}
            <span className="app-sidebar-label">{item.label}</span>
            {item.path === '/my-mrs' && hasApprovedMRs && (
              <span className="approved-dot" />
            )}
            {cmdHeld && (
              <span className="app-sidebar-number-hint">{index + 1}</span>
            )}
          </button>
        ))}
      </div>
      <div className="app-sidebar-bottom">
        {bottomItems.map(item => (
          <button
            key={item.path}
            className={`app-sidebar-item ${isActive(item) ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
            title={item.label}
          >
            {item.icon}
            <span className="app-sidebar-label">{item.label}</span>
            {item.path === '/settings' && updateAvailable && (
              <span className="update-dot" />
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
