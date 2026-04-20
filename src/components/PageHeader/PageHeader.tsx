import type { ReactNode } from 'react';
import './PageHeader.css';

interface PageHeaderProps {
  title: string;
  onRefresh?: () => void;
  refreshDisabled?: boolean;
  refreshAriaLabel?: string;
  actions?: ReactNode;
}

export function PageHeader({
  title,
  onRefresh,
  refreshDisabled,
  refreshAriaLabel,
  actions,
}: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-title-group">
        <h1>{title}</h1>
        {onRefresh && (
          <button
            className="page-header-refresh"
            onClick={onRefresh}
            disabled={refreshDisabled}
            aria-label={refreshAriaLabel ?? `Refresh ${title}`}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
              <path d="M21 3v5h-5" />
            </svg>
          </button>
        )}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
