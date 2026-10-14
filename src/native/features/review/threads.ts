/** Group flat GitLab notes into discussion threads. */

import type { Comment } from '../../api/types';

export interface Thread {
  /** Discussion id, or `note-<id>` for notes without one. */
  id: string;
  discussionId: string | null;
  root: Comment;
  replies: Comment[];
  resolved: boolean;
  /** GitLab only resolves threads (and diff notes); plain standalone comments can't be. */
  resolvable: boolean;
  filePath: string | null;
  side: 'new' | 'old';
  line: number | null;
  updatedAt: number;
}

export function buildThreads(comments: Comment[] | undefined): Thread[] {
  if (!comments) return [];
  const groups = new Map<string, Comment[]>();
  for (const c of comments) {
    if (c.system) continue;
    const id = c.discussionId ?? `note-${c.id}`;
    let list = groups.get(id);
    if (!list) groups.set(id, (list = []));
    list.push(c);
  }
  const threads: Thread[] = [];
  for (const [id, list] of groups) {
    list.sort((a, b) => a.createdAt - b.createdAt || a.id - b.id);
    const root = list.find((c) => c.parentId === null) ?? list[0];
    const replies = list.filter((c) => c !== root);
    const side = root.newLine !== null ? 'new' : 'old';
    threads.push({
      id,
      discussionId: root.discussionId,
      root,
      replies,
      resolved: root.resolved,
      resolvable: root.resolvable !== false,
      filePath: root.filePath,
      side,
      line: root.newLine ?? root.oldLine,
      updatedAt: Math.max(...list.map((c) => c.updatedAt || c.createdAt)),
    });
  }
  threads.sort((a, b) => a.root.createdAt - b.root.createdAt);
  return threads;
}

/** A plain-text one-liner from a Markdown body, for cards and summaries. */
export function snippet(body: string, max = 90): string {
  const text = body
    .replace(/```[\s\S]*?```/g, ' [code] ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[*_~>#]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
