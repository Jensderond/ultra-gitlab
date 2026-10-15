/**
 * The shared UI kit. Screens compose these; they should rarely need to
 * restyle a control. Styles live in `components.css` (classes prefixed `ui-`).
 */

import {
  forwardRef,
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { isMac, isTauri } from '../api/client';
import { formatKeys, useKeys } from '../app/keys';
import { SearchIcon } from './icons';
import './components.css';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');
export { cx };

/* ------------------------------------------------------------------------ */
/* Window chrome                                                            */
/* ------------------------------------------------------------------------ */

const INTERACTIVE = 'button, a, input, textarea, select, label, [role="button"], [data-no-drag]';

/** Drag the window from empty toolbar space; double-click zooms (macOS). */
async function onToolbarMouseDown(e: ReactMouseEvent) {
  if (!isTauri || e.button !== 0) return;
  if ((e.target as HTMLElement).closest(INTERACTIVE)) return;
  const { getCurrentWindow } = await import('@tauri-apps/api/window');
  const win = getCurrentWindow();
  if (e.detail === 2) await win.toggleMaximize();
  else await win.startDragging();
}

/**
 * The unified title/toolbar. On macOS the traffic lights float over its
 * left edge, so content starts after them.
 */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <header
      className={cx('ui-toolbar', isMac && isTauri && 'ui-toolbar--traffic', className)}
      onMouseDown={onToolbarMouseDown}
    >
      {children}
    </header>
  );
}

/** A flexible gap that pushes following toolbar items to the right. */
export const Spacer = () => <div className="ui-spacer" />;

/** Title + subtitle stack used at the start of a toolbar. */
export function ToolbarTitle({ title, subtitle }: { title: ReactNode; subtitle?: ReactNode }) {
  return (
    <div className="ui-toolbar-title">
      <span className="ui-toolbar-title__main">{title}</span>
      {subtitle && <span className="ui-toolbar-title__sub">{subtitle}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------------ */
/* Controls                                                                 */
/* ------------------------------------------------------------------------ */

type ButtonVariant = 'primary' | 'secondary' | 'plain' | 'danger' | 'ghost';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  /** Shown as a key hint inside the button, e.g. `enter` → ↩. */
  shortcut?: string;
  busy?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', icon, shortcut, busy, children, className, disabled, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      className={cx('ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, busy && 'is-busy', className)}
      disabled={disabled || busy}
      {...rest}
    >
      {busy ? <Spinner size={12} /> : icon}
      {children && <span className="ui-btn__label">{children}</span>}
      {shortcut && <kbd className="ui-btn__kbd">{formatKeys(shortcut)}</kbd>}
    </button>
  );
});

export function IconButton({
  label,
  children,
  className,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx('ui-icon-btn', active && 'is-active', className)}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface SegmentOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

/** macOS-style segmented control. */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  size = 'md',
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="group" aria-label={label} className={cx('ui-segmented', `ui-segmented--${size}`)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          data-label={typeof o.label === 'string' ? o.label : undefined}
          aria-pressed={o.value === value}
          className={cx('ui-segmented__item', o.value === value && 'is-on')}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const SearchField = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; tone?: 'light' | 'dark' }
>(function SearchField({ label, hint, tone = 'light', className, ...rest }, ref) {
  return (
    <label className={cx('ui-search', tone === 'dark' && 'ui-search--dark', className)}>
      <SearchIcon size={14} />
      <span className="visually-hidden">{label}</span>
      <input ref={ref} type="search" spellCheck={false} autoComplete="off" {...rest} />
      {hint && <kbd className="ui-search__hint">{hint}</kbd>}
    </label>
  );
});

export function Checkbox({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  id?: string;
}) {
  return (
    <input
      id={id}
      type="checkbox"
      className="ui-checkbox"
      aria-label={label}
      checked={checked}
      onChange={(e) => onChange(e.target.checked)}
    />
  );
}

export function Switch({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={cx('ui-switch', checked && 'is-on')}
      onClick={() => onChange(!checked)}
    >
      <span className="ui-switch__knob" />
    </button>
  );
}

/* ------------------------------------------------------------------------ */
/* Display                                                                  */
/* ------------------------------------------------------------------------ */

export type Tone = 'accent' | 'warn' | 'neutral' | 'fail' | 'ok';

export function Tag({ tone = 'neutral', children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx('ui-tag', `ui-tag--${tone}`)}>{children}</span>;
}

export function Kbd({ combo, children }: { combo?: string; children?: ReactNode }) {
  return <kbd className="ui-kbd">{combo ? formatKeys(combo) : children}</kbd>;
}

/** Small uppercase-free section label, as used across the design ("Reviewers"). */
export function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={cx('ui-label', className)}>{children}</span>;
}

