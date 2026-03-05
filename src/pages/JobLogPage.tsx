/**
 * Job log page showing the raw trace output for a pipeline job.
 *
 * Displays structured log output with line numbers, collapsible sections,
 * duration badges, and ANSI color rendering — styled like GitLab's web UI.
 *
 * For running/pending/created jobs, TanStack Query polls the trace endpoint
 * every 3s and job status every 10s (via usePipelineJobsQuery). Polling stops
 * automatically when the job completes.
 */

import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import BackButton from '../components/BackButton';
import { openExternalUrl } from '../services/transport';
import { trackShortcut } from '../services/analytics';
import { parseLog, formatSectionName } from '../utils/logLineParser';
import type { LogLine, LogSection } from '../utils/logLineParser';
import type { AnsiSegment } from '../utils/ansiParser';
import type { PipelineJobStatus } from '../types';
import { useJobTraceQuery } from '../hooks/queries/useJobTraceQuery';
import { usePipelineJobsQuery } from '../hooks/queries/usePipelineJobsQuery';
import './JobLogPage.css';

/** Statuses that indicate a job is still active and should be polled. */
const ACTIVE_STATUSES: ReadonlySet<PipelineJobStatus> = new Set(['running', 'pending', 'created']);

/**
 * Format duration from seconds into human-readable form.
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * Human-readable status label.
 */
function jobStatusLabel(status: PipelineJobStatus): string {
  switch (status) {
    case 'success': return 'passed';
    case 'failed': return 'failed';
    case 'running': return 'running';
    case 'pending': return 'pending';
    case 'canceled': return 'canceled';
    case 'skipped': return 'skipped';
    case 'manual': return 'manual';
    case 'created': return 'created';
    case 'waiting_for_resource': return 'waiting';
    case 'preparing': return 'preparing';
    case 'scheduled': return 'scheduled';
  }
}

/** Render ANSI segments as spans. */
function AnsiSegments({ segments }: { segments: AnsiSegment[] }) {
  let offset = 0;
  return <>
    {segments.map((seg) => {
      const key = offset;
      offset += seg.text.length;
      return Object.keys(seg.style).length > 0
        ? <span key={key} style={seg.style}>{seg.text}</span>
        : <span key={key}>{seg.text}</span>;
    })}
  </>;
}

/** Render a single log line with line number + optional timestamp + content. */
function LogLineRow({ line, showTimestamp }: { line: LogLine; showTimestamp?: boolean }) {
  return (
    <div className="log-line">
      <span className="log-line-number">{line.lineNumber}</span>
      {showTimestamp && (
        <span className="log-line-timestamp">{line.timestamp ?? ''}</span>
      )}
      <span className="log-line-content"><AnsiSegments segments={line.segments} /></span>
    </div>
  );
}

/** Render a collapsible log section. */
function LogSectionBlock({
  section,
  expanded,
  onToggle,
  showTimestamp,
}: {
  section: LogSection;
  expanded: boolean;
  onToggle: () => void;
  showTimestamp?: boolean;
}) {
  return (
    <div className={`log-section${expanded ? ' log-section--expanded' : ''}`}>
      <button type="button" className="log-section-header" onClick={onToggle} aria-expanded={expanded}>
        <span className="log-section-chevron">{expanded ? '\u25BE' : '\u25B8'}</span>
        <span className="log-section-name">{formatSectionName(section.name)}</span>
        {section.duration && (
          <span className="log-duration-badge">{section.duration}</span>
        )}
      </button>
      {expanded && (
        <div className="log-section-body">
          {section.lines.map((line) => (
            <LogLineRow key={line.lineNumber} line={line} showTimestamp={showTimestamp} />
          ))}
        </div>
      )}
    </div>
  );
}

