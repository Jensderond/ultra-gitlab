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

/**
 * Dispatch a same-position tap (no movement) on `el`, one animation frame
 * after being called. Used to land the tap inside the ~300ms settle
 * transition that follows a commit without depending on real elapsed
 * time — a single rAF tick is a negligible, machine-speed-independent
 * fraction of that window, unlike a fixed `waitForTimeout`.
 */
async function touchTap(el: Locator) {
  await el.evaluate((node) => {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        const rect = node.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + 20;
        const touch = new Touch({ identifier: 2, target: node, clientX: x, clientY: y });
        const opts = { bubbles: true, cancelable: true };
        node.dispatchEvent(new TouchEvent('touchstart', { ...opts, touches: [touch] }));
        node.dispatchEvent(new TouchEvent('touchend', { ...opts, touches: [] }));
        resolve();
      });
    });
  });
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

  test('a tap right after a commit swipe does not revert the tab', async ({ page }) => {
    // Grabbing the track mid-settle must not arm the gesture by itself — a
    // stationary tap landing inside the transition should let the settle
    // finish rather than being read as a release back toward the old pane.
    const content = page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await touchSwipeX(content, -220); // commits to Approved; track is still settling
    await touchTap(page.locator('.tab-pager'));

    await expect(page.locator('.mr-tab--active')).toHaveText(/Approved/);
    await expect(page).toHaveURL(/tab=approved/);
  });

  test('scroll position survives swiping to another tab and back', async ({ page }) => {
    // The default fixture's 4 needs-review rows fit on screen with nothing
    // to scroll — pad it out so the pane has real scroll room.
    const paddedMRs = Array.from({ length: 30 }, (_, i) => ({
      ...mergeRequests[0],
      id: 9000 + i,
      iid: 9000 + i,
      title: `feat: padding row ${i}`,
    }));
    await mockTauriIPC(page, { mergeRequests: paddedMRs });
    await page.goto('/mrs');
    await expect(page.locator(ROW).first()).toBeVisible();

    const activeContent = () => page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await activeContent().evaluate((el) => {
      el.scrollTop = 400;
    });
    const scrolledTop = await activeContent().evaluate((el) => el.scrollTop);
    expect(scrolledTop).toBeGreaterThan(200); // sanity: the pane actually scrolled

    await touchSwipeX(activeContent(), -220); // to Approved
    await expect(page.locator('.mr-tab--active')).toHaveText(/Approved/);
    await page.waitForTimeout(400); // let the settle transition finish

    await touchSwipeX(activeContent(), 220); // back to Needs review
    await expect(page.locator('.mr-tab--active')).toHaveText(/Needs review/);
    await page.waitForTimeout(400);

    const restoredTop = await activeContent().evaluate((el) => el.scrollTop);
    expect(restoredTop).toBe(scrolledTop);
  });

  test('a short swipe springs back without changing tabs', async ({ page }) => {
    const content = page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await touchSwipeX(content, -60); // below the 156px commit distance

    // Settle window first — an immediate check passes even on a wrong commit.
    await page.waitForTimeout(400);
    await expect(page.locator('.mr-tab--active')).toHaveText(/Needs review/);
    await expect(page).not.toHaveURL(/tab=/);
  });

  test('swipe right at the first tab rubber-bands and stays', async ({ page }) => {
    const content = page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await touchSwipeX(content, 220);

    await page.waitForTimeout(400);
    await expect(page.locator('.mr-tab--active')).toHaveText(/Needs review/);
    await expect(page).not.toHaveURL(/tab=/);
  });

  test('swipe left at the last tab rubber-bands and stays', async ({ page }) => {
    await page.goto('/mrs?tab=snoozed');
    await expect(page.locator('.mr-tab--active')).toHaveText(/Snoozed/);

    const content = page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await touchSwipeX(content, -220);

    await page.waitForTimeout(400);
    await expect(page.locator('.mr-tab--active')).toHaveText(/Snoozed/);
  });

  test('swipe left on a snoozable row opens the snooze sheet, not the next tab', async ({ page }) => {
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    // Well past the pager's 156px commit distance — proves the pager yielded
    // to the row rather than merely missing its threshold.
    await touchSwipeX(row, -220);

    await expect(page.locator('.snooze-menu')).toBeVisible();
    await expect(page.locator('.mr-tab--active')).toHaveText(/Needs review/);
    await expect(page).not.toHaveURL(/tab=/);
  });

  test('swipe right on a swipe-enabled row still pages (rows own left only)', async ({ page }) => {
    // Park an MR in Snoozed: its rows keep the swipe gesture (unsnooze).
    const row = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await touchSwipeX(row, -140);
    await page.locator('.snooze-menu-option', { hasText: '1 hour' }).click();
    await page.locator('.mr-tab', { hasText: 'Snoozed' }).click();

    const snoozedRow = page.locator(ROW).filter({ hasText: 'Add dark mode toggle' });
    await expect(snoozedRow).toBeVisible();
    await expect(snoozedRow).toHaveAttribute('data-swipe-row', '');
    await touchSwipeX(snoozedRow, 220);

    await expect(page.locator('.mr-tab--active')).toHaveText(/Approved/);
    // The rightward drag must not have unsnoozed the row on the way out.
    await page.locator('.mr-tab', { hasText: 'Snoozed' }).click();
    await expect(page.locator(ROW).filter({ hasText: 'Add dark mode toggle' })).toBeVisible();
  });

  test('filtering disables the pager', async ({ page }) => {
    await page.locator('button[aria-label="Search merge requests"]').click();
    await page.locator('.search-bar-input').fill('dark');
    await expect(page.locator('.mr-tabs--filtering')).toBeVisible();

    const content = page.locator(`${ACTIVE_PANE} .mr-list-content`);
    await touchSwipeX(content, -220);

    await page.waitForTimeout(400);
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
