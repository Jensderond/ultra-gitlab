/**
 * Safe GitLab-flavoured Markdown → React elements.
 *
 * A small two-stage parser (blocks, then inlines) that never produces HTML
 * strings: everything renders through React, so user content can't inject
 * markup. Raw HTML in the source is not passed through — `<br>` becomes a
 * line break, `<img>` a link, comments vanish and other known tags are
 * dropped (their text is kept).
 *
 * Supports: paragraphs, ATX/setext headings, nested lists, task lists,
 * blockquotes, fenced/indented code, ```suggestion fences, tables, rules,
 * emphasis/strong/strike, inline code, links, autolinks, images (as links),
 * @mentions, !123 / #123 references and common :emoji:.
 *
 *   <Markdown source={mr.description} baseUrl={projectWebUrl} />
 *
 * `baseUrl` (a project web URL) is optional; with it, relative links,
 * references and mentions become clickable. Links open in the browser.
 */

import { Fragment, memo, useMemo, type MouseEvent, type ReactNode } from 'react';
import { openExternal } from '../api/client';
import './Markdown.css';

/* ------------------------------------------------------------------------ */
/* AST                                                                      */
/* ------------------------------------------------------------------------ */

export type Align = 'left' | 'center' | 'right' | null;

export type Block =
  | { type: 'heading'; level: number; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'code'; lang: string; text: string }
  | { type: 'suggestion'; text: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { type: 'table'; align: Align[]; header: string[]; rows: string[][] }
  | { type: 'hr' };

export interface ListItem {
  /** null = not a task item; otherwise whether it's ticked. */
  task: boolean | null;
  children: Block[];
}

export type Inline =
  | { type: 'text'; text: string }
  | { type: 'code'; text: string }
  | { type: 'strong' | 'em' | 'del'; children: Inline[] }
  | { type: 'link'; href: string; children: Inline[]; title?: string }
  | { type: 'image'; href: string; alt: string }
  | { type: 'mention'; name: string }
  | { type: 'ref'; kind: 'mr' | 'issue'; project: string; num: number; text: string }
  | { type: 'br' };

/* ------------------------------------------------------------------------ */
/* Block parser                                                             */
/* ------------------------------------------------------------------------ */

const FENCE = /^ {0,3}(`{3,}|~{3,})\s*([^`\s]*)[^`]*$/;
const ATX = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const HR = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const SETEXT = /^ {0,3}(=+|-+)[ \t]*$/;
const QUOTE = /^ {0,3}> ?/;
const ITEM = /^( {0,3})([-*+]|\d{1,9}[.)])([ \t]+|$)(.*)$/;
const TABLE_DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
const BLANK = /^\s*$/;

const expandTabs = (line: string) => line.replace(/\t/g, '    ');
const indentOf = (line: string) => line.length - line.trimStart().length;
const isTableStart = (line: string, next: string | undefined) =>
  line.includes('|') && next !== undefined && next.includes('-') && TABLE_DELIM.test(next);

function splitRow(line: string): string[] {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = '';
  let inCode = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '\\' && s[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (ch === '`') {
      inCode = !inCode;
      cur += ch;
    } else if (ch === '|' && !inCode) {
      cells.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

/** Would this line start a new block (and so interrupt a paragraph)? */
function startsBlock(line: string, next: string | undefined): boolean {
  if (FENCE.test(line) || ATX.test(line) || HR.test(line) || QUOTE.test(line)) return true;
  const item = ITEM.exec(line);
  // Like CommonMark: an ordered list only interrupts a paragraph when it starts
  // at 1, and an empty item never does.
  if (item && item[4].trim() && (!/^\d/.test(item[2]) || /^1[.)]$/.test(item[2]))) return true;
  return isTableStart(line, next);
}

/** Parse Markdown source into blocks (exported for tests). */
export function parseBlocks(source: string): Block[] {
  return parseLines(stripHidden(source.replace(/\r\n?/g, '\n').split('\n').map(expandTabs)));
}

