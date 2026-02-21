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

  test('drag handle is visible and has ns-resize cursor', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const handle = page.getByTestId('activity-drawer-drag-handle');
    await expect(handle).toBeVisible();

    const cursor = await handle.evaluate((el) => getComputedStyle(el).cursor);
    expect(cursor).toBe('ns-resize');
  });

  test('drag handle grip indicator is visible', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const grip = page.locator('.activity-drawer__drag-grip');
    await expect(grip).toBeVisible();
  });

  test('dragging the handle resizes the drawer', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const drawer = page.getByTestId('activity-drawer');
    const handle = page.getByTestId('activity-drawer-drag-handle');

    // Get initial height
    const initialHeight = await drawer.evaluate((el) => el.getBoundingClientRect().height);

    // Drag the handle upward by 100px
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('Handle not visible');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 100, { steps: 5 });
    await page.mouse.up();

    // Height should have increased
    const newHeight = await drawer.evaluate((el) => el.getBoundingClientRect().height);
    expect(newHeight).toBeGreaterThan(initialHeight);
  });

  test('drawer height is clamped to min/max bounds', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const drawer = page.getByTestId('activity-drawer');
    const handle = page.getByTestId('activity-drawer-drag-handle');
    const viewportHeight = await page.evaluate(() => window.innerHeight);

    // Try dragging way down (below minimum)
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('Handle not visible');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, viewportHeight - 60, { steps: 5 });
    await page.mouse.up();

    // Height should be at least ~20% of viewport
    const minHeight = await drawer.evaluate((el) => el.getBoundingClientRect().height);
    expect(minHeight).toBeGreaterThanOrEqual(viewportHeight * 0.19); // slight tolerance

    // Now try dragging way up (above maximum)
    const handleBox2 = await handle.boundingBox();
    if (!handleBox2) throw new Error('Handle not visible');

    await page.mouse.move(handleBox2.x + handleBox2.width / 2, handleBox2.y + handleBox2.height / 2);
    await page.mouse.down();
    await page.mouse.move(handleBox2.x + handleBox2.width / 2, 10, { steps: 5 });
    await page.mouse.up();

    // Height should be at most ~80% of viewport
    const maxHeight = await drawer.evaluate((el) => el.getBoundingClientRect().height);
    expect(maxHeight).toBeLessThanOrEqual(viewportHeight * 0.81); // slight tolerance
  });

  test('drawer height persists within session after close/reopen', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const drawer = page.getByTestId('activity-drawer');
    const handle = page.getByTestId('activity-drawer-drag-handle');

    // Drag upward to change height
    const handleBox = await handle.boundingBox();
    if (!handleBox) throw new Error('Handle not visible');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 80, { steps: 5 });
    await page.mouse.up();

    const heightAfterDrag = await drawer.evaluate((el) => el.getBoundingClientRect().height);

    // Close and reopen
    await toggle.click();
    await expect(drawer).not.toHaveClass(/activity-drawer--open/);
    await toggle.click();
    await expect(drawer).toHaveClass(/activity-drawer--open/);

    // Height should persist
    const heightAfterReopen = await drawer.evaluate((el) => el.getBoundingClientRect().height);
    expect(Math.abs(heightAfterReopen - heightAfterDrag)).toBeLessThan(2);
  });
});
