import { useState, useEffect } from 'react';
import { getCollapsePatterns, updateCollapsePatterns } from '../../services/tauri';
import { SettingsGroup, SettingsRow } from './SettingsGroup';

/**
 * Editor for generated file collapse patterns.
 */
export default function CollapsePatternsEditor() {
  const [patterns, setPatterns] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadPatterns();
  }, []);

  async function loadPatterns() {
    try {
      setLoading(true);
      const result = await getCollapsePatterns();
      setPatterns(result);
    } catch (err) {
      console.error('Failed to load collapse patterns:', err);
      setPatterns([]);
    } finally {
      setLoading(false);
    }
  }

  async function savePatterns(newPatterns: string[]) {
    try {
      setSaving(true);
      await updateCollapsePatterns(newPatterns);
      setPatterns(newPatterns);
    } catch (err) {
      console.error('Failed to save collapse patterns:', err);
    } finally {
      setSaving(false);
    }
  }

  function handlePatternChange(index: number, value: string) {
    const updated = [...patterns];
    updated[index] = value;
    setPatterns(updated);
  }

  function handlePatternBlur(index: number) {
    const trimmed = patterns[index].trim();
    if (trimmed === '') {
      const updated = patterns.filter((_, i) => i !== index);
      savePatterns(updated);
    } else {
      const updated = [...patterns];
      updated[index] = trimmed;
      savePatterns(updated);
    }
  }

  function handlePatternKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  }

  function handleRemove(index: number) {
    const updated = patterns.filter((_, i) => i !== index);
    savePatterns(updated);
  }

  function handleAdd() {
    setPatterns([...patterns, '']);
  }

  if (loading) {
    return (
      <>
        <p className="loading">Loading patterns...</p>
      </>
    );
  }

  return (
    <SettingsGroup
      footer={
        saving ? (
          <span className="saving-indicator">Saving...</span>
        ) : (
          <>
            Files matching these glob patterns will be dimmed in the file tree.
            Patterns from <code>.gitattributes</code> (linguist-generated) are also used automatically.
          </>
        )
      }
    >
      {patterns.map((pattern, index) => (
        <SettingsRow key={index} className="settings-row--field">
          <input
            type="text"
            className="collapse-pattern-input"
            value={pattern}
            onChange={(e) => handlePatternChange(index, e.target.value)}
            onBlur={() => handlePatternBlur(index)}
            onKeyDown={handlePatternKeyDown}
            placeholder="e.g. *.lock"
            disabled={saving}
            // autoFocus: user just clicked "Add pattern" — focus the new empty input
            autoFocus={pattern === ''}
          />
          <button
            className="collapse-pattern-remove"
            onClick={() => handleRemove(index)}
            disabled={saving}
            title="Remove pattern"
          >
            ×
          </button>
        </SettingsRow>
      ))}
      <button
        className="settings-row-action"
        onClick={handleAdd}
        disabled={saving}
      >
        + Add pattern
      </button>
    </SettingsGroup>
  );
}
