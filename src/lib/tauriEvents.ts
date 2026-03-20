import { queryClient } from './queryClient';
import { tauriListen } from '../services/transport';

let initialized = false;

interface MrUpdatedPayload {
  mr_id: number;
  update_type: string;
  instance_id: number;
  iid: number;
}

interface ActionSyncedPayload {
  action_id: number;
  action_type: string;
  success: boolean;
  error: string | null;
  mr_id: number;
  local_reference_id: number | null;
}

export async function setupTauriEventListeners(): Promise<() => void> {
  if (initialized) return () => {};
  initialized = true;

  const debounceTimers = new Map<number, ReturnType<typeof setTimeout>>();

  const unlistenMrUpdated = await tauriListen<MrUpdatedPayload>(
    'mr-updated',
    (event) => {
      const { mr_id, update_type } = event.payload;

      if (debounceTimers.has(mr_id)) {
        clearTimeout(debounceTimers.get(mr_id)!);
      }

      debounceTimers.set(
        mr_id,
        setTimeout(() => {
          debounceTimers.delete(mr_id);
          queryClient.invalidateQueries({ queryKey: ['mr', mr_id] });
          queryClient.invalidateQueries({ queryKey: ['mrFiles', mr_id] });
          queryClient.invalidateQueries({ queryKey: ['mrDiffRefs', mr_id] });
          queryClient.invalidateQueries({ queryKey: ['mrList'] });
          queryClient.invalidateQueries({ queryKey: ['myMRList'] });
          if (update_type === 'comments_updated') {
            queryClient.invalidateQueries({ queryKey: ['mrComments', mr_id] });
            queryClient.invalidateQueries({ queryKey: ['mrFileComments', mr_id] });
          }
        }, 500),
      );
    },
  );

  const unlistenActionSynced = await tauriListen<ActionSyncedPayload>(
    'action-synced',
    (event) => {
      const { action_type, mr_id } = event.payload;

      if (action_type === 'comment' || action_type === 'reply') {
        if (event.payload.success) {
          queryClient.invalidateQueries({ queryKey: ['mrComments', mr_id] });
          queryClient.invalidateQueries({ queryKey: ['mrFileComments', mr_id] });
        }
      } else if (action_type === 'approve' || action_type === 'unapprove') {
        queryClient.invalidateQueries({ queryKey: ['mr', mr_id] });
        queryClient.invalidateQueries({ queryKey: ['mrReviewers', mr_id] });
        queryClient.invalidateQueries({ queryKey: ['mrList'] });
        queryClient.invalidateQueries({ queryKey: ['myMRList'] });
      } else if (action_type === 'resolve' || action_type === 'unresolve') {
        queryClient.invalidateQueries({ queryKey: ['mrComments', mr_id] });
        queryClient.invalidateQueries({ queryKey: ['mrFileComments', mr_id] });
      }
    },
  );

  return () => {
    unlistenMrUpdated();
    unlistenActionSynced();
    for (const timer of debounceTimers.values()) {
      clearTimeout(timer);
    }
    debounceTimers.clear();
    initialized = false;
  };
}
