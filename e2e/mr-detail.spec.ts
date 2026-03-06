import { test, expect } from './fixtures/test-base';

test.describe('MR Detail Page', () => {
  test('displays MR header with title and metadata', async ({ page }) => {
    await page.goto('/mrs/101');

    // MR title
    await expect(page.locator('h1.mr-title')).toHaveText('feat: Add dark mode toggle to settings');

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
    const sidebar = page.locator('.mr-detail-sidebar');
    await expect(sidebar.getByText('ThemeToggle.tsx')).toBeVisible();
    await expect(sidebar.getByText('App.tsx')).toBeVisible();
    await expect(sidebar.getByText('theme.css', { exact: true })).toBeVisible();
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
    await expect(page.locator('h1.mr-title')).toHaveText('feat: Add dark mode toggle to settings');

    // Navigate back
    const backButton = page.locator('a[href="/mrs"], button[title="Back to MRs"]').first();
    await backButton.click();
    await expect(page).toHaveURL(/\/mrs$/);
  });

  test.describe('Arrow key file jumping', () => {
    test('ArrowRight jumps forward by fileJumpCount files', async ({ page }) => {
      await page.goto('/mrs/101');

      const sidebar = page.locator('.mr-detail-sidebar');

      // First file (ThemeToggle.tsx) should be auto-selected
      await expect(sidebar.locator('.file-nav-item.selected')).toContainText('ThemeToggle.tsx');

      // ArrowRight should jump forward by 2 (fileJumpCount=2 in seed), landing on theme.css
      await page.keyboard.press('ArrowRight');
      await expect(sidebar.locator('.file-nav-item.selected')).toContainText('theme.css');
    });

    test('ArrowLeft jumps backward by fileJumpCount files', async ({ page }) => {
      await page.goto('/mrs/101');

      const sidebar = page.locator('.mr-detail-sidebar');
      await expect(sidebar.locator('.file-nav-item.selected')).toContainText('ThemeToggle.tsx');

      // First move to theme.css (index 2) via ArrowRight
      await page.keyboard.press('ArrowRight');
      await expect(sidebar.locator('.file-nav-item.selected')).toContainText('theme.css');

      // ArrowLeft from index 2 should jump back 2, landing on ThemeToggle.tsx (index 0)
      await page.keyboard.press('ArrowLeft');
      await expect(sidebar.locator('.file-nav-item.selected')).toContainText('ThemeToggle.tsx');
    });

    test('ArrowRight clamps to last file when jump exceeds list', async ({ page }) => {
      await page.goto('/mrs/101');

      const sidebar = page.locator('.mr-detail-sidebar');

      // Move to theme.css (index 2) first
      await page.keyboard.press('ArrowRight');
      await expect(sidebar.locator('.file-nav-item.selected')).toContainText('theme.css');

      // ArrowRight again from index 2 with jump=2 would be index 4, but only 4 files (0-3)
      // Should clamp to last file (OldTheme.css at index 3)
      await page.keyboard.press('ArrowRight');
      await expect(sidebar.locator('.file-nav-item.selected')).toContainText('OldTheme.css');
    });

    test('ArrowLeft clamps to first file when jump exceeds list', async ({ page }) => {
      await page.goto('/mrs/101');

      const sidebar = page.locator('.mr-detail-sidebar');
      await expect(sidebar.locator('.file-nav-item.selected')).toContainText('ThemeToggle.tsx');

      // ArrowLeft from index 0 with jump=2 would be index -2
      // Should clamp to first file (ThemeToggle.tsx stays selected)
      await page.keyboard.press('ArrowLeft');
      await expect(sidebar.locator('.file-nav-item.selected')).toContainText('ThemeToggle.tsx');
    });

    test('ArrowDown still moves one file at a time', async ({ page }) => {
      await page.goto('/mrs/101');

      const sidebar = page.locator('.mr-detail-sidebar');
      await expect(sidebar.locator('.file-nav-item.selected')).toContainText('ThemeToggle.tsx');

      // ArrowDown moves by 1, landing on App.tsx
      await page.keyboard.press('ArrowDown');
      await expect(sidebar.locator('.file-nav-item.selected')).toContainText('App.tsx');
    });
  });
});
