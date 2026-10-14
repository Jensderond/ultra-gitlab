/**
 * Review order: read the code that does the work first, then what presents
 * it, then how it's wired, then the proof, then the prose.
 */

import type { DiffFile } from '../../api/types';

export type FileCategory = 'source' | 'presentation' | 'config' | 'other' | 'tests' | 'docs';

const RANK: Record<FileCategory, number> = {
  source: 0,
  presentation: 1,
  config: 2,
  other: 3,
  tests: 4,
  docs: 5,
};

export const REVIEW_ORDER_HINT =
  'Files are ordered for reviewing: source code first, then templates and styles, ' +
  'configuration, tests and finally docs. Generated files are listed separately and not counted.';

const IMAGE = /\.(png|jpe?g|gif|webp|bmp|ico|avif|svg)$/i;
const BINARY = /\.(pdf|zip|gz|tgz|bz2|xz|7z|rar|jar|war|woff2?|ttf|otf|eot|mp3|mp4|mov|webm|wav|ogg|exe|dll|so|dylib|a|o|class|pyc|sqlite|db|psd|ai|sketch|fig|bin|lockb)$/i;

export const isImagePath = (path: string) => IMAGE.test(path);
export const isBinaryPath = (path: string) => BINARY.test(path);

export function imageMime(path: string): string {
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'jpg') return 'image/jpeg';
  if (ext === 'ico') return 'image/x-icon';
  return `image/${ext}`;
}

/** Content that's clearly not text (NUL bytes in the first few KB). */
export const looksBinary = (text: string) => text.slice(0, 8000).includes('\u0000');

export function categorize(path: string): FileCategory {
  const lower = path.toLowerCase();
  const name = lower.slice(lower.lastIndexOf('/') + 1);
  const segments = lower.split('/');

  // Tests: test directories or test-named files.
  if (
    segments.some((s) => ['test', 'tests', '__tests__', 'spec', 'specs', 'e2e', 'testing', '__mocks__', 'fixtures'].includes(s)) ||
    /(\.|_|-)(test|spec)\.[a-z0-9]+$/.test(name) ||
    /test\.(php|java|kt|cs|swift|scala)$/.test(name) ||
    /^test_.*\.py$/.test(name) ||
    /_test\.(go|py|rb|exs?)$/.test(name)
  ) {
    return 'tests';
  }

  // Docs.
  if (
    /\.(md|mdx|markdown|rst|adoc|txt)$/.test(name) ||
    segments.slice(0, -1).some((s) => s === 'docs' || s === 'doc' || s === 'documentation') ||
    /^(readme|changelog|changes|license|licence|contributing|authors|notice)(\.|$)/.test(name)
  ) {
    return 'docs';
  }

  // Templates & styles (blade templates before plain PHP).
  if (
    /\.blade\.php$/.test(name) ||
    /\.(twig|html?|erb|haml|slim|hbs|handlebars|mustache|njk|jinja2?|liquid|ejs|pug|latte|tpl|css|scss|sass|less|styl|pcss)$/.test(name)
  ) {
    return 'presentation';
  }
  if (IMAGE.test(name)) return 'presentation';

  // Configuration & wiring.
  if (
    /\.(json|ya?ml|toml|ini|cfg|conf|env|neon|xml|properties|plist|lock|gradle|tf|tfvars|hcl|nix)$/.test(name) ||
    /^\.(env|editorconfig|gitignore|gitattributes|npmrc|nvmrc|prettierrc|eslintrc|babelrc|dockerignore|htaccess)/.test(name) ||
    /^(dockerfile|makefile|procfile|gemfile|rakefile|vagrantfile|justfile|brewfile)$/.test(name) ||
    /\.config\.(js|cjs|mjs|ts)$/.test(name) ||
    /^(vite|webpack|rollup|babel|jest|vitest|playwright|tailwind|postcss|eslint|tsconfig)[.-]/.test(name) ||
    segments.slice(0, -1).some((s) => s === 'config' || s === '.github' || s === '.gitlab' || s === 'migrations' || s === 'deploy')
  ) {
    return 'config';
  }

  if (
    /\.(php|ts|tsx|js|jsx|mjs|cjs|vue|svelte|astro|py|rb|go|rs|java|kt|kts|swift|m|mm|c|cc|cpp|h|hpp|cs|fs|scala|ex|exs|erl|clj|dart|lua|pl|sh|bash|zsh|sql|graphql|gql|proto|r|jl|zig|elm|hs|ml)$/.test(name)
  ) {
    return 'source';
  }
  return 'other';
}

export interface OrderedFiles {
  reviewable: DiffFile[];
  generated: DiffFile[];
}

/** Split into reviewable (in review order) and generated files (GitLab's order). */
export function orderFiles(files: DiffFile[], isGenerated: (path: string) => boolean): OrderedFiles {
  const reviewable: DiffFile[] = [];
  const generated: DiffFile[] = [];
  const sorted = [...files].sort((a, b) => a.filePosition - b.filePosition);
  for (const f of sorted) (isGenerated(f.newPath) ? generated : reviewable).push(f);
  reviewable.sort((a, b) => RANK[categorize(a.newPath)] - RANK[categorize(b.newPath)] || a.filePosition - b.filePosition);
  return { reviewable, generated };
}

export function changeLabel(f: DiffFile): string | null {
  switch (f.changeType) {
    case 'added':
      return 'new';
    case 'deleted':
      return 'deleted';
    case 'renamed':
      return 'renamed';
    default:
      return null;
  }
}
