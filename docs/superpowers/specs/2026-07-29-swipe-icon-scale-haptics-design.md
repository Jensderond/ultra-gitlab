# Swipe action: icon scale animation + threshold haptic

**Date:** 2026-07-29
**Scope:** `SwipeActionRow` / `useSwipeAction` — affects both swipe-to-snooze (MR list) and swipe-to-favorite (issue list)

## Problem

The swipe-left action gives no physical or animated confirmation that the gesture has
armed. The action icon swaps (`icon` → `armedIcon`) and the layer's colour changes, but
nothing signals the threshold crossing with the immediacy iOS users expect. On a phone,
where the finger covers part of the row, a colour change is easy to miss.

Two additions:

1. The action icon grows as the drag approaches the threshold, then springs past 1.0 the
   moment it arms.
2. A native haptic tap fires on the upward threshold crossing.

Both live in the shared gesture layer, so both existing swipe consumers get them without
per-consumer changes.

## Non-goals

- No change to the threshold (72px), max drag (96px), overdrag damping, or intent
  detection. The gesture's feel stays identical; only its feedback changes.
- No haptic on release/trigger. iOS convention is one tap on arming, not two.
- No Android tuning. The plugin covers Android, but this app ships iOS only in practice.

## Design

### 1. Icon animation — two nested scale layers

A continuous drag-tracked scale and a springy threshold pop cannot share one `transform`
property: a 260ms spring transition makes the drag-tracked scale lag the finger by 260ms
and feel mushy. They therefore get separate elements, composing multiplicatively.

```
.swipe-row-action                 style={{ '--swipe-progress': progress }}
  span.swipe-row-action-icon      scale(calc(0.6 + 0.4 * progress))  transition: none
    span.swipe-row-action-icon-pop  scale(1) → scale(1.18) when .is-armed, spring
      {pastThreshold ? (armedIcon ?? icon) : icon}
```

- **Track layer** (`.swipe-row-action-icon`): `transition: none`, so scale follows the
  finger 1:1. Maps drag progress 0→1 onto scale 0.6→1.0.
- **Pop layer** (`.swipe-row-action-icon-pop`): `transform: scale(1)`, transitioning to
  `scale(1.18)` under `.swipe-row-action.is-armed` with
  `transition: transform 260ms cubic-bezier(.34, 1.56, .64, 1)`. The >1 control point is
  what produces the overshoot.

At the threshold `progress` is exactly 1, so the track layer sits at 1.0 and the pop layer
springs 1.0 → 1.18. Net scale at arm: 1.18.

Both wrapper spans stay mounted across the `icon`/`armedIcon` child swap, so the pop
transition is never interrupted by a remount. `transform-origin: center`; a 1.18× scale on
a 20px icon is ~23.6px, well inside the layer's 24px right padding.

Under `prefers-reduced-motion: reduce` the pop layer's transition is removed. The icon
still changes size — that is state, not decoration — but without the overshoot animation.

### 2. `useSwipeAction` — progress + arm-edge haptic

New field on `UseSwipeActionResult`:

```ts
/** Drag distance toward the trigger threshold, clamped to 0…1. */
progress: number;   // Math.min(1, offset / TRIGGER_THRESHOLD)
```

A `crossed: boolean` is added to the existing mutable `gesture` ref to track the threshold
edge. Inside `handleTouchMove`, after `setOffset(s.distance)` and `e.preventDefault()`:

- `s.distance >= TRIGGER_THRESHOLD && !s.crossed` → set `s.crossed = true`, fire the
  haptic.
- `s.distance < TRIGGER_THRESHOLD && s.crossed` → set `s.crossed = false`, no haptic.

So dragging back below and past the threshold again re-fires, but holding the finger at the
boundary does not spam. `s.crossed` resets to `false` in `release()` and in the ref-cleanup
alongside the existing gesture state.

The haptic call is fire-and-forget and sequenced **after** `preventDefault()` — an awaited
IPC round-trip in front of `preventDefault` would risk losing the scroll-lock. Firing from
the touch handler rather than a `useEffect` on `pastThreshold` also saves a render frame of
latency, which is perceptible for a haptic.

### 3. `src/services/haptics.ts`

```ts
export async function hapticImpact(style = 'medium'): Promise<void>
```

- Returns immediately when `isIOS` (from `services/transport.ts`) is false. Desktop,
  `bun run dev` in a browser, and Playwright are therefore all unaffected — the swipe
  gesture has exactly its current behaviour there.
- Body wrapped in try/catch: a missing capability permission or a non-Tauri context must
  never throw into a gesture handler.
- Static import of `@tauri-apps/plugin-haptics`, matching how `transport.ts` already
  statically imports `@tauri-apps/plugin-os`. The module only performs IPC when called.

`'medium'` is the default because `'light'` is close to imperceptible on some devices;
changing it is a one-token edit.

### 4. Native wiring

| File | Change |
|---|---|
| `src-tauri/Cargo.toml` | new `[target.'cfg(any(target_os = "android", target_os = "ios"))'.dependencies]` section containing `tauri-plugin-haptics = "2"` |
| `src-tauri/src/lib.rs` | `#[cfg(mobile)]` block registering `tauri_plugin_haptics::init()`, mirroring the existing `#[cfg(desktop)]` plugin chain |
| `src-tauri/capabilities/mobile.json` | add `"haptics:allow-impact-feedback"` |
| `package.json` | add `@tauri-apps/plugin-haptics` |

Only the impact permission is added — the plugin's notification/selection/vibrate
permissions are not needed and are left out.

## Rejected alternative: the `<input type="checkbox" switch>` trick

[ios-haptics](https://github.com/tijnjh/ios-haptics) exploits the haptic that Safari's
switch control emits on toggle, requiring no native code. Apple removed that behaviour in
**iOS 26.5**; the library's own README scopes it to iOS 17.4–26.4. It would be silently
dead on current devices, so it is not a viable path.

## Verification

Runnable locally:

- `bunx tsc --noEmit`
- `bun run lint`
- `cargo check --target aarch64-apple-ios` — the host-target `cargo check` does **not**
  compile an iOS-gated dependency, so it cannot catch a mistake in the new Cargo section or
  the `#[cfg(mobile)]` block.
- Existing swipe e2e specs (`e2e/mr-list-mobile-snooze.spec.ts`,
  `e2e/issue-list-mobile.spec.ts`), which already assert the `is-armed` state.

E2E assertions are limited to "the new icon wrappers render" and "`--swipe-progress`
climbs during the drag". Computed transform values are deliberately not asserted:
synthetic touch events in this suite do not reliably flush React state, so such assertions
would be flaky rather than protective.

**Not verifiable without hardware:** the iOS Simulator has no haptics hardware, so the tap
itself can only be confirmed on a physical device via TestFlight. The spring's feel is also
a device-only judgement.

## Risk

Adding an iOS Tauri plugin causes Tauri to regenerate parts of `src-tauri/gen/apple/` on
the next iOS build. The TestFlight upload path depends on manual pbxproj patches, and
`Info.plist` is already modified in the working tree. After the first iOS build, diff
`src-tauri/gen/apple/` and confirm those patches survived before uploading.
