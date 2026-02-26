import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { Combobox } from '@base-ui/react/combobox';
import useTheme from '../../hooks/useTheme';
import { THEME_PRESETS, UI_FONTS } from '../../components/ThemeProvider';
import { isTauri, listSystemFonts, type SystemFont } from '../../services';
import { deriveTheme } from '../../themes/deriveTheme';
import type { Theme } from '../../types';

/** Theme preset list for the appearance section. */
const PRESET_THEME_IDS: Theme[] = ['kanagawa-wave', 'kanagawa-light', 'loved'];

/** Preset font IDs for dedup filtering. */
const PRESET_FONT_IDS = new Set<string>(UI_FONTS.map(f => f.id));

/** Merged font item for the combobox. */
interface FontItem {
  id: string;
  label: string;
  family: string;
  group: 'preset' | 'system';
}

interface FontComboboxProps {
  label: string;
  labelId: string;
  fonts: FontItem[];
  value: string;
  onSelect: (fontId: string) => void;
  loading: boolean;
  error: string | null;
}

function FontCombobox({ label, labelId, fonts, value, onSelect, loading, error }: FontComboboxProps) {
  const activeFont = fonts.find(f => f.id === value);

  const handleValueChange = useCallback((newValue: FontItem | null) => {
    if (newValue) onSelect(newValue.id);
  }, [onSelect]);

  return (
    <div className="font-selector">
      <span className="font-selector-label" id={labelId}>{label}</span>
      {error && <div className="system-font-error">{error}</div>}
      <Combobox.Root<FontItem>
        value={activeFont ?? null}
        onValueChange={handleValueChange}
        items={fonts}
        itemToStringValue={(item) => item.id}
        itemToStringLabel={(item) => item.label}
      >
        <div className="font-combobox-trigger-wrap">
          <Combobox.Input
            className="font-combobox-input"
            aria-labelledby={labelId}
            placeholder={loading ? 'Loading fonts...' : 'Search fonts...'}
          />
          <Combobox.Trigger className="font-combobox-trigger-btn">
            <Combobox.Icon className="font-combobox-icon">
              <svg width="10" height="6" viewBox="0 0 10 6" fill="none">
                <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </Combobox.Icon>
          </Combobox.Trigger>
        </div>
        <Combobox.Portal>
          <Combobox.Positioner className="font-combobox-positioner" sideOffset={4}>
            <Combobox.Popup className="font-combobox-popup">
              <Combobox.Empty className="font-combobox-empty">
                No fonts found
              </Combobox.Empty>
              <Combobox.List className="font-combobox-list">
                {(font: FontItem) => (
                  <Combobox.Item
                    key={font.id}
                    value={font}
                    className="font-combobox-item"
                    style={{ fontFamily: font.family }}
                  >
                    {font.label}
                    <Combobox.ItemIndicator className="font-combobox-check">
                      <svg width="12" height="10" viewBox="0 0 12 10" fill="none">
                        <path d="M1 5L4.5 8.5L11 1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                      </svg>
                    </Combobox.ItemIndicator>
                  </Combobox.Item>
                )}
              </Combobox.List>
            </Combobox.Popup>
          </Combobox.Positioner>
        </Combobox.Portal>
      </Combobox.Root>
      <div
        className="font-combobox-preview"
        style={{ fontFamily: activeFont?.family ?? `'${value}', system-ui, sans-serif` }}
      >
        The quick brown fox jumps over the lazy dog
      </div>
    </div>
  );
}

/**
 * Appearance section — theme selector with visual swatches + font combobox + custom theme editor.
 */
