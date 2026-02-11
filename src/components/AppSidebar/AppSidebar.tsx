/**
 * Global navigation sidebar.
 *
 * Persistent icon sidebar on the left edge for app-wide navigation.
 */

import { useNavigate, useLocation } from 'react-router-dom';
import './AppSidebar.css';

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

export function AppSidebar() {
  const navigate = useNavigate();
  const location = useLocation();

  const isActive = (item: NavItem) => {
    return location.pathname === item.path || location.pathname.startsWith(item.matchPrefix + '/');
  };

  const topItems = navItems.filter(item => !item.bottom);
  const bottomItems = navItems.filter(item => item.bottom);

  return (
    <nav className="app-sidebar">
      <div className="app-sidebar-top">
        {topItems.map(item => (
          <button
            key={item.path}
            className={`app-sidebar-item ${isActive(item) ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
            title={item.label}
          >
            {item.icon}
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
          </button>
        ))}
      </div>
    </nav>
  );
}
