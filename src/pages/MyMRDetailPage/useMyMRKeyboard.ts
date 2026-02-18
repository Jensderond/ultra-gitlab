/**
 * Keyboard shortcuts for MyMRDetailPage.
 */

import { useEffect, useRef } from 'react';
import { openExternalUrl } from '../../services/transport';

type TabId = 'overview' | 'comments' | 'code';

interface KeyboardOptions {
  goBack: () => void;
  setActiveTab: (tab: TabId) => void;
  activeTab: TabId;
  webUrl: string | undefined;
  copyToClipboard: (text: string) => void;
  navigateFile: (direction: 1 | -1) => void;
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
            opts.goBack();
          }
          break;
        case '1':
        case '2':
        case '3': {
          e.preventDefault();
          const tabs: TabId[] = ['overview', 'comments', 'code'];
          opts.setActiveTab(tabs[parseInt(e.key, 10) - 1]);
          break;
        }
        case 'o':
          e.preventDefault();
          if (opts.webUrl) openExternalUrl(opts.webUrl);
          break;
        case 'y':
          e.preventDefault();
          if (opts.webUrl) opts.copyToClipboard(opts.webUrl);
          break;
        case 'n':
        case 'j':
        case 'ArrowDown':
          if (opts.activeTab === 'code') {
            e.preventDefault();
            opts.navigateFile(1);
          }
          break;
        case 'p':
        case 'k':
        case 'ArrowUp':
          if (opts.activeTab === 'code') {
            e.preventDefault();
            opts.navigateFile(-1);
          }
          break;
        case 'g':
          if (opts.activeTab === 'code') {
            e.preventDefault();
            opts.toggleHideGenerated();
          }
          break;
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
}
