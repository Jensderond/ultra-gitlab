import { invoke } from '@tauri-apps/api/core';

export function trackEvent(name: string, props?: Record<string, unknown>): void {
  invoke('plugin:aptabase|track_event', { name, props: props ?? null }).catch(() => {});
}

/** Track MR approved by the current user */
export function trackMRApproved(mrId: number, timeOnMrSeconds: number, trigger: 'button' | 'keyboard') {
  trackEvent('mr_approved', { mr_id: mrId, time_on_mr_seconds: timeOnMrSeconds, trigger });
}

/** Track MR unapproved by the current user */
export function trackMRUnapproved(mrId: number, trigger: 'button' | 'keyboard') {
  trackEvent('mr_unapproved', { mr_id: mrId, trigger });
}

/** Track a top-level comment posted on an MR */
export function trackCommentPosted(mrId: number) {
  trackEvent('comment_posted', { mr_id: mrId });
}

/** Track a reply posted on an MR discussion */
export function trackReplyPosted(mrId: number) {
  trackEvent('reply_posted', { mr_id: mrId });
}

/** Track switching to the history tab inside a pipeline detail view */
export function trackPipelineHistoryTabOpened(projectId: number, pipelineId: number) {
  trackEvent('pipeline_history_tab_opened', { project_id: projectId, pipeline_id: pipelineId });
}

/** Track selecting a different pipeline from the history tab */
export function trackPipelineHistorySelected(projectId: number, pipelineId: number) {
  trackEvent('pipeline_history_selected', { project_id: projectId, pipeline_id: pipelineId });
}

/** Track a keyboard shortcut that fired an action */
export function trackShortcut(key: string, action: string, context: string) {
  trackEvent('shortcut_used', { key, action, context });
}
