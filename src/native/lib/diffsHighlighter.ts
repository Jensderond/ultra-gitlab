import { canUseWASM, type HighlighterTypes } from '@pierre/diffs';

/**
 * Syntax highlighter backend for @pierre/diffs: the WebAssembly "highlights"
 * backend (beta) when the WebView can run WASM with SIMD, Shiki otherwise.
 *
 * Only one highlighter type can be active per thread, so the worker pool and
 * every main-thread preload must pass this same value.
 */
export const preferredHighlighter: HighlighterTypes = canUseWASM() ? 'highlights' : 'shiki-js';
