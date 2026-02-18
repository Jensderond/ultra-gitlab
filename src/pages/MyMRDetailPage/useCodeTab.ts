/**
 * Hook for lazy-loading Code tab data and file navigation.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { getMergeRequestFiles, getDiffRefs, getGitattributesPatterns } from '../../services/gitlab';
import { getCollapsePatterns } from '../../services/tauri';
import { classifyFiles } from '../../utils/classifyFiles';
import { useFileContent } from '../../hooks/useFileContent';
import { isImageFile } from '../../components/Monaco/languageDetection';
import type { MergeRequest, DiffFileSummary, DiffRefs } from '../../types';
import type { MonacoDiffViewerRef } from '../../components/Monaco/MonacoDiffViewer';

export interface CodeTabState {
  files: DiffFileSummary[];
  reviewableFiles: DiffFileSummary[];
  selectedFile: string | null;
  fileFocusIndex: number;
  generatedPaths: Set<string>;
  hideGenerated: boolean;
  diffRefs: DiffRefs | null;
  codeTabLoaded: boolean;
  fileContent: { original: string; modified: string };
  imageContent: { originalBase64: string | null; modifiedBase64: string | null };
  fileContentLoading: boolean;
  diffViewerRef: React.RefObject<MonacoDiffViewerRef | null>;
  handleFileSelect: (filePath: string) => void;
  navigateFile: (direction: 1 | -1) => void;
  toggleHideGenerated: () => void;
}

export function useCodeTab(
  mrId: number,
  mr: MergeRequest | null,
  activeTab: string,
): CodeTabState {
  const diffViewerRef = useRef<MonacoDiffViewerRef>(null);
  const [files, setFiles] = useState<DiffFileSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [fileFocusIndex, setFileFocusIndex] = useState(0);
  const [generatedPaths, setGeneratedPaths] = useState<Set<string>>(new Set());
  const [hideGenerated, setHideGenerated] = useState(true);
  const [diffRefs, setDiffRefs] = useState<DiffRefs | null>(null);
  const [codeTabLoaded, setCodeTabLoaded] = useState(false);

  const reviewableFiles = useMemo(
    () => files.filter((f) => !generatedPaths.has(f.newPath)),
    [files, generatedPaths]
  );

  const {
    content: fileContent,
    imageContent,
    isLoading: fileContentLoading,
  } = useFileContent(mrId, mr, diffRefs, files, selectedFile, reviewableFiles);

  // Track image→text transitions to re-layout Monaco
  const wasImageRef = useRef(false);
  useEffect(() => {
    const isImage = selectedFile ? isImageFile(selectedFile) : false;
    if (wasImageRef.current && !isImage && selectedFile) {
      requestAnimationFrame(() => {
        diffViewerRef.current?.layout();
      });
    }
    wasImageRef.current = isImage;
  }, [selectedFile]);

  // Lazy-load Code tab data on first activation
  useEffect(() => {
    if (activeTab !== 'code' || codeTabLoaded || !mr) return;
    const currentMr = mr;

    async function loadCodeData() {
      try {
        const [filesData, diffRefsData] = await Promise.all([
          getMergeRequestFiles(mrId),
          getDiffRefs(mrId).catch(() => null),
        ]);

        setDiffRefs(diffRefsData);

        const summaries: DiffFileSummary[] = filesData.map((f) => ({
          newPath: f.newPath,
          oldPath: f.oldPath,
          changeType: f.changeType,
          additions: f.additions,
          deletions: f.deletions,
        }));
        setFiles(summaries);

        const [gitattributes, userPatterns] = await Promise.all([
          getGitattributesPatterns(currentMr.instanceId, currentMr.projectId).catch(() => []),
          getCollapsePatterns().catch(() => []),
        ]);

        const { reviewable, generated } = classifyFiles(summaries, gitattributes, userPatterns);
        setGeneratedPaths(generated);

        if (reviewable.length > 0) {
          setSelectedFile(reviewable[0].newPath);
          const fullIndex = summaries.findIndex((f) => f.newPath === reviewable[0].newPath);
          if (fullIndex >= 0) setFileFocusIndex(fullIndex);
        }

        setCodeTabLoaded(true);
      } catch {
        // Silently handle — files just won't load
      }
    }
    loadCodeData();
  }, [activeTab, codeTabLoaded, mr, mrId]);

  const handleFileSelect = useCallback((filePath: string) => {
    setSelectedFile(filePath);
    const index = files.findIndex((f) => f.newPath === filePath);
    if (index >= 0) setFileFocusIndex(index);
  }, [files]);

  const navigateFile = useCallback(
    (direction: 1 | -1) => {
      if (reviewableFiles.length === 0) return;
      const currentIdx = reviewableFiles.findIndex((f) => f.newPath === selectedFile);
      let nextIdx: number;
      if (currentIdx === -1) {
        nextIdx = direction === 1 ? 0 : reviewableFiles.length - 1;
      } else {
        nextIdx = currentIdx + direction;
        if (nextIdx < 0) nextIdx = reviewableFiles.length - 1;
        if (nextIdx >= reviewableFiles.length) nextIdx = 0;
      }
      const nextFile = reviewableFiles[nextIdx];
      const fullIndex = files.findIndex((f) => f.newPath === nextFile.newPath);
      if (fullIndex >= 0) setFileFocusIndex(fullIndex);
      setSelectedFile(nextFile.newPath);
    },
    [reviewableFiles, files, selectedFile]
  );

  const toggleHideGenerated = useCallback(() => {
    setHideGenerated((prev) => !prev);
  }, []);

  return {
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
    diffViewerRef,
    handleFileSelect,
    navigateFile,
    toggleHideGenerated,
  };
}
