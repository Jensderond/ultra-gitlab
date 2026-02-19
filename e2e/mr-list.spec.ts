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
});
