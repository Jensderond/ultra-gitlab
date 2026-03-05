# Plan: Centralize Keyboard Shortcut Handling

## Context

Shortcuts are defined centrally in `src/config/shortcuts.ts` but the actual key
binding code is scattered — each page/hook registers its own `window.addEventListener`,
repeats the "ignore input elements" guard, and hardcodes key strings in switch
statements. `useCustomShortcuts` can load user bindings but handlers never use them
(custom bindings are a dead feature). The goal is to make the handling layer as tidy
as the config layer, with a single reusable primitive.

---

## Approach

Create a `useShortcuts` hook that encapsulates:
- the `window.addEventListener` lifecycle (one registration per call, never re-runs)
- key matching via a `matchesShortcut` helper that parses the config's `defaultKey`
  strings (`'Cmd+P'`, `'j / ↓'`, `'Shift+H'`, etc.)
- input-element filtering
- optional guard predicate
- a stable ref pattern so callers don't need to manage deps

Then replace the manual listeners in App.tsx, useMRKeyboard, useMyMRKeyboard, and
MRListPage with calls to this hook.

---

## Files to Create

### `src/hooks/useShortcuts.ts` (~120 lines)

**`matchesShortcut(e: KeyboardEvent, keyString: string): boolean`**
- Splits aliases on ` / ` (e.g. `'n / j / ↓'` → three alternatives)
- For each alternative, splits on `+` to extract modifiers (`Cmd`, `Shift`, etc.)
- Maps display arrows to JS key names: `↓→ArrowDown`, `↑→ArrowUp`
- For entries with **no** explicit modifier prefix, requires
  `!e.metaKey && !e.ctrlKey && !e.altKey` (but does NOT check `e.shiftKey`
  — shift is implicit in characters like `'?'` and `'H'`)
- For entries with explicit modifiers (e.g. `Cmd+P`, `Shift+H`), requires exact
  modifier match

**`useShortcuts(handlers, options?)`**
```typescript
type ShortcutHandler = (e: KeyboardEvent) => void;
interface UseShortcutsOptions {
  guard?: (e: KeyboardEvent) => boolean;  // return false to suppress all handling
  filterInputs?: boolean;                 // default true
  customBindings?: Record<string, string>;
}
function useShortcuts(
  handlers: Record<string, ShortcutHandler>,
  options?: UseShortcutsOptions
): void
```
- Stores `handlers` and `options` in refs
- Single stable `useEffect([], [])` registers the listener once
- Iterates handlers in insertion order; first match wins (calls `handler(e)` and returns)
- Resolves key: `customBindings[id] ?? defaultShortcuts[id].defaultKey`

---

## Files to Modify

### `src/config/shortcuts.ts`

Add two missing entries to `defaultShortcuts`:
```typescript
// mr-list context
{ id: 'toggle-approved', description: 'Toggle showing approved MRs',
  defaultKey: 'Shift+H', category: 'list', context: 'mr-list' },

// mr-detail context
{ id: 'toggle-activity-drawer', description: 'Toggle activity drawer',
  defaultKey: 'Cmd+D', category: 'review', context: 'mr-detail' },
```

### `src/App.tsx`

Replace the `useEffect` block at lines 140–209 with `useShortcuts({...})`:
```typescript
useShortcuts({
  'command-palette': (e) => { if (!isTauri) return; e.preventDefault(); ... },
  'open-settings':   (e) => { if (!isTauri) return; e.preventDefault(); ... },
  'go-to-mr-list':   (e) => { e.preventDefault(); navigate('/mrs'); ... },
  'go-to-my-mrs':    (e) => { e.preventDefault(); navigate('/my-mrs'); ... },
  'go-to-pipelines': (e) => { e.preventDefault(); navigate('/pipelines'); ... },
  'trigger-sync':    (e) => { if (!isTauri) return; e.preventDefault(); ... },
  'keyboard-help':   (e) => { e.preventDefault(); setKeyboardHelpOpen(true); ... },
});
```
Remove the `[navigate]` dep that was on the old effect.

### `src/pages/MRDetailPage/useMRKeyboard.ts`

Replace the `handlerRef` + `useEffect` pattern with **two** `useShortcuts` calls:

