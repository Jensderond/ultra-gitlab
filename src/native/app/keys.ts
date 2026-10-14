/**
 * Keyboard shortcuts.
 *
 *   useKeys({ j: next, k: prev, 'mod+enter': submit })
 *
 * Combos: modifiers `mod` (⌘ on Mac, Ctrl elsewhere), `shift`, `alt`, `ctrl`
 * joined with `+`, then the key as `KeyboardEvent.key` lowercased
 * (`enter`, `escape`, `arrowdown`, `[`, `/`, `?`…).
 *
 * Single-key shortcuts are ignored while typing in a field; combos with `mod`
 * always fire. Layers registered later win, and a `modal` layer (a sheet or
 * palette) blocks every layer below it.
 */

import { useEffect, useRef } from 'react';
import { isMac } from '../api/client';

export type KeyHandler = (e: KeyboardEvent) => void | boolean;
export type KeyMap = Record<string, KeyHandler | undefined | false>;

interface Layer {
  map: { current: KeyMap };
  modal: boolean;
  enabled: { current: boolean };
}

const layers: Layer[] = [];

function comboOf(e: KeyboardEvent): string {
  const parts: string[] = [];
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod) parts.push('mod');
  if (isMac && e.ctrlKey) parts.push('ctrl');
  if (e.altKey) parts.push('alt');
  // Shift is implied by the key itself for symbols like ? and ⇧-letters stay letters.
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase();
  if (e.shiftKey && (key.length > 1 || /[a-z0-9 ]/.test(key))) parts.push('shift');
  parts.push(key === ' ' ? 'space' : key);
  return parts.join('+');
}

// Inputs you don't type into: a focused checkbox (say, after clicking
// "Viewed") must not swallow J / K.
const NOT_TEXT = /^(checkbox|radio|button|submit|reset|range|color|file|image)$/;

function isTyping(target: EventTarget | null) {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    (el.tagName === 'INPUT' && !NOT_TEXT.test((el as HTMLInputElement).type)) ||
    el.tagName === 'TEXTAREA' ||
    el.tagName === 'SELECT'
  );
}

function onKeyDown(e: KeyboardEvent) {
  if (e.defaultPrevented || e.isComposing) return;
  const combo = comboOf(e);
  // composedPath: inside a shadow root (the diff editor) e.target is the host.
  const typing = isTyping(e.composedPath()[0] ?? e.target);
  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (!layer.enabled.current) continue;
    const handler = layer.map.current[combo];
    const allowed = !typing || combo.includes('mod+') || combo === 'escape';
    if (handler && allowed) {
      // Returning false lets the event fall through to lower layers.
      if (handler(e) !== false) {
        e.preventDefault();
        e.stopPropagation();
        return;
      }
    }
    if (layer.modal) return;
  }
}

if (typeof window !== 'undefined') window.addEventListener('keydown', onKeyDown);

export function useKeys(map: KeyMap, { modal = false, enabled = true } = {}) {
  const mapRef = useRef(map);
  mapRef.current = map;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const layerRef = useRef<Layer | null>(null);
  useEffect(() => {
    const layer: Layer = { map: mapRef, modal, enabled: enabledRef };
    layerRef.current = layer;
    layers.push(layer);
    return () => {
      const i = layers.indexOf(layer);
      if (i >= 0) layers.splice(i, 1);
    };
  }, [modal]);
  // A layer that switches on later (a sheet opening) goes to the top. Sheets
  // mount together with the screen that owns them, so without this the
  // screen's own layer would sit above the sheet and its keys (Esc, J/K,
  // Return) would still fire underneath it.
  useEffect(() => {
    const layer = layerRef.current;
    if (!enabled || !layer) return;
    const i = layers.indexOf(layer);
    if (i >= 0 && i < layers.length - 1) {
      layers.splice(i, 1);
      layers.push(layer);
    }
  }, [enabled]);
}

/** Render a combo for display: `mod+shift+enter` → `⌘⇧↩`. */
export function formatKeys(combo: string): string {
  const glyphs: Record<string, string> = isMac
    ? { mod: '⌘', shift: '⇧', alt: '⌥', ctrl: '⌃' }
    : { mod: 'Ctrl+', shift: 'Shift+', alt: 'Alt+', ctrl: 'Ctrl+' };
  const keys: Record<string, string> = {
    enter: '↩',
    escape: 'esc',
    arrowup: '↑',
    arrowdown: '↓',
    arrowleft: '←',
    arrowright: '→',
    backspace: '⌫',
    space: 'Space',
    tab: '⇥',
  };
  return combo
    .split('+')
    .map((p) => glyphs[p] ?? keys[p] ?? p.toUpperCase())
    .join('');
}
