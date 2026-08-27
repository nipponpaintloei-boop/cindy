#!/usr/bin/env bash
# @capacitor/geolocation is supposed to merge ACCESS_FINE_LOCATION /
# ACCESS_COARSE_LOCATION into AndroidManifest.xml automatically via
# Gradle's manifest merger. In practice that merge has been unreliable in
# this project's build, leaving the built APK with no location permission
# at all (it doesn't even show up as "not allowed" in Android's App Info
# permissions screen — Android only lists permissions that are actually
# declared in the manifest). This script inserts them directly so the
# permission is guaranteed to exist regardless of plugin manifest merging.
#
# Run this AFTER `npx cap add android` / `npx cap sync android` (the
# android/ folder must already exist) and it's safe to run on every build
# (guards against double-patching).
set -euo pipefail

MANIFEST="android/app/src/main/AndroidManifest.xml"

if [ ! -f "$MANIFEST" ]; then
  echo "ERROR: $MANIFEST not found — did cap add android / cap sync run first?"
  exit 1
fi

if grep -q "ACCESS_FINE_LOCATION" "$MANIFEST"; then
  echo "AndroidManifest.xml already has location permissions, skipping."
  exit 0
fi

python3 - "$MANIFEST" <<'PY'
import re
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    content = f.read()

match = re.search(r'(<manifest\b[^>]*>)', content)
if not match:
    raise SystemExit("Could not find <manifest> opening tag in " + path)

perms = (
    '\n    <uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />'
    '\n    <uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />'
)

insert_at = match.end()
content = content[:insert_at] + perms + content[insert_at:]

with open(path, "w", encoding="utf-8") as f:
    f.write(content)
PY

echo "Inserted ACCESS_COARSE_LOCATION / ACCESS_FINE_LOCATION into $MANIFEST"
