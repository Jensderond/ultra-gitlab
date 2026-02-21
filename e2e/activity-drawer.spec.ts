import { test, expect } from './fixtures/test-base';

test.describe('Activity Drawer', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/mrs/101');
    // Wait for the page to be fully loaded
    await expect(page.locator('.mr-title')).toBeVisible();
  });

  test('drawer is hidden by default', async ({ page }) => {
    const drawer = page.getByTestId('activity-drawer');
    // Drawer should exist in DOM but be visually hidden (translated off-screen)
    await expect(drawer).toBeAttached();
    await expect(drawer).not.toHaveClass(/activity-drawer--open/);
  });

  test('toggle button opens and closes the drawer', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    const drawer = page.getByTestId('activity-drawer');

    // Open
    await toggle.click();
    await expect(drawer).toHaveClass(/activity-drawer--open/);

    // Close via toggle
    await toggle.click();
    await expect(drawer).not.toHaveClass(/activity-drawer--open/);
  });

  test('close button closes the drawer', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    const drawer = page.getByTestId('activity-drawer');
    const closeBtn = page.getByTestId('activity-drawer-close');

    // Open
    await toggle.click();
    await expect(drawer).toHaveClass(/activity-drawer--open/);

    // Close via close button
    await closeBtn.click();
    await expect(drawer).not.toHaveClass(/activity-drawer--open/);
  });

  test('drawer has Activity title in header', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const title = page.locator('.activity-drawer__title');
    await expect(title).toHaveText('Activity');
  });

  test('drawer content area is scrollable', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const content = page.getByTestId('activity-drawer-content');
    await expect(content).toBeVisible();

    // Verify the content area has overflow-y: auto
    const overflowY = await content.evaluate((el) => getComputedStyle(el).overflowY);
    expect(overflowY).toBe('auto');
  });

  test('drawer overlays content without shrinking it', async ({ page }) => {
    const mainContent = page.locator('.mr-detail-content');
    const heightBefore = await mainContent.evaluate((el) => el.getBoundingClientRect().height);

    // Open drawer
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();
    await expect(page.getByTestId('activity-drawer')).toHaveClass(/activity-drawer--open/);

    // Main content height should not change (drawer overlays, doesn't shrink)
    const heightAfter = await mainContent.evaluate((el) => el.getBoundingClientRect().height);
    expect(heightAfter).toBe(heightBefore);
  });

  test('drawer has slide-up animation via CSS transition', async ({ page }) => {
    const drawer = page.getByTestId('activity-drawer');

    // Check that transition is applied
    const transition = await drawer.evaluate((el) => getComputedStyle(el).transition);
    expect(transition).toContain('transform');
  });
});
