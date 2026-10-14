/**
 * Review screen fixtures for MR 101 ("feat: Add dark mode toggle to settings").
 *
 * Kept apart from the shared seed: `e2e/review.spec.ts` layers these over the
 * base mock (`installReviewMocks`) so the diff shows realistic files, threads
 * on real lines and an image. The failing Jest trace in seed-pipelines.ts
 * points at src/components/ThemeToggle.tsx:18, which exists here.
 */

import type { Page } from '@playwright/test';
import type { Comment, DiffFile } from '../../src/api/types';

const now = Math.floor(Date.now() / 1000);
export const BASE_SHA = 'abc123def456';
export const HEAD_SHA = 'fed654cba321';
/** A head you "reviewed" earlier, for "Since my last review". */
export const REVIEWED_SHA = 'aa11bb22cc33';

const themeToggle = `import { useEffect, useState } from 'react';
import { Switch } from './Switch';
import './ThemeToggle.css';

type Theme = 'light' | 'dark';
const STORAGE_KEY = 'web-app.theme';

function storedTheme(): Theme | null {
  const value = localStorage.getItem(STORAGE_KEY);
  return value === 'light' || value === 'dark' ? value : null;
}

/**
 * The OS preference, used until someone picks a theme.
 */
function systemPrefersDark(): boolean {
  const query = window.matchMedia?.('(prefers-color-scheme: dark)');
  return query.matches;
}

export interface ThemeToggleProps {
  /** Called after the theme changed. */
  onChange?: (theme: Theme) => void;
}

export function ThemeToggle({ onChange }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>(() => storedTheme() ?? (systemPrefersDark() ? 'dark' : 'light'));

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  const toggle = (dark: boolean) => {
    const next: Theme = dark ? 'dark' : 'light';
    localStorage.setItem(STORAGE_KEY, next);
    setTheme(next);
    onChange?.(next);
  };

  return (
    <Switch checked={theme === 'dark'} onChange={toggle} label="Dark mode" />
  );
}

export default ThemeToggle;
`;

/** ThemeToggle.tsx as it was at REVIEWED_SHA. */
const themeToggleReviewed = themeToggle
  .replace("  const query = window.matchMedia?.('(prefers-color-scheme: dark)');\n  return query.matches;", "  return window.matchMedia('(prefers-color-scheme: dark)').matches;")
  .replace('    onChange?.(next);\n', '');

const appBase = `import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Routes } from './Routes';
import { Header } from './components/Header';
import './styles/theme.css';

function App() {
  return (
    <BrowserRouter>
      <div className="app">
        <Header />
        <main className="app__content">
          <Routes />
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
`;

const appHead = `import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { Routes } from './Routes';
import { Header } from './components/Header';
import { ThemeToggle } from './components/ThemeToggle';
import { useAnalytics } from './hooks/useAnalytics';
import './styles/theme.css';

function App() {
  const analytics = useAnalytics();

  return (
    <BrowserRouter>
      <div className="app">
        <Header>
          <ThemeToggle onChange={(theme) => analytics.track('theme_changed', { theme })} />
        </Header>
        <main className="app__content">
          <Routes />
        </main>
      </div>
    </BrowserRouter>
  );
}

export default App;
`;

const cssBase = `:root {
  --color-primary: #333;
  --color-bg: #fff;
  --color-text: #1d1d1f;
  --radius: 6px;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
}

.app__content {
  padding: 24px;
}
`;

const cssHead = `:root {
  --color-primary: #1a1a2e;
  --color-bg: #fafafa;
  --color-text: #1d1d1f;
  --color-accent: #e94560;
  --radius: 6px;
}

[data-theme='dark'] {
  --color-primary: #e6e6eb;
  --color-bg: #16161a;
  --color-text: #f2f2f5;
}

body {
  background: var(--color-bg);
  color: var(--color-text);
  transition: background-color 160ms ease, color 160ms ease;
}

.app__content {
  padding: 24px;
}
`;

const oldTheme = Array.from({ length: 20 }, (_, i) =>
  i === 0 ? '/* Legacy theme — replaced by styles/theme.css */' : `.legacy-${i} { color: #${(0x333333 + i * 0x0a0a0a).toString(16)}; }`,
).join('\n') + '\n';

