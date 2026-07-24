# Pipelines Mobile Search FAB Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On mobile, replace the Pipelines page's persistent inline search bar with a bottom-right floating button that opens a full-screen search overlay; desktop is unchanged.

**Architecture:** `ProjectSearch` keeps all its existing search state/logic and forks only its returned JSX on `useSmallScreen()`. Desktop renders the current inline bar + dropdown. Mobile renders a circular FAB that toggles an `overlayOpen` state; when open, a fixed full-screen overlay shows an auto-focused input and the results list. Styling lives in the existing `@media (max-width: 767px)` block of `PipelinesPage.css`, reusing the current result-row classes.

**Tech Stack:** React 19 + TypeScript, `@phosphor-icons/react`, Playwright e2e (Tauri IPC mocked), Bun.

## Global Constraints

- Mobile is viewport width < 768px, determined via the existing `useSmallScreen` hook (`src/hooks/useSmallScreen.ts`); the CSS breakpoint is `max-width: 767px`. This is a viewport-width distinction, **not** a runtime `isIOS` check.
- Desktop rendering and behavior (`/`-to-focus shortcut, dropdown, click-outside-to-close) must remain byte-for-byte unchanged.
- No changes to `usePipelinesData`, `PipelinesPage/index.tsx`, or the `searchProjects` service — this is presentation-only.
- Reuse existing CSS classes `.pipelines-search-input-wrapper`, `.pipelines-search-input`, `.pipelines-search-spinner`, `.pipelines-search-result`, `.pipelines-search-result-name`, `.pipelines-search-result-path`, `.pipelines-search-empty` for the overlay; add only FAB/overlay-chrome classes.
- All React hooks must run unconditionally before the `isSmallScreen` branch returns (no conditional hook calls).
- Package manager is `bun`. Typecheck with `bunx tsc --noEmit`, lint with `bun run lint`, e2e with `bun run test:e2e`.

---

### Task 1: Mobile search FAB + full-screen overlay

**Files:**
- Modify: `e2e/fixtures/seed-data.ts` (add a `projectSearchResults` export)
- Modify: `e2e/fixtures/tauri-mock.ts` (make `search_projects` return query-filtered results; add the new seed field to the injected payload)
- Create: `e2e/pipelines-mobile-search.spec.ts`
- Modify: `src/pages/PipelinesPage/ProjectSearch.tsx`
- Modify: `src/pages/PipelinesPage.css`

**Interfaces:**
- Consumes: `useSmallScreen()` from `src/hooks/useSmallScreen.ts` → `boolean`; `searchProjects(instanceId: number, query: string)` (unchanged, invoked via the existing debounce effect); `ProjectSearchResult` from `src/types` (`{ id: number; name: string; nameWithNamespace: string; pathWithNamespace: string; webUrl: string }`).
- Produces: no new exports. `ProjectSearch`'s public props are unchanged (`{ selectedInstanceId: number | null; onSelectResult: (result: ProjectSearchResult) => void }`).

---

- [ ] **Step 1: Add a seeded project-search result to the e2e fixtures**

The mock currently returns `[]` for `search_projects`, so the overlay's result/select flow can't be exercised. Add one deterministic result.

In `e2e/fixtures/seed-data.ts`, add `ProjectSearchResult` to the existing type import block (the `import type { … } from '../../src/types';` at the top, ending at line 25):

```typescript
  NotificationSettings,
  IssueWithProject,
  ProjectSearchResult,
} from '../../src/types';
```

Then add this export immediately after the `pipelineProjects` array (after its closing `];` around line 594):

```typescript
/** Results returned by `search_projects` in tests (filtered by query substring in the mock). */
export const projectSearchResults: ProjectSearchResult[] = [
  {
    id: 20,
    name: 'design-system',
    nameWithNamespace: 'frontend / design-system',
    pathWithNamespace: 'frontend/design-system',
    webUrl: 'https://gitlab.example.com/frontend/design-system',
  },
];
```

- [ ] **Step 2: Wire the mock to return filtered results**

In `e2e/fixtures/tauri-mock.ts`, add the new field to the injected `seedJSON` object (the block starting at line 29). Add this line next to `pipelineProjects: seed.pipelineProjects,`:

```typescript
    projectSearchResults: seed.projectSearchResults,
```

Then replace the `search_projects` handler (currently line 351, `search_projects: () => [],`) with a query-filtering version matching real backend semantics:

