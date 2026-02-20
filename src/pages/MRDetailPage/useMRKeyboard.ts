import { useEffect, useRef } from 'react';
import { openExternalUrl } from '../../services/transport';
import type { ApprovalButtonRef } from '../../components/Approval';
import type { CommentOverlayRef } from '../../components/CommentOverlay';

interface UseMRKeyboardOptions {
  selectedFile: string | null;
  isSmallScreen: boolean;
  webUrl?: string;
  approvalButtonRef: React.RefObject<ApprovalButtonRef | null>;
  commentOverlayRef: React.RefObject<CommentOverlayRef | null>;
  onNavigateFile: (direction: 1 | -1) => void;
  onToggleViewMode: () => void;
  onMarkViewedAndNext: () => void;
  onToggleHideGenerated: () => void;
  onCopyLink: (url: string) => void;
  onEscapeBack: () => void;
}

export function useMRKeyboard({
  selectedFile,
  isSmallScreen,
  webUrl,
  approvalButtonRef,
  commentOverlayRef,
  onNavigateFile,
  onToggleViewMode,
  onMarkViewedAndNext,
  onToggleHideGenerated,
  onCopyLink,
  onEscapeBack,
}: UseMRKeyboardOptions) {
  // Ref pattern avoids listener churn
  const handlerRef = useRef<(e: KeyboardEvent) => void>(undefined);
  handlerRef.current = (e: KeyboardEvent) => {
    if (
      e.target instanceof HTMLInputElement ||
      e.target instanceof HTMLTextAreaElement ||
      (commentOverlayRef.current?.isVisible() && e.key !== 'Escape')
    ) {
      return;
    }

    switch (e.key) {
      case 'n':
      case 'j':
      case 'ArrowDown':
        e.preventDefault();
        onNavigateFile(1);
        break;
      case 'p':
      case 'k':
      case 'ArrowUp':
        e.preventDefault();
        onNavigateFile(-1);
        break;
      case 'x':
        if (isSmallScreen) break;
        e.preventDefault();
        onToggleViewMode();
        break;
      case 'a':
        e.preventDefault();
        approvalButtonRef.current?.toggle();
        break;
      case 'o':
        e.preventDefault();
        if (webUrl) openExternalUrl(webUrl);
        break;
      case 'y':
        e.preventDefault();
        if (webUrl) onCopyLink(webUrl);
        break;
      case 'v':
        e.preventDefault();
        onMarkViewedAndNext();
        break;
      case 'g':
        e.preventDefault();
        onToggleHideGenerated();
        break;
      case 'c':
        e.preventDefault();
        if (selectedFile) {
          commentOverlayRef.current?.open({ line: 1, isOriginal: false }, null);
        }
        break;
      case 's':
        e.preventDefault();
        if (selectedFile) {
          const suggestionText = '```suggestion:-0+0\n\n```\n';
          commentOverlayRef.current?.open({ line: 1, isOriginal: false }, null, suggestionText);
        }
        break;
      case 'Escape':
        if (commentOverlayRef.current?.isVisible()) {
          e.preventDefault();
          commentOverlayRef.current.close();
        } else if (!document.querySelector('.keyboard-help-overlay')) {
          onEscapeBack();
        }
        break;
    }
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => handlerRef.current?.(e);
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
