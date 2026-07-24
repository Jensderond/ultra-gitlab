import type { ReactNode } from 'react';
import './PageHeader.css';

interface PageHeaderProps {
  title: string;
  actions?: ReactNode;
}

export function PageHeader({ title, actions }: PageHeaderProps) {
  return (
    <header className="page-header">
      <div className="page-header-title-group">
        <h1>{title}</h1>
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}
