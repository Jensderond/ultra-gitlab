/**
 * Default number of files to jump with arrow-left/right.
 * Must match DEFAULT_FILE_JUMP_COUNT in src-tauri/src/commands/settings.rs.
 */
export const DEFAULT_FILE_JUMP_COUNT = 5;

/**
 * Compute the next file index given a direction and list length.
 *
 * Single-step (±1) wraps around; multi-step jumps clamp to first/last.
 */
export function computeNextFileIndex(
  currentIdx: number,
  direction: number,
  length: number,
): number {
  if (length === 0) return 0;
  if (currentIdx === -1) {
    return direction > 0 ? 0 : length - 1;
  }
  if (Math.abs(direction) === 1) {
    return ((currentIdx + direction) % length + length) % length;
  }
  return Math.max(0, Math.min(length - 1, currentIdx + direction));
}
