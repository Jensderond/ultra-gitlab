/**
 * Global navigation sidebar.
 *
 * Persistent icon sidebar on the left edge for app-wide navigation.
 */

import { useNavigate, useLocation } from 'react-router-dom';
import { useRef, useState, useLayoutEffect, useEffect, useCallback } from 'react';
import { isTauri } from '../../services/transport';
import './AppSidebar.css';

interface AppSidebarProps {
  updateAvailable?: boolean;
  hasApprovedMRs?: boolean;
  hasActiveToasts?: boolean;
  companionEnabled?: boolean;
  companionDeviceCount?: number;
}

interface NavItem {
  path: string;
  /** Match paths starting with this prefix for active state */
  matchPrefix: string;
  label: string;
  icon: React.ReactNode;
  bottom?: boolean;
}

const InboxIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
    <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
  </svg>
);

const UserIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);

const PipelineIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="5" cy="6" r="2" />
    <circle cx="12" cy="6" r="2" />
    <circle cx="19" cy="6" r="2" />
    <circle cx="12" cy="18" r="2" />
    <line x1="5" y1="8" x2="12" y2="16" />
    <line x1="12" y1="8" x2="12" y2="16" />
    <line x1="19" y1="8" x2="12" y2="16" />
  </svg>
);

const BellIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 01-3.46 0" />
  </svg>
);

const SmartphoneIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <rect x="5" y="2" width="14" height="20" rx="2" ry="2" />
    <line x1="12" y1="18" x2="12.01" y2="18" />
  </svg>
);

const GearIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
  </svg>
);

const navItems: NavItem[] = [
  { path: '/mrs', matchPrefix: '/mrs', label: 'Reviews', icon: <InboxIcon /> },
  { path: '/my-mrs', matchPrefix: '/my-mrs', label: 'My MRs', icon: <UserIcon /> },
  { path: '/pipelines', matchPrefix: '/pipelines', label: 'Pipelines', icon: <PipelineIcon /> },
  { path: '/settings', matchPrefix: '/settings', label: 'Settings', icon: <GearIcon />, bottom: true },
];

export function AppSidebar({ updateAvailable, hasApprovedMRs, hasActiveToasts, companionEnabled, companionDeviceCount = 0 }: AppSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const sidebarRef = useRef<HTMLElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState<React.CSSProperties>({ opacity: 0 });

  const isActive = (item: NavItem) => {
    return location.pathname === item.path || location.pathname.startsWith(item.matchPrefix + '/');
  };

  const visibleItems = isTauri ? navItems : navItems.filter(item => item.path !== '/settings' && item.path !== '/pipelines');
  const topItems = visibleItems.filter(item => !item.bottom);
  const bottomItems = visibleItems.filter(item => item.bottom);
  const activePath = visibleItems.find(item => isActive(item))?.path ?? null;

  const updateIndicator = useCallback(() => {
    const sidebar = sidebarRef.current;
    if (!activePath || !sidebar) {
      setIndicatorStyle({ opacity: 0 });
      return;
    }
    const button = sidebar.querySelector(`[data-path="${CSS.escape(activePath)}"]`) as HTMLElement;
    if (!button) {
      setIndicatorStyle({ opacity: 0 });
      return;
    }
    const sidebarRect = sidebar.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const isMobile = window.matchMedia('(max-width: 767px)').matches;

    if (isMobile) {
      const xOffset = buttonRect.left - sidebarRect.left + (buttonRect.width - 20) / 2;
      setIndicatorStyle({
        transform: `translateX(${xOffset}px)`,
        opacity: 1,
      });
    } else {
      const yOffset = buttonRect.top - sidebarRect.top + (buttonRect.height - 20) / 2;
      setIndicatorStyle({
        transform: `translateY(${yOffset}px)`,
        opacity: 1,
      });
    }
  }, [activePath]);

  useLayoutEffect(() => {
    updateIndicator();
  }, [updateIndicator]);

  useEffect(() => {
    window.addEventListener('resize', updateIndicator);
    return () => window.removeEventListener('resize', updateIndicator);
  }, [updateIndicator]);

  return (
    <nav className="app-sidebar" ref={sidebarRef}>
      <div className="app-sidebar-indicator" style={indicatorStyle} />
      <div className="app-sidebar-top">
        {topItems.map(item => (
          <button
            key={item.path}
            data-path={item.path}
            className={`app-sidebar-item ${isActive(item) ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
            title={item.label}
          >
            {item.icon}
            {item.path === '/my-mrs' && hasApprovedMRs && (
              <span className="approved-dot" />
            )}
          </button>
        ))}
      </div>
      <div className="app-sidebar-bottom">
        <div className="app-sidebar-bell" title="Notifications">
          <BellIcon />
          {hasActiveToasts && <span className="notification-dot" />}
        </div>
        {companionEnabled && (
          <div
            className="app-sidebar-companion app-sidebar-desktop-only"
            title={`Companion: ${companionDeviceCount} device${companionDeviceCount !== 1 ? 's' : ''} connected`}
          >
            <SmartphoneIcon />
            {companionDeviceCount > 0 && (
              <span className="companion-dot" />
            )}
          </div>
        )}
        {bottomItems.map(item => (
          <button
            key={item.path}
            data-path={item.path}
            className={`app-sidebar-item ${isActive(item) ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
            title={item.label}
          >
            {item.icon}
            {item.path === '/settings' && updateAvailable && (
              <span className="update-dot" />
            )}
          </button>
        ))}
      </div>
    </nav>
  );
}
