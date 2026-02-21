/**
 * Activity drawer component.
 *
 * Bottom overlay panel that displays MR activity (comments, threads, events).
 * Slides up from the bottom with a glassmorphism Kanagawa Wave theme.
 * Supports drag-to-resize via a handle at the top edge.
 */

import { useRef, useState, useEffect, useCallback } from 'react';
import './ActivityDrawer.css';

interface ActivityDrawerProps {
  isOpen: boolean;
  onToggle: () => void;
  showSystemEvents: boolean;
  onToggleSystemEvents: () => void;
  children?: React.ReactNode;
  footer?: React.ReactNode;
}

const DEFAULT_HEIGHT_VH = 40;
const MIN_HEIGHT_VH = 20;
const MAX_HEIGHT_VH = 80;

export default function ActivityDrawer({ isOpen, onToggle, showSystemEvents, onToggleSystemEvents, children, footer }: ActivityDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);
  const [heightVh, setHeightVh] = useState(DEFAULT_HEIGHT_VH);
  const isDraggingRef = useRef(false);

  // Focus trap: when drawer opens, focus the drawer for accessibility
  useEffect(() => {
    if (isOpen && drawerRef.current) {
      drawerRef.current.focus();
    }
  }, [isOpen]);

  const handleDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    document.body.style.cursor = 'ns-resize';
    document.body.style.userSelect = 'none';

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const footerHeight = 49;
      // Convert pixel distance (from mouse to footer) into vh units
      const newHeightVh = ((window.innerHeight - moveEvent.clientY - footerHeight) / window.innerHeight) * 100;
      const clamped = Math.max(MIN_HEIGHT_VH, Math.min(MAX_HEIGHT_VH, newHeightVh));
      setHeightVh(clamped);
    };

    const onMouseUp = () => {
      isDraggingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
    };

    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, []);

  return (
    <div
      ref={drawerRef}
      className={`activity-drawer ${isOpen ? 'activity-drawer--open' : ''}`}
      style={{ height: `${heightVh}vh` }}
      tabIndex={-1}
      data-testid="activity-drawer"
    >
      <div
        className="activity-drawer__drag-handle"
        onMouseDown={handleDragStart}
        data-testid="activity-drawer-drag-handle"
      >
        <div className="activity-drawer__drag-grip" />
      </div>
      <div className="activity-drawer__header">
        <span className="activity-drawer__title">Activity</span>
        <div className="activity-drawer__header-actions">
          <label className="activity-drawer__toggle-label" data-testid="activity-show-events-toggle">
            <input
              type="checkbox"
              checked={showSystemEvents}
              onChange={onToggleSystemEvents}
              className="activity-drawer__toggle-checkbox"
            />
            Show activity
          </label>
          <button
            className="activity-drawer__close"
            onClick={onToggle}
            aria-label="Close activity drawer"
            data-testid="activity-drawer-close"
          >
            &times;
          </button>
        </div>
      </div>
      <div className="activity-drawer__content" data-testid="activity-drawer-content">
        {children}
      </div>
      {footer}
    </div>
  );
}
