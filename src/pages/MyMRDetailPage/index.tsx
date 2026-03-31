/**
 * My MR Detail page — orchestrator.
 *
 * Tab-based detail view for author's own merge requests.
 * Tabs: Overview (default), Comments, Code
 */

import { useState, useReducer, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { openExternalUrl } from '../../services/transport';
import { useCopyToast } from '../../hooks/useCopyToast';
import BackButton from '../../components/BackButton';
import TabBar from '../../components/TabBar';
import { useMyMRData } from './useMyMRData';
import { useCodeTab } from './useCodeTab';
import { useMyMRKeyboard } from './useMyMRKeyboard';
import { useSettingsQuery } from '../../hooks/queries/useSettingsQuery';
import { mergeReducer, initialMergeState } from './mergeReducer';
import { OverviewTab } from './OverviewTab';
import { CommentsTab } from './CommentsTab';
import { CodeTab } from './CodeTab';
import type { MergeActions } from './MergeSection';
import { ShortcutBar } from '../../components/ShortcutBar';
import type { ShortcutDef } from '../../components/ShortcutBar';
import '../MyMRDetailPage.css';

type TabId = 'overview' | 'comments' | 'code';

const shortcuts: ShortcutDef[] = [
  { key: '1/2/3', label: 'tab' },
  { key: 'j/k', label: 'file' },
  { key: 'g', label: 'generated' },
  { key: '⌘↵', label: 'merge/rebase' },
  { key: 'o', label: 'open' },
  { key: 'y', label: 'yank link' },
  { key: 'Esc', label: 'back' },
];

export default function MyMRDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mrId = parseInt(id || '0', 10);

  const [showCopyToast, copyToClipboard] = useCopyToast();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [mergeState, mergeDispatch] = useReducer(mergeReducer, initialMergeState);

  const { mr, setMr, reviewers, loading, error, stale, threads, unresolvedCount, approvedCount, currentUser, handleDeleteComment, handleReply, handleResolve } =
    useMyMRData(mrId);

  const isMergedOrClosed = mr?.state === 'merged' || mr?.state === 'closed';

  const mergeActionsRef = useRef<MergeActions>({ merge: null, rebase: null });
  const { data: settings } = useSettingsQuery();
  const codeTab = useCodeTab(mrId, mr, activeTab);

  const goBack = useCallback(() => {
    navigate('/my-mrs');
  }, [navigate]);

  useMyMRKeyboard({
    goBack,
    setActiveTab,
    activeTab,
    webUrl: mr?.webUrl,
    copyToClipboard,
    navigateFile: codeTab.navigateFile,
    fileJumpCount: settings?.fileJumpCount,
    toggleHideGenerated: codeTab.toggleHideGenerated,
    mergeActionsRef,
  });

  if (loading) {
    return (
      <div className="my-mr-detail">
        <div className="my-mr-detail-loading">Loading...</div>
      </div>
    );
  }

  if (!mr) {
    return (
      <div className="my-mr-detail">
        <div className="my-mr-detail-error">
          <p>{error || 'MR not found'}</p>
          <button onClick={goBack}>Go Back</button>
        </div>
      </div>
    );
  }

  return (
    <div className="my-mr-detail">
      {(isMergedOrClosed || stale) && (
        <div className={`my-mr-state-banner ${isMergedOrClosed ? mr.state : 'merged'}`}>
          <span>
            {stale && !isMergedOrClosed
              ? 'This merge request is no longer available locally'
              : `This merge request has been ${mr.state === 'closed' ? 'closed' : 'merged'}`}
          </span>
          <div className="my-mr-state-banner-actions">
            {mr.webUrl && (
              <button className="my-mr-state-banner-btn" onClick={() => openExternalUrl(mr.webUrl)}>
                Open in GitLab
              </button>
            )}
            <button className="my-mr-state-banner-btn" onClick={goBack}>
              Go Back
            </button>
          </div>
        </div>
      )}

      <header className="my-mr-detail-header">
        <div className="my-mr-detail-title-row">
          <BackButton onClick={goBack} title="Back" />
          <span className="my-mr-detail-iid">!{mr.iid}</span>
          <h1>{mr.title}</h1>
        </div>
      </header>

      <TabBar<TabId>
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'comments', label: 'Comments', badge: unresolvedCount > 0 ? `(${unresolvedCount})` : undefined },
          { id: 'code', label: 'Code' },
        ]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      />

      <div className="my-mr-tab-content">
        {activeTab === 'overview' && (
          <OverviewTab
            mr={mr}
            reviewers={reviewers}
            approvedCount={approvedCount}
            mergeState={mergeState}
            mergeDispatch={mergeDispatch}
            mrId={mrId}
            setMr={setMr}
            mergeActionsRef={mergeActionsRef}
            onMerged={goBack}
          />
        )}

        {activeTab === 'comments' && (
          <CommentsTab threads={threads} currentUser={currentUser} onDelete={handleDeleteComment} onReply={handleReply} onResolve={handleResolve} />
        )}

        {activeTab === 'code' && (
          <CodeTab {...codeTab} mrIid={mr.iid} />
        )}
      </div>

      {showCopyToast && (
        <div className="copy-toast">Link copied</div>
      )}

      <footer className="my-mr-detail-footer">
        <ShortcutBar shortcuts={shortcuts} />
      </footer>
    </div>
  );
}
