package com.cindy.workout

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.widget.RemoteViews

/**
 * CINDY home-screen widget.
 *
 * Tapping the widget launches MainActivity with EXTRA_START_WORKOUT=true.
 * MainActivity is responsible for telling the webview to jump straight into
 * a workout (see MainActivity.kt.snippet in this folder for how to wire
 * that up against the app's existing `?action=start` flow in app.js).
 *
 * NOT compiled or tested here — there's no Android SDK / emulator in this
 * environment. Drop this into app/src/main/java/com/cindy/workout/ in your
 * Android Studio project, wire up the manifest + layout files below, and
 * build/run it there.
 */
class CindyWidgetProvider : AppWidgetProvider() {

    companion object {
        const val EXTRA_START_WORKOUT = "com.cindy.workout.START_WORKOUT"
    }

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            val views = RemoteViews(context.packageName, R.layout.widget_cindy)

            val launchIntent = Intent(context, MainActivity::class.java).apply {
                action = Intent.ACTION_MAIN
                addCategory(Intent.CATEGORY_LAUNCHER)
                flags = Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK
                putExtra(EXTRA_START_WORKOUT, true)
            }
            val pendingIntent = PendingIntent.getActivity(
                context,
                0,
                launchIntent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
            )
            views.setOnClickPendingIntent(R.id.widgetStartButton, pendingIntent)

            appWidgetManager.updateAppWidget(appWidgetId, views)
        }
    }
}
