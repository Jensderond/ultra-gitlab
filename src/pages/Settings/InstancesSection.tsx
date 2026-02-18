import { useState, useEffect } from 'react';
import InstanceSetup from '../../components/InstanceSetup/InstanceSetup';
import {
  listInstances,
  removeInstance,
  type GitLabInstanceWithStatus,
} from '../../services/gitlab';
import { getTokenInfo } from '../../services/tauri';
import type { TokenInfo } from '../../types';
import InstanceItem from './InstanceItem';

/**
 * GitLab instances management section.
 */
export default function InstancesSection() {
  const [instances, setInstances] = useState<GitLabInstanceWithStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showSetup, setShowSetup] = useState(false);
  const [tokenInfoMap, setTokenInfoMap] = useState<Record<number, TokenInfo | 'error'>>({});

  useEffect(() => { loadInstances(); }, []);

  async function loadInstances() {
    try {
      setLoading(true);
      setError(null);
      const result = await listInstances();
      setInstances(result);
      loadTokenInfos(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load instances');
    } finally {
      setLoading(false);
    }
  }

  async function loadTokenInfos(insts: GitLabInstanceWithStatus[]) {
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
      await loadInstances();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete instance');
    }
  }

  function handleSetupComplete() {
    setShowSetup(false);
    loadInstances();
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
              onTokenUpdated={loadInstances}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
