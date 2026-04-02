import { renderKeyGlyphs } from './KeyGlyph';
import './ShortcutBar.css';

export interface ShortcutDef {
  key: string;
  label: string;
}

type ShortcutBarVariant = 'list' | 'detail';

interface ShortcutBarProps {
  shortcuts: ShortcutDef[];
  variant?: ShortcutBarVariant;
}

export function ShortcutBar({ shortcuts, variant = 'detail' }: ShortcutBarProps) {
  return (
    <div className={`shortcut-bar shortcut-bar--${variant}`}>
      {shortcuts.map(({ key, label }) => (
        <span key={key} className="shortcut-bar__item">
          <kbd className="shortcut-bar__key" aria-label={key}>{renderKeyGlyphs(key)}</kbd>
          <span className="shortcut-bar__label">{label}</span>
        </span>
      ))}
    </div>
  );
}
