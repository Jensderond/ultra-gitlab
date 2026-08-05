interface SuggestEditControlsProps {
  editMode: boolean;
  /** Highlighter grammar loaded — entering edit mode is safe. */
  editReady: boolean;
  /** Content differs from the original — confirm is meaningful. */
  hasEdits: boolean;
  onEnter: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Floating pill in the diff pane that enters/leaves suggestion edit mode. */
export default function SuggestEditControls({
  editMode,
  editReady,
  hasEdits,
  onEnter,
  onConfirm,
  onCancel,
}: SuggestEditControlsProps) {
  return (
    <div className="suggest-edit-controls">
      {!editMode ? (
        <button
          className="suggest-edit-btn"
          onClick={onEnter}
          disabled={!editReady}
          title={editReady ? 'Edit the diff to author a suggestion' : 'Preparing editor…'}
        >
          Suggest edit
        </button>
      ) : (
        <>
          <button className="suggest-edit-cancel" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="suggest-edit-confirm"
            onClick={onConfirm}
            disabled={!hasEdits}
            title={hasEdits ? 'Turn your edit into a suggestion comment' : 'Make an edit first'}
          >
            Create suggestion
          </button>
        </>
      )}
    </div>
  );
}