```typescript
      search_projects: (args) => {
        const query = String(args?.query ?? '').toLowerCase().trim();
        if (!query) return [];
        return data.projectSearchResults.filter(
          (p: { nameWithNamespace: string; pathWithNamespace: string }) =>
            p.nameWithNamespace.toLowerCase().includes(query) ||
            p.pathWithNamespace.toLowerCase().includes(query),
        );
      },
```

(No existing test asserts on `search_projects` output, so returning matches instead of `[]` is safe.)

- [ ] **Step 3: Write the failing e2e spec**

Create `e2e/pipelines-mobile-search.spec.ts`:

```typescript
import { test, expect } from './fixtures/test-base';

/**
 * Pipelines search chrome differs by viewport.
 *
 * Desktop keeps the persistent inline search bar. Mobile (< 768px) hides it
 * behind a bottom-right floating button that opens a full-screen overlay with
 * an auto-focused input; selecting a result or tapping close dismisses it.
 */

const FAB = '.pipelines-search-fab';
const OVERLAY = '.pipelines-search-overlay';
const OVERLAY_INPUT = `${OVERLAY} .pipelines-search-input`;
const INLINE_INPUT = '.pipelines-search-container .pipelines-search-input';

test.describe('Desktop keeps the inline search bar', () => {
  test('inline input is present and no floating button renders', async ({ page }) => {
    await page.goto('/pipelines');
    await expect(page.locator('.pipeline-card').first()).toBeVisible();

    await expect(page.locator(INLINE_INPUT)).toBeVisible();
    await expect(page.locator(FAB)).not.toBeAttached();
  });
});

test.describe('Mobile floating search button + overlay', () => {
  test.use({ viewport: { width: 390, height: 664 } });

  test.beforeEach(async ({ page }) => {
    await page.goto('/pipelines');
    await expect(page.locator('.pipeline-card').first()).toBeVisible();
  });

  test('shows the floating button and hides the inline bar', async ({ page }) => {
    await expect(page.locator(FAB)).toBeVisible();
    await expect(page.locator(INLINE_INPUT)).not.toBeAttached();
  });

  test('tapping the button opens the overlay with the input focused', async ({ page }) => {
    await page.locator(FAB).click();
    await expect(page.locator(OVERLAY)).toBeVisible();
    await expect(page.locator(OVERLAY_INPUT)).toBeFocused();
  });

  test('typing shows results and selecting one closes the overlay', async ({ page }) => {
    await page.locator(FAB).click();
    await page.locator(OVERLAY_INPUT).fill('design');

    const result = page.locator(`${OVERLAY} .pipelines-search-result`).first();
    await expect(result).toBeVisible();
    await expect(result).toContainText('design-system');

    await result.click();
    await expect(page.locator(OVERLAY)).not.toBeAttached();
    await expect(page.locator(FAB)).toBeVisible();
  });

  test('the close button dismisses the overlay', async ({ page }) => {
    await page.locator(FAB).click();
    await expect(page.locator(OVERLAY)).toBeVisible();

    await page.locator('button[aria-label="Close search"]').click();
    await expect(page.locator(OVERLAY)).not.toBeAttached();
    await expect(page.locator(FAB)).toBeVisible();
  });
});
```

- [ ] **Step 4: Run the spec and confirm it fails**

Run: `bun run test:e2e -- pipelines-mobile-search`
Expected: FAIL — the mobile tests can't find `.pipelines-search-fab` (not implemented yet); the desktop test passes.

- [ ] **Step 5: Implement the FAB + overlay in `ProjectSearch.tsx`**

Rewrite `src/pages/PipelinesPage/ProjectSearch.tsx`. The imports, all state/refs, the three existing effects (debounced search, `/` shortcut, click-outside), `handleSelectResult`, and the desktop `return` are unchanged except: add `useSmallScreen`, add the `X`/`MagnifyingGlass` phosphor imports, add `overlayOpen` state + `overlayInputRef`, add an auto-focus effect, add `closeOverlay`, extend `handleSelectResult` to also close the overlay, and add the mobile branch before the desktop return.