export default function JobLogPage() {
  const { projectId, pipelineId, jobId } = useParams<{
    projectId: string;
    pipelineId: string;
    jobId: string;
  }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const instanceId = Number(searchParams.get('instance') || 0);
  const jobName = searchParams.get('name') || 'Job';
  const initialStatus = (searchParams.get('status') || 'created') as PipelineJobStatus;
  const stage = searchParams.get('stage') || '';
  const duration = searchParams.get('duration');
  const projectName = searchParams.get('project') || '';
  const pipelineRef = searchParams.get('ref') || '';
  const pipelineWebUrl = searchParams.get('url') || '';
  const jobWebUrl = searchParams.get('jobUrl') || '';

  const pid = Number(projectId);
  const plid = Number(pipelineId);
  const jid = Number(jobId);

  // Current status — seeded from URL param, updated by jobs query
  const [currentStatus, setCurrentStatus] = useState<PipelineJobStatus>(initialStatus);
  const [followMode, setFollowMode] = useState(ACTIVE_STATUSES.has(initialStatus));
  const [collapsedSections, setCollapsedSections] = useState<Set<string>>(new Set());

  const isActive = ACTIVE_STATUSES.has(currentStatus);

  // Ref for the scrollable log content container
  const logContentRef = useRef<HTMLElement>(null);
  // Ref to suppress scroll handler when auto-scrolling
  const isAutoScrollingRef = useRef(false);

  // TQ-backed trace query — polls every 3s when job is active, stops when complete
  const traceQuery = useJobTraceQuery(instanceId, pid, jid, currentStatus);
  const trace = traceQuery.data ?? '';

  // TQ-backed jobs query — polls every 10s when any job is active; used to detect completion
  const jobsQuery = usePipelineJobsQuery(instanceId, pid, plid);

  // Derive current status from jobs query result
  useEffect(() => {
    const job = jobsQuery.data?.find((j) => j.id === jid);
    if (job && job.status !== currentStatus) {
      setCurrentStatus(job.status);
    }
  }, [jobsQuery.data, jid, currentStatus]);

  const parsedLog = useMemo(() => parseLog(trace), [trace]);

  // Initialize collapsed state for sections marked collapsed=true on first parse
  const initialCollapseApplied = useRef(false);
  useEffect(() => {
    if (initialCollapseApplied.current || parsedLog.entries.length === 0) return;
    initialCollapseApplied.current = true;
    const collapsed = new Set<string>();
    for (const entry of parsedLog.entries) {
      if (entry.type === 'section' && entry.data.collapsed) {
        collapsed.add(entry.data.name);
      }
    }
    if (collapsed.size > 0) setCollapsedSections(collapsed);
  }, [parsedLog]);

  const toggleSection = useCallback((name: string) => {
    setCollapsedSections((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  }, []);

  const backParams = new URLSearchParams({ instance: String(instanceId) });
  if (projectName) backParams.set('project', projectName);
  if (pipelineRef) backParams.set('ref', pipelineRef);
  if (pipelineWebUrl) backParams.set('url', pipelineWebUrl);
  const backUrl = `/pipelines/${projectId}/${pipelineId}?${backParams.toString()}`;

  // Auto-scroll to bottom when follow mode is on and trace updates
  useEffect(() => {
    if (!followMode || !logContentRef.current) return;
    const el = logContentRef.current;
    isAutoScrollingRef.current = true;
    el.scrollTop = el.scrollHeight;
    requestAnimationFrame(() => { isAutoScrollingRef.current = false; });
  }, [followMode, trace]);

  // Detect manual scroll to toggle follow mode
  useEffect(() => {
    const el = logContentRef.current;
    if (!el) return;

    function handleScroll() {
      if (isAutoScrollingRef.current) return;
      const { scrollTop, scrollHeight, clientHeight } = el!;
      const atBottom = scrollHeight - scrollTop - clientHeight < 30;
      setFollowMode(atBottom);
    }

    el.addEventListener('scroll', handleScroll, { passive: true });
    return () => el.removeEventListener('scroll', handleScroll);
  }, []);

  // Escape key navigates back
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        trackShortcut('Escape', 'go_back', 'job_log');
        navigate(backUrl);
      } else if ((e.key === 'o' || e.key === 'O') && jobWebUrl) {
        e.preventDefault();
        trackShortcut('o', 'open_in_browser', 'job_log');
        openExternalUrl(jobWebUrl);
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [navigate, backUrl, jobWebUrl]);

  const loading = traceQuery.isLoading;
  const error = traceQuery.error ? 'Failed to load job trace' : null;

  return (
    <div className="job-log-page">
      <header className="job-log-header">
        <div className="job-log-header-left">
          <BackButton to={backUrl} title="Back to pipeline" />
          <div className="job-log-title-group">
            <h1>
              {jobName}
              <span className={`pipeline-badge pipeline-badge--${currentStatus}`}>
                {currentStatus === 'running' && <span className="pipeline-badge-pulse" />}
                {jobStatusLabel(currentStatus)}
              </span>
              {isActive && (
                <span className="job-log-live-badge">
                  <span className="job-log-live-pulse" />
                  Live
                </span>
              )}
            </h1>
            <div className="job-log-meta">
              {stage && <span className="job-log-stage">{stage}</span>}
              {duration && (
                <span className="job-log-duration">{formatDuration(Number(duration))}</span>
              )}
            </div>
          </div>
        </div>
        <div className="job-log-header-right">
          <button
            className={`job-log-follow-btn${followMode ? ' job-log-follow-btn--active' : ''}`}
            onClick={() => setFollowMode((prev) => !prev)}
            title={followMode ? 'Disable auto-scroll' : 'Enable auto-scroll'}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 2v8M4 7l3 3 3-3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Follow
          </button>
        </div>
      </header>

      <main className="job-log-content" ref={logContentRef}>
        {loading ? (
          <div className="job-log-loading">
            <span className="job-log-spinner" />
            Loading job log...
          </div>
        ) : error ? (
          <div className="job-log-error">{error}</div>
        ) : trace.length === 0 ? (
          <div className="job-log-empty">No log output for this job.</div>
        ) : (
          <div className={`job-log-trace${parsedLog.timestamped ? ' job-log-trace--timestamped' : ''}`}>
            {parsedLog.entries.map((entry) => {
              if (entry.type === 'line') {
                return <LogLineRow key={`line-${entry.data.lineNumber}`} line={entry.data} showTimestamp={parsedLog.timestamped} />;
              }
              const section = entry.data;
              return (
                <LogSectionBlock
                  key={`section-${section.name}`}
                  section={section}
                  expanded={!collapsedSections.has(section.name)}
                  onToggle={() => toggleSection(section.name)}
                  showTimestamp={parsedLog.timestamped}
                />
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
