import { useState, useEffect } from 'react';
import {
  getCustomMrFilter,
  setCustomMrFilter,
  testCustomMrFilter,
  triggerSync,
} from '../../services/tauri';
import type { CustomMrFilter, GitLabInstance } from '../../types';
import { useInstancesQuery } from '../../hooks/queries/useInstancesQuery';
import { useSyncSettingsQuery } from '../../hooks/queries/useSyncSettingsQuery';
import { useToast } from '../../components/Toast';
import { SettingsGroup, SettingsRow } from './SettingsGroup';
import ToggleSwitch from './ToggleSwitch';

function emptyFilter(instanceId: number): CustomMrFilter {
  return {
    instanceId,
    enabled: false,
    draft: 'no',
    authorUsername: null,
    notAuthorUsername: null,
    labels: null,
    updatedAt: 0,
  };
}

/** Normalize a text input value: trimmed, empty string → null. */
function toNullable(value: string): string | null {
  const trimmed = value.trim();
  return trimmed === '' ? null : trimmed;
}

function InstanceFilterCard({
  instance,
  maxMrsPerSync,
}: {
  instance: GitLabInstance;
  maxMrsPerSync: number | undefined;
}) {
  const { addToast } = useToast();
  const [filter, setFilter] = useState<CustomMrFilter | null>(null);
  const [saving, setSaving] = useState(false);
  const [matchCount, setMatchCount] = useState<number | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  useEffect(() => {
    getCustomMrFilter(instance.id)
      .then((f) => setFilter(f ?? emptyFilter(instance.id)))
      .catch(() => setFilter(emptyFilter(instance.id)));
  }, [instance.id]);

  // Debounced live match count whenever the (enabled) filter changes.
  useEffect(() => {
    if (!filter || !filter.enabled) {
      setMatchCount(null);
      setTestError(null);
      return;
    }
    const timer = setTimeout(() => {
      testCustomMrFilter(filter)
        .then((n) => {
          setMatchCount(n);
          setTestError(null);
        })
        .catch((err) => {
          setMatchCount(null);
          setTestError(String(err));
        });
    }, 600);
    return () => clearTimeout(timer);
  }, [filter]);

  if (!filter) return null;

  const update = (patch: Partial<CustomMrFilter>) =>
    setFilter({ ...filter, ...patch });

  async function save() {
    if (!filter) return;
    setSaving(true);
    try {
      await setCustomMrFilter(filter);
      addToast({ type: 'info', title: 'Custom filter saved', body: instance.name ?? instance.url });
      if (filter.enabled) {
        // Surface the new MRs right away.
        triggerSync(true).catch(() => {});
      }
    } catch (err) {
      addToast({ type: 'pipeline-failed', title: 'Failed to save filter', body: String(err) });
    } finally {
      setSaving(false);
    }
  }

  const overCap =
    matchCount !== null && maxMrsPerSync !== undefined && matchCount > maxMrsPerSync;

  return (
    <SettingsGroup
      title={instance.name ?? instance.url}
      footer={
        filter.enabled && (
          <span className={`custom-filter-count${overCap ? ' custom-filter-count--warn' : ''}`}>
            {testError
              ? `Filter check failed: ${testError}`
              : matchCount === null
                ? 'Counting matching MRs…'
                : overCap
                  ? `${matchCount} MRs match — more than the sync limit of ${maxMrsPerSync}; the list will be truncated`
                  : `${matchCount} open MRs match this filter`}
          </span>
        )
      }
    >
      <SettingsRow
        label="Enable custom filter"
        description="Also sync open MRs matching this query, beyond your reviews"
      >
        <ToggleSwitch
          checked={filter.enabled}
          ariaLabel={`Enable custom filter for ${instance.name ?? instance.url}`}
          onChange={(enabled) => update({ enabled })}
        />
      </SettingsRow>
      <SettingsRow label="Drafts" description="Include draft/WIP merge requests" htmlFor={`cf-draft-${instance.id}`}>
        <select
          id={`cf-draft-${instance.id}`}
          value={filter.draft ?? ''}
          disabled={!filter.enabled}
          onChange={(e) => update({ draft: e.target.value === '' ? null : e.target.value })}
        >
          <option value="no">Exclude drafts</option>
          <option value="">Include drafts</option>
          <option value="yes">Only drafts</option>
        </select>
      </SettingsRow>
      <SettingsRow label="Author" description="Only MRs by this username" htmlFor={`cf-author-${instance.id}`}>
        <input
          id={`cf-author-${instance.id}`}
          className="custom-filter-input"
          type="text"
          placeholder="any author"
          value={filter.authorUsername ?? ''}
          disabled={!filter.enabled}
          onChange={(e) => update({ authorUsername: toNullable(e.target.value) })}
        />
      </SettingsRow>
      <SettingsRow label="Exclude author" description="Hide MRs by this username" htmlFor={`cf-not-author-${instance.id}`}>
        <input
          id={`cf-not-author-${instance.id}`}
          className="custom-filter-input"
          type="text"
          placeholder="e.g. renovate-bot"
          value={filter.notAuthorUsername ?? ''}
          disabled={!filter.enabled}
          onChange={(e) => update({ notAuthorUsername: toNullable(e.target.value) })}
        />
      </SettingsRow>
      <SettingsRow label="Labels" description="Comma-separated; MRs must carry all of them" htmlFor={`cf-labels-${instance.id}`}>
        <input
          id={`cf-labels-${instance.id}`}
          className="custom-filter-input"
          type="text"
          placeholder="e.g. magento"
          value={filter.labels ?? ''}
          disabled={!filter.enabled}
          onChange={(e) => update({ labels: toNullable(e.target.value) })}
        />
      </SettingsRow>
      <SettingsRow>
        <button className="custom-filter-save" onClick={save} disabled={saving}>
          {saving ? 'Saving…' : 'Save filter'}
        </button>
      </SettingsRow>
    </SettingsGroup>
  );
}

/**
 * Custom MR filter settings: one user-defined sync scope per instance so MRs
 * the user isn't an explicit reviewer on still show up (issue #28).
 */
export default function CustomFilterSection() {
  const instancesQuery = useInstancesQuery();
  const syncQuery = useSyncSettingsQuery();

  if (!instancesQuery.data) return null;
  if (instancesQuery.data.length === 0) {
    return <p className="empty-state">Connect a GitLab instance first.</p>;
  }

  return (
    <div className="custom-filter-section">
      {instancesQuery.data.map((instance) => (
        <InstanceFilterCard
          key={instance.id}
          instance={instance}
          maxMrsPerSync={syncQuery.data?.max_mrs_per_sync}
        />
      ))}
    </div>
  );
}
