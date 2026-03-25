/**
 * Comment overlay component for MR detail page.
 *
 * Extracted to isolate re-renders during comment typing from the diff viewer.
 */

import { useState, useCallback, useRef, forwardRef, useImperativeHandle, useEffect } from 'react';
import { useAddInlineCommentMutation } from '../hooks/queries/useAddInlineCommentMutation';
import type { LineComment } from './PierreDiffViewer/PierreDiffViewer';
import { buildGitLabSuggestionBlock } from '../utils/gitlabSuggestions';

export interface CursorPosition {
  line: number;
  isOriginal: boolean;
  /** True for unchanged (context) lines — GitLab requires both old_line and new_line. */
  isContext?: boolean;
}

export interface LineSelection {
  startLine: number;
  endLine: number;
  isOriginal: boolean;
  text: string;
}

export interface CommentOverlayRef {
  isVisible: () => boolean;
  open: (position: CursorPosition, selection: LineSelection | null, initialText?: string) => void;
  close: () => void;
}

interface CommentOverlayProps {
  mrId: number;
  selectedFile: string | null;
  onCommentAdded?: (comment: LineComment) => void;
}

interface CommentState {
  visible: boolean;
  position: CursorPosition | null;
  selection: LineSelection | null;
  text: string;
}

const EMPTY_STATE: CommentState = {
  visible: false,
  position: null,
  selection: null,
  text: '',
};

export const CommentOverlay = forwardRef<CommentOverlayRef, CommentOverlayProps>(
  function CommentOverlay({ mrId, selectedFile, onCommentAdded }, ref) {
    const [state, setState] = useState<CommentState>(EMPTY_STATE);
    const stateRef = useRef(state);
    stateRef.current = state;
    const visibleRef = useRef(false);
    const textareaRef = useRef<HTMLTextAreaElement | null>(null);
    const submitRef = useRef<() => void>(() => {});

    const { mutate: addInlineComment, isPending: submitting } = useAddInlineCommentMutation(mrId);

    const close = useCallback(() => {
      visibleRef.current = false;
      setState(EMPTY_STATE);
    }, []);

    const submit = useCallback(() => {
      const { text, position } = stateRef.current;
      if (!text.trim() || !selectedFile || !position) return;

      const request = {
        mrId,
        body: text.trim(),
        filePath: selectedFile,
        ...(position.isOriginal
          ? { oldLine: position.line }
          : { newLine: position.line }),
        ...(position.isContext && { isContextLine: true }),
      };

      addInlineComment(request, {
        onSuccess: (response) => {
          onCommentAdded?.({
            id: response.id,
            line: position.line,
            isOldLine: position.isOriginal,
            authorUsername: response.authorUsername,
            body: text.trim(),
            createdAt: response.createdAt,
          });
          close();
        },
        onError: (err) => {
          console.error('Failed to add comment:', err);
        },
      });
    }, [selectedFile, mrId, addInlineComment, onCommentAdded, close]);

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
        });
      },
      close,
    }), [close]);

    // Focus textarea when overlay opens
    useEffect(() => {
      if (state.visible && textareaRef.current) {
        const ta = textareaRef.current;
        ta.focus();
        ta.selectionStart = ta.value.length;
        ta.selectionEnd = ta.value.length;
      }
    }, [state.visible]);

    if (!state.visible || !state.position) return null;

    const displayStartLine = state.selection?.startLine ?? state.position.line;
    const displayEndLine = state.selection?.endLine ?? state.position.line;
    const showsLineRange = displayEndLine > displayStartLine;

    return (
      <div className="comment-input-overlay">
        <div className="comment-input-container">
          <div className="comment-input-header">
            <span>
              Add comment on {state.position.isOriginal ? 'old' : 'new'} line{' '}
              {displayStartLine}
              {showsLineRange && <span> &ndash; {displayEndLine}</span>}
            </span>
            <div className="comment-input-header-actions">
              <button
                className="comment-suggest-btn"
                title="Insert suggestion block"
                onClick={() => {
                  const sel = state.selection;
                  if (sel) {
                    const suggestion = buildGitLabSuggestionBlock(sel, state.position?.line);
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
            <textarea
              ref={textareaRef}
              className="comment-textarea"
              value={state.text}
              onChange={(e) => setState((prev) => ({ ...prev, text: e.target.value }))}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  submitRef.current();
                }
                if (e.key === 'Escape') {
                  e.preventDefault();
                  close();
                }
              }}
              placeholder="Write a comment... (Markdown supported)"
              disabled={submitting}
              rows={8}
            />
          </div>
          <div className="comment-input-actions">
            <span className="comment-input-hint">
              <kbd>⌘</kbd>+<kbd>Enter</kbd> to submit · <kbd>Esc</kbd> to cancel · <kbd>s</kbd> suggest
            </span>
            <button
              className="comment-input-submit"
              onClick={submit}
              disabled={!state.text.trim() || submitting}
            >
              {submitting ? 'Submitting...' : 'Add Comment'}
            </button>
          </div>
        </div>
      </div>
    );
  }
);
