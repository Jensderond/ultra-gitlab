/** Shared state for the inline notes (threads, drafts, composer) in the diff and aside. */

import { createContext, useContext } from 'react';
import type { Draft, LineKind } from './state';
import type { Thread } from './threads';

export type ComposerTarget =
  | { kind: 'new'; filePath: string; side: 'new' | 'old'; line: number; lineKind: LineKind }
  | { kind: 'reply'; threadId: string }
  | { kind: 'edit'; draftId: string };

export const composerKey = (t: ComposerTarget) =>
  t.kind === 'new' ? `new:${t.filePath}:${t.side}:${t.line}` : t.kind === 'reply' ? `reply:${t.threadId}` : `edit:${t.draftId}`;

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
  /** Current text of a line, for "Suggest change". */
  lineText: (filePath: string, side: 'new' | 'old', line: number) => string | null;
}

export const ReviewContext = createContext<ReviewContextValue | null>(null);

export function useReview(): ReviewContextValue {
  const ctx = useContext(ReviewContext);
  if (!ctx) throw new Error('useReview outside ReviewContext');
  return ctx;
}
