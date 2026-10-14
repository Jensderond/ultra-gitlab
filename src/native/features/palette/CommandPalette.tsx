/**
 * ⌘K from anywhere. The home window has the toolbar's search field, so ⌘K
 * just focuses that; every other screen (review, pipeline, settings) gets
 * this Spotlight-style panel with the same jump targets instead. It doesn't
 * filter any list — there's none to filter — it only jumps.
 */

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useKeys } from '../../app/keys';
import { SearchIcon } from '../../ui/icons';
import { hasToolbarSearch } from './SearchJump';
import { JumpResults, stepFor, useJumpItems, type Item } from './results';

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const close = () => setOpen(false);

  // Falls through to the toolbar field's own ⌘K while one is mounted.
  useKeys({ 'mod+k': () => (hasToolbarSearch() ? false : setOpen(true)) });
  // While open, block the screen's keys underneath (J/K, esc leaving a review).
  useKeys({ escape: close, 'mod+k': close }, { modal: true, enabled: open });

  return open ? <Panel onClose={close} /> : null;
}

function Panel({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const { items, link, busy } = useJumpItems(text, true);
  const current = Math.min(active, Math.max(items.length - 1, 0));

  // Hand focus back to whatever had it (a diff, a comment box) on close.
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    return () => previous?.focus?.();
  }, []);

  useEffect(() => {
    listRef.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [current]);

  const runItem = async (item: Item | undefined) => {
    if (!item || busy) return;
    const result = await item.run();
    if (result === false) return; // stay open so the user can fix the URL
    onClose();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    const step = stepFor(e, current, items.length);
    if (step !== null) setActive(step);
    else if (e.key === 'Enter' && !e.nativeEvent.isComposing) void runItem(items[current]);
    else if (e.key === 'Escape') onClose();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  return createPortal(
    <div className="pal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="pal-popover pal-popover--palette"
        role="dialog"
        aria-label="Search or jump to"
        onMouseDown={(e) => e.target !== inputRef.current && e.preventDefault()}
      >
        <label className="pal-input">
          <SearchIcon size={16} />
          <input
            ref={inputRef}
            type="search"
            spellCheck={false}
            autoComplete="off"
            placeholder="Search or jump to"
            value={text}
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-results"
            aria-activedescendant={items[current] ? `pal-${items[current].key}` : undefined}
            onChange={(e) => {
              setText(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </label>
        <JumpResults
          items={items}
          current={current}
          busy={busy}
          text={text}
          link={link}
          listRef={listRef}
          escLabel="close"
          onHover={setActive}
          onRun={(item) => void runItem(item)}
        />
      </div>
    </div>,
    document.body,
  );
}