```tsx
import { useState, useEffect, useRef, useCallback } from 'react';
import { MagnifyingGlass, X } from '@phosphor-icons/react';
import { searchProjects } from '../../services/tauri';
import { useSmallScreen } from '../../hooks/useSmallScreen';
import type { ProjectSearchResult } from '../../types';
import { SearchIcon } from './icons';

interface ProjectSearchProps {
  selectedInstanceId: number | null;
  onSelectResult: (result: ProjectSearchResult) => void;
}

export default function ProjectSearch({ selectedInstanceId, onSelectResult }: ProjectSearchProps) {
  const isSmallScreen = useSmallScreen();
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<ProjectSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const overlayInputRef = useRef<HTMLInputElement>(null);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Debounced search
  useEffect(() => {
    if (!searchQuery.trim() || !selectedInstanceId) {
      setSearchResults([]);
      setSearchLoading(false);
      return;
    }

    setSearchLoading(true);

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        const results = await searchProjects(selectedInstanceId, searchQuery.trim());
        setSearchResults(results);
      } catch (error) {
        console.error('Search failed:', error);
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, selectedInstanceId]);

  // `/` keyboard shortcut to focus search (desktop; inline input only)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.key === '/' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        document.activeElement?.tagName !== 'INPUT' &&
        document.activeElement?.tagName !== 'TEXTAREA'
      ) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Click outside to close search dropdown (desktop)
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(e.target as Node)
      ) {
        setSearchOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Auto-focus the overlay input when it opens (mobile)
  useEffect(() => {
    if (overlayOpen) overlayInputRef.current?.focus();
  }, [overlayOpen]);

  const handleSelectResult = useCallback(
    (result: ProjectSearchResult) => {
      setSearchQuery('');
      setSearchResults([]);
      setSearchOpen(false);
      setOverlayOpen(false);
      onSelectResult(result);
    },
    [onSelectResult]
  );

  const closeOverlay = useCallback(() => {
    setSearchQuery('');
    setSearchResults([]);
    setOverlayOpen(false);
  }, []);

  if (isSmallScreen) {
    return (
      <>
        <button
          type="button"
          className="pipelines-search-fab"
          aria-label="Search projects"
          onClick={() => setOverlayOpen(true)}
        >
          <MagnifyingGlass size={24} weight="bold" />
        </button>
        {overlayOpen && (
          <div className="pipelines-search-overlay">
            <div className="pipelines-search-overlay-header">
              <div className="pipelines-search-input-wrapper">
                <SearchIcon />
                <input
                  ref={overlayInputRef}
                  type="text"
                  className="pipelines-search-input"
                  placeholder="Search projects to add..."
                  spellCheck={false}
                  autoCorrect="off"
                  autoCapitalize="off"
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') closeOverlay();
                  }}
                />
                {searchLoading && <span className="pipelines-search-spinner" />}
              </div>
              <button
                type="button"
                className="pipelines-search-overlay-close"
                aria-label="Close search"
                onClick={closeOverlay}
              >
                <X size={20} weight="bold" />
              </button>
            </div>
            <div className="pipelines-search-overlay-results">
              {searchQuery.trim() &&
                (searchResults.length > 0 ? (
                  searchResults.map((result) => (
                    <button
                      key={result.id}
                      className="pipelines-search-result"
                      onClick={() => handleSelectResult(result)}
                    >
                      <span className="pipelines-search-result-name">
                        {result.nameWithNamespace}
                      </span>
                      <span className="pipelines-search-result-path">
                        {result.pathWithNamespace}
                      </span>
                    </button>
                  ))
                ) : searchLoading ? (
                  <div className="pipelines-search-empty">Searching...</div>
                ) : (
                  <div className="pipelines-search-empty">No projects found</div>
                ))}
            </div>
          </div>
        )}
      </>
    );
  }

  return (
    <div className="pipelines-search-container" ref={searchContainerRef}>
      <div className="pipelines-search-input-wrapper">
        <SearchIcon />
        <input
          ref={searchInputRef}
          type="text"
          className="pipelines-search-input"
          placeholder="Search projects to add..."
          spellCheck={false}
          autoCorrect="off"
          autoCapitalize="off"
          autoComplete="off"
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value);
            setSearchOpen(true);
          }}
          onFocus={() => {
            if (searchQuery.trim()) setSearchOpen(true);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setSearchQuery('');
              setSearchResults([]);
              setSearchOpen(false);
              searchInputRef.current?.blur();
            }
          }}
        />
        {searchLoading && <span className="pipelines-search-spinner" />}
        {!searchQuery && (
          <kbd className="pipelines-search-hint">/</kbd>
        )}
      </div>
      {searchOpen && searchQuery.trim() && (
        <div className="pipelines-search-dropdown">
          {searchResults.length > 0 ? (
            searchResults.map((result) => (
              <button
                key={result.id}
                className="pipelines-search-result"
                onClick={() => handleSelectResult(result)}
              >
                <span className="pipelines-search-result-name">
                  {result.nameWithNamespace}
                </span>
                <span className="pipelines-search-result-path">
                  {result.pathWithNamespace}
                </span>
              </button>
            ))
          ) : searchLoading ? (
            <div className="pipelines-search-empty">Searching...</div>
          ) : (
            <div className="pipelines-search-empty">No projects found</div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Add the FAB + overlay styles**

In `src/pages/PipelinesPage.css`, inside the existing `@media (max-width: 767px)` block (the block that opens at line 533 with `@media (max-width: 767px) {`), add the following rules just after the opening brace, before the existing `.pipelines-freshness { display: none; }` rule:

```css
  /* Mobile: the inline bar is replaced by a floating button that opens a
     full-screen overlay, so the page needs a positioning context for it. */
  .pipelines-page {
    position: relative;
  }

  .pipelines-search-fab {
    position: absolute;
    right: 16px;
    bottom: 16px;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 52px;
    height: 52px;
    padding: 0;
    border: 1px solid var(--border-color);
    border-radius: 50%;
    background: var(--bg-secondary);
    color: var(--text-secondary);
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
    cursor: pointer;
  }

  .pipelines-search-fab:active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .pipelines-search-overlay {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: flex;
    flex-direction: column;
    background: var(--bg-primary);
    padding-top: env(safe-area-inset-top, 0px);
    animation: pipelinesSearchOverlayIn 0.15s ease-out;
  }

  @keyframes pipelinesSearchOverlayIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  .pipelines-search-overlay-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border-color);
  }

  .pipelines-search-overlay-header .pipelines-search-input-wrapper {
    flex: 1;
    min-width: 0;
  }

  .pipelines-search-overlay-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    padding: 0;
    border: none;
    background: none;
    box-shadow: none;
    border-radius: 8px;
    color: var(--text-secondary);
    cursor: pointer;
  }

  .pipelines-search-overlay-close:active {
    background: var(--bg-tertiary);
    color: var(--text-primary);
  }

  .pipelines-search-overlay-results {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 0;
  }
