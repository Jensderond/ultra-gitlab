/**
 * Keyboard shortcuts for MyMRDetailPage.
 */

import { useEffect, useRef } from 'react';
import { openExternalUrl } from '../../services/transport';
import { DEFAULT_FILE_JUMP_COUNT } from '../../utils/fileNavigation';
import { trackShortcut } from '../../services/analytics';

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
}

export function useMyMRKeyboard(options: KeyboardOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        return;
      }

      const opts = optionsRef.current;

      switch (e.key) {
        case 'Escape':
          if (!document.querySelector('.keyboard-help-overlay')) {
            e.preventDefault();
            trackShortcut('Escape', 'go_back', 'my_mr_detail');
            opts.goBack();
          }
          break;
        case '1':
        case '2':
        case '3': {
          e.preventDefault();
          const tabs: TabId[] = ['overview', 'comments', 'code'];
          trackShortcut(e.key, `switch_tab_${tabs[parseInt(e.key, 10) - 1]}`, 'my_mr_detail');
          opts.setActiveTab(tabs[parseInt(e.key, 10) - 1]);
          break;
        }
        case 'o':
          e.preventDefault();
          if (opts.webUrl) {
            trackShortcut('o', 'open_in_browser', 'my_mr_detail');
            openExternalUrl(opts.webUrl);
          }
          break;
        case 'y':
          e.preventDefault();
          if (opts.webUrl) {
            trackShortcut('y', 'copy_link', 'my_mr_detail');
            opts.copyToClipboard(opts.webUrl);
          }
          break;
        case 'n':
        case 'j':
        case 'ArrowDown':
          if (opts.activeTab === 'code') {
            e.preventDefault();
            trackShortcut(e.key, 'navigate_file_next', 'my_mr_detail');
            opts.navigateFile(1);
          }
          break;
        case 'p':
        case 'k':
        case 'ArrowUp':
          if (opts.activeTab === 'code') {
            e.preventDefault();
            trackShortcut(e.key, 'navigate_file_prev', 'my_mr_detail');
            opts.navigateFile(-1);
          }
          break;
        case 'ArrowRight':
          if (opts.activeTab === 'code') {
            e.preventDefault();
            trackShortcut('ArrowRight', 'navigate_file_jump_next', 'my_mr_detail');
            opts.navigateFile(opts.fileJumpCount ?? DEFAULT_FILE_JUMP_COUNT);
          }
          break;
        case 'ArrowLeft':
          if (opts.activeTab === 'code') {
            e.preventDefault();
            trackShortcut('ArrowLeft', 'navigate_file_jump_prev', 'my_mr_detail');
            opts.navigateFile(-(opts.fileJumpCount ?? DEFAULT_FILE_JUMP_COUNT));
          }
          break;
        case 'g':
          if (opts.activeTab === 'code') {
            e.preventDefault();
            trackShortcut('g', 'toggle_hide_generated', 'my_mr_detail');
            opts.toggleHideGenerated();
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
