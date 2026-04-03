import { test, expect } from './fixtures/test-base';

test.describe('Shortcut Editor', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/settings');
    // Open the "Keyboard Shortcuts" collapsible section
    await page.locator('.collapsible-title', { hasText: 'Keyboard Shortcuts' }).click();
    // Wait for shortcuts to load
    await expect(page.locator('.shortcuts-editor')).toBeVisible();
  });

  test('can record a new shortcut binding', async ({ page }) => {
    // Find the "Approve MR" shortcut (default key: "a") and click it to edit
    const approveItem = page.locator('.shortcut-editor-item', {
      has: page.locator('.shortcut-description', { hasText: 'Approve MR' }),
    });
    await expect(approveItem).toBeVisible();

    // Click the key display to start editing
    await approveItem.locator('.shortcut-key-display').click();

    // Should show the recording input
    const input = approveItem.locator('.shortcut-input');
    await expect(input).toBeVisible();

    // Press a new key to record it
    await page.keyboard.press('b');

    // The input should disappear (recording complete, saved)
    // and the key display should now show the new binding
    await expect(input).not.toBeVisible({ timeout: 3000 });
    const keyDisplay = approveItem.locator('.shortcut-key-display');
    await expect(keyDisplay).toBeVisible();
    await expect(keyDisplay).toHaveClass(/custom/);
  });

  test('can cancel recording with Escape', async ({ page }) => {
    const approveItem = page.locator('.shortcut-editor-item', {
      has: page.locator('.shortcut-description', { hasText: 'Approve MR' }),
    });

    // Click to start editing
    await approveItem.locator('.shortcut-key-display').click();
    const input = approveItem.locator('.shortcut-input');
    await expect(input).toBeVisible();

    // Press Escape to cancel
    await page.keyboard.press('Escape');

    // Should return to display mode with original key
    await expect(input).not.toBeVisible({ timeout: 3000 });
    await expect(approveItem.locator('.shortcut-key-display')).toBeVisible();
  });
});
