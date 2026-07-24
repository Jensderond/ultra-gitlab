#!/usr/bin/env bash
# Build the iOS app and install it directly on a connected physical device
# (no dev server, no Xcode UI). Usage:
#   scripts/ios-install.sh ["Device Name" or UDID] [debug|release]
set -euo pipefail
cd "$(dirname "$0")/.."

DEVICE="${1:-iPhone van Jens}"
CONFIGURATION="${2:-debug}"
BUNDLE_ID="com.jens.ultra-gitlab"
APP_PATH="src-tauri/gen/apple/build/ultra-gitlab_iOS.xcarchive/Products/Applications/Ultra Gitlab.app"

echo "==> Building iOS app ($CONFIGURATION)"
if [ "$CONFIGURATION" = "debug" ]; then
  bun run tauri ios build --debug
else
  bun run tauri ios build
fi

if [ ! -d "$APP_PATH" ]; then
  echo "error: built app not found at $APP_PATH" >&2
  exit 1
fi

echo "==> Installing on device: $DEVICE"
xcrun devicectl device install app --device "$DEVICE" "$APP_PATH"

echo "==> Launching app"
xcrun devicectl device process launch --device "$DEVICE" "$BUNDLE_ID"
