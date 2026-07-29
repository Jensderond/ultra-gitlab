/**
 * Haptic feedback.
 *
 * iOS-only: wraps `tauri-plugin-haptics`, which maps onto
 * `UIImpactFeedbackGenerator`. A no-op everywhere else (desktop, `bun run dev`
 * in a browser, Playwright), so callers never need to guard.
 *
 * Note the `<input type="checkbox" switch>` trick that gets passed around for
 * webview haptics is dead — Apple removed that behaviour in iOS 26.5. The
 * native plugin is the only working path.
 */

import { impactFeedback, type ImpactFeedbackStyle } from '@tauri-apps/plugin-haptics';
import { isIOS } from './transport';

/**
 * Fire a one-shot impact tap. Fire-and-forget: the plugin returns a `Result`
 * rather than throwing, and both that error case and any IPC-level throw are
 * ignored — callers are gesture handlers where a failure must not break the
 * interaction. `light` is close to imperceptible on some devices, so `medium`
 * is the default.
 */
export async function hapticImpact(style: ImpactFeedbackStyle = 'medium'): Promise<void> {
  if (!isIOS) return;
  try {
    await impactFeedback(style);
  } catch {
    // Haptics are a nicety — never let them surface as an error.
  }
}
