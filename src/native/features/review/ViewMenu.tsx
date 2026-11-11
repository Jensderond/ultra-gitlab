/**
 * "View": the diff's display options behind one pop-up button, so the file
 * header stays a single row at any width. Layout (unified / split) and which
 * commits to compare are set-and-forget choices; the things you press on
 * every file (Suggest edit, Mark viewed) stay out in the open.
 *
 * The button names the commit range while it's narrowed to "since my last
 * review", so a partial diff never hides behind a closed menu.
 */

import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useKeys } from '../../app/keys';
import { cx, usePresence } from '../../ui/components';
import { ChevronDown } from '../../ui/icons';

type Layout = 'unified' | 'split';
type Commits = 'all' | 'since';

/** How long the menu takes to close; matches the CSS. */
const EXIT_MS = 100;

export function ViewMenu({
  layout,
  onLayout,
  commits,
  onCommits,
  sinceAvailable,
  sinceHint,
}: {
  layout: Layout;
  onLayout: (layout: Layout) => void;
  commits: Commits;
  onCommits: (commits: Commits) => void;
  /** There are commits newer than your last review to narrow the diff to. */
  sinceAvailable: boolean;
  /** Why "since my last review" is (un)available. */
  sinceHint: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = usePresence<HTMLDivElement>(open, EXIT_MS);

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  // Above the screen's keys while open: Esc closes the menu, nothing else.
  useKeys({ escape: () => close() }, { modal: true, enabled: open });

  useEffect(() => {
    if (!open) return;
    const items = menu.ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not(:disabled)');
    (Array.from(items ?? []).find((i) => i.getAttribute('aria-checked') === 'true') ?? items?.[0])?.focus();
    const outside = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside, true);
    return () => document.removeEventListener('pointerdown', outside, true);
  }, [open, menu.ref]);

  const onKeyDown = (e: KeyboardEvent) => {
    const items = Array.from(
      menu.ref.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]:not(:disabled)') ?? [],
    );
    const at = items.indexOf(document.activeElement as HTMLElement);
    const go = (i: number) => {
      e.preventDefault();
      e.stopPropagation();
      items[(i + items.length) % items.length]?.focus();
    };
    if (e.key === 'ArrowDown') go(at + 1);
    else if (e.key === 'ArrowUp') go(at - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(items.length - 1);
    else if (e.key === 'Tab') close(false);
  };

  const item = <T extends string>(value: T, current: T, label: string, pick: (v: T) => void, disabled = false) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={value === current}
      disabled={disabled}
      className="rv-menu__item"
      onClick={() => {
        pick(value);
        close();
      }}
    >
      <span className="rv-menu__check" aria-hidden="true">
        {value === current ? '✓' : ''}
      </span>
      {label}
    </button>
  );

  const narrowed = commits === 'since';
  return (
    <div ref={wrap} className="rv-viewmenu">
      <button
        ref={button}
        type="button"
        className={cx('ui-btn ui-btn--secondary ui-btn--sm rv-viewmenu__button', narrowed && 'is-on', open && 'is-open')}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={narrowed ? 'View options: since my last review' : 'View options'}
        title="Diff layout and which commits to compare"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="ui-btn__label">{narrowed ? 'Since last review' : 'View'}</span>
        <ChevronDown size={10} />
      </button>
      {menu.present && (
        <div
          ref={menu.ref}
          data-state={menu.state}
          className="rv-menu"
          role="menu"
          aria-label="View options"
          onKeyDown={onKeyDown}
        >
          <div className="rv-menu__label">Layout</div>
          {item<Layout>('unified', layout, 'Unified', onLayout)}
          {item<Layout>('split', layout, 'Split', onLayout)}
          <div className="rv-menu__sep" role="separator" />
          <div className="rv-menu__label">Commits</div>
          {item<Commits>('all', commits, 'All commits', onCommits)}
          {item<Commits>('since', commits, 'Since my last review', onCommits, !sinceAvailable)}
          <div className="rv-menu__note">{sinceHint}</div>
        </div>
      )}
    </div>
  );
}
