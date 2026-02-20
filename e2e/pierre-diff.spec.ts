import { test, expect } from './fixtures/test-base';
import type { ConsoleMessage } from '@playwright/test';

/**
 * Pierre diff viewer E2E tests.
 *
 * Verifies that Pierre-based diff rendering works correctly:
 * - Shadow DOM host element renders
 * - Diff content is visible inside shadow DOM
 * - No console errors or Pierre/Shiki/worker warnings
 * - View mode switching (split/unified)
 * - File switching
 * - New files (additions only) and deleted files (deletions only)
 */

/** Collect console messages from the page. */
function collectConsole(page: import('@playwright/test').Page) {
  const messages: ConsoleMessage[] = [];
  page.on('console', (msg) => messages.push(msg));
  return messages;
}

test.describe('Pierre Diff Viewer', () => {
  test('renders diff component with shadow DOM for selected file', async ({ page }) => {
    const consoleMessages = collectConsole(page);

    await page.goto('/mrs/101');

    // Wait for the Pierre diff container (custom element with shadow DOM)
    const diffContainer = page.locator('diffs-container');
    await expect(diffContainer).toBeVisible({ timeout: 15_000 });

    // Verify no console errors during rendering
    const errors = consoleMessages.filter((m) => m.type() === 'error');
    expect(errors).toHaveLength(0);
  });

  test('displays diff content inside shadow DOM', async ({ page }) => {
    await page.goto('/mrs/101');

    // Wait for the Pierre container to render
    const diffContainer = page.locator('diffs-container');
    await expect(diffContainer).toBeVisible({ timeout: 15_000 });

    // Check that actual code content is rendered inside the shadow DOM
    const hasContent = await diffContainer.evaluate((el) => {
      const shadow = el.shadowRoot;
      if (!shadow) return false;
      // Pierre renders code lines — check for any text content inside
      const textContent = shadow.textContent || '';
      return textContent.length > 0;
    });

    expect(hasContent).toBe(true);
  });

  test('emits no console errors during diff rendering', async ({ page }) => {
    const consoleMessages = collectConsole(page);

    await page.goto('/mrs/101');

    // Wait for diff to fully render
    const diffContainer = page.locator('diffs-container');
    await expect(diffContainer).toBeVisible({ timeout: 15_000 });

    // Allow a brief settle time for any async operations
    await page.waitForTimeout(1000);

    const errors = consoleMessages.filter((m) => m.type() === 'error');
    if (errors.length > 0) {
      const errorTexts = errors.map((m) => m.text());
      expect(errorTexts, `Unexpected console errors: ${errorTexts.join(', ')}`).toHaveLength(0);
    }
  });

  test('emits no Pierre/Shiki/worker-related warnings', async ({ page }) => {
    const consoleMessages = collectConsole(page);

    await page.goto('/mrs/101');

    const diffContainer = page.locator('diffs-container');
    await expect(diffContainer).toBeVisible({ timeout: 15_000 });

    await page.waitForTimeout(1000);

    const relevantWarnings = consoleMessages
      .filter((m) => m.type() === 'warning')
      .filter((m) => {
        const text = m.text().toLowerCase();
        return text.includes('pierre') || text.includes('shiki') || text.includes('worker');
      });

    if (relevantWarnings.length > 0) {
      const warningTexts = relevantWarnings.map((m) => m.text());
      expect(warningTexts, `Unexpected warnings: ${warningTexts.join(', ')}`).toHaveLength(0);
    }
  });

  test('switches between split and unified view modes without errors', async ({ page }) => {
    const consoleMessages = collectConsole(page);

    await page.goto('/mrs/101');

    const diffContainer = page.locator('diffs-container');
    await expect(diffContainer).toBeVisible({ timeout: 15_000 });

    // Toggle view mode via keyboard shortcut ('v' toggles view mode)
    await page.keyboard.press('v');

    // Wait for re-render — the diff container should still be visible
    await expect(diffContainer).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(500);

    // Toggle back
    await page.keyboard.press('v');
    await expect(diffContainer).toBeVisible({ timeout: 5_000 });
    await page.waitForTimeout(500);

    // Verify no errors during the transitions
    const errors = consoleMessages.filter((m) => m.type() === 'error');
    expect(errors).toHaveLength(0);
  });

  test('switches to a different file and renders without errors', async ({ page }) => {
    const consoleMessages = collectConsole(page);

    await page.goto('/mrs/101');

    // Wait for initial diff to render
    const diffContainer = page.locator('diffs-container');
    await expect(diffContainer).toBeVisible({ timeout: 15_000 });

    // Click on the App.tsx file in the file list (it's a modified file)
    await page.getByText('App.tsx').click();

    // The diff should re-render for the new file
    await expect(diffContainer).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1000);

    // Verify no errors after file switch
    const errors = consoleMessages.filter((m) => m.type() === 'error');
    expect(errors).toHaveLength(0);
  });

  test('renders new files (additions only) without errors', async ({ page }) => {
    const consoleMessages = collectConsole(page);

    await page.goto('/mrs/101');

    // ThemeToggle.tsx is a new file (changeType: 'added')
    await page.locator('.mr-detail-sidebar').getByText('ThemeToggle.tsx').click();

    const diffContainer = page.locator('diffs-container');
    await expect(diffContainer).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);

    // For a new file, the diff should show only additions (green lines)
    const hasContent = await diffContainer.evaluate((el) => {
      const shadow = el.shadowRoot;
      if (!shadow) return false;
      return (shadow.textContent || '').length > 0;
    });
    expect(hasContent).toBe(true);

    const errors = consoleMessages.filter((m) => m.type() === 'error');
    expect(errors).toHaveLength(0);
  });

  test('renders deleted files (deletions only) without errors', async ({ page }) => {
    const consoleMessages = collectConsole(page);

    await page.goto('/mrs/101');

    // OldTheme.css is a deleted file (changeType: 'deleted')
    await page.getByText('OldTheme.css').click();

    const diffContainer = page.locator('diffs-container');
    await expect(diffContainer).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(1000);

    // For a deleted file, the diff should show only deletions (red lines)
    const hasContent = await diffContainer.evaluate((el) => {
      const shadow = el.shadowRoot;
      if (!shadow) return false;
      return (shadow.textContent || '').length > 0;
    });
    expect(hasContent).toBe(true);

    const errors = consoleMessages.filter((m) => m.type() === 'error');
    expect(errors).toHaveLength(0);
  });
});
