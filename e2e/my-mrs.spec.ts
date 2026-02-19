import { test, expect } from './fixtures/test-base';

test.describe('My MRs Page', () => {
  test('displays authored merge requests', async ({ page }) => {
    await page.goto('/my-mrs');

    // Page header
    await expect(page.locator('h1')).toHaveText('My Merge Requests');

    // Should show the 2 seeded "my" MRs
    await expect(page.getByText('feat: Add notification preferences')).toBeVisible();
    await expect(page.getByText('Draft: Experiment with new list virtualization')).toBeVisible();
  });

  test('shows MR count', async ({ page }) => {
    await page.goto('/my-mrs');

    await expect(page.locator('.mr-count')).toHaveText('2 merge requests');
  });

  test('shows approval badge for MRs with approvals', async ({ page }) => {
    await page.goto('/my-mrs');

    // The first my-MR has 2/2 approvals
    await expect(page.locator('.my-mr-approval-badge').first()).toHaveText('2/2');
  });

  test('navigates to My MR detail on click', async ({ page }) => {
    await page.goto('/my-mrs');

    await page.getByText('feat: Add notification preferences').click();

    await expect(page).toHaveURL(/\/my-mrs\/201/);
  });

  test('shows keyboard navigation hints', async ({ page }) => {
    await page.goto('/my-mrs');

    await expect(page.locator('.keyboard-hint')).toBeVisible();
    await expect(page.locator('.keyboard-hint')).toContainText('navigate');
  });
});
