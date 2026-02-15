/**
 * Reusable tab bar component with keyboard shortcut hints.
 */
import './TabBar.css';

interface Tab<T extends string> {
  id: T;
  label: string;
  badge?: string;
}

interface TabBarProps<T extends string> {
  tabs: Tab<T>[];
  activeTab: T;
  onTabChange: (tab: T) => void;
}

export default function TabBar<T extends string>({ tabs, activeTab, onTabChange }: TabBarProps<T>) {
  return (
    <nav className="tab-bar">
      {tabs.map((tab, i) => (
        <button
          key={tab.id}
          className={`tab-bar-item ${activeTab === tab.id ? 'active' : ''}`}
          onClick={() => onTabChange(tab.id)}
        >
          <kbd>[{i + 1}]</kbd> {tab.label}{tab.badge ? ` ${tab.badge}` : ''}
        </button>
      ))}
    </nav>
  );
}