const toggleTest = `import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeToggle } from './ThemeToggle';

describe('ThemeToggle', () => {
  beforeEach(() => localStorage.clear());

  it('renders a switch with an accessible label', () => {
    render(<ThemeToggle />);
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toBeInTheDocument();
  });

  it('persists the chosen theme to localStorage', async () => {
    render(<ThemeToggle />);
    await userEvent.click(screen.getByRole('switch'));
    expect(localStorage.getItem('web-app.theme')).toBe('dark');
  });

  it('calls onChange with the new theme', async () => {
    const onChange = jest.fn();
    render(<ThemeToggle onChange={onChange} />);
    await userEvent.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith('dark');
  });

  it('follows the system preference when no theme is stored', () => {
    Object.defineProperty(window, 'matchMedia', {
      value: undefined,
      writable: true,
    });
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe('light');
  });
});
`;

const readmeBase = `# Web app

The customer-facing web app.

## Development

    npm install
    npm run dev
`;

const readmeHead = `# Web app

The customer-facing web app.

## Development

    npm install
    npm run dev

## Theming

The theme follows the system preference until someone picks one with the
toggle in the header. The choice is stored in \`localStorage\`.
`;

const lockBase = JSON.stringify({ name: 'web-app', lockfileVersion: 3, packages: { '': { name: 'web-app' } } }, null, 2) + '\n';
const lockHead =
  JSON.stringify(
    {
      name: 'web-app',
      lockfileVersion: 3,
      packages: {
        '': { name: 'web-app' },
        'node_modules/@testing-library/user-event': { version: '14.5.2', dev: true },
      },
    },
    null,
    2,
  ) + '\n';

const moonSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 24 24" fill="none" stroke="#5b5bd6" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 14.5A8 8 0 1 1 9.5 4 6.5 6.5 0 0 0 20 14.5z"/></svg>`;

interface Version {
  base: string | null;
  head: string | null;
  at?: Record<string, string>;
}

export const reviewContents: Record<string, Version> = {
  'src/components/ThemeToggle.tsx': { base: null, head: themeToggle, at: { [REVIEWED_SHA]: themeToggleReviewed } },
  'src/App.tsx': { base: appBase, head: appHead },
  'src/styles/theme.css': { base: cssBase, head: cssHead },
  'src/legacy/OldTheme.css': { base: oldTheme, head: null },
  'src/components/ThemeToggle.test.tsx': { base: null, head: toggleTest },
  'README.md': { base: readmeBase, head: readmeHead },
  'package-lock.json': { base: lockBase, head: lockHead },
  'dist/theme.min.css': { base: null, head: ':root{--color-primary:#1a1a2e}[data-theme=dark]{--color-bg:#16161a}\n' },
};

export const reviewImages: Record<string, { base: string | null; head: string | null }> = {
  'public/icons/moon.svg': { base: null, head: Buffer.from(moonSvg).toString('base64') },
};

const file = (id: number, newPath: string, changeType: DiffFile['changeType'], additions: number, deletions: number, filePosition: number): DiffFile => ({
  id,
  mrId: 101,
  oldPath: changeType === 'added' ? null : newPath,
  newPath,
  changeType,
  additions,
  deletions,
  filePosition,
});

export const reviewFiles: DiffFile[] = [
  file(1001, 'src/components/ThemeToggle.tsx', 'added', 45, 0, 0),
  file(1002, 'src/App.tsx', 'modified', 8, 2, 1),
  file(1003, 'src/styles/theme.css', 'modified', 10, 2, 2),
  file(1004, 'src/legacy/OldTheme.css', 'deleted', 0, 20, 3),
  file(1005, 'src/components/ThemeToggle.test.tsx', 'added', 37, 0, 4),
  file(1006, 'public/icons/moon.svg', 'added', 1, 0, 5),
  file(1007, 'README.md', 'modified', 5, 0, 6),
  file(1008, 'package-lock.json', 'modified', 4, 1, 7),
  file(1009, 'dist/theme.min.css', 'added', 1, 0, 8),
];

