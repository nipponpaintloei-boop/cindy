/* ===== CINDY — Firestore Player Data Sync =====
 * Keeps player progress tied to the Google account instead of just the
 * device. Works by:
 *
 *  1. On login: pull the player's cloud document (if any) and write its
 *     values into localStorage BEFORE the game boots, so app.js's init()
 *     sees the synced data as if it was always on this device. If no cloud
 *     document exists yet (first login ever), it uploads whatever is
 *     currently on this device as the starting point instead.
 *
 *  2. While playing: watches localStorage.setItem for the keys listed in
 *     SYNCED_KEYS and pushes the current values up to Firestore a couple
 *     seconds after the last change (debounced, so a burst of updates from
 *     one workout is one write, not dozens).
 *
 * This file must load AFTER storage-shim.js (so it wraps whichever
 * localStorage implementation — real or the Capacitor shim — is active)
 * and AFTER firebase-auth.js (so firebase.auth() and __cindyResolveAuthReady
 * already exist), and BEFORE app.js (so every localStorage.setItem app.js
 * makes is already being watched).
 */
(function () {
  const db = firebase.firestore();

  // Every localStorage key that represents player progress and should
  // follow the player's account across devices. Anything NOT in this list
  // (theme, voice cues, reminders, the in-progress workout, schema version)
  // stays purely local on purpose — see the chat notes for why.
  const SYNCED_KEYS = [
    'cindy_sessions',
    'custom_workout_sessions',
    'cindy_last_seen_level',
    'cindy_streak_chests_opened',
    'cindy_boss_ever_defeated',
    'cindy_loot_inventory',
    'cindy_equipped_loot_id',
    'cindy_active_skin',
    'cindy_active_backdrop',
    'cindy_daily_quest_claimed_v1',
    'cindy_quest_bonus_xp',
    'cindy_combo_bonus_xp',
    'cindy_rest_skip_bonus_xp',
    'cindy_week_ring_goals',
    'custom_workouts',
    'cindy_custom_weekly_plan',
    'cindy_protocols',
    'cindy_active_protocol_id'
  ];

  function readSyncedFromLocalStorage() {
    const out = {};
    SYNCED_KEYS.forEach((key) => {
      const v = localStorage.getItem(key);
      if (v !== null && v !== undefined) out[key] = v;
    });
    return out;
  }

  function writeSyncedToLocalStorage(data) {
    SYNCED_KEYS.forEach((key) => {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        localStorage.setItem(key, data[key]);
      }
    });
  }

  async function pullFromCloud(uid) {
    try {
      const doc = await db.collection('users').doc(uid).get();
      if (doc.exists && doc.data() && doc.data().fields) {
        // Cloud has data (returning player, possibly on a new device) —
        // it wins and overwrites whatever is on this device.
        writeSyncedToLocalStorage(doc.data().fields);
      } else {
        // First login ever for this account — nothing in the cloud yet.
        // Treat whatever is already on this device (if anything) as the
        // starting point and upload it.
        const local = readSyncedFromLocalStorage();
        await db.collection('users').doc(uid).set({
          fields: local,
          updatedAt: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });
      }
    } catch (err) {
      console.error('[sync] pull failed, continuing with local data:', err);
      // Fail open: let the player keep playing with whatever is on the
      // device rather than blocking the game from loading at all.
    }
  }

  let pushTimer = null;
  function schedulePush(uid) {
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      const local = readSyncedFromLocalStorage();
      db.collection('users').doc(uid).set({
        fields: local,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true }).catch((err) => console.error('[sync] push failed:', err));
    }, 2500);
  }

  function watchLocalStorageForUid(uid) {
    const originalSetItem = localStorage.setItem.bind(localStorage);
    localStorage.setItem = function (key, value) {
      originalSetItem(key, value);
      if (SYNCED_KEYS.indexOf(key) !== -1) schedulePush(uid);
    };
  }

  firebase.auth().onAuthStateChanged(async (user) => {
    if (!user) return;
    await pullFromCloud(user.uid);
    watchLocalStorageForUid(user.uid);
    // Data is now in place on this device — safe for app.js's init() to run.
    if (window.__cindyResolveAuthReady) window.__cindyResolveAuthReady();
  });
})();
