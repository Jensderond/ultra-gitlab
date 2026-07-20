import { test, expect } from './fixtures/test-base';

test.describe('Navigation & Sidebar', () => {
  test('sidebar shows all navigation items in desktop mode', async ({ page }) => {
    await page.goto('/mrs');

    const sidebar = page.locator('.app-sidebar');
    await expect(sidebar).toBeVisible();

    // All 4 nav items should be present (Tauri mode)
    await expect(sidebar.locator('button[title="Reviews"]')).toBeVisible();
    await expect(sidebar.locator('button[title="My MRs"]')).toBeVisible();
    await expect(sidebar.locator('button[title="Pipelines"]')).toBeVisible();
    await expect(sidebar.locator('button[title="Settings"]')).toBeVisible();
  });

  test('sidebar highlights active route', async ({ page }) => {
    await page.goto('/mrs');

    // Reviews button should have active class
    const reviewsButton = page.locator('button[title="Reviews"]');
    await expect(reviewsButton).toHaveClass(/active/);

    // My MRs button should NOT have active class
    const myMrsButton = page.locator('button[title="My MRs"]');
    await expect(myMrsButton).not.toHaveClass(/active/);
  });

  test('clicking sidebar navigates between pages', async ({ page }) => {
    await page.goto('/mrs');

    // Navigate to My MRs
    await page.locator('button[title="My MRs"]').click();
    await expect(page).toHaveURL(/\/my-mrs/);
    await expect(page.locator('h1')).toHaveText('My Merge Requests');

    // Navigate to Pipelines
    await page.locator('button[title="Pipelines"]').click();
    await expect(page).toHaveURL(/\/pipelines/);

    // Navigate back to Reviews
    await page.locator('button[title="Reviews"]').click();
    await expect(page).toHaveURL(/\/mrs/);
    await expect(page.locator('h1')).toHaveText('Merge Requests');
  });

  test('sidebar updates active state on navigation', async ({ page }) => {
    await page.goto('/mrs');

    // Navigate to My MRs via sidebar
    await page.locator('button[title="My MRs"]').click();

    // My MRs should now be active
    await expect(page.locator('button[title="My MRs"]')).toHaveClass(/active/);
    await expect(page.locator('button[title="Reviews"]')).not.toHaveClass(/active/);
  });

  test('keyboard shortcut Mod+L navigates to MR list', async ({ page }) => {
    await page.goto('/my-mrs');

    await page.keyboard.press('ControlOrMeta+l');

    await expect(page).toHaveURL(/\/mrs/);
  });

  test('keyboard shortcut Mod+M navigates to My MRs', async ({ page }) => {
    await page.goto('/mrs');

    await page.keyboard.press('ControlOrMeta+m');

    await expect(page).toHaveURL(/\/my-mrs/);
  });

  test('keyboard shortcut ? opens keyboard help', async ({ page }) => {
    await page.goto('/mrs');

    await page.keyboard.press('Shift+/');

    // Keyboard help modal should be visible
    await expect(page.locator('.keyboard-help-modal')).toBeVisible();
  });

  test('titlebar drag region is present in desktop mode', async ({ page }) => {
    await page.goto('/mrs');

    // In browser mode the drag region exists but is hidden (only visible in Tauri window)
    await expect(page.locator('.titlebar-drag-region')).toBeAttached();
  });

});

test.describe('Instance switch shortcut (Cmd+Shift+digit)', () => {
  test('Cmd+Shift+1 dispatches instance-switch; plain Cmd+1 does not', async ({ page }) => {
    await page.goto('/mrs');

    await page.evaluate(() => {
      (window as unknown as { __instanceSwitchIndexes: number[] }).__instanceSwitchIndexes = [];
      window.addEventListener('instance-switch', (e) => {
        (window as unknown as { __instanceSwitchIndexes: number[] }).__instanceSwitchIndexes.push(
          (e as CustomEvent<{ index: number }>).detail.index
        );
      });
    });

    await page.keyboard.press('ControlOrMeta+Shift+Digit1');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __instanceSwitchIndexes: number[] }).__instanceSwitchIndexes))
      .toEqual([0]);

    await page.keyboard.press('ControlOrMeta+Digit2');
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __instanceSwitchIndexes: number[] }).__instanceSwitchIndexes))
      .toEqual([0]);
  });
});

test.describe('Cmd-hold sidebar number hints', () => {
  test('holding Cmd shows numbered badges on top nav items only, hidden on release', async ({ page }) => {
    await page.goto('/mrs');

    const badges = page.locator('.app-sidebar-number-hint');
    await expect(badges).toHaveCount(0);

    await page.keyboard.down('ControlOrMeta');
    await expect(badges).toHaveCount(4);
    await expect(badges).toHaveText(['1', '2', '3', '4']);
    await expect(page.locator('button[title="Settings"] .app-sidebar-number-hint')).toHaveCount(0);

    await page.keyboard.up('ControlOrMeta');
    await expect(badges).toHaveCount(0);
  });
});