/** Drop HTML comments and <script>/<style> blocks — outside fenced code only. */
function stripHidden(lines: string[]): string[] {
  const out: string[] = [];
  let chunk: string[] = [];
  const flushChunk = () => {
    if (!chunk.length) return;
    const text = chunk
      .join('\n')
      .replace(/<!--[\s\S]*?(-->|$)/g, '')
      .replace(/<(script|style)\b[\s\S]*?(<\/\1\s*>|$)/gi, '');
    out.push(...text.split('\n'));
    chunk = [];
  };
  let fence: RegExp | null = null;
  for (const line of lines) {
    if (fence) {
      out.push(line);
      if (fence.test(line)) fence = null;
      continue;
    }
    const f = FENCE.exec(line);
    if (f) {
      flushChunk();
      fence = new RegExp(`^ {0,3}\\${f[1][0]}{${f[1].length},}\\s*$`);
      out.push(line);
      continue;
    }
    chunk.push(line);
  }
  flushChunk();
  return out;
}

function parseLines(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (BLANK.test(line)) {
      i++;
      continue;
    }

    // Fenced code (and GitLab suggestions).
    const fence = FENCE.exec(line);
    if (fence) {
      const marker = fence[1];
      const lang = fence[2] ?? '';
      const indent = indentOf(line);
      const close = new RegExp(`^ {0,3}\\${marker[0]}{${marker.length},}\\s*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length) {
        const l = lines[i];
        i++;
        if (close.test(l)) break;
        body.push(l.slice(Math.min(indent, indentOf(l))));
      }
      const text = body.join('\n');
      if (/^suggestion(:|$)/i.test(lang)) blocks.push({ type: 'suggestion', text });
      else blocks.push({ type: 'code', lang, text });
      continue;
    }

    // Indented code.
    if (indentOf(line) >= 4) {
      const body: string[] = [];
      while (i < lines.length && (indentOf(lines[i]) >= 4 || BLANK.test(lines[i]))) {
        body.push(lines[i].slice(4));
        i++;
      }
      while (body.length && BLANK.test(body[body.length - 1])) body.pop();
      blocks.push({ type: 'code', lang: '', text: body.join('\n') });
      continue;
    }

    const atx = ATX.exec(line);
    if (atx) {
      blocks.push({ type: 'heading', level: atx[1].length, text: (atx[2] ?? '').trim() });
      i++;
      continue;
    }

    if (HR.test(line)) {
      blocks.push({ type: 'hr' });
      i++;
      continue;
    }

    if (QUOTE.test(line)) {
      const body: string[] = [];
      while (i < lines.length && QUOTE.test(lines[i])) {
        body.push(lines[i].replace(QUOTE, ''));
        i++;
      }
      blocks.push({ type: 'quote', children: parseLines(body) });
      continue;
    }

    const item = ITEM.exec(line);
    if (item && (item[4].trim() || (i + 1 < lines.length && !BLANK.test(lines[i + 1])))) {
      const parsed = parseList(lines, i);
      blocks.push(parsed.block);
      i = parsed.end;
      continue;
    }

    // Table: header row + delimiter row.
    if (isTableStart(line, lines[i + 1])) {
      const header = splitRow(line);
      const align: Align[] = splitRow(lines[i + 1]).map((c) => {
        const l = c.startsWith(':');
        const r = c.endsWith(':');
        return l && r ? 'center' : r ? 'right' : l ? 'left' : null;
      });
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && !BLANK.test(lines[i]) && lines[i].includes('|')) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ type: 'table', align, header, rows });
      continue;
    }

    // Paragraph (possibly a setext heading).
    const para: string[] = [line];
    i++;
    let setext = 0;
    while (i < lines.length && !BLANK.test(lines[i])) {
      const l = lines[i];
      const s = SETEXT.exec(l);
      if (s) {
        setext = s[1][0] === '=' ? 1 : 2;
        i++;
        break;
      }
      if (startsBlock(l, lines[i + 1])) break;
      para.push(l);
      i++;
    }
    const text = para.map((l) => l.replace(/^ {0,3}/, '')).join('\n');
    blocks.push(setext ? { type: 'heading', level: setext, text: text.trim() } : { type: 'paragraph', text });
  }
  return blocks;
}

const markerKind = (m: string) => (/^\d/.test(m) ? `ol${m.slice(-1)}` : m);

function parseList(lines: string[], start: number): { block: Block; end: number } {
  const first = ITEM.exec(lines[start])!;
  const kind = markerKind(first[2]);
  const ordered = kind.startsWith('ol');
  const items: ListItem[] = [];
  let i = start;

  while (i < lines.length) {
    const m = ITEM.exec(lines[i]);
    if (!m || markerKind(m[2]) !== kind) break;

    // Content indent: marker plus the 1–4 spaces after it.
    const spaces = m[3].length;
    const contentIndent = m[1].length + m[2].length + (spaces > 4 || spaces === 0 ? 1 : spaces);
    const body: string[] = [m[4]];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (BLANK.test(l)) {
        // A blank line continues the item only if indented content follows.
        let j = i;
        while (j < lines.length && BLANK.test(lines[j])) j++;
        if (j < lines.length && indentOf(lines[j]) >= contentIndent) {
          for (; i < j; i++) body.push('');
          continue;
        }
        break;
      }
      if (indentOf(l) >= contentIndent) {
        body.push(l.slice(contentIndent));
        i++;
        continue;
      }
      // Lazy continuation of the item's paragraph.
      if (!ITEM.test(l) && !startsBlock(l, lines[i + 1]) && !BLANK.test(body[body.length - 1])) {
        body.push(l.trim());
        i++;
        continue;
      }
      break;
    }

    let task: boolean | null = null;
    const t = /^\[([ xX])\](?:\s+|$)/.exec(body[0]);
    if (t) {
      task = t[1] !== ' ';
      body[0] = body[0].slice(t[0].length);
    }
    items.push({ task, children: parseLines(body) });

    // Blank lines between items of the same list belong to the list.
    let j = i;
    while (j < lines.length && BLANK.test(lines[j])) j++;
    if (j !== i && j < lines.length) {
      const n = ITEM.exec(lines[j]);
      if (n && markerKind(n[2]) === kind) i = j;
    }
  }

  return {
    block: { type: 'list', ordered, start: ordered ? parseInt(first[2], 10) : 1, items },
    end: i,
  };
}

/* ------------------------------------------------------------------------ */
/* Inline parser                                                            */
/* ------------------------------------------------------------------------ */

const EMOJI: Record<string, string> = {
  '+1': '👍',
  thumbsup: '👍',
  '-1': '👎',
  thumbsdown: '👎',
  tada: '🎉',
  rocket: '🚀',
  heart: '❤️',
  smile: '😄',
  slight_smile: '🙂',
  joy: '😂',
  eyes: '👀',
  warning: '⚠️',
  white_check_mark: '✅',
  heavy_check_mark: '✔️',
  x: '❌',
  fire: '🔥',
  bug: '🐛',
  thinking: '🤔',
  pray: '🙏',
  clap: '👏',
  wave: '👋',
  sparkles: '✨',
  bulb: '💡',
  memo: '📝',
  construction: '🚧',
  question: '❓',
  exclamation: '❗',
  ok_hand: '👌',
  muscle: '💪',
  '100': '💯',
};

/** HTML tags we silently drop (keeping their text). Anything else stays literal (`Array<T>`). */
const KNOWN_TAGS = new Set(
  'a abbr b blockquote center code dd del details div dl dt em h1 h2 h3 h4 h5 h6 i ins kbd li mark ol p pre q s samp small span strike strong sub summary sup table tbody td tfoot th thead tr tt u ul var'.split(
    ' ',
  ),
);

const ESCAPABLE = /[\\`*_{}[\]()#+\-.!|~<>@:"']/;
const URL_RE = /^(?:https?:\/\/|www\.)[^\s<]*[^\s<?!.,:;*_~'")\]]/i;
const MENTION_RE = /^@([a-zA-Z0-9_](?:[a-zA-Z0-9_.-]*[a-zA-Z0-9_])?)/;
const REF_RE = /^((?:[a-zA-Z0-9_.-]+\/)+[a-zA-Z0-9_.-]+)?([!#])(\d+)(?![\w])/;
const TAG_RE = /^<(\/?)([a-zA-Z][a-zA-Z0-9-]*)((?:\s+[^<>]*)?)\/?>/;

/** Find where `marker` (`*`, `**`, `_`, `__`, `~~`) closes a span opened just before `from`. */
function findClose(s: string, marker: string, from: number): number {
  const c = marker[0];
  let i = from;
  while (i < s.length) {
    const ch = s[i];
    if (ch === '\\') {
      i += 2;
      continue;
    }
    if (ch === '`') {
      const run = /^`+/.exec(s.slice(i))![0];
      const end = s.indexOf(run, i + run.length);
      i = end > 0 ? end + run.length : i + run.length;
      continue;
    }
    if (ch === c) {
      let run = 1;
      while (s[i + run] === c) run++;
      const canClose = i > from && !/\s/.test(s[i - 1]);
      const after = s[i + run];
      const flankOk = c !== '_' || !after || !/[a-zA-Z0-9]/.test(after);
      if (canClose && flankOk && run >= marker.length) return i + (run - marker.length);
      i += run;
      continue;
    }
    i++;
  }
  return -1;
}

/** Match `[text](url "title")` with `i` pointing at `[`. */
function matchLink(s: string, i: number): { text: string; href: string; title?: string; end: number } | null {
  let depth = 0;
  let j = i;
  for (; j < s.length; j++) {
    if (s[j] === '\\') {
      j++;
      continue;
    }
    if (s[j] === '[') depth++;
    else if (s[j] === ']' && --depth === 0) break;
  }
  if (depth !== 0 || s[j + 1] !== '(') return null;
  const text = s.slice(i + 1, j);
  let k = j + 2;
  let parens = 0;
  for (; k < s.length; k++) {
    if (s[k] === '(') parens++;
    else if (s[k] === ')') {
      if (parens === 0) break;
      parens--;
    }
  }
  if (k >= s.length) return null;
  const m = /^\s*<?([^\s>]*)>?(?:\s+["'(]([\s\S]*)["')])?\s*$/.exec(s.slice(j + 2, k));
  if (!m) return null;
  return { text, href: m[1], title: m[2], end: k + 1 };
}

/** Parse inline Markdown (exported for tests). */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let text = '';
  const flush = () => {
    if (text) out.push({ type: 'text', text });
    text = '';
  };
  const push = (node: Inline) => {
    flush();
    out.push(node);
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    const prev = i > 0 ? src[i - 1] : '';
    const rest = src.slice(i);

    // Escapes and line breaks (soft breaks are spaces, like GitLab).
    if (ch === '\\') {
      if (src[i + 1] === '\n') {
        push({ type: 'br' });
        i += 2;
        continue;
      }
      if (ESCAPABLE.test(src[i + 1] ?? '')) {
        text += src[i + 1];
        i += 2;
        continue;
      }
    }
    if (ch === '\n') {
      const hard = / {2,}$/.test(text);
      text = text.replace(/ +$/, '');
      if (hard) push({ type: 'br' });
      else text += ' ';
      i++;
      while (src[i] === ' ') i++;
      continue;
    }

    // Code spans.
    if (ch === '`') {
      const run = /^`+/.exec(rest)![0];
      let end = src.indexOf(run, i + run.length);
      while (end > 0 && src[end + run.length] === '`') end = src.indexOf(run, end + run.length + 1);
      if (end > 0) {
        let code = src.slice(i + run.length, end).replace(/\n/g, ' ');
        if (/^ .* $/.test(code) && code.trim()) code = code.slice(1, -1);
        push({ type: 'code', text: code });
        i = end + run.length;
        continue;
      }
      text += run;
      i += run.length;
      continue;
    }

    // Raw HTML is never rendered; keep the meaningful bits.
    if (ch === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s>]+)>/i.exec(rest);
      if (auto) {
        push({ type: 'link', href: auto[1], children: [{ type: 'text', text: auto[1].replace(/^mailto:/i, '') }] });
        i += auto[0].length;
        continue;
      }
      const tag = TAG_RE.exec(rest);
      if (tag) {
        const name = tag[2].toLowerCase();
        if (name === 'br' || name === 'hr') {
          push({ type: 'br' });
          i += tag[0].length;
          continue;
        }
        if (name === 'img') {
          const srcAttr = /\ssrc\s*=\s*["']([^"']+)["']/i.exec(tag[3]);
          const alt = /\salt\s*=\s*["']([^"']*)["']/i.exec(tag[3]);
          if (srcAttr) push({ type: 'image', href: srcAttr[1], alt: alt?.[1] ?? '' });
          i += tag[0].length;
          continue;
        }
        if (KNOWN_TAGS.has(name)) {
          i += tag[0].length;
          continue;
        }
      }
    }

    // Images and links.
    if (ch === '!' && src[i + 1] === '[') {
      const link = matchLink(src, i + 1);
      if (link) {
        push({ type: 'image', href: link.href, alt: link.text });
        i = link.end;
        continue;
      }
    }
    if (ch === '[') {
      const link = matchLink(src, i);
      if (link) {
        push({ type: 'link', href: link.href, title: link.title, children: parseInline(link.text) });
        i = link.end;
        continue;
      }
    }

    // Emphasis, strong, strikethrough.
    if (ch === '*' || ch === '_' || (ch === '~' && src[i + 1] === '~')) {
      let run = 1;
      while (src[i + run] === ch) run++;
      const marker = ch === '~' ? '~~' : run >= 2 ? ch + ch : ch;
      const after = src[i + marker.length];
      const canOpen =
        after !== undefined && !/\s/.test(after) && !(ch === '_' && /[a-zA-Z0-9]/.test(prev));
      if (canOpen && (ch !== '~' || run === 2)) {
        const close = findClose(src, marker, i + marker.length);
        if (close > i + marker.length) {
          const type = ch === '~' ? 'del' : marker.length === 2 ? 'strong' : 'em';
          push({ type, children: parseInline(src.slice(i + marker.length, close)) });
          i = close + marker.length;
          continue;
        }
      }
      text += src.slice(i, i + run);
      i += run;
      continue;
    }

    // Bare URLs.
    if ((ch === 'h' || ch === 'w' || ch === 'H' || ch === 'W') && !/[a-zA-Z0-9/]/.test(prev)) {
      const url = URL_RE.exec(rest);
      if (url) {
        let u = url[0];
        // Drop an unbalanced trailing ')' — "(see https://x.y/z)".
        while (u.endsWith(')') && (u.match(/\(/g)?.length ?? 0) < (u.match(/\)/g)?.length ?? 0)) {
          u = u.slice(0, -1);
        }
        push({
          type: 'link',
          href: /^www\./i.test(u) ? `https://${u}` : u,
          children: [{ type: 'text', text: u }],
        });
        i += u.length;
        continue;
      }
    }

    // @mentions.
    if (ch === '@' && !/[a-zA-Z0-9_.`]/.test(prev)) {
      const m = MENTION_RE.exec(rest);
      if (m) {
        push({ type: 'mention', name: m[1] });
        i += m[0].length;
        continue;
      }
    }

    // !123, #123, group/project!123.
    if (!/[a-zA-Z0-9_/.&-]/.test(prev) && (ch === '!' || ch === '#' || /[a-zA-Z0-9_]/.test(ch))) {
      const m = REF_RE.exec(rest);
      if (m && (m[1] || ch === '!' || ch === '#')) {
        push({
          type: 'ref',
          kind: m[2] === '!' ? 'mr' : 'issue',
          project: m[1] ?? '',
          num: Number(m[3]),
          text: m[0],
        });
        i += m[0].length;
        continue;
      }
    }

    // :emoji:
    if (ch === ':') {
      const m = /^:([a-z0-9_+-]+):/.exec(rest);
      if (m && EMOJI[m[1]]) {
        text += EMOJI[m[1]];
        i += m[0].length;
        continue;
      }
    }

    text += ch;
    i++;
  }
  flush();
  return out;
}

/* ------------------------------------------------------------------------ */
/* Rendering                                                                */
/* ------------------------------------------------------------------------ */

/** `…/group/proj/-/merge_requests/4` → `…/group/proj`, so callers can pass an MR's web URL. */
const projectUrl = (url: string) => url.replace(/\/-\/.*$/, '').replace(/\/+$/, '');

/** Resolve a link target; null for unsafe or unresolvable targets (exported for tests). */
export function resolveHref(href: string, baseUrl?: string): string | null {
  const h = href.trim();
  if (/^(https?:|mailto:)/i.test(h)) return h;
  if (/^[a-z][a-z0-9+.-]*:/i.test(h)) return null; // javascript:, data:, file:…
  if (!baseUrl || !h || h.startsWith('#')) return null;
  try {
    const base = projectUrl(baseUrl);
    // GitLab uploads and project-relative links resolve against the project.
    if (h.startsWith('/uploads/')) return base + h;
    return new URL(h, `${base}/`).toString();
  } catch {
    return null;
  }
}

interface Ctx {
  baseUrl?: string;
}

function onLinkClick(e: MouseEvent<HTMLAnchorElement>) {
  e.preventDefault();
  e.stopPropagation();
  const href = e.currentTarget.dataset.href;
  if (href) void openExternal(href);
}

function ExtLink({ href, title, children }: { href: string | null; title?: string; children: ReactNode }) {
  if (!href) return <span className="md-link md-link--dead">{children}</span>;
  return (
    <a
      className="md-link"
      href={href}
      data-href={href}
      title={title || href}
      onClick={onLinkClick}
      onAuxClick={(e) => e.preventDefault()}
      draggable={false}
    >
      {children}
    </a>
  );
}

const ImageGlyph = () => (
  <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <circle cx="9" cy="10" r="2" />
    <path d="M21 17l-5-5-9 8" />
  </svg>
);

function origin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function renderInline(nodes: Inline[], ctx: Ctx): ReactNode[] {
  return nodes.map((n, k) => {
    switch (n.type) {
      case 'text':
        return <Fragment key={k}>{n.text}</Fragment>;
      case 'code':
        return (
          <code key={k} className="md-code">
            {n.text}
          </code>
        );
      case 'strong':
        return <strong key={k}>{renderInline(n.children, ctx)}</strong>;
      case 'em':
        return <em key={k}>{renderInline(n.children, ctx)}</em>;
      case 'del':
        return <del key={k}>{renderInline(n.children, ctx)}</del>;
      case 'br':
        return <br key={k} />;
      case 'link':
        return (
          <ExtLink key={k} href={resolveHref(n.href, ctx.baseUrl)} title={n.title}>
            {renderInline(n.children, ctx)}
          </ExtLink>
        );
      case 'image': {
        const name = n.alt || decodeURIComponent(n.href.split('/').pop() || '') || 'image';
        return (
          <ExtLink key={k} href={resolveHref(n.href, ctx.baseUrl)}>
            <span className="md-image">
              <ImageGlyph />
              {name}
            </span>
          </ExtLink>
        );
      }
      case 'mention': {
        const o = origin(ctx.baseUrl);
        const body = <span className="md-mention">@{n.name}</span>;
        return o && !['all', 'here'].includes(n.name) ? (
          <ExtLink key={k} href={`${o}/${n.name}`}>
            {body}
          </ExtLink>
        ) : (
          <Fragment key={k}>{body}</Fragment>
        );
      }
      case 'ref': {
        const o = origin(ctx.baseUrl);
        const project = n.project ? `${o}/${n.project}` : ctx.baseUrl && projectUrl(ctx.baseUrl);
        const body = <span className="md-ref">{n.text}</span>;
        return o && project ? (
          <ExtLink key={k} href={`${project}/-/${n.kind === 'mr' ? 'merge_requests' : 'issues'}/${n.num}`}>
            {body}
          </ExtLink>
        ) : (
          <Fragment key={k}>{body}</Fragment>
        );
      }
    }
  });
}

function renderBlocks(blocks: Block[], ctx: Ctx, tight = false): ReactNode[] {
  return blocks.map((b, k) => {
    switch (b.type) {
      case 'heading': {
        const H = `h${Math.min(b.level, 6)}` as 'h1';
        return (
          <H key={k} className={`md-h md-h${b.level}`}>
            {renderInline(parseInline(b.text), ctx)}
          </H>
        );
      }
      case 'paragraph':
        return tight ? (
          <Fragment key={k}>{renderInline(parseInline(b.text), ctx)}</Fragment>
        ) : (
          <p key={k} className="md-p">
            {renderInline(parseInline(b.text), ctx)}
          </p>
        );
      case 'code':
        return (
          <pre key={k} className="md-pre" data-lang={b.lang || undefined}>
            <code>{b.text}</code>
          </pre>
        );
      case 'suggestion': {
        const lines = b.text === '' ? [] : b.text.split('\n');
        return (
          <div key={k} className="md-suggestion">
            <div className="md-suggestion__head">Suggested change</div>
            <pre className="md-suggestion__body">
              {lines.length === 0 ? (
                <span className="md-suggestion__empty">Remove the selected lines</span>
              ) : (
                lines.map((l, j) => (
                  <span key={j} className="md-suggestion__line">
                    <span className="md-suggestion__sign" aria-hidden="true">
                      +
                    </span>
                    <code>{l || ' '}</code>
                  </span>
                ))
              )}
            </pre>
          </div>
        );
      }
      case 'quote':
        return (
          <blockquote key={k} className="md-quote">
            {renderBlocks(b.children, ctx)}
          </blockquote>
        );
      case 'hr':
        return <hr key={k} className="md-hr" />;
      case 'list': {
        const L = b.ordered ? 'ol' : 'ul';
        // Compact like GitLab's tight lists: one paragraph per item renders inline.
        const tightList = b.items.every(
          (it) => it.children.filter((c) => c.type === 'paragraph').length <= 1,
        );
        return (
          <L key={k} className="md-list" start={b.ordered && b.start !== 1 ? b.start : undefined}>
            {b.items.map((it, j) =>
              it.task === null ? (
                <li key={j}>{renderBlocks(it.children, ctx, tightList)}</li>
              ) : (
                <li key={j} className="md-task">
                  <span
                    role="checkbox"
                    aria-checked={it.task}
                    aria-disabled="true"
                    aria-label={it.task ? 'Done' : 'Not done'}
                    className={it.task ? 'md-task__box is-checked' : 'md-task__box'}
                  >
                    {it.task && (
                      <svg aria-hidden="true" width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M5 12.5l4.5 4.5L19 7.5" />
                      </svg>
                    )}
                  </span>
                  <div className="md-task__body">{renderBlocks(it.children, ctx, tightList)}</div>
                </li>
              ),
            )}
          </L>
        );
      }
      case 'table': {
        const style = (j: number) => (b.align[j] ? { textAlign: b.align[j]! } : undefined);
        return (
          <div key={k} className="md-table-wrap">
            <table className="md-table">
              <thead>
                <tr>
                  {b.header.map((c, j) => (
                    <th key={j} style={style(j)}>
                      {renderInline(parseInline(c), ctx)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {b.rows.map((r, j) => (
                  <tr key={j}>
                    {b.header.map((_, c) => (
                      <td key={c} style={style(c)}>
                        {renderInline(parseInline(r[c] ?? ''), ctx)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      }
    }
  });
}

export const Markdown = memo(function Markdown({
  source,
  className,
  baseUrl,
}: {
  source: string;
  className?: string;
  /** Project (or MR) web URL: makes relative links, !refs, #refs and @mentions clickable. */
  baseUrl?: string;
}) {
  const blocks = useMemo(() => parseBlocks(source ?? ''), [source]);
  return <div className={className ? `md selectable ${className}` : 'md selectable'}>{renderBlocks(blocks, { baseUrl })}</div>;
});
