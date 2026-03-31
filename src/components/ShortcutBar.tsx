import '../pages/MRDetailPage/MRFooter.css';

export interface ShortcutDef {
  key: string;
  label: string;
}

interface ShortcutBarProps {
  shortcuts: ShortcutDef[];
}

export function ShortcutBar({ shortcuts }: ShortcutBarProps) {
  return (
    <div className="footer-shortcut-bar keyboard-hint">
      {shortcuts.map(({ key, label }, i) => (
        <span key={key} className="footer-shortcut-item">
          {i > 0 && <span className="footer-shortcut-sep" />}
          <kbd className="footer-shortcut-kbd">{key}</kbd>
          <span className="footer-shortcut-label">{label}</span>
        </span>
      ))}
    </div>
  );
}
