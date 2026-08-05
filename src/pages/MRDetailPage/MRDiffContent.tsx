import { PierreDiffViewer } from '../../components/PierreDiffViewer';
import type { LineComment, DiffLineClickInfo } from '../../components/PierreDiffViewer/PierreDiffViewer';
import type { SelectedLineRange } from '../../components/PierreDiffViewer';
import { ImageDiffViewer } from '../../components/ImageDiffViewer';
import { isImageFile, getImageMimeType } from '../../utils/languageDetection';
import SuggestEditControls from './SuggestEditControls';
import { isIOS } from '../../services/transport';
import type { DiffRefs, DiffFileSummary } from '../../types';

interface MRDiffContentProps {
  selectedFile: string | null;
  files: DiffFileSummary[];
  reviewableFiles: DiffFileSummary[];
  diffRefs: DiffRefs | null;
  fileContent: { original: string; modified: string };
  imageContent: { originalBase64: string; modifiedBase64: string };
  fileContentLoading: boolean;
  fileContentError: string | null;
  viewMode: 'unified' | 'split';
  mrIid: number;
  instanceId?: number;
  comments?: LineComment[];
  onLineClick?: (info: DiffLineClickInfo) => void;
  onLineSelected?: (range: SelectedLineRange | null) => void;
  onRetry: () => void;
  currentUser?: string;
  onDeleteComment?: (commentId: number) => void;
  onReply?: (discussionId: string, parentId: number, body: string) => Promise<void>;
  onResolve?: (discussionId: string, resolved: boolean) => Promise<void>;
  bottomPadding?: number;
  editMode?: boolean;
  editReady?: boolean;
  hasEdits?: boolean;
  /** Remount key for the diff viewer — bumped when an edit session ends so
   *  pierre's edited document is discarded. */
  editSessionKey?: number;
  onEnterEditMode?: () => void;
  onConfirmEdit?: () => void;
  onCancelEdit?: () => void;
  onEditContentChange?: (contents: string) => void;
}

export default function MRDiffContent({
  selectedFile,
  files,
  reviewableFiles,
  diffRefs,
  fileContent,
  imageContent,
  fileContentLoading,
  fileContentError,
  viewMode,
  mrIid,
  instanceId,
  comments,
  onLineClick,
  onLineSelected,
  onRetry,
  currentUser,
  onDeleteComment,
  onReply,
  onResolve,
  bottomPadding,
  editMode,
  editReady,
  hasEdits,
  editSessionKey,
  onEnterEditMode,
  onConfirmEdit,
  onCancelEdit,
  onEditContentChange,
}: MRDiffContentProps) {
  if (!selectedFile) {
    if (files.length > 0 && reviewableFiles.length === 0) {
      return (
        <main className="mr-detail-main">
          <div className="all-generated-empty-state">
            <div className="all-generated-icon">~</div>
            <p className="all-generated-message">Nothing to see here &mdash; the robots wrote all of this.</p>
            <p className="all-generated-hint">Click any file in the sidebar to peek anyway.</p>
          </div>
        </main>
      );
    }
    return (
      <main className="mr-detail-main">
        <div className="no-file-selected">
          Select a file to view its diff
        </div>
      </main>
    );
  }

  const mainStyle = bottomPadding ? { paddingBottom: `${bottomPadding}vh` } : undefined;

  const showSuggestEdit =
    !isIOS &&
    !isImageFile(selectedFile) &&
    !fileContentLoading &&
    !fileContentError &&
    !!diffRefs &&
    !!onEnterEditMode;

  return (
    <main className="mr-detail-main" style={mainStyle}>
      {fileContentLoading && (
        <div className="file-loading-overlay">
          <div className="file-loading-spinner" />
        </div>
      )}

      {fileContentError && !fileContentLoading && (
        <div className="file-loading-overlay">
          <div className="file-error">
            <p>{fileContentError}</p>
            <button onClick={onRetry}>Retry</button>
          </div>
        </div>
      )}

      {!fileContentError && !fileContentLoading && !diffRefs && (
        <div className="file-loading-overlay">
          <div className="file-error">
            <p>Diff information not available. Please sync the merge request first.</p>
          </div>
        </div>
      )}

      {isImageFile(selectedFile) && !fileContentLoading && !fileContentError && diffRefs && (
        <ImageDiffViewer
          originalBase64={imageContent.originalBase64}
          modifiedBase64={imageContent.modifiedBase64}
          filePath={selectedFile}
          mimeType={getImageMimeType(selectedFile)}
        />
      )}

      {!isImageFile(selectedFile) && !fileContentLoading && !fileContentError && diffRefs && (
        <PierreDiffViewer
          key={editSessionKey}
          oldContent={fileContent.original}
          newContent={fileContent.modified}
          filePath={selectedFile}
          viewMode={viewMode}
          mrIid={mrIid}
          sha={diffRefs.headSha}
          comments={comments}
          instanceId={instanceId}
          onLineClick={onLineClick}
          onLineSelected={onLineSelected}
          currentUser={currentUser}
          onDeleteComment={onDeleteComment}
          onReply={onReply}
          onResolve={onResolve}
          editMode={editMode}
          onEditContentChange={onEditContentChange}
        />
      )}

      {showSuggestEdit && (
        <SuggestEditControls
          editMode={!!editMode}
          editReady={!!editReady}
          hasEdits={!!hasEdits}
          onEnter={onEnterEditMode!}
          onConfirm={onConfirmEdit ?? (() => {})}
          onCancel={onCancelEdit ?? (() => {})}
        />
      )}
    </main>
  );
}
