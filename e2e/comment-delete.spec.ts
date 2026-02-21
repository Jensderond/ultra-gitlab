import { test, expect } from './fixtures/test-base';

test.describe('Comment Deletion', () => {
  test('shows delete button on hover only for current user comments', async ({ page }) => {
    // Navigate to My MR detail page (authored by testuser)
    await page.goto('/my-mrs/201');

    // Switch to Comments tab
    await page.locator('.tab-bar-item', { hasText: 'Comments' }).click();

    // Wait for comments to load
    await expect(page.locator('.my-mr-comments')).toBeVisible();

    // alice's comment should NOT have a delete button at all
    const aliceComment = page.locator('.my-mr-comment', { hasText: 'Great work on the notification preferences!' });
    await expect(aliceComment).toBeVisible();
    await expect(aliceComment.locator('.my-mr-comment-delete')).toHaveCount(0);

    // testuser's comment should have a delete button (hidden until hover)
    const myComment = page.locator('.my-mr-comment', { hasText: 'Added a note about the notification API changes.' });
    await expect(myComment).toBeVisible();
    // Button exists in DOM
    await expect(myComment.locator('.my-mr-comment-delete')).toHaveCount(1);
    // Hover to reveal it
    await myComment.hover();
    await expect(myComment.locator('.my-mr-comment-delete')).toBeVisible();
  });

  test('deletes a comment when delete button is clicked', async ({ page }) => {
    await page.goto('/my-mrs/201');

    // Switch to Comments tab
    await page.locator('.tab-bar-item', { hasText: 'Comments' }).click();
    await expect(page.locator('.my-mr-comments')).toBeVisible();

    // Verify testuser's comment is present
    const myComment = page.locator('.my-mr-comment', { hasText: 'Added a note about the notification API changes.' });
    await expect(myComment).toBeVisible();

    // Hover to reveal delete button, then click it
    await myComment.hover();
    await myComment.locator('.my-mr-comment-delete').click();

    // Comment should be removed from the DOM after deletion
    await expect(myComment).toHaveCount(0);
  });

  test('does not show delete button for other users comments', async ({ page }) => {
    await page.goto('/my-mrs/201');
    await page.locator('.tab-bar-item', { hasText: 'Comments' }).click();
    await expect(page.locator('.my-mr-comments')).toBeVisible();

    // alice's comment should not have a delete button even on hover
    const aliceComment = page.locator('.my-mr-comment', { hasText: 'Great work on the notification preferences!' });
    await expect(aliceComment).toBeVisible();
    await aliceComment.hover();
    await expect(aliceComment.locator('.my-mr-comment-delete')).toHaveCount(0);
  });
});
