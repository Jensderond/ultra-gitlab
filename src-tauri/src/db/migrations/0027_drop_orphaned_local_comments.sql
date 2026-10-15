-- Remove local (optimistic) comments that were pushed to GitLab but never
-- replaced: the sync queue row that linked them to the push was cleaned up
-- before the GitLab version was fetched, so they lingered as "Sending..."
-- duplicates. Only drop ones whose GitLab copy is already cached.
DELETE FROM comments
WHERE is_local = 1
  AND id < 0
  AND NOT EXISTS (
    SELECT 1 FROM sync_queue WHERE sync_queue.local_reference_id = comments.id
  )
  AND EXISTS (
    SELECT 1 FROM comments AS remote
    WHERE remote.is_local = 0
      AND remote.mr_id = comments.mr_id
      AND remote.author_username = comments.author_username
      AND remote.body = comments.body
  );
