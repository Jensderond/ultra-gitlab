import { test, expect } from './fixtures/test-base';

test.describe('Custom MR filter settings', () => {
  test('enable filter, see live match count, save', async ({ page }) => {
    await page.goto('/settings/custom-filter');
    await expect(page.locator('.custom-filter-section')).toBeVisible();

    const card = page.locator('.settings-group-wrap').first();

    // Enable the filter — the debounced count should appear.
    await card.locator('[role="switch"]').click();
    await expect(card.getByText('42 open MRs match this filter')).toBeVisible();

    // Narrow by label and save.
    await card.getByPlaceholder('e.g. magento').fill('magento');
    await card.locator('.custom-filter-save').click();
    await expect(page.locator('.toast-title', { hasText: 'Custom filter saved' })).toBeVisible();
  });

  test('filter fields are disabled until enabled', async ({ page }) => {
    await page.goto('/settings/custom-filter');
    const card = page.locator('.settings-group-wrap').first();
    await expect(card.getByPlaceholder('e.g. renovate-bot')).toBeDisabled();
    await card.locator('[role="switch"]').click();
    await expect(card.getByPlaceholder('e.g. renovate-bot')).toBeEnabled();
  });
});
