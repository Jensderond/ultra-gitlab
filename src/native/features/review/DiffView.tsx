/**
 * The diff itself, rendered by @pierre/diffs (syntax highlighting in the
 * worker pool mounted in App). Notes are injected as line annotations.
 */

import { memo, useMemo, useRef, type ReactNode } from 'react';
import { FileDiff, type DiffLineAnnotation, type FileDiffOptions, type SelectedLineRange } from '@pierre/diffs/react';
import type { DiffModel } from './diff';

export type Side = 'new' | 'old';

export interface LineRef {
  side: Side;
  line: number;
  context: boolean;
}

export interface AnnotationGroup {
  key: string;
  side: Side;
  /** 0 = above the first hunk. */
  line: number;
  content: ReactNode;
}

const toPierreSide = (side: Side) => (side === 'new' ? 'additions' : 'deletions');
const fromPierreSide = (side: string | undefined): Side => (side === 'deletions' ? 'old' : 'new');

/**
 * Styles inside Pierre's shadow root. Document tokens inherit into it, so
 * the diff follows the app's light/dark palette.
 */
const UNSAFE_CSS = `
:host { --diffs-gap-block: 0px; }
[data-separator] { font-family: var(--font-ui); font-size: 12px; }
[data-separator-content] { color: var(--diff-hunk-text); }
[data-expand-button] { color: var(--diff-hunk-text); }
[data-expand-button]:hover, [data-separator-content]:hover { color: var(--accent); }
[data-line-type=change-addition]:is([data-line], [data-no-newline], [data-column-number], [data-gutter-buffer]) {
  --diffs-computed-diff-line-bg: var(--diff-add);
}
[data-line-type=change-deletion]:is([data-line], [data-no-newline], [data-column-number], [data-gutter-buffer]) {
  --diffs-computed-diff-line-bg: var(--diff-del);
}
/* Notes sit on the plain background: no hover or selection tint behind them. */
[data-line-annotation], [data-gutter-buffer=annotation] { --diffs-line-bg: var(--diffs-bg); }
[data-column-number] { cursor: pointer; }
[data-utility-button] { border-radius: 5px; }
`;

interface Props {
  model: DiffModel;
  viewMode: 'unified' | 'split';
  groups: AnnotationGroup[];
  selected: SelectedLineRange | null;
  /** Commenting is limited to one side (e.g. "since my last review" only knows the new side). */
  commentSides: Side[];
  onComment: (ref: LineRef) => void;
  onHover: (ref: LineRef | null) => void;
  onSelect: (ref: LineRef | null) => void;
}

export const DiffView = memo(function DiffView({
  model,
  viewMode,
  groups,
  selected,
  commentSides,
  onComment,
  onHover,
  onSelect,
}: Props) {
  // Pierre keeps its options object; route callbacks through a ref so a new
  // render never forces it to re-render the whole file.
  const handlers = useRef({ onComment, onHover, onSelect, commentSides });
  handlers.current = { onComment, onHover, onSelect, commentSides };

  const options = useMemo<FileDiffOptions<AnnotationGroup, undefined>>(
    () => ({
      theme: { dark: 'pierre-dark', light: 'pierre-light' },
      themeType: 'system',
      diffStyle: viewMode,
      disableFileHeader: true,
      lineDiffType: 'word',
      hunkSeparators: 'line-info',
      overflow: 'scroll',
      diffIndicators: 'classic',
      lineHoverHighlight: 'both',
      enableLineSelection: true,
      enableGutterUtility: true,
      unsafeCSS: UNSAFE_CSS,
      onGutterUtilityClick: (range) => {
        const side = fromPierreSide(range.endSide ?? range.side);
        if (!handlers.current.commentSides.includes(side)) return;
        handlers.current.onComment({ side, line: range.end, context: false });
      },
      onLineNumberClick: (props) => {
        const side = fromPierreSide(props.annotationSide);
        if (!handlers.current.commentSides.includes(side)) return;
        handlers.current.onComment({
          side,
          line: props.lineNumber,
          context: props.lineType === 'context' || props.lineType === 'context-expanded',
        });
      },
      onLineEnter: (props) =>
        handlers.current.onHover({
          side: fromPierreSide(props.annotationSide),
          line: props.lineNumber,
          context: props.lineType === 'context' || props.lineType === 'context-expanded',
        }),
      onLineLeave: () => handlers.current.onHover(null),
      onLineSelected: (range) =>
        handlers.current.onSelect(
          range ? { side: fromPierreSide(range.endSide ?? range.side), line: range.end, context: false } : null,
        ),
    }),
    [viewMode],
  );

  const annotations = useMemo<DiffLineAnnotation<AnnotationGroup>[]>(
    () => groups.map((g) => ({ side: toPierreSide(g.side), lineNumber: g.line, metadata: g })),
    [groups],
  );

  return (
    <FileDiff<AnnotationGroup>
      className="rv-diff"
      fileDiff={model.fileDiff}
      options={options}
      lineAnnotations={annotations}
      selectedLines={selected}
      renderAnnotation={(a) => (
        <div key={a.metadata.key} className="rv-annotation">
          {a.metadata.content}
        </div>
      )}
    />
  );
});
