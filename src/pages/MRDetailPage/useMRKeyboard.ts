import { useEffect, useRef } from 'react';
import { openExternalUrl } from '../../services/transport';
import { DEFAULT_FILE_JUMP_COUNT } from '../../utils/fileNavigation';
import { trackShortcut } from '../../services/analytics';
import type { ApprovalButtonRef } from '../../components/Approval';
import type { CommentOverlayRef } from '../../components/CommentOverlay';
import type { SelectedLineRange } from '../../components/PierreDiffViewer';

interface UseMRKeyboardOptions {
  selectedFile: string | null;
  isSmallScreen: boolean;
  webUrl?: string;
  approvalButtonRef: React.RefObject<ApprovalButtonRef | null>;
  commentOverlayRef: React.RefObject<CommentOverlayRef | null>;
  lineSelectionRef: React.RefObject<SelectedLineRange | null>;
  onNavigateFile: (direction: number) => void;
  fileJumpCount?: number;
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
  lineSelectionRef,
  onNavigateFile,
  fileJumpCount = DEFAULT_FILE_JUMP_COUNT,
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

    // Let browser handle modified keys (Cmd+C copy, Cmd+V paste, etc.)
    if (e.metaKey || e.ctrlKey || e.altKey) return;

    switch (e.key) {
      case 'n':
      case 'j':
      case 'ArrowDown':
        e.preventDefault();
        trackShortcut(e.key, 'navigate_file_next', 'mr_detail');
        onNavigateFile(1);
        break;
      case 'p':
      case 'k':
      case 'ArrowUp':
        e.preventDefault();
        trackShortcut(e.key, 'navigate_file_prev', 'mr_detail');
        onNavigateFile(-1);
        break;
      case 'ArrowRight':
        e.preventDefault();
        trackShortcut('ArrowRight', 'navigate_file_jump_next', 'mr_detail');
        onNavigateFile(fileJumpCount);
        break;
      case 'ArrowLeft':
        e.preventDefault();
        trackShortcut('ArrowLeft', 'navigate_file_jump_prev', 'mr_detail');
        onNavigateFile(-fileJumpCount);
        break;
      case 'x':
        if (isSmallScreen) break;
        e.preventDefault();
        trackShortcut('x', 'toggle_view_mode', 'mr_detail');
        onToggleViewMode();
        break;
      case 'a':
        e.preventDefault();
        trackShortcut('a', 'toggle_approval', 'mr_detail');
        approvalButtonRef.current?.toggle();
        break;
      case 'o':
        e.preventDefault();
        if (webUrl) {
          trackShortcut('o', 'open_in_browser', 'mr_detail');
          openExternalUrl(webUrl);
        }
        break;
      case 'y':
        e.preventDefault();
        if (webUrl) {
          trackShortcut('y', 'copy_link', 'mr_detail');
          onCopyLink(webUrl);
        }
        break;
      case 'v':
        e.preventDefault();
        trackShortcut('v', 'mark_viewed', 'mr_detail');
        onMarkViewedAndNext();
        break;
      case 'g':
        e.preventDefault();
        trackShortcut('g', 'toggle_hide_generated', 'mr_detail');
        onToggleHideGenerated();
        break;
      case 'c':
        e.preventDefault();
        if (selectedFile) {
          trackShortcut('c', 'open_comment', 'mr_detail');
          const selC = lineSelectionRef.current;
          if (selC) {
            const isOriginal = selC.side === 'deletions';
            const startLine = Math.min(selC.start, selC.end);
            const endLine = Math.max(selC.start, selC.end);
            commentOverlayRef.current?.open(
              { line: startLine, isOriginal },
              { startLine, endLine, isOriginal, text: '' },
            );
          } else {
            commentOverlayRef.current?.open({ line: 1, isOriginal: false }, null);
          }
        }
        break;
      case 's':
        e.preventDefault();
        if (selectedFile) {
          trackShortcut('s', 'open_suggestion', 'mr_detail');
          const selS = lineSelectionRef.current;
          if (selS) {
            const isOriginal = selS.side === 'deletions';
            const startLine = Math.min(selS.start, selS.end);
            const endLine = Math.max(selS.start, selS.end);
            const linesBelow = endLine - startLine;
            const suggestionText = `\`\`\`suggestion:-0+${linesBelow}\n\n\`\`\`\n`;
            commentOverlayRef.current?.open(
              { line: startLine, isOriginal },
              { startLine, endLine, isOriginal, text: '' },
              suggestionText,
            );
          } else {
            const suggestionText = '```suggestion:-0+0\n\n```\n';
            commentOverlayRef.current?.open({ line: 1, isOriginal: false }, null, suggestionText);
          }
        }
        break;
      case 'Escape':
        if (commentOverlayRef.current?.isVisible()) {
          e.preventDefault();
          trackShortcut('Escape', 'close_comment_overlay', 'mr_detail');
          commentOverlayRef.current.close();
        } else if (!document.querySelector('.keyboard-help-overlay')) {
          trackShortcut('Escape', 'go_back', 'mr_detail');
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
