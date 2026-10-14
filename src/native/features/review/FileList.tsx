/** "Files · review order": the navigator on the left. */

import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import type { DiffFile } from '../../api/types';
import { Checkbox, cx } from '../../ui/components';
import { ChevronDown, ChevronRight, CommentIcon } from '../../ui/icons';
import { compact, splitPath } from '../../lib/format';
import { changeLabel, REVIEW_ORDER_HINT } from './order';

export interface FileRowInfo {
  ci: boolean;
  threads: number;
  drafts: number;
}

interface Props {
  reviewable: DiffFile[];
  generated: DiffFile[];
  selected: string | undefined;
  viewed: Set<string>;
  info: (path: string) => FileRowInfo;
  onSelect: (path: string) => void;
  onToggleViewed: (path: string) => void;
  onContextMenu: (e: MouseEvent, file: DiffFile) => void;
  loading: boolean;
  error?: Error;
  onRetry: () => void;
}

export function FileList({
  reviewable,
  generated,
  selected,
  viewed,
  info,
  onSelect,
  onToggleViewed,
  onContextMenu,
  loading,
  error,
  onRetry,
}: Props) {
  const selectedIsGenerated = generated.some((f) => f.newPath === selected);
  const [showGenerated, setShowGenerated] = useState(selectedIsGenerated);
  const listRef = useRef<HTMLDivElement>(null);
  const all = showGenerated || selectedIsGenerated ? [...reviewable, ...generated] : reviewable;

  // Keep the selected row in view (J/K from the diff, jumps from the aside).
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>('[aria-selected="true"]');
    row?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const i = all.findIndex((f) => f.newPath === selected);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const next = all[Math.max(0, Math.min(all.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))];
      if (next) onSelect(next.newPath);
    } else if (e.key === ' ' && selected) {
      e.preventDefault();
      onToggleViewed(selected);
    }
  };

  const row = (f: DiffFile, generatedRow: boolean) => {
    const { dir, name } = splitPath(f.newPath);
    const isSel = f.newPath === selected;
    const isViewed = viewed.has(f.newPath);
    const meta = info(f.newPath);
    const label = changeLabel(f);
    const renamedFrom = f.changeType === 'renamed' && f.oldPath ? ` from ${f.oldPath}` : '';
    const comments = meta.threads + meta.drafts;
    return (
      <div
        key={f.newPath}
        role="option"
        aria-selected={isSel}
        className={cx('rv-file', isSel && 'is-selected', isViewed && 'is-viewed', generatedRow && 'rv-file--generated')}
        onMouseDown={(e) => {
          if ((e.target as HTMLElement).closest('input')) return;
          onSelect(f.newPath);
        }}
        onContextMenu={(e) => onContextMenu(e, f)}
        title={f.newPath + renamedFrom}
      >
        {!generatedRow && (
          <span className="rv-file__check" onMouseDown={(e) => e.stopPropagation()}>
            <Checkbox checked={isViewed} onChange={() => onToggleViewed(f.newPath)} label={`Viewed ${f.newPath}`} />
          </span>
        )}
        <span className="rv-file__text">
          <span className="rv-file__name">{name}</span>
          <span className="rv-file__dir mono">
            {dir || '/'}
            {label ? ` · ${label}` : ''}
          </span>
        </span>
        <span className="rv-file__meta mono">
          <span className="tabular">
            <span className="rv-add">+{compact(f.additions)}</span> <span className="rv-del">−{compact(f.deletions)}</span>
          </span>
          {(meta.ci || comments > 0) && (
            <span className="rv-file__badges">
              {meta.ci && <span className="rv-badge rv-badge--ci" title="The failing pipeline points at this file">CI</span>}
              {comments > 0 && (
                <span
                  className="rv-badge rv-badge--comments"
                  title={`${meta.threads} discussion${meta.threads === 1 ? '' : 's'}${meta.drafts ? `, ${meta.drafts} pending` : ''}`}
                >
                  {comments}
                  <CommentIcon size={10} />
                </span>
              )}
            </span>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="rv-files">
      <div className="rv-files__head">
        <span className="ui-label" title={REVIEW_ORDER_HINT}>
          Files · review order
        </span>
        <span className="rv-files__hint" title="Next / previous file">
          J / K
        </span>
      </div>
      <div
        ref={listRef}
        className="rv-files__list"
        role="listbox"
        aria-label="Changed files"
        tabIndex={0}
        onKeyDown={onKeyDown}
      >
        {error && reviewable.length === 0 && (
          <div className="rv-inline-error">
            Couldn't load the changed files. {error.message}
            <button type="button" className="rv-link" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}
        {!error && !loading && reviewable.length === 0 && generated.length === 0 && (
          <div className="rv-files__empty">No changed files</div>
        )}
        {reviewable.map((f) => row(f, false))}
        {generated.length > 0 && (
          <div className="rv-generated">
            <button
              type="button"
              className="rv-generated__head"
              aria-expanded={showGenerated || selectedIsGenerated}
              onClick={() => setShowGenerated((v) => !v)}
              title="Lockfiles, bundles and files marked linguist-generated. Not counted in your progress."
            >
              {showGenerated || selectedIsGenerated ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              <span>Generated · not counted</span>
              <span className="rv-generated__count tabular">{generated.length}</span>
            </button>
            {(showGenerated || selectedIsGenerated) && generated.map((f) => row(f, true))}
          </div>
        )}
      </div>
    </div>
  );
}
