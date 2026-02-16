/**
 * Structured log parser for GitLab CI job traces.
 *
 * Parses raw trace text into structured entries with line numbers,
 * collapsible sections (with duration badges), per-line timestamps,
 * and per-line ANSI segments.
 *
 * Section markers format:
 *   section_start:UNIX_TIMESTAMP:SECTION_NAME\r\e[0K
 *   section_start:UNIX_TIMESTAMP:SECTION_NAME[collapsed=true]\r\e[0K
 *   section_end:UNIX_TIMESTAMP:SECTION_NAME\r\e[0K
 *
 * Runner timestamp header format (GitLab 17.1+):
 *   2024-05-30T14:30:00.000000Z 00E  <content>
 *   ^-- 27 chars RFC3339Nano --^ ^5 chars metadata^
 *   Metadata: 2 hex chars + stream(E=stderr/O=stdout) + flag(+= append, space=new line)
 */

import type { AnsiSegment } from './ansiParser';
import { parseAnsiLine, createAnsiState } from './ansiParser';

export interface LogLine {
  lineNumber: number;
  timestamp?: string;        // UTC time extracted from runner header, e.g. "14:30:00"
  segments: AnsiSegment[];
}

export interface LogSection {
  name: string;
  startTimestamp: number;
  endTimestamp?: number;
  duration?: string;
  collapsed: boolean;
  headerLine: LogLine;
  lines: LogLine[];
}

export type LogEntry =
  | { type: 'line'; data: LogLine }
  | { type: 'section'; data: LogSection };

export interface ParsedLog {
  entries: LogEntry[];
  timestamped: boolean;
}

/**
 * Runner log line header: RFC3339Nano timestamp + metadata.
 * Example: "2024-05-30T14:30:00.000000Z 00E "
 */
const RUNNER_HEADER_RE =
  /^(\d{4}-[01]\d-[0-3]\dT[0-2]\d:[0-5]\d:[0-5]\d\.\d{6}Z) [0-9a-f]{2}[EO][+ ]/;

const RFC3339_DATETIME_LENGTH = 27;
const RUNNER_HEADER_LENGTH = 32; // 27 datetime + 5 metadata

/** Regex to detect section_start marker anywhere in a line. */
const SECTION_START_RE =
  /section_start:(\d+):([^\s\r\n\x1b[]+)(?:\[([^\]]*)\])?/;

