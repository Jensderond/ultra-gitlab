/**
 * Comment overlay component for MR detail page.
 *
 * Extracted to isolate re-renders during comment typing from the diff viewer.
 */

import { useState, useCallback, useRef, forwardRef, useImperativeHandle } from 'react';
import Editor from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { invoke } from '../services/tauri';
import type { AddCommentRequest } from '../types';
import type { LineComment } from './PierreDiffViewer/PierreDiffViewer';

export interface CursorPosition {
  line: number;
  isOriginal: boolean;
}

export interface LineSelection {
  startLine: number;
  endLine: number;
  isOriginal: boolean;
  text: string;
}

interface CommentResponse {
  id: number;
  authorUsername: string;
  createdAt: number;
}

export interface CommentOverlayRef {
  isVisible: () => boolean;
  open: (position: CursorPosition, selection: LineSelection | null, initialText?: string) => void;
  close: () => void;
}

interface CommentOverlayProps {
  mrId: number;
  selectedFile: string | null;
  onCommentAdded: (comment: LineComment) => void;
}

interface CommentState {
  visible: boolean;
  position: CursorPosition | null;
  selection: LineSelection | null;
  text: string;
  submitting: boolean;
}

const EMPTY_STATE: CommentState = {
  visible: false,
  position: null,
  selection: null,
  text: '',
  submitting: false,
};

export const CommentOverlay = forwardRef<CommentOverlayRef, CommentOverlayProps>(
  function CommentOverlay({ mrId, selectedFile, onCommentAdded }, ref) {
    const [state, setState] = useState<CommentState>(EMPTY_STATE);
    const stateRef = useRef(state);
    stateRef.current = state;
    const visibleRef = useRef(false);
    const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
    const submitRef = useRef<() => void>(() => {});

    const close = useCallback(() => {
      visibleRef.current = false;
      setState(EMPTY_STATE);
    }, []);

    const submit = useCallback(async () => {
      const { text, position } = stateRef.current;
      if (!text.trim() || !selectedFile || !position) return;

      setState((prev) => ({ ...prev, submitting: true }));

      try {
        const request: AddCommentRequest = {
          mrId,
          body: text.trim(),
          filePath: selectedFile,
          ...(position.isOriginal
            ? { oldLine: position.line }
            : { newLine: position.line }),
        };

        const response = await invoke<CommentResponse>('add_comment', { input: request });

        onCommentAdded({
          id: response.id,
          line: position.line,
          isOldLine: position.isOriginal,
          authorUsername: response.authorUsername,
          body: text.trim(),
          createdAt: response.createdAt,
        });

        close();
      } catch (err) {
        console.error('Failed to add comment:', err);
        setState((prev) => ({ ...prev, submitting: false }));
      }
    }, [selectedFile, mrId, onCommentAdded, close]);

    submitRef.current = submit;

    useImperativeHandle(ref, () => ({
      isVisible: () => visibleRef.current,
      open: (position, selection, initialText = '') => {
        visibleRef.current = true;
        setState({
          visible: true,
          position,
          selection,
          text: initialText,
          submitting: false,
        });
        requestAnimationFrame(() => editorRef.current?.focus());
      },
      close,
    }), [close]);

    if (!state.visible || !state.position) return null;

    return (
      <div className="comment-input-overlay">
        <div className="comment-input-container">
          <div className="comment-input-header">
            <span>
              Add comment on {state.position.isOriginal ? 'old' : 'new'} line{' '}
              {state.position.line}
              {state.selection && state.selection.endLine > state.selection.startLine && (
                <span> &ndash; {state.selection.endLine}</span>
              )}
            </span>
            <div className="comment-input-header-actions">
              <button
                className="comment-suggest-btn"
                title="Insert suggestion block"
                onClick={() => {
                  const sel = state.selection;
                  if (sel) {
                    const linesAbove = 0;
                    const linesBelow = sel.endLine - sel.startLine;
                    const suggestion = `\`\`\`suggestion:-${linesAbove}+${linesBelow}\n${sel.text}\n\`\`\`\n`;
                    setState((prev) => ({ ...prev, text: prev.text + suggestion }));
                  } else {
                    setState((prev) => ({ ...prev, text: prev.text + '```suggestion:-0+0\n\n```\n' }));
                  }
                }}
              >
                Suggest
              </button>
              <button
                className="comment-input-close"
                onClick={close}
              >
                ✕
              </button>
            </div>
          </div>
          <div className="comment-editor-wrapper">
            <Editor
              height="180px"
              defaultLanguage="markdown"
              theme="vs-dark"
              value={state.text}
              onChange={(value) => setState((prev) => ({ ...prev, text: value ?? '' }))}
              onMount={(ed) => {
                editorRef.current = ed;
                ed.focus();
                const model = ed.getModel();
                if (model) {
                  const lastLine = model.getLineCount();
                  const lastCol = model.getLineMaxColumn(lastLine);
                  ed.setPosition({ lineNumber: lastLine, column: lastCol });
                }
                ed.addCommand(
                  2048 | 3,
                  () => { submitRef.current(); }
                );
              }}
              options={{
                minimap: { enabled: false },
                lineNumbers: 'off',
                scrollBeyondLastLine: false,
                wordWrap: 'on',
                fontSize: 13,
                fontFamily: '"SF Mono", Menlo, Monaco, "Courier New", monospace',
                padding: { top: 8, bottom: 8 },
                renderLineHighlight: 'none',
                overviewRulerLanes: 0,
                hideCursorInOverviewRuler: true,
                scrollbar: { vertical: 'auto', horizontal: 'hidden' },
                folding: false,
                glyphMargin: false,
                readOnly: state.submitting,
              }}
            />
          </div>
          <div className="comment-input-actions">
            <span className="comment-input-hint">
              <kbd>⌘</kbd>+<kbd>Enter</kbd> to submit · <kbd>Esc</kbd> to cancel · <kbd>s</kbd> suggest
            </span>
            <button
              className="comment-input-submit"
              onClick={submit}
              disabled={!state.text.trim() || state.submitting}
            >
              {state.submitting ? 'Submitting...' : 'Add Comment'}
            </button>
          </div>
        </div>
      </div>
    );
  }
);
