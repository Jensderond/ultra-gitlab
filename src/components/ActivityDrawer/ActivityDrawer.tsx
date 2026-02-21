/**
 * Activity drawer component.
 *
 * Bottom overlay panel that displays MR activity (comments, threads, events).
 * Slides up from the bottom with a glassmorphism Kanagawa Wave theme.
 */

import { useRef, useEffect } from 'react';
import './ActivityDrawer.css';

interface ActivityDrawerProps {
  isOpen: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}

export default function ActivityDrawer({ isOpen, onToggle, children }: ActivityDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Focus trap: when drawer opens, focus the drawer for accessibility
  useEffect(() => {
    if (isOpen && drawerRef.current) {
      drawerRef.current.focus();
    }
  }, [isOpen]);

  return (
    <div
      ref={drawerRef}
      className={`activity-drawer ${isOpen ? 'activity-drawer--open' : ''}`}
      tabIndex={-1}
      data-testid="activity-drawer"
    >
      <div className="activity-drawer__header">
        <span className="activity-drawer__title">Activity</span>
        <button
          className="activity-drawer__close"
          onClick={onToggle}
          aria-label="Close activity drawer"
          data-testid="activity-drawer-close"
        >
          &times;
        </button>
      </div>
      <div className="activity-drawer__content" data-testid="activity-drawer-content">
        {children}
      </div>
    </div>
  );
}
