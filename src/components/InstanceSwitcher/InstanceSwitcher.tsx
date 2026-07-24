/**
 * Custom instance switcher dropdown with native macOS look and feel.
 * Supports Cmd+Shift+1/2/3... keyboard shortcuts for quick switching.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import type { GitLabInstanceWithStatus } from '../../services/gitlab';
import { CaretDownIcon, CheckIcon } from '../icons';
import './InstanceSwitcher.css';

interface InstanceSwitcherProps {
  instances: GitLabInstanceWithStatus[];
  selectedId: number | null;
  onSelect: (id: number) => void;
}

export default function InstanceSwitcher({ instances, selectedId, onSelect }: InstanceSwitcherProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const focusIndexRef = useRef(0);
  const itemsRef = useRef<HTMLButtonElement[]>([]);

  const selected = instances.find((i) => i.id === selectedId);

  // Close on outside click
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setOpen(false);
      }
    }
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [open]);

  // Listen for global instance-switch events (from Cmd+Shift+1/2/3 shortcuts)
  useEffect(() => {
    function handleSwitch(e: Event) {
      const detail = (e as CustomEvent<{ index: number }>).detail;
      const inst = instances[detail.index];
      if (inst) {
        onSelect(inst.id);
      }
    }
    window.addEventListener('instance-switch', handleSwitch);
    return () => window.removeEventListener('instance-switch', handleSwitch);
  }, [instances, onSelect]);

  // Keyboard nav inside the open dropdown
  const handleDropdownKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusIndexRef.current = Math.min(focusIndexRef.current + 1, instances.length - 1);
        itemsRef.current[focusIndexRef.current]?.focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusIndexRef.current = Math.max(focusIndexRef.current - 1, 0);
        itemsRef.current[focusIndexRef.current]?.focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const inst = instances[focusIndexRef.current];
        if (inst) {
          onSelect(inst.id);
          setOpen(false);
        }
      }
    },
    [instances, onSelect]
  );

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      if (!prev) {
        // Set initial focus index to selected item
        const idx = instances.findIndex((i) => i.id === selectedId);
        focusIndexRef.current = idx >= 0 ? idx : 0;
        // Focus the selected item after dropdown renders
        requestAnimationFrame(() => {
          itemsRef.current[focusIndexRef.current]?.focus();
        });
      }
      return !prev;
    });
  }, [instances, selectedId]);

  if (instances.length <= 1) return null;

  return (
    <div className="instance-switcher" ref={containerRef}>
      <button
        className="instance-switcher-trigger"
        onClick={toggleOpen}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="instance-switcher-label">
          {selected?.name || selected?.url || 'Select instance'}
        </span>
        <span className={`instance-switcher-chevron${open ? ' instance-switcher-chevron--open' : ''}`}>
          <CaretDownIcon size={12} />
        </span>
      </button>

      {open && (
        <div
          className="instance-switcher-dropdown"
          role="listbox"
          onKeyDown={handleDropdownKeyDown}
        >
          {instances.map((instance, index) => (
            <button
              key={instance.id}
              ref={(el) => { if (el) itemsRef.current[index] = el; }}
              className={`instance-switcher-option${instance.id === selectedId ? ' instance-switcher-option--selected' : ''}`}
              role="option"
              aria-selected={instance.id === selectedId}
              onClick={() => {
                onSelect(instance.id);
                setOpen(false);
              }}
            >
              <span className="instance-switcher-option-label">
                {instance.name || instance.url}
              </span>
              <span className="instance-switcher-option-meta">
                {instance.id === selectedId && <CheckIcon size={14} />}
                <kbd className="instance-switcher-shortcut">{'\u21e7'}{'\u2318'}{index + 1}</kbd>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
