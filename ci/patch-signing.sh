#!/bin/bash
# Forces the Android debug build to sign with our own committed keystore
# (ci/debug.keystore) by pointing to it directly in build.gradle, instead of
# relying on Gradle's default debug-keystore auto-detection at
# ~/.android/debug.keystore. That default location has moved across
# Android SDK / Gradle versions, so relying on it silently breaks signature
# consistency between builds (Gradle just generates a fresh random keystore
# if it doesn't find one at the location it expects, with no error).
#
# Run this AFTER `npx cap add android` / `npx cap sync android` (since the
# android/ folder doesn't exist until then) and BEFORE `./gradlew assembleDebug`.
set -e

GRADLE_FILE="android/app/build.gradle"
MARKER="CINDY_SHARED_KEYSTORE"

if [ ! -f "$GRADLE_FILE" ]; then
  echo "ERROR: $GRADLE_FILE not found — did cap add android run first?"
  exit 1
fi

if grep -q "$MARKER" "$GRADLE_FILE"; then
  echo "build.gradle already patched, skipping."
  exit 0
fi

python3 - "$GRADLE_FILE" <<'PYEOF'
import sys
path = sys.argv[1]
with open(path) as f:
    content = f.read()

signing_block = '''    signingConfigs {
        debug {
            // CINDY_SHARED_KEYSTORE - injected by ci/patch-signing.sh
            storeFile file(System.getenv("CINDY_KEYSTORE_PATH"))
            storePassword "android"
            keyAlias "androiddebugkey"
            keyPassword "android"
        }
    }
'''

marker = "android {"
idx = content.find(marker)
if idx == -1:
    raise SystemExit("Could not find 'android {' block in build.gradle")
insert_at = idx + len(marker)
content = content[:insert_at] + "\n" + signing_block + content[insert_at:]

with open(path, "w") as f:
    f.write(content)

print("Injected explicit debug signingConfig into", path)
PYEOF
