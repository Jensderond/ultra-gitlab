import { useState, useEffect } from 'react';
import { getCollapsePatterns, updateCollapsePatterns } from '../../services/tauri';

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
        <h2>Generated File Patterns</h2>
        <p className="loading">Loading patterns...</p>
      </>
    );
  }

  return (
    <>
      <h2>Generated File Patterns</h2>
      <p className="collapse-patterns-description">
        Files matching these glob patterns will be dimmed in the file tree.
        Patterns from <code>.gitattributes</code> (linguist-generated) are also used automatically.
      </p>

      <div className="collapse-patterns-list">
        {patterns.map((pattern, index) => (
          <div key={`${index}-${pattern}`} className="collapse-pattern-row">
            <input
              type="text"
              className="collapse-pattern-input"
              value={pattern}
              onChange={(e) => handlePatternChange(index, e.target.value)}
              onBlur={() => handlePatternBlur(index)}
              onKeyDown={handlePatternKeyDown}
              placeholder="e.g. *.lock"
              disabled={saving}
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
          </div>
        ))}
      </div>

      <button
        className="collapse-pattern-add"
        onClick={handleAdd}
        disabled={saving}
      >
        + Add pattern
      </button>

      {saving && <p className="saving-indicator">Saving...</p>}
    </>
  );
}
