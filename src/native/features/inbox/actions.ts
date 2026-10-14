/**
 * Merge request actions shared by the list, its context menus and the
 * preview: optimistic cache updates, toasts with Undo, and native menus that
 * can pop up under a button or a row (not only at the pointer).
 */

import { api, isTauri, openExternal } from '../../api/client';
import type { MergeRequest } from '../../api/types';
import { navigate, paths } from '../../app/router';
import { getData, invalidate, setData } from '../../data/query';
import { copyText, toast } from '../../ui/components';
import { formatSnooze, SNOOZE_PRESETS } from './model';

/* ------------------------------------------------------------------------ */
/* Native menus                                                             */
/* ------------------------------------------------------------------------ */

export type InboxMenuEntry =
  | {
      label: string;
      action?: () => void;
      enabled?: boolean;
      checked?: boolean;
      shortcut?: string;
      submenu?: InboxMenuEntry[];
    }
  | { separator: true };

type Anchor = MouseEvent | React.MouseEvent | Element | null;

async function buildItems(entries: InboxMenuEntry[]): Promise<unknown[]> {
  const { MenuItem, CheckMenuItem, PredefinedMenuItem, Submenu } = await import('@tauri-apps/api/menu');
  return Promise.all(
    entries.map(async (entry) => {
      if ('separator' in entry) return PredefinedMenuItem.new({ item: 'Separator' });
      if (entry.submenu) {
        const items = (await buildItems(entry.submenu)) as never[];
        return Submenu.new({ text: entry.label, enabled: entry.enabled ?? true, items });
      }
      if (entry.checked !== undefined) {
        return CheckMenuItem.new({
          text: entry.label,
          checked: entry.checked,
          enabled: entry.enabled ?? true,
          accelerator: entry.shortcut,
          action: () => entry.action?.(),
        });
      }
      return MenuItem.new({
        text: entry.label,
        enabled: entry.enabled ?? true,
        accelerator: entry.shortcut,
        action: () => entry.action?.(),
      });
    }),
  );
}

/**
 * Pop a native menu. Given a mouse event it opens at the pointer; given an
 * element it opens under it (like an NSPopUpButton); `null` → pointer.
 */
export async function popupMenu(anchor: Anchor, entries: InboxMenuEntry[]): Promise<void> {
  if (anchor && 'preventDefault' in anchor) anchor.preventDefault();
  if (!isTauri) return;
  try {
    const [{ Menu }, { LogicalPosition }] = await Promise.all([
      import('@tauri-apps/api/menu'),
      import('@tauri-apps/api/dpi'),
    ]);
    const items = (await buildItems(entries)) as never[];
    const menu = await Menu.new({ items });
    if (anchor instanceof Element) {
      const r = anchor.getBoundingClientRect();
      await menu.popup(new LogicalPosition(r.left, r.bottom + 4));
    } else {
      await menu.popup();
    }
  } catch (e) {
    console.warn('Menu unavailable', e);
  }
}

/* ------------------------------------------------------------------------ */
/* Cache helpers                                                            */
/* ------------------------------------------------------------------------ */

function patchLists(mrId: number, patch: Partial<MergeRequest>) {
  for (const key of listKeys) {
    const list = getData<MergeRequest[]>(key);
    if (list) setData(key, list.map((m) => (m.id === mrId ? { ...m, ...patch } : m)));
  }
  const detail = getData<MergeRequest>(['mr', mrId]);
  if (detail) setData(['mr', mrId], { ...detail, ...patch });
}

/** Keys of the MR lists for the active instance (set by the inbox screen). */
let listKeys: unknown[][] = [];
export function registerListKeys(instanceId: number | undefined) {
  listKeys = instanceId
    ? [
        ['mrs', 'review', instanceId],
        ['mrs', 'mine', instanceId, true],
        ['mrs', 'mine', instanceId, false],
      ]
    : [];
}

export function refreshMR(mrId: number) {
  void invalidate(['mr', mrId]);
  void invalidate(['mrs']);
}

const errMessage = (e: unknown) => (e instanceof Error ? e.message : String(e));

/* ------------------------------------------------------------------------ */
/* Actions                                                                  */
/* ------------------------------------------------------------------------ */

