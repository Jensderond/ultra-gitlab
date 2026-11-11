/**
 * 2 · Reviewing a merge request: files in review order on the left, the diff
 * with inline discussions in the middle, the inspector on the right and a
 * one-line hint bar at the bottom. Comments are drafts until "Finish review".
 */

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { getFiletypeFromFileName, preloadHighlighter } from '@pierre/diffs';
import type { SelectedLineRange } from '@pierre/diffs/react';
import { api, isMac, openExternal } from '../../api/client';
import type { Comment, DiffFile, PipelineJob } from '../../api/types';
import { useKeys } from '../../app/keys';
import { back, cameFrom, navigate, paths, setSearchParams } from '../../app/router';
import {
  useAvatars,
  useComments,
  useDiffFiles,
  useDiffRefs,
  useMe,
  useMR,
  useMRPipelines,
  useReviewers,
} from '../../data/hooks';
import { getData, invalidate, setData } from '../../data/query';
import { preferredHighlighter } from '../../lib/diffsHighlighter';
import { humanize, plural, splitProject, stripDraft } from '../../lib/format';
import {
  Button,
  copyText,
  EmptyState,
  Kbd,
  Progress,
  Sheet,
  showContextMenu,
  Spinner,
  StatusIcon,
  toast,
  Toolbar,
  ToolbarTitle,
  usePresence,
  cx,
  type MenuEntry,
} from '../../ui/components';
import { ChevronLeft } from '../../ui/icons';
import { Body, Pane, Window } from '../../ui/layout';
import { usePipelineFailure } from '../pipelines/shared';
import { openShortcuts } from '../shortcuts/ShortcutsSheet';
import { useDiffViewMode } from '../settings/prefs';
import { Aside } from './Aside';
import { prefetchPair, useContentAt, useFilePair, useImagePair } from './content';
import { ReviewContext, type ComposerTarget, type ReviewContextValue } from './context';
import { cursorOf, cursorRef, diffRoot, firstVisibleRow, flash, keepInView, readRows, rowAt, type Cursor, type Row } from './cursor';
import { buildDiff, isVisible, lineKind, suggestionSource, type DiffModel } from './diff';
import { DiffView, type AnnotationGroup, type DiffEditor, type LineRef, type Side } from './DiffView';
import { FileList, type FileRowInfo } from './FileList';
import { FinishSheet, type Verdict } from './FinishSheet';
import { seedSuggestion } from './compose';
import { CiCallout, DraftCard, NewCommentCard, ThreadCard } from './Notes';
import { changeLabel, imageMime, isBinaryPath, isImagePath, looksBinary, orderFiles } from './order';
import {
  readDrafts,
  recordReview,
  removeDrafts,
  useDrafts,
  useGeneratedMatcher,
  useLastReview,
  useViewedFiles,
  type Draft,
} from './state';
import { editedRegion, suggestionBlock } from './suggest';
import { buildThreads, type Thread } from './threads';
import { ViewMenu } from './ViewMenu';
import './review.css';

/** Diffs with more changed lines than this start collapsed. */
const LARGE_DIFF = 1500;

type Mode = 'all' | 'since';

/** How long the inspector takes to close; matches --dur-exit. */
const ASIDE_EXIT_MS = 140;

/** Height of the file header that floats over the top of the diff scroller. */
const headHeight = (scroller: HTMLElement | null) =>
  scroller?.querySelector<HTMLElement>('.rv-filehead')?.offsetHeight ?? 0;

/** CI file references are repo-relative, but be lenient about prefixes. */
const sameFile = (location: string, path: string) =>
  location === path || location.endsWith(`/${path}`) || path.endsWith(`/${location}`);

/* ------------------------------------------------------------------------ */
/* Small pieces                                                             */
/* ------------------------------------------------------------------------ */

function Delayed({ ms = 200, children }: { ms?: number; children: ReactNode }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setShow(true), ms);
    return () => clearTimeout(t);
  }, [ms]);
  return show ? <>{children}</> : null;
}

const Loading = () => (
  <Delayed>
    <div className="rv-loading">
      <Spinner />
    </div>
  </Delayed>
);

function Calm({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rv-calm">
      <p className="rv-calm__title">{title}</p>
      {children && <div className="rv-calm__body">{children}</div>}
    </div>
  );
}

function InspectorIcon({ open }: { open: boolean }) {
  return (
    <svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
      <rect x="3" y="4.5" width="18" height="15" rx="2.5" />
      <path d="M15 4.5v15" />
      {open && <path d="M15.5 5h3a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2h-3z" fill="currentColor" stroke="none" opacity="0.35" />}
    </svg>
  );
}

/**
 * The inspector: a pane with its divider on the leading edge. The slot around
 * it animates its width when the inspector is shown or hidden (⌘⌥0); the pane
 * inside keeps its width, so its content doesn't reflow while it slides.
 */
function AsidePane({
  children,
  slotRef,
  state,
}: {
  children: ReactNode;
  slotRef: React.RefObject<HTMLDivElement | null>;
  state: 'open' | 'closed';
}) {
  const [width, setWidth] = useState(() => {
    try {
      return Number(localStorage.getItem('ug.pane.review-aside')) || 280;
    } catch {
      return 280;
    }
  });
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const target = e.currentTarget as HTMLElement;
    target.setPointerCapture(e.pointerId);
    document.body.classList.add('is-resizing');
    let latest = startW;
    const move = (ev: PointerEvent) => {
      latest = Math.min(480, Math.max(220, startW - (ev.clientX - startX)));
      setWidth(latest);
    };
    const up = () => {
      target.removeEventListener('pointermove', move);
      target.removeEventListener('pointerup', up);
      document.body.classList.remove('is-resizing');
      try {
        localStorage.setItem('ug.pane.review-aside', String(Math.round(latest)));
      } catch {
        /* ignore */
      }
    };
    target.addEventListener('pointermove', move);
    target.addEventListener('pointerup', up);
  };
  return (
    <div
      ref={slotRef}
      className="rv-aside-slot"
      data-state={state}
      style={{ '--rv-aside-w': `${width}px` } as React.CSSProperties}
    >
    <aside className="rv-aside" aria-label="Merge request details" inert={state === 'closed'}>
      <div
        className="rv-aside__divider"
        role="separator"
        aria-orientation="vertical"
        onPointerDown={onPointerDown}
        onDoubleClick={() => {
          setWidth(280);
          try {
            localStorage.removeItem('ug.pane.review-aside');
          } catch {
            /* ignore */
          }
        }}
      />
      {children}
    </aside>
    </div>
  );
}

function ImageDiff({ file, base, head }: { file: DiffFile; base: string | null; head: string | null }) {
  const mime = imageMime(file.newPath);
  const side = (label: string, data: string | null, empty: string) => (
    <figure className="rv-image__side">
      <figcaption className="ui-label">{label}</figcaption>
      <div className="rv-image__frame">
        {data ? (
          <img src={`data:${mime};base64,${data}`} alt={`${label}: ${file.newPath}`} draggable={false} />
        ) : (
          <span className="rv-image__empty">{empty}</span>
        )}
      </div>
    </figure>
  );
  return (
    <div className="rv-image">
      {side('Before', base, file.changeType === 'added' ? 'New image' : 'Not available')}
      {side('After', head, file.changeType === 'deleted' ? 'Deleted' : 'Not available')}
    </div>
  );
}

/** A LineRef as Pierre's selection, so the selected lines stay highlighted. */
const toSelection = (ref: LineRef): SelectedLineRange => {
  const pierre = (side: Side) => (side === 'new' ? 'additions' : 'deletions');
  const from = ref.from ?? ref;
  return {
    start: from.line,
    side: pierre(from.side),
    end: ref.line,
    ...(from.side !== ref.side ? { endSide: pierre(ref.side) } : {}),
  };
};

