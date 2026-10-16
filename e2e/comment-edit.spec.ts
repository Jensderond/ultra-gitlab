import { test, expect } from './fixtures/test-base';

/**
 * E2E tests for editing your own comments in the classic UI.
 *
 * MR 201 (authored by testuser) has a testuser comment
 * "Added a note about the notification API changes." and one from alice.
 * MR 101 has a testuser inline comment on ThemeToggle.tsx:
 * "We should memoize this callback to avoid re-renders."
 *
 * Current user is "testuser" (from seed instances).
 */

const MY_COMMENT = 'Added a note about the notification API changes.';
const ALICE_COMMENT = 'Great work on the notification preferences!';

async function openMyMRComments(page: import('@playwright/test').Page) {
  await page.goto('/my-mrs/201');
  await page.locator('.tab-bar-item', { hasText: 'Comments' }).click();
  await expect(page.locator('.my-mr-comments')).toBeVisible();
}

test.describe('Comment Editing', () => {
  test('shows the edit button only on your own comments', async ({ page }) => {
    await openMyMRComments(page);

    const aliceComment = page.locator('.activity-comment', { hasText: ALICE_COMMENT });
    await aliceComment.hover();
    await expect(aliceComment.getByTestId('activity-edit-btn')).toHaveCount(0);

    const myComment = page.locator('.activity-comment', { hasText: MY_COMMENT });
    await myComment.hover();
    await expect(myComment.getByTestId('activity-edit-btn')).toBeVisible();
  });

  test('edits your own comment with Save', async ({ page }) => {
    await openMyMRComments(page);

    const myComment = page.locator('.activity-comment', { hasText: MY_COMMENT });
    await myComment.hover();
    await myComment.getByTestId('activity-edit-btn').click();

    const textarea = page.getByTestId('comment-edit-textarea');
    await expect(textarea).toBeFocused();
    await expect(textarea).toHaveValue(MY_COMMENT);
    // Save stays disabled until the body actually changes
    await expect(page.getByTestId('comment-edit-save')).toBeDisabled();

    await textarea.fill('Updated note about the notification API.');
    await page.getByTestId('comment-edit-save').click();

    await expect(page.getByTestId('comment-edit-form')).toHaveCount(0);
    await expect(page.locator('.activity-comment', { hasText: 'Updated note about the notification API.' })).toBeVisible();
    await expect(page.locator('.activity-comment', { hasText: MY_COMMENT })).toHaveCount(0);
  });

  test('Escape cancels without saving', async ({ page }) => {
    await openMyMRComments(page);

    const myComment = page.locator('.activity-comment', { hasText: MY_COMMENT });
    await myComment.hover();
    await myComment.getByTestId('activity-edit-btn').click();

    const textarea = page.getByTestId('comment-edit-textarea');
    await textarea.fill('This should be thrown away');
    await textarea.press('Escape');

    await expect(page.getByTestId('comment-edit-form')).toHaveCount(0);
    await expect(page.locator('.activity-comment', { hasText: MY_COMMENT })).toBeVisible();
    await expect(page.locator('.activity-comment', { hasText: 'This should be thrown away' })).toHaveCount(0);
  });

  test('keeps the draft open and restores the comment when saving fails', async ({ page }) => {
    await openMyMRComments(page);
    await page.evaluate(() => {
      (window as unknown as Record<string, unknown>).__MOCK_EDIT_COMMENT_FAIL__ = true;
    });

    const myComment = page.locator('.activity-comment', { hasText: MY_COMMENT });
    await myComment.hover();
    await myComment.getByTestId('activity-edit-btn').click();

    const textarea = page.getByTestId('comment-edit-textarea');
    await textarea.fill('This save will fail');
    await textarea.press('ControlOrMeta+Enter');

    // Editor stays open with the draft so the user can retry
    await expect(textarea).toBeEnabled();
    await expect(textarea).toHaveValue('This save will fail');

    // Cancelling shows the refetched, unchanged comment
    await textarea.press('Escape');
    await expect(page.locator('.activity-comment', { hasText: MY_COMMENT })).toBeVisible();
    await expect(page.locator('.activity-comment', { hasText: 'This save will fail' })).toHaveCount(0);
  });
});

test.describe('Diff Viewer Comment Editing', () => {
  test('edits your own inline comment with Cmd/Ctrl+Enter', async ({ page }) => {
    await page.goto('/mrs/101');
    await page.locator('.mr-detail-sidebar').getByText('ThemeToggle.tsx').click();
    await expect(page.locator('diffs-container')).toBeVisible({ timeout: 15_000 });

    const carolComment = page.locator('.annotation-thread-wrapper .activity-comment', { hasText: 'system preference detection' });
    await expect(carolComment).toBeVisible({ timeout: 10_000 });
    await expect(carolComment.getByTestId('annotation-edit-btn')).toHaveCount(0);

    const myComment = page.locator('.annotation-thread-wrapper .activity-comment', { hasText: 'memoize this callback' });
    await myComment.hover();
    await myComment.getByTestId('annotation-edit-btn').click();

    const textarea = page.locator('.annotation-thread-wrapper').getByTestId('comment-edit-textarea');
    await expect(textarea).toHaveValue('We should memoize this callback to avoid re-renders.');
    await textarea.fill('Please wrap this callback in useCallback.');
    await textarea.press('ControlOrMeta+Enter');

    await expect(page.locator('.annotation-thread-wrapper').getByTestId('comment-edit-form')).toHaveCount(0);
    await expect(
      page.locator('.annotation-thread-wrapper .activity-comment', { hasText: 'Please wrap this callback in useCallback.' }),
    ).toBeVisible();
  });
});
