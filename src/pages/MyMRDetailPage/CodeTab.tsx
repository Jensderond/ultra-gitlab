/**
 * Code tab for MyMRDetailPage — file navigation + diff viewer.
 */

import { useState } from 'react';
import { FileNavigation } from '../../components/FileNavigation';
import { PierreDiffViewer } from '../../components/PierreDiffViewer';
import { ImageDiffViewer } from '../../components/ImageDiffViewer';
import { isImageFile, getImageMimeType } from '../../utils/languageDetection';
import { FileIcon } from '../../components/icons';
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
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  return (
    <div className="my-mr-code-tab">
      <button
        type="button"
        className="my-mr-code-mobile-files-toggle"
        onClick={() => setMobileSidebarOpen(true)}
        aria-label="Show changed files"
      >
        <FileIcon size={16} />
        <span>{files.length} file{files.length === 1 ? '' : 's'}</span>
      </button>

      {mobileSidebarOpen && (
        <div
          className="my-mr-code-mobile-backdrop"
          onClick={() => setMobileSidebarOpen(false)}
        />
      )}

      <aside className={`my-mr-code-sidebar${mobileSidebarOpen ? ' mobile-open' : ''}`}>
        <FileNavigation
          files={files}
          selectedPath={selectedFile ?? undefined}
          onSelect={(path) => {
            handleFileSelect(path);
            setMobileSidebarOpen(false);
          }}
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
