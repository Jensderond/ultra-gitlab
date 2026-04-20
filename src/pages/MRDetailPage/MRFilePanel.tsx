import { FileNavigation } from '../../components/FileNavigation';
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
  changedSinceApprovalPaths: Set<string>;
  filterToChangedOnly: boolean;
  onSelect: (path: string) => void;
  onToggleHideGenerated: () => void;
  onToggleChangedFilter: () => void;
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
  changedSinceApprovalPaths,
  filterToChangedOnly,
  onSelect,
  onToggleHideGenerated,
  onToggleChangedFilter,
  onCloseMobileSidebar,
}: MRFilePanelProps) {
  return (
    <>
      {mobileSidebarOpen && isSmallScreen && (
        <div
          className="mobile-sidebar-backdrop"
          onClick={onCloseMobileSidebar}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') onCloseMobileSidebar();
          }}
          role="button"
          tabIndex={0}
          aria-label="Close sidebar"
        />
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
          changedSinceApprovalPaths={changedSinceApprovalPaths}
          filterToChangedOnly={filterToChangedOnly}
          onToggleChangedFilter={
            changedSinceApprovalPaths.size > 0 ? onToggleChangedFilter : undefined
          }
        />
      </aside>
    </>
  );
}
