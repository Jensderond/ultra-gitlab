import { useCallback } from 'react';
import { useHotkey, parseHotkey } from '@tanstack/react-hotkeys';
import { openExternalUrl } from '../../services/transport';
import { DEFAULT_FILE_JUMP_COUNT } from '../../utils/fileNavigation';
import { buildGitLabSuggestionBlock, extractSuggestionSelectionText } from '../../utils/gitlabSuggestions';
import { trackShortcut } from '../../services/analytics';
import { useShortcuts } from '../../components/ShortcutsProvider';
import type { ApprovalButtonRef } from '../../components/Approval';
import type { CommentOverlayRef } from '../../components/CommentOverlay';
import type { SelectedLineRange } from '../../components/PierreDiffViewer';

interface UseMRKeyboardOptions {
  selectedFile: string | null;
  fileContent: { original: string; modified: string };
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
  fileContent,
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
  const { getKey } = useShortcuts();

  const createSelection = useCallback((selection: SelectedLineRange) => {
    const isOriginal = selection.side === 'deletions';
    const startLine = Math.min(selection.start, selection.end);
    const endLine = Math.max(selection.start, selection.end);
    const text = extractSuggestionSelectionText(
      isOriginal ? fileContent.original : fileContent.modified,
      startLine,
      endLine,
    );
    return { startLine, endLine, isOriginal, text };
  }, [fileContent]);

  // --- File navigation ---
  // Aliases: "n / j / ArrowDown" — need separate useHotkey per alias
  // When user sets custom binding, all 3 get the same key (harmless)
  const nextFileAliases = splitAliases(getKey('next-file') ?? 'n / j / ArrowDown');
  const handleNextFile = useCallback(() => {
    trackShortcut('next-file', 'navigate_file_next', 'mr_detail');
    onNavigateFile(1);
  }, [onNavigateFile]);

  useHotkey(parseHotkey(nextFileAliases[0] ?? 'n'), handleNextFile);
  useHotkey(parseHotkey(nextFileAliases[1] ?? 'j'), handleNextFile);
  useHotkey(parseHotkey(nextFileAliases[2] ?? 'ArrowDown'), handleNextFile);

  const prevFileAliases = splitAliases(getKey('prev-file') ?? 'p / k / ArrowUp');
  const handlePrevFile = useCallback(() => {
    trackShortcut('prev-file', 'navigate_file_prev', 'mr_detail');
    onNavigateFile(-1);
  }, [onNavigateFile]);

  useHotkey(parseHotkey(prevFileAliases[0] ?? 'p'), handlePrevFile);
  useHotkey(parseHotkey(prevFileAliases[1] ?? 'k'), handlePrevFile);
  useHotkey(parseHotkey(prevFileAliases[2] ?? 'ArrowUp'), handlePrevFile);

  useHotkey(parseHotkey(normalizeKey(getKey('jump-files-forward') ?? '→')), () => {
    trackShortcut('ArrowRight', 'navigate_file_jump_next', 'mr_detail');
    onNavigateFile(fileJumpCount);
  });

  useHotkey(parseHotkey(normalizeKey(getKey('jump-files-backward') ?? '←')), () => {
    trackShortcut('ArrowLeft', 'navigate_file_jump_prev', 'mr_detail');
    onNavigateFile(-fileJumpCount);
  });

  // --- Diff controls ---
  useHotkey(parseHotkey(getKey('toggle-view-mode') ?? 'x'), () => {
    trackShortcut('x', 'toggle_view_mode', 'mr_detail');
    onToggleViewMode();
  }, { enabled: !isSmallScreen });

  // --- Review actions ---
  useHotkey(parseHotkey(getKey('approve') ?? 'a'), () => {
    trackShortcut('a', 'toggle_approval', 'mr_detail');
    approvalButtonRef.current?.toggle();
  });

  useHotkey(parseHotkey(getKey('open-in-browser') ?? 'o'), () => {
    if (webUrl) {
      trackShortcut('o', 'open_in_browser', 'mr_detail');
      openExternalUrl(webUrl);
    }
  });

  useHotkey(parseHotkey(getKey('copy-mr-link') ?? 'y'), () => {
    if (webUrl) {
      trackShortcut('y', 'copy_link', 'mr_detail');
      onCopyLink(webUrl);
    }
  });

  useHotkey(parseHotkey(getKey('mark-viewed') ?? 'v'), () => {
    trackShortcut('v', 'mark_viewed', 'mr_detail');
    onMarkViewedAndNext();
  });

  useHotkey(parseHotkey(getKey('toggle-generated') ?? 'g'), () => {
    trackShortcut('g', 'toggle_hide_generated', 'mr_detail');
    onToggleHideGenerated();
  });

  useHotkey(parseHotkey(getKey('add-comment') ?? 'c'), () => {
    if (!selectedFile) return;
    trackShortcut('c', 'open_comment', 'mr_detail');
    const selC = lineSelectionRef.current;
    if (selC) {
      const selection = createSelection(selC);
      commentOverlayRef.current?.open(
        { line: selection.startLine, isOriginal: selection.isOriginal },
        selection,
      );
    } else {
      commentOverlayRef.current?.open({ line: 1, isOriginal: false }, null);
    }
  });

  useHotkey(parseHotkey(getKey('add-suggestion') ?? 's'), () => {
    if (!selectedFile) return;
    trackShortcut('s', 'open_suggestion', 'mr_detail');
    const selS = lineSelectionRef.current;
    if (selS) {
      const selection = createSelection(selS);
      const suggestionText = buildGitLabSuggestionBlock(selection);
      commentOverlayRef.current?.open(
        { line: selection.endLine, isOriginal: selection.isOriginal },
        selection,
        suggestionText,
      );
    } else {
      const suggestionText = '```suggestion:-0+0\n\n```\n';
      commentOverlayRef.current?.open({ line: 1, isOriginal: false }, null, suggestionText);
    }
  });

  useHotkey(parseHotkey(getKey('filter-files') ?? '\\'), () => {
    // Handled elsewhere — just prevent default via TanStack's auto-preventDefault
  });

  // Escape: close comment overlay or go back
  useHotkey(parseHotkey(getKey('go-back') ?? 'Escape'), () => {
    if (commentOverlayRef.current?.isVisible()) {
      trackShortcut('Escape', 'close_comment_overlay', 'mr_detail');
      commentOverlayRef.current.close();
    } else if (!document.querySelector('.keyboard-help-overlay')) {
      trackShortcut('Escape', 'go_back', 'mr_detail');
      onEscapeBack();
    }
  }, { ignoreInputs: false });
}

const ARROW_SYMBOL_MAP: Record<string, string> = {
  '↓': 'ArrowDown', '↑': 'ArrowUp', '→': 'ArrowRight', '←': 'ArrowLeft',
};

/** Normalize a single key string, mapping arrow symbols to their ArrowX equivalents. */
function normalizeKey(key: string): string {
  return ARROW_SYMBOL_MAP[key] ?? key;
}

/** Split alias key strings like "n / j / ↓" into individual normalized keys. */
function splitAliases(keyString: string): string[] {
  return keyString.split(' / ').map((k) => normalizeKey(k.trim()));
}
