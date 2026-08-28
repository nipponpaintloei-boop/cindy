#!/bin/bash
set -e
# Health Connect (used for step-count → XP) requires Android API 26+.
# Capacitor's default generated project targets a lower minSdkVersion, and
# android/variables.gradle is regenerated fresh by `cap add android` on
# every build (it's not committed to the repo), so it has to be patched
# here in CI rather than edited by hand.
sed -i -E 's/minSdkVersion = [0-9]+/minSdkVersion = 26/' android/variables.gradle
echo "variables.gradle after patch:"
grep "minSdkVersion" android/variables.gradle
