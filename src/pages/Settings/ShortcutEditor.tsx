import { useState, useCallback } from 'react';
import useCustomShortcuts from '../../hooks/useCustomShortcuts';
import {
  defaultShortcuts,
  categoryLabels,
  formatKey,
  type ShortcutCategory,
} from '../../config/shortcuts';

/**
 * Shortcut editor component for customizing keyboard shortcuts.
 */
export default function ShortcutEditor() {
  const {
    customBindings,
    loading,
    setBinding,
    resetBinding,
    resetAllBindings,
    isKeyInUse,
  } = useCustomShortcuts();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const groupedShortcuts = useCallback(() => {
    const groups = new Map<ShortcutCategory, typeof defaultShortcuts>();
    const categoryOrder: ShortcutCategory[] = [
      'global',
      'navigation',
      'list',
      'diff',
      'review',
      'sync',
    ];

    for (const category of categoryOrder) {
      groups.set(category, []);
    }

    for (const shortcut of defaultShortcuts) {
      const group = groups.get(shortcut.category);
      if (group) {
        group.push(shortcut);
      }
    }

    return groups;
  }, []);

  const startEditing = (shortcutId: string, currentKey: string) => {
    setEditingId(shortcutId);
    setEditValue(currentKey);
    setError(null);
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditValue('');
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();

    if (e.key === 'Escape') {
      cancelEditing();
      return;
    }

    if (e.key === 'Enter' && editValue) {
      saveBinding();
      return;
    }

    let key = '';
    if (e.metaKey || e.ctrlKey) key += e.metaKey ? 'Cmd+' : 'Ctrl+';
    if (e.altKey) key += 'Alt+';
    if (e.shiftKey && e.key !== 'Shift') key += 'Shift+';

    if (!['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) {
      key += e.key.length === 1 ? e.key.toUpperCase() : e.key;
    }

    if (key) {
      setEditValue(key);
      setError(null);
    }
  };

  const saveBinding = async () => {
    if (!editingId || !editValue) return;

    if (isKeyInUse(editValue, editingId)) {
      setError('This key is already in use');
      return;
    }

    try {
      setSaving(true);
      await setBinding(editingId, editValue);
      setEditingId(null);
      setEditValue('');
    } catch (err) {
      setError('Failed to save shortcut');
    } finally {
      setSaving(false);
    }
  };

  const handleReset = async (shortcutId: string) => {
    try {
      setSaving(true);
      await resetBinding(shortcutId);
    } catch (err) {
      console.error('Failed to reset shortcut:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleResetAll = async () => {
    if (!confirm('Reset all keyboard shortcuts to defaults?')) return;

    try {
      setSaving(true);
      await resetAllBindings();
    } catch (err) {
      console.error('Failed to reset all shortcuts:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <>
        <h2>Keyboard Shortcuts</h2>
        <p className="loading">Loading shortcuts...</p>
      </>
    );
  }

  const groups = groupedShortcuts();
  const hasCustomBindings = Object.keys(customBindings).length > 0;

  return (
    <>
      <div className="section-header">
        <h2>Keyboard Shortcuts</h2>
        {hasCustomBindings && (
          <button
            className="reset-all-button"
            onClick={handleResetAll}
            disabled={saving}
          >
            Reset All
          </button>
        )}
      </div>

      <div className="shortcuts-editor">
        {Array.from(groups.entries()).map(([category, categoryShortcuts]) => {
          if (categoryShortcuts.length === 0) return null;

          return (
            <div key={category} className="shortcut-category-section">
              <h3 className="shortcut-category-header">
                {categoryLabels[category]}
              </h3>
              <div className="shortcut-items">
                {categoryShortcuts.map((shortcut) => {
                  const currentKey = customBindings[shortcut.id] || shortcut.defaultKey;
                  const isEditing = editingId === shortcut.id;
                  const isCustom = !!customBindings[shortcut.id];

                  return (
                    <div
                      key={shortcut.id}
                      className={`shortcut-editor-item ${isEditing ? 'editing' : ''}`}
                    >
                      <span className="shortcut-description">
                        {shortcut.description}
                      </span>

                      {isEditing ? (
                        <div className="shortcut-edit-controls">
                          <input
                            type="text"
                            className="shortcut-input"
                            value={editValue}
                            onChange={() => {}}
                            onKeyDown={handleKeyDown}
                            onBlur={cancelEditing}
                            placeholder="Press a key..."
                            // autoFocus: user just clicked a shortcut to edit — capture keystrokes immediately
                            autoFocus
                          />
                          {error && (
                            <span className="shortcut-error">{error}</span>
                          )}
                        </div>
                      ) : (
                        <div className="shortcut-display-controls">
                          <kbd
                            className={`shortcut-key-display ${isCustom ? 'custom' : ''}`}
                            onClick={() => startEditing(shortcut.id, currentKey)}
                            title="Click to edit"
                          >
                            {formatKey(currentKey)}
                          </kbd>
                          {isCustom && (
                            <button
                              className="shortcut-reset-button"
                              onClick={() => handleReset(shortcut.id)}
                              disabled={saving}
                              title={`Reset to ${formatKey(shortcut.defaultKey)}`}
                            >
                              ↺
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <p className="shortcut-hint">
        Click on a shortcut to edit. Press the new key combination, then Enter to save.
      </p>
    </>
  );
}
