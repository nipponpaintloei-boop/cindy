#!/usr/bin/env bash
set -euo pipefail

PKG_DIR="android/app/src/main/java/com/cindy/workout"
mkdir -p "$PKG_DIR"
cp android-widget-reference/CindyWidgetProvider.kt "$PKG_DIR/CindyWidgetProvider.kt"

mkdir -p android/app/src/main/res/layout
cp android-widget-reference/widget_cindy.xml android/app/src/main/res/layout/widget_cindy.xml

mkdir -p android/app/src/main/res/xml
cp android-widget-reference/widget_cindy_info.xml android/app/src/main/res/xml/widget_cindy_info.xml

MANIFEST="android/app/src/main/AndroidManifest.xml"
python3 - "$MANIFEST" <<'PY'
import re
import sys

path = sys.argv[1]
with open(path, encoding="utf-8") as f:
    content = f.read()

if ".CindyWidgetProvider" in content:
    sys.exit(0)

match = re.search(r'([ \t]*)</application>', content)
if not match:
    raise SystemExit("Could not find </application> in " + path)

indent = match.group(1)
receiver = (
    indent + '    <receiver android:name=".CindyWidgetProvider" android:exported="false">\n'
    + indent + '        <intent-filter>\n'
    + indent + '            <action android:name="android.appwidget.action.APPWIDGET_UPDATE" />\n'
    + indent + '        </intent-filter>\n'
    + indent + '        <meta-data android:name="android.appwidget.provider" android:resource="@xml/widget_cindy_info" />\n'
    + indent + '    </receiver>\n'
)

content = content[:match.start()] + receiver + content[match.start():]
with open(path, "w", encoding="utf-8") as f:
    f.write(content)
PY

cat > "$PKG_DIR/MainActivity.kt" <<'KOT'
package com.cindy.workout

import android.content.Intent
import android.os.Bundle
import com.getcapacitor.BridgeActivity

class MainActivity : BridgeActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        handleWidgetIntent(intent)
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleWidgetIntent(intent)
    }

    private fun handleWidgetIntent(intent: Intent?) {
        if (intent?.getBooleanExtra(CindyWidgetProvider.EXTRA_START_WORKOUT, false) == true) {
            bridge?.webView?.post {
                bridge.webView.evaluateJavascript(
                    "if (typeof loadActive === 'function') { loadActive() ? enterWorkoutScreen() : startNewWorkout(); }",
                    null
                )
            }
        }
    }
}
KOT

echo "Widget files installed into android/ project."
