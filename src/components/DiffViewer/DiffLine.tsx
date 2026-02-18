/**
 * Single diff line component.
 *
 * Renders a line from a diff with proper styling for additions,
 * deletions, and context lines.
 */

import type { DiffLine as DiffLineType } from '../../types';
import './DiffLine.css';

interface DiffLineProps {
  /** The diff line data */
  line: DiffLineType;
  /** Whether this line is currently selected for commenting */
  selected?: boolean;
  /** Click handler for line selection */
  onClick?: () => void;
  /** Which side of split view this line is on (undefined = unified view) */
  splitSide?: 'left' | 'right';
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
export default function DiffLine({ line, selected, onClick, splitSide }: DiffLineProps) {
  const typeClass = getLineTypeClass(line.type);
  const splitClass = splitSide ? `diff-line-split diff-line-split-${splitSide}` : '';

  return (
    <div
      className={`diff-line ${typeClass} ${selected ? 'selected' : ''} ${splitClass}`}
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
        {splitSide ? (
          // Split view: show only relevant line number
          <>
            <span className="line-number">
              {splitSide === 'left'
                ? (line.oldLineNumber !== null ? line.oldLineNumber : '')
                : (line.newLineNumber !== null ? line.newLineNumber : '')}
            </span>
            <span className="line-prefix">
              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
            </span>
          </>
        ) : (
          // Unified view: show both line numbers
          <>
            <span className="line-number old-line">
              {line.oldLineNumber !== null ? line.oldLineNumber : ''}
            </span>
            <span className="line-number new-line">
              {line.newLineNumber !== null ? line.newLineNumber : ''}
            </span>
            <span className="line-prefix">
              {line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}
            </span>
          </>
        )}
      </span>
      <span className="diff-line-content">
        <code>{line.content}</code>
      </span>
    </div>
  );
}
