# Ultra GitLab

A local-first GitLab merge request review app built with Tauri, React, and TypeScript.

## Install

Download the latest `.dmg` from [Releases](../../releases), open it, and drag the app to Applications.

Since the app isn't signed with an Apple Developer certificate, macOS will block it on first launch. To fix this, run:

```bash
xattr -d com.apple.quarantine /Applications/Ultra\ Gitlab.app
```

Then open the app normally.

## Browser Userscript

A Tampermonkey/Greasemonkey userscript is available at [`extras/open-in-ultra-gl.user.js`](extras/open-in-ultra-gl.user.js). It adds an **"Open in Ultra GL"** button to GitLab merge request pages that launches the MR directly in the desktop app via deep link.

Install it by opening the file in your browser with Tampermonkey enabled, or copy-paste it into a new userscript.

## Development

```bash
bun install
bun run tauri dev
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)
