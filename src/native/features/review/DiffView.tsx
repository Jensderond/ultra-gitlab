/**
 * The diff itself, rendered by @pierre/diffs (syntax highlighting in the
 * worker pool mounted in App). Notes are injected as line annotations.
 * In edit mode the new version becomes editable, to author a suggestion.
 */

import { memo, useCallback, useMemo, useRef, type MutableRefObject, type ReactNode } from 'react';
import {
  EditProvider,
  FileDiff,
  type DiffLineAnnotation,
  type FileDiffOptions,
  type SelectedLineRange,
} from '@pierre/diffs/react';
import { Editor, type EditorChangeEvent, type EditorFactory, type EditorType } from '@pierre/diffs/edit';
import { orderPoints, type DiffModel, type LinePoint } from './diff';

export type Side = 'new' | 'old';

export interface LineRef {
  side: Side;
  /** The line itself, or the last line of a range. */
  line: number;
  context: boolean;
  /** First line of a multi-line range. */
  from?: LinePoint;
}

/** The editor of an edit session, e.g. to put the caret back after a dialog. */
export type DiffEditor = Editor<EditorType, AnnotationGroup, undefined>;

export interface AnnotationGroup {
  key: string;
  side: Side;
  /** 0 = above the first hunk. */
  line: number;
  content: ReactNode;
}

const toPierreSide = (side: Side) => (side === 'new' ? 'additions' : 'deletions');
const fromPierreSide = (side: string | undefined): Side => (side === 'deletions' ? 'old' : 'new');

/** A Pierre selection as a LineRef: top to bottom, `from` only for several lines. */
function rangeRef(model: DiffModel, range: SelectedLineRange): LineRef {
  const a: LinePoint = { side: fromPierreSide(range.side), line: range.start };
  const b: LinePoint = { side: fromPierreSide(range.endSide ?? range.side), line: range.end };
  const [first, last] = orderPoints(model, a, b);
  const single = first.side === last.side && first.line === last.line;
  return { side: last.side, line: last.line, context: false, ...(single ? {} : { from: first }) };
}

const isRange = (ref: LineRef | null): ref is LineRef & { from: LinePoint } => !!ref?.from;

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
  /** Make the new version editable; edits are reported, never applied. */
  edit?: boolean;
  onEditChange?: (contents: string) => void;
  /** Set to the editor while an edit session runs. */
  editorRef?: MutableRefObject<DiffEditor | null>;
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
  edit = false,
  onEditChange,
  editorRef,
}: Props) {
  // Pierre keeps its options object; route callbacks through a ref so a new
  // render never forces it to re-render the whole file.
  const handlers = useRef({ onComment, onHover, onSelect, onEditChange, commentSides, model });
  handlers.current = { onComment, onHover, onSelect, onEditChange, commentSides, model };
  // The last committed selection: shift-click on a line number comments on all of it.
  const range = useRef<LineRef | null>(null);
  const canComment = (ref: LineRef) =>
    handlers.current.commentSides.includes(ref.side) &&
    (!ref.from || handlers.current.commentSides.includes(ref.from.side));

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
      lineHoverHighlight: edit ? 'disabled' : 'both',
      enableLineSelection: !edit,
      enableGutterUtility: !edit,
      unsafeCSS: UNSAFE_CSS,
      // The gutter "+" comments on the selection, or on the lines you drag it over.
      onGutterUtilityClick: edit
        ? undefined
        : (selection) => {
            const ref = rangeRef(handlers.current.model, selection);
            if (canComment(ref)) handlers.current.onComment(ref);
          },
      onLineNumberClick: edit
        ? undefined
        : (props) => {
            const side = fromPierreSide(props.annotationSide);
            const sel = range.current;
            // Shift-click extends the selection; comment on all of it.
            if (props.event.shiftKey && isRange(sel)) {
              if (canComment(sel)) handlers.current.onComment(sel);
              return;
            }
            const ref: LineRef = {
              side,
              line: props.lineNumber,
              context: props.lineType === 'context' || props.lineType === 'context-expanded',
            };
            if (canComment(ref)) handlers.current.onComment(ref);
          },
      onLineEnter: (props) =>
        handlers.current.onHover({
          side: fromPierreSide(props.annotationSide),
          line: props.lineNumber,
          context: props.lineType === 'context' || props.lineType === 'context-expanded',
        }),
      onLineLeave: () => handlers.current.onHover(null),
      onLineSelected: (selection) => {
        const ref = selection ? rangeRef(handlers.current.model, selection) : null;
        range.current = ref;
        handlers.current.onSelect(ref);
      },
    }),
    [viewMode, edit],
  );

  const createEditor = useCallback<EditorFactory<AnnotationGroup, undefined>>(
    (type, editorOptions, key) => {
      const editor = new Editor(type, editorOptions, key);
      if (editorRef) editorRef.current = editor;
      return editor;
    },
    [editorRef],
  );
  const onEdit = useCallback(
    (e: EditorChangeEvent<'file-diff', AnnotationGroup, undefined>) => handlers.current.onEditChange?.(e.file.contents),
    [],
  );
  // Edits only ever become a suggestion: reject so Pierre restores the file.
  const onEditComplete = useCallback(() => 'reject' as const, []);

  const annotations = useMemo<DiffLineAnnotation<AnnotationGroup>[]>(
    () => groups.map((g) => ({ side: toPierreSide(g.side), lineNumber: g.line, metadata: g })),
    [groups],
  );

  return (
    <EditProvider createEditor={createEditor}>
      <FileDiff<AnnotationGroup>
        className={edit ? 'rv-diff is-editing' : 'rv-diff'}
        fileDiff={model.fileDiff}
        options={options}
        edit={edit}
        onEditChange={onEdit}
        onEditComplete={onEditComplete}
        lineAnnotations={annotations}
        selectedLines={edit ? null : selected}
        renderAnnotation={(a) => (
          <div key={a.metadata.key} className="rv-annotation">
            {a.metadata.content}
          </div>
        )}
      />
    </EditProvider>
  );
});
