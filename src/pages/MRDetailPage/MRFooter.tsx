import { ShortcutBar } from '../../components/ShortcutBar';
import type { ShortcutDef } from '../../components/ShortcutBar';

interface MRFooterProps {
  unresolvedCount: number;
  onToggleActivity: () => void;
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
      <ShortcutBar shortcuts={shortcuts} variant="detail" />
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
