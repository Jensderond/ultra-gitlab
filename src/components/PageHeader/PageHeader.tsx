import type { ReactNode } from 'react';
import { ArrowsClockwise } from '@phosphor-icons/react';
import { useSmallScreen } from '../../hooks/useSmallScreen';
import { SyncProgressBar } from '../PullToRefresh';
import './PageHeader.css';

interface PageHeaderProps {
  title: string;
  /** Shows the header refresh feedback (centered spinner on desktop, bottom
      progress bar everywhere) — absolutely positioned, never shifts layout. */
  refreshing?: boolean;
  actions?: ReactNode;
}

export function PageHeader({ title, refreshing = false, actions }: PageHeaderProps) {
  const isSmallScreen = useSmallScreen();

  return (
    <header className="page-header">
      <div className="page-header-title-group">
        <h1>{title}</h1>
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
