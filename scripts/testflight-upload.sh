#!/usr/bin/env bash
# Build the iOS app for App Store Connect distribution and upload it to TestFlight.
# Requires an app-specific password stored in the keychain once via:
#   xcrun altool --store-password-in-keychain-item --item "AC_PASSWORD" -u <apple-id> -p <app-specific-password>
# Usage:
#   scripts/testflight-upload.sh [apple-id]
set -euo pipefail
cd "$(dirname "$0")/.."

APPLE_ID="${1:-derond@redkiwi.nl}"
IPA_DIR="src-tauri/gen/apple/build/arm64"
BUILD_NUMBER=$(date +%s)

echo "==> Building iOS app for App Store Connect (build $BUILD_NUMBER)"
bun tauri ios build --export-method app-store-connect --build-number "$BUILD_NUMBER"

IPA_PATH=$(find "$IPA_DIR" -maxdepth 1 -iname "*.ipa" -print -quit)
if [ -z "$IPA_PATH" ]; then
  echo "error: no .ipa found in $IPA_DIR" >&2
  exit 1
fi

echo "==> Validating $IPA_PATH"
xcrun altool --validate-app -f "$IPA_PATH" -t ios -u "$APPLE_ID" -p @keychain:AC_PASSWORD

echo "==> Uploading $IPA_PATH to App Store Connect"
xcrun altool --upload-app -f "$IPA_PATH" -t ios -u "$APPLE_ID" -p @keychain:AC_PASSWORD

echo "==> Done. Check TestFlight processing status in App Store Connect."
