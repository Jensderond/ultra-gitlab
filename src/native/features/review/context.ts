/** Shared state for the inline notes (threads, drafts, composer) in the diff and aside. */

import { createContext, useContext } from 'react';
import type { Comment } from '../../api/types';
import type { LinePoint, SuggestionSource } from './diff';
import type { Draft, LineKind } from './state';
import type { Thread } from './threads';

export type ComposerTarget =
  | {
      kind: 'new';
      filePath: string;
      /** The line the comment sits on: the last line of a range. */
      side: 'new' | 'old';
      line: number;
      lineKind: LineKind;
      /** First line of a multi-line comment. */
      from?: LinePoint;
    }
  | { kind: 'reply'; threadId: string }
  | { kind: 'edit'; draftId: string }
  /** One of your own comments already on GitLab. */
  | { kind: 'note'; commentId: number };

export const composerKey = (t: ComposerTarget) =>
  t.kind === 'new'
    ? `new:${t.filePath}:${t.from ? `${t.from.side}:${t.from.line}-` : ''}${t.side}:${t.line}`
    : t.kind === 'reply'
      ? `reply:${t.threadId}`
      : t.kind === 'edit'
        ? `edit:${t.draftId}`
        : `note:${t.commentId}`;

export interface ReviewContextValue {
  mrId: number;
  /** MR web URL, so Markdown can link !123, #123, @mentions and relative links. */
  baseUrl: string | undefined;
  me: string | null;
  avatars: Record<string, string> | undefined;
  composer: ComposerTarget | null;
  openComposer: (target: ComposerTarget | null) => void;
  drafts: Draft[];
  addDraft: (draft: Omit<Draft, 'id' | 'createdAt'>) => void;
  updateDraft: (id: string, body: string) => void;
  removeDraft: (id: string) => void;
  resolve: (thread: Thread, resolved: boolean) => Promise<void>;
  /** Change the body of one of your own posted comments. */
  editComment: (comment: Comment, body: string) => Promise<void>;
  /** The lines "Suggest change" replaces, from `from` (or just `to`) through `to`. */
  suggestion: (filePath: string, from: LinePoint | undefined, to: LinePoint) => SuggestionSource | null;
}

export const ReviewContext = createContext<ReviewContextValue | null>(null);

export function useReview(): ReviewContextValue {
  const ctx = useContext(ReviewContext);
  if (!ctx) throw new Error('useReview outside ReviewContext');
  return ctx;
}
