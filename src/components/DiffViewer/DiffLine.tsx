/**
 * Single diff line component with syntax highlighting.
 *
 * Renders a line from a diff with proper styling for additions,
 * deletions, and context lines, along with syntax tokens.
 */

import type { DiffLine as DiffLineType, HighlightToken } from '../../types';
import './DiffLine.css';

interface DiffLineProps {
  /** The diff line data */
  line: DiffLineType;
  /** Whether this line is currently selected for commenting */
  selected?: boolean;
  /** Click handler for line selection */
  onClick?: () => void;
}

/**
 * Render content with syntax highlighting tokens.
 */
function renderHighlightedContent(content: string, tokens: HighlightToken[]): React.ReactNode {
  if (tokens.length === 0) {
    return content;
  }

  const result: React.ReactNode[] = [];
  let lastEnd = 0;

  // Sort tokens by start position
  const sortedTokens = [...tokens].sort((a, b) => a.start - b.start);

  for (const token of sortedTokens) {
    // Add unhighlighted text before this token
    if (token.start > lastEnd) {
      result.push(content.slice(lastEnd, token.start));
    }

    // Add highlighted token
    result.push(
      <span key={`${token.start}-${token.end}`} className={`hl-${token.class}`}>
        {content.slice(token.start, token.end)}
      </span>
    );

    lastEnd = token.end;
  }

  // Add remaining unhighlighted text
  if (lastEnd < content.length) {
    result.push(content.slice(lastEnd));
  }

  return result;
}

/**
 * Get line type class name.
 */
function getLineTypeClass(type: string): string {
  switch (type) {
    case 'add':
      return 'diff-line-add';
    case 'remove':
      return 'diff-line-remove';
    default:
      return 'diff-line-context';
  }
}

/**
 * Single diff line component.
 */
export default function DiffLine({ line, selected, onClick }: DiffLineProps) {
  const typeClass = getLineTypeClass(line.type);

  return (
    <div
      className={`diff-line ${typeClass} ${selected ? 'selected' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          onClick?.();
        }
      }}
    >
      <span className="diff-line-gutter">
        <span className="line-number old-line">
          {line.oldLineNumber !== null ? line.oldLineNumber : ''}
        </span>
        <span className="line-number new-line">
          {line.newLineNumber !== null ? line.newLineNumber : ''}
        </span>
        <span className="line-prefix">
          {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
        </span>
      </span>
      <span className="diff-line-content">
        <code>{renderHighlightedContent(line.content, line.tokens)}</code>
      </span>
    </div>
  );
}