/**
 * Pierre's editor tokenizes on the main thread and drops keystrokes typed
 * before the file's grammar loads, so editing waits for it.
 */
function useGrammarReady(path: string | undefined, enabled: boolean): boolean {
  const [ready, setReady] = useState<string | null>(null);
  useEffect(() => {
    if (!enabled || !path) return;
    let cancelled = false;
    preloadHighlighter({
      themes: ['pierre-dark', 'pierre-light'],
      langs: [getFiletypeFromFileName(path)],
      preferredHighlighter,
    })
      .then(() => !cancelled && setReady(path))
      .catch(() => {
        /* Stay read-only. */
      });
    return () => {
      cancelled = true;
    };
  }, [path, enabled]);
  return enabled && !!path && ready === path;
}

/* ------------------------------------------------------------------------ */
/* Screen                                                                   */
/* ------------------------------------------------------------------------ */

export function ReviewScreen({ mrId, file }: { mrId: number; file?: string }) {
  const me = useMe();
  const mrQ = useMR(mrId);
  const mr = mrQ.data;
  const filesQ = useDiffFiles(mrId);
  const { data: refs } = useDiffRefs(mrId);
  const { data: comments } = useComments(mrId);
  const { data: reviewers } = useReviewers(mrId);
  const { data: pipelines } = useMRPipelines(mrId, { syncedStatus: mr?.headPipelineStatus });
  const isGenerated = useGeneratedMatcher(mr?.instanceId, mr?.projectId);
  const { viewed, setViewed } = useViewedFiles(mrId);
  const { drafts, add: addDraft, update: updateDraft, remove: removeDraft } = useDrafts(mrId);
  const lastReview = useLastReview(mrId);

  /* Files ----------------------------------------------------------------- */

  const { reviewable, generated } = useMemo(
    () => orderFiles(filesQ.data ?? [], isGenerated),
    [filesQ.data, isGenerated],
  );
  const ordered = useMemo(() => [...reviewable, ...generated], [reviewable, generated]);
  // Without a file in the URL, start at the first file you haven't viewed.
  const viewedRef = useRef(viewed);
  viewedRef.current = viewed;
  const current: DiffFile | undefined = useMemo(
    () =>
      ordered.find((f) => f.newPath === file) ??
      reviewable.find((f) => !viewedRef.current.has(f.newPath)) ??
      reviewable[0] ??
      generated[0],
    [ordered, file, reviewable, generated],
  );
  const path = current?.newPath;
  const currentIsGenerated = !!current && generated.includes(current);
  const reviewIndex = current ? reviewable.indexOf(current) : -1;

  useEffect(() => {
    if (path && path !== file) setSearchParams({ file: path });
  }, [path, file]);

  /* Threads, CI ----------------------------------------------------------- */

  const threads = useMemo(() => buildThreads(comments), [comments]);
  const commenters = useMemo(
    () => new Set(threads.flatMap((t) => [t.root, ...t.replies].map((c) => c.authorUsername))),
    [threads],
  );

  const pipeline = useMemo(
    () => (pipelines && pipelines.length ? [...pipelines].sort((a, b) => b.id - a.id)[0] : undefined),
    [pipelines],
  );
  const { data: failure } = usePipelineFailure(mr?.instanceId, mr?.projectId, pipeline?.id);
  const failedJob = failure?.failedJobs[0];
  const ciLocations = useMemo(() => (failure && failure.failedJobs.length ? failure.locations : []), [failure]);

  // Inspector: file discussions in review order, then general ones.
  const asideThreads = useMemo(() => {
    const rank = (t: Thread) => {
      const i = t.filePath ? ordered.findIndex((f) => f.newPath === t.filePath || f.oldPath === t.filePath) : -1;
      return i < 0 ? ordered.length + (t.filePath ? 0 : 1) : i;
    };
    return [...threads].sort((a, b) => rank(a) - rank(b) || (a.line ?? 0) - (b.line ?? 0));
  }, [threads, ordered]);

  const avatars = useAvatars(mr?.instanceId, [
    ...(me ? [me] : []),
    ...(mr ? [mr.authorUsername] : []),
    ...(reviewers ?? []).map((r) => r.username),
    ...commenters,
  ]);

  const rowInfo = useCallback(
    (p: string): FileRowInfo => {
      const f = ordered.find((x) => x.newPath === p);
      const match = (fp: string | null | undefined) => !!fp && (fp === p || (!!f?.oldPath && fp === f.oldPath));
      return {
        ci: ciLocations.some((l) => sameFile(l.path, p)),
        threads: threads.filter((t) => match(t.filePath)).length,
        drafts: drafts.filter((d) => !d.discussionId && match(d.filePath)).length,
      };
    },
    [ordered, ciLocations, threads, drafts],
  );

  /* Diff content ---------------------------------------------------------- */

  // Shared with Settings → Review ("default diff view"); stored on this Mac.
  const [viewMode, setViewMode] = useDiffViewMode();
  const [mode, setMode] = useState<Mode>('all');
  const sinceSha = lastReview && refs && lastReview.sha !== refs.headSha ? lastReview.sha : undefined;
  const effectiveMode: Mode = mode === 'since' && sinceSha ? 'since' : 'all';

  const [loadedLarge, setLoadedLarge] = useState<Set<string>>(() => new Set());
  const isImage = !!path && isImagePath(path);
  const isBinary = !!path && !isImage && isBinaryPath(path);
  const isLarge = !!current && current.additions + current.deletions > LARGE_DIFF && !loadedLarge.has(current.newPath);
  const wantText = !!current && !isImage && !isBinary && !isLarge;

  const pairQ = useFilePair(mr, refs, current, wantText);
  const pair = pairQ.data && pairQ.data.path === path && pairQ.data.sha === refs?.headSha ? pairQ.data : undefined;
  const sinceQ = useContentAt(mr, current, wantText && effectiveMode === 'since' ? sinceSha : undefined);
  const since = sinceQ.data && sinceQ.data.path === path && sinceQ.data.sha === sinceSha ? sinceQ.data : undefined;
  const imageQ = useImagePair(mr, refs, current, isImage);
  const image = imageQ.data && imageQ.data.path === path ? imageQ.data : undefined;

  const binaryContent = !!pair && (looksBinary(pair.base) || looksBinary(pair.head));

  const baseModel: DiffModel | undefined = useMemo(() => {
    if (!pair || !current || binaryContent) return undefined;
    return buildDiff(
      current.newPath,
      current.changeType === 'added' ? null : pair.base,
      current.changeType === 'deleted' ? null : pair.head,
      `${mrId}:${current.newPath}:${pair.sha}`,
      current.oldPath ?? undefined,
    );
  }, [pair, current, binaryContent, mrId]);

  const sinceModel: DiffModel | undefined = useMemo(() => {
    if (effectiveMode !== 'since' || !pair || !since || !current || binaryContent) return undefined;
    return buildDiff(
      current.newPath,
      since.text,
      current.changeType === 'deleted' ? null : pair.head,
      `${mrId}:${current.newPath}:${since.sha}..${pair.sha}`,
    );
  }, [effectiveMode, pair, since, current, binaryContent, mrId]);

  const model = effectiveMode === 'since' ? sinceModel : baseModel;
  const commentSides: Side[] = useMemo(() => (effectiveMode === 'since' ? ['new'] : ['new', 'old']), [effectiveMode]);

  // Warm the neighbours so J/K is instant.
  useEffect(() => {
    if (!pair || !mr || !refs || !current) return;
    const i = ordered.indexOf(current);
    for (const n of [ordered[i + 1], ordered[i - 1]]) {
      if (n && !isImagePath(n.newPath) && !isBinaryPath(n.newPath) && n.additions + n.deletions <= LARGE_DIFF) {
        prefetchPair(mr, refs, n);
      }
    }
  }, [pair, mr, refs, current, ordered]);

  /* Composer & context ---------------------------------------------------- */

  const [composer, setComposer] = useState<ComposerTarget | null>(null);
  const [selected, setSelected] = useState<SelectedLineRange | null>(null);
  const hoverRef = useRef<LineRef | null>(null);
  const selectRef = useRef<LineRef | null>(null);
  const composerRef = useRef(composer);
  composerRef.current = composer;

  // The line cursor is the selection, plus which end moves and who put it
  // there: one placed with the keyboard follows the mouse, a mouse selection
  // stays where you made it.
  const cursor = useRef<Cursor | null>(null);
  const cursorBy = useRef<'keys' | 'mouse' | null>(null);
  const select = useCallback((ref: LineRef | null, by: 'keys' | 'mouse' = 'mouse') => {
    selectRef.current = ref;
    cursor.current = ref ? cursorOf(ref) : null;
    cursorBy.current = ref ? by : null;
    setSelected(ref ? toSelection(ref) : null);
  }, []);
  // Scrolling moves lines under a resting pointer, which the browser reports
  // as pointer moves too. Only a pointer that changed position counts.
  const pointer = useRef<{ x: number; y: number; moved: boolean }>({ x: -1, y: -1, moved: false });
  const trackPointer = useCallback((e: React.PointerEvent) => {
    const p = pointer.current;
    pointer.current = { x: e.screenX, y: e.screenY, moved: p.x !== e.screenX || p.y !== e.screenY };
  }, []);

  // Suggest edit: the new version becomes editable; the edit turns into a
  // suggestion comment. Keyed by file, so switching files ends it.
  const [editingPath, setEditingPath] = useState<string | null>(null);
  const [edited, setEdited] = useState<string | null>(null);
  const canEdit = !!model && !!pair && !!current && current.changeType !== 'deleted' && !model.fileDiff.isPartial;
  const editing = canEdit && editingPath === path;
  const grammarReady = useGrammarReady(path, canEdit);
  const isChange = useCallback(
    (text: string | null) =>
      text !== null && !!pair && text.replace(/\r\n/g, '\n') !== pair.head.replace(/\r\n/g, '\n'),
    [pair],
  );
  // For rendering (Create suggestion enabled). Pierre reports changes a beat
  // late, so decisions read the editor itself through currentEdit().
  const hasEdits = editing && isChange(edited);
  const editorRef = useRef<DiffEditor | null>(null);
  const currentEdit = useCallback(
    (): string | null => (editing ? (editorRef.current?.getText() ?? edited) : null),
    [editing, edited],
  );
  // Leaving edit mode with changes asks first; this is what happens on "Discard".
  const [discardThen, setDiscardThen] = useState<(() => void) | null>(null);
  // The caret when the discard sheet opened, to put back on "Keep editing".
  const editView = useRef<ReturnType<DiffEditor['getViewState']> | null>(null);
  const askDiscard = useCallback((then: () => void) => {
    editView.current = editorRef.current?.getViewState() ?? null;
    setDiscardThen(() => then);
  }, []);
  const keepEditing = useCallback(() => {
    setDiscardThen(null);
    const editor = editorRef.current;
    const view = editView.current;
    editView.current = null;
    if (!editor) return;
    const restore = () => {
      if (view) editor.setViewState(view);
      editor.focus({ preventScroll: true });
    };
    // Right away, so the next keystroke lands in the editor while the sheet
    // is still animating out (its panel is inert and would drop focus to
    // <body>)…
    restore();
    // …and again once the sheet has handed focus back to the diff's host.
    requestAnimationFrame(restore);
  }, []);

  const resolve = useCallback(
    async (thread: Thread, resolved: boolean) => {
      if (!thread.discussionId) return;
      setData<Comment[]>(['mr', mrId, 'comments'], (prev) =>
        (prev ?? []).map((c) => (c.discussionId === thread.discussionId ? { ...c, resolved } : c)),
      );
      try {
        await api.resolve({ mrId, discussionId: thread.discussionId, resolved });
        toast(resolved ? 'Thread resolved' : 'Thread reopened');
      } catch (e) {
        toast(`Couldn't ${resolved ? 'resolve' : 'reopen'} the thread: ${(e as Error).message}`, { tone: 'error' });
        void invalidate(['mr', mrId, 'comments']);
      }
    },
    [mrId],
  );

  const editComment = useCallback(
    async (comment: Comment, body: string) => {
      if (body === comment.body) return;
      setData<Comment[]>(['mr', mrId, 'comments'], (prev) =>
        (prev ?? []).map((c) => (c.id === comment.id ? { ...c, body } : c)),
      );
      try {
        await api.editComment({ mrId, commentId: comment.id, body });
        toast('Comment updated');
      } catch (e) {
        toast(`Couldn't update the comment: ${(e as Error).message}`, { tone: 'error' });
        void invalidate(['mr', mrId, 'comments']);
      }
    },
    [mrId],
  );

  const ctx: ReviewContextValue = useMemo(
    () => ({
      mrId,
      baseUrl: mr?.webUrl,
      me,
      avatars,
      composer,
      openComposer: setComposer,
      drafts,
      addDraft: (d) => {
        addDraft(d);
        toast('Added to your review');
      },
      updateDraft,
      removeDraft,
      resolve,
      editComment,
      suggestion: (fp, from, to) => (fp === path ? suggestionSource(baseModel, from, to) : null),
    }),
    [mrId, mr?.webUrl, me, avatars, composer, drafts, addDraft, updateDraft, removeDraft, resolve, editComment, path, baseModel],
  );

  /* Annotations for the current file ------------------------------------- */

  const fileThreads = useMemo(
    () =>
      current
        ? threads.filter((t) => t.filePath && (t.filePath === current.newPath || t.filePath === current.oldPath))
        : [],
    [threads, current],
  );
  const fileDrafts = useMemo(
    () => (current ? drafts.filter((d) => !d.discussionId && d.filePath === current.newPath) : []),
    [drafts, current],
  );

  const openPipeline = useCallback(
    (job?: PipelineJob) => {
      if (!mr || !pipeline) return;
      navigate(paths.pipeline(mr.instanceId, mr.projectId, pipeline.id, job?.id ?? failedJob?.id));
    },
    [mr, pipeline, failedJob],
  );

  const groups: AnnotationGroup[] = useMemo(() => {
    if (!model || !current || editing) return [];
    type Item = { order: number; key: string; node: ReactNode };
    const map = new Map<string, { side: Side; line: number; items: Item[] }>();
    const put = (side: Side, line: number, order: number, key: string, node: ReactNode) => {
      // Notes on lines the diff doesn't show go above the first hunk.
      const visible = line > 0 && isVisible(model, side, line);
      const s: Side = visible ? side : 'new';
      const l = visible ? line : 0;
      const k = `${s}:${l}`;
      let g = map.get(k);
      if (!g) map.set(k, (g = { side: s, line: l, items: [] }));
      g.items.push({
        order,
        key,
        node:
          visible || line <= 0 ? (
            node
          ) : (
            <div className="rv-outside">
              <span className="rv-outside__label">
                {side === 'old' ? 'Old line' : 'Line'} {line} · outside the changed lines
              </span>
              {node}
            </div>
          ),
      });
    };

    if (failedJob) {
      const loc = ciLocations.find((l) => sameFile(l.path, current.newPath));
      if (loc) {
        const visible = !!loc.line && isVisible(model, 'new', loc.line);
        put(
          'new',
          visible ? loc.line! : 0,
          0,
          'ci',
          <CiCallout
            jobName={failedJob.name}
            excerpt={failure?.excerpt ?? failure?.headline ?? null}
            line={loc.line}
            outside={!visible}
            onShow={() => openPipeline(failedJob)}
          />,
        );
      }
    }
    for (const t of fileThreads) {
      if (!t.line) {
        put('new', 0, 1, `t:${t.id}`, <ThreadCard thread={t} />);
        continue;
      }
      if (effectiveMode === 'since' && t.side === 'old') continue;
      put(t.side, t.line, 1, `t:${t.id}`, <ThreadCard thread={t} />);
    }
    for (const d of fileDrafts) {
      if (!d.line || !d.side) continue;
      if (effectiveMode === 'since' && d.side === 'old') continue;
      put(d.side, d.line, 2, `d:${d.id}`, <DraftCard draft={d} />);
    }
    if (composer?.kind === 'new' && composer.filePath === current.newPath) {
      put(composer.side, composer.line, 3, 'composer', <NewCommentCard target={composer} />);
    }

    return [...map.entries()]
      .sort(([, a], [, b]) => a.line - b.line || (a.side === b.side ? 0 : a.side === 'old' ? -1 : 1))
      .map(([key, g]) => ({
        key: `${path}:${key}`,
        side: g.side,
        line: g.line,
        content: g.items
          .sort((a, b) => a.order - b.order)
          .map((i) => (
            <div key={i.key} className="rv-annotation__item">
              {i.node}
            </div>
          )),
      }));
  }, [model, current, editing, path, failedJob, failure, ciLocations, fileThreads, fileDrafts, composer, effectiveMode, openPipeline]);

  /* Navigation ------------------------------------------------------------ */

  const scrollRef = useRef<HTMLDivElement>(null);
  const positions = useRef(new Map<string, number>());
  const pendingJump = useRef<{ path: string; threadId: string } | null>(null);

  const rememberScroll = useCallback(() => {
    if (path && scrollRef.current) positions.current.set(path, scrollRef.current.scrollTop);
  }, [path]);

  const selectFile = useCallback(
    (next: string) => {
      rememberScroll();
      if (next === path) return;
      if (isChange(currentEdit())) {
        askDiscard(() => {
          setEditingPath(null);
          setEdited(null);
          setSearchParams({ file: next });
        });
        return;
      }
      select(null);
      hoverRef.current = null;
      setSearchParams({ file: next });
    },
    [path, rememberScroll, isChange, currentEdit, askDiscard, select],
  );

  // Restore the scroll position (or perform a pending jump) once the diff is there.
  const ready = !!model || !!image || isLarge || isBinary || binaryContent;
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el || !path || !ready) return;
    const jump = pendingJump.current;
    let frames = 0;
    let raf = 0;
    const attempt = () => {
      frames++;
      if (jump && jump.path === path) {
        const target = document.getElementById(`rv-thread-${jump.threadId}`);
        if (target) {
          pendingJump.current = null;
          target.scrollIntoView({ block: 'center' });
          flash(target);
          return;
        }
        if (frames < 40) raf = requestAnimationFrame(attempt);
        else pendingJump.current = null;
        return;
      }
      const saved = positions.current.get(path) ?? 0;
      if (el.scrollHeight - el.clientHeight >= saved || frames > 20) el.scrollTop = saved;
      else raf = requestAnimationFrame(attempt);
    };
    attempt();
    return () => cancelAnimationFrame(raf);
  }, [path, ready, effectiveMode]);

  const step = useCallback(
    (dir: 1 | -1) => {
      if (!current) return;
      // Generated files are only part of J/K once you're in them.
      const list = currentIsGenerated ? ordered : reviewable;
      const next = list[list.indexOf(current) + dir];
      if (next) selectFile(next.newPath);
    },
    [current, currentIsGenerated, ordered, reviewable, selectFile],
  );

  /**
   * ⇧J / ⇧K: step through the blocks of changed lines in this file. Blocks
   * come from the rendered diff (inside Pierre's shadow root): a changed row
   * starts a block when the row above it in the unified order isn't a change.
   * Gutter and content cells, in both columns of split view, share that order.
   */
  const lastChange = useRef<{ path: string; stop: number; top: number } | null>(null);
  const stepChange = useCallback(
    (dir: 1 | -1) => {
      const el = scrollRef.current;
      const root = diffRoot(el);
      if (!el || !root || !path) return;
      const cells = new Map<number, Element[]>();
      for (const cell of root.querySelectorAll('[data-line-index][data-line-type^="change-"]')) {
        const i = parseInt(cell.getAttribute('data-line-index') ?? '', 10);
        if (Number.isNaN(i)) continue;
        const row = cells.get(i);
        if (row) row.push(cell);
        else cells.set(i, [cell]);
      }
      const starts = [...cells.keys()].filter((i) => !cells.has(i - 1)).sort((a, b) => a - b);
      if (starts.length === 0) {
        toast('This file has no changed lines');
        return;
      }

      // A stop per block, its start a little below the top with some context
      // above it. A block taller than the window gets a stop per page as well,
      // so you read through it rather than skip to the next one.
      // The file header floats over the top of the scroller: what you see
      // starts below it.
      const head = headHeight(el);
      const view = el.clientHeight - head;
      const margin = Math.min(120, view / 4);
      const page = Math.max(48, view - margin - 48);
      const box = el.getBoundingClientRect();
      const y = (viewportY: number) => el.scrollTop + viewportY - box.top - head;
      const stops: { top: number; block: number | null }[] = [];
      for (const start of starts) {
        let end = start;
        while (cells.has(end + 1)) end++;
        const bottom = y(cells.get(end)![0].getBoundingClientRect().bottom);
        let top = y(cells.get(start)![0].getBoundingClientRect().top) - margin;
        stops.push({ top, block: start });
        while (top + view < bottom) {
          top += page;
          stops.push({ top, block: null });
        }
      }

      // Carry on from the stop you stepped to, unless you've scrolled since;
      // then start from what's on screen.
      const last = lastChange.current;
      let next: number;
      if (last && last.path === path && Math.abs(el.scrollTop - last.top) < 2) next = last.stop + dir;
      else if (dir === 1) {
        // At the top, the first block is already in view; if it runs on below
        // the window, page into it straight away.
        next = el.scrollTop >= 1 ? stops.findIndex((s) => s.top > el.scrollTop + 1) : stops[1]?.block === null ? 1 : 0;
      }
      else next = stops.map((s) => s.top < el.scrollTop - 1).lastIndexOf(true);
      if (next < 0 || next >= stops.length) {
        toast(dir === 1 ? 'Last change in this file — press J for the next file' : 'First change in this file');
        return;
      }

      const stop = stops[next];
      el.scrollTop = Math.max(0, stop.top);
      lastChange.current = { path, stop: next, top: el.scrollTop };
      if (stop.block === null) return;
      // Flash the block, so the step shows even when there's nothing to scroll.
      root.querySelectorAll('[data-ug-flash]').forEach((c) => c.removeAttribute('data-ug-flash'));
      void el.offsetWidth; // restart the animation
      for (let i = stop.block; cells.has(i); i++) cells.get(i)!.forEach((c) => c.setAttribute('data-ug-flash', ''));
      // …and put the line cursor on its first line, ready for C or ↓.
      const rows = readRows(el);
      const first = rows.find((r) => r.index === stop.block);
      if (first && !editing) select({ side: first.side, line: first.line, context: first.context }, 'keys');
    },
    [path, editing, select],
  );

  /**
   * ↑ / ↓: move the line cursor; with ⇧, extend the range from where it
   * started. Without a cursor it starts from the hovered line, else at the
   * top of what's on screen; one you've scrolled away from starts over there
   * too. False at either end of the file (the caller scrolls instead).
   */
  const moveCursor = useCallback(
    (dir: 1 | -1, extend: boolean): boolean => {
      const el = scrollRef.current;
      if (!el || !model || editing) return false;
      const rows = readRows(el);
      if (rows.length === 0) return false;
      const box = el.getBoundingClientRect();
      const top = box.top + headHeight(el);
      const onScreen = (r: Row | undefined) => {
        if (!r) return false;
        const b = r.el.getBoundingClientRect();
        return b.bottom > top && b.top < box.bottom;
      };
      const point = (r: Row) => ({ side: r.side, line: r.line });

      let at = rowAt(rows, cursor.current?.head);
      let anchor = extend ? cursor.current?.anchor : undefined;
      let next: number;
      if (at >= 0 && (extend || onScreen(rows[at]))) next = at + dir;
      else {
        at = rowAt(rows, hoverRef.current);
        if (onScreen(rows[at])) {
          next = at + dir;
          anchor = extend ? point(rows[at]) : undefined;
        } else {
          next = firstVisibleRow(rows, top, box.bottom);
          if (next < 0) next = dir === 1 ? 0 : rows.length - 1;
          anchor = undefined;
        }
      }
      if (next < 0 || next >= rows.length) return false;

      const head = point(rows[next]);
      const moved: Cursor = { anchor: anchor ?? head, head };
      const ref = cursorRef(rows, moved);
      if (!ref) return false;
      select(ref, 'keys');
      cursor.current = moved; // keep the anchor: select() reads a range top to bottom
      keepInView(el, rows[next].el, headHeight(el));
      return true;
    },
    [model, editing, select],
  );

  const markViewed = useCallback(() => {
    if (!current) return;
    const was = viewed.has(current.newPath);
    setViewed(current.newPath, !was);
    if (was || currentIsGenerated) return;
    const i = reviewable.indexOf(current);
    const rotated = [...reviewable.slice(i + 1), ...reviewable.slice(0, Math.max(0, i))];
    const next = rotated.find((f) => !viewed.has(f.newPath));
    if (next) selectFile(next.newPath);
    else toast('All files viewed — ⌘⇧↩ to finish your review');
  }, [current, viewed, setViewed, currentIsGenerated, reviewable, selectFile]);

  const jumpTo = useCallback(
    (t: Thread) => {
      if (!t.filePath) return;
      const target = ordered.find((f) => f.newPath === t.filePath || f.oldPath === t.filePath);
      if (!target) {
        toast('That file is no longer part of this merge request');
        return;
      }
      // The cursor lands on the thread's line, so ↑/↓ and C carry on from it.
      if (t.line) select({ side: t.side, line: t.line, context: false }, 'keys');
      if (t.side === 'old' && effectiveMode === 'since') setMode('all');
      if (target.newPath === path) {
        // Every jump is instant and marks where it landed (as ⇧J / ⇧K do).
        const card = document.getElementById(`rv-thread-${t.id}`);
        card?.scrollIntoView({ block: 'center' });
        flash(card);
      } else {
        rememberScroll();
        pendingJump.current = { path: target.newPath, threadId: t.id };
        setSearchParams({ file: target.newPath });
      }
    },
    [ordered, path, effectiveMode, rememberScroll, select],
  );

  const lastJumped = useRef<string | null>(null);
  const nextUnresolved = useCallback(
    (dir: 1 | -1) => {
      const fileIndex = (t: Thread) => ordered.findIndex((f) => f.newPath === t.filePath || f.oldPath === t.filePath);
      const open = threads
        .filter((t) => !t.resolved && t.resolvable && t.filePath && fileIndex(t) >= 0)
        .sort((a, b) => fileIndex(a) - fileIndex(b) || (a.line ?? 0) - (b.line ?? 0));
      if (open.length === 0) {
        const general = threads.some((t) => !t.resolved && t.resolvable && !t.filePath);
        toast(general ? 'Only general discussions are open — see the inspector' : 'No unresolved discussions');
        return;
      }
      let i = open.findIndex((t) => t.id === lastJumped.current);
      if (i < 0) {
        // Start from the file you're looking at.
        const here = current ? ordered.indexOf(current) : 0;
        const first = open.findIndex((t) => fileIndex(t) >= here);
        i = first < 0 ? (dir === 1 ? -1 : 0) : dir === 1 ? first - 1 : first;
      }
      const next = open[(i + dir + open.length) % open.length];
      lastJumped.current = next.id;
      jumpTo(next);
    },
    [threads, ordered, current, jumpTo],
  );

  const newTarget = useCallback(
    (ref: LineRef): Extract<ComposerTarget, { kind: 'new' }> | null =>
      current
        ? {
            kind: 'new',
            filePath: current.newPath,
            side: ref.side,
            line: ref.line,
            lineKind: lineKind(baseModel, ref.side, ref.line),
            ...(ref.from ? { from: ref.from } : {}),
          }
        : null,
    [current, baseModel],
  );

  const openComposerAt = useCallback(
    (ref: LineRef, by: 'keys' | 'mouse' = 'mouse') => {
      const target = newTarget(ref);
      if (!target) return;
      // Keep the lines highlighted while you write about them.
      select(ref, by);
      setComposer(target);
    },
    [newTarget, select],
  );

  /** The line cursor or selection, else the hovered line. */
  const lineForKey = useCallback(
    (key: string): LineRef | null => {
      if (!current || !model || editing) return null;
      const ref = selectRef.current ?? hoverRef.current;
      if (!ref) {
        toast(`Move to a line with ↑ ↓ (or hover one) first, then press ${key}`);
        return null;
      }
      if (!commentSides.includes(ref.side) || (ref.from && !commentSides.includes(ref.from.side))) {
        toast('While comparing since your last review, comment on the new version');
        return null;
      }
      return ref;
    },
    [current, model, editing, commentSides],
  );

  const commentOnLine = useCallback(() => {
    const ref = lineForKey('C');
    if (ref) openComposerAt(ref, cursorBy.current ?? 'keys');
  }, [lineForKey, openComposerAt]);

  const suggestOnLine = useCallback(() => {
    const ref = lineForKey('S');
    const target = ref && newTarget(ref);
    if (!ref || !target) return;
    const source = suggestionSource(baseModel, ref.from, ref);
    if (!source) {
      toast('Suggestions work on lines of the new version');
      return;
    }
    seedSuggestion(mrId, target, suggestionBlock(source.text, source.above));
    openComposerAt(ref, cursorBy.current ?? 'keys');
  }, [lineForKey, newTarget, baseModel, mrId, openComposerAt]);

  const onHover = useCallback(
    (ref: LineRef | null) => {
      hoverRef.current = ref;
      // A keyboard cursor follows the mouse, but only when the mouse itself
      // moved. Ranges and the lines of an open composer stay put.
      if (!ref || !pointer.current.moved || cursorBy.current !== 'keys') return;
      if (selectRef.current?.from || composerRef.current) return;
      if (selectRef.current?.side === ref.side && selectRef.current.line === ref.line) return;
      select(ref, 'keys');
    },
    [select],
  );
  const onSelect = useCallback(
    (ref: LineRef | null) => {
      // Pierre also reports the selection we just gave it: that isn't the mouse.
      const cur = selectRef.current;
      const same =
        !!ref &&
        !!cur &&
        ref.side === cur.side &&
        ref.line === cur.line &&
        ref.from?.side === cur.from?.side &&
        ref.from?.line === cur.from?.line;
      if (!same && (ref || cur)) select(ref, 'mouse');
    },
    [select],
  );
  const onComment = useCallback((ref: LineRef) => openComposerAt(ref, 'mouse'), [openComposerAt]);

  /* Suggest edit ---------------------------------------------------------- */

  const startEdit = useCallback(() => {
    if (!canEdit || !path) return;
    if (!grammarReady) {
      toast('Preparing the editor…');
      return;
    }
    setEdited(null);
    setComposer(null);
    select(null);
    setEditingPath(path);
  }, [canEdit, grammarReady, path, select]);

  const cancelEdit = useCallback(() => {
    setEditingPath(null);
    setEdited(null);
  }, []);

  /** Cancel, asking first when there's an edit to lose. */
  const requestCancelEdit = useCallback(() => {
    if (isChange(currentEdit())) askDiscard(cancelEdit);
    else cancelEdit();
  }, [isChange, currentEdit, cancelEdit, askDiscard]);

  const confirmEdit = useCallback(() => {
    const text = currentEdit();
    if (!editing || !pair || text === null) return;
    const region = editedRegion(pair.head, text);
    cancelEdit();
    if (!region) {
      toast('Nothing changed');
      return;
    }
    const ref: LineRef = {
      side: 'new',
      line: region.endLine,
      context: false,
      ...(region.startLine < region.endLine ? { from: { side: 'new' as const, line: region.startLine } } : {}),
    };
    const target = newTarget(ref);
    if (!target) return;
    seedSuggestion(mrId, target, suggestionBlock(region.replacement, region.endLine - region.startLine));
    openComposerAt(ref, 'keys');
  }, [editing, pair, currentEdit, cancelEdit, newTarget, mrId, openComposerAt]);

  // ⌘↩ creates the suggestion, Esc cancels. Pierre's editor binds both
  // (insert a blank line, simplify the selection), so take them in the
  // capture phase, before the editor sees them. Not while the discard sheet
  // is open: Esc there means "keep editing".
  const confirming = discardThen !== null;
  useEffect(() => {
    if (!editing || confirming) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.isComposing || e.shiftKey || e.altKey) return;
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (e.key === 'Escape' && !mod) {
        e.preventDefault();
        e.stopPropagation();
        requestCancelEdit();
      } else if (e.key === 'Enter' && mod) {
        e.preventDefault();
        e.stopPropagation();
        if (isChange(currentEdit())) confirmEdit();
        else toast('Make an edit first');
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [editing, confirming, isChange, currentEdit, confirmEdit, requestCancelEdit]);

  /* Layout preferences ---------------------------------------------------- */

  const [asideOpen, setAsideOpen] = useState(() => {
    try {
      const v = localStorage.getItem('ug.review.inspector');
      return v === null ? window.innerWidth >= 1100 : v === '1';
    } catch {
      return true;
    }
  });
  const toggleAside = useCallback(() => {
    setAsideOpen((open) => {
      try {
        localStorage.setItem('ug.review.inspector', open ? '0' : '1');
      } catch {
        /* ignore */
      }
      return !open;
    });
  }, []);
  const aside = usePresence<HTMLDivElement>(asideOpen, ASIDE_EXIT_MS, { appear: false });
  useEffect(() => {
    // ⌘⌥0 like Xcode's inspector. Matched on the physical key: ⌥ changes e.key.
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.altKey && e.code === 'Digit0') {
        e.preventDefault();
        toggleAside();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [toggleAside]);

  /* Finish ---------------------------------------------------------------- */

  const [finishOpen, setFinishOpen] = useState(false);
  const isMine = !!mr && !!me && mr.authorUsername === me;
  const approveHint = !mr
    ? null
    : isMine
      ? "You can't approve your own merge request"
      : mr.userHasApproved
        ? "You've already approved this merge request"
        : mr.state !== 'opened'
          ? `This merge request is ${mr.state}`
          : null;
  const inboxPath = paths.inbox(isMine ? 'mine' : 'review', mrId);
  // Back to where you came from (your inbox view, with this MR selected)
  // instead of stacking a new inbox entry on the history.
  const leaveReview = () => (cameFrom()?.startsWith('/inbox') ? back() : navigate(inboxPath));

  const publish = async (d: Draft) => {
    if (d.discussionId && d.parentId) {
      await api.reply({ mrId, discussionId: d.discussionId, parentId: d.parentId, body: d.body });
      return;
    }
    if (d.filePath && d.line) {
      // Added lines live on the new side, removed lines on the old side; for
      // unchanged lines the backend resolves the other side from the diff.
      const position =
        d.lineKind === 'add'
          ? { newLine: d.line }
          : d.lineKind === 'del'
            ? { oldLine: d.line }
            : d.side === 'old'
              ? { oldLine: d.line, isContextLine: true }
              : { newLine: d.line, isContextLine: true };
      await api.addComment({
        mrId,
        body: d.body,
        filePath: d.filePath,
        ...position,
        ...(d.from ? { lineRangeStart: d.from } : {}),
      });
      return;
    }
    await api.addComment({ mrId, body: d.body });
  };

  const submitReview = async ({ verdict, body }: { verdict: Verdict; body: string }) => {
    const queue = readDrafts(mrId);
    const posted: string[] = [];
    let bodyPosted = false;
    try {
      for (const d of queue) {
        await publish(d);
        posted.push(d.id);
      }
      if (body) await api.addComment({ mrId, body });
      bodyPosted = !!body;
      if (verdict === 'approve') await api.approve(mrId);
    } catch (e) {
      removeDrafts(mrId, posted);
      // Tell the sheet the overall comment went out, so a retry doesn't post it twice.
      if (bodyPosted && e instanceof Error) Object.assign(e, { bodyPosted: true });
      void invalidate(['mr', mrId]);
      const left = queue.length - posted.length;
      toast(
        `Couldn't finish the review: ${(e as Error).message}${left ? ` · ${plural(left, 'comment')} kept as drafts` : ''}`,
        { tone: 'error' },
      );
      throw e;
    }
    removeDrafts(mrId, posted);
    if (refs) recordReview(mrId, refs.headSha);
    setFinishOpen(false);
    void invalidate(['mr', mrId]);
    void invalidate(['mrs']);
    const parts = [
      verdict === 'approve' ? 'approved' : null,
      posted.length ? `${plural(posted.length, 'comment')} posted` : null,
    ].filter(Boolean);
    toast(parts.length ? `Review finished · ${parts.join(' · ')}` : 'Marked as reviewed');
    leaveReview();
  };

  /* Keyboard -------------------------------------------------------------- */

  const scrollBy = (dy: number) => scrollRef.current?.scrollBy({ top: dy, behavior: 'instant' });
  const page = () => (scrollRef.current?.clientHeight ?? 400) - headHeight(scrollRef.current) - 60;
  // ↑ / ↓ move the line cursor; where there are no lines (an image, the ends
  // of the file) they scroll, as they used to.
  const arrow = (dir: 1 | -1, extend: boolean) => {
    if (!moveCursor(dir, extend) && !extend) scrollBy(dir * 48);
  };
  const onChrome = (e: KeyboardEvent) =>
    !!(e.target as HTMLElement | null)?.closest?.('button, a, [role="listbox"], [role="option"]');

  useKeys(
    {
      j: () => step(1),
      k: () => step(-1),
      'shift+j': () => stepChange(1),
      'shift+k': () => stepChange(-1),
      v: () => markViewed(),
      n: () => nextUnresolved(1),
      'shift+n': () => nextUnresolved(-1),
      c: () => commentOnLine(),
      s: () => suggestOnLine(),
      e: () => (editing ? false : startEdit()),
      p: () => (pipeline ? openPipeline() : toast('There is no pipeline for this merge request')),
      o: () => void (mr && openExternal(mr.webUrl)),
      y: () => void (mr && copyText(mr.webUrl, 'Link copied')),
      'mod+shift+enter': () => setFinishOpen(true),
      // Esc backs out one step at a time: the edit, the comment, the line
      // cursor or selection, and only then the review itself.
      escape: () =>
        editing ? requestCancelEdit() : composer ? setComposer(null) : selected ? select(null) : leaveReview(),
      arrowdown: (e) => (onChrome(e) ? false : arrow(1, false)),
      arrowup: (e) => (onChrome(e) ? false : arrow(-1, false)),
      'shift+arrowdown': (e) => (onChrome(e) ? false : arrow(1, true)),
      'shift+arrowup': (e) => (onChrome(e) ? false : arrow(-1, true)),
      space: (e) => (onChrome(e) ? false : scrollBy(page())),
      'shift+space': (e) => (onChrome(e) ? false : scrollBy(-page())),
      // ↑ / ↓ go line by line, so these are how you cross a long diff. The
      // line cursor stays behind; the next ↑ / ↓ starts over on screen.
      pagedown: () => scrollBy(page()),
      pageup: () => scrollBy(-page()),
    },
    { enabled: !finishOpen },
  );

  /* File context menu ----------------------------------------------------- */

  const projectUrl = mr ? mr.webUrl.replace(/\/-\/merge_requests\/\d+.*$/, '') : '';
  const saveCollapse = async (patterns: string[]) => {
    setData(['settings', 'collapse-patterns'], patterns);
    try {
      await api.updateCollapsePatterns(patterns);
    } catch (e) {
      toast(`Couldn't save: ${(e as Error).message}`, { tone: 'error' });
    }
  };
  const fileMenu = (e: MouseEvent, f: DiffFile) => {
    const isViewed = viewed.has(f.newPath);
    const userPatterns = getData<string[]>(['settings', 'collapse-patterns']) ?? [];
    const collapsedByUser = userPatterns.includes(f.newPath);
    const blob =
      f.changeType === 'deleted'
        ? `${projectUrl}/-/blob/${refs?.baseSha ?? mr?.targetBranch}/${f.oldPath ?? f.newPath}`
        : `${projectUrl}/-/blob/${refs?.headSha ?? mr?.sourceBranch}/${f.newPath}`;
    const entries: MenuEntry[] = [
      { label: isViewed ? 'Mark as Not Viewed' : 'Mark as Viewed', action: () => setViewed(f.newPath, !isViewed) },
      { separator: true },
      { label: 'Copy Path', action: () => void copyText(f.newPath, 'Path copied') },
      { label: 'Open File in GitLab', action: () => void openExternal(blob) },
      { separator: true },
      collapsedByUser
        ? { label: 'Stop Collapsing This File', action: () => void saveCollapse(userPatterns.filter((p) => p !== f.newPath)) }
        : {
            label: 'Collapse as Generated',
            enabled: !generated.includes(f),
            action: () => void saveCollapse([...userPatterns, f.newPath]),
          },
    ];
    void showContextMenu(e, entries);
  };

  /* Render ---------------------------------------------------------------- */

  if (!mr && mrQ.error) {
    return (
      <Window>
        <Toolbar>
          <Button variant="plain" icon={<ChevronLeft size={14} />} onClick={() => navigate(paths.inbox())}>
            Inbox
          </Button>
        </Toolbar>
        <EmptyState
          title="This merge request isn't available"
          message={mrQ.error.message}
          action={<Button onClick={() => void mrQ.refetch()}>Try again</Button>}
        />
      </Window>
    );
  }

  const viewedCount = reviewable.filter((f) => viewed.has(f.newPath)).length;
  const project = mr ? splitProject(mr.projectName) : null;
  const navList = currentIsGenerated ? ordered : reviewable;
  const nextFile = current ? navList[navList.indexOf(current) + 1] : undefined;
  const isViewed = !!path && viewed.has(path);
  const status = pipeline?.status ?? mr?.headPipelineStatus ?? null;

  const textDiff = !!current && !isImage && !isBinary && !binaryContent;

  let body: ReactNode;
  if (!current) {
    body = filesQ.error ? (
      <Calm title="Couldn't load the changes">
        <p>{filesQ.error.message}</p>
        <Button onClick={() => void filesQ.refetch()}>Try again</Button>
      </Calm>
    ) : filesQ.loading || !mr ? (
      <Loading />
    ) : (
      <Calm title="No changes">This merge request doesn't change any files.</Calm>
    );
  } else if (isImage) {
    body = image ? <ImageDiff file={current} base={image.base} head={image.head} /> : <Loading />;
  } else if (isBinary || binaryContent) {
    const label = changeLabel(current);
    body = (
      <Calm title="Binary file not shown">
        {label === 'new' ? 'This binary file was added.' : label === 'deleted' ? 'This binary file was deleted.' : 'This binary file changed.'}
      </Calm>
    );
  } else if (isLarge) {
    body = (
      <Calm title="Large diff">
        <p>{current.additions + current.deletions} changed lines are collapsed to keep things quick.</p>
        <Button onClick={() => setLoadedLarge((s) => new Set(s).add(current.newPath))}>Load diff</Button>
      </Calm>
    );
  } else if (pairQ.error && !pair) {
    body = (
      <Calm title="Couldn't load this file">
        <p>{pairQ.error.message}</p>
        <Button onClick={() => void pairQ.refetch()}>Try again</Button>
      </Calm>
    );
  } else if (!model) {
    body = <Loading />;
  } else if (model.fileDiff.hunks.length === 0) {
    body =
      effectiveMode === 'since' ? (
        <Calm title="No changes since your last review">
          <Button onClick={() => setMode('all')}>Show all commits</Button>
        </Calm>
      ) : (
        <Calm title={current.changeType === 'renamed' ? 'Renamed without changes' : 'No content changes'}>
          {current.changeType === 'renamed' && current.oldPath ? (
            <span className="mono">
              {current.oldPath} → {current.newPath}
            </span>
          ) : (
            'Only file metadata (like permissions) changed.'
          )}
        </Calm>
      );
  } else {
    body = (
      <DiffView
        key={`${path}:${effectiveMode}`}
        model={model}
        viewMode={viewMode}
        groups={groups}
        selected={selected}
        commentSides={commentSides}
        onComment={onComment}
        onHover={onHover}
        onSelect={onSelect}
        edit={editing}
        onEditChange={setEdited}
        editorRef={editorRef}
      />
    );
  }

  const sinceTitle = !lastReview
    ? 'Available once you finish a review: then you can see just what changed since'
    : !sinceSha
      ? 'No new commits since your last review'
      : `Only what changed since the version you reviewed (${lastReview.sha.slice(0, 7)})`;

  // The one-line hint bar: what the keyboard does in the state you're in.
  // Everything else lives on the ⌘? sheet.
  const hints: [string[], string][] = editing
    ? [
        [['mod+enter'], 'create suggestion'],
        [['escape'], 'cancel'],
      ]
    : composer
      ? [
          [['mod+enter'], composer.kind === 'new' || composer.kind === 'reply' ? 'add to review' : 'save'],
          [['escape'], 'close'],
        ]
      : selected && textDiff
        ? [
            [['c'], 'comment'],
            [['s'], 'suggest'],
            [['shift+arrowup', 'shift+arrowdown'], 'extend'],
            [['escape'], 'clear'],
          ]
        : textDiff && model
          ? [
              [['arrowup', 'arrowdown'], 'move by line'],
              [['shift+j', 'shift+k'], 'next / previous change'],
            ]
          : [];

  const pillTone =
    status === 'success' ? 'ok' : status === 'failed' ? 'fail' : status === 'running' || status === 'pending' ? 'run' : 'neutral';
  const pillLabel =
    status === 'success'
      ? 'Pipeline passed'
      : status === 'failed'
        ? 'Pipeline failed'
        : status === 'running'
          ? 'Pipeline running'
          : `Pipeline ${status}`;

  return (
    <ReviewContext.Provider value={ctx}>
      <Window className="rv">
        <Toolbar className="rv-toolbar">
          <Button
            variant="plain"
            className="rv-back"
            icon={<ChevronLeft size={14} />}
            onClick={leaveReview}
            title="Back to the inbox (esc)"
          >
            Inbox
          </Button>
          <div className="rv-toolbar__title">
            <ToolbarTitle
              title={mr ? `!${mr.iid} · ${stripDraft(mr.title)}` : 'Loading…'}
              subtitle={
                mr && project
                  ? `${humanize(project.group)} · ${project.path} · by ${mr.authorUsername === me ? 'you' : mr.authorUsername}`
                  : undefined
              }
            />
          </div>
          {reviewable.length > 0 && (
            <div className="rv-progress">
              <span className="rv-progress__text tabular">
                {viewedCount} of {plural(reviewable.length, 'file')} viewed
              </span>
              <Progress value={viewedCount} max={reviewable.length} label="Files viewed" />
            </div>
          )}
          {status && (
            <button
              type="button"
              className={cx('rv-pill', `rv-pill--${pillTone}`)}
              onClick={() => openPipeline()}
              disabled={!pipeline}
              title={failedJob ? `${failedJob.name} failed — open the job log (P)` : 'Open the pipeline (P)'}
            >
              <StatusIcon status={status} size={14} />
              {pillLabel}
            </button>
          )}
          <Button variant="primary" onClick={() => setFinishOpen(true)} title="Finish review (⌘⇧↩)" disabled={!mr}>
            Finish review{drafts.length ? ` · ${drafts.length} pending` : ''}
          </Button>
          <button
            type="button"
            className={cx('ui-icon-btn rv-inspector-btn', asideOpen && 'is-active')}
            aria-label={asideOpen ? 'Hide inspector' : 'Show inspector'}
            aria-pressed={asideOpen}
            title={`${asideOpen ? 'Hide' : 'Show'} inspector (⌘⌥0)`}
            onClick={toggleAside}
          >
            <InspectorIcon open={asideOpen} />
          </button>
        </Toolbar>

        <Body className="rv-body">
          <Pane id="review-files" defaultWidth={264} min={200} max={440} as="nav" label="Changed files" className="rv-nav">
            <FileList
              reviewable={reviewable}
              generated={generated}
              selected={path}
              viewed={viewed}
              info={rowInfo}
              onSelect={selectFile}
              onToggleViewed={(p) => setViewed(p, !viewed.has(p))}
              onContextMenu={fileMenu}
              loading={filesQ.loading}
              error={filesQ.error}
              onRetry={() => void filesQ.refetch()}
            />
          </Pane>

          <main className="rv-main">
            <div
              ref={scrollRef}
              className="rv-scroll"
              onPointerMoveCapture={trackPointer}
              onScroll={(e) => e.currentTarget.toggleAttribute('data-scrolled', e.currentTarget.scrollTop > 0)}
            >
              {current && (
                <div className="rv-filehead">
                  <div className="rv-filehead__info">
                    <span
                      className="rv-filehead__path mono selectable"
                      title={current.oldPath && current.oldPath !== current.newPath ? `Renamed from ${current.oldPath}` : current.newPath}
                    >
                      {current.newPath}
                    </span>
                    {changeLabel(current) && (
                      <span className={cx('rv-change', `rv-change--${current.changeType}`)}>
                        {current.changeType === 'renamed' && current.oldPath
                          ? `renamed from ${current.oldPath}`
                          : changeLabel(current)}
                      </span>
                    )}
                    <span className="rv-filehead__stats mono tabular">
                      <span className="rv-add">+{current.additions}</span> <span className="rv-del">−{current.deletions}</span>
                    </span>
                    <span className="rv-filehead__pos">
                      {currentIsGenerated ? 'Generated file' : `File ${reviewIndex + 1} of ${reviewable.length}`}
                    </span>
                    {(pairQ.fetching || sinceQ.fetching) && model && <Spinner size={12} />}
                  </div>
                  <div className="rv-filehead__controls">
                    {editing ? (
                      <div className="rv-editbar" role="group" aria-label="Suggest edit">
                        <span className="rv-editbar__hint">Editing the new version</span>
                        <Button size="sm" variant="plain" onClick={requestCancelEdit} title="Stop editing (esc)">
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="primary"
                          shortcut="mod+enter"
                          onClick={confirmEdit}
                          disabled={!hasEdits}
                          title={hasEdits ? 'Turn your edit into a suggestion comment' : 'Make an edit first'}
                        >
                          Create suggestion
                        </Button>
                      </div>
                    ) : (
                      canEdit && (
                        <Button
                          size="sm"
                          shortcut="e"
                          onClick={startEdit}
                          disabled={!grammarReady}
                          title={grammarReady ? 'Edit the new version to suggest a change' : 'Preparing the editor…'}
                        >
                          Suggest edit
                        </Button>
                      )
                    )}
                    {textDiff && !editing && (
                      <ViewMenu
                        layout={viewMode}
                        onLayout={setViewMode}
                        commits={effectiveMode}
                        onCommits={setMode}
                        sinceAvailable={!!sinceSha}
                        sinceHint={sinceTitle}
                      />
                    )}
                    {!currentIsGenerated && !editing && (
                      <button
                        type="button"
                        className={cx('rv-viewed-btn', isViewed && 'is-on')}
                        aria-pressed={isViewed}
                        onClick={markViewed}
                        title={isViewed ? 'Mark as not viewed (V)' : 'Mark viewed and go to the next unviewed file (V)'}
                      >
                        {isViewed ? '✓ Viewed' : 'Mark viewed'} <span className="rv-viewed-btn__key">V</span>
                      </button>
                    )}
                  </div>
                </div>
              )}
              {body}
              {current && model && (
                <div className="rv-nextfile">
                  {nextFile ? (
                    <>
                      Next file:{' '}
                      <button
                        type="button"
                        className="rv-link rv-nextfile__link mono"
                        onClick={() => selectFile(nextFile.newPath)}
                        title="Go to the next file (J)"
                      >
                        {nextFile.newPath}
                      </button>
                    </>
                  ) : (
                    <>
                      That's the last file — press <Kbd combo="mod+shift+enter" /> to finish your review
                    </>
                  )}
                </div>
              )}
            </div>
          </main>

          {aside.present && mr && (
            <AsidePane slotRef={aside.ref} state={aside.state}>
              <Aside
                mr={mr}
                me={me}
                reviewers={reviewers}
                avatars={avatars}
                threads={asideThreads}
                commenters={commenters}
                onJump={jumpTo}
                pipeline={pipeline}
                jobs={failure?.jobs}
                onOpenJob={openPipeline}
              />
            </AsidePane>
          )}
        </Body>

        <footer className="rv-footer" aria-label="Keyboard shortcuts">
          <div className="rv-footer__hints">
            {hints.map(([keys, label]) => (
              <span key={label} className="rv-footer__hint">
                {keys.map((k) => (
                  <Kbd key={k} combo={k} />
                ))}{' '}
                {label}
              </span>
            ))}
          </div>
          <button
            type="button"
            className="rv-footer__end"
            onClick={openShortcuts}
            title="Every keyboard shortcut on one sheet"
          >
            <Kbd combo="mod+?" /> all shortcuts
          </button>
        </footer>

        <Sheet
          open={confirming}
          onClose={keepEditing}
          width={400}
          title="Discard your edit?"
          footer={
            <>
              <Button onClick={keepEditing} autoFocus>
                Keep editing
              </Button>
              <Button
                variant="danger"
                onClick={() => {
                  const then = discardThen;
                  setDiscardThen(null);
                  then?.();
                }}
              >
                Discard
              </Button>
            </>
          }
        >
          <p className="rv-sheet-text">
            Your changes to <span className="mono">{path}</span> haven't been turned into a suggestion yet.
          </p>
        </Sheet>

        <FinishSheet
          open={finishOpen}
          onClose={() => setFinishOpen(false)}
          drafts={drafts}
          onRemoveDraft={removeDraft}
          canApprove={!approveHint}
          approveHint={approveHint}
          onSubmit={submitReview}
        />
      </Window>
    </ReviewContext.Provider>
  );
}
