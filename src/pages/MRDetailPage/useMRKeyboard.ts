import { useEffect, useRef } from 'react';
import { openExternalUrl } from '../../services/transport';
import type { MonacoDiffViewerRef } from '../../components/Monaco/MonacoDiffViewer';
import type { ApprovalButtonRef } from '../../components/Approval';
import type { CommentOverlayRef } from '../../components/CommentOverlay';

interface UseMRKeyboardOptions {
  selectedFile: string | null;
  isSmallScreen: boolean;
  webUrl?: string;
  diffViewerRef: React.RefObject<MonacoDiffViewerRef | null>;
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
  diffViewerRef,
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
          const pos = diffViewerRef.current?.getCursorPosition();
          const sel = diffViewerRef.current?.getSelectedLines() ?? null;
          if (pos) commentOverlayRef.current?.open(pos, sel);
        }
        break;
      case 's':
        e.preventDefault();
        if (selectedFile) {
          const sel = diffViewerRef.current?.getSelectedLines();
          const pos = diffViewerRef.current?.getCursorPosition();
          if (pos && sel && !sel.isOriginal) {
            const linesBelow = sel.endLine - sel.startLine;
            const suggestionText = `\`\`\`suggestion:-0+${linesBelow}\n${sel.text}\n\`\`\`\n`;
            const cursorPos = { line: sel.startLine, isOriginal: false };
            commentOverlayRef.current?.open(cursorPos, sel, suggestionText);
          } else if (pos) {
            const lineText = sel?.text ?? '';
            const suggestionText = `\`\`\`suggestion:-0+0\n${lineText}\n\`\`\`\n`;
            commentOverlayRef.current?.open(pos, sel ?? null, suggestionText);
          }
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
