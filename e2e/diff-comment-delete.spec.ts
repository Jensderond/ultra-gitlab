import { test, expect } from './fixtures/test-base';

/**
 * E2E tests for comment deletion in the MRDetailPage diff viewer.
 *
 * MR 101 has inline comments on ThemeToggle.tsx:
 * - carol (id 5002) at line 5: "Could we add a system preference detection here?"
 * - testuser (id 5004) at line 6: "We should memoize this callback to avoid re-renders."
 *
 * Current user is "testuser" (from seed instances).
 */

/** Helper: find annotation thread elements inside Pierre's shadow DOM. */
async function findAnnotations(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const container = document.querySelector('diffs-container');
    if (!container?.shadowRoot) return [];

    // Walk the shadow DOM looking for our annotation thread wrappers
    const results: Array<{
      text: string;
      hasDeleteBtn: boolean;
      author: string;
    }> = [];

    const walk = (root: Node) => {
      if (root instanceof HTMLElement) {
        // Find annotation thread wrappers (unique to inline diff annotations)
        if (root.classList.contains('annotation-thread-wrapper')) {
          // Extract comment info from the first .activity-comment inside
          const comment = root.querySelector('.activity-comment');
          if (comment) {
            const author = comment.querySelector('.activity-comment__author')?.textContent || '';
            const hasDeleteBtn = comment.querySelector('.activity-comment__delete') !== null;
            results.push({ text: comment.textContent || '', hasDeleteBtn, author });
          }
          return; // Don't descend further into this annotation
        }
      }
      if (root instanceof HTMLElement || root instanceof DocumentFragment) {
        for (const child of root.childNodes) {
          walk(child);
        }
      }
    };

    walk(container.shadowRoot);

    // Fallback to light DOM
    if (results.length === 0) {
      document.querySelectorAll('.annotation-thread-wrapper').forEach((el) => {
        const comment = el.querySelector('.activity-comment');
        if (comment) {
          const author = comment.querySelector('.activity-comment__author')?.textContent || '';
          const hasDeleteBtn = comment.querySelector('.activity-comment__delete') !== null;
          results.push({ text: comment.textContent || '', hasDeleteBtn, author });
        }
      });
    }

    return results;
  });
}

test.describe('Diff Viewer Comment Deletion', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/mrs/101');

    // Select ThemeToggle.tsx which has inline comments
    await page.locator('.mr-detail-sidebar').getByText('ThemeToggle.tsx').click();

    // Wait for Pierre diff to render
    const diffContainer = page.locator('diffs-container');
    await expect(diffContainer).toBeVisible({ timeout: 15_000 });

    // Wait for both annotation comments to appear
    await expect.poll(async () => {
      const annotations = await findAnnotations(page);
      return annotations.length;
    }, { timeout: 10_000 }).toBeGreaterThanOrEqual(2);
  });

  test('shows delete button only on own comments', async ({ page }) => {
    const annotations = await findAnnotations(page);

    // Carol's comment should NOT have a delete button
    const carolAnnotation = annotations.find((a) => a.text.includes('system preference detection'));
    expect(carolAnnotation).toBeDefined();
    expect(carolAnnotation!.hasDeleteBtn).toBe(false);

    // Testuser's comment SHOULD have a delete button
    const testUserAnnotation = annotations.find((a) => a.text.includes('memoize this callback'));
    expect(testUserAnnotation).toBeDefined();
    expect(testUserAnnotation!.hasDeleteBtn).toBe(true);
  });

  test('deletes comment when delete button is clicked', async ({ page }) => {
    // Verify testuser's comment exists
    let annotations = await findAnnotations(page);
    expect(annotations.find((a) => a.text.includes('memoize this callback'))).toBeDefined();

    // Hover over testuser's comment to reveal delete button, then click it.
    // Scope to .annotation-thread-wrapper to avoid matching ActivityDrawer comments.
    // Delete requires two clicks: first shows "Delete?", second confirms.
    const testUserComment = page.locator('.annotation-thread-wrapper .activity-comment', { hasText: 'memoize this callback' });
    await testUserComment.hover();
    const deleteBtn = testUserComment.locator('.activity-comment__delete');
    await deleteBtn.click();
    // Wait for the confirm state to render, then click again
    await expect(deleteBtn).toHaveText('Delete?');
    await deleteBtn.click();

    // Comment should be removed after deletion
    await expect.poll(async () => {
      const anns = await findAnnotations(page);
      return anns.some((a) => a.text.includes('memoize this callback'));
    }, { timeout: 5_000 }).toBe(false);

    // Carol's comment should still be present
    annotations = await findAnnotations(page);
    expect(annotations.find((a) => a.text.includes('system preference detection'))).toBeDefined();
  });

  test('does not show delete button for other users comments', async ({ page }) => {
    const annotations = await findAnnotations(page);

    const carolAnnotation = annotations.find((a) => a.text.includes('system preference detection'));
    expect(carolAnnotation).toBeDefined();
    expect(carolAnnotation!.hasDeleteBtn).toBe(false);
    expect(carolAnnotation!.author).toBe('carol');
  });
});
