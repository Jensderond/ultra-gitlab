# ultra — Ultra GitLab terminal UI

A ratatui terminal frontend for Ultra GitLab. It reuses the desktop app's Rust
backend (`ultra_gitlab_lib`) and **shares its SQLite database**, so actions you
take in the CLI flow to GitLab and show up in the desktop app on its next sync.

## Run

Keep the desktop app running — it owns the background sync engine that keeps the
local cache fresh and processes auto-merge claims. Then:

```bash
cd src-tauri && cargo run -p ultra-gitlab-cli
```

Override the database location with `--db <path>` or the `ULTRA_GITLAB_DB`
environment variable. By default it opens the same file the desktop app uses:
`<OS data dir>/com.jens.ultra-gitlab/ultra-gitlab.db`
(on macOS: `~/Library/Application Support/com.jens.ultra-gitlab/ultra-gitlab.db`).

If the database doesn't exist or no instance is configured, the CLI exits with a
hint to sign in via the desktop app first.

## Update

`ultra update` replaces the binary with the newest **promoted** GitHub release
(pre-releases are ignored until you mark one as Latest):

    ultra update

## Keys

- **Lists:** `1`/`2`/`Tab` switch tabs · `j`/`k` move · `enter` open · `r` refresh · `q` quit
- **Detail:** `→`/`l` focus diff · `←`/`h` focus files · `tab` toggle focus · `j`/`k` scroll/file · `V` mark file viewed (jumps to next unviewed) · `esc` back
- **Review detail:** `a` approve / unapprove
- **Mine detail:** `R` rebase · `M` merge (confirm with `y`) · `U` undraft · `A` auto-merge

### Comments & suggestions (detail screen)

- `c` — post a comment: on the file tree it opens a general MR comment; on the diff it posts an inline comment on the diff cursor line
- `v` — start / clear a visual line-range selection in the diff (select a range, then `c` or `s` to act on it)
- `s` — open a suggestion on the diff cursor line or selected range (opens `$EDITOR` to write the replacement, then shows a preview before posting)
- `C` — open the discussions overlay showing all threads on the MR
  - `j`/`k` — move between threads
  - `r` — reply to the focused thread
  - `R` — resolve / unresolve the focused thread
  - `esc` — close the overlay

Lines in the diff that already have a discussion are marked with a `●` in the gutter (shown in yellow).

## Tabs

- **Review** — merge requests assigned to you or awaiting your review (excludes your own authored MRs).
- **Mine** — your open merge requests (plus recently merged), with draft and auto-merge status.

## Notes

- Diffs are read from the shared cache; if an MR hasn't been cached yet, its diff
  is fetched live from GitLab for the session (the status line shows
  "Loaded diff (live)").
- `auto-merge` records a claim that the **desktop app's** sync engine processes —
  it merges once GitLab reports the MR mergeable. Keep the desktop app running.
