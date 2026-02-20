import { PierreDiffViewer } from '../../components/PierreDiffViewer';
import { ImageDiffViewer } from '../../components/Monaco/ImageDiffViewer';
import { isImageFile, getImageMimeType } from '../../components/Monaco/languageDetection';
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
  onRetry: () => void;
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
  onRetry,
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

  return (
    <main className="mr-detail-main">
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
          oldContent={fileContent.original}
          newContent={fileContent.modified}
          filePath={selectedFile}
          viewMode={viewMode}
          mrIid={mrIid}
          sha={diffRefs.headSha}
        />
      )}
    </main>
  );
}
