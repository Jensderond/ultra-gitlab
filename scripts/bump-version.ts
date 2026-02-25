/**
 * Bump version across all project files.
 *
 * Usage:
 *   bun run scripts/bump-version.ts <version>
 *
 * Example:
 *   bun run scripts/bump-version.ts 0.2.0
 */

const version = process.argv[2];

if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error("Usage: bun run scripts/bump-version.ts <version>");
  console.error("Example: bun run scripts/bump-version.ts 0.2.0");
  process.exit(1);
}

const files = [
  {
    path: "package.json",
    replace: (content: string) =>
      content.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`),
  },
  {
    path: "src-tauri/tauri.conf.json",
    replace: (content: string) =>
      content.replace(/"version":\s*"[^"]*"/, `"version": "${version}"`),
  },
  {
    path: "src-tauri/Cargo.toml",
    replace: (content: string) =>
      content.replace(/^version\s*=\s*"[^"]*"/m, `version = "${version}"`),
  },
];

for (const file of files) {
  const content = await Bun.file(file.path).text();
  const updated = file.replace(content);

  if (content === updated) {
    console.warn(`  skip  ${file.path} (no change)`);
    continue;
  }

  await Bun.write(file.path, updated);
  console.log(`  done  ${file.path}`);
}

// Update Cargo.lock to reflect the new version
console.log("\nUpdating lock files...");
const cargo = Bun.spawnSync(["cargo", "generate-lockfile", "--manifest-path", "src-tauri/Cargo.toml"], {
  stdout: "ignore",
  stderr: "pipe",
});
if (cargo.exitCode === 0) {
  console.log("  done  Cargo.lock");
} else {
  console.error("  fail  Cargo.lock — run `cargo check` manually");
  console.error(cargo.stderr.toString());
}

console.log(`\nVersion bumped to ${version}`);