export function Card({
  children,
  className,
  dashed,
  tone,
}: {
  children: ReactNode;
  className?: string;
  dashed?: boolean;
  tone?: 'fail';
}) {
  return (
    <div className={cx('ui-card', dashed && 'ui-card--dashed', tone && `ui-card--${tone}`, className)}>
      {children}
    </div>
  );
}

export function Progress({ value, max, label }: { value: number; max: number; label: string }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      className="ui-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
    >
      <div className="ui-progress__bar" style={{ width: `${Math.max(pct, value > 0 ? 2 : 0)}%` }} />
    </div>
  );
}

export function Spinner({ size = 14 }: { size?: number }) {
  return (
    <svg className="ui-spinner" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" strokeWidth="2" opacity="0.25" />
      <path d="M14 8a6 6 0 0 0-6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({
  title,
  message,
  action,
  icon,
}: {
  title: string;
  message?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      {icon && <div className="ui-empty__icon">{icon}</div>}
      <p className="ui-empty__title">{title}</p>
      {message && <p className="ui-empty__message">{message}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}

const AVATAR_COLORS = ['#3B5BA9', '#7A4FB0', '#1E7A34', '#A35A00', '#B42318', '#0E7490', '#5E5E66', '#9D174D'];

export function colorFor(seed: string) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function initials(name: string) {
  const parts = name.replace(/[._-]+/g, ' ').trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function Avatar({
  username,
  src,
  size = 22,
  title,
}: {
  username: string;
  src?: string | null;
  size?: number;
  title?: string;
}) {
  const [failed, setFailed] = useState(false);
  const style = { width: size, height: size, fontSize: Math.round(size * 0.45) };
  if (src && !failed) {
    return (
      <img
        className="ui-avatar"
        src={src}
        alt=""
        title={title ?? username}
        style={style}
        onError={() => setFailed(true)}
        draggable={false}
      />
    );
  }
  return (
    <span
      className="ui-avatar"
      aria-hidden="true"
      title={title ?? username}
      style={{ ...style, background: colorFor(username) }}
    >
      {initials(username)}
    </span>
  );
}

/* ------------------------------------------------------------------------ */
/* Status                                                                   */
/* ------------------------------------------------------------------------ */

export type PipelineState =
  | 'success'
  | 'failed'
  | 'running'
  | 'pending'
  | 'canceled'
  | 'skipped'
  | 'manual'
  | 'created'
  | 'waiting_for_resource'
  | 'preparing'
  | 'scheduled'
  | string;

export function pipelineTone(status: PipelineState | null | undefined): Tone {
  switch (status) {
    case 'success':
      return 'ok';
    case 'failed':
      return 'fail';
    case 'running':
    case 'pending':
    case 'preparing':
    case 'waiting_for_resource':
      return 'accent';
    case 'manual':
    case 'scheduled':
      return 'warn';
    default:
      return 'neutral';
  }
}

export function pipelineLabel(status: PipelineState | null | undefined): string {
  switch (status) {
    case 'success':
      return 'Passed';
    case 'failed':
      return 'Failed';
    case 'running':
      return 'Running';
    case 'pending':
    case 'created':
    case 'preparing':
    case 'waiting_for_resource':
      return 'Pending';
    case 'canceled':
      return 'Canceled';
    case 'skipped':
      return 'Skipped';
    case 'manual':
      return 'Manual';
    case 'scheduled':
      return 'Scheduled';
    default:
      return 'No pipeline';
  }
}

/** Circular status glyph from the design: ✓ passed, ✕ failed, dashed ring running. */
export function StatusIcon({ status, size = 16 }: { status: PipelineState | null | undefined; size?: number }) {
  const label = `Pipeline ${pipelineLabel(status).toLowerCase()}`;
  const common = {
    role: 'img' as const,
    'aria-label': label,
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    strokeWidth: 2.4,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'ui-status',
  };
  switch (pipelineTone(status)) {
    case 'ok':
      return (
        <svg {...common} stroke="var(--ok)">
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12.5l3 3 5-6" />
        </svg>
      );
    case 'fail':
      return (
        <svg {...common} stroke="var(--fail)">
          <circle cx="12" cy="12" r="9" />
          <path d="M9 9l6 6M15 9l-6 6" />
        </svg>
      );
    case 'accent':
      return (
        <svg {...common} stroke="var(--running)" className="ui-status ui-status--running">
          <circle cx="12" cy="12" r="9" strokeDasharray="4 3" />
        </svg>
      );
    case 'warn':
      return (
        <svg {...common} stroke="var(--warn)">
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8.5l5 3.5-5 3.5z" />
        </svg>
      );
    default:
      return (
        <svg {...common} stroke="var(--text-ghost)">
          <circle cx="12" cy="12" r="9" />
          {status && <path d="M8 12h8" />}
        </svg>
      );
  }
}

/* ------------------------------------------------------------------------ */
/* Overlays                                                                 */
/* ------------------------------------------------------------------------ */

/**
 * A sheet: a modal that drops from the toolbar like a macOS sheet.
 * Esc closes; keyboard shortcuts underneath are blocked while it's open.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  footer,
  width = 520,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useKeys({ escape: () => onClose() }, { modal: true, enabled: open });
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const first = panel.current?.querySelector<HTMLElement>(
      'input, textarea, select, button:not([data-autofocus-skip])',
    );
    (panel.current?.querySelector<HTMLElement>('[autofocus]') ?? first)?.focus();
    return () => previous?.focus?.();
  }, [open]);
  if (!open) return null;
  return createPortal(
    <div className="ui-sheet-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={panel} className="ui-sheet" role="dialog" aria-modal="true" style={{ width }}>
        {title && <h2 className="ui-sheet__title">{title}</h2>}
        <div className="ui-sheet__body">{children}</div>
        {footer && <div className="ui-sheet__footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* Toasts ------------------------------------------------------------------ */

interface ToastItem {
  id: number;
  message: ReactNode;
  tone: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
}

let toastId = 0;
const toastListeners = new Set<(items: ToastItem[]) => void>();
let toasts: ToastItem[] = [];

function emitToasts() {
  toastListeners.forEach((l) => l(toasts));
}

export function toast(
  message: ReactNode,
  options: { tone?: ToastItem['tone']; action?: ToastItem['action']; duration?: number } = {},
) {
  const item: ToastItem = { id: ++toastId, message, tone: options.tone ?? 'info', action: options.action };
  toasts = [...toasts, item];
  emitToasts();
  setTimeout(() => {
    toasts = toasts.filter((t) => t.id !== item.id);
    emitToasts();
  }, options.duration ?? (item.tone === 'error' ? 6000 : 3200));
}

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    toastListeners.add(setItems);
    return () => void toastListeners.delete(setItems);
  }, []);
  return createPortal(
    <div className="ui-toaster" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={cx('ui-toast', `ui-toast--${t.tone}`)}>
          <span>{t.message}</span>
          {t.action && (
            <button type="button" className="ui-toast__action" onClick={t.action.run}>
              {t.action.label}
            </button>
          )}
        </div>
      ))}
    </div>,
    document.body,
  );
}

/* Native context menus ------------------------------------------------------ */

export type MenuEntry =
  | { label: string; action: () => void; enabled?: boolean; shortcut?: string }
  | { separator: true };

/**
 * Show a native context menu at the pointer (real NSMenu in the app).
 * Usage: `onContextMenu={(e) => showContextMenu(e, [...])}`.
 * Outside Tauri (browser previews) the browser menu is left alone.
 */
export async function showContextMenu(e: ReactMouseEvent | MouseEvent, entries: MenuEntry[]) {
  if (!isTauri) return;
  e.preventDefault();
  const { Menu, MenuItem, PredefinedMenuItem } = await import('@tauri-apps/api/menu');
  const items = await Promise.all(
    entries.map((entry) =>
      'separator' in entry
        ? PredefinedMenuItem.new({ item: 'Separator' })
        : MenuItem.new({
            text: entry.label,
            enabled: entry.enabled ?? true,
            accelerator: entry.shortcut,
            action: () => entry.action(),
          }),
    ),
  );
  const menu = await Menu.new({ items });
  await menu.popup();
}

/** Copy text and confirm with a toast. */
export async function copyText(text: string, what = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(what);
  } catch {
    toast('Could not copy to the clipboard', { tone: 'error' });
  }
}
