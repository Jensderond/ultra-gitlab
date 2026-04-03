/**
 * Keyboard shortcuts for MyMRDetailPage.
 */

import { useCallback, useEffect } from 'react';
import { useHotkey, parseHotkey } from '@tanstack/react-hotkeys';
import { openExternalUrl } from '../../services/transport';
import { DEFAULT_FILE_JUMP_COUNT } from '../../utils/fileNavigation';
import { trackShortcut } from '../../services/analytics';
import { useShortcuts } from '../../components/ShortcutsProvider';
import type { MergeActions } from './MergeSection';

type TabId = 'overview' | 'comments' | 'code';

interface KeyboardOptions {
  goBack: () => void;
  setActiveTab: (tab: TabId) => void;
  activeTab: TabId;
  webUrl: string | undefined;
  copyToClipboard: (text: string) => void;
  navigateFile: (direction: number) => void;
  fileJumpCount?: number;
  toggleHideGenerated: () => void;
  mergeActionsRef: React.RefObject<MergeActions>;
}

export function useMyMRKeyboard(options: KeyboardOptions) {
  const { getKey } = useShortcuts();
  const {
    goBack,
    setActiveTab,
    activeTab,
    webUrl,
    copyToClipboard,
    navigateFile,
    fileJumpCount = DEFAULT_FILE_JUMP_COUNT,
    toggleHideGenerated,
    mergeActionsRef,
  } = options;

  const isCodeTab = activeTab === 'code';

  // --- Navigation ---
  useHotkey(parseHotkey(getKey('go-back') ?? 'Escape'), () => {
    if (!document.querySelector('.keyboard-help-overlay')) {
      trackShortcut('Escape', 'go_back', 'my_mr_detail');
      goBack();
    }
  }, { ignoreInputs: false });

  // Tab switching
  useHotkey(parseHotkey(getKey('tab-overview') ?? '1'), () => {
    trackShortcut('1', 'switch_tab_overview', 'my_mr_detail');
    setActiveTab('overview');
  });

  useHotkey(parseHotkey(getKey('tab-comments') ?? '2'), () => {
    trackShortcut('2', 'switch_tab_comments', 'my_mr_detail');
    setActiveTab('comments');
  });

  useHotkey(parseHotkey(getKey('tab-code') ?? '3'), () => {
    trackShortcut('3', 'switch_tab_code', 'my_mr_detail');
    setActiveTab('code');
  });

  // --- Browser / clipboard ---
  useHotkey(parseHotkey(getKey('open-in-browser') ?? 'o'), () => {
    if (webUrl) {
      trackShortcut('o', 'open_in_browser', 'my_mr_detail');
      openExternalUrl(webUrl);
    }
  });

  useHotkey(parseHotkey(getKey('copy-mr-link') ?? 'y'), () => {
    if (webUrl) {
      trackShortcut('y', 'copy_link', 'my_mr_detail');
      copyToClipboard(webUrl);
    }
  });

  // --- File navigation (code tab only) ---
  const handleNextFile = useCallback(() => {
    trackShortcut('next-file', 'navigate_file_next', 'my_mr_detail');
    navigateFile(1);
  }, [navigateFile]);

  const handlePrevFile = useCallback(() => {
    trackShortcut('prev-file', 'navigate_file_prev', 'my_mr_detail');
    navigateFile(-1);
  }, [navigateFile]);

  const nextAliases = splitAliases(getKey('next-file') ?? 'n / j / ArrowDown');
  useHotkey(parseHotkey(nextAliases[0] ?? 'n'), handleNextFile, { enabled: isCodeTab });
  useHotkey(parseHotkey(nextAliases[1] ?? 'j'), handleNextFile, { enabled: isCodeTab });
  useHotkey(parseHotkey(nextAliases[2] ?? 'ArrowDown'), handleNextFile, { enabled: isCodeTab });

  const prevAliases = splitAliases(getKey('prev-file') ?? 'p / k / ArrowUp');
  useHotkey(parseHotkey(prevAliases[0] ?? 'p'), handlePrevFile, { enabled: isCodeTab });
  useHotkey(parseHotkey(prevAliases[1] ?? 'k'), handlePrevFile, { enabled: isCodeTab });
  useHotkey(parseHotkey(prevAliases[2] ?? 'ArrowUp'), handlePrevFile, { enabled: isCodeTab });

  useHotkey(parseHotkey(normalizeKey(getKey('jump-files-forward') ?? '→')), () => {
    trackShortcut('ArrowRight', 'navigate_file_jump_next', 'my_mr_detail');
    navigateFile(fileJumpCount);
  }, { enabled: isCodeTab });

  useHotkey(parseHotkey(normalizeKey(getKey('jump-files-backward') ?? '←')), () => {
    trackShortcut('ArrowLeft', 'navigate_file_jump_prev', 'my_mr_detail');
    navigateFile(-fileJumpCount);
  }, { enabled: isCodeTab });

  useHotkey(parseHotkey(getKey('toggle-generated') ?? 'g'), () => {
    trackShortcut('g', 'toggle_hide_generated', 'my_mr_detail');
    toggleHideGenerated();
  }, { enabled: isCodeTab });

  // --- Merge/rebase: Cmd+Enter (not customizable) ---
  useEffect(() => {
    function handleMerge(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        const actions = mergeActionsRef.current;
        if (actions?.merge) {
          e.preventDefault();
          trackShortcut('Mod+Enter', 'merge', 'my_mr_detail');
          actions.merge();
        } else if (actions?.rebase) {
          e.preventDefault();
          trackShortcut('Mod+Enter', 'rebase', 'my_mr_detail');
          actions.rebase();
        }
      }
    }
    window.addEventListener('keydown', handleMerge);
    return () => window.removeEventListener('keydown', handleMerge);
  }, [mergeActionsRef]);
}

const ARROW_SYMBOL_MAP: Record<string, string> = {
  '↓': 'ArrowDown', '↑': 'ArrowUp', '→': 'ArrowRight', '←': 'ArrowLeft',
};

function normalizeKey(key: string): string {
  return ARROW_SYMBOL_MAP[key] ?? key;
}

function splitAliases(keyString: string): string[] {
  return keyString.split(' / ').map((k) => normalizeKey(k.trim()));
}
