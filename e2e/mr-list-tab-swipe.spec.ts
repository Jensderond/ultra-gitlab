import { test, expect } from './fixtures/test-base';
import type { Locator } from '@playwright/test';
import { mockTauriIPC } from './fixtures/tauri-mock';
import { mergeRequests } from './fixtures/seed-data';

/**
 * Touch MR list: horizontal swipes on the list surface page between the
 * status tabs (non-wrapping), while swipe-left on a snoozable row still
 * belongs to the snooze gesture. Desktop renders no pager at all.
 */

const ROW = '.mr-list-item';
/** The pane the pager currently shows (inactive panes are inert). */
const ACTIVE_PANE = '.tab-pager-pane:not([inert])';

/**
 * Dispatch a synthetic horizontal touch-drag on `el`, then release.
 * Positive deltaX drags rightward (previous tab), negative leftward (next).
 * All events land in one JS task, so React state is only observable after
 * the evaluate round-trip (see e2e-touch-gesture-testing notes).
 */
async function touchSwipeX(el: Locator, deltaX: number) {
  await el.evaluate((node, delta) => {
    const startX = delta < 0 ? 320 : 40;
    const y = node.getBoundingClientRect().top + 20;
    const touch = (x: number) =>
      new Touch({ identifier: 1, target: node, clientX: x, clientY: y });
    const opts = { bubbles: true, cancelable: true };
    node.dispatchEvent(new TouchEvent('touchstart', { ...opts, touches: [touch(startX)] }));
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      node.dispatchEvent(
        new TouchEvent('touchmove', { ...opts, touches: [touch(startX + (delta * i) / steps)] }),
      );
    }
    node.dispatchEvent(new TouchEvent('touchend', { ...opts, touches: [] }));
  }, deltaX);
}

test.describe('Touch MR list tab swipe', () => {
  test.use({ viewport: { width: 390, height: 664 }, hasTouch: true });

  test.beforeEach(async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator(ROW).first()).toBeVisible();
  });

  test('snoozable rows advertise the swipe surface', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await expect(row).toHaveAttribute('data-swipe-row', '');
  });

  test('approved rows do not advertise the swipe surface', async ({ page }) => {
    const withApproved = mergeRequests.map((mr) =>
      mr.id === 101 ? { ...mr, userHasApproved: true } : mr,
    );
    await mockTauriIPC(page, { mergeRequests: withApproved });
    await page.goto('/mrs');

    await page.locator('.mr-tab', { hasText: 'Approved' }).click();
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await expect(row).toBeVisible();
    await expect(row).not.toHaveAttribute('data-swipe-row');
  });

  test('renders the three status panes in a pager', async ({ page }) => {
    await expect(page.locator('.tab-pager')).toBeVisible();
    await expect(page.locator('.tab-pager-pane')).toHaveCount(3);
    // Exactly one pane is interactive; the others are inert for focus/VO.
    await expect(page.locator('.tab-pager-pane:not([inert])')).toHaveCount(1);
  });

  test('swipe left pages to the Approved tab and updates the URL', async ({ page }) => {
    const content = page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await touchSwipeX(content, -220); // > 40% of the 390px viewport

    await expect(page.locator('.mr-tab--active')).toHaveText(/Approved/);
    await expect(page).toHaveURL(/tab=approved/);
  });

  test('swipe right pages back from Approved to Needs review', async ({ page }) => {
    await page.goto('/mrs?tab=approved');
    await expect(page.locator('.mr-tab--active')).toHaveText(/Approved/);

    const content = page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await touchSwipeX(content, 220);

    await expect(page.locator('.mr-tab--active')).toHaveText(/Needs review/);
  });

  test('a short swipe springs back without changing tabs', async ({ page }) => {
    const content = page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await touchSwipeX(content, -60); // below the 156px commit distance

    // Settle window first — an immediate check passes even on a wrong commit.
    await page.waitForTimeout(400);
    await expect(page.locator('.mr-tab--active')).toHaveText(/Needs review/);
    await expect(page).not.toHaveURL(/tab=/);
  });
});

test.describe('Desktop MR list has no pager', () => {
  test('renders a single list without pager wrappers', async ({ page }) => {
    await page.goto('/mrs');
    await expect(page.locator('.mr-list-item').first()).toBeVisible();

    await expect(page.locator('.tab-pager')).toHaveCount(0);
    await expect(page.locator('.mr-list')).toHaveCount(1);
  });
});