```

(The pre-existing mobile rules for `.pipelines-search-container` / `.pipelines-search-dropdown` padding become dead on mobile since those elements no longer render there, but they are harmless and left untouched.)

- [ ] **Step 7: Run the e2e spec and confirm it passes**

Run: `bun run test:e2e -- pipelines-mobile-search`
Expected: PASS — all five tests (1 desktop + 4 mobile) green.

- [ ] **Step 8: Typecheck and lint**

Run: `bunx tsc --noEmit && bun run lint`
Expected: no errors (pre-existing `react-refresh/only-export-components` warnings elsewhere are unrelated and acceptable).

- [ ] **Step 9: Commit**

```bash
git add src/pages/PipelinesPage/ProjectSearch.tsx src/pages/PipelinesPage.css \
  e2e/pipelines-mobile-search.spec.ts e2e/fixtures/seed-data.ts e2e/fixtures/tauri-mock.ts
git commit -m "feat(pipelines): floating search button + overlay on mobile"
```

---

## Self-Review

**Spec coverage:**
- FAB replaces inline bar on mobile → Step 5 (mobile branch), Step 6 (`.pipelines-search-fab`), Steps for tests 2. ✓
- Full-screen overlay, `z-index: 1000` like CommandPalette, safe-area top padding → Step 6 (`.pipelines-search-overlay`). ✓
- Auto-focus input on open → Step 5 (auto-focus effect), e2e test 3. ✓
- Select result adds project + closes overlay → Step 5 (`handleSelectResult` calls `onSelectResult` + `setOverlayOpen(false)`), e2e test "typing…selecting". ✓
- ✕ and Escape close + clear → Step 5 (`closeOverlay`, `onKeyDown` Escape), e2e close test. ✓
- Desktop unchanged → desktop `return` copied verbatim, e2e desktop test asserts inline input present + no FAB. ✓
- Reuse existing result-row / input-wrapper classes → Step 5 markup + Step 6 note. ✓
- Mobile = <768px via `useSmallScreen`, not `isIOS` → Step 5 uses `useSmallScreen`, Global Constraints. ✓

**Placeholder scan:** No TBD/TODO; all code blocks complete; no "similar to" references. ✓

**Type consistency:** `ProjectSearchResult` shape matches `src/types` and is used identically in both branches; `useSmallScreen(): boolean`; `handleSelectResult(result: ProjectSearchResult)`; mock filter reads `args.query` matching `searchProjects(instanceId, query)` → `invoke('search_projects', { instanceId, query })`. ✓

**Hooks safety:** All `useState`/`useEffect`/`useCallback`/`useRef` calls precede the `if (isSmallScreen)` return; no conditional hooks. ✓
