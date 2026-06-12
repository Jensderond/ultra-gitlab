import { test, expect } from './fixtures/test-base';

const ISSUE_URL = '/issues/1/7/42';
const ORIGINAL_DESCRIPTION = 'The login button overlaps the footer on small screens.';
const EDITOR_TEXTAREA = '.issue-description-editor-textarea';

test.describe('Issue description editing', () => {
  test('renders the description with an edit affordance', async ({ page }) => {
    await page.goto(ISSUE_URL);

    const description = page.locator('.issue-description');
    await expect(description).toContainText(ORIGINAL_DESCRIPTION);

    await description.hover();
    await expect(description.locator('.issue-description-edit')).toBeVisible();
  });

  test('edits and saves the description', async ({ page }) => {
    await page.goto(ISSUE_URL);

    const description = page.locator('.issue-description');
    await description.hover();
    await description.locator('.issue-description-edit').click();

    const textarea = description.locator(EDITOR_TEXTAREA);
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveValue(ORIGINAL_DESCRIPTION);

    await textarea.fill('Updated description from the desktop app.');
    await description.getByRole('button', { name: 'Save' }).click();

    await expect(description.locator(EDITOR_TEXTAREA)).toHaveCount(0);
    await expect(description).toContainText('Updated description from the desktop app.');
    await expect(description).not.toContainText(ORIGINAL_DESCRIPTION);
  });

  test('escape cancels editing without saving', async ({ page }) => {
    await page.goto(ISSUE_URL);

    const description = page.locator('.issue-description');
    await description.hover();
    await description.locator('.issue-description-edit').click();

    const textarea = description.locator(EDITOR_TEXTAREA);
    await textarea.fill('This text should be discarded.');
    await page.keyboard.press('Escape');

    await expect(description.locator(EDITOR_TEXTAREA)).toHaveCount(0);
    await expect(description).toContainText(ORIGINAL_DESCRIPTION);
    // Still on the issue page — Escape must not bubble up to "close view".
    await expect(page.locator('h1.mr-title')).toContainText('Login button misaligned');
  });

  test('"e" shortcut opens the editor and focuses the textarea', async ({ page }) => {
    await page.goto(ISSUE_URL);
    await expect(page.locator('.issue-description')).toContainText(ORIGINAL_DESCRIPTION);

    await page.keyboard.press('e');
    await expect(page.locator(EDITOR_TEXTAREA)).toBeFocused();
  });

  test('typing shortcut keys inside the editor does not trigger them', async ({ page }) => {
    await page.goto(ISSUE_URL);

    const description = page.locator('.issue-description');
    await description.hover();
    await description.locator('.issue-description-edit').click();

    const textarea = description.locator(EDITOR_TEXTAREA);
    await textarea.click();
    // "a" opens the assignee picker, "c" focuses the comment composer —
    // neither may fire while typing in the editor.
    await page.keyboard.type('a cache change');

    await expect(page.locator('.issue-assignee-dialog')).toHaveCount(0);
    await expect(textarea).toBeVisible();
  });
});
