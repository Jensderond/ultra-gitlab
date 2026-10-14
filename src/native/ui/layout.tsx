/**
 * Window layout primitives: the window column, the vibrant source-list
 * sidebar, and resizable panes (drag the divider, double-click to reset —
 * widths persist per pane id).
 */

import { useCallback, useRef, useState, type ReactNode } from 'react';
import { cx } from './components';
import './layout.css';

export function Window({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ui-window', className)}>{children}</div>;
}

/** Row container for sidebar + panes under the toolbar. */
export function Body({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ui-body', className)}>{children}</div>;
}

export function Sidebar({
  children,
  label = 'Sidebar',
  id = 'sidebar',
  defaultWidth = 228,
}: {
  children: ReactNode;
  label?: string;
  id?: string;
  defaultWidth?: number;
}) {
  return (
    <Pane id={id} defaultWidth={defaultWidth} min={180} max={340} className="ui-sidebar" as="nav" label={label}>
      {children}
    </Pane>
  );
}

export function SidebarSection({ title, children, action }: { title?: string; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="ui-sidebar-section">
      {title && (
        <div className="ui-sidebar-section__head">
          <span>{title}</span>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

export function SidebarItem({
  icon,
  label,
  count,
  active,
  onClick,
  onContextMenu,
  title,
}: {
  icon?: ReactNode;
  label: ReactNode;
  count?: number | string | null;
  active?: boolean;
  onClick?: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
  title?: string;
}) {
  return (
    <button
      type="button"
      className={cx('ui-sidebar-item', active && 'is-active')}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      onContextMenu={onContextMenu}
      title={title}
    >
      <span className="ui-sidebar-item__label">
        {icon}
        <span className="ui-sidebar-item__text">{label}</span>
      </span>
      {count !== undefined && count !== null && count !== 0 && (
        <span className="ui-sidebar-item__count tabular">{count}</span>
      )}
    </button>
  );
}

function readWidth(id: string, fallback: number) {
  try {
    const v = Number(localStorage.getItem(`ug.pane.${id}`));
    return v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

/**
 * A fixed-width pane with a draggable trailing divider. The last pane in a
 * row should be a plain flex:1 element instead.
 */
export function Pane({
  id,
  children,
  defaultWidth,
  min = 220,
  max = 720,
  className,
  as: Tag = 'section',
  label,
}: {
  id: string;
  children: ReactNode;
  defaultWidth: number;
  min?: number;
  max?: number;
  className?: string;
  as?: 'section' | 'nav' | 'aside' | 'div';
  label?: string;
}) {
  const [width, setWidth] = useState(() => readWidth(id, defaultWidth));
  const ref = useRef<HTMLElement>(null);

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const startX = e.clientX;
      const startW = ref.current?.getBoundingClientRect().width ?? width;
      const target = e.currentTarget as HTMLElement;
      target.setPointerCapture(e.pointerId);
      document.body.classList.add('is-resizing');
      let latest = startW;
      const move = (ev: PointerEvent) => {
        latest = Math.min(max, Math.max(min, startW + ev.clientX - startX));
        setWidth(latest);
      };
      const up = () => {
        target.removeEventListener('pointermove', move);
        target.removeEventListener('pointerup', up);
        document.body.classList.remove('is-resizing');
        try {
          localStorage.setItem(`ug.pane.${id}`, String(Math.round(latest)));
        } catch {
          /* ignore */
        }
      };
      target.addEventListener('pointermove', move);
      target.addEventListener('pointerup', up);
    },
    [id, max, min, width],
  );

  return (
    <Tag
      ref={ref as never}
      className={cx('ui-pane', className)}
      style={{ width, flexBasis: width }}
      aria-label={label}
    >
      {children}
      <div
        className="ui-pane__divider"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        onDoubleClick={() => {
          setWidth(defaultWidth);
          try {
            localStorage.removeItem(`ug.pane.${id}`);
          } catch {
            /* ignore */
          }
        }}
      />
    </Tag>
  );
}

/** Vertical scroll container that fills its parent. */
export function Scroll({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('ui-scroll', className)}>{children}</div>;
}
