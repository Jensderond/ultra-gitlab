import './ShortcutBar.css';

export interface ShortcutDef {
  key: string;
  label: string;
}

const SPECIAL_SHORTCUT_GLYPHS = /[⌘⌃⌥⇧↵⎋⇥⌫⌦␣↑↓←→]/;

function renderShortcutKey(key: string) {
  return Array.from(key).map((char, index) => {
    if (!SPECIAL_SHORTCUT_GLYPHS.test(char)) {
      return char;
    }

    return (
      <span key={`${char}-${index}`} className="shortcut-bar__glyph" aria-hidden="true">
        {char}
      </span>
    );
  });
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
          <kbd className="shortcut-bar__key" aria-label={key}>{renderShortcutKey(key)}</kbd>
          <span className="shortcut-bar__label">{label}</span>
        </span>
      ))}
    </div>
  );
}
