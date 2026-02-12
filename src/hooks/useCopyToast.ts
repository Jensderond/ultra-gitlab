/**
 * Hook for copying text to clipboard with transient visual feedback.
 *
 * Returns [showToast, copyToClipboard] — the toast auto-dismisses after a short delay.
 */

import { useState, useCallback, useRef } from 'react';

export function useCopyToast(duration = 1500): [boolean, (text: string) => void] {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const copy = useCallback(
    (text: string) => {
      navigator.clipboard.writeText(text).then(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        setShow(true);
        timerRef.current = setTimeout(() => setShow(false), duration);
      });
    },
    [duration]
  );

  return [show, copy];
}
