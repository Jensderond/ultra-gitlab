import type { ReactNode } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { useSmallScreen } from '../../hooks/useSmallScreen';
import { SyncProgressBar } from '../PullToRefresh';
import './PageHeader.css';

interface PageHeaderProps {
  title: string;
  /** Rendered before the title — e.g. a BackButton on a drill-in screen. */
  leading?: ReactNode;
  /** Secondary context rendered after the title — status badges, the branch
      a drill-in screen belongs to. Truncates before the title does. */
  meta?: ReactNode;
  /** Shows the header refresh feedback (centered spinner on desktop, bottom
      progress bar everywhere) — absolutely positioned, never shifts layout. */
  refreshing?: boolean;
  actions?: ReactNode;
}

export function PageHeader({ title, leading, meta, refreshing = false, actions }: PageHeaderProps) {
  const isSmallScreen = useSmallScreen();

  return (
    <header className="page-header">
      <div className="page-header-title-group">
        {leading}
        <h1><span className="page-header-title-text">{title}</span></h1>
        {meta && <div className="page-header-meta">{meta}</div>}
      </div>
      {refreshing && !isSmallScreen && (
        <div className="page-header-refreshing" aria-hidden="true">
          <ArrowsClockwise size={14} weight="bold" />
          <span>Refreshing</span>
        </div>
      )}
      {actions && <div className="page-header-actions">{actions}</div>}
      {refreshing && (
        <div className="page-header-sync-bar">
          <SyncProgressBar />
        </div>
      )}
    </header>
  );
}
