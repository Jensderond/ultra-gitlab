/**
 * My MR Detail page — orchestrator.
 *
 * Tab-based detail view for author's own merge requests.
 * Tabs: Overview (default), Comments, Code
 */

import { useState, useReducer, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useCopyToast } from '../../hooks/useCopyToast';
import BackButton from '../../components/BackButton';
import TabBar from '../../components/TabBar';
import { useMyMRData } from './useMyMRData';
import { useCodeTab } from './useCodeTab';
import { useMyMRKeyboard } from './useMyMRKeyboard';
import { mergeReducer, initialMergeState } from './mergeReducer';
import { OverviewTab } from './OverviewTab';
import { CommentsTab } from './CommentsTab';
import { CodeTab } from './CodeTab';
import '../MyMRDetailPage.css';

type TabId = 'overview' | 'comments' | 'code';

export default function MyMRDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mrId = parseInt(id || '0', 10);

  const [showCopyToast, copyToClipboard] = useCopyToast();
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const [mergeState, mergeDispatch] = useReducer(mergeReducer, initialMergeState);

  const { mr, setMr, reviewers, loading, error, threads, unresolvedCount, approvedCount, currentUser, handleDeleteComment } =
    useMyMRData(mrId);

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
    toggleHideGenerated: codeTab.toggleHideGenerated,
  });

  if (loading) {
    return (
      <div className="my-mr-detail">
        <div className="my-mr-detail-loading">Loading...</div>
      </div>
    );
  }

  if (error || !mr) {
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
          />
        )}

        {activeTab === 'comments' && (
          <CommentsTab threads={threads} currentUser={currentUser} onDelete={handleDeleteComment} />
        )}

        {activeTab === 'code' && (
          <CodeTab {...codeTab} mrIid={mr.iid} />
        )}
      </div>

      {showCopyToast && (
        <div className="copy-toast">Link copied</div>
      )}

      <footer className="my-mr-detail-footer">
        <span className="keyboard-hint">
          <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> tab &middot;{' '}
          <kbd>j</kbd>/<kbd>k</kbd> file &middot;{' '}
          <span className="shortcut-underline">g</span>enerated &middot;{' '}
          <span className="shortcut-underline">o</span>pen &middot;{' '}
          <span className="shortcut-underline">y</span>ank link &middot;{' '}
          <kbd>Esc</kbd> back
        </span>
      </footer>
    </div>
  );
}
