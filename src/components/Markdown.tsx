import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link, useNavigate } from 'react-router-dom';
import type { MouseEvent } from 'react';
import { resolveProjectByPath } from '../services';
import './Markdown.css';

export interface IssueRef {
  instanceId: number;
  projectId: number;
  issueIid: number;
}

export interface IssueLinkContext {
  instanceId: number;
  projectId: number;
  instanceOrigin: string;
  projectPath: string;
  /** If provided, in-app issue links call this instead of navigating the router. */
  onOpenIssue?: (ref: IssueRef) => void;
}

interface Props {
  content: string;
  className?: string;
  issueLinkContext?: IssueLinkContext;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface IssueLinkMatch {
  projectPath: string;
  iid: number;
}

const issueLinkRegexCache = new Map<string, RegExp>();

function getIssueLinkRegex(normalizedOrigin: string): RegExp {
  let re = issueLinkRegexCache.get(normalizedOrigin);
  if (!re) {
    re = new RegExp(
      `^${escapeRegex(normalizedOrigin)}/(.+?)/-/issues/(\\d+)(?:[/?#].*)?$`,
    );
    issueLinkRegexCache.set(normalizedOrigin, re);
  }
  return re;
}

function matchInstanceIssue(
  href: string | undefined,
  origin: string,
): IssueLinkMatch | null {
  if (!href) return null;
  const normalizedOrigin = origin.replace(/\/+$/, '');
  const m = href.match(getIssueLinkRegex(normalizedOrigin));
  if (!m) return null;
  return { projectPath: m[1], iid: Number(m[2]) };
}

function normalizePath(p: string): string {
  return p.replace(/^\/+|\/+$/g, '');
}

export default function Markdown({ content, className, issueLinkContext }: Props) {
  const navigate = useNavigate();

  const openIssue = async (
    ctx: IssueLinkContext,
    match: IssueLinkMatch,
    href: string,
  ) => {
    const sameProject = normalizePath(match.projectPath) === normalizePath(ctx.projectPath);
    let resolvedProjectId = ctx.projectId;
    if (!sameProject) {
      try {
        const project = await resolveProjectByPath(ctx.instanceId, match.projectPath);
        resolvedProjectId = project.id;
      } catch {
        window.open(href, '_blank', 'noopener,noreferrer');
        return;
      }
    }
    const ref: IssueRef = {
      instanceId: ctx.instanceId,
      projectId: resolvedProjectId,
      issueIid: match.iid,
    };
    if (ctx.onOpenIssue) {
      ctx.onOpenIssue(ref);
    } else {
      navigate(`/issues/${ref.instanceId}/${ref.projectId}/${ref.issueIid}`);
    }
  };

  const handleIssueLinkClick = (
    e: MouseEvent<HTMLAnchorElement>,
    ctx: IssueLinkContext,
    match: IssueLinkMatch,
    href: string,
  ) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    void openIssue(ctx, match, href);
  };

  return (
    <div className={`md-body${className ? ` ${className}` : ''}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ href, children, ...rest }) => {
            if (issueLinkContext && href) {
              const match = matchInstanceIssue(href, issueLinkContext.instanceOrigin);
              if (match) {
                const sameProject =
                  normalizePath(match.projectPath) ===
                  normalizePath(issueLinkContext.projectPath);
                // Same-project with no onOpenIssue callback: plain Link keeps
                // native prefetch/accessibility semantics.
                if (sameProject && !issueLinkContext.onOpenIssue) {
                  return (
                    <Link
                      to={`/issues/${issueLinkContext.instanceId}/${issueLinkContext.projectId}/${match.iid}`}
                    >
                      {children}
                    </Link>
                  );
                }
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) =>
                      handleIssueLinkClick(e, issueLinkContext, match, href)
                    }
                    {...rest}
                  >
                    {children}
                  </a>
                );
              }
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" {...rest}>
                {children}
              </a>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