export const checkoutCommand = (mr: MergeRequest) =>
  `git fetch origin ${mr.sourceBranch} && git checkout ${mr.sourceBranch}`;

export const startReview = (mr: MergeRequest) => navigate(paths.review(mr.id));
export const openInGitLab = (mr: MergeRequest) => void openExternal(mr.webUrl);
export const copyLink = (mr: MergeRequest) => void copyText(mr.webUrl, 'Link copied');
export const copyBranch = (mr: MergeRequest) => void copyText(mr.sourceBranch, 'Branch name copied');
export const copyCheckout = (mr: MergeRequest) =>
  void copyText(checkoutCommand(mr), 'Checkout command copied — paste it in your terminal');

export async function snooze(mr: MergeRequest, until: number) {
  const previous = mr.snoozedUntil;
  patchLists(mr.id, { snoozedUntil: until });
  try {
    await api.snooze(mr.id, until);
    toast(`Snoozed !${mr.iid} until ${formatSnooze(until)}`, {
      action: { label: 'Undo', run: () => void unsnooze({ ...mr, snoozedUntil: until }, previous) },
    });
  } catch (e) {
    patchLists(mr.id, { snoozedUntil: previous });
    toast(`Couldn't snooze !${mr.iid}: ${errMessage(e)}`, { tone: 'error' });
  }
  refreshMR(mr.id);
}

export async function unsnooze(mr: MergeRequest, restore: number | null = null) {
  const previous = mr.snoozedUntil;
  patchLists(mr.id, { snoozedUntil: restore });
  try {
    await api.unsnooze(mr.id);
    if (restore === null) toast(`!${mr.iid} is back in your inbox`);
  } catch (e) {
    patchLists(mr.id, { snoozedUntil: previous });
    toast(`Couldn't unsnooze !${mr.iid}: ${errMessage(e)}`, { tone: 'error' });
  }
  refreshMR(mr.id);
}

export function snoozeEntries(mr: MergeRequest): InboxMenuEntry[] {
  const now = new Date();
  const presets: InboxMenuEntry[] = SNOOZE_PRESETS.map((p) => ({
    label: p.label,
    action: () => void snooze(mr, p.until(now)),
  }));
  if (mr.snoozedUntil && mr.snoozedUntil * 1000 > Date.now()) {
    return [{ label: 'Unsnooze', action: () => void unsnooze(mr) }, { separator: true }, ...presets];
  }
  return presets;
}

export async function setApproved(mr: MergeRequest, approved: boolean) {
  patchLists(mr.id, { userHasApproved: approved });
  try {
    await (approved ? api.approve(mr.id) : api.unapprove(mr.id));
    toast(approved ? `Approved !${mr.iid}` : `Removed your approval from !${mr.iid}`, {
      tone: approved ? 'success' : 'info',
      action: approved ? { label: 'Undo', run: () => void setApproved({ ...mr, userHasApproved: true }, false) } : undefined,
    });
  } catch (e) {
    patchLists(mr.id, { userHasApproved: !approved });
    toast(`Couldn't ${approved ? 'approve' : 'unapprove'} !${mr.iid}: ${errMessage(e)}`, { tone: 'error' });
  }
  refreshMR(mr.id);
}

/** Right-click menu for a row (and the preview's ⋯ button). */
export function rowMenu(mr: MergeRequest, { canApprove }: { canApprove: boolean }): InboxMenuEntry[] {
  const merged = mr.state !== 'opened';
  return [
    { label: merged ? 'View Changes' : 'Start Review', action: () => startReview(mr) },
    { label: 'Open in GitLab', action: () => openInGitLab(mr) },
    { separator: true },
    { label: 'Copy Link', action: () => copyLink(mr) },
    { label: 'Copy Branch Name', action: () => copyBranch(mr) },
    { label: 'Copy Checkout Command', action: () => copyCheckout(mr) },
    ...(merged
      ? []
      : ([
          { separator: true },
          { label: 'Snooze', submenu: snoozeEntries(mr) },
          ...(canApprove
            ? [
                mr.userHasApproved
                  ? { label: 'Remove Approval', action: () => void setApproved(mr, false) }
                  : { label: 'Approve', action: () => void setApproved(mr, true) },
              ]
            : []),
        ] as InboxMenuEntry[])),
  ];
}
