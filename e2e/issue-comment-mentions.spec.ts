import { test, expect } from './fixtures/test-base';

const ISSUE_URL = '/issues/1/7/42';
const TEXTAREA = '.issue-composer-textarea';
const DROPDOWN = '.mention-dropdown';

test.describe('Issue comment @mention autocomplete', () => {
  test('typing @ opens a dropdown of cached users', async ({ page }) => {
    await page.goto(ISSUE_URL);

    const textarea = page.locator(TEXTAREA);
    await textarea.click();
    await textarea.pressSequentially('@');

    await expect(page.locator(DROPDOWN)).toBeVisible();
    await expect(page.locator('.mention-option')).toHaveCount(3); // alice, bob, derond
  });

  test('filters by username prefix and inserts @username', async ({ page }) => {
    await page.goto(ISSUE_URL);

    const textarea = page.locator(TEXTAREA);
    await textarea.click();
    await textarea.pressSequentially('hi @al');

    const options = page.locator('.mention-option');
    await expect(options).toHaveCount(1);
    await expect(options.first()).toContainText('@alice');

    await page.keyboard.press('Enter');
    await expect(page.locator(DROPDOWN)).toHaveCount(0);
    await expect(textarea).toHaveValue('hi @alice ');
  });

  test('matches on display name even when the username differs', async ({ page }) => {
    await page.goto(ISSUE_URL);

    const textarea = page.locator(TEXTAREA);
    await textarea.click();
    // "Jens de Rond" has username "derond" — typing the first name must match.
    await textarea.pressSequentially('@jens');

    const option = page.locator('.mention-option');
    await expect(option).toHaveCount(1);
    await expect(option).toContainText('Jens de Rond');
    await expect(option).toContainText('@derond');

    await page.keyboard.press('Enter');
    await expect(textarea).toHaveValue('@derond ');
  });

  test('arrow keys move the highlight and Enter accepts it', async ({ page }) => {
    await page.goto(ISSUE_URL);

    const textarea = page.locator(TEXTAREA);
    await textarea.click();
    await textarea.pressSequentially('@');

    // First option starts highlighted; ArrowDown moves to the second (bob).
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('.mention-option.is-active')).toContainText('@bob');

    await page.keyboard.press('Enter');
    await expect(textarea).toHaveValue('@bob ');
  });

  test('Escape closes the dropdown without inserting', async ({ page }) => {
    await page.goto(ISSUE_URL);

    const textarea = page.locator(TEXTAREA);
    await textarea.click();
    await textarea.pressSequentially('@al');
    await expect(page.locator(DROPDOWN)).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator(DROPDOWN)).toHaveCount(0);
    await expect(textarea).toHaveValue('@al');
  });

  test('dropdown stays within the viewport when the composer is near the bottom', async ({
    page,
  }) => {
    // A short viewport pushes the composer to the bottom; the dropdown must
    // flip above rather than spilling off-screen.
    await page.setViewportSize({ width: 1000, height: 420 });
    await page.goto(ISSUE_URL);

    const textarea = page.locator(TEXTAREA);
    await textarea.scrollIntoViewIfNeeded();
    await textarea.click();
    await textarea.pressSequentially('@');

    const dropdown = page.locator(DROPDOWN);
    await expect(dropdown).toBeVisible();
    await expect(dropdown).toHaveClass(/mention-dropdown--above/);

    const box = await dropdown.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    expect(viewport).not.toBeNull();
    // Fully on-screen: never below the fold, never clipped above.
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
  });

  test('does not trigger on email-like text', async ({ page }) => {
    await page.goto(ISSUE_URL);

    const textarea = page.locator(TEXTAREA);
    await textarea.click();
    await textarea.pressSequentially('email me at jens@al');

    await expect(page.locator(DROPDOWN)).toHaveCount(0);
  });
});
