import picomatch from 'picomatch';
import type { DiffFileSummary } from '../types';

interface ClassifyResult {
  reviewable: DiffFileSummary[];
  generated: Set<string>;
}

/**
 * Classifies MR files as generated or reviewable based on gitattributes
 * and user-configured collapse patterns.
 *
 * A file is "generated" if its newPath matches any pattern from either source.
 */
export function classifyFiles(
  files: DiffFileSummary[],
  gitattributePatterns: string[],
  userPatterns: string[]
): ClassifyResult {
  const allPatterns = [...gitattributePatterns, ...userPatterns];

  if (allPatterns.length === 0) {
    return { reviewable: [...files], generated: new Set() };
  }

  const isMatch = picomatch(allPatterns, { dot: true });
  const generated = new Set<string>();
  const reviewable: DiffFileSummary[] = [];

  for (const file of files) {
    if (isMatch(file.newPath)) {
      generated.add(file.newPath);
    } else {
      reviewable.push(file);
    }
  }

  return { reviewable, generated };
}
