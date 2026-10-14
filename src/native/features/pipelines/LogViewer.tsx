/**
 * Job log viewer: dark, terminal-like, in both appearances.
 *
 * - GitLab sections become collapsible steps with durations; the failing
 *   step opens by default, the rest stay collapsed.
 * - Search opens matching steps, highlights hits, ↩ / ⇧↩ cycle.
 * - Lines referencing a file changed in the MR get an inline card.
 * - Big logs stay smooth: only open sections render, and long runs of lines
 *   mount lazily in fixed-height chunks as they scroll near the viewport.
 * - Running jobs keep tailing while you're scrolled to the bottom.
 */

import {
  forwardRef,
  memo,
  useCallback,
  useDeferredValue,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { PipelineJob } from '../../api/types';
import { formatKeys } from '../../app/keys';
import { navigate, paths } from '../../app/router';
import { duration, splitPath } from '../../lib/format';
import { Button, copyText, cx, SearchField, showContextMenu, Spinner, StatusIcon, type MenuEntry } from '../../ui/components';
import { ChevronRight } from '../../ui/icons';
import type { Seg } from './log/ansi';
import { locationsIn, samePath, type Analysis } from './log/failure';
import { sectionChain, sectionDuration, type LogLine, type LogSection, type ParsedLog } from './log/parse';
import './log.css';

const LINE_H = 20;
const CHUNK = 200;
/** Below this many lines everything renders eagerly. */
const EAGER = 2500;
const MAX_MATCHES = 10_000;

export interface LogViewerHandle {
  jumpToError: () => void;
  focusSearch: () => void;
}

interface Card {
  path: string;
  line?: number;
}

interface Match {
  line: number;
  start: number;
  end: number;
}

export interface LogViewerProps {
  job: PipelineJob;
  log?: ParsedLog;
  analysis?: Analysis;
  loading: boolean;
  error?: Error;
  onRetry: () => void;
  /** Files changed in the related MR, for inline "changed in this MR" cards. */
  changedPaths?: string[];
  mrId?: number;
  /** Rendered when the job has no log (manual, skipped, bridge…). */
  emptyAction?: ReactNode;
}

/* ---------------------------------------------------------------------- */
/* Line rendering                                                         */
/* ---------------------------------------------------------------------- */

function renderSegs(segs: Seg[], ranges?: [number, number, boolean][]): ReactNode[] {
  if (!ranges?.length) {
    return segs.map((s, k) =>
      s.c || s.s ? (
        <span key={k} className={s.c} style={s.s}>
          {s.t}
        </span>
      ) : (
        s.t
      ),
    );
  }
  const out: ReactNode[] = [];
  let offset = 0;
  let k = 0;
  for (const s of segs) {
    const segStart = offset;
    const segEnd = offset + s.t.length;
    let cursor = segStart;
    const parts: ReactNode[] = [];
    for (const [a, b, current] of ranges) {
      if (b <= cursor || a >= segEnd) continue;
      const from = Math.max(a, cursor);
      const to = Math.min(b, segEnd);
      if (from > cursor) parts.push(s.t.slice(cursor - segStart, from - segStart));
      parts.push(
        <mark key={`m${k++}`} className={cx('pl-mark', current && 'is-current')}>
          {s.t.slice(from - segStart, to - segStart)}
        </mark>,
      );
      cursor = to;
    }
    if (cursor < segEnd) parts.push(s.t.slice(cursor - segStart));
    out.push(
      s.c || s.s ? (
        <span key={`s${k++}`} className={s.c} style={s.s}>
          {parts}
        </span>
      ) : (
        <span key={`s${k++}`}>{parts}</span>
      ),
    );
    offset = segEnd;
  }
  return out;
}

const Line = memo(function Line({
  line,
  index,
  err,
  ranges,
  card,
  mrId,
  flash,
}: {
  line: LogLine;
  index: number;
  err: boolean;
  ranges?: [number, number, boolean][];
  card?: Card;
  mrId?: number;
  flash: boolean;
}) {
  const cmd = line.text.startsWith('$ ');
  return (
    <>
      <div
        className={cx('pl-ln', err && 'is-err', cmd && 'is-cmd', flash && 'is-flash')}
        data-i={index}
        data-n={line.n}
      >
        <span className="pl-ln__t">{line.text ? renderSegs(line.segs, ranges) : ' '}</span>
      </div>
      {card && (
        <div className="pl-log-card" data-card-for={index}>
          <span>
            Changed in this merge request:{' '}
            <span className="mono">
              {splitPath(card.path).name}
              {card.line ? `:${card.line}` : ''}
            </span>
          </span>
          {mrId && (
            <button type="button" className="pl-log-card__link" onClick={() => navigate(paths.review(mrId, card.path))}>
              Open in review →
            </button>
          )}
        </div>
      )}
    </>
  );
});

/** Lines mount when they scroll near the viewport; before that, a spacer. */
function LazyChunk({
  from,
  to,
  root,
  force,
  render,
}: {
  from: number;
  to: number;
  root: React.RefObject<HTMLDivElement | null>;
  force: boolean;
  render: (i: number) => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (seen || !ref.current) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          io.disconnect();
        }
      },
      { root: root.current, rootMargin: '1200px 0px' },
    );
    io.observe(ref.current);
    return () => io.disconnect();
  }, [seen, root]);
  if (!seen && !force) return <div ref={ref} className="pl-log__spacer" style={{ height: (to - from) * LINE_H }} />;
  const out: ReactNode[] = [];
  for (let i = from; i < to; i++) out.push(render(i));
  return (
    <div ref={ref} className="pl-log__chunk">
      {out}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Viewer                                                                 */
/* ---------------------------------------------------------------------- */

export const LogViewer = forwardRef<LogViewerHandle, LogViewerProps>(function LogViewer(
  { job, log, analysis, loading, error, onRetry, changedPaths, mrId, emptyAction },
  ref,
) {
  const scroller = useRef<HTMLDivElement>(null);
  const linesRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const atBottom = useRef(true);
  const running = job.status === 'running' || job.status === 'pending';
  const failed = job.status === 'failed';

  const sections = useMemo(() => log?.sections ?? [], [log]);
  const lines = useMemo(() => log?.lines ?? [], [log]);

  // Children per section (-1 = top level), in order.
  const children = useMemo(() => {
    const map = new Map<number, LogSection[]>();
    for (const s of sections) {
      const list = map.get(s.parent);
      if (list) list.push(s);
      else map.set(s.parent, [s]);
    }
    return map;
  }, [sections]);

  /* -- which step failed ------------------------------------------------ */
  const failId = useMemo(() => {
    if (!failed) return null;
    if (analysis?.failingSection !== null && analysis?.failingSection !== undefined) return analysis.failingSection;
    const script = [...sections].reverse().find((s) => /^(step_script|build_script|script)$/.test(s.key));
    return script ? script.id : null;
  }, [failed, analysis, sections]);
  const failChain = useMemo(() => new Set(failId !== null ? sectionChain(sections, failId) : []), [failId, sections]);

  /* -- open/closed -------------------------------------------------------- */
  const defaults = useMemo(() => {
    const open = new Set<number>(failChain);
    if (!open.size) {
      const lastOpen = running ? [...sections].reverse().find((s) => s.open) : undefined;
      const main = lastOpen ?? sections.find((s) => s.key === 'step_script') ?? null;
      if (main) {
        sectionChain(sections, main.id).forEach((id) => open.add(id));
        // …and its own steps, unless they asked to start collapsed.
        for (const s of sections) {
          if (s.from >= main.from && s.to <= main.to && !s.collapsedHint) {
            if (sectionChain(sections, s.id).includes(main.id)) open.add(s.id);
          }
        }
      }
    }
    return open;
  }, [failChain, sections, running]);

  const [overrides, setOverrides] = useState<Map<number, boolean>>(() => new Map());

  /* -- search ------------------------------------------------------------- */
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query.trim().toLowerCase());
  const matches = useMemo<Match[]>(() => {
    const q = deferredQuery;
    if (!q) return [];
    const out: Match[] = [];
    for (let i = 0; i < lines.length && out.length < MAX_MATCHES; i++) {
      const t = lines[i].text.toLowerCase();
      let at = t.indexOf(q);
      while (at >= 0 && out.length < MAX_MATCHES) {
        out.push({ line: i, start: at, end: at + q.length });
        at = t.indexOf(q, at + q.length);
      }
    }
    return out;
  }, [deferredQuery, lines]);
  const [current, setCurrent] = useState(0);
  useEffect(() => setCurrent(0), [matches]);

  const searchOpen = useMemo(() => {
    const open = new Set<number>();
    const seen = new Set<number>();
    for (const m of matches) {
      const sec = lines[m.line].section;
      if (seen.has(sec)) continue;
      seen.add(sec);
      if (sec >= 0) sectionChain(sections, sec).forEach((id) => open.add(id));
    }
    return open;
  }, [matches, lines, sections]);

  // A new search re-opens matching steps even if you'd collapsed them.
  useEffect(() => {
    if (!searchOpen.size) return;
    setOverrides((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const id of searchOpen) {
        if (next.get(id) === false) {
          next.delete(id);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [searchOpen]);

  const isOpen = useCallback(
    (id: number) => overrides.get(id) ?? (searchOpen.has(id) || defaults.has(id)),
    [overrides, searchOpen, defaults],
  );

  const rangesByLine = useMemo(() => {
    const map = new Map<number, [number, number, boolean][]>();
    matches.forEach((m, k) => {
      const list = map.get(m.line);
      const entry: [number, number, boolean] = [m.start, m.end, k === current];
      if (list) list.push(entry);
      else map.set(m.line, [entry]);
    });
    return map;
  }, [matches, current]);

  /* -- errors + MR cards --------------------------------------------------- */
  const errorSet = useMemo(() => new Set(failed ? (analysis?.errorLines ?? []) : []), [analysis, failed]);

  const cards = useMemo(() => {
    const map = new Map<number, Card>();
    if (!log || !changedPaths?.length || !failed || !analysis) return map;
    const scan = new Set<number>(analysis.errorLines);
    analysis.locations.forEach((l) => scan.add(l.at));
    if (analysis.firstError !== null) {
      for (let i = analysis.firstError; i < Math.min(log.lines.length, analysis.firstError + 400); i++) scan.add(i);
    }
    const seen = new Set<string>();
    for (const loc of locationsIn(log, [...scan].sort((a, b) => a - b), 60)) {
      const changed = changedPaths.find((p) => samePath(loc.path, p));
      if (!changed || seen.has(changed)) continue;
      seen.add(changed);
      map.set(loc.at, { path: changed, line: loc.line });
      if (map.size >= 3) break;
    }
    return map;
  }, [log, changedPaths, failed, analysis]);

  /* -- scrolling to a line ---------------------------------------------- */
  const [target, setTarget] = useState<{ line: number; flash: boolean; nonce: number } | null>(null);

  const reveal = useCallback(
    (line: number, flash = true) => {
      const sec = lines[line]?.section ?? -1;
      if (sec >= 0) {
        const chain = sectionChain(sections, sec);
        setOverrides((prev) => {
          const next = new Map(prev);
          chain.forEach((id) => next.set(id, true));
          return next;
        });
      }
      setTarget({ line, flash, nonce: Date.now() });
    },
    [lines, sections],
  );

  useLayoutEffect(() => {
    if (!target) return;
    const el = linesRef.current?.querySelector<HTMLElement>(`[data-i="${target.line}"]`);
    const box = scroller.current;
    if (!el || !box) return;
    const y = el.getBoundingClientRect().top - box.getBoundingClientRect().top + box.scrollTop;
    box.scrollTop = Math.max(0, y - box.clientHeight / 3);
  }, [target]);

  useEffect(() => {
    if (!target?.flash) return;
    const t = setTimeout(() => setTarget((cur) => (cur === target ? { ...cur, flash: false } : cur)), 1200);
    return () => clearTimeout(t);
  }, [target]);

  // Follow the current search hit.
  useEffect(() => {
    const m = matches[current];
    if (m) setTarget({ line: m.line, flash: false, nonce: Date.now() });
  }, [matches, current]);

  // First paint: land on the error (failed) or the tail (running).
  const landed = useRef(false);
  useLayoutEffect(() => {
    if (landed.current || !log) return;
    landed.current = true;
    if (failed && analysis?.firstError !== null && analysis?.firstError !== undefined) {
      setTarget({ line: analysis.firstError, flash: false, nonce: 0 });
    } else if (running && scroller.current) {
      scroller.current.scrollTop = scroller.current.scrollHeight;
    }
  }, [log, analysis, failed, running]);

  // Keep tailing a running job while you're at the bottom.
  useLayoutEffect(() => {
    if (!running || !atBottom.current || !scroller.current) return;
    scroller.current.scrollTop = scroller.current.scrollHeight;
  }, [log, running]);

  const onScroll = () => {
    const el = scroller.current;
    if (el) atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
  };

  /* -- imperative API ------------------------------------------------------ */
  const jumpToError = useCallback(() => {
    if (analysis?.firstError !== null && analysis?.firstError !== undefined) reveal(analysis.firstError);
  }, [analysis, reveal]);

  useImperativeHandle(
    ref,
    () => ({
      jumpToError,
      focusSearch: () => {
        searchRef.current?.focus();
        searchRef.current?.select();
      },
    }),
    [jumpToError],
  );

  /* -- expand / collapse --------------------------------------------------- */
  const withContent = sections.filter((s) => s.to > s.from);
  const anyClosed = withContent.some((s) => !isOpen(s.id));
  const expandAll = () => {
    if (anyClosed) setOverrides(new Map(withContent.map((s) => [s.id, true])));
    else setOverrides(new Map(withContent.map((s) => [s.id, failChain.has(s.id)])));
  };
  const toggle = (id: number) => setOverrides((prev) => new Map(prev).set(id, !isOpen(id)));

  /* -- line context menu + select all ------------------------------------ */
  const onContextMenu = (e: React.MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-i]');
    if (!el) return;
    const i = Number(el.dataset.i);
    const line = lines[i];
    if (!line) return;
    const selection = window.getSelection()?.toString() ?? '';
    const entries: MenuEntry[] = [];
    if (selection) entries.push({ label: 'Copy', action: () => void copyText(selection) });
    entries.push(
      { label: 'Copy line', action: () => void copyText(line.text, 'Copied line') },
      { label: 'Copy link to line', action: () => void copyText(`${job.webUrl}#L${line.n}`, 'Copied link') },
    );
    void showContextMenu(e, entries);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a' && linesRef.current) {
      e.preventDefault();
      const range = document.createRange();
      range.selectNodeContents(linesRef.current);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  };

  /* -- tree rendering ------------------------------------------------------ */
  const lazy = lines.length > EAGER;
  const flashLine = target?.flash ? target.line : -1;
  const targetLine = target?.line ?? -1;

  const renderLine = (i: number) => (
    <Line
      key={i}
      line={lines[i]}
      index={i}
      err={errorSet.has(i)}
      ranges={rangesByLine.get(i)}
      card={cards.get(i)}
      mrId={mrId}
      flash={i === flashLine}
    />
  );

  const renderLines = (from: number, to: number): ReactNode[] => {
    if (!lazy) {
      const out: ReactNode[] = [];
      for (let i = from; i < to; i++) out.push(renderLine(i));
      return out;
    }
    const out: ReactNode[] = [];
    for (let c = from; c < to; c += CHUNK) {
      const end = Math.min(to, c + CHUNK);
      out.push(
        <LazyChunk
          key={`c${c}`}
          from={c}
          to={end}
          root={scroller}
          force={targetLine >= c && targetLine < end}
          render={renderLine}
        />,
      );
    }
    return out;
  };

  const now = Math.floor(Date.now() / 1000);
  const renderRange = (from: number, to: number, parent: number): ReactNode[] => {
    const out: ReactNode[] = [];
    let cursor = from;
    for (const s of children.get(parent) ?? []) {
      if (s.from > cursor) out.push(...renderLines(cursor, s.from));
      out.push(renderSection(s));
      cursor = Math.max(cursor, s.to);
    }
    if (cursor < to) out.push(...renderLines(cursor, to));
    return out;
  };

  const renderSection = (s: LogSection) => {
    const open = isOpen(s.id);
    const empty = s.to <= s.from;
    const fail = failChain.has(s.id);
    const live = running && s.open;
    const secs = sectionDuration(s, live ? now : undefined);
    const hits = deferredQuery ? matches.some((m) => m.line >= s.from && m.line < s.to) : false;
    return (
      <div key={`s${s.id}`} className={cx('pl-sec', fail && 'is-fail')} style={{ ['--depth' as string]: s.depth }}>
        <button
          type="button"
          className={cx('pl-sec__head', open && 'is-open', empty && 'is-empty', hits && 'has-hits')}
          aria-expanded={empty ? undefined : open}
          onClick={() => !empty && toggle(s.id)}
          title={s.key}
        >
          <span className="pl-sec__chev" aria-hidden="true">
            {!empty && <ChevronRight size={12} />}
          </span>
          <span className={cx('pl-sec__icon', fail ? 'is-fail' : live ? 'is-live' : 'is-ok')} aria-hidden="true">
            {fail ? '✕' : live ? <StatusIcon status="running" size={12} /> : '✓'}
          </span>
          <span className="pl-sec__title">{s.title}</span>
          <span className="pl-sec__time tabular">{live ? 'running' : duration(secs)}</span>
        </button>
        {open && !empty && <div className="pl-sec__body">{renderRange(s.from, s.to, s.id)}</div>}
      </div>
    );
  };

  /* -- toolbar bits -------------------------------------------------------- */
  const topSteps = (children.get(-1) ?? []).length;
  const meta = [job.duration ? duration(job.duration) : running ? 'running' : null, topSteps ? `${topSteps} steps` : null]
    .filter(Boolean)
    .join(' · ');
  const counter = deferredQuery
    ? matches.length
      ? `${Math.min(current + 1, matches.length)} of ${matches.length >= MAX_MATCHES ? `${MAX_MATCHES}+` : matches.length}`
      : 'No matches'
    : undefined;
  const hasError = failed && analysis?.firstError !== null && analysis?.firstError !== undefined;

  const step = (dir: 1 | -1) => {
    if (!matches.length) return;
    setCurrent((c) => (c + dir + matches.length) % matches.length);
  };

  let body: ReactNode;
  if (error && !log) {
    body = (
      <div className="pl-log__state">
        <p>Couldn’t load this log. {error.message}</p>
        <Button size="sm" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  } else if (loading && !log) {
    body = (
      <div className="pl-log__state">
        <Spinner /> Loading log…
      </div>
    );
  } else if (!lines.length) {
    body = (
      <div className="pl-log__state">
        <p>
          {job.isBridge
            ? 'This job triggers a downstream pipeline and has no log of its own.'
            : job.status === 'manual' || (job.status === 'created' && job.manual)
              ? 'This manual job hasn’t been run yet.'
              : job.status === 'skipped'
                ? 'This job was skipped, so there’s no log.'
                : running
                  ? 'Waiting for the runner to send output…'
                  : 'This job hasn’t produced any output.'}
        </p>
        {emptyAction}
      </div>
    );
  } else {
    body = (
      <div
        ref={linesRef}
        className="pl-log__lines selectable"
        style={{ ['--gutter' as string]: `${String(lines.length).length}ch` }}
        onContextMenu={onContextMenu}
      >
        {renderRange(0, lines.length, -1)}
      </div>
    );
  }

  return (
    <section className="pl-log" aria-label={`Log for ${job.name}`}>
      <div className="pl-log__bar">
        <span className="pl-log__job">{job.name}</span>
        {meta && <span className="pl-log__meta tabular">{meta}</span>}
        <div className="pl-log__grow" />
        <SearchField
          ref={searchRef}
          tone="dark"
          label="Search this log"
          placeholder="Search log, opens matching steps"
          className="pl-log__search"
          value={query}
          hint={counter}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              step(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape') {
              e.preventDefault();
              if (query) setQuery('');
              else e.currentTarget.blur();
            }
          }}
        />
        {withContent.length > 0 && (
          <button type="button" className="pl-log__btn" onClick={expandAll}>
            {anyClosed ? 'Expand all' : 'Collapse passed'}
          </button>
        )}
        {hasError && (
          <button type="button" className="pl-log__btn pl-log__btn--error" onClick={jumpToError} title={`Jump to the first error (${formatKeys('mod+e')})`}>
            Jump to error <span className="pl-log__kbd">{formatKeys('mod+e')}</span>
          </button>
        )}
      </div>
      <div ref={scroller} className="pl-log__scroll" tabIndex={0} onScroll={onScroll} onKeyDown={onKeyDown}>
        {body}
      </div>
    </section>
  );
});
