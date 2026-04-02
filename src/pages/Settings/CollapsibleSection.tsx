import type { ReactNode } from 'react';

interface CollapsibleSectionProps {
  title: ReactNode;
  /** Brief summary shown in the header when the section is collapsed */
  subtitle?: ReactNode;
  /** Buttons/actions rendered in the summary bar, right-aligned */
  actions?: ReactNode;
  children: ReactNode;
  defaultOpen?: boolean;
}

/**
 * Collapsible settings section using native <details>/<summary>.
 * Collapsed by default.
 */
export default function CollapsibleSection({
  title,
  subtitle,
  actions,
  children,
  defaultOpen = false,
}: CollapsibleSectionProps) {
  return (
    <details className="settings-section collapsible-section" open={defaultOpen || undefined}>
      <summary className="collapsible-summary" onClick={actions ? (e) => {
        // Prevent toggle when clicking action buttons
        if ((e.target as HTMLElement).closest('.collapsible-actions')) {
          e.preventDefault();
        }
      } : undefined}>
        <span className="collapsible-title">
          <svg className="collapsible-chevron" width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path d="M4.5 2.5L8 6L4.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
          {title}
          {subtitle && <span className="collapsible-subtitle">{subtitle}</span>}
        </span>
        {actions && (
          <span className="collapsible-actions">{actions}</span>
        )}
      </summary>
      <div className="collapsible-content">
        {children}
      </div>
    </details>
  );
}
