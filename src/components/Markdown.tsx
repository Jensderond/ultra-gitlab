import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Link, useNavigate } from 'react-router-dom';
import type { MouseEvent } from 'react';
import { resolveProjectByPath } from '../services';
import './Markdown.css';

export interface IssueLinkContext {
  instanceId: number;
  projectId: number;
  instanceOrigin: string;
  projectPath: string;
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

function matchInstanceIssue(
  href: string | undefined,
  origin: string,
): IssueLinkMatch | null {
  if (!href) return null;
  const normalizedOrigin = origin.replace(/\/+$/, '');
  const re = new RegExp(
    `^${escapeRegex(normalizedOrigin)}/(.+?)/-/issues/(\\d+)(?:[/?#].*)?$`,
  );
  const m = href.match(re);
  if (!m) return null;
  return { projectPath: m[1], iid: Number(m[2]) };
}

export default function Markdown({ content, className, issueLinkContext }: Props) {
  const navigate = useNavigate();

  const handleCrossProjectClick = async (
    e: MouseEvent<HTMLAnchorElement>,
    ctx: IssueLinkContext,
    match: IssueLinkMatch,
    href: string,
  ) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    try {
      const project = await resolveProjectByPath(ctx.instanceId, match.projectPath);
      navigate(`/issues/${ctx.instanceId}/${project.id}/${match.iid}`);
    } catch {
      window.open(href, '_blank', 'noopener,noreferrer');
    }
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
                const normalizedPath = match.projectPath.replace(/^\/+|\/+$/g, '');
                const sameProjectPath = issueLinkContext.projectPath.replace(
                  /^\/+|\/+$/g,
                  '',
                );
                if (normalizedPath === sameProjectPath) {
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
                      handleCrossProjectClick(e, issueLinkContext, match, href)
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
