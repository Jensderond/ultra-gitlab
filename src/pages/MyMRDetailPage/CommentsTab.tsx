/**
 * Comments tab for MyMRDetailPage — reuses ActivityFeed for reply/resolve.
 */

import type { Comment } from '../../types';
import ActivityFeed from '../../components/ActivityDrawer/ActivityFeed';

interface CommentsTabProps {
  threads: Comment[][];
  currentUser?: string | null;
  onDelete?: (commentId: number) => Promise<void>;
  onReply?: (discussionId: string, parentId: number, body: string) => Promise<void>;
  onResolve?: (discussionId: string, resolved: boolean) => Promise<void>;
}

export function CommentsTab({ threads, currentUser, onDelete, onReply, onResolve }: CommentsTabProps) {
  return (
    <div className="my-mr-comments">
      <ActivityFeed
        threads={threads}
        systemEvents={[]}
        showSystemEvents={false}
        loading={false}
        currentUser={currentUser}
        onReply={onReply}
        onResolve={onResolve}
        onDelete={onDelete}
      />
    </div>
  );
}
