/** "+ Add project" sheet: live GitLab project search → add to the dashboard. */

import { useEffect, useRef, useState } from 'react';
import { api } from '../../api/client';
import type { ProjectSearchResult } from '../../api/types';
import { invalidate } from '../../data/query';
import { Button, cx, SearchField, Sheet, Spinner, toast } from '../../ui/components';
import { CheckIcon } from '../../ui/icons';

export function AddProjectSheet({
  open,
  onClose,
  instanceId,
  existing,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  instanceId: number;
  existing: Set<number>;
  onAdded: (projectId: number) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProjectSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState<number | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    let cancelled = false;
    const t = setTimeout(() => {
      api
        .searchProjects(instanceId, q)
        .then((r) => {
          if (cancelled) return;
          setResults(r);
          setActive(0);
          setError(null);
        })
        .catch((e: Error) => !cancelled && setError(e.message))
        .finally(() => !cancelled && setSearching(false));
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [query, instanceId]);

  useEffect(() => {
    listRef.current?.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  const add = async (p: ProjectSearchResult) => {
    if (adding) return;
    if (existing.has(p.id)) {
      onAdded(p.id);
      onClose();
      return;
    }
    setAdding(p.id);
    try {
      await api.visitProject(instanceId, p.id);
      await invalidate(['pipelines', 'projects', instanceId]);
      onAdded(p.id);
      onClose();
      toast(`Added ${p.name}`);
    } catch (e) {
      toast(`Couldn’t add ${p.name}: ${(e as Error).message}`, { tone: 'error' });
    } finally {
      setAdding(null);
    }
  };

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Add a project"
      width={540}
      footer={
        <Button onClick={onClose} data-autofocus-skip>
          Cancel
        </Button>
      }
    >
      <SearchField
        label="Search projects"
        placeholder="Search projects by name or path"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        hint={searching ? '…' : undefined}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            setActive((a) => Math.min(results.length - 1, a + 1));
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setActive((a) => Math.max(0, a - 1));
          } else if (e.key === 'Enter' && results[active]) {
            e.preventDefault();
            void add(results[active]);
          }
        }}
      />
      <div className="pl-add__results" ref={listRef} role="listbox" aria-label="Projects">
        {error ? (
          <p className="pl-add__note">Search failed: {error}</p>
        ) : !query.trim() ? (
          <p className="pl-add__note">Type to search the projects you can see on this GitLab.</p>
        ) : searching && !results.length ? (
          <p className="pl-add__note">
            <Spinner size={12} /> Searching…
          </p>
        ) : !results.length ? (
          <p className="pl-add__note">No projects match “{query.trim()}”.</p>
        ) : (
          results.map((p, i) => (
            <div
              key={p.id}
              role="option"
              aria-selected={i === active}
              className={cx('pl-add__row', i === active && 'is-active')}
              onMouseMove={() => setActive(i)}
              onClick={() => void add(p)}
            >
              <div className="pl-add__text">
                <span className="pl-add__name">{p.name}</span>
                <span className="pl-add__path mono">{p.pathWithNamespace}</span>
              </div>
              {adding === p.id ? (
                <Spinner size={12} />
              ) : existing.has(p.id) ? (
                <span className="pl-add__added">
                  <CheckIcon size={12} /> Added
                </span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </Sheet>
  );
}
