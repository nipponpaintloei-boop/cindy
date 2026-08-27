#!/usr/bin/env bash
# Adds the Google Services Gradle plugin to the freshly-generated Android
# project so @capacitor-firebase/authentication (Google Sign-In) can read
# google-services.json. Safe to run every build: each check guards against
# double-patching in case android/ was already patched.
set -euo pipefail

ROOT_GRADLE="android/build.gradle"
APP_GRADLE="android/app/build.gradle"
GOOGLE_SERVICES_SRC="ci/google-services.json"
GOOGLE_SERVICES_DEST="android/app/google-services.json"

if [ ! -f "$GOOGLE_SERVICES_SRC" ]; then
  echo "ERROR: $GOOGLE_SERVICES_SRC not found. Download it from Firebase Console"
  echo "(Project settings > your Android app) and commit it at that path."
  exit 1
fi
cp "$GOOGLE_SERVICES_SRC" "$GOOGLE_SERVICES_DEST"
echo "Copied google-services.json into android/app/"

# 1. Project-level build.gradle: add the google-services classpath inside
#    the buildscript { dependencies { ... } } block.
if ! grep -q "com.google.gms:google-services" "$ROOT_GRADLE"; then
  awk '
    /buildscript *\{/ { in_buildscript=1 }
    in_buildscript && /dependencies *\{/ && !done {
      print
      print "        classpath (\x27com.google.gms:google-services:4.4.2\x27)"
      done=1
      next
    }
    { print }
  ' "$ROOT_GRADLE" > "$ROOT_GRADLE.tmp"
  mv "$ROOT_GRADLE.tmp" "$ROOT_GRADLE"
  echo "Added google-services classpath to $ROOT_GRADLE"
else
  echo "$ROOT_GRADLE already has google-services classpath, skipping"
fi

# 2. App-level build.gradle: apply the plugin.
if ! grep -q "com.google.gms.google-services" "$APP_GRADLE"; then
  echo "" >> "$APP_GRADLE"
  echo "apply plugin: 'com.google.gms.google-services'" >> "$APP_GRADLE"
  echo "Applied google-services plugin in $APP_GRADLE"
else
  echo "$APP_GRADLE already applies google-services plugin, skipping"
fi
