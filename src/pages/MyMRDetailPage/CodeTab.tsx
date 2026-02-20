/**
 * Code tab for MyMRDetailPage — file navigation + diff viewer.
 */

import { FileNavigation } from '../../components/DiffViewer';
import { PierreDiffViewer } from '../../components/PierreDiffViewer';
import { ImageDiffViewer } from '../../components/Monaco/ImageDiffViewer';
import { isImageFile, getImageMimeType } from '../../components/Monaco/languageDetection';
import type { CodeTabState } from './useCodeTab';

type CodeTabProps = Pick<
  CodeTabState,
  | 'files'
  | 'reviewableFiles'
  | 'selectedFile'
  | 'fileFocusIndex'
  | 'generatedPaths'
  | 'hideGenerated'
  | 'diffRefs'
  | 'codeTabLoaded'
  | 'fileContent'
  | 'imageContent'
  | 'fileContentLoading'
  | 'handleFileSelect'
  | 'toggleHideGenerated'
> & {
  mrIid: number;
};

export function CodeTab({
  files,
  reviewableFiles,
  selectedFile,
  fileFocusIndex,
  generatedPaths,
  hideGenerated,
  diffRefs,
  codeTabLoaded,
  fileContent,
  imageContent,
  fileContentLoading,
  mrIid,
  handleFileSelect,
  toggleHideGenerated,
}: CodeTabProps) {
  return (
    <div className="my-mr-code-tab">
      <aside className="my-mr-code-sidebar">
        <FileNavigation
          files={files}
          selectedPath={selectedFile ?? undefined}
          onSelect={handleFileSelect}
          focusIndex={fileFocusIndex}
          generatedPaths={generatedPaths}
          hideGenerated={hideGenerated}
          onToggleHideGenerated={toggleHideGenerated}
        />
      </aside>
      <main className="my-mr-code-main">
        {!codeTabLoaded ? (
          <div className="my-mr-code-loading">Loading files...</div>
        ) : selectedFile ? (
          <>
            {fileContentLoading && (
              <div className="my-mr-code-overlay">
                <div className="my-mr-code-spinner" />
              </div>
            )}

            {!fileContentLoading && !diffRefs && (
              <div className="my-mr-code-overlay">
                <div className="my-mr-code-loading">Diff information not available. Please sync first.</div>
              </div>
            )}

            {isImageFile(selectedFile) && !fileContentLoading && diffRefs && (
              <ImageDiffViewer
                originalBase64={imageContent.originalBase64 ?? ''}
                modifiedBase64={imageContent.modifiedBase64 ?? ''}
                filePath={selectedFile}
                mimeType={getImageMimeType(selectedFile)}
              />
            )}

            {!isImageFile(selectedFile) && !fileContentLoading && diffRefs && (
              <PierreDiffViewer
                oldContent={fileContent.original}
                newContent={fileContent.modified}
                filePath={selectedFile}
                viewMode="unified"
                mrIid={mrIid}
                sha={diffRefs.headSha}
              />
            )}
          </>
        ) : files.length > 0 && reviewableFiles.length === 0 ? (
          <div className="my-mr-code-loading">All files are generated. Click a file to view.</div>
        ) : (
          <div className="my-mr-code-loading">Select a file to view its diff</div>
        )}
      </main>
    </div>
  );
}
