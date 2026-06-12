import { test, expect } from './fixtures/test-base';

const ISSUE_URL = '/issues/1/7/42';
const ORIGINAL_DESCRIPTION = 'The login button overlaps the footer on small screens.';
// CodeMirror 6 renders the document inside a contenteditable .cm-content.
const EDITOR_CONTENT = '.issue-description-editor-cm .cm-content';

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

    const editor = description.locator(EDITOR_CONTENT);
    await expect(editor).toBeVisible();
    await expect(editor).toHaveText(ORIGINAL_DESCRIPTION);

    await editor.fill('Updated description from the desktop app.');
    await description.getByRole('button', { name: 'Save' }).click();

    await expect(description.locator(EDITOR_CONTENT)).toHaveCount(0);
    await expect(description).toContainText('Updated description from the desktop app.');
    await expect(description).not.toContainText(ORIGINAL_DESCRIPTION);
  });

  test('escape cancels editing without saving', async ({ page }) => {
    await page.goto(ISSUE_URL);

    const description = page.locator('.issue-description');
    await description.hover();
    await description.locator('.issue-description-edit').click();

    const editor = description.locator(EDITOR_CONTENT);
    await editor.fill('This text should be discarded.');
    await page.keyboard.press('Escape');

    await expect(description.locator(EDITOR_CONTENT)).toHaveCount(0);
    await expect(description).toContainText(ORIGINAL_DESCRIPTION);
    // Still on the issue page — Escape must not bubble up to "close view".
    await expect(page.locator('h1.mr-title')).toContainText('Login button misaligned');
  });

  test('"e" shortcut opens the editor and focuses it', async ({ page }) => {
    await page.goto(ISSUE_URL);
    await expect(page.locator('.issue-description')).toContainText(ORIGINAL_DESCRIPTION);

    await page.keyboard.press('e');
    await expect(page.locator(EDITOR_CONTENT)).toBeFocused();
  });

  test('typing shortcut keys inside the editor does not trigger them', async ({ page }) => {
    await page.goto(ISSUE_URL);

    const description = page.locator('.issue-description');
    await description.hover();
    await description.locator('.issue-description-edit').click();

    const editor = description.locator(EDITOR_CONTENT);
    await editor.click();
    // "a" opens the assignee picker, "c" focuses the comment composer —
    // neither may fire while typing in the editor.
    await page.keyboard.type('a cache change');

    await expect(page.locator('.issue-assignee-dialog')).toHaveCount(0);
    await expect(editor).toBeVisible();
  });

  test('markdown syntax is highlighted in the editor', async ({ page }) => {
    await page.goto(ISSUE_URL);

    const description = page.locator('.issue-description');
    await description.hover();
    await description.locator('.issue-description-edit').click();

    const editor = description.locator(EDITOR_CONTENT);
    await editor.fill('# Heading\n\nSome **bold** text.');

    // Unstyled text sits as bare text nodes inside .cm-line; the markdown
    // grammar wraps highlighted ranges (heading, strong) in classed spans.
    await expect(editor.locator('.cm-line span[class]').first()).toBeVisible();
  });
});
