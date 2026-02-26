import { test, expect } from './fixtures/test-base';

test.describe('MR List Page', () => {
  test('displays merge requests from seeded data', async ({ page }) => {
    await page.goto('/mrs');

    // Page header
    await expect(page.locator('h1')).toHaveText('Merge Requests');

    // All 4 seeded MRs should be visible (none are user-approved)
    await expect(page.locator('.mr-list-content')).toBeVisible();
    await expect(page.getByText('feat: Add dark mode toggle to settings')).toBeVisible();
    await expect(page.getByText('fix: Resolve login redirect loop')).toBeVisible();
    await expect(page.getByText('refactor: Extract user service from controller')).toBeVisible();
    await expect(page.getByText('Draft: WIP dashboard redesign')).toBeVisible();
  });

  test('shows MR count in footer', async ({ page }) => {
    await page.goto('/mrs');

    await expect(page.locator('.mr-count')).toHaveText('4 merge requests');
  });

  test('shows project names on MR items', async ({ page }) => {
    await page.goto('/mrs');

    // Project names should be visible in the list
    await expect(page.getByText('web-app').first()).toBeVisible();
  });

  test('shows author usernames', async ({ page }) => {
    await page.goto('/mrs');

    await expect(page.getByText('alice').first()).toBeVisible();
    await expect(page.getByText('bob').first()).toBeVisible();
  });

  test('navigates to MR detail on click', async ({ page }) => {
    await page.goto('/mrs');

    // Click the first MR
    await page.getByText('feat: Add dark mode toggle to settings').click();

    // Should navigate to MR detail page
    await expect(page).toHaveURL(/\/mrs\/101/);
  });

  test('shows keyboard hints in footer', async ({ page }) => {
    await page.goto('/mrs');

    await expect(page.locator('.keyboard-hint')).toBeVisible();
    await expect(page.locator('.keyboard-hint')).toContainText('navigate');
  });

  test('shows refresh button', async ({ page }) => {
    await page.goto('/mrs');

    const refreshButton = page.locator('button[aria-label="Refresh merge requests"]');
    await expect(refreshButton).toBeVisible();
  });

  test('redirects root to /mrs', async ({ page }) => {
    await page.goto('/');

    await expect(page).toHaveURL(/\/mrs/);
    await expect(page.locator('h1')).toHaveText('Merge Requests');
  });

  test.describe('Search keyboard navigation', () => {
    test('Enter opens single search result directly', async ({ page }) => {
      await page.goto('/mrs');
      await expect(page.getByText('feat: Add dark mode toggle to settings')).toBeVisible();

      // Open search with Cmd+F and search for "carol" (unique author → 1 result)
      await page.keyboard.press('Control+f');
      await expect(page.locator('.search-bar')).toBeVisible();

      await page.locator('.search-bar-input').fill('carol');
      await expect(page.locator('.search-bar-count')).toHaveText('1 of 4');

      // Press Enter to open the single result
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/mrs\/103/);
    });

    test('ArrowDown navigates through filtered results', async ({ page }) => {
      await page.goto('/mrs');
      await expect(page.getByText('feat: Add dark mode toggle to settings')).toBeVisible();

      // Open search and filter to "web-app" (matches 3 MRs: 101, 102, 104)
      await page.keyboard.press('Control+f');
      await page.locator('.search-bar-input').fill('web-app');
      await expect(page.locator('.search-bar-count')).toHaveText('3 of 4');

      // First item should already be focused (selected)
      const items = page.locator('.mr-list-item');
      await expect(items).toHaveCount(3);
      await expect(items.nth(0)).toHaveClass(/selected/);

      // Navigate down to second item
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(1)).toHaveClass(/selected/);

      // Navigate down to third item
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(2)).toHaveClass(/selected/);

      // Press Enter to open the third result
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/mrs\/104/);
    });

    test('ArrowUp navigates backwards through results', async ({ page }) => {
      await page.goto('/mrs');
      await expect(page.getByText('feat: Add dark mode toggle to settings')).toBeVisible();

      await page.keyboard.press('Control+f');
      await page.locator('.search-bar-input').fill('web-app');
      await expect(page.locator('.search-bar-count')).toHaveText('3 of 4');

      const items = page.locator('.mr-list-item');

      // Navigate down twice, then up once
      await page.keyboard.press('ArrowDown');
      await page.keyboard.press('ArrowDown');
      await expect(items.nth(2)).toHaveClass(/selected/);

      await page.keyboard.press('ArrowUp');
      await expect(items.nth(1)).toHaveClass(/selected/);

      // Enter opens the second filtered result
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/\/mrs\/102/);
    });

    test('keyboard hints update when search is open', async ({ page }) => {
      await page.goto('/mrs');

      // Default hints show j/k navigation
      const hint = page.locator('.keyboard-hint');
      await expect(hint).toContainText('j');
      await expect(hint).toContainText('k');

      // Open search - hints should change to arrow keys
      await page.keyboard.press('Control+f');
      await expect(hint).toContainText('navigate');
      await expect(hint).toContainText('Esc');
      await expect(hint).toContainText('close search');

      // Close search - hints should revert
      await page.keyboard.press('Escape');
      await expect(hint).toContainText('j');
    });
  });
});
