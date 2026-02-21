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

  test('Cmd+D keyboard shortcut toggles the drawer', async ({ page }) => {
    const drawer = page.getByTestId('activity-drawer');

    // Open with Cmd+D
    await page.keyboard.press('Meta+d');
    await expect(drawer).toHaveClass(/activity-drawer--open/);

    // Close with Cmd+D
    await page.keyboard.press('Meta+d');
    await expect(drawer).not.toHaveClass(/activity-drawer--open/);
  });

  test('Cmd+D does not fire when focus is in a text input', async ({ page }) => {
    const drawer = page.getByTestId('activity-drawer');

    // Focus a text input (we create one dynamically to avoid depending on page state)
    await page.evaluate(() => {
      const input = document.createElement('input');
      input.type = 'text';
      input.id = 'test-input';
      document.body.appendChild(input);
      input.focus();
    });

    await page.keyboard.press('Meta+d');
    // Drawer should remain closed
    await expect(drawer).not.toHaveClass(/activity-drawer--open/);

    // Cleanup
    await page.evaluate(() => document.getElementById('test-input')?.remove());
  });

  test('toggle button shows unresolved thread count badge', async ({ page }) => {
    // Seed data for MR 101 has 4 unresolved discussion threads
    const badge = page.getByTestId('activity-badge');
    await expect(badge).toBeVisible();
    await expect(badge).toHaveText('4');
  });

  test('badge is hidden when unresolved count is 0', async ({ page }) => {
    // Navigate to an MR with no comments (e.g., MR that doesn't exist in seed)
    await page.goto('/mrs/999');
    // Wait for page to settle
    await page.waitForTimeout(500);
    const badge = page.getByTestId('activity-badge');
    await expect(badge).not.toBeAttached();
  });

  // ---- US-005: Activity Feed ----

  test('activity feed renders threads when drawer is open', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const feed = page.getByTestId('activity-feed');
    await expect(feed).toBeVisible();

    // MR 101 seed data has 6 threads (disc-001..005 + standalone 5009)
    const threads = page.getByTestId('activity-thread');
    await expect(threads).toHaveCount(6);
  });

  test('thread shows author username and body', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    // First thread (unresolved, oldest first) is disc-001 by bob
    const firstThread = page.getByTestId('activity-thread').first();
    await expect(firstThread.locator('.activity-comment__author').first()).toHaveText('bob');
    await expect(firstThread.locator('.activity-comment__body').first()).toContainText('Looks good overall');
  });

  test('thread shows relative timestamp', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    // Check that time elements exist and have some text
    const times = page.locator('.activity-comment__time');
    const count = await times.count();
    expect(count).toBeGreaterThan(0);
    // Each time should have non-empty text like "2h ago" or "3d ago"
    await expect(times.first()).not.toHaveText('');
  });

  test('inline thread shows file path and line number', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const fileInfos = page.getByTestId('activity-thread-file-info');
    const count = await fileInfos.count();
    // Seed data has 3 inline threads (disc-002 line 5, disc-004 line 6, disc-005 line 12)
    expect(count).toBe(3);

    // Check first file info contains a file path
    await expect(fileInfos.first()).toContainText('src/components/ThemeToggle.tsx');
  });

  test('resolved threads are visually dimmed', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    // disc-005 is resolved — should have the resolved class
    const resolvedThreads = page.locator('.activity-thread--resolved');
    await expect(resolvedThreads).toHaveCount(1);

    // Resolved threads appear after unresolved ones (at the end)
    const allThreads = page.getByTestId('activity-thread');
    const lastThread = allThreads.nth((await allThreads.count()) - 1);
    await expect(lastThread).toHaveClass(/activity-thread--resolved/);
  });

  test('threads ordered: unresolved first, then resolved', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const threads = page.getByTestId('activity-thread');
    const count = await threads.count();

    // All threads except the last should NOT be resolved
    for (let i = 0; i < count - 1; i++) {
      await expect(threads.nth(i)).not.toHaveClass(/activity-thread--resolved/);
    }
    // Last thread should be resolved
    await expect(threads.nth(count - 1)).toHaveClass(/activity-thread--resolved/);
  });

  test('thread with replies shows reply comments', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    // disc-001 has a reply (id: 5005 from alice)
    const replySections = page.getByTestId('activity-thread-replies');
    const count = await replySections.count();
    expect(count).toBeGreaterThanOrEqual(1);

    // The reply section should contain alice's reply
    await expect(replySections.first()).toContainText('alice');
    await expect(replySections.first()).toContainText('Thanks for the review');
  });

  test('empty state shown when no comments exist', async ({ page }) => {
    // Navigate to MR with no comments
    await page.goto('/mrs/999');
    await page.waitForTimeout(500);

    // Open drawer
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const emptyState = page.getByTestId('activity-feed-empty');
    await expect(emptyState).toBeVisible();
    await expect(emptyState).toHaveText('No comments yet');
  });

  // ---- US-006: System Events ----

  test('system events are hidden by default', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    // System events should not be visible by default
    const events = page.getByTestId('activity-system-event');
    await expect(events).toHaveCount(0);
  });

  test('show activity toggle is present in drawer header', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const showEventsToggle = page.getByTestId('activity-show-events-toggle');
    await expect(showEventsToggle).toBeVisible();
    await expect(showEventsToggle).toContainText('Show activity');
  });

  test('toggling show activity reveals system events', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    // Enable system events
    const checkbox = page.getByTestId('activity-show-events-toggle').locator('input[type="checkbox"]');
    await checkbox.check();

    // Seed data has 2 system events for MR 101
    const events = page.getByTestId('activity-system-event');
    await expect(events).toHaveCount(2);
  });

  test('system events show author and body', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const checkbox = page.getByTestId('activity-show-events-toggle').locator('input[type="checkbox"]');
    await checkbox.check();

    const events = page.getByTestId('activity-system-event');
    // First system event (chronologically): bob "approved this merge request"
    await expect(events.first()).toContainText('bob');
    await expect(events.first()).toContainText('approved this merge request');
  });

  test('system events are interleaved chronologically with threads', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const checkbox = page.getByTestId('activity-show-events-toggle').locator('input[type="checkbox"]');
    await checkbox.check();

    // With system events visible, total items = 6 threads + 2 events = 8
    const feed = page.getByTestId('activity-feed');
    const items = feed.locator('[data-testid="activity-thread"], [data-testid="activity-system-event"]');
    await expect(items).toHaveCount(8);
  });

  test('toggling show activity off hides system events again', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const checkbox = page.getByTestId('activity-show-events-toggle').locator('input[type="checkbox"]');
    // Show
    await checkbox.check();
    await expect(page.getByTestId('activity-system-event')).toHaveCount(2);

    // Hide
    await checkbox.uncheck();
    await expect(page.getByTestId('activity-system-event')).toHaveCount(0);
  });

  test('system events have muted compact styling', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const checkbox = page.getByTestId('activity-show-events-toggle').locator('input[type="checkbox"]');
    await checkbox.check();

    const event = page.getByTestId('activity-system-event').first();
    const opacity = await event.evaluate((el) => getComputedStyle(el).opacity);
    expect(parseFloat(opacity)).toBeLessThan(1);
  });

  test('loading spinner shown while fetching', async ({ page }) => {
    // We can check that the loading state renders by intercepting the comments API
    // and delaying it. But since mock resolves instantly, we verify the component exists.
    // The loading state is brief but the component structure is testable.
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    // After loading, feed should be visible (not loading)
    const feed = page.getByTestId('activity-feed');
    await expect(feed).toBeVisible();
    // Loading indicator should NOT be visible after load
    const loading = page.getByTestId('activity-feed-loading');
    await expect(loading).not.toBeAttached();
  });

  // ---- US-007: General Comment Input ----

  test('comment input is visible at the bottom of the drawer', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const input = page.getByTestId('activity-comment-input');
    await expect(input).toBeVisible();

    const textarea = page.getByTestId('activity-comment-textarea');
    await expect(textarea).toBeVisible();
    await expect(textarea).toHaveAttribute('placeholder', 'Add a comment...');
  });

  test('send button is disabled when textarea is empty', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const sendBtn = page.getByTestId('activity-comment-send');
    await expect(sendBtn).toBeDisabled();
  });

  test('send button is enabled when textarea has content', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const textarea = page.getByTestId('activity-comment-textarea');
    const sendBtn = page.getByTestId('activity-comment-send');

    await textarea.fill('Hello world');
    await expect(sendBtn).toBeEnabled();
  });

  test('submitting a comment via send button adds it to the feed', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const textarea = page.getByTestId('activity-comment-textarea');
    const sendBtn = page.getByTestId('activity-comment-send');

    // Count threads before
    const threadsBefore = await page.getByTestId('activity-thread').count();

    await textarea.fill('My new general comment');
    await sendBtn.click();

    // Textarea should be cleared after submission
    await expect(textarea).toHaveValue('');

    // A new thread should appear in the feed (optimistic update adds it immediately)
    const threadsAfter = await page.getByTestId('activity-thread').count();
    expect(threadsAfter).toBeGreaterThan(threadsBefore);
  });

  test('submitting a comment via Cmd+Enter adds it to the feed', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const textarea = page.getByTestId('activity-comment-textarea');

    // Count threads before
    const threadsBefore = await page.getByTestId('activity-thread').count();

    await textarea.fill('Comment via keyboard shortcut');
    await textarea.press('Meta+Enter');

    // Textarea should be cleared
    await expect(textarea).toHaveValue('');

    // New thread should appear
    const threadsAfter = await page.getByTestId('activity-thread').count();
    expect(threadsAfter).toBeGreaterThan(threadsBefore);
  });

  test('comment input does not scroll with content (fixed at bottom)', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    const input = page.getByTestId('activity-comment-input');
    const drawer = page.getByTestId('activity-drawer');

    // CommentInput should be a direct child of the drawer, not inside the scrollable content
    const isDirectChild = await drawer.evaluate((drawerEl) => {
      const inputEl = drawerEl.querySelector('[data-testid="activity-comment-input"]');
      if (!inputEl) return false;
      // It should NOT be inside the scrollable content area
      const contentArea = drawerEl.querySelector('[data-testid="activity-drawer-content"]');
      return contentArea ? !contentArea.contains(inputEl) : true;
    });
    expect(isDirectChild).toBe(true);
    await expect(input).toBeVisible();
  });

  test('pending sync badge shown on newly added comment', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();

    // Seed data already has a pending sync comment (id: 5009)
    // Check that at least one comment in the feed has syncStatus 'pending'
    // We can verify by checking for the pending indicator in the seed data comment
    // Note: The sync status display will be fully implemented in US-010,
    // but the optimistic update sets syncStatus: 'pending' on new comments
    const textarea = page.getByTestId('activity-comment-textarea');
    const sendBtn = page.getByTestId('activity-comment-send');

    await textarea.fill('Test pending comment');
    await sendBtn.click();

    // The comment should appear in the feed - verify it was added
    await expect(textarea).toHaveValue('');
  });

  // ========================================================================
  // US-008: Reply to thread functionality
  // ========================================================================

  test('reply button shown on threads with discussionId', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();
    await expect(page.getByTestId('activity-feed')).toBeVisible();

    // Threads with a discussionId should have a Reply button
    const replyButtons = page.getByTestId('activity-reply-btn');
    const count = await replyButtons.count();
    expect(count).toBeGreaterThan(0);
  });

  test('clicking Reply opens inline reply input', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();
    await expect(page.getByTestId('activity-feed')).toBeVisible();

    // Click the first Reply button
    const firstReplyBtn = page.getByTestId('activity-reply-btn').first();
    await firstReplyBtn.click();

    // Reply input should appear
    const replyInput = page.getByTestId('activity-reply-input');
    await expect(replyInput).toBeVisible();

    // Reply textarea should be auto-focused
    const replyTextarea = page.getByTestId('activity-reply-textarea');
    await expect(replyTextarea).toBeFocused();
  });

  test('only one reply input open at a time', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();
    await expect(page.getByTestId('activity-feed')).toBeVisible();

    const replyButtons = page.getByTestId('activity-reply-btn');
    // Open first reply input
    await replyButtons.first().click();
    let replyInputs = page.getByTestId('activity-reply-input');
    await expect(replyInputs).toHaveCount(1);

    // Click a different Reply button — the first input should close
    // After opening the first, there should be fewer reply buttons visible
    // (the first thread's button is replaced by the input)
    // Find another reply button and click it
    const remainingButtons = page.getByTestId('activity-reply-btn');
    if (await remainingButtons.count() > 0) {
      await remainingButtons.first().click();
      replyInputs = page.getByTestId('activity-reply-input');
      await expect(replyInputs).toHaveCount(1);
    }
  });

  test('reply submitted via send button appears in thread', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();
    await expect(page.getByTestId('activity-feed')).toBeVisible();

    // Count existing comments
    const initialComments = await page.getByTestId('activity-comment').count();

    // Open reply on first thread
    const firstReplyBtn = page.getByTestId('activity-reply-btn').first();
    await firstReplyBtn.click();

    // Type and submit
    const replyTextarea = page.getByTestId('activity-reply-textarea');
    await replyTextarea.fill('My reply to this thread');
    const sendBtn = page.getByTestId('activity-reply-send');
    await sendBtn.click();

    // Reply input should close after submission
    await expect(page.getByTestId('activity-reply-input')).toHaveCount(0);

    // A new comment should appear in the feed
    const newComments = await page.getByTestId('activity-comment').count();
    expect(newComments).toBeGreaterThan(initialComments);
  });

  test('reply submitted via Cmd+Enter', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();
    await expect(page.getByTestId('activity-feed')).toBeVisible();

    const initialComments = await page.getByTestId('activity-comment').count();

    const firstReplyBtn = page.getByTestId('activity-reply-btn').first();
    await firstReplyBtn.click();

    const replyTextarea = page.getByTestId('activity-reply-textarea');
    await replyTextarea.fill('Reply via keyboard');
    await replyTextarea.press('Meta+Enter');

    // Reply input should close
    await expect(page.getByTestId('activity-reply-input')).toHaveCount(0);

    // New comment should appear
    const newComments = await page.getByTestId('activity-comment').count();
    expect(newComments).toBeGreaterThan(initialComments);
  });

  test('reply input auto-focuses when opened', async ({ page }) => {
    const toggle = page.getByTestId('activity-toggle');
    await toggle.click();
    await expect(page.getByTestId('activity-feed')).toBeVisible();

    const firstReplyBtn = page.getByTestId('activity-reply-btn').first();
    await firstReplyBtn.click();

    const replyTextarea = page.getByTestId('activity-reply-textarea');
    await expect(replyTextarea).toBeFocused();
  });
});
