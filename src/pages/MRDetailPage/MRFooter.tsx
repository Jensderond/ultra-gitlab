import './MRFooter.css';

interface MRFooterProps {
  unresolvedCount: number;
  onToggleActivity: () => void;
}

interface ShortcutDef {
  key: string;
  label: string;
}

const shortcuts: ShortcutDef[] = [
  { key: 'c', label: 'comment' },
  { key: 's', label: 'suggest' },
  { key: 'y', label: 'yank link' },
  { key: '?', label: 'help' },
];

export default function MRFooter({ unresolvedCount, onToggleActivity }: MRFooterProps) {
  return (
    <footer className="mr-detail-footer">
      <div className="footer-shortcut-bar">
        {shortcuts.map(({ key, label }, i) => (
          <span key={key} className="footer-shortcut-item">
            {i > 0 && <span className="footer-shortcut-sep" />}
            <kbd className="footer-shortcut-kbd">{key}</kbd>
            <span className="footer-shortcut-label">{label}</span>
          </span>
        ))}
      </div>
      <button
        className="activity-toggle-btn"
        onClick={onToggleActivity}
        data-testid="activity-toggle"
        title="Toggle activity drawer (⌘D)"
      >
        Activity
        {unresolvedCount > 0 && (
          <span className="activity-badge" data-testid="activity-badge">
            {unresolvedCount}
          </span>
        )}
      </button>
    </footer>
  );
}
