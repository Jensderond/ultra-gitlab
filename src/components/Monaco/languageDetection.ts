/**
 * Maps file extensions to Monaco language IDs.
 * @see https://github.com/microsoft/monaco-editor/blob/main/src/basic-languages/monaco.contribution.ts
 */
const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  // JavaScript/TypeScript
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "javascript",
  ts: "typescript",
  mts: "typescript",
  cts: "typescript",
  tsx: "typescript",

  // Web
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  sass: "scss",
  less: "less",

  // Data formats
  json: "json",
  jsonc: "jsonc",
  json5: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  xml: "xml",
  svg: "xml",

  // Markdown
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",

  // Shell
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",

  // Python
  py: "python",
  pyw: "python",
  pyi: "python",

  // Rust
  rs: "rust",

  // Go
  go: "go",
  mod: "go",

  // Java/Kotlin
  java: "java",
  kt: "kotlin",
  kts: "kotlin",

  // C/C++
  c: "c",
  h: "c",
  cpp: "cpp",
  cxx: "cpp",
  cc: "cpp",
  hpp: "cpp",
  hxx: "cpp",

  // C#
  cs: "csharp",
  csx: "csharp",

  // Swift
  swift: "swift",

  // Ruby
  rb: "ruby",
  gemspec: "ruby",
  rake: "ruby",

  // PHP
  php: "php",

  // SQL
  sql: "sql",
  mysql: "mysql",
  pgsql: "pgsql",

  // Config files
  dockerfile: "dockerfile",
  gitignore: "plaintext",
  gitattributes: "plaintext",
  editorconfig: "ini",
  ini: "ini",
  conf: "ini",
  cfg: "ini",
  env: "shell",

  // Other
  graphql: "graphql",
  gql: "graphql",
  r: "r",
  lua: "lua",
  perl: "perl",
  pl: "perl",
  pm: "perl",
};

/**
 * Special filenames that map to specific languages.
 */
const FILENAME_TO_LANGUAGE: Record<string, string> = {
  Dockerfile: "dockerfile",
  Makefile: "makefile",
  GNUmakefile: "makefile",
  CMakeLists: "cmake",
  Gemfile: "ruby",
  Rakefile: "ruby",
  Vagrantfile: "ruby",
  Podfile: "ruby",
  Brewfile: "ruby",
  Fastfile: "ruby",
  Matchfile: "ruby",
  Appfile: "ruby",
  ".bashrc": "shell",
  ".bash_profile": "shell",
  ".zshrc": "shell",
  ".profile": "shell",
  ".gitignore": "plaintext",
  ".gitattributes": "plaintext",
  ".editorconfig": "ini",
  ".env": "shell",
  ".env.local": "shell",
  ".env.development": "shell",
  ".env.production": "shell",
};

/**
 * Detects the Monaco language ID for a given file path.
 *
 * @param filePath - The file path (can be full path or just filename)
 * @returns The Monaco language ID, or "plaintext" if unknown
 */
export function getLanguageFromPath(filePath: string): string {
  // Get the filename from the path
  const segments = filePath.split("/");
  const filename = segments[segments.length - 1];

  // Check for special filenames first
  if (filename in FILENAME_TO_LANGUAGE) {
    return FILENAME_TO_LANGUAGE[filename];
  }

  // Check for dotfiles by name (without extension)
  const nameWithoutExt = filename.split(".")[0];
  if (nameWithoutExt === "" && filename in FILENAME_TO_LANGUAGE) {
    return FILENAME_TO_LANGUAGE[filename];
  }

  // Extract extension
  const lastDot = filename.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filename.length - 1) {
    // No extension or trailing dot
    return "plaintext";
  }

  const extension = filename.slice(lastDot + 1).toLowerCase();

  // Check extension mapping
  if (extension in EXTENSION_TO_LANGUAGE) {
    return EXTENSION_TO_LANGUAGE[extension];
  }

  return "plaintext";
}