/** Regex to detect section_end marker anywhere in a line. */
const SECTION_END_RE = /section_end:(\d+):([^\s\r\n\x1b[]+)/;

/** Strip all section markers and surrounding escape codes from a line. */
function stripMarkers(line: string): string {
  return line
    .replace(/\x1b\[0K/g, '')
    .replace(/section_(start|end):\d+:[^\s\r\n\x1b[]+(?:\[[^\]]*\])?/g, '')
    .replace(/\r$/g, '');
}

/** Format duration in seconds as MM:SS or HH:MM:SS. */
function formatSectionDuration(seconds: number): string {
  if (seconds < 0) seconds = 0;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const mm = String(m).padStart(2, '0');
  const ss = String(s).padStart(2, '0');
  if (h > 0) return `${String(h).padStart(2, '0')}:${mm}:${ss}`;
  return `${mm}:${ss}`;
}

/** Extract HH:MM:SS from an RFC3339Nano timestamp string. */
function parseTime(raw: string): string {
  // "2024-05-30T14:30:00.000000Z" → "14:30:00"
  return raw.slice(11, 19);
}

/** Format a section name for display: replace _ with spaces, title case. */
export function formatSectionName(name: string): string {
  return name
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Parse raw trace text into structured log entries.
 */
export function parseLog(rawTrace: string): ParsedLog {
  const entries: LogEntry[] = [];
  const rawLines = rawTrace.split('\n');
  const ansiState = createAnsiState();

  // Auto-detect whether log lines have runner timestamp headers
  let timestamped: boolean | null = null;

  let lineNumber = 1;
  let currentSection: LogSection | null = null;

  for (const rawLine of rawLines) {
    let input = rawLine;
    let timestamp: string | undefined;
    let isAppend = false;

    // Detect timestamped mode from first non-empty line
    if (timestamped === null && rawLine.length > 0) {
      timestamped = RUNNER_HEADER_RE.test(rawLine);
    }

    // Strip runner timestamp header if present
    if (timestamped && rawLine.length >= RUNNER_HEADER_LENGTH) {
      timestamp = parseTime(rawLine.slice(0, RFC3339_DATETIME_LENGTH));
      isAppend = rawLine[RUNNER_HEADER_LENGTH - 1] === '+';
      input = rawLine.slice(RUNNER_HEADER_LENGTH);
    }

    const startMatch = input.match(SECTION_START_RE);
    const endMatch = input.match(SECTION_END_RE);

    // Handle append lines: merge content into the previous content line.
    // Must check section markers first so append+section_start doesn't
    // try to merge into a previous line.
    if (isAppend && !startMatch && !endMatch) {
      const cleaned = stripMarkers(input);
      const segments = parseAnsiLine(cleaned, ansiState);
      if (segments.length > 0) {
        const lastLine = findLastContentLine(entries, currentSection);
        if (lastLine) {
          lastLine.segments.push(...segments);
          continue;
        }
      }
      // If no previous content line, fall through to normal handling
    }

    if (startMatch) {
      // Flush any open section without an end marker
      if (currentSection) {
        entries.push({ type: 'section', data: currentSection });
        currentSection = null;
      }

      const sectionTimestamp = Number(startMatch[1]);
      const name = startMatch[2];
      const options = startMatch[3] || '';
      const collapsed = options.includes('collapsed=true');

      currentSection = {
        name,
        startTimestamp: sectionTimestamp,
        collapsed,
        headerLine: { lineNumber, timestamp, segments: [] },
        lines: [],
      };
      lineNumber++;

      // If there's text content after stripping markers, add it as first body line
      const cleaned = stripMarkers(input);
      if (cleaned.trim().length > 0) {
        const segments = parseAnsiLine(cleaned, ansiState);
        currentSection.lines.push({ lineNumber, timestamp, segments });
        lineNumber++;
      }

      continue;
    }

    if (endMatch) {
      const sectionTimestamp = Number(endMatch[1]);

      if (currentSection) {
        currentSection.endTimestamp = sectionTimestamp;
        const dur = sectionTimestamp - currentSection.startTimestamp;
        currentSection.duration = formatSectionDuration(dur);

        entries.push({ type: 'section', data: currentSection });
        currentSection = null;
      }

      // Any leftover text on the end line
      const cleaned = stripMarkers(input);
      if (cleaned.trim().length > 0) {
        const segments = parseAnsiLine(cleaned, ansiState);
        entries.push({ type: 'line', data: { lineNumber, timestamp, segments } });
        lineNumber++;
      }

      continue;
    }

    // Regular line
    const cleaned = stripMarkers(input);
    const segments = parseAnsiLine(cleaned, ansiState);
    const logLine: LogLine = { lineNumber, timestamp, segments };

    if (currentSection) {
      currentSection.lines.push(logLine);
    } else {
      entries.push({ type: 'line', data: logLine });
    }

    lineNumber++;
  }

  // Flush unclosed section
  if (currentSection) {
    entries.push({ type: 'section', data: currentSection });
  }

  return { entries, timestamped: timestamped ?? false };
}

/** Find the last content LogLine to append to (skips section headers). */
function findLastContentLine(
  entries: LogEntry[],
  currentSection: LogSection | null,
): LogLine | null {
  if (currentSection) {
    if (currentSection.lines.length > 0) {
      return currentSection.lines[currentSection.lines.length - 1];
    }
    // Don't return headerLine — it's the section name, not content
    return null;
  }
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.type === 'line') return entry.data;
    if (entry.type === 'section') {
      const sec = entry.data;
      if (sec.lines.length > 0) return sec.lines[sec.lines.length - 1];
      return null;
    }
  }
  return null;
}
