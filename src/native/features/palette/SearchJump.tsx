/**
 * The toolbar's "Search or jump to ⌘K" field.
 *
 * Typing does two things at once, like Mail's search field plus Spotlight:
 *  - the visible list filters live (screens read `useListFilter()`), and
 *  - a popover under the field offers jump targets: merge requests, pipeline
 *    projects and commands. ↑/↓ choose, ↩ jumps, ⇥ keeps the filter and
 *    leaves the field, esc clears.
 * Pasting a GitLab MR or pipeline URL offers to open it in the app.
 *
 * Screens without this field (review, pipeline, settings) get the same
 * targets from the ⌘K palette instead (see CommandPalette).
 */

import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { formatKeys, useKeys } from '../../app/keys';
import { cx } from '../../ui/components';
import { SearchIcon, XIcon } from '../../ui/icons';
import { parseGitLabUrl } from './rank';
import { JumpResults, stepFor, useJumpItems, type Item } from './results';

/* ------------------------------------------------------------------------ */
/* Shared list filter                                                       */
/* ------------------------------------------------------------------------ */

let query = '';
const listeners = new Set<() => void>();

export function setListFilter(q: string) {
  if (q === query) return;
  query = q;
  listeners.forEach((l) => l());
}

/** The current toolbar search text; lists filter themselves with it. */
export function useListFilter(): string {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => query,
  );
}

/* ------------------------------------------------------------------------ */
/* Component                                                                */
/* ------------------------------------------------------------------------ */

// How many toolbar fields are mounted; while one is, ⌘K focuses it rather
// than opening the palette.
let mounted = 0;
export const hasToolbarSearch = () => mounted > 0;

export function SearchJump() {
  const filter = useListFilter();
  const [text, setText] = useState(filter);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldRef = useRef<HTMLLabelElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    mounted++;
    return () => void mounted--;
  }, []);

  // Another screen may clear the filter; mirror it in the field.
  useEffect(() => {
    if (filter !== (parseGitLabUrl(text) ? '' : text)) setText(filter);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const update = (value: string) => {
    setText(value);
    setActive(0);
    setOpen(true);
    setListFilter(parseGitLabUrl(value) ? '' : value);
  };

  const { items, link, busy } = useJumpItems(text, open);
  const current = Math.min(active, Math.max(items.length - 1, 0));

  const focusField = () => {
    inputRef.current?.focus();
    inputRef.current?.select();
  };
  useKeys({ 'mod+k': focusField, '/': focusField });

  // Place the popover under the field (portal, so the toolbar can't clip it).
  useLayoutEffect(() => {
    if (!open) return;
    const place = () => setRect(fieldRef.current?.getBoundingClientRect() ?? null);
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [open]);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current, open]);

  const close = () => {
    setOpen(false);
    inputRef.current?.blur();
  };

  const runItem = async (item: Item | undefined) => {
    if (!item || busy) return;
    const result = await item.run();
    if (result === false) return; // stay open so the user can fix the URL
    update('');
    close();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const key = e.key;
    const step = stepFor(e, current, items.length);
    if (step !== null) {
      setOpen(true);
      setActive(step);
    } else if (key === 'Enter' && !e.nativeEvent.isComposing) {
      void runItem(items[current]);
    } else if (key === 'Escape') {
      update('');
      close();
    } else if (key === 'Tab') {
      setOpen(false); // keep the filter; focus moves on
      return;
    } else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const width = rect ? Math.min(480, window.innerWidth - 16) : 0;
  const left = rect ? Math.max(8, Math.min(rect.right - width, window.innerWidth - width - 8)) : 0;

  return (
    <>
      <label ref={fieldRef} className={cx('ui-search', 'pal-field', open && 'is-open')}>
        <SearchIcon size={14} />
        <span className="visually-hidden">Search or jump to</span>
        <input
          ref={inputRef}
          type="search"
          spellCheck={false}
          autoComplete="off"
          placeholder="Search or jump to"
          value={text}
          role="combobox"
          aria-expanded={open}
          aria-controls="pal-results"
          aria-activedescendant={open && items[current] ? `pal-${items[current].key}` : undefined}
          onChange={(e) => update(e.target.value)}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={onKeyDown}
        />
        {text ? (
          <button
            type="button"
            className="pal-clear"
            aria-label="Clear search"
            tabIndex={-1}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              update('');
              setOpen(false);
            }}
          >
            <XIcon size={10} strokeWidth={3} />
          </button>
        ) : (
          <kbd className="ui-search__hint">{formatKeys('mod+k')}</kbd>
        )}
      </label>
      {open &&
        rect &&
        createPortal(
          <div
            className="pal-popover"
            style={{ top: rect.bottom + 6, left, width }}
            onMouseDown={(e) => e.preventDefault()}
          >
            <JumpResults
              items={items}
              current={current}
              busy={busy}
              text={text}
              link={link}
              listRef={listRef}
              escLabel={text ? 'clear' : 'close'}
              filterHint
              onHover={setActive}
              onRun={(item) => void runItem(item)}
            />
          </div>,
          document.body,
        )}
    </>
  );
}