export default function AppearanceSection() {
  const { theme, setThemeById, uiFont, setUiFont, displayFont, setDisplayFont, diffsFont, setDiffsFont, customColors, previewCustomTheme, saveCustomTheme, deleteCustomTheme } = useTheme();
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editorBg, setEditorBg] = useState('#1f1f28');
  const [editorText, setEditorText] = useState('#dcd7ba');
  const [editorAccent, setEditorAccent] = useState('#7e9cd8');
  const preEditThemeRef = useRef<Theme>('kanagawa-wave');

  // System fonts state
  const [systemFonts, setSystemFonts] = useState<SystemFont[]>([]);
  const [systemFontsLoading, setSystemFontsLoading] = useState(false);
  const [systemFontsError, setSystemFontsError] = useState<string | null>(null);

  useEffect(() => {
    if (fontsLoaded) return;
    for (const font of UI_FONTS) {
      if (font.googleFont) {
        const id = `google-font-${font.googleFont.replace(/[^a-zA-Z0-9]/g, '-')}`;
        if (!document.getElementById(id)) {
          const link = document.createElement('link');
          link.id = id;
          link.rel = 'stylesheet';
          link.href = `https://fonts.googleapis.com/css2?family=${font.googleFont}&display=swap`;
          document.head.appendChild(link);
        }
      }
    }
    setFontsLoaded(true);
  }, [fontsLoaded]);

  // Fetch system fonts on mount (Tauri only)
  useEffect(() => {
    if (!isTauri) return;
    setSystemFontsLoading(true);
    listSystemFonts()
      .then(fonts => {
        const filtered = fonts.filter(f => !PRESET_FONT_IDS.has(f.family));
        setSystemFonts(filtered);
        setSystemFontsError(null);
      })
      .catch(err => {
        setSystemFontsError('Could not load system fonts');
        console.error('Failed to load system fonts:', err);
      })
      .finally(() => setSystemFontsLoading(false));
  }, []);

  // Merge preset + system fonts into a single list for the combobox
  const allFonts: FontItem[] = useMemo(() => {
    const presets: FontItem[] = UI_FONTS.map(f => ({
      id: f.id,
      label: f.label,
      family: f.family,
      group: 'preset' as const,
    }));
    const system: FontItem[] = systemFonts.map(f => ({
      id: f.family,
      label: f.family,
      family: `'${f.family}', system-ui, sans-serif`,
      group: 'system' as const,
    }));
    return [...presets, ...system];
  }, [systemFonts]);

  useEffect(() => {
    if (editing) {
      previewCustomTheme({ bg: editorBg, text: editorText, accent: editorAccent });
    }
  }, [editing, editorBg, editorText, editorAccent, previewCustomTheme]);

  const customSwatchDef = useMemo(() => {
    if (!customColors) return null;
    return deriveTheme(customColors.bg, customColors.text, customColors.accent);
  }, [customColors]);

  function handleCreateCustom() {
    preEditThemeRef.current = theme.id as Theme;
    setEditorBg(theme.backgrounds.primary);
    setEditorText(theme.text.primary);
    setEditorAccent(theme.accent.color);
    setEditing(true);
  }

  function handleEditCustom() {
    if (!customColors) return;
    preEditThemeRef.current = 'custom';
    setEditorBg(customColors.bg);
    setEditorText(customColors.text);
    setEditorAccent(customColors.accent);
    setEditing(true);
  }

  function handleSave() {
    saveCustomTheme({ bg: editorBg, text: editorText, accent: editorAccent });
    setEditing(false);
  }

  function handleCancel() {
    setEditing(false);
    setThemeById(preEditThemeRef.current);
  }

  function handleDelete() {
    deleteCustomTheme();
    setEditing(false);
  }

  return (
    <>
      <h2>Appearance</h2>
      <div className="theme-swatches">
        {PRESET_THEME_IDS.map((id) => {
          const def = THEME_PRESETS[id];
          if (!def) return null;
          const isActive = theme.id === id && !editing;
          return (
            <button
              key={id}
              className={`theme-swatch ${isActive ? 'active' : ''}`}
              onClick={() => { setEditing(false); setThemeById(id); }}
              title={def.name}
            >
              <div
                className="theme-swatch-preview"
                style={{ background: def.backgrounds.primary }}
              >
                <span
                  className="theme-swatch-text"
                  style={{ color: def.text.primary }}
                >
                  Aa
                </span>
                <span
                  className="theme-swatch-accent"
                  style={{ background: def.accent.color }}
                />
              </div>
              <span className="theme-swatch-label">{def.name}</span>
            </button>
          );
        })}

        {customColors && customSwatchDef && !editing && (
          <button
            className={`theme-swatch ${theme.id === 'custom' ? 'active' : ''}`}
            onClick={() => setThemeById('custom')}
            title="Custom"
          >
            <div
              className="theme-swatch-preview"
              style={{ background: customSwatchDef.backgrounds.primary }}
            >
              <span
                className="theme-swatch-text"
                style={{ color: customSwatchDef.text.primary }}
              >
                Aa
              </span>
              <span
                className="theme-swatch-accent"
                style={{ background: customSwatchDef.accent.color }}
              />
            </div>
            <span className="theme-swatch-label">Custom</span>
          </button>
        )}
      </div>

      {editing ? (
        <div className="custom-theme-editor">
          <div className="custom-theme-pickers">
            <label className="custom-theme-picker">
              <span className="custom-theme-picker-label">Background</span>
              <input
                type="color"
                value={editorBg}
                onChange={(e) => setEditorBg(e.target.value)}
              />
              <span className="custom-theme-picker-value">{editorBg}</span>
            </label>
            <label className="custom-theme-picker">
              <span className="custom-theme-picker-label">Text</span>
              <input
                type="color"
                value={editorText}
                onChange={(e) => setEditorText(e.target.value)}
              />
              <span className="custom-theme-picker-value">{editorText}</span>
            </label>
            <label className="custom-theme-picker">
              <span className="custom-theme-picker-label">Accent</span>
              <input
                type="color"
                value={editorAccent}
                onChange={(e) => setEditorAccent(e.target.value)}
              />
              <span className="custom-theme-picker-value">{editorAccent}</span>
            </label>
          </div>
          <div className="custom-theme-actions">
            <button className="custom-theme-save" onClick={handleSave}>Save</button>
            <button className="custom-theme-cancel" onClick={handleCancel}>Cancel</button>
            {customColors && (
              <button className="custom-theme-delete" onClick={handleDelete}>Delete</button>
            )}
          </div>
        </div>
      ) : (
        <div className="custom-theme-controls">
          {customColors && theme.id === 'custom' ? (
            <button className="custom-theme-create" onClick={handleEditCustom}>Edit Custom Theme</button>
          ) : (
            <button className="custom-theme-create" onClick={handleCreateCustom}>Create Custom Theme</button>
          )}
        </div>
      )}

      <FontCombobox
        label="Page Title Font"
        labelId="font-selector-label"
        fonts={allFonts}
        value={uiFont}
        onSelect={setUiFont}
        loading={systemFontsLoading}
        error={systemFontsError}
      />

      <FontCombobox
        label="Display Font"
        labelId="display-font-selector-label"
        fonts={allFonts}
        value={displayFont}
        onSelect={setDisplayFont}
        loading={systemFontsLoading}
        error={systemFontsError}
      />

      <FontCombobox
        label="Diffs Font"
        labelId="diffs-font-selector-label"
        fonts={allFonts}
        value={diffsFont}
        onSelect={setDiffsFont}
        loading={systemFontsLoading}
        error={systemFontsError}
      />
    </>
  );
}
