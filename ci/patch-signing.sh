#!/bin/bash
# Forces the Android debug build to sign with our own committed keystore
# (ci/debug.keystore) instead of relying on Gradle's default debug-keystore
# auto-detection, which has silently broken signature consistency between
# builds in the past.
#
# IMPORTANT: this appends a *separate* `android { ... }` block at the end
# of build.gradle rather than splicing text into the middle of the
# Capacitor-generated one. Gradle's Android DSL merges multiple `android {}`
# blocks found in the same file, so this cannot corrupt or remove anything
# already declared above (namespace, compileSdk, defaultConfig, etc. are
# left completely untouched).
#
# Run this AFTER `npx cap add android` / `npx cap sync android` (since the
# android/ folder doesn't exist until then) and BEFORE `./gradlew assembleDebug`.
set -e

GRADLE_FILE="android/app/build.gradle"
MARKER="CINDY_SHARED_KEYSTORE"

if [ ! -f "$GRADLE_FILE" ]; then
  echo "ERROR: $GRADLE_FILE not found — did cap add android / cap sync run first?"
  exit 1
fi

if grep -q "$MARKER" "$GRADLE_FILE"; then
  echo "build.gradle already patched, skipping."
  exit 0
fi

if [ -z "$CINDY_KEYSTORE_PATH" ]; then
  echo "ERROR: CINDY_KEYSTORE_PATH env var not set."
  exit 1
fi

if [ ! -f "$CINDY_KEYSTORE_PATH" ]; then
  echo "ERROR: keystore not found at $CINDY_KEYSTORE_PATH"
  exit 1
fi

cat >> "$GRADLE_FILE" <<EOF

// $MARKER - injected by ci/patch-signing.sh
android {
    signingConfigs {
        debug {
            storeFile file("$CINDY_KEYSTORE_PATH")
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }
    }
    buildTypes {
        debug {
            signingConfig signingConfigs.debug
        }
    }
}
EOF

echo "Appended explicit debug signingConfig to $GRADLE_FILE"
