/* ===== CINDY — Storage Shim =====
 * Why this exists: inside the Capacitor Android WebView, plain
 * window.localStorage is NOT reliable persistent storage. Capacitor's own
 * docs call it "transient" — the OS can reclaim it, and it has been
 * reported to clear on every app close on some Android/WebView versions.
 * That's the actual cause of "เซฟไม่อยู่" (progress not saving).
 *
 * Fix: keep every existing localStorage.getItem/setItem/removeItem call in
 * app.js exactly as-is (so nothing else needs to change), but back it with
 * @capacitor/preferences, which writes to real Android SharedPreferences /
 * iOS UserDefaults and survives app restarts. An in-memory cache keeps
 * reads synchronous; writes are mirrored to Preferences in the background.
 *
 * On plain web (browser preview, no Capacitor) this is a no-op — the real
 * localStorage is left untouched, so testing in a normal browser still
 * works exactly like before.
 *
 * app.js must wait for window.__cindyStorageReady to resolve before it
 * reads anything from storage (see the DOMContentLoaded gating in app.js).
 */
(function () {
  const isNative = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
  const Prefs = isNative && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences;

  if (!isNative || !Prefs) {
    // Web preview, or the Preferences plugin isn't installed/synced yet —
    // fall back to real localStorage so nothing breaks.
    window.__cindyStorageReady = Promise.resolve();
    return;
  }

  const cache = Object.create(null);

  const shim = {
    getItem(key) {
      return Object.prototype.hasOwnProperty.call(cache, key) ? cache[key] : null;
    },
    setItem(key, value) {
      const v = String(value);
      cache[key] = v;
      Prefs.set({ key, value: v }).catch(err => console.error('[storage] set failed:', key, err));
    },
    removeItem(key) {
      delete cache[key];
      Prefs.remove({ key }).catch(err => console.error('[storage] remove failed:', key, err));
    },
    clear() {
      Object.keys(cache).forEach(k => delete cache[k]);
      Prefs.clear().catch(err => console.error('[storage] clear failed:', err));
    },
    key(i) {
      return Object.keys(cache)[i] || null;
    },
    get length() {
      return Object.keys(cache).length;
    }
  };

  try {
    Object.defineProperty(window, 'localStorage', { value: shim, configurable: true });
  } catch (e) {
    console.error('[storage] could not install shim, falling back to native localStorage:', e);
    window.__cindyStorageReady = Promise.resolve();
    return;
  }

  // Hydrate the cache from Preferences before the app is allowed to read
  // anything, so the very first render already has last session's data.
  window.__cindyStorageReady = Prefs.keys()
    .then(({ keys }) => Promise.all(keys.map(key =>
      Prefs.get({ key }).then(({ value }) => {
        if (value !== null && value !== undefined) cache[key] = value;
      })
    )))
    .catch(err => console.error('[storage] hydrate failed:', err));
})();
