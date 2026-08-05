import { describe, it, expect } from 'vitest';
import { computeEditedRegion } from './gitlabSuggestions';

describe('computeEditedRegion', () => {
  it('returns null for identical content', () => {
    expect(computeEditedRegion('a\nb\nc', 'a\nb\nc')).toBeNull();
  });

  it('returns null for identical content with CRLF differences', () => {
    expect(computeEditedRegion('a\r\nb\r\nc', 'a\nb\nc')).toBeNull();
  });

  it('detects a single-line change', () => {
    expect(computeEditedRegion('a\nb\nc', 'a\nB\nc')).toEqual({
      startLine: 2,
      endLine: 2,
      replacement: 'B',
    });
  });

  it('detects a change on the last line', () => {
    expect(computeEditedRegion('a\nb', 'a\nB')).toEqual({
      startLine: 2,
      endLine: 2,
      replacement: 'B',
    });
  });

  it('detects a multi-line block change', () => {
    expect(computeEditedRegion('a\nb\nc\nd', 'a\nX\nY\nd')).toEqual({
      startLine: 2,
      endLine: 3,
      replacement: 'X\nY',
    });
  });

  it('detects a change that grows the line count', () => {
    expect(computeEditedRegion('a\nb\nc', 'a\nX\nY\nZ\nc')).toEqual({
      startLine: 2,
      endLine: 2,
      replacement: 'X\nY\nZ',
    });
  });

  it('expands a pure insertion in the middle to include the line above', () => {
    expect(computeEditedRegion('a\nb\nc', 'a\nX\nb\nc')).toEqual({
      startLine: 1,
      endLine: 1,
      replacement: 'a\nX',
    });
  });

  it('expands a pure insertion at the top to include the line below', () => {
    expect(computeEditedRegion('a\nb', 'X\na\nb')).toEqual({
      startLine: 1,
      endLine: 1,
      replacement: 'X\na',
    });
  });

  it('expands a pure insertion at the bottom to include the line above', () => {
    expect(computeEditedRegion('a\nb', 'a\nb\nX')).toEqual({
      startLine: 2,
      endLine: 2,
      replacement: 'b\nX',
    });
  });

  it('returns an empty replacement for a pure deletion', () => {
    expect(computeEditedRegion('a\nb\nc', 'a\nc')).toEqual({
      startLine: 2,
      endLine: 2,
      replacement: '',
    });
  });

  it('collapses disjoint edits to the full span', () => {
    expect(computeEditedRegion('a\nb\nc\nd\ne', 'a\nB\nc\nD\ne')).toEqual({
      startLine: 2,
      endLine: 4,
      replacement: 'B\nc\nD',
    });
  });

  it('handles files with trailing newlines', () => {
    expect(computeEditedRegion('a\nb\n', 'a\nB\n')).toEqual({
      startLine: 2,
      endLine: 2,
      replacement: 'B',
    });
  });
});
