import { FileNavigation } from '../../components/DiffViewer';
import type { DiffFileSummary } from '../../types';

interface MRFilePanelProps {
  files: DiffFileSummary[];
  selectedPath: string | null;
  focusIndex: number;
  viewedPaths: Set<string>;
  generatedPaths: Set<string>;
  hideGenerated: boolean;
  mobileSidebarOpen: boolean;
  isSmallScreen: boolean;
  onSelect: (path: string) => void;
  onToggleHideGenerated: () => void;
  onCloseMobileSidebar: () => void;
}

export default function MRFilePanel({
  files,
  selectedPath,
  focusIndex,
  viewedPaths,
  generatedPaths,
  hideGenerated,
  mobileSidebarOpen,
  isSmallScreen,
  onSelect,
  onToggleHideGenerated,
  onCloseMobileSidebar,
}: MRFilePanelProps) {
  return (
    <>
      {mobileSidebarOpen && isSmallScreen && (
        <div className="mobile-sidebar-backdrop" onClick={onCloseMobileSidebar} />
      )}
      <aside className={`mr-detail-sidebar${mobileSidebarOpen ? ' mobile-open' : ''}`}>
        <FileNavigation
          files={files}
          selectedPath={selectedPath ?? undefined}
          onSelect={onSelect}
          focusIndex={focusIndex}
          viewedPaths={viewedPaths}
          generatedPaths={generatedPaths}
          hideGenerated={hideGenerated}
          onToggleHideGenerated={onToggleHideGenerated}
        />
      </aside>
    </>
  );
}
