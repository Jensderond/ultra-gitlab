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

  return `\`\`\`suggestion:-${linesAbove}+${linesBelow}\n${selection.text}\n\`\`\`\n`;
}

