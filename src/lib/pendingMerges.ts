/**
 * Tracks MRs whose merge is optimistically applied but still running
 * server-side. Consumers filter these IDs out of list queries so the
 * UI stays consistent even if a background refetch lands before the
 * merge actually completes on GitLab.
 */

type Listener = () => void;

let snapshot: ReadonlySet<number> = new Set();
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l();
}

export const pendingMerges = {
  add(id: number) {
    if (snapshot.has(id)) return;
    const next = new Set(snapshot);
    next.add(id);
    snapshot = next;
    emit();
  },
  remove(id: number) {
    if (!snapshot.has(id)) return;
    const next = new Set(snapshot);
    next.delete(id);
    snapshot = next;
    emit();
  },
  getSnapshot(): ReadonlySet<number> {
    return snapshot;
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};
