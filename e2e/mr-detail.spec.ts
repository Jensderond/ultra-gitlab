import { test, expect } from './fixtures/test-base';

test.describe('MR Detail Page', () => {
  test('displays MR header with title and metadata', async ({ page }) => {
    await page.goto('/mrs/101');

    // MR title
    await expect(page.locator('.mr-title')).toHaveText('feat: Add dark mode toggle to settings');

    // MR IID
    await expect(page.locator('.mr-iid')).toHaveText('!42');

    // Author
    await expect(page.locator('.mr-author')).toHaveText('alice');

    // Branch info
    await expect(page.locator('.mr-branches')).toContainText('feature/dark-mode');
    await expect(page.locator('.mr-branches')).toContainText('main');
  });

  test('displays project name in header', async ({ page }) => {
    await page.goto('/mrs/101');

    await expect(page.locator('.mr-project')).toBeVisible();
  });

  test('shows diff file list', async ({ page }) => {
    await page.goto('/mrs/101');

    // The file panel should show the seeded diff files
    await expect(page.getByText('ThemeToggle.tsx')).toBeVisible();
    await expect(page.getByText('App.tsx')).toBeVisible();
    await expect(page.getByText('theme.css')).toBeVisible();
  });

  test('shows back button that navigates to MR list', async ({ page }) => {
    await page.goto('/mrs/101');

    // Find and click the back button
    const backButton = page.locator('a[href="/mrs"], button[title="Back to MRs"]').first();
    await expect(backButton).toBeVisible();
  });

  test('shows approval button', async ({ page }) => {
    await page.goto('/mrs/101');

    // The approval button should be present
    const approvalSection = page.locator('.mr-detail-actions');
    await expect(approvalSection).toBeVisible();
  });

  test('navigates between MR list and detail', async ({ page }) => {
    // Start on list
    await page.goto('/mrs');
    await expect(page.locator('h1')).toHaveText('Merge Requests');

    // Navigate to detail
    await page.getByText('feat: Add dark mode toggle to settings').click();
    await expect(page).toHaveURL(/\/mrs\/101/);
    await expect(page.locator('.mr-title')).toHaveText('feat: Add dark mode toggle to settings');

    // Navigate back
    const backButton = page.locator('a[href="/mrs"], button[title="Back to MRs"]').first();
    await backButton.click();
    await expect(page).toHaveURL(/\/mrs$/);
  });
});
