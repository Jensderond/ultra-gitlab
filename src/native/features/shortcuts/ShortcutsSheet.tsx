/**
 * ⌘? from anywhere: every keyboard shortcut on one sheet, the section for
 * the screen you're on first. Also opened from the ⌘K palette.
 *
 * The list is maintained by hand next to the `useKeys` maps it describes;
 * when a screen gains a shortcut, add it here too.
 */

import { useEffect, useState } from 'react';
import { useKeys } from '../../app/keys';
import { useRoute } from '../../app/router';
import { cx, Kbd, Sheet } from '../../ui/components';
import './shortcuts.css';

interface Section {
  /** The first route segment this section belongs to. */
  screen: string;
  title: string;
  /** [combos (alternatives), what it does] */
  rows: [string[], string][];
}

const GENERAL: Section = {
  screen: '',
  title: 'Everywhere',
  rows: [
    [['mod+k'], 'Search and commands'],
    [['mod+1'], 'Merge requests'],
    [['mod+2'], 'Pipelines'],
    [['mod+,'], 'Settings'],
    [['mod+r'], 'Refresh'],
    [['mod+['], 'Back'],
    [['mod+]'], 'Forward'],
    [['mod+?'], 'Keyboard shortcuts'],
  ],
};

const SECTIONS: Section[] = [
  {
    screen: 'review',
    title: 'Reviewing changes',
    rows: [
      [['j', 'k'], 'Next / previous file'],
      [['shift+j', 'shift+k'], 'Next / previous change in the file'],
      [['arrowdown', 'arrowup'], 'Scroll'],
      [['space', 'shift+space'], 'Page down / up'],
      [['v'], 'Mark viewed, go to the next file'],
      [['n', 'shift+n'], 'Next / previous unresolved discussion'],
      [['c'], 'Comment on the hovered or selected lines'],
      [['s'], 'Suggest a change'],
      [['e'], 'Edit the file to suggest a change'],
      [['mod+enter'], 'Post the comment or suggestion'],
      [['p'], 'Open the pipeline'],
      [['mod+alt+0'], 'Show or hide the inspector'],
      [['mod+shift+enter'], 'Finish your review'],
      [['escape'], 'Close the comment, or go back'],
    ],
  },
  {
    screen: 'inbox',
    title: 'Merge requests',
    rows: [
      [['j', 'k'], 'Next / previous merge request'],
      [['home', 'end'], 'First / last'],
      [['enter'], 'View changes'],
      [['o'], 'Open in GitLab'],
      [['mod+c'], 'Copy link'],
      [['s'], 'Snooze'],
      [['mod+shift+a'], 'Approve / remove approval'],
      [['mod+enter'], 'Merge (your own)'],
      [['/'], 'Search'],
      [['escape'], 'Clear the selection'],
    ],
  },
  {
    screen: 'pipelines',
    title: 'Pipelines',
    rows: [
      [['j', 'k'], 'Next / previous project'],
      [['enter'], 'Open the latest pipeline'],
      [['p'], 'Pin / unpin the project'],
      [['mod+n'], 'Add a project'],
      [['/'], 'Search'],
    ],
  },
  {
    screen: 'pipeline',
    title: 'Pipeline',
    rows: [
      [['j', 'k'], 'Next / previous job'],
      [['mod+e'], 'Jump to the first error'],
      [['mod+f'], 'Search the log'],
      [['enter', 'shift+enter'], 'Next / previous match'],
      [['mod+shift+r'], 'Retry'],
      [['escape'], 'Back'],
    ],
  },
];

const listeners = new Set<() => void>();

/** Open the sheet, e.g. from the ⌘K palette. */
export function openShortcuts() {
  listeners.forEach((l) => l());
}

/** The screen a route shows: a pipeline has more segments than the dashboard. */
function screenOf(segments: string[]): string {
  if (segments[0] === 'pipelines' && segments.length >= 4) return 'pipeline';
  return segments[0] ?? 'inbox';
}

export function ShortcutsSheet() {
  const [open, setOpen] = useState(false);
  const { segments } = useRoute();

  useEffect(() => {
    const show = () => setOpen(true);
    listeners.add(show);
    return () => void listeners.delete(show);
  }, []);

  // ⌘? arrives as `?` on most layouts; ⌘/ covers those where it doesn't.
  const close = () => setOpen(false);
  useKeys({ 'mod+?': () => setOpen(true), 'mod+/': () => setOpen(true) });
  // Sits above the sheet's own layer, so it has to take Esc as well.
  useKeys({ 'mod+?': close, 'mod+/': close, escape: close }, { modal: true, enabled: open });

  const here = screenOf(segments);
  const ordered = [...SECTIONS.filter((s) => s.screen === here), GENERAL, ...SECTIONS.filter((s) => s.screen !== here)];

  return (
    <Sheet open={open} onClose={close} title="Keyboard Shortcuts" width={760}>
      <div className="ks-sections">
        {ordered.map((s) => (
          <section key={s.title} className={cx('ks-section', s.screen === here && 'is-here')}>
            <h3 className="ks-section__title">{s.title}</h3>
            <dl className="ks-rows">
              {s.rows.map(([combos, label]) => (
                <div key={label} className="ks-row">
                  <dt className="ks-row__label">{label}</dt>
                  <dd className="ks-row__keys">
                    {combos.map((c) => (
                      <Kbd key={c} combo={c} />
                    ))}
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Sheet>
  );
}
