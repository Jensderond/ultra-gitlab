export interface SuggestionSelection {
  startLine: number;
  endLine: number;
  text: string;
}

export function extractSuggestionSelectionText(
  content: string,
  startLine: number,
  endLine: number
): string {
  if (!content) return '';

  const lines = content.replace(/\r\n/g, '\n').split('\n');
  return lines.slice(startLine - 1, endLine).join('\n');
}

export function buildGitLabSuggestionBlock(
  selection: SuggestionSelection,
  anchorLine = selection.endLine
): string {
  const linesAbove = Math.max(0, anchorLine - selection.startLine);
  const linesBelow = Math.max(0, selection.endLine - anchorLine);

  // An empty text must produce a bodiless block: GitLab treats zero body
  // lines as "remove these lines", but a single blank body line as
  // "replace with one blank line".
  const body = selection.text === '' ? '' : `${selection.text}\n`;
  return `\`\`\`suggestion:-${linesAbove}+${linesBelow}\n${body}\`\`\`\n`;
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
 * return the single changed region (full span if edits are disjoint).
 *
 * GitLab suggestions must replace at least one existing line, so pure
 * insertions are expanded to include an adjacent original line, repeated
 * unchanged in the replacement.
 */
export function computeEditedRegion(original: string, edited: string): EditedRegion | null {
  const origLines = original.replace(/\r\n/g, '\n').split('\n');
  const editLines = edited.replace(/\r\n/g, '\n').split('\n');

  let start = 0;
  const maxStart = Math.min(origLines.length, editLines.length);
  while (start < maxStart && origLines[start] === editLines[start]) start++;

  let origEnd = origLines.length - 1;
  let editEnd = editLines.length - 1;
  while (origEnd >= start && editEnd >= start && origLines[origEnd] === editLines[editEnd]) {
    origEnd--;
    editEnd--;
  }

  if (start > origEnd && start > editEnd) return null;

  const replacement = editLines.slice(start, editEnd + 1).join('\n');

  if (origEnd < start) {
    // Pure insertion: expand to replace one adjacent original line.
    if (start > 0) {
      const lineAbove = start; // 1-based number of the line above the insertion
      return { startLine: lineAbove, endLine: lineAbove, replacement: `${origLines[start - 1]}\n${replacement}` };
    }
    return { startLine: 1, endLine: 1, replacement: `${replacement}\n${origLines[0]}` };
  }

  return { startLine: start + 1, endLine: origEnd + 1, replacement };
}