```typescript
// Call 1: all shortcuts except Escape — suppressed when comment overlay is open
useShortcuts({
  'next-file': ..., 'prev-file': ..., 'toggle-view-mode': ...,
  'approve': ..., 'open-in-browser': ..., 'copy-mr-link': ...,
  'mark-viewed': ..., 'toggle-generated': ...,
  'add-comment': ..., 'add-suggestion': ...,
  'toggle-activity-drawer': (e) => { e.preventDefault(); onToggleActivityDrawer(); },
}, {
  guard: (e) => !commentOverlayRef.current?.isVisible(),
});

// Call 2: Escape — always fires, decides internally what to close
useShortcuts({
  'go-back': (e) => {
    if (commentOverlayRef.current?.isVisible()) {
      e.preventDefault();
      commentOverlayRef.current.close();
    } else if (!document.querySelector('.keyboard-help-overlay')) {
      onEscapeBack();
    }
  },
});
```

Add `onToggleActivityDrawer: () => void` to `UseMRKeyboardOptions`.

### `src/pages/MRDetailPage/index.tsx`

Remove the standalone `useEffect` for Cmd+D (lines 173–185).
Pass `onToggleActivityDrawer={() => setActivityOpen(o => !o)}` to `useMRKeyboard`.

### `src/pages/MyMRDetailPage/useMyMRKeyboard.ts`

Replace the `optionsRef` + `useEffect` pattern with `useShortcuts({...})`.
Tab-code-only shortcuts (`next-file`, `prev-file`, `toggle-generated`) check
`options.activeTab === 'code'` inside the handler. The missing modifier guard bug
(Cmd+J would fire `next-file`) is fixed automatically by `matchesShortcut`.

### `src/pages/MRListPage.tsx`

Replace the inline `useEffect` for `Shift+H` with:
```typescript
useShortcuts({ 'toggle-approved': (e) => { e.preventDefault(); setShowApproved(v => !v); } });
```

---

## What Stays Unchanged

- `src/hooks/useKeyboardNav.ts` — list/file nav utility with its own deps lifecycle
- `src/hooks/useListSearch.ts` — uses capture-phase intentionally for Cmd+F / Escape
- `src/hooks/useCustomShortcuts.ts` — no changes; `customBindings` can be plumbed in
  later via the `options.customBindings` param of `useShortcuts`
- `src/pages/PipelinesPage/ProjectSearch.tsx` — component-local DOM focus, not a
  page-level shortcut
- All `src/components/` keyboard handlers (CommentInput, FileNavigation, etc.)

---

## Key Edge Cases

| Case | Handling |
|------|----------|
| `'?'` (Shift+/) | No explicit modifier in config → `matchesShortcut` checks `!metaKey && !ctrlKey && !altKey`, ignores shiftKey. `e.key === '?'` is true when Shift+/ pressed. ✓ |
| `'Shift+H'` | Parses shift=true, key='H'. `e.key === 'H'` when Shift held. ✓ |
| `Cmd+A` shouldn't fire `'approve'` | `'a'` parses metaOrCtrl=false. `matchesShortcut` requires `!(e.metaKey\|\|e.ctrlKey)`. ✓ |
| Arrow aliases `'n / j / ↓'` | Split on ` / `, `↓` maps to `ArrowDown`. ✓ |
| `'?'` / `'\\'` special chars | Treated as bare keys, no modifier prefix. ✓ |

---

## Bonus: Custom Bindings (follow-up)

Once the above refactor is done, enabling user-customizable bindings is a small step:
1. Call `useCustomShortcuts()` high in the tree (e.g. `AppContent`)
2. Pass `customBindings` down to `useShortcuts` calls via `options.customBindings`
3. `useShortcuts` already resolves: `customBindings[id] ?? defaultShortcuts[id].defaultKey`

The `useCustomShortcuts` hook already handles loading, persistence, and fallback.

---

## Verification

1. `bunx tsc --noEmit` — no type errors
2. `bun run tauri dev` and manually verify:
   - `Cmd+P` opens command palette
   - `Cmd+L` / `Cmd+M` / `Cmd+I` navigate correctly
   - `?` opens keyboard help
   - On MR detail: `a` approves, `o` opens browser, `j/n/↓` navigates files, `Escape` goes back
   - On MR detail with comment open: `Escape` closes comment, other keys suppressed
   - `Cmd+D` toggles activity drawer on MR detail
   - `Shift+H` toggles approved MRs on MR list
   - On My MR detail: `1/2/3` switches tabs, `j/k` navigates files only on code tab
