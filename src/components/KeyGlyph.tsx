const SPECIAL_GLYPHS = /[⌘⌃⌥⇧↵⎋⇥⌫⌦␣↑↓←→]/;

/**
 * Render a formatted key string, wrapping special modifier glyphs
 * in styled spans so they display at a larger size.
 */
export function renderKeyGlyphs(key: string) {
  return Array.from(key).map((char, index) => {
    if (!SPECIAL_GLYPHS.test(char)) {
      return char;
    }

    return (
      <span key={`${char}-${index}`} className="key-glyph" aria-hidden="true">
        {char}
      </span>
    );
  });
}
