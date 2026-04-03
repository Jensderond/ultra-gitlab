import { useState, useCallback } from 'react';
import { useHotkeyRecorder, formatForDisplay } from '@tanstack/react-hotkeys';
import { useShortcuts } from '../../components/ShortcutsProvider';
import { renderKeyGlyphs } from '../../components/KeyGlyph';
import {
  defaultShortcuts,
  categoryLabels,
  type ShortcutCategory,
} from '../../config/shortcuts';

const arrowSymbolMap: Record<string, string> = {
  '↓': 'ArrowDown',
  '↑': 'ArrowUp',
  '→': 'ArrowRight',
  '←': 'ArrowLeft',
};

function formatKeyDisplay(key: string): string {
  return key
    .split(' / ')
    .map((part) => {
      const mapped = arrowSymbolMap[part] ?? part;
      return formatForDisplay(mapped);
    })
    .join(' / ');
}

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
  } = useShortcuts();

  const [editingId, setEditingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const saveKey = async (id: string, key: string) => {
    if (isKeyInUse(key, id)) {
      setError('This key is already in use');
      return;
    }

    try {
      setSaving(true);
      await setBinding(id, key);
      setEditingId(null);
      setError(null);
    } catch {
      setError('Failed to save shortcut');
    } finally {
      setSaving(false);
    }
  };

  const { isRecording, startRecording, cancelRecording } = useHotkeyRecorder({
    onRecord: (hotkey) => {
      if (editingId) {
        saveKey(editingId, hotkey);
      }
    },
    onCancel: () => {
      setEditingId(null);
      setError(null);
    },
    ignoreInputs: false,
  });

  const startEditing = (shortcutId: string) => {
    setEditingId(shortcutId);
    setError(null);
    startRecording();
  };

  const cancelEditing = () => {
    cancelRecording();
    setEditingId(null);
    setError(null);
  };

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
      <p className="loading">Loading shortcuts...</p>
    );
  }

  const groups = groupedShortcuts();
  const hasCustomBindings = Object.keys(customBindings).length > 0;

  return (
    <>
      {hasCustomBindings && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
          <button
            className="reset-all-button"
            onClick={handleResetAll}
            disabled={saving}
          >
            Reset All
          </button>
        </div>
      )}
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
                            value={isRecording ? 'Recording…' : ''}
                            readOnly
                            onBlur={cancelEditing}
                            placeholder="Press new shortcut…"
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
                            onClick={() => startEditing(shortcut.id)}
                            title="Click to edit"
                          >
                            {renderKeyGlyphs(formatKeyDisplay(currentKey))}
                          </kbd>
                          {isCustom && (
                            <button
                              className="shortcut-reset-button"
                              onClick={() => handleReset(shortcut.id)}
                              disabled={saving}
                              title={`Reset to ${formatKeyDisplay(shortcut.defaultKey)}`}
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
        Click a shortcut, then press the new key combination. Escape to cancel.
      </p>
    </>
  );
}
