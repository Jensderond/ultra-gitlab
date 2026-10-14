/**
 * GitLab suggestions: the ```suggestion block format and turning an in-place
 * edit of the new file into one.
 */

/**
 * A ```suggestion block replacing the anchored line plus `above` lines before
 * it. An empty `text` makes a bodiless block, which GitLab reads as "remove
 * these lines" (a single blank body line would mean "replace with one blank
 * line").
 */
export function suggestionBlock(text: string, above: number): string {
  const body = text === '' ? '' : `${text}\n`;
  return `\`\`\`suggestion:-${Math.max(0, above)}+0\n${body}\`\`\``;
}

export interface EditedRegion {
  /** 1-based, inclusive, on the new side of the diff. */
  startLine: number;
  /** 1-based, inclusive. */
  endLine: number;
  /** Replacement text for the region; '' means "delete these lines". */
  replacement: string;
}

/**
 * Line-diff the original new-side content against the edited content and
 * return the single changed region (the full span if edits are disjoint).
 *
 * GitLab suggestions must replace at least one existing line, so a pure
 * insertion grows to include an adjacent original line, repeated unchanged in
 * the replacement.
 */
export function editedRegion(original: string, edited: string): EditedRegion | null {
  const before = original.replace(/\r\n/g, '\n').split('\n');
  const after = edited.replace(/\r\n/g, '\n').split('\n');

  let start = 0;
  const max = Math.min(before.length, after.length);
  while (start < max && before[start] === after[start]) start++;

  let beforeEnd = before.length - 1;
  let afterEnd = after.length - 1;
  while (beforeEnd >= start && afterEnd >= start && before[beforeEnd] === after[afterEnd]) {
    beforeEnd--;
    afterEnd--;
  }

  if (start > beforeEnd && start > afterEnd) return null;

  const replacement = after.slice(start, afterEnd + 1).join('\n');

  if (beforeEnd < start) {
    // Pure insertion: replace the line above it (or below, at the very top).
    if (start > 0) return { startLine: start, endLine: start, replacement: `${before[start - 1]}\n${replacement}` };
    return { startLine: 1, endLine: 1, replacement: `${replacement}\n${before[0]}` };
  }

  return { startLine: start + 1, endLine: beforeEnd + 1, replacement };
}
