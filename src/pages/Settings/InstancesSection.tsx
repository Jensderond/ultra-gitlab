import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import InstanceSetup from '../../components/InstanceSetup/InstanceSetup';
import {
  removeInstance,
  setDefaultInstance,
} from '../../services/gitlab';
import { getTokenInfo } from '../../services/tauri';
import type { TokenInfo } from '../../types';
import InstanceItem from './InstanceItem';
import { useInstancesQuery } from '../../hooks/queries/useInstancesQuery';
import { queryKeys } from '../../lib/queryKeys';

/**
 * GitLab instances management section.
 */
export default function InstancesSection() {
  const queryClient = useQueryClient();
  const instancesQuery = useInstancesQuery();
  const instances = instancesQuery.data ?? [];
  const loading = instancesQuery.isLoading;
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [tokenInfoMap, setTokenInfoMap] = useState<Record<number, TokenInfo | 'error'>>({});

  useEffect(() => {
    if (instances.length > 0) {
      loadTokenInfos(instances);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [instances]);

  async function loadTokenInfos(insts: typeof instances) {
    const results = await Promise.allSettled(
      insts.filter((i) => i.hasToken).map(async (inst) => {
        const info = await getTokenInfo(inst.id);
        return { id: inst.id, info };
      })
    );
    const map: Record<number, TokenInfo | 'error'> = {};
    for (const result of results) {
      if (result.status === 'fulfilled') {
        map[result.value.id] = result.value.info;
      }
    }
    setTokenInfoMap(map);
  }

  async function handleDelete(instanceId: number) {
    try {
      await removeInstance(instanceId);
      queryClient.invalidateQueries({ queryKey: queryKeys.instances() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete instance');
    }
  }

  async function handleSetDefault(instanceId: number) {
    try {
      await setDefaultInstance(instanceId);
      queryClient.invalidateQueries({ queryKey: queryKeys.instances() });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set default');
    }
  }

  function handleSetupComplete() {
    setShowSetup(false);
    queryClient.invalidateQueries({ queryKey: queryKeys.instances() });
  }

  return (
    <section className="settings-section">
      <div className="section-header">
        <h2>GitLab Instances</h2>
        <button
          className="add-button"
          onClick={() => setShowSetup(true)}
          disabled={showSetup}
        >
          + Add Instance
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      {showSetup && (
        <InstanceSetup
          onComplete={handleSetupComplete}
          onCancel={() => setShowSetup(false)}
        />
      )}

      {loading ? (
        <p className="loading">Loading instances...</p>
      ) : instances.length === 0 ? (
        <p className="empty-state">
          No GitLab instances configured.
          <br />
          Add one to start reviewing merge requests.
        </p>
      ) : (
        <ul className="instance-list">
          {instances.map((inst) => (
            <InstanceItem
              key={inst.id}
              inst={inst}
              tokenInfo={tokenInfoMap[inst.id]}
              onDelete={handleDelete}
              onSetDefault={handleSetDefault}
              onTokenUpdated={() => queryClient.invalidateQueries({ queryKey: queryKeys.instances() })}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
