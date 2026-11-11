import { useEffect } from 'react';

/**
 * Page Up / Page Down scroll the element matching `selector` a screen at a
 * time, wherever focus is. The browser only does that when focus sits inside
 * the scroller, which it rarely does on the diff screens.
 */
export function usePageScrollKeys(selector: string, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'PageDown' && e.key !== 'PageUp') return;
      if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      // composedPath: inside a shadow root (the diff editor) e.target is the host.
      const target = (e.composedPath()[0] ?? e.target) as HTMLElement | null;
      if (
        target?.isContentEditable ||
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT'
      ) return;
      // A dialog or overlay on top keeps its own keys.
      if (document.querySelector('.keyboard-help-overlay, [role="dialog"]')) return;
      const scroller = document.querySelector<HTMLElement>(selector);
      if (!scroller || scroller.scrollHeight <= scroller.clientHeight) return;
      e.preventDefault();
      const page = Math.max(scroller.clientHeight - 60, 40);
      scroller.scrollBy({ top: e.key === 'PageDown' ? page : -page, behavior: 'instant' });
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selector, enabled]);
}
