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

# altool's `-p @keychain:NAME` matches items by their *service* attribute, but its own
# --store-password-in-keychain-item flow (Xcode 26) stores the item with only a label,
# so the lookup always fails. Fetch by label ourselves and hand it over via @env instead.
if ! AC_UPLOAD_PW=$(security find-generic-password -l AC_PASSWORD -w); then
  echo "error: could not read keychain item AC_PASSWORD; store it once via:" >&2
  echo "  xcrun altool --store-password-in-keychain-item --item AC_PASSWORD -u $APPLE_ID -p <app-specific-password>" >&2
  exit 1
fi
export AC_UPLOAD_PW

echo "==> Building iOS app for App Store Connect (build $BUILD_NUMBER)"
bun tauri ios build --export-method app-store-connect --build-number "$BUILD_NUMBER"

IPA_PATH=$(find "$IPA_DIR" -maxdepth 1 -iname "*.ipa" -print -quit)
if [ -z "$IPA_PATH" ]; then
  echo "error: no .ipa found in $IPA_DIR" >&2
  exit 1
fi

echo "==> Validating $IPA_PATH"
xcrun altool --validate-app -f "$IPA_PATH" -t ios -u "$APPLE_ID" -p @env:AC_UPLOAD_PW

echo "==> Uploading $IPA_PATH to App Store Connect"
xcrun altool --upload-app -f "$IPA_PATH" -t ios -u "$APPLE_ID" -p @env:AC_UPLOAD_PW

echo "==> Done. Check TestFlight processing status in App Store Connect."
