import { useState, useEffect, useRef, useMemo } from 'react';
import useTheme from '../../hooks/useTheme';
import { THEME_PRESETS, UI_FONTS } from '../../components/ThemeProvider';
import { deriveTheme } from '../../themes/deriveTheme';
import type { Theme } from '../../types';

/** Theme preset list for the appearance section. */
const PRESET_THEME_IDS: Theme[] = ['kanagawa-wave', 'kanagawa-light', 'loved'];

/**
 * Appearance section — theme selector with visual swatches + font selector + custom theme editor.
 */
export default function AppearanceSection() {
  const { theme, setThemeById, uiFont, setUiFont, customColors, previewCustomTheme, saveCustomTheme, deleteCustomTheme } = useTheme();
  const [fontsLoaded, setFontsLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editorBg, setEditorBg] = useState('#1f1f28');
  const [editorText, setEditorText] = useState('#dcd7ba');
  const [editorAccent, setEditorAccent] = useState('#7e9cd8');
  const preEditThemeRef = useRef<Theme>('kanagawa-wave');

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

      <div className="font-selector">
        <label className="font-selector-label">UI Font</label>
        <div className="font-options">
          {UI_FONTS.map((font) => {
            const isActive = uiFont === font.id;
            return (
              <button
                key={font.id}
                className={`font-option ${isActive ? 'active' : ''}`}
                onClick={() => setUiFont(font.id)}
                style={{ fontFamily: font.family }}
              >
                {font.label}
              </button>
            );
          })}
        </div>
      </div>
    </>
  );
}
