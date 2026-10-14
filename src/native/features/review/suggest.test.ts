import { describe, expect, it } from 'vitest';
import { editedRegion, suggestionBlock } from './suggest';

describe('suggestionBlock', () => {
  it('covers the anchored line and the lines above it', () => {
    expect(suggestionBlock('a\nb', 1)).toBe('```suggestion:-1+0\na\nb\n```');
    expect(suggestionBlock('x', 0)).toBe('```suggestion:-0+0\nx\n```');
  });

  it('has no body when the lines are removed', () => {
    expect(suggestionBlock('', 2)).toBe('```suggestion:-2+0\n```');
  });
});

describe('editedRegion', () => {
  it('is null when nothing changed, CRLF included', () => {
    expect(editedRegion('a\nb\nc', 'a\nb\nc')).toBeNull();
    expect(editedRegion('a\r\nb', 'a\nb')).toBeNull();
  });

  it('finds a changed block', () => {
    expect(editedRegion('a\nb\nc\nd', 'a\nX\nY\nd')).toEqual({ startLine: 2, endLine: 3, replacement: 'X\nY' });
  });

  it('finds a block that grows or shrinks', () => {
    expect(editedRegion('a\nb\nc', 'a\nX\nY\nZ\nc')).toEqual({ startLine: 2, endLine: 2, replacement: 'X\nY\nZ' });
    expect(editedRegion('a\nb\nc\nd', 'a\nd')).toEqual({ startLine: 2, endLine: 3, replacement: '' });
  });

  it('spans disjoint edits', () => {
    expect(editedRegion('a\nb\nc\nd', 'A\nb\nc\nD')).toEqual({ startLine: 1, endLine: 4, replacement: 'A\nb\nc\nD' });
  });

  it('grows a pure insertion to an existing line', () => {
    expect(editedRegion('a\nb\nc', 'a\nX\nb\nc')).toEqual({ startLine: 1, endLine: 1, replacement: 'a\nX' });
    expect(editedRegion('a\nb', 'X\na\nb')).toEqual({ startLine: 1, endLine: 1, replacement: 'X\na' });
  });
});