const note = (over: Partial<Comment> & Pick<Comment, 'id' | 'body' | 'authorUsername'>): Comment => ({
  mrId: 101,
  discussionId: null,
  parentId: null,
  filePath: null,
  oldLine: null,
  newLine: null,
  resolved: false,
  system: false,
  createdAt: now - 3600,
  updatedAt: now - 3600,
  isLocal: false,
  lineType: null,
  resolvable: true,
  syncStatus: 'synced',
  ...over,
});

/** Extra discussions on lines that exist in the fixtures above. */
export const reviewComments: Comment[] = [
  note({
    id: 5101,
    discussionId: 'disc-app-1',
    authorUsername: 'bob',
    body: 'Should this also fire for the initial system theme? Right now we only track explicit changes, so the dashboard will under-count dark mode.',
    filePath: 'src/App.tsx',
    newLine: 16,
    createdAt: now - 5400,
  }),
  note({
    id: 5102,
    discussionId: 'disc-app-1',
    parentId: 5101,
    authorUsername: 'alice',
    body: 'Only explicit changes — the initial theme is already part of the `page_view` event.',
    filePath: 'src/App.tsx',
    newLine: 16,
    createdAt: now - 4800,
  }),
  note({
    id: 5103,
    discussionId: 'disc-css-1',
    authorUsername: 'carol',
    body: 'Nit: `--color-accent` is not used anywhere yet.',
    filePath: 'src/styles/theme.css',
    newLine: 5,
    resolved: true,
    createdAt: now - 9000,
  }),
];

/**
 * Layer the review fixtures over the base Tauri mock (call after
 * `mockTauriIPC`, which the shared test fixture does automatically).
 */
export async function installReviewMocks(page: Page, options: { settings?: Record<string, unknown> } = {}) {
  await page.addInitScript(
    (payload) => {
      const w = window as unknown as {
        __TAURI_INTERNALS__: { invoke: (cmd: string, args?: Record<string, unknown>) => Promise<unknown> };
      };
      const base = w.__TAURI_INTERNALS__.invoke;
      const { contents, images, files, comments, settings, baseSha, headSha } = payload;
      // The diff layout is a local preference (settings/prefs.ts), not a backend setting.
      const mode = (settings as { diffViewMode?: string } | null)?.diffViewMode;
      if (mode) localStorage.setItem('ug.diffViewMode', mode);
      const extraComments = [...comments];
      w.__TAURI_INTERNALS__.invoke = async (cmd, args = {}) => {
        const mr = (args.mrId as number | undefined) ?? (args.input as { mrId?: number } | undefined)?.mrId;
        switch (cmd) {
          case 'get_diff_files':
            if (mr === 101) return structuredClone(files);
            break;
          case 'get_diff_refs':
            if (mr === 101) return { baseSha, headSha, startSha: baseSha };
            break;
          case 'get_cached_file_pair': {
            const v = contents[args.filePath as string];
            if (mr === 101 && v) return { baseContent: v.base, headContent: v.head };
            break;
          }
          case 'get_file_content': {
            const v = contents[args.filePath as string];
            if (v) {
              const sha = args.sha as string;
              const text = sha === baseSha ? v.base : sha === headSha ? v.head : (v.at?.[sha] ?? null);
              // Like the backend: a file missing at that commit (404) comes back as ''.
              return text ?? '';
            }
            break;
          }
          case 'get_file_content_base64': {
            const v = images[args.filePath as string];
            if (v) return (args.sha === baseSha ? v.base : v.head) ?? '';
            break;
          }
          case 'get_comments':
            if (mr === 101) return [...((await base(cmd, args)) as unknown[]), ...structuredClone(extraComments)];
            break;
          case 'get_mr_reviewers':
            if (mr === 101) {
              const list = (await base(cmd, args)) as { username: string }[];
              return [{ mrId: 101, username: 'testuser', status: 'pending', cachedAt: Date.now() / 1000 }, ...list];
            }
            break;
          case 'get_settings':
            if (settings) return { ...((await base(cmd, args)) as object), ...settings };
            break;
        }
        return base(cmd, args);
      };
    },
    {
      contents: reviewContents,
      images: reviewImages,
      files: reviewFiles,
      comments: reviewComments,
      settings: options.settings ?? null,
      baseSha: BASE_SHA,
      headSha: HEAD_SHA,
    },
  );
}
