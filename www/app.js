/* ===== CINDY — App Logic ===== */
const RING_CIRC = 2 * Math.PI * 108;
const KEY_SESSIONS = 'cindy_sessions';
const KEY_ACTIVE = 'cindy_active_workout';
const KEY_LAST_SEEN_LEVEL = 'cindy_last_seen_level';
const KEY_CHARACTER_NAME = 'cindy_character_name';
const KEY_RUN_SESSIONS = 'cindy_run_sessions';
const KEY_RUN_ACTIVE = 'cindy_run_active';

/* ================= SCHEMA / MIGRATIONS =================
 * Single version stamp in localStorage + a chokepoint that runs once per
 * app load. Future fields get backfilled onto old data here instead of at
 * every save/load call site — keeps the fragility in one place instead of
 * scattered across the many localStorage touches in this file.
 * Each migration must be idempotent (safe to re-run) since a stamp write
 * failing mid-way must not corrupt anything on retry. */
const KEY_SCHEMA_VERSION = 'cindy_schema_version';
const CURRENT_SCHEMA_VERSION = 2;

/* v2 flag — Phase 2B redefined Combat Power (see computeCombatPower) so
 * it stops double-counting reps that already feed the stat levels. That
 * makes the number on screen drop for anyone who already had progress,
 * even though nothing about their actual training changed. This flag
 * just marks "explain that once" — the explanation itself is shown by
 * maybeShowCPPatchNote(), called from init(), not here, since a toast
 * needs the UI mounted and can't fire during a migration pass. */
const KEY_CP_PATCHNOTE_V1_PENDING = 'cindy_cp_patchnote_v1_pending';

const MIGRATIONS = [
  {
    version: 1,
    run: () => {
      // Baseline stamp for everyone who already has data from before
      // versioning existed. No data changes yet — this just establishes
      // the starting point. Future migrations (v2, v3, ...) go here as
      // new entries, e.g. backfilling a new field on old sessions:
      //
      // const sessions = loadSessions();
      // let changed = false;
      // sessions.forEach(s => { if (s.newField === undefined) { s.newField = defaultVal; changed = true; } });
      // if (changed) saveSessions(sessions);
    }
  },
  {
    version: 2,
    run: () => {
      // Only worth explaining to players who already have some XP —
      // a brand-new player has never seen a Combat Power number yet,
      // so there's nothing for them to notice "dropping".
      if (computeTotalXP() > 0) {
        localStorage.setItem(KEY_CP_PATCHNOTE_V1_PENDING, '1');
      }
    }
  },
];

function runMigrationsIfNeeded() {
  let stored = parseInt(localStorage.getItem(KEY_SCHEMA_VERSION), 10);
  if (!Number.isFinite(stored)) stored = 0;
  if (stored >= CURRENT_SCHEMA_VERSION) return;

  MIGRATIONS
    .filter(m => m.version > stored)
    .sort((a, b) => a.version - b.version)
    .forEach(m => {
      try { m.run(); }
      catch (e) { console.error('Migration ' + m.version + ' failed:', e); }
      localStorage.setItem(KEY_SCHEMA_VERSION, String(m.version));
    });
}

/* ================= PIN LOCK =================
 * This app has no server-side auth of its own — data lives in localStorage
 * and syncs via the player's Google account. So the PIN below is NOT a bank-
 * grade security boundary; it exists only to stop someone else who picks up
 * the phone from casually browsing/editing/wiping the player's data. That's
 * why there's deliberately no lockout on wrong attempts (see product Q&A):
 * the threat model is "someone in the same room", not a brute-force attacker,
 * and a lockout would just be a way to get *yourself* locked out.
 *
 * Storage: only a SHA-256 hash of the PIN is ever persisted, never the PIN
 * itself. Losing the PIN is unrecoverable by design (no server holds it),
 * so the only way back in is proving you're still you via Google — see
 * reauthenticateWithGoogle() below, which defers to a hook that firebase-
 * auth.js is expected to provide.
 *
 * Gating points (per product spec): app open/resume after backgrounding,
 * editing or deleting workout history (Cindy + Custom), resetting the
 * character, and importing a backup file. Each call site wraps its real
 * implementation with requirePin(label, fn) below — see the *Impl renames
 * near those features. */
const KEY_PIN_HASH = 'cindy_pin_hash';
const KEY_PIN_LAST_ACTIVE = 'cindy_pin_last_active_ts';
const PIN_LOCK_TIMEOUT_MS = 2 * 60 * 1000; // background >2min => re-lock

async function sha256Hex(str) {
  const enc = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest('SHA-256', enc);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function hasPinSet() {
  return !!localStorage.getItem(KEY_PIN_HASH);
}
async function setPinHash(pin) {
  localStorage.setItem(KEY_PIN_HASH, await sha256Hex(pin));
}
async function verifyPinValue(pin) {
  const stored = localStorage.getItem(KEY_PIN_HASH);
  if (!stored) return true; // no PIN set => nothing to check
  return (await sha256Hex(pin)) === stored;
}
function clearPinHash() {
  localStorage.removeItem(KEY_PIN_HASH);
  localStorage.removeItem(KEY_PIN_LAST_ACTIVE);
}
function touchPinActivity() {
  localStorage.setItem(KEY_PIN_LAST_ACTIVE, String(Date.now()));
}

/* ---- shared numeric keypad (used by lock screen, gate modal, setup modal) ---- */
let _pinBuf = '';
function setupPinPad(dotsId, keypadId, onComplete) {
  _pinBuf = '';
  updatePinDots(dotsId);
  const el = document.getElementById(keypadId);
  if (!el) return;
  el.innerHTML = '';
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', '⌫'];
  keys.forEach(k => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'pin-key' + (k === '' ? ' pin-key-blank' : '');
    b.textContent = k;
    if (k === '') {
      b.disabled = true;
    } else {
      b.onclick = () => {
        if (k === '⌫') { _pinBuf = _pinBuf.slice(0, -1); }
        else if (_pinBuf.length < 4) { _pinBuf += k; }
        updatePinDots(dotsId);
        if (_pinBuf.length === 4) {
          const val = _pinBuf;
          _pinBuf = '';
          setTimeout(() => onComplete(val), 80); // let the last dot render before advancing
        }
      };
    }
    el.appendChild(b);
  });
}
function updatePinDots(dotsId) {
  const el = document.getElementById(dotsId);
  if (!el) return;
  el.innerHTML = '';
  for (let i = 0; i < 4; i++) {
    const d = document.createElement('div');
    d.className = 'pin-dot' + (i < _pinBuf.length ? ' filled' : '');
    el.appendChild(d);
  }
}
function shakePinDots(dotsId) {
  const el = document.getElementById(dotsId);
  if (!el) return;
  el.classList.add('pin-shake');
  setTimeout(() => el.classList.remove('pin-shake'), 400);
}

/* ---- app-lock screen (open/resume) ---- */
function maybeShowAppLock() {
  if (!hasPinSet()) return;
  const last = parseInt(localStorage.getItem(KEY_PIN_LAST_ACTIVE), 10);
  const locked = !Number.isFinite(last) || (Date.now() - last) > PIN_LOCK_TIMEOUT_MS;
  if (locked) showPinLockScreen();
}
function showPinLockScreen() {
  const scr = document.getElementById('pinLockScreen');
  if (!scr) return;
  scr.classList.add('active');
  armPinLockPad();
}
function armPinLockPad() {
  setupPinPad('pinLockDots', 'pinLockKeypad', onPinLockAttempt);
}
async function onPinLockAttempt(pin) {
  const ok = await verifyPinValue(pin);
  if (ok) {
    touchPinActivity();
    document.getElementById('pinLockScreen').classList.remove('active');
  } else {
    shakePinDots('pinLockDots');
    showToast('PIN ไม่ถูกต้อง');
    armPinLockPad();
  }
}

/* ---- generic action gate (edit/delete history, reset character, import) ---- */
let _pinGateOnSuccess = null;
function requirePin(actionLabel, onSuccess) {
  if (!hasPinSet()) { onSuccess(); return; }
  const body = document.getElementById('pinGateBody');
  if (body) body.textContent = actionLabel || 'การทำรายการนี้ต้องยืนยันตัวตนด้วย PIN';
  _pinGateOnSuccess = onSuccess;
  document.getElementById('pinGateModal').classList.add('active');
  armPinGatePad();
}
function armPinGatePad() {
  setupPinPad('pinGateDots', 'pinGateKeypad', onPinGateAttempt);
}
async function onPinGateAttempt(pin) {
  const ok = await verifyPinValue(pin);
  if (ok) {
    closeModal('pinGateModal');
    const fn = _pinGateOnSuccess;
    _pinGateOnSuccess = null;
    if (fn) fn();
  } else {
    shakePinDots('pinGateDots');
    showToast('PIN ไม่ถูกต้อง');
    armPinGatePad();
  }
}
function cancelPinGate() {
  _pinGateOnSuccess = null;
  closeModal('pinGateModal');
}

/* ---- forgot PIN: re-auth with Google, then force a fresh PIN ----
 * firebase-auth.js is expected to expose:
 *   window.__cindyReauthWithGoogle = async () => boolean
 * which re-prompts Google sign-in (e.g. reauthenticateWithPopup with
 * GoogleAuthProvider) for the already-signed-in account and resolves true
 * only on a successful, matching re-auth. Without that hook wired up, the
 * forgot-PIN flow can't safely verify identity, so it fails closed. */
async function reauthenticateWithGoogle() {
  if (typeof window.__cindyReauthWithGoogle === 'function') {
    try { return !!(await window.__cindyReauthWithGoogle()); }
    catch (e) { console.error('[pin] Google re-auth failed:', e); return false; }
  }
  console.warn('[pin] window.__cindyReauthWithGoogle is not defined by firebase-auth.js');
  return false;
}
async function startPinForgotFlow() {
  document.getElementById('pinGateModal').classList.remove('active');
  showToast('กำลังยืนยันตัวตนผ่าน Google...');
  const ok = await reauthenticateWithGoogle();
  if (ok) {
    clearPinHash();
    _pinGateOnSuccess = null;
    document.getElementById('pinLockScreen').classList.remove('active');
    showToast('ยืนยันตัวตนสำเร็จ ตั้ง PIN ใหม่ได้เลย');
    openPinSetupModal(true);
  } else {
    showToast('ยืนยันตัวตนไม่สำเร็จ ลองใหม่อีกครั้ง');
    if (hasPinSet()) showPinLockScreen();
  }
}

/* ---- set / change PIN (from Character > ความปลอดภัย) ---- */
let _pinSetupStage = 'new'; // 'current' -> 'new' -> 'confirm'
let _pinSetupFirstEntry = '';
function openPinSetupModal(skipCurrentCheck) {
  document.getElementById('pinSetupModal').classList.add('active');
  _pinSetupFirstEntry = '';
  if (!skipCurrentCheck && hasPinSet()) {
    _pinSetupStage = 'current';
    setPinSetupCopy('ยืนยัน PIN เดิม', 'ใส่ PIN ปัจจุบันก่อนตั้งค่าใหม่');
  } else {
    _pinSetupStage = 'new';
    setPinSetupCopy('ตั้ง PIN ใหม่', 'ตั้ง PIN 4 หลักเพื่อป้องกันไม่ให้คนอื่นแก้ไขข้อมูลของคุณ');
  }
  armPinSetupPad();
}
function setPinSetupCopy(title, body) {
  document.getElementById('pinSetupTitle').textContent = title;
  document.getElementById('pinSetupBody').textContent = body;
}
function armPinSetupPad() {
  setupPinPad('pinSetupDots', 'pinSetupKeypad', onPinSetupDigitEntered);
}
async function onPinSetupDigitEntered(pin) {
  if (_pinSetupStage === 'current') {
    const ok = await verifyPinValue(pin);
    if (!ok) { shakePinDots('pinSetupDots'); showToast('PIN เดิมไม่ถูกต้อง'); armPinSetupPad(); return; }
    _pinSetupStage = 'new';
    setPinSetupCopy('ตั้ง PIN ใหม่', 'ตั้ง PIN 4 หลัก');
    armPinSetupPad();
    return;
  }
  if (_pinSetupStage === 'new') {
    _pinSetupFirstEntry = pin;
    _pinSetupStage = 'confirm';
    setPinSetupCopy('ยืนยัน PIN อีกครั้ง', 'ใส่ PIN เดิมอีกครั้งเพื่อยืนยัน');
    armPinSetupPad();
    return;
  }
  // confirm
  if (pin !== _pinSetupFirstEntry) {
    shakePinDots('pinSetupDots');
    showToast('PIN ไม่ตรงกัน ลองใหม่');
    _pinSetupStage = 'new';
    setPinSetupCopy('ตั้ง PIN ใหม่', 'ตั้ง PIN 4 หลัก');
    armPinSetupPad();
    return;
  }
  await setPinHash(pin);
  touchPinActivity();
  closeModal('pinSetupModal');
  showToast('ตั้งค่า PIN เรียบร้อย');
  renderPinSettingsUI();
}
function confirmDisablePin() {
  requirePin('ใส่ PIN เดิมเพื่อปิดการใช้งาน PIN', () => {
    clearPinHash();
    showToast('ปิดการใช้ PIN แล้ว');
    renderPinSettingsUI();
  });
}
function handlePinActionBtn() {
  openPinSetupModal(false);
}
function renderPinSettingsUI() {
  const statusText = document.getElementById('pinStatusText');
  const actionBtn = document.getElementById('pinActionBtn');
  const disableBtn = document.getElementById('pinDisableBtn');
  if (!statusText || !actionBtn || !disableBtn) return;
  if (hasPinSet()) {
    statusText.textContent = 'เปิดใช้งานอยู่';
    actionBtn.textContent = 'เปลี่ยน PIN';
    disableBtn.style.display = '';
  } else {
    statusText.textContent = 'ยังไม่ได้ตั้งค่า';
    actionBtn.textContent = 'ตั้งค่า';
    disableBtn.style.display = 'none';
  }
}

/* ================= ICON SET =================
 * Small inline SVG icons (stroke-based, same visual language as the header
 * icon buttons already in the HTML) used in place of emoji for the small,
 * recurring UI icons across the app — locks, checkmarks, the skin/chest
 * buttons, play/pause, and rank badges. Sized via the wrapping element's
 * font-size (icons use 1em/1em + currentColor), so no separate width/height
 * bookkeeping is needed at each call site.
 * Out of scope on purpose: the PR share-image canvas text and the in-app
 * "COMBO MAX" flourish keep their plain glyphs — those render straight to
 * canvas / are one-off text accents, not reusable UI or reward art. */
const ICONS = {
  lock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7a4 4 0 018 0v4"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>',
  palette: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a9 9 0 100 18c1.4 0 2-1.1 1.2-2.2-.5-.7-.1-1.8 1-1.8H16a5 5 0 005-5c0-5-4.5-9-9-9z"/><circle cx="7.7" cy="10.5" r="1.15" fill="currentColor" stroke="none"/><circle cx="12" cy="7.3" r="1.15" fill="currentColor" stroke="none"/><circle cx="16.1" cy="10" r="1.15" fill="currentColor" stroke="none"/><circle cx="9.3" cy="15" r="1.15" fill="currentColor" stroke="none"/></svg>',
  gift: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="8" width="18" height="4" rx="1"/><rect x="4" y="12" width="16" height="9" rx="1"/><path d="M12 8v13"/><path d="M12 8C10.5 4.5 6.5 4.5 6.5 6.9c0 1.5 2 1.1 5.5 1.1z"/><path d="M12 8c1.5-3.5 5.5-3.9 5.5-1.1 0 1.5-2 1.1-5.5 1.1z"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.2v13.6c0 .8.9 1.3 1.6.9l10.9-6.8a1 1 0 000-1.7L9.6 4.3C8.9 3.9 8 4.4 8 5.2z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4.5" height="14" rx="1.2"/><rect x="13.5" y="5" width="4.5" height="14" rx="1.2"/></svg>',
  rankRecruit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5.5c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6z"/></svg>',
  rankFighter: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5.5c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6z"/><path d="M9 12l2 2 4-4"/></svg>',
  rankWarrior: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12L12 4l2 2-8 8z"/><path d="M20 12L12 4l-2 2 8 8z"/><path d="M9 9l6 6"/><path d="M4 20l3-3M20 20l-3-3"/></svg>',
  rankElite: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v5.5c0 4.6-3 7.6-7 9-4-1.4-7-4.4-7-9V6z"/><path d="M12 8l1.1 2.3 2.5.3-1.8 1.8.4 2.5-2.2-1.2-2.2 1.2.4-2.5-1.8-1.8 2.5-.3z" fill="currentColor" stroke="none"/></svg>',
  rankLegend: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8.5l3.3 2.8L12 5l4.7 6.3 3.3-2.8-1.6 9.5H5.6z"/><path d="M6 19.5h12"/></svg>',
  speakerOn: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 8.5a5 5 0 010 7"/><path d="M19.8 6a9 9 0 010 12"/></svg>',
  speakerOff: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9l5 6M21 9l-5 6"/></svg>',
  target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
  web: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M12 3v18M4 7l16 10M20 7L4 17M2 12h20"/><path d="M12 3a13 13 0 00-5.5 4M12 3a13 13 0 015.5 4M2 12a13 13 0 004 6M22 12a13 13 0 01-4 6"/></svg>',
  muscle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 13c0-2 1.3-3 3-3 .3-1.6 1.4-2.5 3-2.5 2 0 3 1.3 3 3.2V15c1.6-1 2.6-.7 3.4.3.5-2 1.7-3 3.6-3 2.3 0 4 1.8 4 4.3 0 3-2.3 5.2-5.6 5.2H8.4C4.8 21.8 2 19 2 15.3z"/></svg>',
  bolt: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L4 14h6l-1 8 10-13h-6z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11"/><path d="M8 11l4 4 4-4"/><path d="M5 19h14"/></svg>',
  refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12a8 8 0 0114-5.3"/><path d="M20 12a8 8 0 01-14 5.3"/><path d="M18 3v4.5h-4.5"/><path d="M6 21v-4.5h4.5"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16"/><path d="M9 7V4.5a1 1 0 011-1h4a1 1 0 011 1V7"/><path d="M6 7l1 13a2 2 0 002 2h6a2 2 0 002-2l1-13"/><path d="M10 11v6M14 11v6"/></svg>',
  navHome: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11.5L12 4l8 7.5"/><path d="M6 10v9a1 1 0 001 1h3v-5h4v5h3a1 1 0 001-1v-9"/></svg>',
  navProgram: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="9.5" width="3" height="5" rx="1"/><rect x="19" y="9.5" width="3" height="5" rx="1"/><rect x="6" y="7.5" width="2.5" height="9" rx="1"/><rect x="15.5" y="7.5" width="2.5" height="9" rx="1"/><path d="M8.5 12h7"/></svg>',
  navHistory: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3.5h11a2 2 0 012 2V19a2 2 0 01-2 2H8a2 2 0 01-2-2z"/><path d="M6 3.5a2 2 0 00-2 2v13a2 2 0 002 2"/><path d="M9 8h7M9 12h7M9 16h4"/></svg>',
  navProgress: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 18l6-6 4 4 8-9"/><path d="M15 6h6v6"/></svg>'
};
/** Wraps a named icon in an inline span sized/colored by its context (font-
 * size + color/currentColor), so it drops into text flow like the emoji it
 * replaces. */
function iconHtml(name, cls) {
  return '<span class="icon-inline' + (cls ? ' ' + cls : '') + '">' + (ICONS[name] || '') + '</span>';
}

/* ================= BADGE / REWARD ART =================
 * Filled glyphs used inside a .gem-badge disc (see CSS) for collectible,
 * "you earned this" surfaces: streak-chest medals and mascot skin gear.
 * Kept separate from ICONS above because these are solid/fill shapes
 * meant to sit on a colored badge, not currentColor line icons meant to
 * sit in text. */
const BADGE_ICONS = {
  star: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.85 6.32 6.9.68-5.22 4.66 1.55 6.84L12 17.6l-6.08 3.4 1.55-6.84L2.25 9.5l6.9-.68z"/></svg>',
  gem: '<svg viewBox="0 0 24 24"><path d="M5 3h14l4 6-11 12L1 9z" fill="currentColor"/><path d="M5 3l2.5 6M19 3l-2.5 6M1 9h22M9.5 9L12 21l2.5-12" stroke="rgba(0,0,0,.28)" stroke-width="1" fill="none" stroke-linejoin="round"/></svg>',
  trophy: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 3h12v4a6 6 0 01-5 5.92V16h2.5a1 1 0 011 1v1H7.5v-1a1 1 0 011-1H11v-3.08A6 6 0 016 7V3z"/><path d="M6 4H2.5v1.5A4 4 0 006 9.4V7a5 5 0 010-.5V4z" opacity=".85"/><path d="M18 4h3.5v1.5A4 4 0 0118 9.4V7a5 5 0 000-.5V4z" opacity=".85"/><rect x="7" y="19" width="10" height="2" rx="1"/></svg>',
  scarf: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M4 5c1.8 2 4.4 2.4 8 1.4C16 5.4 18 6 19 8c-1.6.2-2.7 1.1-3 2.6-.3 1.6.6 2.6 2 3.4-2 .6-3.4-.1-4.4-1.6-1-1.5-2.6-1.7-4.3-1-1.7.7-2.8 2.4-2.3 4.6.4-1.4 1.4-2 2.6-1.7-1 1.6-.7 3 .8 4.2-2.6.2-4.2-1-4.9-3.4-.5-1.8.1-3.3 1.4-4.2-1.8-.3-3-1.5-3.4-3.4C3 6.5 3.3 5.6 4 5z"/></svg>',
  mitten: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 3a3 3 0 013 3v3.2c1.6-1.6 3-2.2 4.3-1.8 1.4.4 2.2 1.7 2.2 3.4 0 1-.3 1.8-1 2.6l-3.6 4.1c-.9 1-2.1 1.5-3.5 1.5H8a5 5 0 01-5-5V8a3 3 0 013-3h2z"/></svg>',
  shield: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l7.5 3v5.6c0 5-3.2 8.3-7.5 9.9-4.3-1.6-7.5-4.9-7.5-9.9V5.5z"/><path d="M9.2 12.1l1.9 1.9 3.7-3.9" fill="none" stroke="rgba(0,0,0,.35)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  crown: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 8l4 3 5-6 5 6 4-3-1.6 9.5H4.6z"/><rect x="4.8" y="18.3" width="14.4" height="2.2" rx="1"/></svg>',
  boxGlove: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 3a3 3 0 013 3v3.4c1.7-1.9 3.2-2.6 4.6-2 1.4.5 2.2 2 2 3.8-.1 1.2-.6 2-1.4 2.8l-3.5 3.4c-1 1-2.3 1.6-3.7 1.6H9a5 5 0 01-5-5V6a3 3 0 013-3h2z"/><rect x="2.3" y="15" width="4.4" height="6.2" rx="1.6"/></svg>',
  gi: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 2.5L12 5l3-2.5 4.5 3-2 3.4-1.8-1V21H8.3V7.9l-1.8 1-2-3.4z"/><path d="M9.5 9.5l2.5 2.5 2.5-2.5" fill="none" stroke="rgba(0,0,0,.3)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  swordsCross: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4l7 7M11 11l-7 7M4 4l2.5-.3M4 4l.3 2.5"/><path d="M20 4l-7 7M13 11l7 7M20 4l-2.5-.3M20 4l-.3 2.5"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
  flame: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2c1 3-2.5 4.2-2.5 7.3 0 1.2.8 2 1.8 2.1-.6-1.4.2-2.6 1.1-3.3.2 1.4 1 2 1.9 2.9 1.1 1.1 1.7 2.3 1.7 3.8 0 3.4-2.9 6.2-6.5 6.2S2 17.9 2 14.5c0-3.6 2.6-5.6 4.6-8 1.6-1.9 2.8-2.9 5.4-4.5z"/></svg>',
  gearCog: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 8.2a3.8 3.8 0 100 7.6 3.8 3.8 0 000-7.6zm9.2 2.6l-1.9-.3a7.4 7.4 0 00-.7-1.7l1.1-1.6-2-2-1.6 1.1a7.4 7.4 0 00-1.7-.7l-.3-1.9h-2.8l-.3 1.9a7.4 7.4 0 00-1.7.7L7.7 4.7l-2 2 1.1 1.6a7.4 7.4 0 00-.7 1.7l-1.9.3v2.8l1.9.3c.15.6.4 1.2.7 1.7l-1.1 1.6 2 2 1.6-1.1c.5.3 1.1.55 1.7.7l.3 1.9h2.8l.3-1.9c.6-.15 1.2-.4 1.7-.7l1.6 1.1 2-2-1.1-1.6c.3-.5.55-1.1.7-1.7l1.9-.3z"/></svg>',
  fang: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 2.5c3-1 9-1 12 0 2 3.2 1.6 7-1 9.6L15 21l-2-6.2c-.3-.9-1.7-.9-2 0L9 21l-2-8.9C4.4 9.5 4 5.7 6 2.5z"/></svg>',
  vortex: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 12c-4-3-8-1-8 3s4 5 7 3-1-6-4-4"/><path d="M12 12c4-3 8-1 8 3s-4 5-7 3 1-6 4-4"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/></svg>',
  wing: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21c-1-4.5-.5-9 1-13.5C14.5 3 17.5 1.6 21 2c-1.3 2.6-1.2 4.7.2 6.7-2.2-.4-3.6.2-4.6 2 1.9.1 3 .9 3.7 2.6-2-.3-3.3.3-4.2 2 1.6.2 2.6 1 3.1 2.5-2.2 0-3.8-.6-5.1-2-.6 2.1-1.2 3.8-2.1 5.2z"/></svg>',
  core: '<svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="12" r="7"/><path d="M12 5v14M5 12h14M7.5 7.5l9 9M16.5 7.5l-9 9" stroke="rgba(255,255,255,.35)" stroke-width="1" fill="none"/></svg>',
  tank: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 3.3c1.1 1.4 2.5 2.1 5 2.1s3.9-.7 5-2.1l2.6 2.7-1.9 2.6-1.2-.75V21H8.5V7.85l-1.2.75-1.9-2.6z"/></svg>'
};
/** Builds a small enamel-pin style badge: a two-tone metallic/gem disc
 * (sized via the caller's font-size, same 1em convention as .icon-inline)
 * with a filled glyph centered on it. c1/c2 are the gradient's light→base
 * stops; opts.glow adds an outer glow (opts.glowColor overrides its
 * color), opts.ring adds a thin inner rim, opts.cls appends extra classes. */
function badgeHtml(iconName, c1, c2, opts) {
  opts = opts || {};
  const cls = 'gem-badge' + (opts.glow ? ' badge-glow' : '') + (opts.ring ? ' badge-ring' : '') + (opts.cls ? ' ' + opts.cls : '');
  const style = '--badge-c1:' + c1 + ';--badge-c2:' + c2 + ';--badge-glow:' + (opts.glowColor || c2) + ';';
  return '<span class="' + cls + '" style="' + style + '">' + (BADGE_ICONS[iconName] || '') + '</span>';
}
/** Grey/locked variant of the same badge shell, used where a collectible
 * hasn't been earned yet (replaces the old "❔" placeholder). */
function lockedBadgeHtml() {
  return '<span class="gem-badge badge-locked" style="--badge-c1:#565b6c;--badge-c2:#23252f;">' + ICONS.lock + '</span>';
}
/** Same .gem-badge coin shell as badgeHtml(), but crops the loot item's own
 * illustrated art into the disc instead of a BADGE_ICONS glyph — used only
 * for the small "worn on the mascot" surfaces (corner badge, equip slot
 * icon) where there isn't room for the full artwork. The rarity gradient
 * still shows as a rim around the cropped art. Collection grid + item
 * detail popup use the full image directly instead of this. */
function lootBadgeHtml(item, opts) {
  opts = opts || {};
  const rarity = rarityDef(item.rarity);
  const cls = 'gem-badge' + (opts.glow ? ' badge-glow' : '') + (opts.ring ? ' badge-ring' : '');
  const style = '--badge-c1:' + rarity.c1 + ';--badge-c2:' + rarity.c2 + ';--badge-glow:' + rarity.glow + ';';
  return '<span class="' + cls + '" style="' + style + '"><img class="gem-badge-art" src="' + item.img + '" alt="" /></span>';
}
/** Renders a skin's custom-designed medallion icon (skin.icon) in the same
 * 1em-box hook the old badgeHtml(skin.accIcon,...) glyphs used, so it drops
 * into every existing SKIN slot/corner-badge/trophy spot with no layout
 * changes. The artwork already includes its own metal rim + gems, so unlike
 * gem-badge it has no separate ring/gradient shell — opts.glow adds an
 * outer drop-shadow tinted to the skin's own aura color to match how the
 * old badge's glow worked. Falls back to the old vector badge for any skin
 * that doesn't have custom art yet. */
function skinIconHtml(skin, opts) {
  opts = opts || {};
  if (!skin.icon) return badgeHtml(skin.accIcon, skin.accC1, skin.accC2, opts);
  const cls = 'skin-icon-badge' + (opts.glow ? ' skin-icon-glow' : '') + (opts.cls ? ' ' + opts.cls : '');
  const style = '--skin-icon-glow:' + (skin.aura || 'rgba(255,255,255,.55)') + ';';
  return '<span class="' + cls + '" style="' + style + '"><img src="' + skin.icon + '" alt="" /></span>';
}

/* ---- streak milestone treasure chests ---- */
const STREAK_MILESTONES = [7, 14, 30, 100];
const KEY_STREAK_CHESTS_OPENED = 'cindy_streak_chests_opened';

/* ================= PROTOCOL LIBRARY ================= */
/* A "protocol" is a saved WOD prescription: either an AMRAP (fixed reps/round,
   racing the clock for max rounds) or an EMOM (fixed reps, auto-advancing every
   interval). Built-ins ship with the app and can't be edited/deleted; custom
   ones are user-created and stored in localStorage. */
const KEY_PROTOCOLS = 'cindy_protocols';
const KEY_ACTIVE_PROTOCOL = 'cindy_active_protocol_id';

const BUILTIN_PROTOCOLS = [
  { id: 'builtin_cindy', builtin: true, name: 'Cindy (Classic)', mode: 'amrap', pull: 5, push: 10, squat: 15, durationMin: 20 },
  { id: 'builtin_quickcindy', builtin: true, name: 'Quick Cindy', mode: 'amrap', pull: 3, push: 6, squat: 9, durationMin: 12 },
  { id: 'builtin_heavycindy', builtin: true, name: 'Heavy Cindy', mode: 'amrap', pull: 8, push: 15, squat: 20, durationMin: 25 },
  { id: 'builtin_emom', builtin: true, name: 'EMOM Starter', mode: 'emom', pull: 3, push: 6, squat: 9, emomIntervalSec: 60, emomRounds: 20 }
];

function loadCustomProtocols() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_PROTOCOLS));
    if (Array.isArray(saved)) return saved;
  } catch (e) {}
  return [];
}
function saveCustomProtocols(list) {
  localStorage.setItem(KEY_PROTOCOLS, JSON.stringify(list));
}
function allProtocols() {
  return BUILTIN_PROTOCOLS.concat(loadCustomProtocols());
}
function loadActiveProtocolId() {
  return localStorage.getItem(KEY_ACTIVE_PROTOCOL) || 'builtin_cindy';
}
function getActiveProtocol() {
  const id = loadActiveProtocolId();
  return allProtocols().find(p => p.id === id) || BUILTIN_PROTOCOLS[0];
}
function selectProtocol(id) {
  localStorage.setItem(KEY_ACTIVE_PROTOCOL, id);
  applyActiveProtocolToRuntime();
  applyProtocolToUI();
  renderProtocolList();
  showToast('ตั้งเป็นโปรโตคอลปัจจุบันแล้ว');
}

/* runtime state derived from the active protocol */
let ACTIVE_PROTOCOL, MODE, CONFIG, REPS, DURATION_MS, EMOM_INTERVAL_MS, EMOM_ROUNDS;
function applyActiveProtocolToRuntime() {
  ACTIVE_PROTOCOL = getActiveProtocol();
  MODE = ACTIVE_PROTOCOL.mode || 'amrap';
  REPS = { pull: ACTIVE_PROTOCOL.pull, push: ACTIVE_PROTOCOL.push, squat: ACTIVE_PROTOCOL.squat };
  if (MODE === 'emom') {
    EMOM_INTERVAL_MS = (ACTIVE_PROTOCOL.emomIntervalSec || 60) * 1000;
    EMOM_ROUNDS = ACTIVE_PROTOCOL.emomRounds || 20;
    DURATION_MS = EMOM_INTERVAL_MS * EMOM_ROUNDS;
    CONFIG = { pull: REPS.pull, push: REPS.push, squat: REPS.squat, durationMin: Math.round(DURATION_MS / 60000) };
  } else {
    CONFIG = { pull: ACTIVE_PROTOCOL.pull, push: ACTIVE_PROTOCOL.push, squat: ACTIVE_PROTOCOL.squat, durationMin: ACTIVE_PROTOCOL.durationMin || 20 };
    DURATION_MS = CONFIG.durationMin * 60 * 1000;
  }
}
applyActiveProtocolToRuntime();

function applyProtocolToUI() {
  const heroEyebrow = document.getElementById('heroEyebrow');
  const heroTitle = document.getElementById('heroTitle');
  if (heroEyebrow) heroEyebrow.textContent = MODE === 'emom'
    ? 'EMOM ' + EMOM_ROUNDS + ' × ' + Math.round(EMOM_INTERVAL_MS / 1000) + 's'
    : CONFIG.durationMin + ' MIN AMRAP';
  if (heroTitle) heroTitle.textContent = CONFIG.pull + ' PULL-UP · ' + CONFIG.push + ' PUSH-UP · ' + CONFIG.squat + ' SQUAT';
  const protoPullN = document.getElementById('protoPullN');
  const protoPushN = document.getElementById('protoPushN');
  const protoSquatN = document.getElementById('protoSquatN');
  if (protoPullN) protoPullN.textContent = CONFIG.pull;
  if (protoPushN) protoPushN.textContent = CONFIG.push;
  if (protoSquatN) protoSquatN.textContent = CONFIG.squat;
  const repPull = document.getElementById('repPull');
  const repPush = document.getElementById('repPush');
  const repSquat = document.getElementById('repSquat');
  if (repPull) repPull.textContent = CONFIG.pull;
  if (repPush) repPush.textContent = CONFIG.push;
  if (repSquat) repSquat.textContent = CONFIG.squat;
  const timerDigits = document.getElementById('timerDigits');
  if (timerDigits && !loadActive()) {
    timerDigits.textContent = MODE === 'emom' ? fmtTime(EMOM_INTERVAL_MS / 1000) : fmtTime(CONFIG.durationMin * 60);
  }
  const protocolNameEl = document.getElementById('activeProtocolName');
  if (protocolNameEl) protocolNameEl.textContent = ACTIVE_PROTOCOL.name;
}

/* ---- protocol library screen ---- */
function openSettingsModal() {
  renderProtocolList();
  document.getElementById('settingsModal').classList.add('active');
}
function renderProtocolList() {
  const wrap = document.getElementById('protocolList');
  if (!wrap) return;
  const activeId = loadActiveProtocolId();
  wrap.innerHTML = allProtocols().map(p => {
    const detail = p.mode === 'emom'
      ? 'EMOM · ' + p.pull + '/' + p.push + '/' + p.squat + ' · ' + p.emomRounds + '×' + p.emomIntervalSec + 's'
      : 'AMRAP · ' + p.pull + '/' + p.push + '/' + p.squat + ' · ' + p.durationMin + ' min';
    return `<div class="history-item protocol-item${p.id === activeId ? ' sel' : ''}" onclick="selectProtocol('${p.id}')">
      <div>
        <div class="date">${escapeHtml(p.name)}${p.id === activeId ? ' <span class="proto-active-tag">ปัจจุบัน</span>' : ''}</div>
        <div class="reps">${detail}</div>
      </div>
      <div style="display:flex;gap:6px;">
        ${p.builtin ? '' : `<button class="iconbtn" style="width:32px;height:32px;" onclick="event.stopPropagation();openProtocolEditor('${p.id}')" aria-label="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
        </button>
        <button class="iconbtn" style="width:32px;height:32px;color:var(--danger);" onclick="event.stopPropagation();deleteProtocol('${p.id}')" aria-label="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6"/></svg>
        </button>`}
      </div>
    </div>`;
  }).join('');
}
function deleteProtocol(id) {
  if (id === loadActiveProtocolId()) { showToast('ลบไม่ได้ กำลังใช้งานอยู่ — สลับไปโปรโตคอลอื่นก่อน'); return; }
  const list = loadCustomProtocols().filter(p => p.id !== id);
  saveCustomProtocols(list);
  renderProtocolList();
  showToast('ลบโปรโตคอลแล้ว');
}

/* ---- create / edit a custom protocol ---- */
let editingProtocolId = null;
function openProtocolEditor(id) {
  editingProtocolId = id || null;
  const p = id ? allProtocols().find(x => x.id === id) : null;
  document.getElementById('protoEditorTitle').textContent = p ? 'แก้ไขโปรโตคอล' : 'สร้างโปรโตคอลใหม่';
  document.getElementById('cfgName').value = p ? p.name : '';
  const mode = p ? (p.mode || 'amrap') : 'amrap';
  setProtoEditorMode(mode);
  document.getElementById('cfgPull').value = p ? p.pull : 5;
  document.getElementById('cfgPush').value = p ? p.push : 10;
  document.getElementById('cfgSquat').value = p ? p.squat : 15;
  document.getElementById('cfgDuration').value = p && p.durationMin ? p.durationMin : 20;
  document.getElementById('cfgEmomInterval').value = p && p.emomIntervalSec ? p.emomIntervalSec : 60;
  document.getElementById('cfgEmomRounds').value = p && p.emomRounds ? p.emomRounds : 20;
  closeModal('settingsModal');
  document.getElementById('protocolEditorModal').classList.add('active');
}
function setProtoEditorMode(mode) {
  document.querySelectorAll('#protoModeRow .period-pill').forEach(el => el.classList.toggle('sel', el.dataset.mode === mode));
  document.getElementById('amrapFields').style.display = mode === 'amrap' ? 'block' : 'none';
  document.getElementById('emomFields').style.display = mode === 'emom' ? 'block' : 'none';
}
function getProtoEditorMode() {
  const sel = document.querySelector('#protoModeRow .period-pill.sel');
  return sel ? sel.dataset.mode : 'amrap';
}
function saveProtocolEditor() {
  const name = document.getElementById('cfgName').value.trim();
  if (!name) { showToast('กรุณาตั้งชื่อโปรโตคอล'); return; }
  const mode = getProtoEditorMode();
  const proto = {
    id: editingProtocolId || ('custom_' + Date.now()),
    builtin: false,
    name,
    mode,
    // Clamped to the 0-99 range the inputs' own max="99" already claims —
    // same reasoning as REST_SKIP_BONUS_MAX_SEC: that attribute is a UI
    // hint only, not enforced by the browser on every input path, so an
    // absurd reps-per-round value here (paired with an early FINISH NOW)
    // used to be a free-XP exploit. See completeWorkout()'s `completed`
    // gate for the other half of that fix.
    pull: Math.min(99, Math.max(0, parseInt(document.getElementById('cfgPull').value, 10) || 0)),
    push: Math.min(99, Math.max(0, parseInt(document.getElementById('cfgPush').value, 10) || 0)),
    squat: Math.min(99, Math.max(0, parseInt(document.getElementById('cfgSquat').value, 10) || 0))
  };
  if (mode === 'amrap') {
    proto.durationMin = Math.max(1, parseInt(document.getElementById('cfgDuration').value, 10) || 20);
  } else {
    proto.emomIntervalSec = Math.max(10, parseInt(document.getElementById('cfgEmomInterval').value, 10) || 60);
    proto.emomRounds = Math.max(1, parseInt(document.getElementById('cfgEmomRounds').value, 10) || 20);
  }
  const list = loadCustomProtocols();
  const idx = list.findIndex(p => p.id === proto.id);
  if (idx !== -1) list[idx] = proto; else list.push(proto);
  saveCustomProtocols(list);
  selectProtocol(proto.id);
  closeModal('protocolEditorModal');
  showToast('บันทึกโปรโตคอลแล้ว');
  openSettingsModal();
}

let tickHandle = null;
let pendingFeedback = { rpe: null, feeling: null };
let lastCompletedSessionId = null;
let pendingCustomFeedback = { rpe: null, feeling: null };
let lastCompletedCustomSessionId = null;
let currentPeriod = 'all';
let currentMetric = 'rounds';
let wakeLockRef = null;
let audioCtx = null;
let countdownState = { id: null, done: new Set() };
let milestoneState = { id: null, done: new Set() };
let currentPB = 0;
let currentDetailId = null;

/* ---------- wake lock (keep screen on during workout) ---------- */
async function acquireWakeLock() {
  try {
    if ('wakeLock' in navigator) {
      wakeLockRef = await navigator.wakeLock.request('screen');
    }
  } catch (e) { /* not supported / denied — fail silently */ }
}
async function releaseWakeLock() {
  if (wakeLockRef) {
    try { await wakeLockRef.release(); } catch (e) {}
    wakeLockRef = null;
  }
}
document.addEventListener('visibilitychange', async () => {
  const workoutActive = document.getElementById('screen-workout').classList.contains('active')
    || (document.getElementById('screen-customplayer') && document.getElementById('screen-customplayer').classList.contains('active'))
    || (document.getElementById('screen-running') && document.getElementById('screen-running').classList.contains('active'));
  if (document.visibilityState === 'visible' && workoutActive) {
    await acquireWakeLock();
  }
});

/* ---------- vibration + sound cues ---------- */
function vibrate(pattern) {
  if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
}
function unlockAudio() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) {}
}
function beep(freq, durationMs, vol) {
  freq = freq || 880; durationMs = durationMs || 90; vol = vol || 0.15;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'sine';
    osc.frequency.value = freq;
    gain.gain.value = vol;
    osc.connect(gain); gain.connect(audioCtx.destination);
    osc.start();
    gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + durationMs / 1000);
    osc.stop(audioCtx.currentTime + durationMs / 1000 + 0.03);
  } catch (e) {}
}

/* ---------- voice cues (Web Speech API) ----------
   Announces exercise names and short countdowns during the Custom Workout
   player. Purely additive — silently does nothing on devices/browsers
   without speechSynthesis, and is off by default so it never surprises
   someone who hasn't opted in. */
const KEY_VOICE_CUES = 'cindy_voice_cues';
function isVoiceCuesEnabled() {
  return localStorage.getItem(KEY_VOICE_CUES) === '1';
}
function setVoiceCuesEnabled(on) {
  localStorage.setItem(KEY_VOICE_CUES, on ? '1' : '0');
}
function speak(text) {
  if (!isVoiceCuesEnabled()) return;
  try {
    if (!('speechSynthesis' in window)) return;
    window.speechSynthesis.cancel(); // don't let cues queue up and lag behind the timer
    const utter = new SpeechSynthesisUtterance(text);
    utter.lang = 'th-TH';
    utter.rate = 1.05;
    window.speechSynthesis.speak(utter);
  } catch (e) {}
}
function toggleVoiceCues() {
  const next = !isVoiceCuesEnabled();
  setVoiceCuesEnabled(next);
  showToast(next ? 'เปิดเสียงพูดบอกท่าแล้ว' : 'ปิดเสียงพูดบอกท่าแล้ว', next ? 'speakerOn' : 'speakerOff');
  const btn = document.getElementById('playerVoiceBtn');
  if (btn) btn.classList.toggle('sel', next);
}

/* ---------- storage helpers ---------- */
function loadSessions() {
  try { return JSON.parse(localStorage.getItem(KEY_SESSIONS)) || []; }
  catch (e) { return []; }
}
function saveSessions(list) {
  localStorage.setItem(KEY_SESSIONS, JSON.stringify(list));
  invalidateXPCache();
}
/* ---- in-memory cache for the active-workout record ----
   loadActive() used to hit localStorage.getItem + JSON.parse on every
   single call — including from refreshWorkoutUI(), which runs on a
   250ms setInterval for the entire duration of a workout (could be
   20-45+ min). That's ~4 synchronous localStorage reads + JSON parses
   per second doing nothing but re-reading data this same code just
   wrote a moment ago.
   KEY_ACTIVE is only ever touched via these three functions anywhere
   in the app (no cross-tab 'storage' listener, no external writer), so
   a shared in-memory cache is safe: every caller — the tick loop AND
   the button handlers like saveRound()/togglePause()/skipRound() that
   also call loadActive() mid-workout — reads and writes the exact same
   object. A write from any one of them is instantly visible to all the
   others, so there's no staleness window despite skipping the disk
   round-trip on repeat reads. localStorage is only touched on the
   first read after a page load and on every save/clear, exactly like
   before — just not redundantly on every idle tick in between. */
let _activeCache, _activeCacheLoaded = false;
function loadActive() {
  if (!_activeCacheLoaded) {
    try { _activeCache = JSON.parse(localStorage.getItem(KEY_ACTIVE)); }
    catch (e) { _activeCache = null; }
    _activeCacheLoaded = true;
  }
  return _activeCache;
}
function saveActive(a) {
  _activeCache = a;
  _activeCacheLoaded = true;
  localStorage.setItem(KEY_ACTIVE, JSON.stringify(a));
}
function clearActive() {
  _activeCache = null;
  _activeCacheLoaded = true;
  localStorage.removeItem(KEY_ACTIVE);
}
function loadRunSessions() {
  try { return JSON.parse(localStorage.getItem(KEY_RUN_SESSIONS)) || []; }
  catch (e) { return []; }
}
function saveRunSessions(list) {
  localStorage.setItem(KEY_RUN_SESSIONS, JSON.stringify(list));
  invalidateXPCache();
}
/* ---- same in-memory cache treatment as loadActive() above, and for
   the same reason: refreshRunUI() re-reads this every 1s for the
   whole duration of a run via loadRunActive(). Same safety argument
   applies — KEY_RUN_ACTIVE is only ever read/written here. ---- */
let _runActiveCache, _runActiveCacheLoaded = false;
function loadRunActive() {
  if (!_runActiveCacheLoaded) {
    try { _runActiveCache = JSON.parse(localStorage.getItem(KEY_RUN_ACTIVE)); }
    catch (e) { _runActiveCache = null; }
    _runActiveCacheLoaded = true;
  }
  return _runActiveCache;
}
function saveRunActive(a) {
  _runActiveCache = a;
  _runActiveCacheLoaded = true;
  localStorage.setItem(KEY_RUN_ACTIVE, JSON.stringify(a));
}
function clearRunActive() {
  _runActiveCache = null;
  _runActiveCacheLoaded = true;
  localStorage.removeItem(KEY_RUN_ACTIVE);
}

/* ---------- theme ---------- */
const KEY_THEME = 'cindy_theme';
function applyStoredTheme() {
  const t = localStorage.getItem(KEY_THEME);
  document.body.classList.toggle('oled', t === 'oled');
}
function toggleTheme() {
  const isOled = document.body.classList.toggle('oled');
  localStorage.setItem(KEY_THEME, isOled ? 'oled' : 'default');
  showToast(isOled ? 'เปิดโหมด OLED (จอมืดสุด)' : 'กลับเป็นธีมปกติ');
}

/* ---------- utils ---------- */
function fmtTime(totalSeconds) {
  totalSeconds = Math.max(0, Math.round(totalSeconds));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
}
/* ================= BOSS FIGHT (WEEKLY) =================
 * Reuses existing session history — no new XP/HP data stored, just derived.
 * Week runs Monday->Sunday (calendar week, not a rolling 7-day window) so
 * the boss resets on a predictable schedule regardless of when you check in.
 * Damage dealt this week = total reps logged this week (Cindy + Custom).
 * Boss index cycles through BOSS_ROSTER by ISO week number; each full lap
 * around the roster raises the HP target so it stays a real fight.
 */
/* Each boss carries its own accent color so the whole card (background
   glow, HP bar, name) reskins per-boss instead of staying one flat gradient
   for all five — small touch, but it makes the weekly boss rotation
   actually feel like a different fight instead of the same card relabeled.
   `story` is short RPG flavor text shown in the Boss Archive (renderBossViewList)
   — each one is written to mirror a real training obstacle (skipping day
   one, hitting a plateau, losing consistency, overtraining/burnout, facing
   the person you were before you started), so the weekly rotation reads as
   a themed arc rather than five reskinned punching bags. */
const BOSS_ROSTER = [
  { id: 'grinder1', name: 'GRINDER-1', tag: 'SCRAP BRAWLER', baseHp: 250, accent: '#ff6a3d',
    bg: 'assets/boss-backgrounds/bg-grinder1.png',
    chapter: { num: 1, title: 'AWAKENING' },
    story: 'ต่อขึ้นจากเศษเหล็กที่ทิ้งไว้ตอนเลิกกลางคัน มันคือด่านแรกที่ทุกคนต้องเจอ — แค่ลุกมาเริ่มในวันที่ไม่อยากขยับตัวเลย GRINDER-1 ไม่ได้แข็งแกร่ง มันแค่รอให้คุณยอมแพ้ก่อนยกแรก' },
  { id: 'ironmaw', name: 'IRON MAW', tag: 'SPLIT JAW', baseHp: 350, accent: '#8aa0b8',
    bg: 'assets/boss-backgrounds/bg-ironmaw.png',
    chapter: { num: 2, title: 'IRON FORTRESS' },
    story: 'ขากรรไกรเหล็กที่งับกลืนแรงจูงใจของนักสู้ที่เริ่มชินชากับกิจวัตรเดิม ๆ มันคือกำแพงเมื่อทุกอย่างเริ่ม "ง่ายเกินไป" จนลืมไปว่าความชินชาคือจุดที่คนส่วนใหญ่หยุดพัฒนา' },
  { id: 'void9', name: 'VOID-9', tag: 'FORMLESS THREAT', baseHp: 450, accent: '#a855f7',
    bg: 'assets/boss-backgrounds/bg-void9.png',
    chapter: { num: 3, title: 'VOID ZONE' },
    story: 'ไม่มีรูปร่างตายตัว เปลี่ยนหน้ากากไปเรื่อยตามข้ออ้างของแต่ละวัน — งานยุ่ง นอนไม่พอ ไม่มีอารมณ์ VOID-9 คือความไม่สม่ำเสมอที่กัดกร่อน streak จากข้างในโดยไม่ทันรู้ตัว' },
  { id: 'wingreaper', name: 'WING REAPER', tag: 'SKY HUNTER', baseHp: 550, accent: '#38bdf8',
    bg: 'assets/boss-backgrounds/bg-wingreaper.png',
    chapter: { num: 4, title: 'SKY CITADEL' },
    story: 'โฉบลงมาตอนที่มั่นใจที่สุด เมื่อเริ่มฝืนหักโหมเกินร่างกายจะรับไหว WING REAPER คือเงาของอาการบาดเจ็บและ burnout ที่คอยจับตาอยู่บนฟ้า รอจังหวะที่ความทะเยอทะยานมาเกินความอดทน' },
  { id: 'corezero', name: 'CORE-ZERO', tag: 'FINAL REACTOR', baseHp: 700, accent: '#fbbf24',
    bg: 'assets/boss-backgrounds/bg-corezero.png',
    chapter: { num: 5, title: 'CORE REACTOR' },
    story: 'แกนปฏิกรณ์ที่หลอมจากทุกวันที่เคยเลิกล้ม มันคือภาพของตัวเองในเวอร์ชันก่อนเริ่มฝึก ยังคงยืนรอเป็นด่านสุดท้ายเสมอ เพราะบอสตัวจริงไม่เคยเป็นใครอื่นนอกจากคนที่คุณเคยเป็น' }
];
/** "CHAPTER 0X — TITLE" formatter — content-only addition (product doc #9),
 * no new storage: chapter is just a label carried on the existing
 * BOSS_ROSTER entries, in the same fixed order the roster already cycles
 * through. Falls back to '' for any boss missing a chapter (defensive only —
 * every current entry has one). */
function bossChapterLabel(boss) {
  if (!boss || !boss.chapter) return '';
  return 'CHAPTER ' + String(boss.chapter.num).padStart(2, '0') + ' — ' + boss.chapter.title;
}

/* ---- Boss Modifier (product doc #8) — presentation-only ----
 * A themed tagline that rotates weekly, independent of which boss is up
 * (so a repeat lap around BOSS_ROSTER still feels different the second
 * time around). Deterministic from absoluteWeekIndex() — same "everyone
 * on the same week sees the same thing, nothing server-side needed" trick
 * currentBossState() already uses for the boss rotation itself.
 * Per the Phase-3 plan this ships presentation-only first: it does NOT
 * change Boss Damage, XP, or targetHp. A future pass could key real
 * bonuses off MODIFIER.id, but that's a balance discussion for later. */
const BOSS_MODIFIERS = [
  { id: 'ironbody', name: 'IRON BODY', desc: 'สัปดาห์นี้เน้นความแข็งแกร่งของร่างกาย' },
  { id: 'unstablecore', name: 'UNSTABLE CORE', desc: 'พลังงานไม่แน่นอน อะไรก็เกิดขึ้นได้' },
  { id: 'overdriveweek', name: 'OVERDRIVE WEEK', desc: 'สัปดาห์นี้ Combo คือกุญแจสำคัญ' },
  { id: 'enduranceshift', name: 'ENDURANCE SHIFT', desc: 'สัปดาห์นี้สนับสนุน Workout ที่ใช้เวลานาน' },
  { id: 'cardiosurge', name: 'CARDIO SURGE', desc: 'สัปดาห์นี้สนับสนุนสาย Cardio' },
  { id: 'silentwatch', name: 'SILENT WATCH', desc: 'ไม่มีสัญญาณเตือนล่วงหน้า ต้องพร้อมทุกวัน' },
  { id: 'reinforcedplating', name: 'REINFORCED PLATING', desc: 'เกราะหนาขึ้น แต่ก็ยังปราบได้ด้วยความสม่ำเสมอ' }
];
function currentBossModifier() {
  const idx = absoluteWeekIndex(Date.now());
  // *7+3 just to avoid the modifier lining up 1:1 with the roster cycle
  // (BOSS_ROSTER.length === 5) so the same boss doesn't always draw the
  // same modifier every lap.
  const pos = ((idx * 7 + 3) % BOSS_MODIFIERS.length + BOSS_MODIFIERS.length) % BOSS_MODIFIERS.length;
  return BOSS_MODIFIERS[pos];
}
/** '#rrggbb' -> 'r,g,b' so CSS can build rgba() at any alpha via var(). */
function hexToRgbTriplet(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return '255,255,255';
  return [1, 2, 3].map(i => parseInt(m[i], 16)).join(',');
}
const KEY_BOSS_DEFEAT_SEEN = 'cindy_boss_defeat_seen_week';
const KEY_BOSS_EVER_DEFEATED = 'cindy_boss_ever_defeated';
function loadBossEverDefeated() {
  try { return JSON.parse(localStorage.getItem(KEY_BOSS_EVER_DEFEATED)) || []; }
  catch (e) { return []; }
}
function saveBossEverDefeated(list) {
  localStorage.setItem(KEY_BOSS_EVER_DEFEATED, JSON.stringify(list));
}

/* ---- Boss Mastery (lifetime, per boss) ----
 * The weekly boss fight itself always resets — that's by design, it's a
 * fresh check-in every week. But nothing about "how many times have I
 * ever beaten GRINDER-1" resets, so this is the long-term ladder that
 * sits underneath the weekly loop: every defeat (not just the first)
 * bumps a per-boss lifetime counter, which climbs a fixed mastery tier
 * list forever. No new gameplay data — same defeat event that already
 * pushes loadBossEverDefeated(), just also tallied. */
const KEY_BOSS_DEFEAT_COUNTS = 'cindy_boss_defeat_counts';
function loadBossDefeatCounts() {
  try { return JSON.parse(localStorage.getItem(KEY_BOSS_DEFEAT_COUNTS)) || {}; }
  catch (e) { return {}; }
}
function saveBossDefeatCounts(counts) {
  localStorage.setItem(KEY_BOSS_DEFEAT_COUNTS, JSON.stringify(counts));
}
function bumpBossDefeatCount(bossId) {
  const counts = loadBossDefeatCounts();
  counts[bossId] = (counts[bossId] || 0) + 1;
  saveBossDefeatCounts(counts);
  return counts[bossId];
}
const BOSS_MASTERY_TIERS = [
  { min: 0,  label: 'ยังไม่เคยปราบ', color: 'var(--text-faint)' },
  { min: 1,  label: 'CHALLENGER',    color: 'var(--text-dim)' },
  { min: 3,  label: 'VETERAN',       color: 'var(--web)' },
  { min: 7,  label: 'MASTER',        color: 'var(--warning)' },
  { min: 15, label: 'LEGENDARY',     color: '#FFD700' }
];
function bossMasteryFor(count) {
  let tier = BOSS_MASTERY_TIERS[0];
  for (const t of BOSS_MASTERY_TIERS) { if (count >= t.min) tier = t; }
  const idx = BOSS_MASTERY_TIERS.indexOf(tier);
  const next = BOSS_MASTERY_TIERS[idx + 1] || null;
  return { label: tier.label, color: tier.color, next: next ? { label: next.label, remaining: next.min - count } : null };
}

/* ================= BOSS LOOT DROPS =================
 * Every boss kill rolls one random item from a rarity-weighted table —
 * reuses the same BADGE_ICONS glyph set as the boss/skin accessories, so
 * no new art assets are needed. The roll is skewed toward rarer tiers the
 * tougher the fight was (further into BOSS_ROSTER, or further into a
 * repeat lap — see currentBossState()'s own baseHp+lap scaling), so late-
 * game boss farming actually feels like it pays off in better loot.
 * Owned items are a simple id->count map in localStorage; nothing but the
 * count ever changes, so merge-on-import is just a per-key max/sum. */
const KEY_LOOT_INVENTORY = 'cindy_loot_inventory';
const RARITY_DEFS = [
  { id: 'common',   label: 'COMMON',   c1: '#e2e6ec', c2: '#5b6472', glow: 'rgba(154,165,177,.5)',  weight: 100 },
  { id: 'uncommon', label: 'UNCOMMON', c1: '#c7f5df', c2: '#1f9a5c', glow: 'rgba(74,217,145,.55)',  weight: 55 },
  { id: 'rare',     label: 'RARE',     c1: '#c3dcff', c2: '#2f5fdb', glow: 'rgba(61,155,255,.6)',   weight: 24 },
  { id: 'epic',     label: 'EPIC',     c1: '#ecd2ff', c2: '#8a2fdb', glow: 'rgba(177,101,255,.65)', weight: 10 },
  { id: 'mythic',   label: 'MYTHIC',   c1: '#ffe9b0', c2: '#d9861b', glow: 'rgba(255,179,64,.75)',  weight: 3 }
];
function rarityDef(id) {
  return RARITY_DEFS.find(r => r.id === id) || RARITY_DEFS[0];
}
/* statBonus: flat Combat-Power-only points per stat key (see STAT_DEFS),
 * scaled to rarity (common ~1, uncommon ~2, rare ~3+1, epic ~4+1,
 * mythic ~5+ or spread across every stat for the top tier). Flavor-
 * matched to each item's lore/theme where a stat fits naturally.
 * These NEVER touch loadStatTotals()/computeFitnessPower() — see the
 * Phase 2C note above computeEquipmentPower() for why. */
const LOOT_ITEMS = [
  { id: 'scrapPlate',    name: 'แผ่นเกราะเศษเหล็ก',   icon: 'gearCog', rarity: 'common',
    img: 'assets/loot/scrapPlate.png', statBonus: { core: 1 },
    lore: 'ปะติดปะต่อจากเศษเกราะที่เก็บได้หลังศึกแรก ๆ ยังไม่สวยหรู แต่กันได้ทุกหมัดแรกที่ไม่มีใครกันให้' },
  { id: 'wornGrip',      name: 'ผ้าพันมือเก่า',       icon: 'mitten',  rarity: 'common',
    img: 'assets/loot/wornGrip.png', statBonus: { pull: 1 },
    lore: 'ผ้าพันมือผืนแรกที่แลกมาด้วยเหงื่อ เก่าจนสีซีดแต่ไม่เคยขาดแม้แต่เซตเดียว' },
  { id: 'basicShield',   name: 'โล่ฝึกหัด',           icon: 'shield',  rarity: 'common',
    img: 'assets/loot/basicShield.png', statBonus: { legs: 1 },
    lore: 'โล่ไม้แผ่นแรกที่ใช้ฝึกรับแรงกระแทก รอยบุบทุกรอยคือบทเรียนของวันที่ยังไม่แข็งแรงพอ' },
  { id: 'ironFang',      name: 'เขี้ยว IRON MAW',      icon: 'fang',    rarity: 'uncommon',
    img: 'assets/loot/ironFang.png', statBonus: { pull: 2 },
    lore: 'เขี้ยวที่หลุดจากขากรรไกรของ IRON MAW ตอนมันพ่ายให้ความแข็งแกร่งที่ฝึกมาไม่หยุด' },
  { id: 'scoutScarf',    name: 'ผ้าพันคอสอดแนม',      icon: 'scarf',   rarity: 'uncommon',
    img: 'assets/loot/scoutScarf.png', statBonus: { cardio: 2 },
    lore: 'ผ้าพันคอของนักสอดแนมที่แอบตามดูฟอร์มการฝึกอยู่ไกล ๆ ก่อนยอมมอบให้ด้วยความเคารพ' },
  { id: 'trainerGi',     name: 'ชุดฝึกซ้อมเก่าแก่',    icon: 'gi',      rarity: 'uncommon',
    img: 'assets/loot/trainerGi.png', statBonus: { push: 2 },
    lore: 'ชุดฝึกของครูฝึกรุ่นก่อน ส่งต่อกันมาให้คนที่พิสูจน์แล้วว่าไม่ยอมแพ้กลางทาง' },
  { id: 'voidShard',     name: 'เศษเสี้ยว VOID',       icon: 'vortex',  rarity: 'rare',
    img: 'assets/loot/voidShard.png', statBonus: { core: 3 },
    lore: 'เศษเสี้ยวที่หลุดออกจากร่าง VOID-9 หลังมันแตกสลาย ยังสั่นไหวราวกับมีพลังงานเหลืออยู่ในนั้น' },
  { id: 'reaperFeather', name: 'ขนปีก WING REAPER',    icon: 'wing',    rarity: 'rare',
    img: 'assets/loot/reaperFeather.png', statBonus: { cardio: 3, legs: 1 },
    lore: 'ขนปีกที่ร่วงจาก WING REAPER ตอนมันโฉบลงมาท้าทาย แล้วพ่ายให้ความอึดที่ไม่มีวันหมด' },
  { id: 'grinderCog',    name: 'เฟือง GRINDER-1',      icon: 'gearCog', rarity: 'epic',
    img: 'assets/loot/grinderCog.png', statBonus: { legs: 4, core: 1 },
    lore: 'เฟืองหลักของ GRINDER-1 ที่หยุดหมุนเป็นครั้งแรกในรอบหลายสัปดาห์ เมื่อเจอแรงที่มันหยุดไม่ได้' },
  { id: 'coreFragment',  name: 'ชิ้นส่วนแกนปฏิกรณ์',   icon: 'core',    rarity: 'epic',
    img: 'assets/loot/coreFragment.png', statBonus: { core: 4, push: 1 },
    lore: 'ชิ้นส่วนแกนปฏิกรณ์จาก CORE-ZERO ยังเปล่งแสงจาง ๆ เหมือนไม่ยอมรับว่าตัวเองพ่ายไปแล้ว' },
  { id: 'twinBlades',    name: 'ดาบคู่นักรบ',          icon: 'swordsCross', rarity: 'epic',
    img: 'assets/loot/twinBlades.png', statBonus: { pull: 3, push: 2 },
    lore: 'ดาบคู่ที่ตีขึ้นจากชัยชนะติดต่อกันหลายศึก แต่ละครั้งที่ฟันคือแรงที่สะสมมาโดยไม่มีวันหยุด' },
  { id: 'championCrown', name: 'มงกุฎผู้พิชิต',        icon: 'crown',   rarity: 'mythic',
    img: 'assets/loot/championCrown.png', statBonus: { pull: 2, push: 2, legs: 2, core: 2, cardio: 2 },
    lore: 'มงกุฎที่มอบให้เฉพาะผู้พิชิตทุก Boss ในสังเวียน สัญลักษณ์ของนักสู้ที่ไม่เคยเลิกกลางคัน' },
  { id: 'phoenixCore',   name: 'แก่นเพลิงอมตะ',        icon: 'flame',   rarity: 'mythic',
    img: 'assets/loot/phoenixCore.png', statBonus: { cardio: 4, core: 3 },
    lore: 'แก่นเพลิงที่ไม่เคยดับ แม้ในวันที่ล้มเหลว มันก็ยังคุกรุ่นรอวันลุกขึ้นมาใหม่' }
];
function loadLootInventory() {
  try { return JSON.parse(localStorage.getItem(KEY_LOOT_INVENTORY)) || {}; }
  catch (e) { return {}; }
}
function saveLootInventory(inv) {
  localStorage.setItem(KEY_LOOT_INVENTORY, JSON.stringify(inv));
}
function addLootItem(itemId) {
  const inv = loadLootInventory();
  inv[itemId] = (inv[itemId] || 0) + 1;
  saveLootInventory(inv);
  return inv[itemId];
}

/* ---- equipped loot badge ----
 * One owned item can be "worn" as a small badge on the mascot, same idea
 * as MASCOT_SKINS' accessory but a separate slot (top-left vs the skin
 * accessory's top-right) so both can show at once. Applied everywhere the
 * mascot already renders: Home, the Character sheet, and the Custom
 * Workout companion HUD. */
const KEY_EQUIPPED_LOOT = 'cindy_equipped_loot_id';
function loadEquippedLootId() {
  return localStorage.getItem(KEY_EQUIPPED_LOOT) || '';
}
function saveEquippedLootId(id) {
  if (id) localStorage.setItem(KEY_EQUIPPED_LOOT, id);
  else localStorage.removeItem(KEY_EQUIPPED_LOOT);
}
function equippedLootItem() {
  const id = loadEquippedLootId();
  if (!id) return null;
  const inv = loadLootInventory();
  if (!(inv[id] > 0)) return null; // owned check — in case inventory ever changes
  return LOOT_ITEMS.find(it => it.id === id) || null;
}
/* ---- equipment stat bonuses → Combat Power only (Phase 2C) ----
 * Per the Phase 1 agreement, equipment must never affect Boss Damage
 * (still 100% real reps — see totalVolumeOfCustomSession/currentBoss-
 * DamageBreakdown, neither of which this touches) and must never feed
 * loadStatTotals()/computeFitnessPower() (Fitness Power must stay a
 * pure real-world signal). So an item's statBonus is only ever summed
 * into Combat Power as flat points — it never becomes part of a stat's
 * *level* or its progress bar. lootStatBonusLabel() below is the one
 * shared formatter so the grid tile, detail popup, and any future spot
 * that shows an item's stats all render identically. */
function equippedLootStatBonus() {
  const item = equippedLootItem();
  return (item && item.statBonus) || {};
}
function computeEquipmentPower() {
  const bonus = equippedLootStatBonus();
  return Object.keys(bonus).reduce((sum, k) => sum + (bonus[k] || 0), 0);
}
function lootStatBonusLabel(item) {
  if (!item || !item.statBonus) return '';
  return Object.keys(item.statBonus)
    .map(k => {
      const def = STAT_DEFS.find(d => d.key === k);
      return (def ? def.short : k.toUpperCase()) + ' +' + item.statBonus[k];
    })
    .join('  ');
}

/* ================= EQUIPMENT SETS (product doc #4) =================
 * Per the team decision: set bonuses come from what's OWNED in the loot
 * inventory, not what's currently equipped. This deliberately keeps the
 * existing single-slot equip system (equippedLootItem/toggleEquipLoot)
 * completely untouched — no new UI, no multi-slot rework — while still
 * giving a real reason to keep farming a boss for its full drop table,
 * per the doc's "Boss → Loot → Equip → Character Development" loop.
 *
 * Same Phase 2C guardrail as individual equipment: set bonuses are flat
 * Combat-Power-only points (see computeSetBonusPower below, folded into
 * computeCombatPower next to computeEquipmentPower). They NEVER touch
 * loadStatTotals()/computeFitnessPower() and NEVER touch Boss Damage.
 *
 * Only one set ships for now — GRINDER SET — because it's the one example
 * in the product doc whose 3 named pieces (Grinder Cog / Scrap Plate /
 * Worn Grip) already exist in LOOT_ITEMS with matching lore. Doc also
 * proposes a cardio/agility "WING REAPER SET", but no matching 3-item
 * lineup exists yet — rather than force mismatched items into a fake set,
 * this waits for that item design pass. Adding a new set later is just
 * one more entry in this array; nothing else needs to change. */
const LOOT_SETS = [
  { id: 'grinderset', name: 'GRINDER SET', itemIds: ['grinderCog', 'scrapPlate', 'wornGrip'],
    bonus2: 3, bonus3: 8, bonusName: 'GRINDER OVERDRIVE',
    desc2: 'มี 2/3 ชิ้น — โบนัสเล็กน้อยต่อ Combat Power', desc3: 'ครบเซ็ต — ปลดล็อก GRINDER OVERDRIVE' }
];
/** How many distinct pieces of this set the player currently owns
 * (count > 0 in the loot inventory) — ownership only, equip status is
 * irrelevant here by design (see comment above). */
function ownedSetPieceCount(set, inv) {
  inv = inv || loadLootInventory();
  return set.itemIds.reduce((n, id) => n + ((inv[id] || 0) > 0 ? 1 : 0), 0);
}
/** Flat Combat-Power bonus this set currently grants: 0 below 2 pieces,
 * bonus2 at 2 pieces, bonus3 once every piece is owned. */
function setBonusValue(set, owned) {
  if (owned >= set.itemIds.length) return set.bonus3;
  if (owned >= 2) return set.bonus2;
  return 0;
}
function computeSetBonusPower() {
  const inv = loadLootInventory();
  return LOOT_SETS.reduce((sum, set) => sum + setBonusValue(set, ownedSetPieceCount(set, inv)), 0);
}
/** Render the "EQUIPMENT SETS" progress list — shared by the Collection
 * screen and (optionally) the Character sheet. Purely a read of owned
 * counts; nothing here changes any state. */
function renderLootSets(containerId) {
  const wrap = document.getElementById(containerId || 'lootSetList');
  if (!wrap) return;
  const inv = loadLootInventory();
  wrap.innerHTML = LOOT_SETS.map(set => {
    const owned = ownedSetPieceCount(set, inv);
    const total = set.itemIds.length;
    const complete = owned >= total;
    const bonus = setBonusValue(set, owned);
    const piecesHtml = set.itemIds.map(id => {
      const item = LOOT_ITEMS.find(it => it.id === id);
      const has = (inv[id] || 0) > 0;
      return '<span class="lootset-piece' + (has ? ' owned' : '') + '">' + (item ? item.name : id) + '</span>';
    }).join('');
    let statusHtml;
    if (complete) statusHtml = '+' + bonus + ' CP · ' + set.bonusName;
    else if (owned >= 2) statusHtml = '+' + bonus + ' CP';
    else statusHtml = owned + '/' + total;
    return '<div class="boss-view-item' + (complete ? ' current' : '') + '">'
      + '<div class="boss-view-item-top">'
      + '<div><div class="boss-view-item-name">' + set.name + '</div>'
      + '<div class="boss-view-item-tag">' + owned + '/' + total + ' ชิ้น' + (complete ? ' · ครบเซ็ต' : '') + '</div></div>'
      + '<div class="boss-view-item-status">' + statusHtml + '</div>'
      + '</div>'
      + '<div class="lootset-pieces">' + piecesHtml + '</div>'
      + '<div class="boss-view-item-story">' + (complete ? set.desc3 : set.desc2) + '</div>'
      + '</div>';
  }).join('');
}
function toggleEquipLoot(itemId) {
  const inv = loadLootInventory();
  if (!(inv[itemId] > 0)) return;
  const item = LOOT_ITEMS.find(it => it.id === itemId);
  if (loadEquippedLootId() === itemId) {
    saveEquippedLootId('');
    showToast('ถอดไอเทมออกแล้ว');
  } else {
    saveEquippedLootId(itemId);
    showToast('สวมใส่ ' + (item ? item.name : 'ไอเทม') + ' แล้ว');
  }
  renderLootGrid('collectionLootGrid');
  applyActiveMascotSkinFilter();
  if (document.getElementById('screen-character') && document.getElementById('screen-character').classList.contains('active')) {
    renderCharacterSheet();
  }
  if (customPlayer) applyCompanionHudSkin();
}
/** Renders the equipped-loot badge (if any) into the given container id —
 * shared by the Home avatar, Character sheet avatar, and companion HUD. */
function applyEquippedLootBadge(elId) {
  const el = document.getElementById(elId);
  if (!el) return;
  const item = equippedLootItem();
  if (item) {
    el.innerHTML = lootBadgeHtml(item, { glow: true, ring: true });
    el.classList.add('show');
  } else {
    el.innerHTML = '';
    el.classList.remove('show');
  }
}
/** 0..1 difficulty score for the boss just defeated — further along the
 * roster and further into repeat laps skews the loot roll toward rarer
 * tiers (see rollLootDrop()). */
function bossDifficultyScore(bossState) {
  const idx = Math.max(0, BOSS_ROSTER.findIndex(b => b.id === bossState.boss.id));
  const lap = Math.floor(bossState.weekIndex / BOSS_ROSTER.length);
  const rosterPos = BOSS_ROSTER.length > 1 ? idx / (BOSS_ROSTER.length - 1) : 0;
  return Math.min(1, rosterPos * 0.7 + Math.min(lap, 5) * 0.06);
}
function rollLootDrop(bossState) {
  const difficulty = bossDifficultyScore(bossState);
  const weights = RARITY_DEFS.map(r => r.id === 'common'
    ? r.weight * (1 - difficulty * 0.55)
    : r.weight * (1 + difficulty * 2.2));
  const total = weights.reduce((a, b) => a + b, 0);
  let roll = Math.random() * total;
  let chosen = RARITY_DEFS[0];
  for (let i = 0; i < RARITY_DEFS.length; i++) {
    if (roll < weights[i]) { chosen = RARITY_DEFS[i]; break; }
    roll -= weights[i];
  }
  const pool = LOOT_ITEMS.filter(it => it.rarity === chosen.id);
  return pool[Math.floor(Math.random() * pool.length)] || LOOT_ITEMS[0];
}
function renderLootGrid(containerId) {
  const grid = document.getElementById(containerId);
  if (!grid) return;
  const inv = loadLootInventory();
  const equippedId = loadEquippedLootId();
  grid.innerHTML = LOOT_ITEMS.map(item => {
    const count = inv[item.id] || 0;
    const owned = count > 0;
    const isEquipped = owned && item.id === equippedId;
    const rarity = rarityDef(item.rarity);
    const cls = 'skin-item loot-item' + (owned ? '' : ' locked') + (isEquipped ? ' active' : '');
    const clickAttr = owned ? ' onclick="openLootDetail(\'' + item.id + '\')"' : '';
    // Full artwork in the grid when owned (mixed approach — see lootBadgeHtml
    // for the small cropped version used on the mascot itself); locked slots
    // keep the generic lock glyph so the art stays a surprise until earned.
    const artHtml = owned
      ? '<img class="loot-thumb" src="' + item.img + '" alt="' + item.name + '" />'
      : '<div class="collection-emoji" style="font-size:30px;">' + lockedBadgeHtml() + '</div>';
    const cornerHtml = isEquipped ? '<div class="active-check">' + iconHtml('check') + '</div>'
      : (owned && count > 1 ? '<div class="loot-count">x' + count + '</div>' : (owned ? '' : '<div class="lock-icon">' + iconHtml('lock') + '</div>'));
    return '<div class="' + cls + '"' + clickAttr + ' style="' + (owned ? '--loot-rarity:' + rarity.glow + ';' : '') + '">'
      + cornerHtml
      + artHtml
      + '<div class="skin-name" style="color:' + (owned ? rarity.c2 : '') + ';">' + (owned ? item.name : '???') + '</div>'
      + '<div class="skin-cond" style="color:' + (owned ? rarity.c2 : '') + ';">' + (owned ? (isEquipped ? 'สวมใส่อยู่' : rarity.label) : rarity.label) + '</div>'
      + '</div>';
  }).join('');
}

/* ---- loot item detail popup ----
 * Opened by tapping an owned tile in the collection grid (locked tiles
 * aren't clickable, so the art + lore stay a surprise until earned). Shows
 * the full illustration + lore, with the equip/unequip action moved here
 * instead of firing straight from the grid tap. */
function openLootDetail(itemId) {
  const item = LOOT_ITEMS.find(it => it.id === itemId);
  const inv = loadLootInventory();
  if (!item || !(inv[itemId] > 0)) return;
  const rarity = rarityDef(item.rarity);
  const count = inv[itemId] || 0;
  const isEquipped = loadEquippedLootId() === itemId;

  const modal = document.getElementById('lootDetailModal');
  modal.dataset.itemId = itemId;
  document.getElementById('lootDetailImg').src = item.img;
  document.getElementById('lootDetailImg').alt = item.name;
  document.getElementById('lootDetailRarity').textContent = rarity.label + (count > 1 ? ' · x' + count : '');
  document.getElementById('lootDetailRarity').style.color = rarity.c2;
  document.getElementById('lootDetailName').textContent = item.name;
  const statEl = document.getElementById('lootDetailStats');
  if (statEl) statEl.textContent = lootStatBonusLabel(item);
  document.getElementById('lootDetailLore').textContent = item.lore || '';
  const btn = document.getElementById('lootDetailEquipBtn');
  btn.textContent = isEquipped ? 'ถอดออก' : 'สวมใส่';
  btn.className = 'btn btn-sm ' + (isEquipped ? 'btn-outline' : 'btn-primary');

  modal.classList.add('active');
}
function toggleEquipLootFromDetail() {
  const modal = document.getElementById('lootDetailModal');
  const itemId = modal.dataset.itemId;
  if (!itemId) return;
  toggleEquipLoot(itemId);
  openLootDetail(itemId); // refresh button label/state in place
}

/** Monday 00:00 of the week containing `ts`. */
function weekStart(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay(); // 0=Sun..6=Sat
  const diffToMonday = day === 0 ? 6 : day - 1;
  d.setDate(d.getDate() - diffToMonday);
  return d;
}
/** Number of whole weeks between a fixed epoch Monday and the week containing `ts`. */
function absoluteWeekIndex(ts) {
  const epochMonday = weekStart(Date.UTC(2024, 0, 1));
  const thisMonday = weekStart(ts);
  return Math.round((thisMonday.getTime() - epochMonday.getTime()) / (7 * 24 * 60 * 60 * 1000));
}
function currentBossState() {
  const now = Date.now();
  const idx = absoluteWeekIndex(now);
  const lap = Math.floor(idx / BOSS_ROSTER.length);
  const boss = BOSS_ROSTER[((idx % BOSS_ROSTER.length) + BOSS_ROSTER.length) % BOSS_ROSTER.length];
  const targetHp = boss.baseHp + lap * 150; // gets tougher each time the roster loops

  const startTs = weekStart(now).getTime();
  const cindyDamage = loadSessions()
    .filter(s => s.finished >= startTs)
    .reduce((sum, s) => sum + (s.total ? s.total.reps : 0), 0);
  const customDamage = loadCustomWorkoutSessions()
    .filter(s => s.completedAt >= startTs)
    .reduce((sum, s) => sum + totalVolumeOfCustomSession(s), 0);
  const runDamage = loadRunSessions()
    .filter(s => s.completedAt >= startTs)
    .reduce((sum, s) => sum + (s.xp || 0), 0);
  const damage = cindyDamage + customDamage + runDamage;

  return {
    weekIndex: idx,
    boss,
    targetHp,
    hp: Math.max(0, targetHp - damage),
    damage,
    defeated: damage >= targetHp
  };
}
function bossWeekKey(weekIndex) {
  return 'w' + weekIndex;
}
function loadBossDefeatSeenWeek() {
  return localStorage.getItem(KEY_BOSS_DEFEAT_SEEN) || '';
}
function saveBossDefeatSeenWeek(key) {
  localStorage.setItem(KEY_BOSS_DEFEAT_SEEN, key);
}
function bossSilhouetteMarkup(bossId) {
  switch (bossId) {
    case 'grinder1':
      return '<img src="assets/boss/boss-grinder1.png" alt="GRINDER-1" style="width:100%;height:100%;object-fit:contain;" />';
    case 'ironmaw':
      return '<img src="assets/boss/boss-ironmaw.png" alt="IRON MAW" style="width:100%;height:100%;object-fit:contain;" />';
    case 'void9':
      return '<img src="assets/boss/boss-void9.png" alt="VOID-9" style="width:100%;height:100%;object-fit:contain;" />';
    case 'wingreaper':
      return '<img src="assets/boss/boss-wingreaper.png" alt="WING REAPER" style="width:100%;height:100%;object-fit:contain;" />';
    case 'corezero':
      return '<img src="assets/boss/boss-corezero.png" alt="CORE-ZERO" style="width:100%;height:100%;object-fit:contain;" />';
    default:
      return '';
  }
}

/* ================= BOSS BATTLE CUTSCENE =================
 * Auto-play "battle report" shown right after finishing a workout, before
 * the results screen (screen-complete / screen-customcomplete) — turns the
 * damage that workout already dealt (same numbers currentBossState() sums
 * up) into a short sequence of hits instead of a single silent HP-bar jump.
 * Purely a presentation layer: it does NOT decide whether the boss is
 * defeated or roll loot — that authority stays with renderBossCard(), which
 * still runs normally once the person reaches Home and will show the
 * "defeated!" toast + loot drop exactly as before. This just dramatizes the
 * damage tally that already happened.
 *
 * Turn breakdown:
 *  - Cindy (AMRAP) sessions: 3 turns, PULL/PUSH/SQUAT reps (session.total).
 *  - Custom Workout sessions: one turn per distinct exercise name in the
 *    log, summed by name; capped at 5 turns (top 4 by volume + "ท่าที่เหลือ"
 *    for the rest) so a 15-exercise workout doesn't drag the cutscene out.
 * Auto-advances on a timer; tapping "ข้าม" jumps straight to the final
 * state. Either way it calls onDone() to hand off to the normal results
 * screen — nothing about that flow changes, this just runs first. */
function computeBattleTurns(session, isCustom) {
  if (isCustom === 'run') {
    return [{ label: 'RUN', dmg: session.xp || 0 }].filter(t => t.dmg > 0);
  }
  if (isCustom) {
    const byName = {};
    (session.exerciseLog || []).forEach(e => {
      byName[e.name] = (byName[e.name] || 0) + (e.repsOrSecDone || 0);
    });
    let turns = Object.keys(byName)
      .map(name => ({ label: name, dmg: byName[name] }))
      .filter(t => t.dmg > 0);
    if (turns.length > 5) {
      turns.sort((a, b) => b.dmg - a.dmg);
      const top = turns.slice(0, 4);
      const restDmg = turns.slice(4).reduce((s, t) => s + t.dmg, 0);
      turns = restDmg > 0 ? top.concat([{ label: 'ท่าที่เหลือ', dmg: restDmg }]) : top;
    }
    return turns.length ? turns : [{ label: 'TOTAL', dmg: totalVolumeOfCustomSession(session) }];
  }
  return [
    { label: 'PULL', dmg: session.total.pull },
    { label: 'PUSH', dmg: session.total.push },
    { label: 'SQUAT', dmg: session.total.squat }
  ].filter(t => t.dmg > 0);
}

function spawnFloatingDamage(stage, dmg, opts) {
  opts = opts || {};
  const el = document.createElement('div');
  el.className = 'floating-dmg' + (opts.crit ? ' crit' : '');
  el.textContent = '-' + dmg;
  // small random horizontal drift + start-x so repeated hits don't stack exactly
  const jitter = (Math.random() * 46 - 23).toFixed(1);
  el.style.left = 'calc(50% + ' + jitter + 'px)';
  stage.appendChild(el);
  el.addEventListener('animationend', () => el.remove());
}

let bossBattleTimer = null;
function startBossBattleCutscene(session, isCustom, onDone) {
  const sessionDmg = isCustom === 'run' ? (session.xp || 0) : (isCustom ? totalVolumeOfCustomSession(session) : session.total.reps);
  const afterState = currentBossState(); // session is already saved by the time this is called
  const beforeDamage = Math.max(0, afterState.damage - sessionDmg);
  const beforeHp = Math.max(0, afterState.targetHp - beforeDamage);
  const turns = computeBattleTurns(session, isCustom);

  const nameEl = document.getElementById('battleBossName');
  const tagEl = document.getElementById('battleBossTag');
  const stage = document.getElementById('battleBossStage');
  const hpFill = document.getElementById('battleHpFill');
  const hpLabel = document.getElementById('battleHpLabel');
  const logEl = document.getElementById('battleLog');
  const skipBtn = document.getElementById('battleSkipBtn');
  const startBtn = document.getElementById('battleStartBtn');
  if (!nameEl || !stage || !hpFill || !startBtn) { onDone(); return; }

  stage.querySelectorAll('.floating-dmg').forEach(n => n.remove());
  const fieldEl = stage.closest('.battle-field');
  if (fieldEl) {
    if (afterState.boss.bg) {
      fieldEl.style.setProperty('--battle-field-img', 'url("' + afterState.boss.bg + '")');
      fieldEl.classList.add('has-photo');
    } else {
      fieldEl.style.removeProperty('--battle-field-img');
      fieldEl.classList.remove('has-photo');
    }
  }
  nameEl.textContent = afterState.boss.name;
  if (tagEl) tagEl.textContent = afterState.boss.tag;
  stage.querySelector('.boss-art').innerHTML = bossSilhouetteMarkup(afterState.boss.id);
  stage.closest('.boss-card').style.setProperty('--boss-accent-rgb', hexToRgbTriplet(afterState.boss.accent));
  stage.classList.remove('boss-defeated', 'boss-critical', 'boss-hit', 'boss-explode');

  const setHp = (hp) => {
    const pct = afterState.targetHp > 0 ? Math.max(0, Math.min(1, hp / afterState.targetHp)) : 0;
    hpFill.style.width = Math.round(pct * 100) + '%';
    hpLabel.textContent = Math.round(hp) + ' / ' + afterState.targetHp + ' HP';
    stage.classList.toggle('boss-critical', hp > 0 && pct <= 0.25);
  };
  setHp(beforeHp);
  logEl.textContent = 'พร้อมลุยหรือยัง?';

  let hp = beforeHp;
  let i = 0;
  let finished = false;
  let started = false;
  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(bossBattleTimer);
    bossBattleTimer = null;
    skipBtn.onclick = null;
    startBtn.onclick = null;
    startBtn.classList.remove('show');
    setHp(Math.max(0, afterState.targetHp - afterState.damage));
    if (afterState.defeated) {
      stage.classList.add('boss-defeated');
      logEl.textContent = afterState.boss.name + ' ล้มลง!';
    }
    setTimeout(onDone, afterState.defeated ? 900 : 350);
  }
  function step() {
    if (i >= turns.length) { finish(); return; }
    const turn = turns[i++];
    hp = Math.max(0, hp - turn.dmg);
    stage.classList.remove('boss-hit');
    void stage.offsetWidth;
    stage.classList.add('boss-hit');
    setHp(hp);
    spawnFloatingDamage(stage, turn.dmg, { crit: i === turns.length && hp <= 0 });
    logEl.textContent = turn.label + ' x' + turn.dmg + ' — โจมตี!';
    vibrate([30]);
    bossBattleTimer = setTimeout(step, 1500); // slow enough to actually read each hit before the next one lands
  }
  function begin() {
    if (started) return;
    started = true;
    startBtn.onclick = null;
    startBtn.classList.remove('show');
    logEl.textContent = 'เตรียมตัว...';
    bossBattleTimer = setTimeout(step, 500);
  }
  skipBtn.onclick = finish;
  startBtn.onclick = begin;
  startBtn.classList.add('show');
}


function renderBossCountdown() {
  const el = document.getElementById('bossCountdown');
  if (!el) return;
  const now = new Date();
  const end = weekStart(now.getTime());
  end.setDate(end.getDate() + 7);
  const ms = Math.max(0, end.getTime() - now.getTime());
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  el.textContent = `เหลือเวลา ${days} วัน ${hours} ชม. ${minutes} นาที`;
}

function renderBossViewList() {
  const list = document.getElementById('bossViewList');
  if (!list) return;
  const state = currentBossState();
  const idx = BOSS_ROSTER.findIndex(b => b.id === state.boss.id);
  const modifierEl = document.getElementById('bossViewModifier');
  if (modifierEl) {
    const mod = currentBossModifier();
    modifierEl.innerHTML = 'สัปดาห์นี้: <strong>"' + mod.name + '"</strong> — ' + mod.desc;
  }
  renderBossDmgBreakdown('bossViewDmgBreakdown');
  renderBossJourneySummary(state);
  const counts = loadBossDefeatCounts();
  list.innerHTML = BOSS_ROSTER.map((boss, i) => {
    const current = boss.id === state.boss.id;
    const next = i === (idx + 1) % BOSS_ROSTER.length;
    const count = counts[boss.id] || 0;
    const mastery = bossMasteryFor(count);
    const masteryLine = count > 0
      ? ('ปราบมาแล้ว ' + count + ' ครั้ง · <span style="color:' + mastery.color + ';font-weight:800;">' + mastery.label + '</span>'
        + (mastery.next ? ' · อีก ' + mastery.next.remaining + ' ครั้ง → ' + mastery.next.label : ''))
      : mastery.label;
    return `<div class="boss-view-item${current ? ' current' : ''}">
      <div class="boss-view-item-top">
        <div>
          ${boss.chapter ? `<div class="boss-view-item-chapter">${bossChapterLabel(boss)}</div>` : ''}
          <div class="boss-view-item-name">${boss.name}</div>
          <div class="boss-view-item-tag">${boss.tag}</div>
        </div>
        <div class="boss-view-item-status">${current ? 'CURRENT' : (next ? 'NEXT WEEK' : 'UPCOMING')}</div>
      </div>
      <div class="boss-view-item-mastery">${masteryLine}</div>
      ${boss.story ? `<div class="boss-view-item-story">${boss.story}</div>` : ''}
    </div>`;
  }).join('');
}

/* ---- Lifetime journey summary — sits above the per-boss list in the
 * Boss Archive. Two numbers that never reset with the weekly fight:
 * which lap of the roster the player is currently on (HP target climbs
 * every lap — see currentBossState()) and how many boss kills they've
 * racked up in total, lifetime, across every boss. This is the actual
 * long-term counter; the weekly HP bar above it is just this week's step
 * toward it. */
function renderBossJourneySummary(state) {
  const wrap = document.getElementById('bossJourneySummary');
  if (!wrap) return;
  const lap = Math.floor(state.weekIndex / BOSS_ROSTER.length) + 1;
  const counts = loadBossDefeatCounts();
  const totalKills = Object.values(counts).reduce((a, b) => a + b, 0);
  wrap.innerHTML = '<div class="boss-journey-stat"><div class="v">LAP ' + lap + '</div><div class="l">รอบที่กำลังเดินทาง</div></div>'
    + '<div class="boss-journey-stat"><div class="v">' + totalKills + '</div><div class="l">ปราบบอสสะสมตลอดกาล</div></div>';
}

/* ================= WORLD MAP (product doc #10) =================
 * Content-layer visualization of the Chapter progression above — a fixed
 * path of areas from Training Camp through each boss's territory, in the
 * same order BOSS_ROSTER already cycles. No new gameplay data: "unlocked"
 * is derived purely from currentBossState() (which boss is live right now)
 * and loadBossEverDefeated() (has this boss ever fallen), so it can never
 * drift out of sync with the Boss Fight card or Boss Archive above. */
const WORLD_MAP_NODES = [
  { id: 'campsite', name: 'TRAINING CAMP', kind: 'hub', desc: 'จุดเริ่มต้นของทุกการเดินทาง — ทดสอบร่างกายจริงของคุณที่นี่' },
  { id: 'grinder1', name: 'SCRAP YARD', bossId: 'grinder1' },
  { id: 'ironmaw', name: 'IRON FORTRESS', bossId: 'ironmaw' },
  { id: 'void9', name: 'VOID ZONE', bossId: 'void9' },
  { id: 'wingreaper', name: 'SKY CITADEL', bossId: 'wingreaper' },
  { id: 'corezero', name: 'CORE REACTOR', bossId: 'corezero' }
];
/** true once the player has reached-or-passed this area at least once —
 * either by lapping the whole roster already (lap >= 1, meaning every
 * boss has appeared at least once), by currently being at-or-past this
 * boss's roster position this lap, or by having defeated it in any past
 * lap. Mirrors the same idx/lap math currentBossState() already computes. */
function worldMapNodeUnlocked(node, state) {
  if (node.kind === 'hub') return true;
  const idx = BOSS_ROSTER.findIndex(b => b.id === node.bossId);
  const currentIdx = BOSS_ROSTER.findIndex(b => b.id === state.boss.id);
  const lap = Math.floor(state.weekIndex / BOSS_ROSTER.length);
  if (lap >= 1) return true;
  if (idx <= currentIdx) return true;
  return loadBossEverDefeated().indexOf(node.bossId) !== -1;
}
function renderWorldMapList() {
  const wrap = document.getElementById('worldMapList');
  if (!wrap) return;
  const state = currentBossState();
  wrap.innerHTML = WORLD_MAP_NODES.map(node => {
    const boss = node.bossId ? BOSS_ROSTER.find(b => b.id === node.bossId) : null;
    const isCurrent = boss && boss.id === state.boss.id;
    const unlocked = worldMapNodeUnlocked(node, state);
    const defeatedEver = boss && loadBossEverDefeated().indexOf(boss.id) !== -1;
    let statusHtml;
    if (isCurrent) statusHtml = 'CURRENT';
    else if (!unlocked) statusHtml = 'LOCKED';
    else if (defeatedEver) statusHtml = 'CLEARED';
    else statusHtml = 'VISITED';
    return `<div class="boss-view-item${isCurrent ? ' current' : ''}${!unlocked ? ' worldmap-locked' : ''}">
      <div class="boss-view-item-top">
        <div>
          ${boss ? `<div class="boss-view-item-chapter">${bossChapterLabel(boss)}</div>` : ''}
          <div class="boss-view-item-name">${node.name}</div>
          ${boss ? `<div class="boss-view-item-tag">${boss.tag}</div>` : (node.desc ? `<div class="boss-view-item-tag">${node.desc}</div>` : '')}
        </div>
        <div class="boss-view-item-status">${statusHtml}</div>
      </div>
    </div>`;
  }).join('');
}
function openWorldMap() {
  const modal = document.getElementById('worldMapModal');
  if (!modal) return;
  renderWorldMapList();
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}
function closeWorldMap() {
  const modal = document.getElementById('worldMapModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}
function initWorldMap() {
  const btn = document.getElementById('worldMapBtn');
  if (btn) btn.addEventListener('click', openWorldMap);
  document.querySelectorAll('[data-worldmap-close]').forEach(el => el.addEventListener('click', closeWorldMap));
}

function openBossView() {
  const modal = document.getElementById('bossViewModal');
  if (!modal) return;
  renderBossViewList();
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}

function closeBossView() {
  const modal = document.getElementById('bossViewModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}

function initBossView() {
  const btn = document.getElementById('bossViewBtn');
  if (btn) btn.addEventListener('click', openBossView);
  const infoBtn = document.getElementById('bossInfoBtn');
  if (infoBtn) infoBtn.addEventListener('click', openBossView);
  document.querySelectorAll('[data-boss-close]').forEach(el => el.addEventListener('click', closeBossView));
}

/* ---- Boss Phase bands ---- 100-70% NORMAL, 70-40% ARMOR BREAK,
 * 40-10% RAGE, <10% CRITICAL. Order matters: first match wins, checked
 * high-to-low against the same hp% already driving the HP bar. */
const BOSS_PHASES = [
  { key: 'normal', label: 'NORMAL', min: 0.7, desc: 'บอสอยู่ในสภาวะปกติ' },
  { key: 'armorbreak', label: 'ARMOR BREAK', min: 0.4, desc: 'เกราะเริ่มแตก — HP ต่ำกว่า 70%' },
  { key: 'rage', label: 'RAGE', min: 0.1, desc: 'บอสเข้าสู่ความบ้าคลั่ง — HP ต่ำกว่า 40%' },
  { key: 'critical', label: 'CRITICAL', min: 0, desc: 'ใกล้พ่ายแพ้แล้ว — HP ต่ำกว่า 10%' }
];
function bossPhaseFor(pct) {
  return BOSS_PHASES.find(p => pct >= p.min) || BOSS_PHASES[BOSS_PHASES.length - 1];
}

/* ---- 4-node phase progress strip (boss-fight redesign, 2026-08) ----
 * Purely a re-render of BOSS_PHASES against the current phase — same data
 * bossPhaseFor() already resolves for the label/HP bar, so this can't show
 * a phase the rest of the card disagrees with. done = phases already
 * passed (lower min than current), active = current phase, locked = phases
 * still ahead. When the boss is defeated, every node shows done. */
const BOSS_PHASE_ICON_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6"/></svg>';
const BOSS_PHASE_ICON_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V7.5a4 4 0 018 0V11"/></svg>';
function renderBossPhaseNodes(currentPhase, defeated) {
  const wrap = document.getElementById('bossPhaseNodes');
  if (!wrap) return;
  const currentIdx = defeated ? BOSS_PHASES.length : BOSS_PHASES.findIndex(p => p === currentPhase);
  wrap.innerHTML = BOSS_PHASES.map((p, i) => {
    let state = 'locked', inner = '<span>' + (i + 1) + '</span>';
    if (defeated || i < currentIdx) { state = 'done'; inner = BOSS_PHASE_ICON_CHECK; }
    else if (i === currentIdx) { state = 'active'; inner = '<span>' + (i + 1) + '</span>'; }
    else { inner = BOSS_PHASE_ICON_LOCK; }
    const arrow = i < BOSS_PHASES.length - 1 ? '<div class="phase-arrow">&rarr;</div>' : '';
    return '<div class="phase-node ' + state + '"><div class="phase-node-circle">' + inner + '</div>' +
      '<div class="phase-node-lbl">PHASE ' + (i + 1) + '</div>' +
      '<div class="phase-node-sub">' + p.label + '</div></div>' + arrow;
  }).join('');
}

function renderBossCard() {
  const nameEl = document.getElementById('bossName');
  const tagEl = document.getElementById('bossTag');
  const hpFill = document.getElementById('bossHpFill');
  const hpLabel = document.getElementById('bossHpLabel');
  const stage = document.getElementById('bossStage');
  if (!nameEl || !hpFill || !stage) return;

  const state = currentBossState();
  renderBossCountdown();
  nameEl.textContent = state.boss.name;
  if (tagEl) tagEl.textContent = state.boss.tag;
  const chapterEl = document.getElementById('bossChapterLabel');
  if (chapterEl) chapterEl.textContent = bossChapterLabel(state.boss);
  const modifierEl = document.getElementById('bossModifierLabel');
  if (modifierEl) {
    const mod = currentBossModifier();
    modifierEl.innerHTML = '&ldquo;' + mod.name + '&rdquo;';
    modifierEl.title = mod.desc;
  }
  if (stage.dataset.bossId !== state.boss.id) {
    stage.dataset.bossId = state.boss.id;
    const art = stage.querySelector('.boss-art');
    if (art) art.innerHTML = bossSilhouetteMarkup(state.boss.id);
  }
  const bossCard = stage.closest('.boss-card');
  if (bossCard) {
    bossCard.style.setProperty('--boss-accent-rgb', hexToRgbTriplet(state.boss.accent));
    // Per-boss backdrop photo — same --backdrop-img + .has-backdrop convention
    // as the mascot-card/character-hero backdrops (see applyBackdropToEl).
    if (state.boss.bg) {
      bossCard.style.setProperty('--boss-backdrop-img', 'url("' + state.boss.bg + '")');
      bossCard.classList.add('has-backdrop');
    } else {
      bossCard.classList.remove('has-backdrop');
    }
  }

  const pct = state.targetHp > 0 ? Math.max(0, Math.min(1, state.hp / state.targetHp)) : 0;
  hpFill.style.width = Math.round(pct * 100) + '%';
  if (hpLabel) hpLabel.textContent = Math.round(state.hp) + ' / ' + state.targetHp + ' HP';

  stage.classList.toggle('boss-defeated', state.defeated);

  /* ---- Boss Phase — 4 HP bands, purely a presentation layer read off
   * the same pct already computed above (100-70 / 70-40 / 40-10 / <10),
   * same class-toggle pattern the old single "boss-critical" threshold
   * used. Fires a one-time toast+buzz only when the phase actually
   * changes, tracked via stage.dataset so it doesn't refire every render. */
  const phase = state.defeated ? null : bossPhaseFor(pct);
  BOSS_PHASES.forEach(p => stage.classList.remove('boss-phase-' + p.key));
  const phaseLabelEl = document.getElementById('bossPhaseLabel');
  const phaseDescEl = document.getElementById('bossPhaseDesc');
  if (phase) {
    stage.classList.add('boss-phase-' + phase.key);
    if (phaseLabelEl) {
      phaseLabelEl.textContent = phase.label;
      BOSS_PHASES.forEach(p => phaseLabelEl.classList.remove('phase-' + p.key));
      phaseLabelEl.classList.add('phase-' + phase.key);
    }
    if (phaseDescEl) phaseDescEl.textContent = phase.desc;
    const phaseKey = state.weekIndex + '_' + phase.key;
    if (stage.dataset.bossPhase !== phaseKey) {
      const isFirstRenderThisFight = !stage.dataset.bossPhase || stage.dataset.bossPhase.split('_')[0] !== String(state.weekIndex);
      stage.dataset.bossPhase = phaseKey;
      if (!isFirstRenderThisFight && phase.key !== 'normal') {
        showToast(state.boss.name + ' เข้าสู่ ' + phase.label, 'alert');
        vibrate([40, 30, 40]);
      }
    }
  } else if (phaseLabelEl) {
    phaseLabelEl.textContent = state.defeated ? 'DEFEATED' : '';
    if (phaseDescEl) phaseDescEl.textContent = state.defeated ? 'ปราบบอสตัวนี้สำเร็จแล้วในสัปดาห์นี้' : '';
  }
  renderBossPhaseNodes(phase, state.defeated);

  const weekKey = bossWeekKey(state.weekIndex);
  const lastSeenDmgKey = KEY_BOSS_DEFEAT_SEEN + '_dmg_' + weekKey;
  const lastSeenDmg = parseFloat(localStorage.getItem(lastSeenDmgKey) || '0');
  const artEl = stage.querySelector('.boss-art');
  const boomEl = stage.querySelector('.boss-boom');
  if (state.damage > lastSeenDmg && !state.defeated) {
    stage.classList.remove('boss-hit');
    void stage.offsetWidth;
    stage.classList.add('boss-hit');
    if (artEl) artEl.addEventListener('animationend', () => stage.classList.remove('boss-hit'), { once: true });
  }
  localStorage.setItem(lastSeenDmgKey, String(state.damage));

  if (state.defeated && loadBossDefeatSeenWeek() !== weekKey) {
    saveBossDefeatSeenWeek(weekKey);
    stage.classList.remove('boss-explode');
    void stage.offsetWidth;
    stage.classList.add('boss-explode');
    if (boomEl) boomEl.addEventListener('animationend', () => stage.classList.remove('boss-explode'), { once: true });
    vibrate([80, 50, 80, 50, 160]);

    const everDefeated = loadBossEverDefeated();
    const firstTimeEver = everDefeated.indexOf(state.boss.id) === -1;
    if (firstTimeEver) {
      everDefeated.push(state.boss.id);
      saveBossEverDefeated(everDefeated);
    }
    const bossDefeatCount = bumpBossDefeatCount(state.boss.id);
    const masteryBefore = bossMasteryFor(bossDefeatCount - 1);
    const masteryAfter = bossMasteryFor(bossDefeatCount);
    addSeasonPoints(SEASON_POINTS_BOSS_DEFEAT); // product doc #20 — once per weekly defeat, guarded by loadBossDefeatSeenWeek() above
    const loot = rollLootDrop(state);
    const lootCount = addLootItem(loot.id);
    const lootRarity = rarityDef(loot.rarity);
    const lootIsPremium = loot.rarity === 'epic' || loot.rarity === 'mythic';
    // Boss-kill celebration + (if new) skin-unlock celebration both queue
    // here via queueCelebration() — same queue a level-up push from
    // renderXpBar lands in, so if this kill also crosses a level threshold
    // the player sees all of it, one moment at a time, instead of only
    // whichever fired last.
    queueCelebration({
      icon: 'gift',
      title: '[' + lootRarity.label + '] ' + loot.name + (lootCount > 1 ? ' x' + lootCount : ''),
      subtitle: 'ปราบ ' + state.boss.name + ' สำเร็จ!',
      rarityLabel: '★ ' + lootRarity.label + ' ★',
      accent: lootRarity.c2,
      premium: lootIsPremium
    });
    if (firstTimeEver) {
      queueCelebration({
        icon: 'palette',
        title: 'ปลดล็อคสกินใหม่!',
        subtitle: state.boss.name,
        rarityLabel: '★ NEW SKIN ★',
        accent: state.boss.accent,
        premium: true
      });
    }
    if (masteryAfter.label !== masteryBefore.label) {
      queueCelebration({
        icon: 'crown',
        title: masteryAfter.label,
        subtitle: state.boss.name + ' · ปราบมาแล้ว ' + bossDefeatCount + ' ครั้ง',
        rarityLabel: '★ MASTERY UP ★',
        accent: state.boss.accent,
        premium: true
      });
    }
  }
  renderBossAttackLog();
}

/* ---- Home boss teaser — compact always-visible status row that replaced
 * the full boss-card on Home (see product doc: "แยกบอสออกจาก Home"). Full
 * fight detail (phase art, damage breakdown, modifier, chapter/story,
 * attack log) now lives on screen-bossfight, rendered by renderBossCard()
 * above — that function still owns every side effect (phase-change toast,
 * defeat/loot roll) since it runs every Home render regardless of whether
 * the player ever opens the full screen. This function only paints the
 * small summary row: name, phase tag, thin HP bar. Reads the exact same
 * currentBossState()/bossPhaseFor() the full card uses, so the two never
 * drift out of sync with each other. */
function renderBossTeaser() {
  const card = document.getElementById('bossTeaserCard');
  const nameEl = document.getElementById('bossTeaserName');
  const phaseEl = document.getElementById('bossTeaserPhase');
  const hpFill = document.getElementById('bossTeaserHpFill');
  const hpLabel = document.getElementById('bossTeaserHpLabel');
  const thumb = document.getElementById('bossTeaserThumb');
  if (!card || !nameEl || !hpFill) return;

  const state = currentBossState();
  nameEl.textContent = state.boss.name;
  card.style.setProperty('--boss-accent-rgb', hexToRgbTriplet(state.boss.accent));

  if (thumb && thumb.dataset.bossId !== state.boss.id) {
    thumb.dataset.bossId = state.boss.id;
    thumb.innerHTML = bossSilhouetteMarkup(state.boss.id);
  }

  const pct = state.targetHp > 0 ? Math.max(0, Math.min(1, state.hp / state.targetHp)) : 0;
  hpFill.style.width = Math.round(pct * 100) + '%';
  if (hpLabel) hpLabel.textContent = Math.round(state.hp) + ' / ' + state.targetHp + ' HP';

  const phase = state.defeated ? null : bossPhaseFor(pct);
  if (phaseEl) {
    BOSS_PHASES.forEach(p => phaseEl.classList.remove('phase-' + p.key));
    if (phase) {
      phaseEl.textContent = phase.label;
      phaseEl.classList.add('phase-' + phase.key);
    } else {
      phaseEl.textContent = 'CLEARED';
    }
  }
  card.classList.toggle('boss-teaser-defeated', state.defeated);
  card.classList.toggle('boss-teaser-critical', !!phase && phase.key === 'critical');
}

/* ---- boss attack log (Home boss card) — replaces the always-visible
 * PULL/PUSH/SQUAT/CUSTOM breakdown that used to sit in this spot. That
 * view read as a static weekly stat table and looked broken whenever a
 * player trained in only one category (three 0-width bars taking up
 * space for no reason). This instead lists each session that hit the
 * boss this week as its own entry — same underlying data (Cindy +
 * Custom sessions since weekStart(), same as currentBossState() /
 * currentBossDamageBreakdown() use, so the log's numbers always match
 * the HP bar exactly), just presented as "things that happened" instead
 * of a totals table. The category totals table still exists — it moved
 * into the VIEW archive modal (renderBossDmgBreakdown below) since it's
 * reference detail worth keeping, just not something that needs to
 * occupy the main card on every visit. */
const BOSS_ATTACK_LOG_LIMIT = 8;
function currentWeekBossAttackLog() {
  const startTs = weekStart(Date.now()).getTime();
  const cardioIds = new Set(CARDIO_PRESETS.map(p => p.id));
  const cindyItems = loadSessions()
    .filter(s => s.finished >= startTs)
    .map(s => ({ ts: s.finished, tag: 'CINDY', dmg: s.total ? s.total.reps : 0 }));
  const customItems = loadCustomWorkoutSessions()
    .filter(s => s.completedAt >= startTs)
    .map(s => ({
      ts: s.completedAt,
      tag: (s.workoutName || (cardioIds.has(s.workoutId) ? 'CARDIO' : 'CUSTOM')).toUpperCase(),
      dmg: totalVolumeOfCustomSession(s)
    }));
  return cindyItems.concat(customItems)
    .filter(item => item.dmg > 0)
    .sort((a, b) => b.ts - a.ts);
}
function fmtClockTime(ts) {
  const d = new Date(ts);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}
function renderBossAttackLog(containerId) {
  const wrap = document.getElementById(containerId || 'bossAttackLog');
  if (!wrap) return;
  const entries = currentWeekBossAttackLog();
  if (entries.length === 0) {
    wrap.innerHTML = '<div class="boss-attack-log-empty">ยังไม่มีการโจมตีในสัปดาห์นี้ — เริ่มออกกำลังกายเพื่อตีบอส</div>';
    return;
  }
  const shown = entries.slice(0, BOSS_ATTACK_LOG_LIMIT);
  const rowsHtml = shown.map(item =>
    '<div class="boss-attack-log-item">'
    + '<div class="boss-attack-log-meta">'
    + '<div class="boss-attack-log-tag">' + escapeHtml(item.tag) + '</div>'
    + '<div class="boss-attack-log-time">' + fmtClockTime(item.ts) + '</div>'
    + '</div>'
    + '<div class="boss-attack-log-dmg">-' + item.dmg + '</div>'
    + '</div>'
  ).join('');
  const moreHtml = entries.length > shown.length
    ? '<div class="boss-attack-log-more">+' + (entries.length - shown.length) + ' ครั้งก่อนหน้านี้</div>'
    : '';
  wrap.innerHTML = rowsHtml + moreHtml;
}

/* ---- elemental damage breakdown ----
 * Same weekly damage total as above, split into 5 buckets so the chart
 * reflects each mode's actual role: PULL/PUSH/SQUAT come from Cindy
 * (special, played rarely but heavy), CUSTOM is Custom Workout volume
 * (the main damage source since it's played most often), and CARDIO is
 * the smaller optional top-up. Custom Workout sessions and Cardio sessions
 * both live in KEY_CUSTOM_SESSIONS and are told apart the same way
 * renderProgramHubCards() does it: by workoutId matching a CARDIO_PRESETS
 * id. CUSTOM and CARDIO rows are only shown when actually nonzero this week. */
function currentBossDamageBreakdown() {
  const startTs = weekStart(Date.now()).getTime();
  const cindyThisWeek = loadSessions().filter(s => s.finished >= startTs);
  const pull = cindyThisWeek.reduce((sum, s) => sum + (s.total ? s.total.pull : 0), 0);
  const push = cindyThisWeek.reduce((sum, s) => sum + (s.total ? s.total.push : 0), 0);
  const squat = cindyThisWeek.reduce((sum, s) => sum + (s.total ? s.total.squat : 0), 0);

  const cardioIds = new Set(CARDIO_PRESETS.map(p => p.id));
  const customSessionsThisWeek = loadCustomWorkoutSessions().filter(s => s.completedAt >= startTs);
  const custom = customSessionsThisWeek
    .filter(s => !cardioIds.has(s.workoutId))
    .reduce((sum, s) => sum + totalVolumeOfCustomSession(s), 0);
  const cardio = customSessionsThisWeek
    .filter(s => cardioIds.has(s.workoutId))
    .reduce((sum, s) => sum + totalVolumeOfCustomSession(s), 0);

  const runSessionsThisWeek = loadRunSessions().filter(s => s.completedAt >= startTs);
  const run = runSessionsThisWeek.reduce((sum, s) => sum + (s.xp || 0), 0);

  return { pull, push, squat, custom, cardio, run };
}
/* ---- category totals table (was on Home, moved into the VIEW archive
 * modal — see boss attack log comment above for why) — rendered by
 * renderBossViewList()/openBossView() now, not on every Home render. */
function renderBossDmgBreakdown(containerId) {
  const wrap = document.getElementById(containerId || 'bossViewDmgBreakdown');
  if (!wrap) return;
  const dmg = currentBossDamageBreakdown();
  const rows = [
    { label: 'PULL', val: dmg.pull, color: 'var(--pull)' },
    { label: 'PUSH', val: dmg.push, color: 'var(--push)' },
    { label: 'SQUAT', val: dmg.squat, color: 'var(--squat)' }
  ];
  if (dmg.custom > 0) rows.push({ label: 'CUSTOM', val: dmg.custom, color: 'var(--success)' });
  if (dmg.cardio > 0) rows.push({ label: 'CARDIO', val: dmg.cardio, color: 'var(--danger)' });
  if (dmg.run > 0) rows.push({ label: 'RUN', val: dmg.run, color: 'var(--run)' });
  const maxVal = Math.max(1, ...rows.map(r => r.val));
  wrap.innerHTML = rows.map(r => {
    const pct = Math.round((r.val / maxVal) * 100);
    return '<div class="boss-dmg-row">'
      + '<div class="boss-dmg-name" style="color:' + r.color + ';">' + r.label + '</div>'
      + '<div class="boss-dmg-track"><div class="boss-dmg-fill" style="width:' + pct + '%;background:' + r.color + ';"></div></div>'
      + '<div class="boss-dmg-val">' + r.val + '</div>'
      + '</div>';
  }).join('');
}
function fmtDate(ts) {
  const d = new Date(ts);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}
function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}
/** icon is an optional ICONS key — renders a small line icon before the
 * message (replaces the old inline emoji in a few notable toasts). */
function showToast(msg, icon) {
  const t = document.getElementById('toast');
  t.innerHTML = (icon ? '<span class="icon-inline toast-icon">' + (ICONS[icon] || '') + '</span>' : '') + '<span>' + msg + '</span>';
  t.classList.add('show');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.classList.remove('show'), 1600);
}

/* ================= CELEBRATION OVERLAY (full-screen reward moment) =================
 * A bigger, more ceremonial notification than showToast() above — reserved
 * for "you earned something" moments: level-ups and loot drops. showToast
 * stays as-is for routine notices (phase changes, connection status, etc).
 *
 * Callers never touch the DOM directly — they call queueCelebration({icon,
 * title, subtitle, accent}), which pushes onto _celebrationQueue and plays
 * them one at a time. This matters because some reward moments fire
 * multiple celebrations in the same tick (e.g. a boss kill awards loot AND
 * can push the player over a level-up threshold in the same renderBossCard
 * → renderXpBar pass) — without a queue the second call would just cut off
 * or overwrite the first mid-animation.
 *
 * icon: an ICONS key (see iconHtml()). title/subtitle: plain text, already
 * translated/formatted by the caller. accent: a hex color driving the
 * badge ring + glow + particle color (rarity color for loot, rank color
 * for level-ups) — falls back to the CSS default (warning amber) if
 * omitted. */
const CELEBRATION_DURATION_MS = 2200;
const CELEBRATION_DURATION_MS_PREMIUM = 3000; // epic/mythic loot + skin unlocks get a longer hold to read as a bigger moment
const CELEBRATION_GAP_MS = 220;
const _celebrationQueue = [];
let _celebrationActive = false;
let _celebrationTimer = null;

function queueCelebration(opts) {
  _celebrationQueue.push(opts || {});
  _runCelebrationQueue();
}
function _runCelebrationQueue() {
  if (_celebrationActive || _celebrationQueue.length === 0) return;
  _celebrationActive = true;
  _renderCelebration(_celebrationQueue.shift());
}
function _renderCelebration(opts) {
  const overlay = document.getElementById('celebrationOverlay');
  const badge = document.getElementById('celebrationBadge');
  const rarityEl = document.getElementById('celebrationRarity');
  const titleEl = document.getElementById('celebrationTitle');
  const subtitleEl = document.getElementById('celebrationSubtitle');
  const rankupEl = document.getElementById('celebrationRankup');
  if (!overlay || !badge || !titleEl || !subtitleEl) { // markup missing — don't jam the queue
    _celebrationActive = false;
    return;
  }
  const color = opts.accent || '#FFB020';
  overlay.style.setProperty('--cel-color', color);
  overlay.style.setProperty('--cel-rgb', hexToRgbTriplet(color));
  overlay.classList.toggle('variant-levelup', opts.variant === 'levelup');
  overlay.classList.toggle('tier-premium', !!opts.premium);
  badge.innerHTML = opts.icon ? iconHtml(opts.icon) : '';
  if (rarityEl) rarityEl.textContent = opts.rarityLabel || '';
  titleEl.textContent = opts.title || '';
  subtitleEl.textContent = opts.subtitle || '';
  if (rankupEl) {
    if (opts.rankup) { rankupEl.textContent = opts.rankup; rankupEl.classList.add('show'); }
    else { rankupEl.textContent = ''; rankupEl.classList.remove('show'); }
  }

  // particle burst — regenerated fresh each call (evenly spaced angles with
  // a little jitter) so repeats don't all look identical. Premium moments
  // (epic/mythic loot, skin unlocks) get a denser burst so the reveal
  // itself feels like a bigger deal, not just a bigger badge.
  const burst = overlay.querySelector('.celebration-burst');
  burst.querySelectorAll('.celebration-particle').forEach(p => p.remove());
  const count = opts.premium ? 16 : 10;
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + (Math.random() * 0.4 - 0.2);
    const dist = 55 + Math.random() * 35;
    const p = document.createElement('div');
    p.className = 'celebration-particle';
    p.style.setProperty('--px', Math.round(Math.cos(angle) * dist) + 'px');
    p.style.setProperty('--py', Math.round(Math.sin(angle) * dist) + 'px');
    p.style.animationDelay = (Math.random() * 0.12).toFixed(2) + 's';
    burst.appendChild(p);
  }

  overlay.classList.add('show');
  if (opts.premium) {
    vibrate([50, 30, 50, 30, 120]);
    beep(659, 90, 0.15);
    setTimeout(() => beep(880, 90, 0.16), 100);
    setTimeout(() => beep(1175, 160, 0.18), 200);
  } else {
    vibrate([50, 30, 50]);
  }
  clearTimeout(_celebrationTimer);
  const duration = opts.premium ? CELEBRATION_DURATION_MS_PREMIUM : CELEBRATION_DURATION_MS;
  _celebrationTimer = setTimeout(dismissCelebration, duration);
}
/** Ends the current celebration early (tap-to-dismiss) or via its own
 * timeout, then — after a short gap so the fade-out isn't cut off by the
 * next one popping in instantly — advances the queue. */
function dismissCelebration() {
  const overlay = document.getElementById('celebrationOverlay');
  if (!overlay || !overlay.classList.contains('show')) return;
  clearTimeout(_celebrationTimer);
  overlay.classList.remove('show');
  setTimeout(() => {
    _celebrationActive = false;
    _runCelebrationQueue();
  }, CELEBRATION_GAP_MS);
}

/* ================= SYSTEM CORE — PLAYER STATUS (dev brief §6/§7) =================
 * Single aggregator over data that's already computed elsewhere (XP/Level,
 * Rank, Combat Power, Fitness Power, Streak) — nothing new is stored here.
 * This is the canonical "Player Status" object: any future screen (Status
 * tab, System Window body, share card) reads from here instead of each
 * re-deriving level/rank/power on its own, so they can never drift out of
 * sync with each other. */
function getPlayerStatus() {
  const info = computeLevelInfo(computeTotalXP());
  const rank = rankForLevel(info.level);
  const bodyTotals = loadStatTotals();
  const lifeTotals = loadLifeStatTotals();
  return {
    level: info.level,
    xpIntoLevel: info.xpIntoLevel,
    xpForNextLevel: info.xpForNextLevel,
    xpPct: info.pct,
    rank: rank.title,
    rankIcon: rank.icon,
    combatPower: computeCombatPower(),
    fitnessPower: computeFitnessPower(),
    streak: computeCombinedStreak(),
    bodyStats: STAT_DEFS.map(def => Object.assign({ key: def.key, label: def.label, short: def.short }, computeStatInfo(bodyTotals[def.key]))),
    lifeStats: LIFE_STAT_DEFS.map(def => Object.assign({ key: def.key, label: def.label, short: def.short }, computeLifeStatInfo(lifeTotals[def.key])))
  };
}

/* ================= SYSTEM WINDOW (dev brief §10/§11) =================
 * The "you have a System" notification banner — sits between .toast
 * (routine, no ceremony) and the full-screen celebration overlay
 * (level-up/loot only, see queueCelebration above). Used for events that
 * are real progress but happen often enough that a full-screen takeover
 * would get old fast: quest complete today; rank-up / skill-unlock /
 * boss-clear can call the same showSystemEvent() in later phases.
 *
 * Feature code never touches the DOM directly — call showSystemEvent({
 *   header,   // small eyebrow line, e.g. "QUEST COMPLETE"
 *   title,    // e.g. the quest/skill/boss name
 *   rewards,  // array of strings, e.g. ["+120 EXP", "+2 STR"]
 *   accent    // optional hex color, defaults to system blue
 * }). Queued the same way celebrations are queued, so two events firing
 * in the same tick (e.g. claiming two quests back to back) play one after
 * another instead of the second cutting the first's animation off. */
const SYSTEM_WINDOW_DURATION_MS = 2400;
const SYSTEM_WINDOW_GAP_MS = 200;
const _systemWindowQueue = [];
let _systemWindowActive = false;
let _systemWindowTimer = null;

function showSystemEvent(opts) {
  _systemWindowQueue.push(opts || {});
  _runSystemWindowQueue();
}
function _runSystemWindowQueue() {
  if (_systemWindowActive || _systemWindowQueue.length === 0) return;
  _systemWindowActive = true;
  _renderSystemWindow(_systemWindowQueue.shift());
}
function _renderSystemWindow(opts) {
  const win = document.getElementById('systemWindow');
  const headerEl = document.getElementById('systemWindowHeader');
  const titleEl = document.getElementById('systemWindowTitle');
  const rewardsEl = document.getElementById('systemWindowRewards');
  if (!win || !headerEl || !titleEl || !rewardsEl) { // markup missing — don't jam the queue
    _systemWindowActive = false;
    return;
  }
  const color = opts.accent || '#3D6FE0';
  win.style.setProperty('--sys-color', color);
  win.style.setProperty('--sys-rgb', hexToRgbTriplet(color));
  headerEl.textContent = opts.header || '';
  titleEl.textContent = opts.title || '';
  rewardsEl.innerHTML = (opts.rewards || []).map(r => '<span>' + r + '</span>').join('');

  win.classList.add('show');
  vibrate([30, 20, 30]);
  clearTimeout(_systemWindowTimer);
  _systemWindowTimer = setTimeout(dismissSystemWindow, SYSTEM_WINDOW_DURATION_MS);
}
/** Ends the current System Window early (tap-to-dismiss) or via its own
 * timeout, then advances the queue after a short gap so the fade-out
 * isn't cut off by the next one popping in instantly. */
function dismissSystemWindow() {
  const win = document.getElementById('systemWindow');
  if (!win || !win.classList.contains('show')) return;
  clearTimeout(_systemWindowTimer);
  win.classList.remove('show');
  setTimeout(() => {
    _systemWindowActive = false;
    _runSystemWindowQueue();
  }, SYSTEM_WINDOW_GAP_MS);
}

/* ================= SYSTEM EVENT ENGINE (dev brief §11) =================
 * Central place that answers "what changed since we last checked, and does
 * it deserve a SYSTEM notification?" — the ACTION → VALIDATION → SYSTEM
 * EVENT → REWARD → PLAYER UPDATE → UI NOTIFICATION pipeline the brief asks
 * for, adapted to how this app already stores state.
 *
 * This app derives XP / Level / Stats / Rank / Achievements / Skills live
 * from sessions[] on every render rather than mutating counters as events
 * happen (see computeTotalXP, computeStatInfo, loadUnlockedSkillIds, etc.)
 * — REWARD and PLAYER UPDATE are already handled correctly for free just
 * by re-rendering, and can't be "lost" the way an incrementally-mutated
 * counter could, which is exactly what dev-brief §04 (never lose player
 * data) wants. So VALIDATION here means: derive current truth, diff it
 * against what the player was last shown, and only the delta needs a
 * SYSTEM EVENT.
 *
 * runSystemChecks() is that single entry point. It doesn't replace
 * showSystemEvent()/queueCelebration() (still the UI notification layer,
 * §10) — it's what decides when to call them. Call it after anything that
 * could have changed derived player state (a render of Home/Character is
 * enough, since everything downstream is computed from sessions[] at read
 * time) rather than scattering the individual check*() calls at each call
 * site. New checks (quest progress, boss-clear, rank-up, future
 * skill-point awards) get added to the list below as their systems are
 * built — each one is just another "diff derived state, notify" function
 * dropped in here, same shape as the two that already exist. */
function runSystemChecks() {
  checkAndUnlockAchievements();
  checkNewlyUnlockedSkills();
  // Phase 2+: checkQuestProgress(), checkBossClear(), checkRankUp(),
  // checkSkillPointsAwarded() join this list as each system is built.
}

/* ---------- navigation ---------- */
function go(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => {
    if (t.getAttribute('onclick') === "go('" + name + "')") t.classList.add('active');
  });
  if (name === 'home') { renderHome(); animateHomeEntrance(); }
  if (name === 'program') { renderProgram(); renderProgramHubCards(); }
  if (name === 'cindy') renderProgram();
  if (name === 'history') renderHistory();
  if (name === 'progress') { renderProgress(); applyReminderToUI(); applyRingGoalsToUI(); }
  if (name === 'customlist') renderCustomList();
  if (name === 'customhistory') renderCustomHistory();
  if (name === 'customprogress') renderCustomProgress();
  if (name === 'customschedule') renderCustomSchedule();
  if (name === 'collection') renderCollection();
  if (name === 'cardiolist') renderCardioList();
  if (name === 'character') renderCharacterSheet();
  if (name === 'run') renderRunHome();
  if (name === 'trainingcamp') renderTrainingCamp();
  if (name === 'bossfight') renderBossCard(); // Home already keeps this fresh, but re-render on entry too
}

/* ================= mobile back-button / nav-gesture trap =================
 * On an installed PWA, the OS "back" gesture (Android nav bar / swipe-back)
 * doesn't know anything about our in-app screens/modals — since this app
 * never touched the History API, there was nothing for the browser to "go
 * back" to, so the gesture just closed the whole app instantly.
 *
 * Fix: keep exactly one extra history entry alive whenever there is
 * something to back out of (a modal, or a non-Home screen). A back
 * action then pops that entry (via 'popstate') and we react by closing
 * the topmost modal or returning Home, instead of letting the app exit.
 * It only exits for real once the user is back at the bare Home screen
 * with nothing open, which is the expected behavior. */
(function () {
  let suppressHistory = false;
  let bufferPushed = false;

  // Screens that represent an active session — back here should ask for
  // confirmation via the screen's own "end" modal, same as tapping its
  // in-app back button, rather than silently jumping to Home.
  var GAMEPLAY_EXIT_FN = {
    'screen-workout': 'openEndModal',
    'screen-customplayer': 'openCustomPlayerEndModal',
    'screen-running': 'openRunEndModal'
  };

  function isAnyModalOpen() {
    if (document.querySelector('.modal-overlay.active')) return true;
    var bv = document.getElementById('bossViewModal');
    if (bv && bv.classList.contains('open')) return true;
    return false;
  }

  function closeTopModal() {
    document.querySelectorAll('.modal-overlay.active').forEach(function (m) { closeModal(m.id); });
    var bv = document.getElementById('bossViewModal');
    if (bv && bv.classList.contains('open') && typeof closeBossView === 'function') closeBossView();
  }

  // Keeps exactly one "buffer" history entry alive whenever there's
  // something on screen to back out of. Runs after every navigation and
  // after every modal open/close (via the MutationObserver below), so the
  // ~30 existing call sites that toggle modals never need to be touched.
  function syncHistoryBuffer() {
    if (suppressHistory) return;
    var homeScreen = document.getElementById('screen-home');
    var needsBuffer = isAnyModalOpen() || !(homeScreen && homeScreen.classList.contains('active'));
    if (needsBuffer && !bufferPushed) {
      bufferPushed = true;
      history.pushState({ trap: true }, '');
    } else if (!needsBuffer && bufferPushed) {
      bufferPushed = false;
      history.back(); // consume the leftover entry (closed via in-app UI, not back)
    }
  }

  new MutationObserver(syncHistoryBuffer).observe(document.body, {
    attributes: true, attributeFilter: ['class'], subtree: true
  });

  var _go = go;
  go = function (name) {
    _go(name);
    syncHistoryBuffer();
  };

  window.addEventListener('popstate', function () {
    if (isAnyModalOpen()) {
      suppressHistory = true;
      closeTopModal();
      suppressHistory = false;
      syncHistoryBuffer();
      return;
    }
    var activeScreen = document.querySelector('.screen.active');
    if (activeScreen && activeScreen.id !== 'screen-home') {
      var exitFn = GAMEPLAY_EXIT_FN[activeScreen.id];
      suppressHistory = true;
      if (exitFn && typeof window[exitFn] === 'function') {
        window[exitFn](); // reopen the screen's own "end session?" confirm modal
      } else {
        go('home');
      }
      suppressHistory = false;
      syncHistoryBuffer();
      return;
    }
    // Already on Home with nothing open — let the normal exit happen.
  });

  history.replaceState({ trap: true }, '');
})();

/* ================= HOME (dashboard) ================= */
/**
 * Home is now a combined dashboard summarizing both Cindy and Custom
 * Workouts: mascot status, today's plan, a weekly progress ring split by
 * mode, and the single most recent workout regardless of which mode it
 * came from. Mode-specific starting/browsing UI lives on the Program tab
 * (see renderProgram()).
 */
/* ---- Home Lobby feel: entrance reveal + ambient embers + mascot poke ----
 * All additive polish, no change to what data renders — see the
 * accompanying CSS block (search "Home Lobby feel") for the animations
 * these trigger. */
function animateHomeEntrance() {
  const wrap = document.querySelector('#screen-home .home-content');
  if (!wrap) return;
  wrap.classList.remove('home-reveal');
  void wrap.offsetWidth; // force reflow so the animation restarts every visit
  wrap.classList.add('home-reveal');
  ensureLobbyEmbers();
}
function ensureLobbyEmbers() {
  const wrap = document.getElementById('lobbyAmbience');
  if (!wrap || wrap.childElementCount) return; // spawn once, they loop forever via CSS
  const count = 7;
  let html = '';
  for (let i = 0; i < count; i++) {
    const x = Math.round(8 + Math.random() * 84);
    const size = (2 + Math.random() * 2.4).toFixed(1);
    const dur = (7 + Math.random() * 6).toFixed(1);
    const delay = (Math.random() * 9).toFixed(1);
    const drift = Math.round(-18 + Math.random() * 36);
    html += '<span class="lobby-ember" style="--ember-x:' + x + '%;--ember-size:' + size + 'px;--ember-dur:' + dur + 's;--ember-delay:' + delay + 's;--ember-drift:' + drift + 'px;"></span>';
  }
  wrap.innerHTML = html;
}
(function bindMascotPoke() {
  document.addEventListener('DOMContentLoaded', function () {
    const avatar = document.getElementById('mascotAvatar');
    const spark = document.getElementById('mascotPokeSpark');
    if (!avatar || !spark) return;
    avatar.addEventListener('click', function () {
      spark.classList.remove('play');
      void spark.offsetWidth;
      spark.classList.add('play');
      setTimeout(() => spark.classList.remove('play'), 550);
    });
  });
})();

function renderHome() {
  renderPlayerStatusCard();
  renderHomeWeeklyPlanCard();
  renderBossCard();
  renderBossTeaser();
  renderWeekRing();
  renderHomeLastWorkout();
  renderTreasureChest();
  renderDailyQuests();
  renderWeeklyMissions();
  renderSpecialQuests();
  renderStepsCard();
  runSystemChecks();
}

/** Combined streak across Cindy sessions + Custom Workout sessions. */
function computeCombinedStreak() {
  const cindyDays = loadSessions().map(s => dayKey(s.finished));
  const customDays = loadCustomWorkoutSessions().map(s => dayKey(s.completedAt));
  const runDays = loadRunSessions().map(s => dayKey(s.completedAt));
  const days = new Set(cindyDays.concat(customDays).concat(runDays));
  if (days.size === 0) return 0;
  let streak = 0;
  let cursor = new Date();
  if (!days.has(dayKey(cursor.getTime()))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(dayKey(cursor.getTime()))) return 0;
  }
  while (days.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/* ---------- streak milestone treasure chests ---------- */
function loadOpenedChests() {
  try { return JSON.parse(localStorage.getItem(KEY_STREAK_CHESTS_OPENED)) || []; }
  catch (e) { return []; }
}
function saveOpenedChests(list) {
  localStorage.setItem(KEY_STREAK_CHESTS_OPENED, JSON.stringify(list));
}
/* Tiered gem-badge colors for the streak medals: bronze/silver/gold/legend,
 * plus a gold trophy fallback. icon/c1/c2 feed badgeHtml() directly. */
function streakBadgeInfo(milestone) {
  switch (milestone) {
    case 7: return { icon: 'star', c1: '#e8bd8e', c2: '#a5622a', title: 'นักสู้ 7 วัน', desc: 'สร้าง Streak ครบ 7 วันติดต่อกัน' };
    case 14: return { icon: 'star', c1: '#eef2f5', c2: '#95a0ac', title: 'นักสู้ 14 วัน', desc: 'สร้าง Streak ครบ 14 วันติดต่อกัน' };
    case 30: return { icon: 'star', c1: '#ffe9a8', c2: '#d69a1f', title: 'นักรบ 30 วัน', desc: 'สร้าง Streak ครบ 30 วันติดต่อกัน' };
    case 100: return { icon: 'gem', c1: '#e9c8ff', c2: '#8b3fe0', glow: '#b975ff', title: 'ตำนาน 100 วัน', desc: 'สร้าง Streak ครบ 100 วันติดต่อกัน' };
    default: return { icon: 'trophy', c1: '#ffe9a8', c2: '#d69a1f', title: 'Milestone', desc: '' };
  }
}
/** Lowest achieved-but-unopened streak milestone, or null if none pending. */
function nextUnclaimedChestMilestone(streak) {
  const opened = loadOpenedChests();
  for (const m of STREAK_MILESTONES) {
    if (streak >= m && opened.indexOf(m) === -1) return m;
  }
  return null;
}
function renderTreasureChest() {
  const btn = document.getElementById('treasureChestBtn');
  if (!btn) return;
  const milestone = nextUnclaimedChestMilestone(computeCombinedStreak());
  btn.classList.toggle('show', milestone !== null);
}
function openTreasureChestModal() {
  const milestone = nextUnclaimedChestMilestone(computeCombinedStreak());
  if (milestone === null) return;
  const info = streakBadgeInfo(milestone);
  const linkedSkin = MASCOT_SKINS.find(s => s.unlock.type === 'streak' && s.unlock.value === milestone);
  document.getElementById('chestMilestoneLabel').textContent = 'STREAK ' + milestone + ' วัน';
  document.getElementById('chestBadgeEmoji').innerHTML = badgeHtml(info.icon, info.c1, info.c2, { glow: true, ring: true, glowColor: info.glow });
  document.getElementById('chestBadgeTitle').textContent = info.title;
  document.getElementById('chestBadgeDesc').textContent = info.desc +
    (linkedSkin ? ' — ปลดล็อคสกิน Mascot "' + linkedSkin.name + '" ด้วย!' : '');
  document.getElementById('treasureChestModal').dataset.milestone = String(milestone);

  const icon = document.getElementById('chestIcon');
  const reveal = document.getElementById('chestBadgeReveal');
  const rewardText = document.getElementById('chestRewardText');
  icon.classList.remove('chest-opened', 'chest-shake');
  reveal.classList.remove('show');
  rewardText.classList.remove('show');
  document.getElementById('chestOpenBtn').style.display = '';
  document.getElementById('chestCloseBtn').style.display = 'none';

  document.getElementById('treasureChestModal').classList.add('active');
}
function revealTreasureChest() {
  const modal = document.getElementById('treasureChestModal');
  const milestone = parseInt(modal.dataset.milestone, 10);
  if (!milestone) return;

  const icon = document.getElementById('chestIcon');
  const reveal = document.getElementById('chestBadgeReveal');
  const rewardText = document.getElementById('chestRewardText');

  vibrate([40, 30, 40, 30, 90]);
  icon.classList.add('chest-shake');
  setTimeout(() => {
    icon.classList.add('chest-opened');
    reveal.classList.add('show');
    rewardText.classList.add('show');
  }, 320);

  document.getElementById('chestOpenBtn').style.display = 'none';
  document.getElementById('chestCloseBtn').style.display = '';

  const opened = loadOpenedChests();
  if (opened.indexOf(milestone) === -1) {
    opened.push(milestone);
    saveOpenedChests(opened);
  }
  renderTreasureChest();
  applyActiveMascotSkinFilter();
}

/* ================= DAILY QUEST BOARD =================
 * Two short quests per day, derived from today's session data (Cindy +
 * Custom Workout). Which two quests show up is picked deterministically
 * from today's date so the board changes daily without needing to store
 * "today's quests" anywhere. The only new persisted state is (a) which
 * quest ids were already claimed today, reset automatically once the date
 * rolls over, and (b) a single running bonus-XP counter that folds into
 * computeTotalXP() above — same lightweight "ratchets upward" pattern as
 * the treasure chests. */
const KEY_QUEST_CLAIMED = 'cindy_daily_quest_claimed_v1';
const KEY_QUEST_BONUS_XP = 'cindy_quest_bonus_xp';
const QUEST_POOL = [
  { id: 'play_any', title: 'ลงสนามวันนี้', desc: 'เล่น Cindy หรือ Custom Workout ให้จบ 1 เซสชัน', xp: 15,
    check: (ctx) => ctx.playedToday },
  { id: 'volume100', title: 'สะสมเรพ 100', desc: 'ทำเรพรวมวันนี้ให้ถึง 100 (ทุกท่ารวมกัน)', xp: 20,
    check: (ctx) => ctx.todayTotalReps >= 100 },
  { id: 'rounds3', title: 'ทำ 3 รอบรวด', desc: 'ทำ Cindy ให้ครบอย่างน้อย 3 รอบในเซสชันเดียว', xp: 20,
    check: (ctx) => ctx.todayMaxRounds >= 3 },
  { id: 'custom_today', title: 'ลอง Custom Workout', desc: 'เล่น Custom Workout โหมดใดก็ได้วันนี้', xp: 15,
    check: (ctx) => ctx.customPlayedToday },
  // ---- manual (self-report) quests, dev brief §09 ----
  // The app has no reading/focus/personal-task tracking yet — rather than
  // wait for those features, these three let the player self-attest
  // ("I did this") the same way a paper habit tracker would: no check(ctx)
  // condition, just always-claimable once per day. Deliberately no MIND/
  // LIFE stat tag wired up yet — that waits for the Body/Mind/Life stat
  // system (dev brief §07, Phase 3) to actually exist; for now these only
  // grant EXP like every other quest.
  { id: 'read_today', title: 'อ่าน/เรียนรู้อะไรบางอย่าง', desc: 'อ่านหนังสือ บทความ หรือเรียนรู้เรื่องใหม่วันนี้ — กดยืนยันเอง', xp: 15, manual: true },
  { id: 'focus_today', title: 'โฟกัส 1 ช่วง', desc: 'ตั้งใจทำงาน/เรียนแบบไม่วอกแวกอย่างน้อย 1 ช่วง — กดยืนยันเอง', xp: 15, manual: true },
  { id: 'personal_task_today', title: 'ทำสิ่งที่ตั้งใจไว้', desc: 'ภารกิจส่วนตัวที่ตั้งใจไว้วันนี้ — กดยืนยันเอง', xp: 15, manual: true }
];
function todayQuestContext() {
  const todayKey = dayKey(Date.now());
  // Only completed Cindy sessions count toward quests — an early FINISH NOW
  // shouldn't satisfy "play a session today" or count toward the reps/rounds
  // quests any more than it counts toward XP. See completeWorkout()'s
  // `completed` flag.
  const cindyToday = loadSessions().filter(s => dayKey(s.finished) === todayKey && s.completed !== false);
  const customToday = loadCustomWorkoutSessions().filter(s => dayKey(s.completedAt) === todayKey);
  const runToday = loadRunSessions().filter(s => dayKey(s.completedAt) === todayKey);
  const cindyRepsToday = cindyToday.reduce((sum, s) => sum + (s.total ? s.total.reps : 0), 0);
  const customRepsToday = customToday.reduce((sum, s) => sum + totalVolumeOfCustomSession(s), 0);
  return {
    playedToday: cindyToday.length > 0 || customToday.length > 0 || runToday.length > 0,
    customPlayedToday: customToday.length > 0,
    todayTotalReps: cindyRepsToday + customRepsToday,
    todayMaxRounds: cindyToday.reduce((m, s) => Math.max(m, s.rounds || 0), 0)
  };
}
function todaysQuestIds() {
  const d = new Date();
  const seed = d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
  const n = QUEST_POOL.length;
  const i1 = seed % n;
  let i2 = (seed + 1 + (seed % (n - 1))) % n;
  if (i2 === i1) i2 = (i2 + 1) % n;
  return [QUEST_POOL[i1].id, QUEST_POOL[i2].id];
}
function loadQuestClaimState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(KEY_QUEST_CLAIMED)); } catch (e) { state = null; }
  const todayKey = dayKey(Date.now());
  if (!state || state.date !== todayKey) {
    state = { date: todayKey, ids: [] };
    localStorage.setItem(KEY_QUEST_CLAIMED, JSON.stringify(state));
  }
  return state;
}
function saveQuestClaimState(state) {
  localStorage.setItem(KEY_QUEST_CLAIMED, JSON.stringify(state));
}
function loadQuestBonusXP() {
  const n = parseInt(localStorage.getItem(KEY_QUEST_BONUS_XP), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function addQuestBonusXP(amount) {
  localStorage.setItem(KEY_QUEST_BONUS_XP, String(loadQuestBonusXP() + amount));
}

/* ================= COMBO MULTIPLIER (in-workout) =================
 * Consecutive rounds saved without a skip build a combo; skipping a round
 * (AMRAP only — EMOM has no skip button, it auto-logs every interval)
 * resets it to zero. The highest combo reached in a session earns a small
 * one-time XP bonus at the end, stored the same way as quest bonus XP: a
 * single running counter folded into computeTotalXP(). */
const KEY_COMBO_BONUS_XP = 'cindy_combo_bonus_xp';
const COMBO_BONUS_MIN = 3; // combo streak needed before it starts paying out
function comboBonusForMaxCombo(maxCombo) {
  // skillEffectMultiplier('comboMult') applies the OVERDRIVE skill (Skill
  // Tree, product doc #18) once unlocked — 1 (no-op) otherwise.
  return maxCombo >= COMBO_BONUS_MIN ? Math.round(maxCombo * 2 * skillEffectMultiplier('comboMult')) : 0;
}
function loadComboBonusXP() {
  const n = parseInt(localStorage.getItem(KEY_COMBO_BONUS_XP), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function addComboBonusXP(amount) {
  if (amount <= 0) return;
  localStorage.setItem(KEY_COMBO_BONUS_XP, String(loadComboBonusXP() + amount));
}

/* ================= REST-SKIP BONUS XP (Custom Workout player) =================
 * Skipping rest early means the body carries more fatigue into the next set —
 * that's worth something. Every time skipPlayerStep() fires during a rest
 * phase (restSet/restEx), whatever time was still left on the clock converts
 * into bonus XP at REST_SKIP_BONUS_RATE per second, folded into the same
 * running-counter pattern as combo/quest bonus XP above. Skips this close to
 * the rest naturally finishing (< REST_SKIP_BONUS_MIN_SEC left) pay nothing,
 * so mashing skip right at 0:01 isn't a meaningful farm.
 *
 * REST_SKIP_BONUS_MAX_SEC caps the bonus independent of how long the rest
 * was actually configured for. Without this, a rest duration is a plain
 * number the player enters themselves in the Custom Workout builder with no
 * upper bound enforced in JS (the HTML input's max="600" is a UI hint only,
 * not a real constraint) — so setting an exercise's rest to an absurd value
 * and skipping it immediately turned "reward for pushing through rest
 * early" into a free multi-hour-workout's worth of XP for one tap. Capping
 * the *bonus calculation* here (not just the input) closes that off however
 * a bogus duration reaches this function. */
const KEY_REST_SKIP_BONUS_XP = 'cindy_rest_skip_bonus_xp';
const REST_SKIP_BONUS_RATE = 0.5;   // XP per second of rest skipped
const REST_SKIP_BONUS_MIN_SEC = 3;  // below this, no bonus — not worth the toast spam
const REST_SKIP_BONUS_MAX_SEC = 90; // cap the payout regardless of configured rest length
function restSkipBonusXP(remainingSec) {
  if (!Number.isFinite(remainingSec) || remainingSec < REST_SKIP_BONUS_MIN_SEC) return 0;
  // skillEffectMultiplier('restSkipMult') applies the SECOND WIND skill
  // (Skill Tree, product doc #18) once unlocked — 1 (no-op) otherwise.
  return Math.round(Math.min(remainingSec, REST_SKIP_BONUS_MAX_SEC) * REST_SKIP_BONUS_RATE * skillEffectMultiplier('restSkipMult'));
}
function loadRestSkipBonusXP() {
  const n = parseInt(localStorage.getItem(KEY_REST_SKIP_BONUS_XP), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function addRestSkipBonusXP(amount) {
  if (amount <= 0) return;
  localStorage.setItem(KEY_REST_SKIP_BONUS_XP, String(loadRestSkipBonusXP() + amount));
}

/* ================= STEP COUNT → BONUS XP (Health Connect) =================
 * Reads today's cumulative step count from Android Health Connect via the
 * @capgo/capacitor-health plugin and converts it into the same running
 * bonus-XP counter pattern as quests/combo/rest-skip above. Health Connect
 * keeps counting steps at the OS level even while this app is closed — we
 * don't run any background polling ourselves, we just read the running
 * daily total whenever the app is opened/foregrounded or the player taps
 * refresh.
 *
 * KEY_STEPS_CONVERTED tracks how many of today's steps have already been
 * turned into XP, so re-reading the same growing daily total never
 * double-awards — only the *new* steps since the last conversion count.
 * Any steps not yet enough for a whole XP point (the remainder after
 * dividing by STEPS_PER_EXP) are left unconverted and picked up on the
 * next refresh rather than lost.
 *
 * STEPS_PER_EXP is the one number to tune for game balance later —
 * nothing else here needs to change to adjust the rate.
 *
 * STEPS_DAILY_XP_CAP caps how much of this bonus can be earned per day —
 * tracked as converted.xpAwarded alongside converted.steps in the same
 * KEY_STEPS_CONVERTED record (both reset together at dayKey() rollover).
 * Once the cap is hit for the day, further steps still count toward
 * stepsTodayCount for display but stop converting into XP — set close to
 * REST_SKIP_BONUS_MAX_SEC*REST_SKIP_BONUS_RATE (90*.5=45) so no single
 * bonus source dominates total XP for the day.
 */
const KEY_STEPS_BONUS_XP = 'cindy_steps_bonus_xp';
const KEY_STEPS_CONVERTED = 'cindy_steps_converted_v1'; // { date, steps, xpAwarded } — steps already turned into XP today + running XP total for the day
const STEPS_PER_EXP = 400;
const STEPS_DAILY_XP_CAP = 45;
let stepsHealthAuthorized = false;
let stepsTodayCount = 0;

function loadStepsBonusXP() {
  const n = parseInt(localStorage.getItem(KEY_STEPS_BONUS_XP), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function addStepsBonusXP(amount) {
  if (amount <= 0) return;
  localStorage.setItem(KEY_STEPS_BONUS_XP, String(loadStepsBonusXP() + amount));
}
function loadStepsConvertedToday() {
  let state;
  try { state = JSON.parse(localStorage.getItem(KEY_STEPS_CONVERTED)); } catch (e) { state = null; }
  const todayKey = dayKey(Date.now());
  if (!state || state.date !== todayKey) {
    state = { date: todayKey, steps: 0, xpAwarded: 0 };
    localStorage.setItem(KEY_STEPS_CONVERTED, JSON.stringify(state));
  }
  // backward-compat: records saved before the daily cap existed won't have
  // xpAwarded — treat as 0 rather than dropping/resetting the whole record
  if (!Number.isFinite(state.xpAwarded)) state.xpAwarded = 0;
  return state;
}
function saveStepsConvertedToday(state) {
  localStorage.setItem(KEY_STEPS_CONVERTED, JSON.stringify(state));
}
function getHealthPlugin() {
  return window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Health;
}
/** Called once at app boot. Only checks existing authorization (no prompt) —
 * the actual permission dialog only ever shows when the player explicitly
 * taps "เชื่อมต่อ Health Connect" via connectHealthConnect() below. */
async function initStepsIntegration() {
  const health = getHealthPlugin();
  if (!health) { renderStepsCard(); return; } // not running as the Android app (e.g. plain browser) — skip silently
  try {
    const status = await health.checkAuthorization({ read: ['steps'] });
    stepsHealthAuthorized = !!(status && status.readAuthorized && status.readAuthorized.indexOf('steps') !== -1);
  } catch (e) {
    stepsHealthAuthorized = false;
  }
  if (stepsHealthAuthorized) { await refreshStepsToday(); }
  else { renderStepsCard(); }
}
async function connectHealthConnect() {
  const health = getHealthPlugin();
  if (!health) return;
  try {
    const avail = await health.isAvailable();
    if (!avail || !avail.available) {
      showToast('ไม่พบ Health Connect บนเครื่องนี้', 'alert');
      return;
    }
    const status = await health.requestAuthorization({ read: ['steps'] });
    stepsHealthAuthorized = !!(status && status.readAuthorized && status.readAuthorized.indexOf('steps') !== -1);
    if (stepsHealthAuthorized) {
      showToast('เชื่อมต่อ Health Connect สำเร็จ', 'check');
      await refreshStepsToday();
    } else {
      showToast('ยังไม่ได้รับสิทธิ์อ่านข้อมูลก้าวเดิน', 'alert');
      renderStepsCard();
    }
  } catch (e) {
    showToast('เชื่อมต่อ Health Connect ไม่สำเร็จ', 'alert');
  }
}
async function refreshStepsToday() {
  const health = getHealthPlugin();
  if (!health || !stepsHealthAuthorized) { renderStepsCard(); return; }
  try {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const result = await health.queryAggregated({
      dataType: 'steps',
      startDate: start.toISOString(),
      endDate: new Date().toISOString(),
      bucket: 'day',
      aggregation: 'sum'
    });
    const total = (result && result.samples && result.samples[0] && result.samples[0].value) || 0;
    stepsTodayCount = Math.max(0, Math.round(total));
    const converted = loadStepsConvertedToday();
    const newSteps = Math.max(0, stepsTodayCount - converted.steps);
    const rawXpToAward = Math.floor(newSteps / STEPS_PER_EXP);
    const remainingCap = Math.max(0, STEPS_DAILY_XP_CAP - converted.xpAwarded);
    const xpToAward = Math.min(rawXpToAward, remainingCap);
    if (xpToAward > 0) {
      converted.steps += xpToAward * STEPS_PER_EXP;
      converted.xpAwarded += xpToAward;
      saveStepsConvertedToday(converted);
      addStepsBonusXP(xpToAward);
      renderXpBar();
      showToast('ก้าวเดินวันนี้ +' + xpToAward + ' XP', 'target');
    } else if (rawXpToAward > 0 && remainingCap === 0 && !converted.capNotified) {
      // steps are there but today's steps-XP cap is already maxed out —
      // don't advance converted.steps for them (next refresh re-checks in
      // case the cap logic changes). Only tell the player once per day
      // (capNotified) so tapping refresh repeatedly doesn't keep re-showing
      // the same toast.
      converted.capNotified = true;
      saveStepsConvertedToday(converted);
      showToast('ก้าวเดินวันนี้ครบโควต้า XP แล้ว', 'target');
    }
  } catch (e) {
    // read failed (Health Connect momentarily unavailable, etc.) — keep
    // showing the last known count rather than clearing it
  }
  renderStepsCard();
}
function renderStepsCard() {
  const body = document.getElementById('stepsCardBody');
  if (!body) return;
  const health = getHealthPlugin();
  if (!health) {
    body.innerHTML = '<div class="quest-desc">ใช้งานได้เฉพาะในแอป Android</div>';
    return;
  }
  if (!stepsHealthAuthorized) {
    body.innerHTML = '<button class="quest-claim-btn" onclick="connectHealthConnect()">เชื่อมต่อ Health Connect</button>';
    return;
  }
  const converted = loadStepsConvertedToday();
  const pending = Math.max(0, stepsTodayCount - converted.steps);
  const capped = converted.xpAwarded >= STEPS_DAILY_XP_CAP;
  const descText = capped
    ? 'ครบโควต้า ' + STEPS_DAILY_XP_CAP + ' XP/วันแล้ว'
    : 'อีก ' + pending + ' ก้าว ได้ +1 XP · วันนี้ได้ ' + converted.xpAwarded + '/' + STEPS_DAILY_XP_CAP + ' XP';
  body.innerHTML = '<div class="quest-row">'
    + '<div class="quest-info"><div class="quest-title">' + stepsTodayCount.toLocaleString('th-TH') + ' ก้าว</div>'
    + '<div class="quest-desc">' + descText + '</div></div>'
    + '<button class="quest-claim-btn" onclick="refreshStepsToday()">รีเฟรช</button>'
    + '</div>';
}

/* Combo milestones — same combo counter and bonus-XP payout as before
 * (COMBO_BONUS_MIN / comboBonusForMaxCombo above); this only adds a
 * presentation tier at a few thresholds so hitting them reads as a beat,
 * not just a bigger number. label mirrors the milestone flavor from the
 * product proposal (bonus XP / power hit / critical / overdrive). */
const COMBO_MILESTONES = [
  { n: 20, tier: 'tier-20', label: 'OVERDRIVE', buzz: [40, 30, 40, 30, 100] },
  { n: 10, tier: 'tier-10', label: 'CRITICAL', buzz: [40, 30, 90] },
  { n: 5, tier: 'tier-5', label: 'POWER HIT', buzz: [30, 25, 60] },
  { n: 3, tier: '', label: 'BONUS XP', buzz: [20] }
];
function comboMilestoneFor(combo) {
  return COMBO_MILESTONES.find(m => combo === m.n) || null;
}
let lastRenderedCombo = null;
function updateComboBadge(active) {
  const badge = document.getElementById('comboBadge');
  if (!badge) return;
  const combo = active.combo || 0;
  if (combo === lastRenderedCombo) return;
  const increased = lastRenderedCombo !== null && combo > lastRenderedCombo;
  lastRenderedCombo = combo;
  if (combo >= 2) {
    const milestone = increased ? comboMilestoneFor(combo) : null;
    badge.textContent = milestone ? ('COMBO x' + combo + ' · ' + milestone.label) : ('COMBO x' + combo);
    badge.classList.add('show');
    COMBO_MILESTONES.forEach(m => { if (m.tier) badge.classList.remove(m.tier); });
    if (milestone && milestone.tier) badge.classList.add(milestone.tier);
    if (increased) {
      badge.classList.remove('pulse', 'milestone-pulse');
      void badge.offsetWidth;
      badge.classList.add(milestone ? 'milestone-pulse' : 'pulse');
      vibrate(milestone ? milestone.buzz : 20);
      if (milestone) {
        beep(milestone.n >= 20 ? 1046 : milestone.n >= 10 ? 932 : 784, 110, 0.16);
        showToast('COMBO x' + combo + ' — ' + milestone.label, 'target');
      }
    }
  } else {
    badge.classList.remove('show');
  }
}
function renderDailyQuests() {
  const wrap = document.getElementById('dailyQuestList');
  if (!wrap) return;
  const ctx = todayQuestContext();
  const claimState = loadQuestClaimState();
  const ids = todaysQuestIds();
  wrap.innerHTML = ids.map(id => {
    const q = QUEST_POOL.find(x => x.id === id);
    if (!q) return '';
    const claimed = claimState.ids.indexOf(id) !== -1;
    const done = q.manual ? true : q.check(ctx);
    let statusHtml;
    if (claimed) statusHtml = '<div class="quest-claimed">' + iconHtml('check') + ' รับแล้ว</div>';
    else if (done) statusHtml = '<button class="quest-claim-btn" onclick="claimDailyQuest(\'' + id + '\', event)">รับ +' + q.xp + ' XP</button>';
    else statusHtml = '<div class="quest-xp-tag">+' + q.xp + ' XP</div>';
    return '<div class="quest-row' + (claimed ? ' done' : '') + '">'
      + '<div class="quest-info"><div class="quest-title">' + escapeHtml(q.title) + '</div><div class="quest-desc">' + escapeHtml(q.desc) + '</div></div>'
      + statusHtml
      + '</div>';
  }).join('');
}
function claimDailyQuest(id, evt) {
  const state = loadQuestClaimState();
  if (state.ids.indexOf(id) !== -1) return;
  const q = QUEST_POOL.find(x => x.id === id);
  if (!q || (!q.manual && !q.check(todayQuestContext()))) return;
  const settle = playClaimFeedback(evt, q.xp);
  vibrate([40, 30, 60]);
  settle(() => {
    state.ids.push(id);
    saveQuestClaimState(state);
    addQuestBonusXP(q.xp);
    renderDailyQuests();
    renderXpBar();
    showSystemEvent({
      header: 'QUEST COMPLETE',
      title: q.title || q.label || '',
      rewards: ['+' + q.xp + ' EXP']
    });
  });
}

/* ---- shared "satisfying claim" feedback for quest/mission buttons ----
 * Fires a flying "+XP" number from the tapped button, flashes the row
 * green, and locks the button — all BEFORE the underlying re-render swaps
 * the row's innerHTML out from under it (which would otherwise cut the
 * animation off instantly). Returns a `settle(cb)` function: call it with
 * the actual claim logic, and it runs cb after the flash has had time to
 * play (or immediately if there's no button/row to animate against, e.g.
 * evt wasn't passed through).
 */
function playClaimFeedback(evt, xp) {
  const btn = evt && evt.currentTarget;
  if (!btn) return function (cb) { cb(); };
  spawnFloatingXP(btn, xp);
  const row = btn.closest('.quest-row');
  btn.disabled = true;
  btn.classList.add('claim-btn-done');
  btn.textContent = 'รับแล้ว!';
  if (row) row.classList.add('quest-claim-flash');
  return function (cb) {
    setTimeout(cb, row ? 280 : 0);
  };
}
function spawnFloatingXP(anchorEl, xp) {
  if (!anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const el = document.createElement('div');
  el.className = 'fly-xp';
  el.textContent = '+' + xp + ' XP';
  el.style.left = (rect.left + rect.width / 2) + 'px';
  el.style.top = rect.top + 'px';
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 950);
}

/* ================= WEEKLY MISSION BOARD (Phase 3) =================
 * Bigger-picture sibling of the Daily Quest board above — same claim/XP
 * pattern (own bonus-XP counter folded into computeTotalXP, own claimed-
 * ids list that resets automatically on rollover) but keyed to the week
 * instead of the day, and with a numeric target/progress bar instead of a
 * plain done/not-done check, since "300 reps this week" needs to show how
 * close you are, not just yes/no.
 *
 * Reuses weekStart()/absoluteWeekIndex() from the Boss system (see
 * currentBossState()) for the week boundary, so "this week" always means
 * the same Monday-start window the Boss fight and Boss Damage already use
 * — no second definition of "week" to keep in sync.
 *
 * Unlike the Daily Quest board, all 5 missions show every week (fixed set,
 * not picked from a pool) — matching the product doc's example list
 * exactly (#16). A pool/rotation can be added later the same way
 * QUEST_POOL→todaysQuestIds() does it for Daily Quest, if the team wants
 * variety; kept fixed for now to ship the core loop first.
 *
 * WEEKLY CHEST unlocks once all 5 are claimed for the week — separate
 * claim state (KEY_WEEKLY_CHEST_CLAIMED) so it can't be claimed twice, and
 * ratchets forward by week key the same way KEY_STREAK_CHESTS_OPENED
 * ratchets by streak milestone. Reward is flat bonus XP for now, same
 * mechanism as everything else here — a future team wiring this into the
 * Boss loot table (rollLootDrop) just needs to call addLootItem() instead
 * of/alongside addWeeklyBonusXP() in claimWeeklyChest() below. */
const KEY_WEEKLY_MISSION_CLAIMED = 'cindy_weekly_mission_claimed_v1';
const KEY_WEEKLY_CHEST_CLAIMED = 'cindy_weekly_chest_claimed_v1';
const KEY_WEEKLY_BONUS_XP = 'cindy_weekly_bonus_xp';
const WEEKLY_CHEST_XP = 100;
const WEEKLY_MISSION_DEFS = [
  { id: 'workouts3', title: 'ออกกำลังกาย 3 ครั้ง', xp: 30, target: 3, unit: 'ครั้ง',
    progress: (ctx) => ctx.sessionsCount },
  { id: 'reps300', title: 'สะสมเรพรวม 300', xp: 30, target: 300, unit: 'ครั้ง',
    progress: (ctx) => ctx.totalReps },
  { id: 'cardio1', title: 'ทำ Cardio 1 ครั้ง', xp: 20, target: 1, unit: 'ครั้ง',
    progress: (ctx) => ctx.cardioCount },
  { id: 'cindy1', title: 'ทำ Cindy Protocol 1 ครั้ง', xp: 20, target: 1, unit: 'ครั้ง',
    progress: (ctx) => ctx.cindyCount },
  { id: 'active5', title: 'Active ให้ครบ 5 วัน', xp: 30, target: 5, unit: 'วัน',
    progress: (ctx) => ctx.activeDays }
];
/** Stable id for "the week containing ts" — same absoluteWeekIndex() the
 * Boss roster already uses, just prefixed so it can't collide with any
 * other kind of key sharing localStorage. */
function weekKey(ts) {
  return 'w' + absoluteWeekIndex(ts);
}
function thisWeekMissionContext() {
  const start = weekStart(Date.now()).getTime();
  const cindyThisWeek = loadSessions().filter(s => s.finished >= start && s.completed !== false);
  const customThisWeek = loadCustomWorkoutSessions().filter(s => s.completedAt >= start);
  const runThisWeek = loadRunSessions().filter(s => s.completedAt >= start);

  const cindyReps = cindyThisWeek.reduce((sum, s) => sum + (s.total ? s.total.reps : 0), 0);
  const customReps = customThisWeek.reduce((sum, s) => sum + totalVolumeOfCustomSession(s), 0);

  const activeDayKeys = new Set();
  cindyThisWeek.forEach(s => activeDayKeys.add(dayKey(s.finished)));
  customThisWeek.forEach(s => activeDayKeys.add(dayKey(s.completedAt)));
  runThisWeek.forEach(s => activeDayKeys.add(dayKey(s.completedAt)));

  return {
    sessionsCount: cindyThisWeek.length + customThisWeek.length + runThisWeek.length,
    totalReps: cindyReps + customReps,
    cardioCount: runThisWeek.length,
    cindyCount: cindyThisWeek.length,
    activeDays: activeDayKeys.size
  };
}
function loadWeeklyMissionClaimState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(KEY_WEEKLY_MISSION_CLAIMED)); } catch (e) { state = null; }
  const wk = weekKey(Date.now());
  if (!state || state.week !== wk) {
    state = { week: wk, ids: [] };
    localStorage.setItem(KEY_WEEKLY_MISSION_CLAIMED, JSON.stringify(state));
  }
  return state;
}
function saveWeeklyMissionClaimState(state) {
  localStorage.setItem(KEY_WEEKLY_MISSION_CLAIMED, JSON.stringify(state));
}
function loadWeeklyChestClaimedWeeks() {
  try { return JSON.parse(localStorage.getItem(KEY_WEEKLY_CHEST_CLAIMED)) || []; }
  catch (e) { return []; }
}
function saveWeeklyChestClaimedWeeks(list) {
  localStorage.setItem(KEY_WEEKLY_CHEST_CLAIMED, JSON.stringify(list));
}
function loadWeeklyBonusXP() {
  const n = parseInt(localStorage.getItem(KEY_WEEKLY_BONUS_XP), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function addWeeklyBonusXP(amount) {
  if (amount <= 0) return;
  localStorage.setItem(KEY_WEEKLY_BONUS_XP, String(loadWeeklyBonusXP() + amount));
}
function renderWeeklyMissions() {
  const wrap = document.getElementById('weeklyMissionList');
  if (!wrap) return;
  const ctx = thisWeekMissionContext();
  const claimState = loadWeeklyMissionClaimState();

  const rowsHtml = WEEKLY_MISSION_DEFS.map(m => {
    const claimed = claimState.ids.indexOf(m.id) !== -1;
    const current = Math.min(m.target, m.progress(ctx));
    const done = current >= m.target;
    let statusHtml;
    if (claimed) statusHtml = '<div class="quest-claimed">' + iconHtml('check') + ' รับแล้ว</div>';
    else if (done) statusHtml = '<button class="quest-claim-btn" onclick="claimWeeklyMission(\'' + m.id + '\', event)">รับ +' + m.xp + ' XP</button>';
    else statusHtml = '<div class="quest-xp-tag">' + current + '/' + m.target + ' ' + m.unit + '</div>';
    return '<div class="quest-row' + (claimed ? ' done' : '') + '">'
      + '<div class="quest-info"><div class="quest-title">' + escapeHtml(m.title) + '</div></div>'
      + statusHtml
      + '</div>';
  }).join('');

  const allClaimed = WEEKLY_MISSION_DEFS.every(m => claimState.ids.indexOf(m.id) !== -1);
  let chestHtml = '';
  if (allClaimed) {
    const chestClaimed = loadWeeklyChestClaimedWeeks().indexOf(weekKey(Date.now())) !== -1;
    chestHtml = '<div class="quest-row done" style="margin-top:8px;border-top:1px solid rgba(255,255,255,.08);padding-top:10px;">'
      + '<div class="quest-info"><div class="quest-title">' + iconHtml('gift') + ' WEEKLY CHEST</div><div class="quest-desc">ทำภารกิจประจำสัปดาห์ครบทุกข้อ</div></div>'
      + (chestClaimed
          ? '<div class="quest-claimed">' + iconHtml('check') + ' รับแล้ว</div>'
          : '<button class="quest-claim-btn" onclick="claimWeeklyChest()">รับ +' + WEEKLY_CHEST_XP + ' XP</button>')
      + '</div>';
  }

  wrap.innerHTML = rowsHtml + chestHtml;
}
function claimWeeklyMission(id, evt) {
  const state = loadWeeklyMissionClaimState();
  if (state.ids.indexOf(id) !== -1) return;
  const m = WEEKLY_MISSION_DEFS.find(x => x.id === id);
  if (!m || m.progress(thisWeekMissionContext()) < m.target) return;
  const settle = playClaimFeedback(evt, m.xp);
  vibrate([40, 30, 60]);
  settle(() => {
    state.ids.push(id);
    saveWeeklyMissionClaimState(state);
    addWeeklyBonusXP(m.xp);
    renderWeeklyMissions();
    renderXpBar();
    showToast('รับภารกิจประจำสัปดาห์สำเร็จ +' + m.xp + ' XP', 'target');
  });
}
function claimWeeklyChest() {
  const state = loadWeeklyMissionClaimState();
  if (!WEEKLY_MISSION_DEFS.every(m => state.ids.indexOf(m.id) !== -1)) return;
  const wk = weekKey(Date.now());
  const claimedWeeks = loadWeeklyChestClaimedWeeks();
  if (claimedWeeks.indexOf(wk) !== -1) return;
  claimedWeeks.push(wk);
  saveWeeklyChestClaimedWeeks(claimedWeeks);
  addWeeklyBonusXP(WEEKLY_CHEST_XP);
  addSeasonPoints(SEASON_POINTS_WEEKLY_CHEST); // product doc #20 — see SEASON block below
  renderWeeklyMissions();
  renderXpBar();
  vibrate([60, 40, 60, 40, 120]);
  showToast('เปิด WEEKLY CHEST สำเร็จ +' + WEEKLY_CHEST_XP + ' XP', 'gift');
}

/* ================= SPECIAL QUEST (dev brief §09) =================
 * "BREAK YOUR LIMIT"-style: a harder, time-boxed challenge instead of a
 * daily/weekly cadence — same claim/XP mechanism as Daily Quest and Weekly
 * Mission (own bonus-XP counter folded into computeTotalXP, own claim
 * state) but keyed to a rolling N-day window that starts the moment a
 * cycle begins rather than a calendar boundary.
 *
 * A cycle is {startTs, claimed}, one per def, in KEY_SPECIAL_QUEST_STATE.
 * ensureSpecialQuestCycle() lazily starts one on first check, and quietly
 * starts a fresh one the moment the window has fully elapsed — whether or
 * not the previous cycle was completed. A missed Special Quest just
 * re-rolls next time the player opens the app, the same no-penalty
 * rollover Daily/Weekly already use, rather than punishing a miss.
 *
 * def.progress(startTs) reads straight from the existing session arrays
 * (same source Daily/Weekly read from) — nothing new to store or migrate,
 * and nothing here can desync from real training history. */
const KEY_SPECIAL_QUEST_STATE = 'cindy_special_quest_state_v1';
const KEY_SPECIAL_QUEST_BONUS_XP = 'cindy_special_quest_bonus_xp';
const SPECIAL_QUEST_DEFS = [
  { id: 'break_limit', title: 'BREAK YOUR LIMIT', desc: 'ทำเซสชันฝึกให้ครบ 4 ครั้ง ภายใน 7 วัน',
    unit: 'ครั้ง', windowDays: 7, target: 4, xp: 80,
    progress: (startTs) => {
      const cindy = loadSessions().filter(s => s.completed !== false && s.finished >= startTs).length;
      const custom = loadCustomWorkoutSessions().filter(s => s.completedAt >= startTs).length;
      const run = loadRunSessions().filter(s => s.completedAt >= startTs).length;
      return cindy + custom + run;
    }
  }
];
function loadSpecialQuestState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(KEY_SPECIAL_QUEST_STATE)); } catch (e) { state = null; }
  return (state && typeof state === 'object') ? state : {};
}
function saveSpecialQuestState(state) {
  localStorage.setItem(KEY_SPECIAL_QUEST_STATE, JSON.stringify(state));
}
function ensureSpecialQuestCycle(def, state) {
  const now = Date.now();
  const windowMs = def.windowDays * 86400000;
  let entry = state[def.id];
  if (!entry || (now - entry.startTs >= windowMs)) {
    entry = { startTs: now, claimed: false };
    state[def.id] = entry;
    saveSpecialQuestState(state);
  }
  return entry;
}
function loadSpecialQuestBonusXP() {
  const n = parseInt(localStorage.getItem(KEY_SPECIAL_QUEST_BONUS_XP), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function addSpecialQuestBonusXP(amount) {
  if (amount <= 0) return;
  localStorage.setItem(KEY_SPECIAL_QUEST_BONUS_XP, String(loadSpecialQuestBonusXP() + amount));
}
function renderSpecialQuests() {
  const wrap = document.getElementById('specialQuestList');
  if (!wrap) return;
  const state = loadSpecialQuestState();
  wrap.innerHTML = SPECIAL_QUEST_DEFS.map(def => {
    const entry = ensureSpecialQuestCycle(def, state);
    const current = Math.min(def.target, def.progress(entry.startTs));
    const done = current >= def.target;
    const daysLeft = Math.max(0, Math.ceil((entry.startTs + def.windowDays * 86400000 - Date.now()) / 86400000));
    let statusHtml;
    if (entry.claimed) statusHtml = '<div class="quest-claimed">' + iconHtml('check') + ' รับแล้ว</div>';
    else if (done) statusHtml = '<button class="quest-claim-btn" onclick="claimSpecialQuest(\'' + def.id + '\', event)">รับ +' + def.xp + ' XP</button>';
    else statusHtml = '<div class="quest-xp-tag">' + current + '/' + def.target + ' ' + def.unit + '</div>';
    return '<div class="quest-row' + (entry.claimed ? ' done' : '') + '">'
      + '<div class="quest-info"><div class="quest-title">' + escapeHtml(def.title) + '</div>'
      + '<div class="quest-desc">' + escapeHtml(def.desc) + (entry.claimed ? '' : ' · เหลือ ' + daysLeft + ' วัน') + '</div></div>'
      + statusHtml
      + '</div>';
  }).join('');
}
function claimSpecialQuest(id, evt) {
  const state = loadSpecialQuestState();
  const def = SPECIAL_QUEST_DEFS.find(x => x.id === id);
  if (!def) return;
  const entry = ensureSpecialQuestCycle(def, state);
  if (entry.claimed || def.progress(entry.startTs) < def.target) return;
  const settle = playClaimFeedback(evt, def.xp);
  vibrate([50, 40, 50, 40, 90]);
  settle(() => {
    entry.claimed = true;
    saveSpecialQuestState(state);
    addSpecialQuestBonusXP(def.xp);
    renderSpecialQuests();
    renderXpBar();
    showSystemEvent({
      header: 'SPECIAL QUEST CLEAR',
      title: def.title,
      rewards: ['+' + def.xp + ' EXP'],
      accent: '#FF6B4A'
    });
  });
}

/* ================= SEASON (product doc #20) =================
 * The doc flags this as the biggest, longest-term item and says it
 * "shouldn't be rushed" — and per the Phase 3 plan, it's last precisely
 * because it leans on everything else being stable first: Weekly
 * Mission (#16, above) for a "Season Quest"-shaped activity loop, Boss
 * Modifier (#8) + Story/Chapter (#9) for "Season Boss" flavor, and
 * Achievements/Titles (Phase 1) for the cosmetic-reward pattern a
 * Season Pass reuses. All four now exist, so this wires them together
 * instead of building anything from scratch.
 *
 * Two things this deliberately does NOT do, both flagged in the doc
 * itself as needing real art/design work this pass doesn't have:
 *   - No new Season Skin/Background art asset — MASCOT_SKINS and
 *     backdrops are hand-designed per-item elsewhere in this file, and
 *     inventing a placeholder would ship a broken-looking reward. Pass
 *     tiers pay bonus XP instead, same safe mechanism as every other
 *     bonus-XP source in this file (folded into computeTotalXP() below),
 *     until a real Season Skin is designed.
 *   - No explicit Season start date — SEASON_LENGTH_WEEKS anchors off
 *     the same absoluteWeekIndex() the Boss roster and Weekly systems
 *     already use, so "CINDY SEASON 01" simply covers weeks 0-7 of that
 *     counter and Season 02 would begin automatically at week 8 the
 *     moment a second entry is added to SEASON_DEFS (falls back to
 *     repeating SEASON_DEFS via modulo until then, same technique
 *     BOSS_MODIFIERS uses for a repeating deterministic cycle).
 *
 * "Reset only Season Progress, never Character Progress permanently"
 * (doc's own wording) is handled the same way Weekly Mission already
 * resets per-week: loadSeasonState() compares the stored seasonIndex
 * against the *current* one and zeroes just the season-scoped counters
 * on mismatch. Nothing about Level, Stats, Boss trophies, Loot, Skins,
 * or Achievements is touched — those all live in their own unrelated
 * storage keys untouched by this block. */
const SEASON_LENGTH_WEEKS = 8;
const SEASON_DEFS = [
  { name: 'RISE OF MACHINES' }
];
const KEY_SEASON_STATE = 'cindy_season_state_v1';
const KEY_SEASON_BONUS_XP = 'cindy_season_bonus_xp';
// Point values per source — small, one-shot, weekly-cadence events only
// (never per-rep or per-session) so there's no way to farm Season Points
// faster than actually playing across the week, same anti-farm posture
// as the rest of this file's bonus-XP sources.
const SEASON_POINTS_WEEKLY_CHEST = 50; // claimWeeklyChest(), above
const SEASON_POINTS_BOSS_DEFEAT = 30;  // weekly boss-defeat-seen block, currentBossState()
const SEASON_POINTS_ACHIEVEMENT = 15;  // checkAndUnlockAchievements()
const SEASON_PASS_TIERS = [
  { points: 50, xp: 20 },
  { points: 150, xp: 30 },
  { points: 300, xp: 50 },
  { points: 500, xp: 80 },
  { points: 800, xp: 120 }
];
/** { seasonIndex, weekInSeason (0-based), weekNumber (1-based),
 * totalWeeks, name, subtitle } for "right now", derived purely from
 * absoluteWeekIndex() — nothing stored, so it can never drift. */
function currentSeasonInfo() {
  const wIdx = absoluteWeekIndex(Date.now());
  const seasonIndex = Math.floor(wIdx / SEASON_LENGTH_WEEKS);
  const weekInSeason = ((wIdx % SEASON_LENGTH_WEEKS) + SEASON_LENGTH_WEEKS) % SEASON_LENGTH_WEEKS;
  const def = SEASON_DEFS[seasonIndex % SEASON_DEFS.length];
  return {
    seasonIndex,
    weekInSeason,
    weekNumber: weekInSeason + 1,
    totalWeeks: SEASON_LENGTH_WEEKS,
    name: def.name,
    subtitle: 'CINDY SEASON ' + String(seasonIndex + 1).padStart(2, '0')
  };
}
/** Season Points + claimed-tier state, auto-reset to zero the moment the
 * current season index no longer matches what's stored — same pattern
 * loadWeeklyMissionClaimState() already uses per-week, just per-season. */
function loadSeasonState() {
  let state;
  try { state = JSON.parse(localStorage.getItem(KEY_SEASON_STATE)); } catch (e) { state = null; }
  const idx = currentSeasonInfo().seasonIndex;
  if (!state || state.seasonIndex !== idx) {
    state = { seasonIndex: idx, points: 0, claimedTiers: [] };
    localStorage.setItem(KEY_SEASON_STATE, JSON.stringify(state));
  }
  return state;
}
function saveSeasonState(state) {
  localStorage.setItem(KEY_SEASON_STATE, JSON.stringify(state));
}
function addSeasonPoints(amount) {
  if (!(amount > 0)) return;
  const state = loadSeasonState();
  state.points += amount;
  saveSeasonState(state);
}
function loadSeasonBonusXP() {
  const n = parseInt(localStorage.getItem(KEY_SEASON_BONUS_XP), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function addSeasonBonusXP(amount) {
  if (amount <= 0) return;
  localStorage.setItem(KEY_SEASON_BONUS_XP, String(loadSeasonBonusXP() + amount));
}
function claimSeasonTier(tierIdx) {
  const state = loadSeasonState();
  const tier = SEASON_PASS_TIERS[tierIdx];
  if (!tier || state.points < tier.points || state.claimedTiers.indexOf(tierIdx) !== -1) return;
  state.claimedTiers.push(tierIdx);
  saveSeasonState(state);
  addSeasonBonusXP(tier.xp);
  renderSeasonPass();
  renderXpBar();
  vibrate([50, 30, 50, 30, 100]);
  showToast('SEASON PASS TIER ' + (tierIdx + 1) + ' +' + tier.xp + ' XP', 'gift');
}
function renderSeasonPass() {
  const info = currentSeasonInfo();
  const state = loadSeasonState();
  const headEl = document.getElementById('seasonPassHead');
  if (headEl) {
    headEl.innerHTML = '<div class="fitness-rank-overall-lbl">' + info.subtitle + '</div>'
      + '<div class="character-cp-val" style="font-size:18px;">' + escapeHtml(info.name) + '</div>'
      + '<div class="quest-desc">สัปดาห์ ' + info.weekNumber + '/' + info.totalWeeks + ' · SEASON POINTS ' + state.points + '</div>';
  }
  const wrap = document.getElementById('seasonPassTierList');
  if (!wrap) return;
  wrap.innerHTML = SEASON_PASS_TIERS.map((tier, idx) => {
    const claimed = state.claimedTiers.indexOf(idx) !== -1;
    const ready = !claimed && state.points >= tier.points;
    let statusHtml;
    if (claimed) statusHtml = '<div class="quest-claimed">' + iconHtml('check') + ' รับแล้ว</div>';
    else if (ready) statusHtml = '<button class="quest-claim-btn" onclick="claimSeasonTier(' + idx + ')">รับ +' + tier.xp + ' XP</button>';
    else statusHtml = '<div class="quest-xp-tag">' + Math.min(state.points, tier.points) + '/' + tier.points + ' PT</div>';
    return '<div class="quest-row' + (claimed ? ' done' : '') + '">'
      + '<div class="quest-info"><div class="quest-title">TIER ' + (idx + 1) + '</div></div>'
      + statusHtml
      + '</div>';
  }).join('');
}
function openSeasonModal() {
  const modal = document.getElementById('seasonModal');
  if (!modal) return;
  renderSeasonPass();
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}
function closeSeasonModal() {
  const modal = document.getElementById('seasonModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}
function initSeasonModal() {
  document.querySelectorAll('[data-season-close]').forEach(el => el.addEventListener('click', closeSeasonModal));
}
/** Small always-visible teaser on the Character sheet (season name +
 * week X/8 + current points) so the Season Pass button doesn't require
 * opening the modal just to see where you stand. */
function renderSeasonTeaser() {
  const el = document.getElementById('seasonTeaserText');
  if (!el) return;
  const info = currentSeasonInfo();
  const state = loadSeasonState();
  el.textContent = info.subtitle + ' · ' + info.name + ' · สัปดาห์ ' + info.weekNumber + '/' + info.totalWeeks + ' · ' + state.points + ' PT';
}

/* ================= MASCOT DIALOGUE =================
 * Pools of lines per mascot "mood" state, all derived from data that's
 * already tracked (streak, played-today, isPR) — nothing new stored. One
 * line per pool is picked per day, seeded by date the same way
 * todaysQuestIds() seeds its pick, so the line is stable across re-renders
 * within a day but varies day to day instead of repeating the same 3
 * fixed strings forever. */
const MASCOT_LINES = {
  noHistory: [
    { h: 'ยังไม่มีประวัติการเล่น', s: 'เริ่มวันนี้เลย แล้วมาสร้าง streak กัน' },
    { h: 'พร้อมเริ่มหรือยัง?', s: 'ทำเซสชันแรกแล้วเราจะไปด้วยกัน' },
    { h: 'หน้ากระดาษยังว่างอยู่', s: 'เริ่มบทแรกของเรื่องราวคุณตอนนี้เลย' },
    { h: 'รอวันแรกของคุณอยู่', s: 'ไม่ต้องสมบูรณ์แบบ แค่เริ่มก่อน' },
  ],
  playedTodayLowStreak: [ // streak 1-6
    { h: 'เก่งมาก ทำแล้ว {streak} วันติด', s: 'เล่นแล้ววันนี้ — พักผ่อนหรือจะเก็บอีกโหมดก็ได้' },
    { h: 'อีกนิดเดียวถึง 7 วัน', s: 'ทำแล้ว {streak} วัน ใกล้ปลดหีบแรกแล้ว' },
    { h: 'เริ่มติดจังหวะแล้วนะ', s: '{streak} วันติด นี่คือจุดเริ่มของนิสัยดี ๆ' },
    { h: 'วันนี้ก็ผ่านไปได้สวย', s: 'สะสมไปเรื่อย ๆ {streak} วันแล้ว' },
  ],
  playedTodayMidStreak: [ // streak 7-29
    { h: '{streak} วันติดแล้ว แข็งแกร่งขึ้นทุกวัน', s: 'วันนี้จบไปแล้ว เก็บแรงไว้พรุ่งนี้' },
    { h: 'สม่ำเสมอสุด ๆ', s: '{streak} วันติดต่อกัน — นี่แหละวินัยของนักสู้ตัวจริง' },
    { h: 'ผ่านมาไกลแล้วนะ', s: '{streak} วัน ย้อนกลับไปดูวันแรกสิ ต่างกันแค่ไหน' },
    { h: 'คนอื่นเห็นก็ต้องทึ่ง', s: 'ทำติดกัน {streak} วัน ไม่ใช่เรื่องบังเอิญแล้ว' },
  ],
  playedTodayHighStreak: [ // streak 30+
    { h: 'ตำนานกำลังก่อร่าง — {streak} วัน', s: 'น้อยคนจะมาไกลขนาดนี้ เก่งมาก' },
    { h: '{streak} วันติด ไม่มีใครหยุดคุณได้', s: 'พักผ่อนซะ พรุ่งนี้ลุยต่อ' },
    { h: 'นี่คือระดับตำนานแล้ว', s: '{streak} วัน — ทำต่อไปเรื่อย ๆ นะ' },
  ],
  notPlayedYetLowStreak: [
    { h: 'Streak {streak} วัน — อย่าให้ขาดวันนี้', s: 'ยังไม่ได้เล่นวันนี้ ไปต่อกันเลย' },
    { h: 'รอคุณอยู่นะ', s: '{streak} วันแล้ว อย่าเพิ่งหยุดตอนนี้' },
    { h: 'แค่เซสชันเดียวก็พอ', s: 'ไม่ต้องหนัก แค่ไปต่อให้ streak {streak} วันไม่ขาด' },
  ],
  notPlayedYetHighStreak: [ // streak >= 7
    { h: 'streak {streak} วันกำลังจะหลุด!', s: 'เล่นวันนี้ก่อนหมดเวลา อย่าให้เสียของ' },
    { h: 'ใกล้จะเสีย {streak} วันที่สะสมมา', s: 'แค่เซสชันเดียวก็รักษาไว้ได้แล้ว' },
    { h: 'อย่าให้ {streak} วันสูญเปล่า', s: 'มาไกลขนาดนี้แล้ว อย่าเพิ่งหยุด' },
  ],
  newPRToday: [ // played today + hit isPR today
    { h: 'ทำลายสถิติตัวเองวันนี้!', s: 'PR ใหม่ — เก่งขึ้นกว่าเมื่อวานจริง ๆ' },
    { h: 'สุดยอดไปเลย', s: 'นี่คือ PR ใหม่ของคุณ จำวันนี้ไว้' },
  ],
};
function pickDailyLine(pool) {
  const d = new Date();
  const seed = d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate();
  return pool[seed % pool.length];
}
function fillTemplate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (vars[k] !== undefined ? vars[k] : ''));
}
/** Whether either session type logged a PR today, used to give the mascot
 * a one-off celebratory line instead of the usual streak-status line. */
function todayHasPR() {
  const todayKey = dayKey(Date.now());
  const cindyPR = loadSessions().some(s => s.isPR && dayKey(s.finished) === todayKey);
  const customPR = loadCustomWorkoutSessions().some(s => s.isPR && dayKey(s.completedAt) === todayKey);
  return cindyPR || customPR;
}

function renderPlayerStatusCard() {
  const headline = document.getElementById('mascotHeadline');
  const sub = document.getElementById('mascotSub');
  if (!headline || !sub) return;
  const streak = computeCombinedStreak();
  const playedToday = didPlayToday();

  let pool;
  if (streak === 0) pool = MASCOT_LINES.noHistory;
  else if (playedToday && todayHasPR()) pool = MASCOT_LINES.newPRToday;
  else if (playedToday) {
    pool = streak >= 30 ? MASCOT_LINES.playedTodayHighStreak
         : streak >= 7  ? MASCOT_LINES.playedTodayMidStreak
         : MASCOT_LINES.playedTodayLowStreak;
  } else {
    pool = streak >= 7 ? MASCOT_LINES.notPlayedYetHighStreak : MASCOT_LINES.notPlayedYetLowStreak;
  }
  const line = pickDailyLine(pool);
  headline.textContent = fillTemplate(line.h, { streak });
  sub.textContent = fillTemplate(line.s, { streak });

  renderXpBar();
  renderCharacterName();
}

/* ================= CHARACTER NAME =================
 * A single free-text name the player can set for their character — nothing
 * gameplay-affecting, just a display label shown on the Home mascot card
 * and the Character sheet. Stored as one plain string; empty means "not
 * set yet", in which case the UI falls back to a "ตั้งชื่อตัวละคร" prompt
 * (Home hides the empty line entirely via the :empty CSS rule; Character's
 * button always shows something tappable either way). */
function loadCharacterName() {
  return (localStorage.getItem(KEY_CHARACTER_NAME) || '').trim();
}
function saveCharacterName(name) {
  const trimmed = String(name || '').trim().slice(0, 16);
  localStorage.setItem(KEY_CHARACTER_NAME, trimmed);
  return trimmed;
}
function renderCharacterName() {
  const name = loadCharacterName();
  const homeEl = document.getElementById('mascotCharacterName');
  if (homeEl) homeEl.textContent = name;
  const charText = document.getElementById('characterNameText');
  if (charText) charText.textContent = name || 'ตั้งชื่อตัวละคร';
}
function openCharacterNameModal() {
  const modal = document.getElementById('characterNameModal');
  const input = document.getElementById('characterNameInput');
  if (!modal) return;
  if (input) input.value = loadCharacterName();
  modal.classList.add('active');
  if (input) setTimeout(() => input.focus(), 50);
}
function saveCharacterNameFromModal() {
  const input = document.getElementById('characterNameInput');
  saveCharacterName(input ? input.value : '');
  closeModal('characterNameModal');
  renderCharacterName();
}

/* ================= XP / LEVEL =================
 * 1 rep logged (Cindy or Custom Workout) = 1 XP. Each level requires more XP
 * than the last (100, 150, 200, ...), so progress naturally slows at higher
 * levels. Level is fully derived from session history — nothing new is
 * stored except "last seen level", used only to detect a level-up moment
 * so we don't replay the glow/toast on every render. */
/* ---- XP cache ----
 * computeTotalXP() used to re-reduce the entire session history on every
 * call — and one render pass (renderMascotCard → renderXpBar → renderRankTag)
 * can call it several times, plus it grows unbounded with session count.
 * Memoized here (in-memory only, never persisted — the session arrays stay
 * the single source of truth) and invalidated only when sessions actually
 * change, via saveSessions()/saveCustomWorkoutSessions() above calling
 * invalidateXPCache() themselves. Every one of their call sites (create,
 * edit, delete, import-merge) benefits without being touched individually. */
let _xpCache = null; // { cindyXP, customXP } | null when stale
function invalidateXPCache() { _xpCache = null; }
function computeSessionXP() {
  if (_xpCache) return _xpCache;
  // Only completed sessions (full protocol duration reached) count toward
  // XP — see the completed flag set in completeWorkout(). Custom Workout
  // sessions aren't affected by this since they don't have the same
  // Finish-early race-the-clock structure.
  const cindyXP = loadSessions().filter(s => s.completed !== false).reduce((sum, s) => sum + (s.total ? s.total.reps : 0), 0);
  const customXP = loadCustomWorkoutSessions().reduce((sum, s) => sum + totalVolumeOfCustomSession(s), 0);
  const runXP = loadRunSessions().reduce((sum, s) => sum + (s.xp || 0), 0);
  _xpCache = { cindyXP, customXP, runXP };
  return _xpCache;
}
function computeTotalXP() {
  const { cindyXP, customXP, runXP } = computeSessionXP();
  return cindyXP + customXP + runXP + loadQuestBonusXP() + loadComboBonusXP() + loadRestSkipBonusXP() + loadStepsBonusXP() + loadWeeklyBonusXP() + loadSeasonBonusXP() + loadSpecialQuestBonusXP();
}
function xpRequiredForLevel(level) {
  return 100 + (level - 1) * 50;
}
function computeLevelInfo(totalXp) {
  let level = 1;
  let remaining = totalXp;
  let req = xpRequiredForLevel(level);
  while (remaining >= req) {
    remaining -= req;
    level++;
    req = xpRequiredForLevel(level);
  }
  return { level, xpIntoLevel: remaining, xpForNextLevel: req, pct: req > 0 ? remaining / req : 0 };
}
function loadLastSeenLevel() {
  const n = parseInt(localStorage.getItem(KEY_LAST_SEEN_LEVEL), 10);
  return Number.isFinite(n) && n > 0 ? n : 1;
}
function saveLastSeenLevel(level) {
  localStorage.setItem(KEY_LAST_SEEN_LEVEL, String(level));
}
function renderXpBar() {
  const badge = document.getElementById('mascotLevelBadge');
  const fill = document.getElementById('xpBarFill');
  const label = document.getElementById('xpBarLabel');
  if (!badge || !fill || !label) return;

  const info = computeLevelInfo(computeTotalXP());
  badge.textContent = 'LV.' + info.level;
  fill.style.width = Math.round(info.pct * 100) + '%';
  label.textContent = info.xpIntoLevel + ' / ' + info.xpForNextLevel + ' XP';

  const lastSeen = loadLastSeenLevel();
  if (info.level > lastSeen) {
    const prevRank = rankForLevel(lastSeen);
    saveLastSeenLevel(info.level);
    badge.classList.remove('bump');
    void badge.offsetWidth;
    badge.classList.add('bump');
    badge.addEventListener('animationend', () => badge.classList.remove('bump'), { once: true });
    vibrate([60, 40, 60]);
    const rank = rankForLevel(info.level);
    queueCelebration({
      icon: rank.icon,
      title: 'LEVEL UP!',
      subtitle: 'ตอนนี้ LV.' + info.level + ' · ' + rank.title,
      accent: RANK_ACCENT_HEX[rank.title.toLowerCase()],
      variant: 'levelup',
      rankup: rank.title !== prevRank.title ? 'RANK UP → ' + rank.title : null
    });
  }
  renderRankTag(info.level);
  runSystemChecks();
}

/* ================= RANK / TITLE =================
 * Purely a label derived from the level that's already computed above —
 * nothing new is stored. Gives the level number a bit of RPG flavor. */
const RANK_TIERS = [
  { min: 1, max: 4, title: 'RECRUIT', icon: 'rankRecruit' },
  { min: 5, max: 9, title: 'FIGHTER', icon: 'rankFighter' },
  { min: 10, max: 14, title: 'WARRIOR', icon: 'rankWarrior' },
  { min: 15, max: 19, title: 'ELITE', icon: 'rankElite' },
  { min: 20, max: Infinity, title: 'LEGEND', icon: 'rankLegend' }
];
// same rank colors already used for .mascot-rank text/border — reused here as
// the --mascot-accent-rgb driving the .mascot-card rarity border + wash
const RANK_ACCENT_HEX = {
  recruit: '#8D93A6', fighter: '#3D6FE0', warrior: '#FFB020', elite: '#B48CFF', legend: '#FFD700'
};
function rankForLevel(level) {
  return RANK_TIERS.find(r => level >= r.min && level <= r.max) || RANK_TIERS[0];
}

function renderRankTag(level) {
  const el = document.getElementById('mascotRank');
  if (!el) return;
  const rank = rankForLevel(level);
  el.innerHTML = iconHtml(rank.icon) + ' ' + rank.title;
  RANK_TIERS.forEach(r => el.classList.remove('rank-' + r.title.toLowerCase()));
  el.classList.add('rank-' + rank.title.toLowerCase());
  applyMascotGearAndAura(rank);
}

/** Drives the avatar's persistent rank aura (pulsing glow ring), its
 * small "gear" badge (worn rank icon), and the LV.N chip itself, all purely
 * CSS/derived from the rank tier — nothing new stored. RECRUIT stays plain
 * so the aura/gear/badge escalation reads as something earned from
 * FIGHTER (LV.5) onward, getting richer color + effects every tier. */
function applyMascotGearAndAura(rank) {
  const avatar = document.getElementById('mascotAvatar');
  const gear = document.getElementById('mascotGearBadge');
  const levelBadge = document.getElementById('mascotLevelBadge');
  const card = document.querySelector('.mascot-card');
  const tier = rank.title.toLowerCase();
  if (card) card.style.setProperty('--mascot-accent-rgb', hexToRgbTriplet(RANK_ACCENT_HEX[tier] || RANK_ACCENT_HEX.recruit));
  if (avatar) {
    RANK_TIERS.forEach(r => avatar.classList.remove('aura-' + r.title.toLowerCase()));
    if (tier !== 'recruit') avatar.classList.add('aura-' + tier);
  }
  if (levelBadge) {
    RANK_TIERS.forEach(r => levelBadge.classList.remove('lvbadge-' + r.title.toLowerCase()));
    if (tier !== 'recruit') levelBadge.classList.add('lvbadge-' + tier);
  }
  if (gear) {
    RANK_TIERS.forEach(r => gear.classList.remove('gear-' + r.title.toLowerCase()));
    if (tier === 'recruit') {
      gear.classList.remove('show');
    } else {
      gear.innerHTML = iconHtml(rank.icon);
      gear.classList.add('show', 'gear-' + tier);
    }
  }
}

/* ================= STAT ATTRIBUTES (STR / PWR / END) =================
 * Derived straight from lifetime Cindy rep totals per move — no new data
 * stored. Each stat levels up on its own curve so it feels like a proper
 * RPG stat rather than a duplicate of the XP bar. */
const STAT_DEFS = [
  { key: 'pull', label: 'STRENGTH', short: 'STR', color: 'var(--pull)' },
  { key: 'push', label: 'POWER', short: 'PWR', color: 'var(--push)' },
  { key: 'legs', label: 'ENDURANCE', short: 'END', color: 'var(--squat)' },
  { key: 'core', label: 'CORE', short: 'CORE', color: 'var(--core)' },
  { key: 'cardio', label: 'CARDIO', short: 'CARDIO', color: 'var(--run)' }
];
function statReqForLevel(level) {
  return 30 + (level - 1) * 15;
}
function computeStatInfo(totalReps) {
  let level = 1;
  let remaining = totalReps;
  let req = statReqForLevel(level);
  while (remaining >= req) {
    remaining -= req;
    level++;
    req = statReqForLevel(level);
  }
  return { level, pct: req > 0 ? remaining / req : 0 };
}
/** Best-effort category for one exerciseLog entry. Custom Workout
 * exercises picked from the library carry their category from
 * EXERCISE_LIBRARY (see selectLibraryExercise); freeform "พิมพ์ท่าเอง"
 * entries get it from the category picker added to the exercise editor
 * (see renderCustomExerciseList). Older saved data from before this
 * field existed won't have it, so this falls back to matching the
 * exercise's name against EXERCISE_LIBRARY, and finally to 'core' if
 * nothing matches — a neutral bucket rather than dropping the volume
 * (and thus the reps a player already earned) on the floor. */
function exerciseCategoryOrGuess(entry) {
  if (entry && STAT_DEFS.some(d => d.key === entry.category)) return entry.category;
  const name = (entry && entry.name || '').trim().toLowerCase();
  const match = name && EXERCISE_LIBRARY.find(e => e.name.trim().toLowerCase() === name);
  return (match && match.category) || 'core';
}
/* ================= TRAINING CAMP / FITNESS TESTS (Phase 2D) =================
 * A player-run baseline test per stat category — separate from logged
 * workouts, meant to answer "how fit am I right now" directly rather than
 * being inferred from accumulated training volume. The first result ever
 * recorded for a key becomes its BASELINE; every result after that is
 * compared back against the baseline to show real-world improvement
 * (see fitnessTestInfo's deltaPct). Nothing here is timed or verified by
 * the app — like the PIN lock (see its own comment above), the trust
 * model is "the player is testing themselves honestly", not anti-cheat.
 *
 * Test keys match STAT_DEFS on purpose (pull/push/legs/core/cardio) so a
 * test result plugs straight into the same stat buckets as workout
 * volume — see the loadStatTotals() addition below. Units were chosen to
 * match whatever unit that stat already accumulates in reps for
 * pull/push/legs (matches Cindy/Custom Workout rep counts), seconds for
 * core (matches Custom Workout's timed plank/hold entries) and cardio
 * (matches Run sessions' movingSec) — so folding a test result into the
 * stat totals never needs a conversion factor. */
const FITNESS_TESTS = [
  { key: 'pull', label: 'Pull-up Test', unit: 'ครั้ง',
    desc: 'ดึงข้อขึ้น-ลงให้ได้มากที่สุดในเซ็ตเดียว (ฟอร์มถูกต้อง ไม่โยกตัว)', icon: 'mitten', color: 'var(--pull)' },
  { key: 'push', label: 'Push-up Test', unit: 'ครั้ง',
    desc: 'วิดพื้นให้ได้มากที่สุดในเซ็ตเดียว', icon: 'boxGlove', color: 'var(--push)' },
  { key: 'legs', label: 'Squat Test', unit: 'ครั้ง',
    desc: 'สควอทให้ได้มากที่สุดในเซ็ตเดียว', icon: 'tank', color: 'var(--squat)' },
  { key: 'core', label: 'Plank Test', unit: 'วินาที',
    desc: 'แพลงค์ค้างให้นานที่สุดเท่าที่ทำได้ (จับเวลาเป็นวินาที)', icon: 'core', color: 'var(--core)' },
  { key: 'cardio', label: 'Running Test', unit: 'วินาที',
    desc: 'วิ่งหรือวิ่งเหยาะต่อเนื่องให้นานที่สุดโดยไม่หยุดพัก (จับเวลาเป็นวินาที)', icon: 'flame', color: 'var(--run)' }
];
const KEY_FITNESS_TESTS = 'cindy_fitness_tests';
function loadFitnessTests() {
  try { return JSON.parse(localStorage.getItem(KEY_FITNESS_TESTS)) || {}; }
  catch (e) { return {}; }
}
function saveFitnessTests(data) {
  localStorage.setItem(KEY_FITNESS_TESTS, JSON.stringify(data));
}
/** null if the player has never tested this key yet. baseline = first
 * entry ever logged (never overwritten); latest = most recent entry;
 * best = highest value ever logged (ratchets upward, same "ever" pattern
 * as loadBossEverDefeated/highest level seen elsewhere in this file). */
function fitnessTestInfo(key) {
  const log = (loadFitnessTests()[key] || {}).log || [];
  if (!log.length) return null;
  const baseline = log[0];
  const latest = log[log.length - 1];
  const best = log.reduce((b, e) => (e.value > b.value ? e : b), log[0]);
  const deltaPct = baseline.value > 0 ? Math.round(((latest.value - baseline.value) / baseline.value) * 100) : 0;
  return { baseline, latest, best, deltaPct, count: log.length };
}
function recordFitnessTest(key, rawValue) {
  const value = Math.max(0, Math.round(Number(rawValue) || 0));
  const data = loadFitnessTests();
  if (!data[key]) data[key] = { log: [] };
  data[key].log.push({ value, ts: Date.now() });
  saveFitnessTests(data);
  return fitnessTestInfo(key);
}
/** The one-time floor a test contributes into loadStatTotals() — see
 * that function's comment for why this is "best", not "latest". */
function fitnessTestBestValue(key) {
  const info = fitnessTestInfo(key);
  return info ? info.best.value : 0;
}

/** Lifetime totals per stat, pooled from every source that logs the
 * matching kind of work:
 * - Cindy sessions: fixed pull/push/squat reps per round (squat is a
 *   legs exercise, so it feeds the legs/END stat)
 * - Custom Workout sessions: each exerciseLog entry's repsOrSecDone,
 *   bucketed by its category (see exerciseCategoryOrGuess) — reps and
 *   seconds are summed directly with no unit conversion, the same
 *   undifferentiated-volume approach already used for Boss damage
 *   (totalVolumeOfCustomSession) elsewhere in the app, so this doesn't
 *   introduce a second, inconsistent balance model
 * - Run sessions: moving seconds counted into cardio, same "seconds
 *   count as volume" precedent as time-type Custom Workout exercises
 * - Training Camp fitness tests (Phase 2D): the best-ever result per key
 *   is added once as a floor, not accumulated per attempt — a test is a
 *   snapshot of current ability, not training volume to sum repeatedly.
 *   This is what lets a brand-new player's first Plank Test seed their
 *   CORE stat immediately instead of waiting on logged workout history.
 * Shared by the stat bars, the derived "class" flavor title, and the
 * CP number so none of them drift out of sync with each other. */
function loadStatTotals() {
  const totals = { pull: 0, push: 0, legs: 0, core: 0, cardio: 0 };
  loadSessions().forEach(s => {
    if (!s.total) return;
    totals.pull += s.total.pull || 0;
    totals.push += s.total.push || 0;
    totals.legs += s.total.squat || 0;
  });
  loadCustomWorkoutSessions().forEach(s => {
    (s.exerciseLog || []).forEach(e => {
      const cat = exerciseCategoryOrGuess(e);
      totals[cat] = (totals[cat] || 0) + (e.repsOrSecDone || 0);
    });
  });
  loadRunSessions().forEach(s => {
    totals.cardio += s.movingSec || 0;
  });
  STAT_DEFS.forEach(def => {
    totals[def.key] += fitnessTestBestValue(def.key);
  });
  return totals;
}
function renderStatBars(containerId) {
  const wrap = document.getElementById(containerId || 'statBarList');
  if (!wrap) return;
  const totals = loadStatTotals();
  wrap.innerHTML = STAT_DEFS.map(def => {
    const info = computeStatInfo(totals[def.key]);
    return '<div class="stat-bar-row">'
      + '<div class="stat-bar-top"><span class="stat-bar-label">' + def.short + ' · ' + def.label + '</span><span class="stat-bar-lv">LV.' + info.level + '</span></div>'
      + '<div class="stat-bar-track"><div class="stat-bar-fill" style="width:' + Math.round(info.pct * 100) + '%;background:' + def.color + ';"></div></div>'
      + '</div>';
  }).join('');
}

/* ---- derived "class" flavor title — whichever stat has the most
 * lifetime volume gets a title, so two people at the same level can
 * feel like a different build. Pure lookup on loadStatTotals(), nothing
 * new stored. */
const STAT_CLASS_TITLES = { pull: 'นักดึงข้อ', push: 'นักทุบพลัง', legs: 'นักวิ่งทน', core: 'นักแกนกลาง', cardio: 'นักคาร์ดิโอ' };
function computeClassTitle(totals) {
  const keys = STAT_DEFS.map(d => d.key);
  if (!keys.some(k => totals[k])) return '';
  let best = keys[0];
  keys.forEach(k => { if (totals[k] > totals[best]) best = k; });
  return STAT_CLASS_TITLES[best];
}

/* ================= LIFE STATS: DISC / WILL / CONSISTENCY (dev brief §7) ==
 * Same level-curve pattern as the Body stats above (STAT_DEFS / computeStatInfo),
 * fed only from real "did you do what you said you would" signals already
 * tracked elsewhere in the app — nothing here is guessed or simulated:
 *   DISCIPLINE   — total weeks (all-time) where the Weekly Plan was fully
 *                  satisfied. Reuses planDaySatisfied() (see
 *                  computePlanStreak() above) but counts every satisfied
 *                  week in history instead of stopping at the first gap,
 *                  since a broken streak shouldn't erase discipline
 *                  already demonstrated.
 *   CONSISTENCY  — total unique calendar days (all-time) with any logged
 *                  activity (Cindy / Custom Workout / Run) — brief §7
 *                  names Streak as the direct example for this stat;
 *                  this is its lifetime, non-resetting form.
 *   WILLPOWER    — the longest combined streak ever reached, ratcheted
 *                  upward the same "ever" way loadBossEverDefeated()
 *                  tracks bosses beaten, so breaking a streak doesn't
 *                  erase the willpower it took to build it.
 * No MIND stats (INT/FOCUS/LEARN) yet — the app has no reading/focus/
 * learning activity anywhere to derive them from honestly. Adding that
 * category now with nothing real feeding it would just be a permanently
 * empty stat bar, which is its own kind of broken promise to the player. */
const LIFE_STAT_DEFS = [
  { key: 'discipline', label: 'DISCIPLINE', short: 'DISC', color: 'var(--pull)' },
  { key: 'willpower', label: 'WILLPOWER', short: 'WILL', color: 'var(--push)' },
  { key: 'consistency', label: 'CONSISTENCY', short: 'CONST', color: 'var(--run)' }
];
function lifeStatReqForLevel(level) {
  return 5 + (level - 1) * 5;
}
function computeLifeStatInfo(total) {
  let level = 1;
  let remaining = total;
  let req = lifeStatReqForLevel(level);
  while (remaining >= req) {
    remaining -= req;
    level++;
    req = lifeStatReqForLevel(level);
  }
  return { level, pct: req > 0 ? remaining / req : 0 };
}
function earliestActivityTs() {
  const all = []
    .concat(loadSessions().map(s => s.finished))
    .concat(loadCustomWorkoutSessions().map(s => s.completedAt))
    .concat(loadRunSessions().map(s => s.completedAt))
    .filter(Boolean);
  return all.length ? Math.min.apply(null, all) : null;
}
/** All-time count of weeks where every scheduled Weekly Plan day was
 * satisfied — walks backward from this week through real history only
 * (stops once a week falls entirely before the player's first-ever
 * logged activity, via earliestActivityTs(), so an empty plan from
 * before the player started doesn't get counted as free discipline). */
function countAllSatisfiedPlanWeeks() {
  const plan = loadWeeklyPlan();
  const hasAnyScheduledDay = Object.keys(plan).some(k => plan[k]);
  if (!hasAnyScheduledDay) return 0;
  const earliest = earliestActivityTs();
  if (!earliest) return 0;
  let cursor = weekStart(Date.now()).getTime();
  let satisfied = 0;
  const SAFETY_CAP_WEEKS = 520;
  for (let i = 0; i < SAFETY_CAP_WEEKS; i++) {
    if (cursor + 6 * 24 * 60 * 60 * 1000 < earliest) break;
    let weekOk = true;
    for (let d = 0; d < 7; d++) {
      const dayTs = cursor + d * 24 * 60 * 60 * 1000;
      const dayOfWeekIdx = (d + 1) % 7;
      if (!planDaySatisfied(dayTs, plan[dayOfWeekIdx])) { weekOk = false; break; }
    }
    if (weekOk) satisfied++;
    cursor -= 7 * 24 * 60 * 60 * 1000;
  }
  return satisfied;
}
/** All-time count of distinct calendar days with any logged activity. */
function countUniqueActiveDays() {
  const days = new Set();
  loadSessions().forEach(s => { if (s.completed !== false && s.finished) days.add(dayKey(s.finished)); });
  loadCustomWorkoutSessions().forEach(s => { if (s.completedAt) days.add(dayKey(s.completedAt)); });
  loadRunSessions().forEach(s => { if (s.completedAt) days.add(dayKey(s.completedAt)); });
  return days.size;
}
/** Longest combined streak ever reached — ratchets upward on read, same
 * pattern already used for KEY_LAST_SEEN_LEVEL / loadBossEverDefeated. */
const KEY_BEST_STREAK_EVER = 'cindy_best_streak_ever';
function loadBestStreakEver() {
  const n = parseInt(localStorage.getItem(KEY_BEST_STREAK_EVER), 10);
  const stored = Number.isFinite(n) && n > 0 ? n : 0;
  const current = computeCombinedStreak();
  if (current > stored) {
    localStorage.setItem(KEY_BEST_STREAK_EVER, String(current));
    return current;
  }
  return stored;
}
function loadLifeStatTotals() {
  return {
    discipline: countAllSatisfiedPlanWeeks(),
    willpower: loadBestStreakEver(),
    consistency: countUniqueActiveDays()
  };
}
function renderLifeStatBars(containerId) {
  const wrap = document.getElementById(containerId || 'lifeStatBarList');
  if (!wrap) return;
  const totals = loadLifeStatTotals();
  wrap.innerHTML = LIFE_STAT_DEFS.map(def => {
    const info = computeLifeStatInfo(totals[def.key]);
    return '<div class="stat-bar-row">'
      + '<div class="stat-bar-top"><span class="stat-bar-label">' + def.short + ' · ' + def.label + '</span><span class="stat-bar-lv">LV.' + info.level + '</span></div>'
      + '<div class="stat-bar-track"><div class="stat-bar-fill" style="width:' + Math.round(info.pct * 100) + '%;background:' + def.color + ';"></div></div>'
      + '</div>';
  }).join('');
}

/* ---- Fitness Power vs Combat Power (Phase 2B) ----
 * Fitness Power = pure real-world signal — the summed levels of all 5
 * stats, which themselves are derived only from actual reps/seconds
 * logged (see loadStatTotals). Nothing from equipment, quests, or combo
 * play touches this number, on purpose: it's meant to answer "how fit
 * is this player, really" independent of how they play the game.
 *
 * Combat Power used to be totalXP + statLevelSum, but totalXP itself is
 * cindyXP + customXP + runXP + bonuses — and cindyXP/customXP are the
 * exact same reps that feed statLevelSum, just run through a different
 * curve (xpRequiredForLevel vs statReqForLevel). That meant every rep
 * was being counted twice in one number under two different units.
 * Combat Power now = Fitness Power + only the bonus XP that has no stat
 * equivalent (quest/combo/rest-skip/steps — these reward *how* someone
 * plays, not reps already counted above), so nothing is double-counted.
 *
 * This is a deliberate one-time redefinition (not just an additive
 * change) — existing players will see Combat Power drop on the update
 * that ships this, since it's no longer counting reps a second time.
 * See maybeShowCPPatchNote() below for the one-time explanation toast;
 * that toast must ship in the same release as this change. */
function computeFitnessPower() {
  const totals = loadStatTotals();
  return STAT_DEFS.reduce((sum, def) => sum + computeStatInfo(totals[def.key]).level, 0);
}
function computeCombatPower() {
  const bonusXp = loadQuestBonusXP() + loadComboBonusXP() + loadRestSkipBonusXP() + loadStepsBonusXP();
  // Equipment (Phase 2C), Equipment Sets (product doc #4), and the
  // BOSS SLAYER skill's flat bonus (Skill Tree, product doc #18) all add
  // here only — see computeEquipmentPower's, computeSetBonusPower's, and
  // the Skill Tree comment above for why none of these ever reach
  // Fitness Power or Boss Damage.
  return Math.round(computeFitnessPower() + bonusXp + computeEquipmentPower() + computeSetBonusPower() + skillFlatBonus('flatCP'));
}

/* ---- Fitness Rank (product doc #13) ----
 * A letter-grade skin over data that already exists: per-stat level from
 * computeStatInfo() (via loadStatTotals()) and the overall grade from the
 * same average that already drives computeFitnessPower(). Nothing new is
 * stored or computed here — this is purely a mapping layer, per the
 * Phase-3 plan's note that this item needs no new balance work, just a
 * level->grade lookup.
 *
 * Tier width is 5 stat levels per letter (F..S, 7 letters = levels 1-35,
 * then capped at S for anything beyond). Within a tier, the bottom two
 * levels get a '-' modifier, the middle two are plain, and the top level
 * gets a '+' — e.g. level 9 (tier E, position 3 of 5) = "E", level 10
 * (position 4) = "E+". These thresholds aren't specified in the original
 * product doc — flagged there as needing a team balance pass — so treat
 * this as a placeholder curve, easy to retune by editing FITNESS_RANK_TIERS
 * and FITNESS_RANK_TIER_SIZE alone; nothing else depends on the numbers. */
const FITNESS_RANK_TIERS = ['F', 'E', 'D', 'C', 'B', 'A', 'S'];
const FITNESS_RANK_TIER_SIZE = 5;
function fitnessGradeForLevel(level) {
  const lvl = Math.max(1, Math.floor(level));
  const tierIdx = Math.min(FITNESS_RANK_TIERS.length - 1, Math.floor((lvl - 1) / FITNESS_RANK_TIER_SIZE));
  const posInTier = (lvl - 1) % FITNESS_RANK_TIER_SIZE; // 0..4
  let suffix = '';
  if (tierIdx < FITNESS_RANK_TIERS.length - 1 || lvl <= FITNESS_RANK_TIER_SIZE * FITNESS_RANK_TIERS.length) {
    if (posInTier <= 1) suffix = '-';
    else if (posInTier >= 4) suffix = '+';
  }
  const tier = FITNESS_RANK_TIERS[tierIdx];
  return { tier, suffix, label: tier + suffix, level: lvl };
}
/** Per-stat grades plus one overall grade averaged across all 5 stat
 * levels (rounded down) — mirrors how computeFitnessPower() already sums
 * the same per-stat levels, just averaged instead of summed so the grade
 * scale doesn't depend on how many stats exist. */
function computeFitnessRankInfo() {
  const totals = loadStatTotals();
  const perStat = STAT_DEFS.map(def => {
    const info = computeStatInfo(totals[def.key]);
    return Object.assign({ def }, fitnessGradeForLevel(info.level));
  });
  const avgLevel = perStat.reduce((sum, s) => sum + s.level, 0) / (perStat.length || 1);
  const overall = fitnessGradeForLevel(avgLevel);
  return { overall, perStat };
}
function renderFitnessRank(containerId) {
  const wrap = document.getElementById(containerId || 'characterFitnessRank');
  if (!wrap) return;
  const info = computeFitnessRankInfo();
  const rowsHtml = info.perStat.map(s =>
    '<div class="fitness-rank-row">'
    + '<span class="fitness-rank-row-label">' + s.def.short + '</span>'
    + '<span class="fitness-rank-row-grade">' + s.label + '</span>'
    + '</div>'
  ).join('');
  wrap.innerHTML = '<div class="fitness-rank-overall">'
    + '<span class="fitness-rank-overall-lbl">FITNESS RANK</span>'
    + '<span class="fitness-rank-overall-grade">' + info.overall.label + '</span>'
    + '</div>'
    + '<div class="fitness-rank-rows">' + rowsHtml + '</div>';
}

/* ================= SKILL TREE (product doc #18) =================
 * Team decision needed before starting this item was "what does a skill
 * unlock from?" (Level / Fitness Rank / Achievement) — going with Fitness
 * Rank's overall letter grade (computeFitnessRankInfo(), landed in
 * Phase 3's Fitness Rank item), because it's the one progression axis
 * that's a pure real-world signal already (no equipment/bonus-XP mixed
 * in — see Phase 2B's Fitness Power split) and the doc's own framing for
 * Skill Tree ("passive/modifier", not active abilities) fits a grade
 * you *earn through training* better than a level you can also reach by
 * grinding bonus XP.
 *
 * Kept deliberately small: the 3 skills the doc names as examples
 * (SECOND WIND, OVERDRIVE, BOSS SLAYER), no allocation UI, no skill
 * points to spend — every skill whose grade threshold is met is just
 * always on, the same "nothing to configure, it reflects your training"
 * feel as Fitness Rank itself. Nothing here is stored: unlock state is
 * derived live from the current Fitness Rank grade every time it's
 * checked, so there's no new save data that could ever drift out of
 * sync with the stats it's based on.
 *
 * Same Phase 2C guardrail as Equipment/Sets applies to every effect
 * below: they only ever add to bonus-XP counters or flat Combat Power —
 * never to loadStatTotals()/computeFitnessPower(), and never anywhere
 * near Boss Damage (still 100% real reps). SECOND WIND/OVERDRIVE tune
 * *existing* bonus-XP formulas (rest-skip, combo) by a multiplier;
 * BOSS SLAYER adds a flat Combat Power number the same way an equipped
 * item's statBonus does. */
const SKILL_DEFS = [
  { id: 'skill_secondwind', name: 'SECOND WIND', unlockGrade: 'D', effect: 'restSkipMult', value: 1.2,
    desc: 'Rest-skip ให้โบนัส XP มากขึ้น 20%' },
  { id: 'skill_overdrive', name: 'OVERDRIVE', unlockGrade: 'B', effect: 'comboMult', value: 1.25,
    desc: 'โบนัส XP จาก Max Combo ต่อเซสชันเพิ่มขึ้น 25%' },
  { id: 'skill_bossslayer', name: 'BOSS SLAYER', unlockGrade: 'A', effect: 'flatCP', value: 10,
    desc: 'Combat Power เพิ่มถาวร +10' }
];
/** ids of every skill whose unlockGrade tier is at or below the player's
 * current overall Fitness Rank tier (suffix +/- ignored — tier letter
 * only, same granularity the doc's grade examples use). */
function loadUnlockedSkillIds() {
  const overallTier = computeFitnessRankInfo().overall.tier;
  const tierIdx = FITNESS_RANK_TIERS.indexOf(overallTier);
  return SKILL_DEFS.filter(s => tierIdx >= FITNESS_RANK_TIERS.indexOf(s.unlockGrade)).map(s => s.id);
}
function isSkillUnlocked(id) {
  return loadUnlockedSkillIds().indexOf(id) !== -1;
}
/** Combined multiplier from every unlocked skill tagged with this effect
 * key (multiplicative — only matters once there's ever 2+ skills sharing
 * a key, none do yet, but keeps this correct if that changes). */
function skillEffectMultiplier(effectKey) {
  const unlocked = loadUnlockedSkillIds();
  return SKILL_DEFS.reduce((mult, s) => (s.effect === effectKey && unlocked.indexOf(s.id) !== -1) ? mult * s.value : mult, 1);
}
/** Combined flat bonus from every unlocked skill tagged with this effect key. */
function skillFlatBonus(effectKey) {
  const unlocked = loadUnlockedSkillIds();
  return SKILL_DEFS.reduce((sum, s) => (s.effect === effectKey && unlocked.indexOf(s.id) !== -1) ? sum + s.value : sum, 0);
}

/* ---- new-skill detection for the System Window ----
 * Skills here unlock silently (derived live from Fitness Rank, see
 * loadUnlockedSkillIds() above) rather than being granted by a discrete
 * action, so unlike level-up or boss-defeat there's no natural call site
 * to announce from. This tracks which skill ids the player has already
 * been shown and fires showSystemEvent() for any that just appeared —
 * safe to call from anywhere; a no-op once nothing new has unlocked. */
const KEY_SEEN_UNLOCKED_SKILLS = 'cindy_seen_unlocked_skills';
function checkNewlyUnlockedSkills() {
  const unlocked = loadUnlockedSkillIds();
  const raw = localStorage.getItem(KEY_SEEN_UNLOCKED_SKILLS);
  if (raw === null) {
    // First run on this device (or pre-existing player before this
    // shipped) — seed silently so nobody gets a flood of "new skill"
    // popups for skills their Fitness Rank already cleared long ago.
    localStorage.setItem(KEY_SEEN_UNLOCKED_SKILLS, JSON.stringify(unlocked));
    return;
  }
  let seen = [];
  try { seen = JSON.parse(raw) || []; } catch (e) { seen = []; }
  const newlyUnlocked = unlocked.filter(id => seen.indexOf(id) === -1);
  if (newlyUnlocked.length === 0) return;
  localStorage.setItem(KEY_SEEN_UNLOCKED_SKILLS, JSON.stringify(unlocked));
  newlyUnlocked.forEach(s => {
    const skill = SKILL_DEFS.find(d => d.id === s);
    if (!skill) return;
    showSystemEvent({
      header: 'NEW SKILL UNLOCKED',
      title: skill.name,
      rewards: [skill.desc],
      accent: '#B48CFF'
    });
  });
}

function renderSkillTree(containerId) {
  const wrap = document.getElementById(containerId || 'skillTreeList');
  if (!wrap) return;
  const unlocked = loadUnlockedSkillIds();
  wrap.innerHTML = SKILL_DEFS.map(s => {
    const isUnlocked = unlocked.indexOf(s.id) !== -1;
    return '<div class="boss-view-item' + (isUnlocked ? ' unlocked' : '') + '">'
      + '<div class="boss-view-item-top">'
      + '<div><div class="boss-view-item-name">' + s.name + '</div>'
      + '<div class="boss-view-item-tag">ปลดล็อกที่ Fitness Rank ' + s.unlockGrade + ' ขึ้นไป</div></div>'
      + '<div class="boss-view-item-status">' + (isUnlocked ? 'ACTIVE' : 'LOCKED') + '</div>'
      + '</div>'
      + '<div class="boss-view-item-story">' + s.desc + '</div>'
      + '</div>';
  }).join('');
}

/* ---- boss trophy wall — reuses loadBossEverDefeated() (already tracked
 * for skin unlocks) and the icon/colors already defined per-boss on each
 * "ผู้พิชิต ..." skin in MASCOT_SKINS, so no new art or storage. */
function renderCharacterBossTrophyRow() {
  const wrap = document.getElementById('characterBossTrophyRow');
  const summary = document.getElementById('characterBossSummary');
  if (!wrap) return;
  const defeated = loadBossEverDefeated();
  wrap.innerHTML = BOSS_ROSTER.map(b => {
    const isDefeated = defeated.indexOf(b.id) !== -1;
    const skin = MASCOT_SKINS.find(s => s.unlock && s.unlock.type === 'boss' && s.unlock.bossId === b.id);
    const badge = (isDefeated && skin)
      ? skinIconHtml(skin, { glow: true })
      : lockedBadgeHtml();
    return '<div class="character-trophy-item' + (isDefeated ? ' defeated' : ' locked') + '">'
      + badge
      + '<div class="trophy-name">' + b.name + '</div>'
      + '</div>';
  }).join('');
  if (summary) summary.textContent = 'ผู้พิชิต ' + defeated.length + '/' + BOSS_ROSTER.length;
}

/* ================= ACHIEVEMENTS + TITLE =================
 * Achievements are permanent records of things the player has already
 * done — unlike Quests (see QUEST_POOL above), which are things the game
 * is asking the player to do today. Every check below reads data that's
 * already tracked elsewhere (sessions, streak, bosses defeated, per-
 * session maxCombo) — nothing new is logged during a workout, only a
 * small "which ids are unlocked" list that only ever grows. Rewards are
 * cosmetic-only (a selectable Title), same guardrail already used for
 * mascot skins, so this can't become a stat-balance problem. */
const KEY_ACH_UNLOCKED = 'cindy_achievements_unlocked_v1';
const KEY_ACTIVE_TITLE = 'cindy_active_title';

const ACHIEVEMENTS = [
  { id: 'first_blood', title: 'FIRST BLOOD', desc: 'ปราบบอสตัวแรกให้สำเร็จ', titleText: 'ผู้พิชิต',
    check: (ctx) => ctx.bossesDefeated >= 1 },
  { id: 'week_warrior', title: 'WEEK WARRIOR', desc: 'ทำ Streak ต่อเนื่อง 7 วัน', titleText: 'นักสู้ประจำสัปดาห์',
    check: (ctx) => ctx.streak >= 7 },
  { id: 'iron_will', title: 'IRON WILL', desc: 'ทำ Streak ต่อเนื่อง 30 วัน', titleText: 'IRON WILL',
    check: (ctx) => ctx.streak >= 30 },
  { id: 'century', title: 'CENTURY', desc: 'ออกกำลังกายครบ 100 ครั้ง', titleText: 'นักสู้ร้อยศึก',
    check: (ctx) => ctx.totalWorkouts >= 100 },
  { id: 'machine', title: 'MACHINE', desc: 'สะสมเรพรวมตลอดกาลครบ 1,000 ครั้ง', titleText: 'THE MACHINE',
    check: (ctx) => ctx.totalReps >= 1000 },
  { id: 'overdrive', title: 'OVERDRIVE', desc: 'ทำ Combo ถึง x20 ในหนึ่งเซสชัน', titleText: 'OVERDRIVE',
    check: (ctx) => ctx.bestCombo >= 20 },
  { id: 'boss_slayer', title: 'BOSS SLAYER', desc: 'ปราบบอสให้ครบทุกตัว', titleText: 'BOSS SLAYER',
    check: (ctx) => ctx.allBosses > 0 && ctx.bossesDefeated >= ctx.allBosses },
  { id: 'disciplined', title: 'DISCIPLINED', desc: 'ทำตาม Weekly Plan ต่อเนื่อง 4 สัปดาห์', titleText: 'DISCIPLINED',
    check: (ctx) => ctx.planStreak >= 4 }
];

function loadAchievementUnlocked() {
  try { return JSON.parse(localStorage.getItem(KEY_ACH_UNLOCKED)) || []; }
  catch (e) { return []; }
}
function saveAchievementUnlocked(list) {
  localStorage.setItem(KEY_ACH_UNLOCKED, JSON.stringify(list));
}
function loadActiveTitleId() {
  return localStorage.getItem(KEY_ACTIVE_TITLE) || '';
}

function achievementContext() {
  const cindy = loadSessions().filter(s => s.completed !== false);
  const custom = loadCustomWorkoutSessions();
  const run = loadRunSessions();
  const cindyReps = cindy.reduce((sum, s) => sum + (s.total ? s.total.reps : 0), 0);
  const customReps = custom.reduce((sum, s) => sum + totalVolumeOfCustomSession(s), 0);
  const bestCombo = cindy.reduce((m, s) => Math.max(m, s.maxCombo || 0), 0);
  return {
    totalWorkouts: cindy.length + custom.length + run.length,
    totalReps: cindyReps + customReps,
    streak: computeCombinedStreak(),
    planStreak: computePlanStreak(),
    bossesDefeated: loadBossEverDefeated().length,
    allBosses: BOSS_ROSTER.length,
    bestCombo
  };
}

/** Checks every achievement against current data, persists any newly
 * earned ones, and — same "you earned this" language as boss defeats —
 * surfaces a toast per new unlock. Cheap enough to call from any main
 * render pass (renderHome / renderCharacterSheet); nothing here recomputes
 * anything not already computed elsewhere on the same screen. */
function checkAndUnlockAchievements() {
  const unlocked = loadAchievementUnlocked();
  const ctx = achievementContext();
  let changed = false;
  ACHIEVEMENTS.forEach(a => {
    if (unlocked.indexOf(a.id) === -1 && a.check(ctx)) {
      unlocked.push(a.id);
      changed = true;
      addSeasonPoints(SEASON_POINTS_ACHIEVEMENT); // product doc #20
      queueCelebration({
        icon: 'gift',
        title: a.title,
        subtitle: a.desc,
        rarityLabel: '★ ACHIEVEMENT ★',
        accent: '#FFD700',
        premium: true
      });
    }
  });
  if (changed) saveAchievementUnlocked(unlocked);
  return unlocked;
}

function activeTitleText() {
  const id = loadActiveTitleId();
  if (!id) return '';
  const unlocked = loadAchievementUnlocked();
  if (unlocked.indexOf(id) === -1) return ''; // guard against a stale/removed id
  const a = ACHIEVEMENTS.find(x => x.id === id);
  return a ? a.titleText : '';
}

function renderCharacterTitleTag() {
  const el = document.getElementById('characterTitleTag');
  if (!el) return;
  const text = activeTitleText();
  el.textContent = text ? '「' + text + '」' : '';
}

function setActiveTitle(id) {
  const unlocked = loadAchievementUnlocked();
  if (id && unlocked.indexOf(id) === -1) return; // can't equip a locked title
  localStorage.setItem(KEY_ACTIVE_TITLE, id || '');
  renderCharacterTitleTag();
  renderAchList();
}

function renderAchList() {
  const wrap = document.getElementById('achList');
  const summary = document.getElementById('achSummary');
  if (!wrap) return;
  const unlocked = checkAndUnlockAchievements();
  const activeId = loadActiveTitleId();
  if (summary) summary.textContent = unlocked.length + '/' + ACHIEVEMENTS.length;
  wrap.innerHTML = ACHIEVEMENTS.map(a => {
    const isUnlocked = unlocked.indexOf(a.id) !== -1;
    const isActive = isUnlocked && activeId === a.id;
    let btnHtml = '';
    if (isUnlocked) {
      btnHtml = '<button class="btn btn-outline btn-sm ach-title-btn' + (isActive ? ' active' : '')
        + '" onclick="setActiveTitle(\'' + (isActive ? '' : a.id) + '\')">'
        + (isActive ? 'กำลังใช้เป็น Title' : 'ตั้งเป็น Title') + '</button>';
    }
    return '<div class="boss-view-item ach-item' + (isUnlocked ? ' unlocked' : '') + '">'
      + '<div class="boss-view-item-top">'
      + '<div><div class="boss-view-item-name">' + a.title + '</div>'
      + '<div class="boss-view-item-tag">' + a.desc + '</div></div>'
      + '<div class="boss-view-item-status">' + (isUnlocked ? 'UNLOCKED' : 'LOCKED') + '</div>'
      + '</div>' + btnHtml + '</div>';
  }).join('');
}

function openAchModal() {
  const modal = document.getElementById('achModal');
  if (!modal) return;
  renderAchList();
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
}
function closeAchModal() {
  const modal = document.getElementById('achModal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden', 'true');
}
function initAchModal() {
  document.querySelectorAll('[data-ach-close]').forEach(el => el.addEventListener('click', closeAchModal));
}

/* ---- equipment slots — the equipped skin + equipped loot badge, both
 * already tracked (loadActiveSkin / equippedLootItem) for the mascot
 * avatar itself; this just surfaces the same two picks as RPG-style
 * equipment slots that link back to where they're changed. */
function renderCharacterEquipment() {
  const item = equippedLootItem();
  const lootIconEl = document.getElementById('characterEquipLootIcon');
  const lootNameEl = document.getElementById('characterEquipLootName');
  if (lootIconEl) {
    lootIconEl.innerHTML = item
      ? lootBadgeHtml(item, { glow: true, ring: true })
      : lockedBadgeHtml();
  }
  if (lootNameEl) lootNameEl.textContent = item ? item.name : 'ยังไม่ได้สวม';
  const lootStatEl = document.getElementById('characterEquipLootStat');
  if (lootStatEl) lootStatEl.textContent = item ? lootStatBonusLabel(item) : '';
}
/** Jumps to the Collection screen and scrolls straight to the loot
 * grid — used by the Character sheet's equipment slot so tapping it
 * goes right to where the loot badge is changed. */
function goToCollectionSection(section) {
  go('collection');
  setTimeout(() => {
    const el = document.getElementById('collectionLootGrid');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 60);
}

/* ---- recent battle log — the last few entries from the same combined
 * Cindy + Custom Workout history used on the History screen, just
 * re-laid-out as a short list here; doesn't touch renderHistory(). */
function renderCharacterRecentLog() {
  const wrap = document.getElementById('characterRecentLog');
  if (!wrap) return;
  const cindyItems = loadSessions().map(s => ({ kind: 'cindy', ts: s.finished, data: s }));
  const customItems = loadCustomWorkoutSessions().map(s => ({ kind: 'custom', ts: s.completedAt, data: s }));
  const merged = cindyItems.concat(customItems).sort((a, b) => b.ts - a.ts).slice(0, 4);

  if (merged.length === 0) {
    wrap.innerHTML = '<div class="empty-hint">ยังไม่มีประวัติการเล่น</div>';
    return;
  }
  wrap.innerHTML = merged.map(item => {
    if (item.kind === 'cindy') {
      const s = item.data;
      return '<div class="character-recent-log-item">'
        + '<div><div class="character-recent-log-date">' + fmtDate(s.finished) + '<span class="type-tag cindy">CINDY</span></div>'
        + '<div class="character-recent-log-meta">' + s.total.reps + ' REPS · ' + escapeHtml(s.protocolName || 'Cindy') + '</div></div>'
        + '<div class="character-recent-log-rounds">' + s.rounds + 'R</div>'
        + '</div>';
    }
    const s = item.data;
    const meta = s.setsCompleted + ' เซ็ต · ' + fmtTime(s.totalDurationSec);
    return '<div class="character-recent-log-item">'
      + '<div><div class="character-recent-log-date">' + fmtDate(s.completedAt) + '<span class="type-tag custom">' + escapeHtml((s.workoutName || 'CUSTOM').toUpperCase()) + '</span></div>'
      + '<div class="character-recent-log-meta">' + meta + '</div></div>'
      + '<div class="character-recent-log-rounds">' + fmtTime(s.totalDurationSec) + '</div>'
      + '</div>';
  }).join('');
}

/* ================= CHARACTER SHEET =================
 * Standalone "character" screen combining pieces that already exist
 * elsewhere: the mascot avatar + its equipped skin (Home), the rank badge
 * and title (Home), and the STR/PWR/END stat bars (Progress). Nothing new
 * is computed or stored — this is purely a different arrangement of the
 * same derived data, laid out like an RPG character sheet (mascot centered,
 * stats around it) instead of a list item in the Progress screen. */
function renderCharacterSheet() {
  const levelBadge = document.getElementById('characterLevelBadge');
  if (!levelBadge) return;

  const info = computeLevelInfo(computeTotalXP());
  levelBadge.textContent = 'LV.' + info.level;
  renderCharacterName();
  const rank = rankForLevel(info.level);
  const rankEl = document.getElementById('characterRank');
  if (rankEl) {
    rankEl.innerHTML = iconHtml(rank.icon) + ' ' + rank.title;
    RANK_TIERS.forEach(r => rankEl.classList.remove('rank-' + r.title.toLowerCase()));
    rankEl.classList.add('rank-' + rank.title.toLowerCase());
  }
  const tier = rank.title.toLowerCase();
  RANK_TIERS.forEach(r => levelBadge.classList.remove('lvbadge-' + r.title.toLowerCase()));
  if (tier !== 'recruit') levelBadge.classList.add('lvbadge-' + tier);

  renderStatBars('characterStatBarList');
  renderLifeStatBars('characterLifeStatBarList');
  renderFitnessRank('characterFitnessRank');
  renderSkillTree('skillTreeList');

  const cpEl = document.getElementById('characterCP');
  if (cpEl) {
    cpEl.innerHTML = '<div class="character-cp-val">' + computeCombatPower().toLocaleString() + '</div>'
      + '<div class="character-cp-lbl">COMBAT POWER</div>'
      + '<div class="character-fp-lbl">FITNESS POWER ' + computeFitnessPower().toLocaleString() + '</div>';
  }
  const classEl = document.getElementById('characterClassTitle');
  if (classEl) classEl.textContent = computeClassTitle(loadStatTotals());

  renderCharacterEquipment();
  renderSeasonTeaser();
  renderCharacterBossTrophyRow();
  renderCharacterRecentLog();
  renderCharacterTitleTag();
  runSystemChecks();
  renderPinSettingsUI();
}

/* ================= TRAINING CAMP SCREEN =================
 * Renders one card per FITNESS_TESTS entry — either an "ยังไม่เคยทดสอบ"
 * empty state with a start button, or the baseline/latest/best readout
 * with a delta vs baseline and a retest button. All numbers come from
 * fitnessTestInfo(); this function only formats. */
function fmtFitnessTestValue(test, value) {
  return test.unit === 'วินาที' ? fmtTime(value) : String(value);
}
function renderTrainingCamp() {
  const wrap = document.getElementById('trainingCampList');
  if (!wrap) return;
  wrap.innerHTML = FITNESS_TESTS.map(test => {
    const info = fitnessTestInfo(test.key);
    const iconHtmlStr = badgeHtml(test.icon, '#fff', test.color, { cls: 'tc-icon' });
    if (!info) {
      return '<div class="tc-card">'
        + '<div class="tc-card-top">' + iconHtmlStr
        + '<div class="tc-card-title"><div class="tc-name">' + test.label + '</div>'
        + '<div class="tc-desc">' + test.desc + '</div></div></div>'
        + '<button class="btn btn-primary btn-sm" style="width:100%;margin-top:10px;" onclick="openFitnessTestModal(\'' + test.key + '\')">เริ่ม Test ครั้งแรก</button>'
        + '</div>';
    }
    const deltaSign = info.deltaPct > 0 ? '+' : '';
    const deltaColor = info.deltaPct > 0 ? 'var(--success)' : (info.deltaPct < 0 ? 'var(--danger)' : 'var(--text-faint)');
    const deltaHtml = info.count > 1
      ? '<span style="color:' + deltaColor + ';font-weight:800;">' + deltaSign + info.deltaPct + '%</span>'
      : '<span style="color:var(--text-faint);">BASELINE</span>';
    return '<div class="tc-card">'
      + '<div class="tc-card-top">' + iconHtmlStr
      + '<div class="tc-card-title"><div class="tc-name">' + test.label + '</div>'
      + '<div class="tc-desc">' + test.desc + '</div></div></div>'
      + '<div class="tc-stats-row">'
      + '<div class="tc-stat"><div class="tc-stat-lbl">BASELINE</div><div class="tc-stat-val">' + fmtFitnessTestValue(test, info.baseline.value) + '</div></div>'
      + '<div class="tc-stat"><div class="tc-stat-lbl">ล่าสุด</div><div class="tc-stat-val">' + fmtFitnessTestValue(test, info.latest.value) + '</div></div>'
      + '<div class="tc-stat"><div class="tc-stat-lbl">ดีที่สุด</div><div class="tc-stat-val">' + fmtFitnessTestValue(test, info.best.value) + '</div></div>'
      + '</div>'
      + '<div class="tc-delta-row">' + deltaHtml + '</div>'
      + '<button class="btn btn-outline btn-sm" style="width:100%;margin-top:8px;" onclick="openFitnessTestModal(\'' + test.key + '\')">ทดสอบอีกครั้ง</button>'
      + '</div>';
  }).join('');
}
function openFitnessTestModal(key) {
  const test = FITNESS_TESTS.find(t => t.key === key);
  if (!test) return;
  const modal = document.getElementById('fitnessTestModal');
  modal.dataset.testKey = key;
  document.getElementById('fitnessTestTitle').textContent = test.label;
  document.getElementById('fitnessTestDesc').textContent = test.desc;
  document.getElementById('fitnessTestUnitLabel').textContent = test.unit;
  const input = document.getElementById('fitnessTestInput');
  input.value = '';
  modal.classList.add('active');
  setTimeout(() => input.focus(), 50);
}
function submitFitnessTest() {
  const modal = document.getElementById('fitnessTestModal');
  const key = modal.dataset.testKey;
  const test = FITNESS_TESTS.find(t => t.key === key);
  const input = document.getElementById('fitnessTestInput');
  const value = Number(input.value);
  if (!test || !Number.isFinite(value) || value < 0) { showToast('กรอกตัวเลขให้ถูกต้อง'); return; }
  const wasFirst = !fitnessTestInfo(key);
  recordFitnessTest(key, value);
  closeModal('fitnessTestModal');
  showToast(wasFirst ? 'บันทึก BASELINE แล้ว — ' + test.label : 'บันทึกผล Test แล้ว', 'target');
  renderTrainingCamp();
  if (document.getElementById('screen-character') && document.getElementById('screen-character').classList.contains('active')) {
    renderCharacterSheet();
  }
}

/* ================= MASCOT SKINS =================
 * Most tiers (streak chests, level milestones, boss kills) use dedicated
 * full-body art via `img`; a skin without one falls back to the plain
 * mascot.png with its `filter` applied on top. Unlock state is never
 * stored separately; each skin derives its unlocked/locked status from
 * state that's already tracked elsewhere and only ever ratchets upward
 * (opened chests, highest level ever seen, bosses ever defeated), so
 * there's nothing to keep in sync. */
const KEY_ACTIVE_SKIN = 'cindy_active_skin';
const MASCOT_SKINS = [
  { id: 'default', name: 'Classic', filter: 'none', icon: 'assets/skin-icons/default.png', unlock: { type: 'always' } },

  { id: 'streak7', name: 'นักสู้ 7 วัน', img: 'assets/mascot/skin-streak7.png', filter: 'none', icon: 'assets/skin-icons/streak7.png',
    aura: 'rgba(224,150,61,.55)', accIcon: 'scarf', accC1: '#f6cf94', accC2: '#c07a2a',
    unlock: { type: 'streak', value: 7 }, cond: 'เปิดหีบ Streak 7 วัน' },
  { id: 'streak14', name: 'นักสู้ 14 วัน', img: 'assets/mascot/skin-streak14.png', filter: 'none', icon: 'assets/skin-icons/streak14.png',
    aura: 'rgba(80,190,200,.55)', accIcon: 'mitten', accC1: '#a9eaf0', accC2: '#2a97a3',
    unlock: { type: 'streak', value: 14 }, cond: 'เปิดหีบ Streak 14 วัน' },
  { id: 'streak30', name: 'นักรบ 30 วัน', img: 'assets/mascot/skin-streak30.png', filter: 'none', icon: 'assets/skin-icons/streak30.png',
    aura: 'rgba(255,140,60,.6)', accIcon: 'shield', accC1: '#ffd7ad', accC2: '#e0641a',
    unlock: { type: 'streak', value: 30 }, cond: 'เปิดหีบ Streak 30 วัน' },
  { id: 'streak100', name: 'ตำนาน 100 วัน', img: 'assets/mascot/skin-streak100.png', filter: 'none', icon: 'assets/skin-icons/streak100.png',
    aura: 'rgba(190,90,255,.65)', accIcon: 'crown', accC1: '#fff0b0', accC2: '#d9a71b', strong: true,
    unlock: { type: 'streak', value: 100 }, cond: 'เปิดหีบ Streak 100 วัน' },

  { id: 'lv5', name: 'นักเรียนวินัย LV.5', img: 'assets/mascot/skin-lv5.png', filter: 'none', icon: 'assets/skin-icons/lv5.png',
    aura: 'rgba(110,200,90,.5)', accIcon: 'boxGlove', accC1: '#c8f0b8', accC2: '#4a9a34',
    unlock: { type: 'level', value: 5 }, cond: 'ถึง LV.5' },
  { id: 'lv10', name: 'มือฝึกฝน LV.10', img: 'assets/mascot/skin-lv10.png', filter: 'none', icon: 'assets/skin-icons/lv10.png',
    aura: 'rgba(60,210,170,.55)', accIcon: 'gi', accC1: '#b8f5e0', accC2: '#1f9a7a',
    unlock: { type: 'level', value: 10 }, cond: 'ถึง LV.10' },
  { id: 'lv15', name: 'ยอดฝีมือ LV.15', img: 'assets/mascot/skin-lv15.png', filter: 'none', icon: 'assets/skin-icons/lv15.png',
    aura: 'rgba(70,140,255,.6)', accIcon: 'swordsCross', accC1: '#b9d3ff', accC2: '#2f5fdb',
    unlock: { type: 'level', value: 15 }, cond: 'ถึง LV.15' },
  { id: 'lv20', name: 'จอมพลังกาย LV.20', img: 'assets/mascot/skin-lv20.png', filter: 'none', icon: 'assets/skin-icons/lv20.png',
    aura: 'rgba(255,60,150,.65)', accIcon: 'flame', accC1: '#ffc2dd', accC2: '#e0186f', strong: true,
    unlock: { type: 'level', value: 20 }, cond: 'ถึง LV.20' },

  { id: 'bossGrinder1', name: 'ผู้พิชิต GRINDER-1', img: 'assets/mascot/skin-bossgrinder1.png', filter: 'none', icon: 'assets/skin-icons/boss-grinder1.png',
    aura: 'rgba(232,80,40,.6)', accIcon: 'gearCog', accC1: '#ffb89a', accC2: '#c23f14', strong: true,
    unlock: { type: 'boss', bossId: 'grinder1' }, cond: 'ปราบ GRINDER-1 สำเร็จ' },
  { id: 'bossIronmaw', name: 'ผู้พิชิต IRON MAW', img: 'assets/mascot/skin-bossironmaw.png', filter: 'none', icon: 'assets/skin-icons/boss-ironmaw.png',
    aura: 'rgba(200,160,80,.6)', accIcon: 'fang', accC1: '#f0dba0', accC2: '#a67a1f', strong: true,
    unlock: { type: 'boss', bossId: 'ironmaw' }, cond: 'ปราบ IRON MAW สำเร็จ' },
  { id: 'bossVoid9', name: 'ผู้พิชิต VOID-9', img: 'assets/mascot/skin-bossvoid9.png', filter: 'none', icon: 'assets/skin-icons/boss-void9.png',
    aura: 'rgba(130,60,220,.65)', accIcon: 'vortex', accC1: '#d9b8ff', accC2: '#6a1fc7', strong: true,
    unlock: { type: 'boss', bossId: 'void9' }, cond: 'ปราบ VOID-9 สำเร็จ' },
  { id: 'bossWingreaper', name: 'ผู้พิชิต WING REAPER', img: 'assets/mascot/skin-bosswingreaper.png', filter: 'none', icon: 'assets/skin-icons/boss-wingreaper.png',
    aura: 'rgba(70,200,190,.6)', accIcon: 'wing', accC1: '#a8f0e8', accC2: '#1a8a7d', strong: true,
    unlock: { type: 'boss', bossId: 'wingreaper' }, cond: 'ปราบ WING REAPER สำเร็จ' },
  { id: 'bossCorezero', name: 'ผู้พิชิต CORE-ZERO', img: 'assets/mascot/skin-bosscorezero.png', filter: 'none', icon: 'assets/skin-icons/boss-corezero.png',
    aura: 'rgba(255,80,200,.7)', accIcon: 'core', accC1: '#ffc2ee', accC2: '#c71494', strong: true,
    unlock: { type: 'boss', bossId: 'corezero' }, cond: 'ปราบ CORE-ZERO สำเร็จ' }
];
function isSkinUnlocked(skin) {
  switch (skin.unlock.type) {
    case 'always': return true;
    case 'streak': return loadOpenedChests().indexOf(skin.unlock.value) !== -1;
    case 'level': return loadLastSeenLevel() >= skin.unlock.value;
    case 'boss': return loadBossEverDefeated().indexOf(skin.unlock.bossId) !== -1;
    default: return false;
  }
}
function loadActiveSkin() {
  return localStorage.getItem(KEY_ACTIVE_SKIN) || 'default';
}
function saveActiveSkin(id) {
  localStorage.setItem(KEY_ACTIVE_SKIN, id);
}
/** Applies the current active skin's filter, aura glow, and accessory badge
 * to the mascot avatar. Falls back to plain/no-effects if the saved active
 * skin somehow isn't unlocked anymore. */
function applyActiveMascotSkinFilter() {
  const img = document.getElementById('mascotImg');
  const imgGlow = document.getElementById('mascotImgGlow');
  const avatar = document.getElementById('mascotAvatar');
  const accessory = document.getElementById('mascotSkinAccessory');
  if (!img) return;
  const skin = MASCOT_SKINS.find(s => s.id === loadActiveSkin()) || MASCOT_SKINS[0];
  const unlocked = isSkinUnlocked(skin);
  img.src = (unlocked && skin.img) ? skin.img : 'assets/mascot/mascot.png';
  img.style.filter = unlocked ? skin.filter : 'none';
  // glow clone always mirrors the real src so the rank-aura silhouette matches
  // whichever skin is equipped — its own filter (brightness(0)+drop-shadow) is
  // set entirely by CSS via .aura-* classes, never touched here
  if (imgGlow) imgGlow.src = img.src;

  if (avatar) {
    const hasAura = !!(unlocked && skin.aura);
    avatar.classList.toggle('skin-glow', hasAura);
    avatar.classList.toggle('skin-glow-strong', hasAura && !!skin.strong);
    avatar.style.setProperty('--skin-aura', hasAura ? skin.aura : 'transparent');
  }
  if (accessory) {
    if (unlocked && skin.accIcon) {
      accessory.innerHTML = skinIconHtml(skin, { glow: !!skin.strong });
      accessory.classList.add('show');
    } else {
      accessory.classList.remove('show');
    }
  }
  renderMascotTitle('mascotSkinTitle', skin, unlocked);
  applyEquippedLootBadge('mascotLootBadge');
}

/* ================= TITLES (paired with mascot skins) =================
 * Each unlocked skin's own display name already reads like an RPG title
 * ("นักสู้ 7 วัน", "ตำนาน 100 วัน", "ผู้พิชิต CORE-ZERO"...) — this just
 * surfaces that name as a title chip next to the rank badge instead of
 * introducing a second, separate title system. Default skin shows nothing
 * (rank badge alone covers that case). No longer called from the Home/
 * Character/Companion HUD (their target elements were removed along with
 * the mascot avatar), kept only as a no-op-safe helper for any other
 * caller that still passes an element id.
 */
function renderMascotTitle(elId, skin, unlocked) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (unlocked && skin.id !== 'default') {
    el.textContent = skin.name;
    el.classList.add('show');
    el.classList.toggle('title-strong', !!skin.strong);
  } else {
    el.textContent = '';
    el.classList.remove('show', 'title-strong');
  }
}
/** Rest-skip bonus visual: a bouncing "+N XP" badge on the timer ring
 * (same pop/scale language as the AMRAP screen's .combo-badge). */
function showRestSkipBonusEffect(bonus) {
  const badge = document.getElementById('restBonusBadge');
  if (!badge) return;
  badge.textContent = '+' + bonus + ' XP';
  badge.classList.remove('show', 'pulse');
  void badge.offsetWidth;
  badge.classList.add('show', 'pulse');
  clearTimeout(showRestSkipBonusEffect._h);
  showRestSkipBonusEffect._h = setTimeout(() => badge.classList.remove('show'), 900);
}
/* ================= COLLECTION / TROPHY ROOM =================
 * One screen combining the three collectible sets that already exist
 * elsewhere (chest badges, mascot skins, rank titles). Nothing new is
 * stored — each grid just reuses the same unlock checks as the chest
 * modal and skin picker, rendered with the same .skin-item card. */
function renderCollection() {
  renderCollectionBadges();
  renderCollectionTitles();
  renderLootGrid('collectionLootGrid');
  renderLootSets('collectionLootSets');
  const badgeCount = STREAK_MILESTONES.filter(m => loadOpenedChests().indexOf(m) !== -1).length;
  const titleCount = RANK_TIERS.filter(r => loadLastSeenLevel() >= r.min).length;
  const summary = document.getElementById('collectionSummary');
  if (summary) {
    summary.textContent = 'สะสมแล้ว ' + (badgeCount + titleCount) + ' / ' + (STREAK_MILESTONES.length + RANK_TIERS.length);
  }
  const lootInv = loadLootInventory();
  const lootOwnedCount = LOOT_ITEMS.filter(it => (lootInv[it.id] || 0) > 0).length;
  const lootSummary = document.getElementById('collectionLootSummary');
  if (lootSummary) lootSummary.textContent = 'เก็บได้ ' + lootOwnedCount + ' / ' + LOOT_ITEMS.length + ' ชิ้น';
}
function renderCollectionBadges() {
  const grid = document.getElementById('collectionBadgeGrid');
  if (!grid) return;
  const opened = loadOpenedChests();
  grid.innerHTML = STREAK_MILESTONES.map(m => {
    const info = streakBadgeInfo(m);
    const unlocked = opened.indexOf(m) !== -1;
    const cls = 'skin-item' + (unlocked ? '' : ' locked');
    return '<div class="' + cls + '">'
      + (unlocked ? '' : '<div class="lock-icon">' + iconHtml('lock') + '</div>')
      + '<div class="collection-emoji">' + (unlocked ? badgeHtml(info.icon, info.c1, info.c2, { glow: true, ring: true, glowColor: info.glow }) : lockedBadgeHtml()) + '</div>'
      + '<div class="skin-name">' + info.title + '</div>'
      + (unlocked ? '' : '<div class="skin-cond">Streak ' + m + ' วัน</div>')
      + '</div>';
  }).join('');
}
function renderCollectionTitles() {
  const grid = document.getElementById('collectionTitleGrid');
  if (!grid) return;
  const level = loadLastSeenLevel();
  grid.innerHTML = RANK_TIERS.map(r => {
    const unlocked = level >= r.min;
    const cls = 'skin-item' + (unlocked ? '' : ' locked');
    return '<div class="' + cls + '">'
      + (unlocked ? '' : '<div class="lock-icon">' + iconHtml('lock') + '</div>')
      + '<div class="collection-emoji">' + iconHtml(r.icon) + '</div>'
      + '<div class="skin-name">' + r.title + '</div>'
      + '<div class="skin-cond">LV.' + r.min + (r.max === Infinity ? '+' : ('–' + r.max)) + '</div>'
      + '</div>';
  }).join('');
}

function didPlayToday() {
  const todayKey = dayKey(Date.now());
  const cindyToday = loadSessions().some(s => dayKey(s.finished) === todayKey);
  if (cindyToday) return true;
  if (loadCustomWorkoutSessions().some(s => dayKey(s.completedAt) === todayKey)) return true;
  return loadRunSessions().some(s => dayKey(s.completedAt) === todayKey);
}

/** Counts sessions with a timestamp within the last n days (including today). */
function countSessionsInLastNDays(timestamps, n) {
  const cutoff = new Date();
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (n - 1));
  return timestamps.filter(t => t >= cutoff.getTime()).length;
}

const DEFAULT_RING_GOAL = 5; // sessions/week considered a "full" ring, per mode
const KEY_RING_GOALS = 'cindy_week_ring_goals';
function loadRingGoals() {
  const goals = { cindy: DEFAULT_RING_GOAL, custom: DEFAULT_RING_GOAL };
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_RING_GOALS));
    if (saved && typeof saved === 'object') {
      if (Number.isFinite(saved.cindy) && saved.cindy > 0) goals.cindy = saved.cindy;
      if (Number.isFinite(saved.custom) && saved.custom > 0) goals.custom = saved.custom;
    }
  } catch (e) {}
  return goals;
}
function saveRingGoals(goals) {
  localStorage.setItem(KEY_RING_GOALS, JSON.stringify(goals));
}
/** Called from the goal inputs on the Progress screen. */
function setRingGoal(mode, value) {
  const n = Math.round(Number(value));
  const goals = loadRingGoals();
  goals[mode] = (Number.isFinite(n) && n > 0) ? Math.min(14, n) : DEFAULT_RING_GOAL;
  saveRingGoals(goals);
  applyRingGoalsToUI();
  renderWeekRing();
  showToast('อัปเดตเป้าหมายแล้ว');
}
function applyRingGoalsToUI() {
  const goals = loadRingGoals();
  const cindyInput = document.getElementById('goalCindyInput');
  const customInput = document.getElementById('goalCustomInput');
  if (cindyInput) cindyInput.value = goals.cindy;
  if (customInput) customInput.value = goals.custom;
}

function renderWeekRing() {
  const goals = loadRingGoals();
  const cindyCount = countSessionsInLastNDays(loadSessions().map(s => s.finished), 7);
  const customCount = countSessionsInLastNDays(loadCustomWorkoutSessions().map(s => s.completedAt), 7);
  const cindyCountEl = document.getElementById('weekCindyCount');
  const customCountEl = document.getElementById('weekCustomCount');
  if (cindyCountEl) cindyCountEl.textContent = cindyCount + '/' + goals.cindy;
  if (customCountEl) customCountEl.textContent = customCount + '/' + goals.custom;

  const cindyRing = document.getElementById('weekRingCindy');
  const customRing = document.getElementById('weekRingCustom');
  if (cindyRing) {
    const circ = 2 * Math.PI * 34;
    const pct = Math.min(1, cindyCount / goals.cindy);
    cindyRing.style.strokeDasharray = circ.toFixed(1);
    cindyRing.style.strokeDashoffset = (circ * (1 - pct)).toFixed(1);
  }
  if (customRing) {
    const circ = 2 * Math.PI * 24;
    const pct = Math.min(1, customCount / goals.custom);
    customRing.style.strokeDasharray = circ.toFixed(1);
    customRing.style.strokeDashoffset = (circ * (1 - pct)).toFixed(1);
  }
}

/** Most recent workout across both modes, tagged so it's clear which is which. */
function renderHomeLastWorkout() {
  const wrap = document.getElementById('lastWorkoutWrap');
  if (!wrap) return;
  const cindyLast = loadSessions().slice().sort((a, b) => b.finished - a.finished)[0];
  const customLast = loadCustomWorkoutSessions().slice().sort((a, b) => b.completedAt - a.completedAt)[0];

  let source = null;
  if (cindyLast && customLast) source = cindyLast.finished >= customLast.completedAt ? 'cindy' : 'custom';
  else if (cindyLast) source = 'cindy';
  else if (customLast) source = 'custom';

  if (!source) {
    wrap.innerHTML = '<div class="empty-hint">ยังไม่มีประวัติการเล่น</div>';
    return;
  }

  if (source === 'cindy') {
    wrap.innerHTML = `<div class="history-item" onclick="openDetail('${cindyLast.id}')">
      <div><div class="date">${fmtDate(cindyLast.finished)}<span class="type-tag cindy">CINDY</span></div>
      <div class="reps">${cindyLast.total.reps} REPS</div></div>
      <div class="rounds">${cindyLast.rounds} R</div>
    </div>`;
  } else {
    const meta = customLast.setsCompleted + ' เซ็ต · ' + fmtTime(customLast.totalDurationSec);
    wrap.innerHTML = `<div class="history-item" onclick="openCustomHistoryDetail('${customLast.id}')">
      <div><div class="date">${fmtDate(customLast.completedAt)}<span class="type-tag custom">${escapeHtml((customLast.workoutName || 'CUSTOM').toUpperCase())}</span></div>
      <div class="reps">${meta}</div></div>
      <div class="rounds tabular">${fmtTime(customLast.totalDurationSec)}</div>
    </div>`;
  }
}

/* ================= PROGRAM (mode select: Cindy / Custom) ================= */
function renderProgram() {
  applyActiveProtocolToRuntime();
  applyProtocolToUI();

  const sessions = loadSessions();
  const active = loadActive();
  const mainBtn = document.getElementById('homeMainBtn');
  const secWrap = document.getElementById('homeSecondaryWrap');

  if (active) {
    mainBtn.textContent = 'RESUME WORKOUT';
    mainBtn.classList.remove('btn-primary');
    mainBtn.classList.add('btn-resume');
    secWrap.style.display = 'block';
  } else {
    mainBtn.textContent = 'START WORKOUT';
    mainBtn.classList.add('btn-primary');
    mainBtn.classList.remove('btn-resume');
    secWrap.style.display = 'none';
  }

  const best = sessions.reduce((m, s) => Math.max(m, s.rounds), 0);
  const totalRounds = sessions.reduce((sum, s) => sum + s.rounds, 0);
  document.getElementById('statBest').textContent = best;
  document.getElementById('statSessions').textContent = sessions.length;
  document.getElementById('statTotalRounds').textContent = totalRounds;
  document.getElementById('statStreak').textContent = computeStreak(sessions);

  renderHomeCustomShortcut();
}

/**
 * Shows a shortcut card for the most recently updated Custom Workout so
 * people who train with Custom Workouts more than Cindy don't have to dig
 * into a separate tab every time. Hidden entirely if none exist yet.
 */
function renderHomeCustomShortcut() {
  const homeWrap = document.getElementById('homeCustomWrap');
  const card = document.getElementById('homeCustomCard');
  if (!homeWrap || !card) return;
  const list = loadCustomWorkouts();
  if (!list.length) {
    homeWrap.style.display = 'none';
    return;
  }
  const recent = list.slice().sort((a, b) => b.updatedAt - a.updatedAt)[0];
  const totalSets = recent.exercises.reduce((sum, ex) => sum + (ex.sets || 1), 0);
  const detail = recent.exercises.length + ' ท่า · ' + totalSets + ' เซ็ตรวม';
  card.innerHTML = `<div class="history-item" onclick="startCustomWorkoutPlayer('${recent.id}')">
    <div>
      <div class="date">${escapeHtml(recent.name)}</div>
      <div class="reps">${detail}</div>
    </div>
    <div class="rounds" style="color:var(--success);">${iconHtml('play')}</div>
  </div>`;
  homeWrap.style.display = 'block';
}

/**
 * Fills in the small live-stat line under each of the 3 Program hub cards
 * (Custom Workouts / Cardio / Cindy — in that order, since Custom is the
 * main gameplay loop, Cardio is the optional daily top-up, and Cindy is
 * the special/boss mode played rarely). For a brand-new player who hasn't
 * finished any session of any kind yet, shows a "ลองเล่นเลย (ไม่ต้องตั้งค่า)"
 * quick-sample badge on the Cindy card plus a nudge on the Custom card
 * pointing them toward building their main routine there. Cardio sessions
 * live in the same KEY_CUSTOM_SESSIONS array as Custom Workout sessions
 * (they share the player), so they're told apart here purely by workoutId
 * matching a CARDIO_PRESETS id — nothing new is stored to distinguish them.
 */
function renderProgramHubCards() {
  const cindyEl = document.getElementById('programCindyStat');
  const customEl = document.getElementById('programCustomStat');
  const cardioEl = document.getElementById('programCardioStat');
  const startBadge = document.getElementById('programCindyStartBadge');
  if (!cindyEl || !customEl || !cardioEl) return;

  const cindySessions = loadSessions();
  const allCustomSessions = loadCustomWorkoutSessions();
  const cardioIds = new Set(CARDIO_PRESETS.map(p => p.id));
  const cardioSessions = allCustomSessions.filter(s => cardioIds.has(s.workoutId));
  const customOnlySessions = allCustomSessions.filter(s => !cardioIds.has(s.workoutId));

  if (cindySessions.length === 0) {
    cindyEl.textContent = 'ยังไม่เคยเล่น';
  } else {
    const best = cindySessions.reduce((m, s) => Math.max(m, s.rounds), 0);
    const last = cindySessions.reduce((m, s) => Math.max(m, s.finished), 0);
    cindyEl.textContent = 'Best ' + best + ' รอบ · เล่นล่าสุด ' + fmtDate(last);
  }

  const workoutCount = loadCustomWorkouts().length;
  if (workoutCount === 0) {
    customEl.textContent = 'ยังไม่มีสูตร';
  } else {
    let text = workoutCount + ' สูตร';
    if (customOnlySessions.length > 0) {
      const last = customOnlySessions.reduce((m, s) => Math.max(m, s.completedAt), 0);
      text += ' · เล่นล่าสุด ' + fmtDate(last);
    }
    customEl.textContent = text;
  }

  if (cardioSessions.length === 0) {
    cardioEl.textContent = 'ยังไม่เคยเล่น';
  } else {
    const last = cardioSessions.reduce((m, s) => Math.max(m, s.completedAt), 0);
    cardioEl.textContent = 'เล่นแล้ว ' + cardioSessions.length + ' ครั้ง · ล่าสุด ' + fmtDate(last);
  }

  const runEl = document.getElementById('programRunStat');
  if (runEl) {
    const runSessions = loadRunSessions();
    if (runSessions.length === 0) {
      runEl.textContent = 'ยังไม่เคยวิ่ง';
    } else {
      const totalKm = runSessions.reduce((sum, s) => sum + s.distanceKm, 0);
      const last = runSessions.reduce((m, s) => Math.max(m, s.completedAt), 0);
      runEl.textContent = 'สะสม ' + totalKm.toFixed(1) + ' กม. · ล่าสุด ' + fmtDate(last);
    }
  }

  const tcEl = document.getElementById('programTrainingCampStat');
  if (tcEl) {
    const testedCount = FITNESS_TESTS.filter(t => fitnessTestInfo(t.key)).length;
    tcEl.textContent = testedCount === 0
      ? 'ยังไม่เคยทดสอบ'
      : 'ทดสอบแล้ว ' + testedCount + '/' + FITNESS_TESTS.length + ' รายการ';
  }

  const customNudge = document.getElementById('programCustomNudge');
  const brandNew = cindySessions.length === 0 && allCustomSessions.length === 0;
  if (startBadge) {
    startBadge.style.display = brandNew ? 'inline-block' : 'none';
  }
  if (customNudge) {
    customNudge.style.display = brandNew ? 'block' : 'none';
  }

  const cindyTodayBadge = document.getElementById('programCindyTodayBadge');
  const customTodayBadge = document.getElementById('programCustomTodayBadge');
  const cardioTodayBadge = document.getElementById('programCardioTodayBadge');
  [cindyTodayBadge, customTodayBadge, cardioTodayBadge].forEach(b => { if (b) b.style.display = 'none'; });
  const todayEntry = loadWeeklyPlan()[new Date().getDay()];
  if (todayEntry) {
    const badge = todayEntry.type === 'cindy' ? cindyTodayBadge
      : todayEntry.type === 'cardio' ? cardioTodayBadge
      : todayEntry.type === 'custom' ? customTodayBadge
      : null;
    if (badge) badge.style.display = 'inline-block';
  }
}

function computeStreak(sessions) {
  if (sessions.length === 0) return 0;
  const days = new Set(sessions.map(s => dayKey(s.finished)));
  let streak = 0;
  let cursor = new Date();
  // if no session today, streak can still count from yesterday backward,
  // but per spec: if today has no workout, streak stops (evaluated as of today)
  if (!days.has(dayKey(cursor.getTime()))) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(dayKey(cursor.getTime()))) return 0;
  }
  while (days.has(dayKey(cursor.getTime()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

/* ================= MOTIVATION MODAL (before starting a new Cindy workout) ================= */
const MOTIVATION_MESSAGES = [
  'ทุกก้าวที่ทำวันนี้ คือร่างกายที่ดีกว่าของพรุ่งนี้',
  'ไม่ต้องสมบูรณ์แบบ แค่ลงมือทำให้ครบก็พอ',
  'คุณแข็งแกร่งกว่าที่คิดไว้เสมอ ลุยเลย!',
  'พักได้ แต่อย่าหยุด — เดี๋ยวก็ถึงเป้าหมาย',
  'สิ่งเดียวที่แย่กว่าเหนื่อย คือความรู้สึกไม่ได้ลงมือทำ'
];
function openMotivationModal() {
  const msg = MOTIVATION_MESSAGES[Math.floor(Math.random() * MOTIVATION_MESSAGES.length)];
  document.getElementById('motivationMessage').textContent = msg;
  document.getElementById('motivationModal').classList.add('active');
}
function confirmStartWorkoutFromModal() {
  closeModal('motivationModal');
  startNewWorkout();
}

function handleHomeMainBtn() {
  unlockAudio();
  const active = loadActive();
  if (active) {
    enterWorkoutScreen();
  } else {
    openMotivationModal();
  }
}

function confirmDiscardAndStartNew() {
  clearActive();
  openMotivationModal();
}

/* ================= WORKOUT ================= */
function startNewWorkout() {
  applyActiveProtocolToRuntime();
  const now = Date.now();
  const active = {
    id: 'w_' + now,
    protocolId: ACTIVE_PROTOCOL.id,
    protocolName: ACTIVE_PROTOCOL.name,
    mode: MODE,
    startTime: now,
    endTime: now + DURATION_MS,
    isPaused: false,
    pausedRemainingMs: null,
    roundsSaved: 0,
    roundLog: [], // {number, pull, push, squat, time} time = elapsed seconds since start
    skipLog: [],  // {time} rounds skipped — never counted toward roundsSaved
    combo: 0,
    maxCombo: 0,
    emomIntervalMs: MODE === 'emom' ? EMOM_INTERVAL_MS : null,
    emomRounds: MODE === 'emom' ? EMOM_ROUNDS : null,
    emomLastLoggedInterval: -1
  };
  saveActive(active);
  enterWorkoutScreen();
}

function enterWorkoutScreen() {
  go('workout');
  currentPB = loadSessions().reduce((m, s) => Math.max(m, s.rounds), 0);
  lastRenderedCombo = null;
  acquireWakeLock();
  refreshWorkoutUI();
  startTickLoop();
}

function getElapsedMs(active) {
  if (active.isPaused) {
    return DURATION_MS - active.pausedRemainingMs;
  }
  return Math.min(DURATION_MS, Date.now() - active.startTime);
}

function refreshWorkoutUI() {
  const active = loadActive();
  if (!active) { go('home'); return; }
  document.getElementById('screen-workout').classList.toggle('mode-emom', active.mode === 'emom');

  let remainingMs;
  if (active.isPaused) {
    remainingMs = active.pausedRemainingMs;
  } else {
    remainingMs = active.endTime - Date.now();
  }
  if (remainingMs <= 0) {
    stopTickLoop();
    completeWorkout(active, 'timeout');
    return;
  }

  if (active.mode === 'emom') {
    refreshEmomUI(active, remainingMs);
    return;
  }
  refreshAmrapUI(active, remainingMs);
}

function refreshAmrapUI(active, remainingMs) {
  const remainingSec = remainingMs / 1000;
  document.getElementById('timerDigits').textContent = fmtTime(remainingSec);
  updateComboBadge(active);

  if (!active.isPaused) {
    if (countdownState.id !== active.id) countdownState = { id: active.id, done: new Set() };
    const remainingWhole = Math.ceil(remainingMs / 1000);
    const countdownMarks = [10, 9, 8, 7, 6, 5, 4, 3, 2, 1];
    if (countdownMarks.includes(remainingWhole) && !countdownState.done.has(remainingWhole)) {
      countdownState.done.add(remainingWhole);
      if (remainingWhole <= 3) { vibrate(30); beep(880, 90, 0.15); }
      else { vibrate(15); beep(600, 60, 0.08); }
    }

    if (milestoneState.id !== active.id) milestoneState = { id: active.id, done: new Set() };
    const milestoneMarks = [15 * 60, 10 * 60, 5 * 60]; // remaining seconds at 5-min checkpoints
    milestoneMarks.forEach(mark => {
      if (remainingWhole === mark && !milestoneState.done.has(mark)) {
        milestoneState.done.add(mark);
        vibrate([50, 40, 50]);
        beep(520, 150, 0.13);
      }
    });
  }
  const frac = Math.max(0, Math.min(1, remainingMs / DURATION_MS));
  const ring = document.getElementById('ringProgress');
  const offset = RING_CIRC * (1 - frac);
  ring.setAttribute('stroke-dasharray', RING_CIRC + ' ' + RING_CIRC);
  ring.setAttribute('stroke-dashoffset', offset);

  if (remainingSec <= 30) ring.style.stroke = 'var(--danger)';
  else if (remainingSec <= 120) ring.style.stroke = 'var(--warning)';
  else ring.style.stroke = 'var(--web)';

  document.getElementById('roundsBig').textContent = active.roundsSaved;
  const pbHint = document.getElementById('pbHint');
  pbHint.textContent = currentPB > 0 ? 'PB ' + currentPB + ' ROUNDS' : 'PB —';
  document.getElementById('saveRoundBtn').innerHTML = iconHtml('check') + ' บันทึกรอบที่ ' + (active.roundsSaved + 1);

  const statusPill = document.getElementById('statusPill');
  const pauseBtn = document.getElementById('pauseBtn');
  if (active.isPaused) {
    statusPill.textContent = 'PAUSED';
    statusPill.classList.add('paused');
    pauseBtn.textContent = 'RESUME';
  } else {
    statusPill.textContent = 'กำลังเล่น';
    statusPill.classList.remove('paused');
    pauseBtn.textContent = 'PAUSE';
  }
}

function refreshEmomUI(active, remainingMs) {
  const totalElapsedMs = DURATION_MS - remainingMs;
  const intervalMs = active.emomIntervalMs;
  const totalRounds = active.emomRounds;
  const currentIntervalIdx = Math.min(totalRounds - 1, Math.floor(totalElapsedMs / intervalMs));
  const msIntoInterval = totalElapsedMs - currentIntervalIdx * intervalMs;
  const msLeftInInterval = Math.max(0, intervalMs - msIntoInterval);

  // auto-log every interval that has fully elapsed since we last checked
  if (!active.isPaused) {
    while (active.emomLastLoggedInterval < currentIntervalIdx - 1) {
      active.emomLastLoggedInterval++;
      logEmomInterval(active, active.emomLastLoggedInterval);
    }
    saveActive(active);
  }

  document.getElementById('timerDigits').textContent = fmtTime(msLeftInInterval / 1000);
  document.getElementById('roundsBig').textContent = active.roundsSaved;
  document.getElementById('pbHint').textContent = 'รอบที่ ' + (currentIntervalIdx + 1) + ' / ' + totalRounds;
  document.getElementById('saveRoundBtn').textContent = active.isPaused ? 'PAUSED' : 'รอบถัดไปใน ' + fmtTime(msLeftInInterval / 1000);
  updateComboBadge(active);

  const secLeft = Math.ceil(msLeftInInterval / 1000);
  if (!active.isPaused) {
    const cdKey = active.id + '_i' + currentIntervalIdx;
    if (countdownState.id !== cdKey) countdownState = { id: cdKey, done: new Set() };
    if ([3, 2, 1].includes(secLeft) && !countdownState.done.has(secLeft)) {
      countdownState.done.add(secLeft);
      vibrate(30); beep(880, 90, 0.15);
    }
  }

  const frac = Math.max(0, Math.min(1, msLeftInInterval / intervalMs));
  const ring = document.getElementById('ringProgress');
  const offset = RING_CIRC * (1 - frac);
  ring.setAttribute('stroke-dasharray', RING_CIRC + ' ' + RING_CIRC);
  ring.setAttribute('stroke-dashoffset', offset);
  ring.style.stroke = secLeft <= 5 ? 'var(--danger)' : 'var(--web)';

  const statusPill = document.getElementById('statusPill');
  const pauseBtn = document.getElementById('pauseBtn');
  if (active.isPaused) {
    statusPill.textContent = 'PAUSED';
    statusPill.classList.add('paused');
    pauseBtn.textContent = 'RESUME';
  } else {
    statusPill.textContent = 'EMOM · กำลังเล่น';
    statusPill.classList.remove('paused');
    pauseBtn.textContent = 'PAUSE';
  }
}

function logEmomInterval(active, idx) {
  active.roundsSaved += 1;
  active.roundLog.push({
    number: active.roundsSaved,
    pull: REPS.pull, push: REPS.push, squat: REPS.squat,
    time: Math.round((idx + 1) * (active.emomIntervalMs / 1000))
  });
  active.combo = (active.combo || 0) + 1;
  active.maxCombo = Math.max(active.maxCombo || 0, active.combo);
  vibrate([40, 30, 40]);
  beep(700, 100, 0.15);
}

function startTickLoop() {
  stopTickLoop();
  tickHandle = setInterval(refreshWorkoutUI, 250);
}
function stopTickLoop() {
  if (tickHandle) { clearInterval(tickHandle); tickHandle = null; }
}

function saveRound() {
  const active = loadActive();
  if (!active) return;
  if (active.mode === 'emom') return; // EMOM logs rounds automatically each interval
  const elapsedSec = getElapsedMs(active) / 1000;
  active.roundsSaved += 1;
  active.roundLog.push({
    number: active.roundsSaved,
    pull: REPS.pull, push: REPS.push, squat: REPS.squat,
    time: Math.round(elapsedSec)
  });
  active.combo = (active.combo || 0) + 1;
  active.maxCombo = Math.max(active.maxCombo || 0, active.combo);
  saveActive(active);

  // a new best mid-workout is a bigger moment than an ordinary round —
  // gated on currentPB > 0 so a player's very first-ever session (no
  // prior record to beat) just gets the normal Perfect Round flash below
  const brokeLivePB = currentPB > 0 && active.roundsSaved > currentPB;
  if (brokeLivePB) currentPB = active.roundsSaved;

  vibrate(brokeLivePB ? [40, 30, 40, 30, 90] : 40);
  if (brokeLivePB) {
    beep(784, 90, 0.16);
    setTimeout(() => beep(1046, 140, 0.18), 90);
  } else {
    beep(880, 90, 0.15);
  }
  bumpSaveRoundBtn();
  bumpRoundsCounter(brokeLivePB);
  flashPerfectRound(brokeLivePB);
  showToast(brokeLivePB ? ('NEW PB! ทำลายสถิติเดิม — ' + active.roundsSaved + ' รอบแล้ว') : ('บันทึกรอบที่ ' + active.roundsSaved + ' แล้ว'));
  refreshWorkoutUI();
}

/* quick squash-and-spring on the save button itself, so every tap reads
 * as registered the instant it's pressed, independent of the flash/toast
 * above it which take a beat longer to appear */
function bumpSaveRoundBtn() {
  const btn = document.getElementById('saveRoundBtn');
  if (!btn) return;
  btn.classList.remove('tap-bump');
  void btn.offsetWidth;
  btn.classList.add('tap-bump');
}

/* rounds counter pops on every save, bigger + gold when it's a live PB */
function bumpRoundsCounter(isPb) {
  const el = document.getElementById('roundsBig');
  if (!el) return;
  el.classList.remove('bump', 'pb');
  void el.offsetWidth;
  el.classList.add('bump');
  if (isPb) el.classList.add('pb');
}

/* ---- Perfect Round flourish ----
 * Every saveRound() call already means Pull + Push + Squat were all done
 * with no skip for that round (skipRound() is the only other path, and it
 * doesn't log a round at all) — so there's no new "was it perfect" check
 * to add, just a quick moment to mark it. Kept as a short flash rather
 * than a loud interrupt so it doesn't get old by round 10.
 *
 * isPb swaps this into the bigger "NEW PB" gold variant (see .perfect-flash.pb
 * in CSS) and glows the timer ring gold in sync, for the round that
 * actually beats the player's prior best. */
function flashPerfectRound(isPb) {
  const el = document.getElementById('perfectFlash');
  if (!el) return;
  el.classList.toggle('pb', !!isPb);
  el.innerHTML = isPb
    ? (iconHtml('bolt') + '<span>NEW PB!</span>')
    : (iconHtml('check') + '<span>PERFECT ROUND</span>');
  el.classList.remove('flash');
  void el.offsetWidth;
  el.classList.add('flash');

  const ringWrap = document.querySelector('#screen-workout .timer-wrap');
  if (isPb && ringWrap) {
    ringWrap.classList.remove('pb-glow');
    void ringWrap.offsetWidth;
    ringWrap.classList.add('pb-glow');
  }
}

function skipRound() {
  const active = loadActive();
  if (!active) return;
  if (active.mode === 'emom') return; // not applicable in EMOM — rounds auto-log on the clock
  const elapsedSec = getElapsedMs(active) / 1000;
  if (!active.skipLog) active.skipLog = [];
  active.skipLog.push({ time: Math.round(elapsedSec) });
  active.combo = 0;
  saveActive(active);
  vibrate(20);
  beep(300, 80, 0.08);
  const skipBtn = document.getElementById('skipRoundBtn');
  if (skipBtn) {
    skipBtn.classList.remove('skip-bump');
    void skipBtn.offsetWidth;
    skipBtn.classList.add('skip-bump');
  }
  showToast('ข้ามรอบนี้แล้ว (ไม่นับเป็น Round)');
  refreshWorkoutUI();
}

function togglePause() {
  const active = loadActive();
  if (!active) return;
  if (active.isPaused) {
    active.startTime = Date.now() - (DURATION_MS - active.pausedRemainingMs);
    active.endTime = Date.now() + active.pausedRemainingMs;
    active.isPaused = false;
    active.pausedRemainingMs = null;
  } else {
    active.pausedRemainingMs = Math.max(0, active.endTime - Date.now());
    active.isPaused = true;
  }
  saveActive(active);
  refreshWorkoutUI();
}

function openEndModal() { document.getElementById('endModal').classList.add('active'); }
function openFinishModal() { document.getElementById('finishModal').classList.add('active'); }
function closeModal(id) { document.getElementById(id).classList.remove('active'); }

/** Settings modal reached via the gear icon on Progress — holds reminder,
 * backup, refresh, and reset controls that used to sit inline on Progress.
 * Just needs the reminder inputs freshly synced on open since applyReminderToUI()
 * is normally only called when navigating to Progress (go('progress')), and this
 * modal can now be reopened without a fresh Progress nav in between. */
function openAppSettingsModal() {
  applyReminderToUI();
  document.getElementById('appSettingsModal').classList.add('active');
}

function confirmEndWorkout() {
  closeModal('endModal');
  stopTickLoop();
  releaseWakeLock();
  clearActive();
  go('home');
}

function confirmFinishNow() {
  closeModal('finishModal');
  const active = loadActive();
  if (!active) return;
  stopTickLoop();
  completeWorkout(active, 'manual');
}

/* ================= COMPLETE =================
 * completed === false marks a session that stopped early via FINISH NOW
 * before the clock ran out (or, for EMOM, before its rounds — though EMOM
 * is already time-locked per interval so this mainly matters for AMRAP).
 * Such sessions are still saved to history for the player's own reference,
 * but earn no isPR flag and no combo bonus XP, and computeSessionXP() /
 * todayQuestContext() below both exclude them from reps/rounds entirely.
 *
 * Why: a custom Protocol's pull/push/squat-per-round values are plain
 * numbers the player sets themselves with no upper bound, so completing
 * just 1 round of an inflated protocol and hitting FINISH NOW used to bank
 * a huge "reps" total in a few seconds — bigger reps-per-round previously
 * meant more free XP, not more effort. Requiring the full clock closes
 * that off: the reward now scales with time actually spent, same as the
 * real Cindy WOD is meant to work (race the clock for max rounds). */
function completeWorkout(active, reason) {
  releaseWakeLock();
  if (active.mode === 'emom' && active.emomLastLoggedInterval < active.emomRounds - 1) {
    while (active.emomLastLoggedInterval < active.emomRounds - 1) {
      active.emomLastLoggedInterval++;
      logEmomInterval(active, active.emomLastLoggedInterval);
    }
  }
  vibrate([100, 60, 100]);
  beep(440, 240, 0.18);
  const elapsedMs = reason === 'timeout' ? DURATION_MS : getElapsedMs(active);
  const rounds = active.roundsSaved;
  const totalPull = rounds * REPS.pull;
  const totalPush = rounds * REPS.push;
  const totalSquat = rounds * REPS.squat;
  const totalReps = totalPull + totalPush + totalSquat;

  const completed = reason === 'timeout' || elapsedMs >= DURATION_MS;

  const sessions = loadSessions();
  const prevBest = sessions.filter(s => s.completed !== false).reduce((m, s) => Math.max(m, s.rounds), 0);
  const isNewPR = completed && rounds > prevBest && rounds > 0;

  const maxCombo = active.maxCombo || 0;
  const comboBonusXp = completed ? comboBonusForMaxCombo(maxCombo) : 0;
  if (comboBonusXp > 0) addComboBonusXP(comboBonusXp);

  const session = {
    id: active.id,
    started: active.startTime,
    finished: Date.now(),
    duration: Math.round(elapsedMs / 1000),
    rounds,
    rounds_log: active.roundLog,
    skip_log: active.skipLog || [],
    total: { pull: totalPull, push: totalPush, squat: totalSquat, reps: totalReps },
    isPR: isNewPR,
    completed,
    protocolName: active.protocolName || 'Cindy (Classic)',
    mode: active.mode || 'amrap',
    maxCombo,
    comboBonusXp,
    rpe: null,
    feeling: null,
    note: ''
  };

  sessions.push(session);
  saveSessions(sessions);
  clearActive();
  lastCompletedSessionId = session.id;

  if (isNativeApp()) rescheduleNativeReminder(true); // done today — push reminder to tomorrow

  go('bossbattle');
  startBossBattleCutscene(session, false, () => {
    renderCompleteScreen(session);
    go('complete');
    playMissionCompleteEntrance(session);
    // Give the victory entrance a beat to land before any LEVEL UP
    // celebration pops in on top of it — same screen, next beat, instead
    // of waiting until the player navigates back to Home.
    setTimeout(renderXpBar, 900);
  });
}

/* ---- tween helper for Mission Complete number count-ups ---- */
function tweenNumber(el, to, opts) {
  if (!el) return;
  opts = opts || {};
  const duration = opts.duration || 700;
  const start = performance.now();
  function step(now) {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(to * eased) + (opts.suffix || '');
    if (t < 1) requestAnimationFrame(step);
    else el.textContent = to + (opts.suffix || '');
  }
  requestAnimationFrame(step);
}

/* ---- "Mission Complete" victory entrance ----
 * Plays the flash / eyebrow banner / star pop / stagger-reveal / number
 * count-ups on screen-complete. Called once the screen is actually
 * visible (see completeWorkout()) so the sequence is never running behind
 * a still-active boss-battle cutscene. */
function playMissionCompleteEntrance(session) {
  const wrap = document.querySelector('#screen-complete .complete-wrap');
  if (!wrap) return;
  const flash = document.getElementById('completeFlash');
  const eyebrow = document.getElementById('missionEyebrow');
  const star = wrap.querySelector('.complete-star');
  const xpEl = document.getElementById('completeXpEarned');
  [flash, eyebrow, star, xpEl].forEach(el => { if (el) { el.classList.remove('play'); void el.offsetWidth; } });
  wrap.classList.remove('mission-reveal');
  void wrap.offsetWidth;
  wrap.classList.add('mission-reveal');
  if (flash) flash.classList.add('play');
  if (eyebrow) eyebrow.classList.add('play');
  if (star) star.classList.add('play');

  tweenNumber(document.getElementById('completeRounds'), session.rounds, { duration: 650 });
  tweenNumber(document.getElementById('cTotalReps'), session.total.reps, { duration: 600 });
  tweenNumber(document.getElementById('bdPull'), session.total.pull, { duration: 550 });
  tweenNumber(document.getElementById('bdPush'), session.total.push, { duration: 550 });
  tweenNumber(document.getElementById('bdSquat'), session.total.squat, { duration: 550 });

  if (xpEl) {
    const totalXp = (session.completed ? session.total.reps : 0) + (session.comboBonusXp || 0);
    if (totalXp > 0) {
      xpEl.textContent = '+' + totalXp + ' XP';
      xpEl.classList.add('play');
    } else {
      xpEl.textContent = '';
    }
  }
}

function renderCompleteScreen(session) {
  // Rounds/reps/breakdown are set to 0 here and animated up to their real
  // values by playMissionCompleteEntrance() (called once this screen is
  // actually visible) — avoids a one-frame flash of the final number
  // before the count-up tween takes over.
  document.getElementById('completeRounds').textContent = '0';
  document.getElementById('cTotalReps').textContent = '0';
  const avgRoundSec = session.rounds > 0 ? session.duration / session.rounds : 0;
  document.getElementById('cAvgRound').textContent = fmtTime(avgRoundSec);
  document.getElementById('bdPull').textContent = '0';
  document.getElementById('bdPush').textContent = '0';
  document.getElementById('bdSquat').textContent = '0';

  const comboCard = document.getElementById('comboResultCard');
  if (comboCard) {
    if (session.comboBonusXp > 0) {
      document.getElementById('comboResultMax').textContent = 'x' + session.maxCombo;
      document.getElementById('comboResultXp').textContent = '+' + session.comboBonusXp + ' XP BONUS';
      comboCard.style.display = '';
    } else {
      comboCard.style.display = 'none';
    }
  }

  const prBadge = document.getElementById('prBadge');
  const completeHero = prBadge.closest('.complete-hero');
  completeHero.classList.remove('pr-burst');
  if (session.isPR) {
    prBadge.textContent = 'NEW PR';
    prBadge.className = 'pr-badge new';
    void completeHero.offsetWidth; // restart animation even if triggered back-to-back
    completeHero.classList.add('pr-burst');
    vibrate([40, 30, 40, 30, 80]);
  } else {
    prBadge.textContent = 'PR —';
    prBadge.className = 'pr-badge no';
  }

  pendingFeedback = { rpe: null, feeling: null };
  document.getElementById('noteInput').value = '';
  const rpeRow = document.getElementById('rpeRow');
  rpeRow.innerHTML = '';
  for (let i = 1; i <= 10; i++) {
    const el = document.createElement('div');
    el.className = 'rpe-pill';
    el.textContent = i;
    el.onclick = () => selectRPE(i, el);
    rpeRow.appendChild(el);
  }
  document.querySelectorAll('.feeling-pill').forEach(p => p.classList.remove('sel'));
}

function selectRPE(val, el) {
  pendingFeedback.rpe = val;
  document.querySelectorAll('.rpe-pill').forEach(p => p.classList.remove('sel'));
  el.classList.add('sel');
}
function selectFeeling(val) {
  pendingFeedback.feeling = val;
  document.querySelectorAll('.feeling-pill').forEach(p => p.classList.toggle('sel', p.dataset.f === val));
}

function finishCompleteFlow() {
  const sessions = loadSessions();
  const idx = sessions.findIndex(s => s.id === lastCompletedSessionId);
  if (idx !== -1) {
    sessions[idx].rpe = pendingFeedback.rpe;
    sessions[idx].feeling = pendingFeedback.feeling;
    sessions[idx].note = document.getElementById('noteInput').value.trim();
    saveSessions(sessions);
  }
  go('home');
}

/* ================= HISTORY (unified: Cindy + Custom Workouts) ================= */
/**
 * The HISTORY tab shows one combined, date-sorted list mixing Cindy sessions
 * (loadSessions()) and Custom Workout sessions (loadCustomWorkoutSessions()).
 * Each row carries a small tag (CINDY, or the custom workout's own name) so
 * the two never get confused, and taps route to each mode's own detail
 * screen — the underlying detail screens/data stay fully separate.
 */
function renderHistory() {
  const cindyItems = loadSessions().map(s => ({ kind: 'cindy', ts: s.finished, data: s }));
  const customItems = loadCustomWorkoutSessions().map(s => ({ kind: 'custom', ts: s.completedAt, data: s }));
  const runItems = loadRunSessions().map(s => ({ kind: 'run', ts: s.completedAt, data: s }));
  const merged = cindyItems.concat(customItems).concat(runItems).sort((a, b) => b.ts - a.ts);

  const wrap = document.getElementById('historyList');
  if (merged.length === 0) {
    wrap.innerHTML = '<div class="empty-hint">ยังไม่มีประวัติการเล่น</div>';
    return;
  }

  wrap.innerHTML = merged.map(item => {
    if (item.kind === 'cindy') {
      const s = item.data;
      return `<div class="history-item" onclick="openDetail('${s.id}')">
        <div>
          <div class="date">${fmtDate(s.finished)}<span class="type-tag cindy">CINDY</span>${s.mode === 'emom' ? ' <span class="proto-active-tag">EMOM</span>' : ''}${s.completed === false ? ' <span class="proto-active-tag incomplete">ยังไม่จบ</span>' : ''}</div>
          <div class="reps">${s.total.reps} REPS · ${escapeHtml(s.protocolName || 'Cindy')}</div>
        </div>
        <div class="rounds">${s.rounds} R</div>
      </div>`;
    }
    if (item.kind === 'run') {
      const s = item.data;
      return `<div class="history-item" onclick="openRunDetail('${s.id}')">
        <div>
          <div class="date">${fmtDate(s.completedAt)}<span class="type-tag run">วิ่ง</span></div>
          <div class="reps">${s.distanceKm.toFixed(2)} กม. · เพซ ${fmtPace(s.paceSecPerKm)}/กม.</div>
        </div>
        <div class="rounds tabular">${fmtTime(s.movingSec)}</div>
      </div>`;
    }
    const s = item.data;
    const meta = s.setsCompleted + ' เซ็ต · ' + fmtTime(s.totalDurationSec);
    return `<div class="history-item" onclick="openCustomHistoryDetail('${s.id}')">
      <div>
        <div class="date">${fmtDate(s.completedAt)}<span class="type-tag custom">${escapeHtml((s.workoutName || 'CUSTOM').toUpperCase())}</span>${s.isPR ? ' <span class="proto-active-tag">PR</span>' : ''}</div>
        <div class="reps">${meta}</div>
      </div>
      <div class="rounds tabular">${fmtTime(s.totalDurationSec)}</div>
    </div>`;
  }).join('');
}

/* ================= DETAIL ================= */
function openDetail(id) {
  const sessions = loadSessions();
  const s = sessions.find(x => x.id === id);
  if (!s) return;
  currentDetailId = id;
  const wrap = document.getElementById('detailWrap');
  const avgRoundSec = s.rounds > 0 ? s.duration / s.rounds : 0;

  const saveLog = s.rounds_log || [];
  let fastestIdx = -1, slowestIdx = -1;
  if (saveLog.length >= 2) {
    const durations = saveLog.map((r, i) => r.time - (i > 0 ? saveLog[i - 1].time : 0));
    let minD = Infinity, maxD = -Infinity;
    durations.forEach((d, i) => {
      if (d < minD) { minD = d; fastestIdx = i; }
      if (d > maxD) { maxD = d; slowestIdx = i; }
    });
    if (fastestIdx === slowestIdx) { fastestIdx = -1; slowestIdx = -1; } // all equal, nothing to highlight
  }

  let entries = saveLog.map((r, i) => Object.assign({ type: 'save', idx: i }, r));
  (s.skip_log || []).forEach(sk => entries.push({ type: 'skip', time: sk.time }));
  entries.sort((a, b) => a.time - b.time);

  let roundsRows = entries.map(r => {
    if (r.type === 'skip') {
      return `<tr class="skip-row">
        <td colspan="4" style="text-align:left;color:var(--text-faint);font-style:italic;">SKIPPED</td>
        <td>${fmtTime(r.time)}</td>
      </tr>`;
    }
    let tag = '';
    if (r.idx === fastestIdx) tag = ' <span style="color:var(--success);font-size:10px;">FASTEST</span>';
    if (r.idx === slowestIdx) tag = ' <span style="color:var(--warning);font-size:10px;">SLOWEST</span>';
    return `<tr>
      <td>${r.number}${tag}</td><td>${r.pull}</td><td>${r.push}</td><td>${r.squat}</td><td>${fmtTime(r.time)}</td>
    </tr>`;
  }).join('');
  if (!roundsRows) roundsRows = '<tr><td colspan="5" style="color:var(--text-faint);">ไม่มีข้อมูลรอบ</td></tr>';

  wrap.innerHTML = `
    <div class="complete-hero" style="padding-top:4px;">
      <div class="complete-rounds tabular">${s.rounds}</div>
      <div class="complete-lbl">ROUNDS · ${fmtDate(s.finished)}</div>
      <div style="font-size:11px;color:var(--text-faint);margin-top:4px;letter-spacing:1px;">${escapeHtml(s.protocolName || 'Cindy')}${s.mode === 'emom' ? ' · EMOM' : ''}</div>
      ${s.isPR ? '<div class="pr-badge new">NEW PR</div>' : ''}
    </div>
    <div class="metric-grid">
      <div class="metric-card"><div class="v">${s.total.reps}</div><div class="l">TOTAL REPS</div></div>
      <div class="metric-card"><div class="v tabular">${fmtTime(avgRoundSec)}</div><div class="l">AVERAGE ROUND</div></div>
      <div class="metric-card"><div class="v">${s.rpe ? s.rpe + '/10' : '—'}</div><div class="l">RPE</div></div>
      <div class="metric-card"><div class="v">${s.feeling || '—'}</div><div class="l">FEELING</div></div>
    </div>

    <div class="section-label">EXERCISE BREAKDOWN</div>
    <div class="metric-card">
      <div class="breakdown-row"><span class="breakdown-name"><span class="dot" style="background:var(--pull)"></span>PULL-UP</span><span class="breakdown-val">${s.total.pull}</span></div>
      <div class="breakdown-row"><span class="breakdown-name"><span class="dot" style="background:var(--push)"></span>PUSH-UP</span><span class="breakdown-val">${s.total.push}</span></div>
      <div class="breakdown-row"><span class="breakdown-name"><span class="dot" style="background:var(--squat)"></span>SQUAT</span><span class="breakdown-val">${s.total.squat}</span></div>
    </div>

    <div class="section-label">ROUND BREAKDOWN</div>
    <div class="metric-card">
      <table class="detail-table">
        <thead><tr><th>ROUND</th><th>PULL</th><th>PUSH</th><th>SQUAT</th><th>TIME</th></tr></thead>
        <tbody>${roundsRows}</tbody>
      </table>
    </div>

    ${s.note ? `<div class="section-label">NOTE</div><div class="metric-card" style="font-size:13px;color:var(--text-dim);line-height:1.5;">${escapeHtml(s.note)}</div>` : ''}
  `;
  go('detail');
}

/* ================= EDIT / DELETE SESSION ================= */
let pendingEditFeedback = { rpe: null, feeling: null };
function openEditSessionModal(id) {
  requirePin('ใส่ PIN เพื่อแก้ไขประวัติ Workout นี้', () => openEditSessionModalImpl(id));
}
function openEditSessionModalImpl(id) {
  const s = loadSessions().find(x => x.id === id);
  if (!s) return;
  currentDetailId = id;
  pendingEditFeedback = { rpe: s.rpe || null, feeling: s.feeling || null };
  document.getElementById('editNoteInput').value = s.note || '';
  const rpeRow = document.getElementById('editRpeRow');
  rpeRow.innerHTML = '';
  for (let i = 1; i <= 10; i++) {
    const el = document.createElement('div');
    el.className = 'rpe-pill' + (s.rpe === i ? ' sel' : '');
    el.textContent = i;
    el.onclick = () => { pendingEditFeedback.rpe = i; rpeRow.querySelectorAll('.rpe-pill').forEach(p => p.classList.remove('sel')); el.classList.add('sel'); };
    rpeRow.appendChild(el);
  }
  document.querySelectorAll('#editFeelingRow .feeling-pill').forEach(p => p.classList.toggle('sel', p.dataset.f === s.feeling));
  document.getElementById('editSessionModal').classList.add('active');
}
function selectEditFeeling(val) {
  pendingEditFeedback.feeling = val;
  document.querySelectorAll('#editFeelingRow .feeling-pill').forEach(p => p.classList.toggle('sel', p.dataset.f === val));
}
function saveEditSession() {
  const sessions = loadSessions();
  const idx = sessions.findIndex(s => s.id === currentDetailId);
  if (idx === -1) return;
  sessions[idx].rpe = pendingEditFeedback.rpe;
  sessions[idx].feeling = pendingEditFeedback.feeling;
  sessions[idx].note = document.getElementById('editNoteInput').value.trim();
  saveSessions(sessions);
  closeModal('editSessionModal');
  openDetail(currentDetailId);
  showToast('บันทึกการแก้ไขแล้ว');
}
function confirmDeleteSession() {
  requirePin('ใส่ PIN เพื่อลบประวัติ Workout นี้', () => {
    document.getElementById('deleteSessionModal').classList.add('active');
  });
}
function deleteSessionExecute() {
  const sessions = loadSessions().filter(s => s.id !== currentDetailId);
  saveSessions(sessions);
  closeModal('deleteSessionModal');
  currentDetailId = null;
  showToast('ลบ Workout นี้แล้ว');
  go('history');
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/* ================= PROGRESS ================= */
function setPeriod(p) {
  currentPeriod = p;
  document.querySelectorAll('.period-pill').forEach(el => el.classList.toggle('sel', el.dataset.p === p));
  renderProgress();
}

function setMetric(m) {
  currentMetric = m;
  document.querySelectorAll('.period-pill[data-m]').forEach(el => el.classList.toggle('sel', el.dataset.m === m));
  renderProgress();
}

function renderProgress() {
  const all = loadSessions();
  const customAll = loadCustomWorkoutSessions();
  const best = all.reduce((m, s) => Math.max(m, s.rounds), 0);
  const avg = all.length ? (all.reduce((sum, s) => sum + s.rounds, 0) / all.length) : 0;
  // combined across Cindy + Custom Workout — matches how HISTORY, the Home
  // mascot streak, and the weekly Boss Fight already treat "activity"
  const combinedTotalXP = all.reduce((sum, s) => sum + (s.total ? s.total.reps : 0), 0)
    + customAll.reduce((sum, s) => sum + totalVolumeOfCustomSession(s), 0);
  const combinedSessions = all.length + customAll.length;

  document.getElementById('pBest').textContent = best + ' R';
  document.getElementById('pAvg').textContent = avg.toFixed(1) + ' R';
  document.getElementById('pSessions').textContent = combinedSessions;
  document.getElementById('pTotalReps').textContent = combinedTotalXP.toLocaleString();
  document.getElementById('progStreak').textContent = computeCombinedStreak() + ' DAYS';
  renderPlanStreak('progPlanStreak');
  renderStatBars();
  renderProgressRecords();
  renderBodyGrowth();

  if (currentMetric === 'xp') {
    renderCombinedXpChart();
    return;
  }

  let filtered = all;
  if (currentPeriod !== 'all') {
    const days = parseInt(currentPeriod, 10);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    filtered = all.filter(s => s.finished >= cutoff);
  }

  const chart = document.getElementById('chartBars');
  chart.innerHTML = '';
  if (filtered.length === 0) {
    chart.innerHTML = '<div class="empty-hint" style="width:100%;">ยังไม่มีข้อมูลในช่วงนี้</div>';
    return;
  }
  const valueOf = (s) => currentMetric === 'rounds' ? s.rounds : (s.total[currentMetric] || 0);
  const maxVal = Math.max(1, ...filtered.map(valueOf));
  const shown = filtered.slice(-14);
  shown.forEach(s => {
    const col = document.createElement('div');
    col.className = 'chart-col';
    const val = valueOf(s);
    const barH = Math.max(4, (val / maxVal) * 118);
    const d = new Date(s.finished);
    col.innerHTML = `<div class="chart-bar${s.isPR ? ' pb' : ''}" style="height:${barH}px;" title="${val}"></div>
      <div class="chart-xlabel">${d.getDate()}/${d.getMonth()+1}</div>`;
    chart.appendChild(col);
  });
}

/* "XP (ALL)" chart mode — combined Cindy + Custom Workout volume bucketed
   by calendar day, same 14-bar/period-filter shape as the per-metric chart
   above, but pooling both modes since XP itself is already mode-agnostic
   (see computeSessionXP()). Gives a single RPG-style "how much did I grind"
   view instead of two disconnected charts. */
function renderCombinedXpChart() {
  const cindyItems = all_progress_cindy_items();
  const customItems = loadCustomWorkoutSessions().map(s => ({ ts: s.completedAt, xp: totalVolumeOfCustomSession(s) }));
  const runItems = loadRunSessions().map(s => ({ ts: s.completedAt, xp: s.xp || 0 }));
  let merged = cindyItems.concat(customItems).concat(runItems);

  if (currentPeriod !== 'all') {
    const days = parseInt(currentPeriod, 10);
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    merged = merged.filter(item => item.ts >= cutoff);
  }

  const chart = document.getElementById('chartBars');
  chart.innerHTML = '';
  if (merged.length === 0) {
    chart.innerHTML = '<div class="empty-hint" style="width:100%;">ยังไม่มีข้อมูลในช่วงนี้</div>';
    return;
  }

  const byDay = {};
  merged.forEach(item => {
    const d = new Date(item.ts);
    d.setHours(0, 0, 0, 0);
    const key = d.getTime();
    byDay[key] = (byDay[key] || 0) + item.xp;
  });
  const dayKeys = Object.keys(byDay).map(Number).sort((a, b) => a - b);
  const maxVal = Math.max(1, ...dayKeys.map(k => byDay[k]));
  dayKeys.slice(-14).forEach(key => {
    const val = byDay[key];
    const col = document.createElement('div');
    col.className = 'chart-col';
    const barH = Math.max(4, (val / maxVal) * 118);
    const d = new Date(key);
    col.innerHTML = `<div class="chart-bar xp" style="height:${barH}px;" title="${val} XP"></div>
      <div class="chart-xlabel">${d.getDate()}/${d.getMonth() + 1}</div>`;
    chart.appendChild(col);
  });
}
function all_progress_cindy_items() {
  return loadSessions().map(s => ({ ts: s.finished, xp: s.total ? s.total.reps : 0 }));
}

/* "RECENT RECORDS" — merges every isPR-flagged session from both Cindy and
   Custom Workout into one reverse-chronological list, since a PR is a PR
   regardless of which mode it happened in. Read-only, taps route into each
   mode's own detail screen exactly like the HISTORY tab does. */
function renderProgressRecords() {
  const wrap = document.getElementById('progressRecordsList');
  if (!wrap) return;
  const cindyPRs = loadSessions().filter(s => s.isPR).map(s => ({ kind: 'cindy', ts: s.finished, data: s }));
  const customPRs = loadCustomWorkoutSessions().filter(s => s.isPR).map(s => ({ kind: 'custom', ts: s.completedAt, data: s }));
  const merged = cindyPRs.concat(customPRs).sort((a, b) => b.ts - a.ts).slice(0, 8);

  if (merged.length === 0) {
    wrap.innerHTML = '<div class="empty-hint">ยังไม่มีสถิติใหม่ — ลุยต่อแล้วเดี๋ยวก็มา</div>';
    return;
  }
  wrap.innerHTML = merged.map(item => {
    if (item.kind === 'cindy') {
      const s = item.data;
      return `<div class="history-item" onclick="openDetail('${s.id}')">
        <div>
          <div class="date">${fmtDate(s.finished)}<span class="type-tag cindy">CINDY</span></div>
          <div class="reps">${s.total.reps} REPS · ${escapeHtml(s.protocolName || 'Cindy')}</div>
        </div>
        <div class="rounds" style="color:var(--warning);">${s.rounds} R</div>
      </div>`;
    }
    const s = item.data;
    return `<div class="history-item" onclick="openCustomHistoryDetail('${s.id}')">
      <div>
        <div class="date">${fmtDate(s.completedAt)}<span class="type-tag custom">${escapeHtml((s.workoutName || 'CUSTOM').toUpperCase())}</span></div>
        <div class="reps">${s.setsCompleted} เซ็ต · ${fmtTime(s.totalDurationSec)}</div>
      </div>
      <div class="rounds tabular" style="color:var(--warning);"><span class="icon-inline">${BADGE_ICONS.trophy}</span></div>
    </div>`;
  }).join('');
}

/* ---- BODY GROWTH ----
 * "Then vs now" view of the same 5 stats already shown in STATS above,
 * plus a Fitness Power sparkline across the player's whole history —
 * answers "how has my body actually developed" instead of only showing
 * a snapshot of current levels.
 *
 * collectStatEvents() replays every rep-earning event (Cindy rounds,
 * Custom Workout sets, Runs) in chronological order as {ts, delta}
 * pairs, using the exact same per-category mapping as loadStatTotals()
 * so the two never drift apart. Fitness test bests are treated as a
 * constant floor added equally to every snapshot (baseline and current
 * alike) since there's no logged history of when each test PR
 * happened — this keeps the *delta* honest even though the absolute
 * level at each point includes today's best-ever test result. */
function collectStatEvents() {
  const events = [];
  loadSessions().forEach(s => {
    if (!s.total) return;
    events.push({ ts: s.finished, delta: { pull: s.total.pull || 0, push: s.total.push || 0, legs: s.total.squat || 0, core: 0, cardio: 0 } });
  });
  loadCustomWorkoutSessions().forEach(s => {
    const delta = { pull: 0, push: 0, legs: 0, core: 0, cardio: 0 };
    (s.exerciseLog || []).forEach(e => {
      const cat = exerciseCategoryOrGuess(e);
      delta[cat] = (delta[cat] || 0) + (e.repsOrSecDone || 0);
    });
    events.push({ ts: s.completedAt, delta });
  });
  loadRunSessions().forEach(s => {
    events.push({ ts: s.completedAt, delta: { pull: 0, push: 0, legs: 0, core: 0, cardio: s.movingSec || 0 } });
  });
  events.sort((a, b) => a.ts - b.ts);
  return events;
}

function renderBodyGrowth() {
  const wrap = document.getElementById('bodyGrowthStats');
  const sparkWrap = document.getElementById('bodyGrowthSpark');
  const summaryEl = document.getElementById('bodyGrowthSummary');
  if (!wrap) return;

  const events = collectStatEvents();
  if (events.length === 0) {
    wrap.innerHTML = '<div class="empty-hint">เริ่มออกกำลังกายครั้งแรก แล้วกลับมาดูว่าร่างกายพัฒนาไปแค่ไหน</div>';
    if (sparkWrap) sparkWrap.innerHTML = '';
    if (summaryEl) summaryEl.textContent = '';
    return;
  }

  const testFloor = {};
  STAT_DEFS.forEach(def => { testFloor[def.key] = fitnessTestBestValue(def.key); });

  const running = { pull: 0, push: 0, legs: 0, core: 0, cardio: 0 };
  const fpPoints = [];
  let baselineTotals = null;
  events.forEach((ev, i) => {
    running.pull += ev.delta.pull; running.push += ev.delta.push;
    running.legs += ev.delta.legs; running.core += ev.delta.core; running.cardio += ev.delta.cardio;
    if (i === 0) baselineTotals = Object.assign({}, running);
    const withFloor = {};
    STAT_DEFS.forEach(def => { withFloor[def.key] = running[def.key] + testFloor[def.key]; });
    const fp = STAT_DEFS.reduce((sum, def) => sum + computeStatInfo(withFloor[def.key]).level, 0);
    fpPoints.push({ ts: ev.ts, fp });
  });

  const currentTotals = {};
  const baselineWithFloor = {};
  STAT_DEFS.forEach(def => {
    currentTotals[def.key] = running[def.key] + testFloor[def.key];
    baselineWithFloor[def.key] = baselineTotals[def.key] + testFloor[def.key];
  });

  const days = Math.max(1, Math.floor((Date.now() - events[0].ts) / 86400000));

  wrap.innerHTML = STAT_DEFS.map(def => {
    const startInfo = computeStatInfo(baselineWithFloor[def.key]);
    const nowInfo = computeStatInfo(currentTotals[def.key]);
    const delta = nowInfo.level - startInfo.level;
    const deltaLabel = delta > 0 ? ('+' + delta + ' LV') : (delta === 0 ? 'เท่าเดิม' : (delta + ' LV'));
    const deltaColor = delta > 0 ? 'var(--success)' : 'var(--text-faint)';
    const maxLevel = Math.max(nowInfo.level, startInfo.level, 1) + 1;
    const startPct = Math.min(100, (startInfo.level / maxLevel) * 100);
    const nowPct = Math.min(100, (nowInfo.level / maxLevel) * 100);
    return '<div class="growth-row">'
      + '<div class="growth-row-top"><span class="growth-label">' + def.short + ' · ' + def.label + '</span>'
      + '<span class="growth-delta" style="color:' + deltaColor + ';">' + deltaLabel + '</span></div>'
      + '<div class="growth-track">'
      + '<div class="growth-fill-now" style="width:' + nowPct + '%;background:' + def.color + ';"></div>'
      + '<div class="growth-marker" style="left:' + startPct + '%;" title="เริ่มต้น LV.' + startInfo.level + '"></div>'
      + '</div>'
      + '<div class="growth-row-bottom"><span>เริ่ม LV.' + startInfo.level + '</span><span>ตอนนี้ LV.' + nowInfo.level + '</span></div>'
      + '</div>';
  }).join('');

  const fpStart = fpPoints[0].fp;
  const fpNow = fpPoints[fpPoints.length - 1].fp;
  const fpDelta = fpNow - fpStart;
  if (summaryEl) {
    const deltaTxt = fpDelta > 0 ? ('+' + fpDelta) : String(fpDelta);
    summaryEl.innerHTML = 'ตั้งแต่เริ่มเล่นเมื่อ ' + days + ' วันก่อน Fitness Power โตขึ้น '
      + '<span style="color:var(--success);font-weight:800;">' + deltaTxt + '</span>'
      + ' (จาก ' + fpStart + ' → ' + fpNow + ')';
  }

  if (sparkWrap) {
    const maxPts = 24;
    let sampled = fpPoints;
    if (fpPoints.length > maxPts) {
      sampled = [];
      const step = fpPoints.length / maxPts;
      for (let i = 0; i < maxPts; i++) sampled.push(fpPoints[Math.min(fpPoints.length - 1, Math.floor(i * step))]);
      sampled.push(fpPoints[fpPoints.length - 1]);
    }
    const w = 300, h = 70, pad = 4;
    const minFp = Math.min(...sampled.map(p => p.fp));
    const maxFp = Math.max(...sampled.map(p => p.fp), minFp + 1);
    const stepX = sampled.length > 1 ? (w - pad * 2) / (sampled.length - 1) : 0;
    const coords = sampled.map((p, i) => {
      const x = pad + i * stepX;
      const y = h - pad - ((p.fp - minFp) / (maxFp - minFp)) * (h - pad * 2);
      return x.toFixed(1) + ',' + y.toFixed(1);
    });
    const last = coords[coords.length - 1].split(',');
    const areaPath = 'M' + coords[0] + ' L' + coords.join(' L') + ' L' + (w - pad) + ',' + (h - pad) + ' L' + pad + ',' + (h - pad) + ' Z';
    sparkWrap.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="width:100%;height:70px;display:block;">'
      + '<path d="' + areaPath + '" fill="var(--success)" opacity="0.12"></path>'
      + '<polyline points="' + coords.join(' ') + '" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></polyline>'
      + '<circle cx="' + last[0] + '" cy="' + last[1] + '" r="4" fill="var(--success)"></circle>'
      + '</svg>';
  }
}

/* ---------- daily reminder ---------- */
/* On the web this stays a soft in-app check (fires only while the app is open).
   Wrapped natively via Capacitor + @capacitor/local-notifications, it becomes a
   real scheduled OS notification that fires even if CINDY is closed. */
const KEY_REMINDER = 'cindy_reminder';
const REMINDER_NOTIF_ID = 5001;

function loadReminderConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_REMINDER));
    if (saved && typeof saved === 'object') return Object.assign({ enabled: false, time: '18:00', sound: 'default', lastShownDay: null }, saved);
  } catch (e) {}
  return { enabled: false, time: '18:00', sound: 'default', lastShownDay: null };
}
function saveReminderConfig(cfg) {
  localStorage.setItem(KEY_REMINDER, JSON.stringify(cfg));
}
function applyReminderToUI() {
  const cfg = loadReminderConfig();
  const toggle = document.getElementById('reminderToggle');
  const time = document.getElementById('reminderTime');
  const sound = document.getElementById('reminderSound');
  if (toggle) toggle.checked = cfg.enabled;
  if (time) time.value = cfg.time;
  if (sound) sound.value = cfg.sound || 'default';
  const nativeRow = document.getElementById('reminderNativeHint');
  if (nativeRow) nativeRow.style.display = isNativeApp() ? 'block' : 'none';
  const webRow = document.getElementById('reminderWebHint');
  if (webRow) webRow.style.display = isNativeApp() ? 'none' : 'block';
}

/* ---- native (Capacitor) helpers ---- */
function isNativeApp() {
  return !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
}
function capPlugins() {
  return isNativeApp() ? window.Capacitor.Plugins : null;
}
async function ensureReminderChannels() {
  const plugins = capPlugins();
  if (!plugins || !plugins.LocalNotifications) return;
  try {
    await plugins.LocalNotifications.createChannel({
      id: 'cindy_default', name: 'SYSTEM เตือนประจำวัน (มีเสียง)', importance: 4, visibility: 1, sound: 'default', vibration: true
    });
    await plugins.LocalNotifications.createChannel({
      id: 'cindy_silent', name: 'SYSTEM เตือนประจำวัน (สั่นอย่างเดียว)', importance: 3, visibility: 1, vibration: true
    });
  } catch (e) {}
}
function reminderDateForDay(timeStr, dayOffset) {
  const [h, m] = (timeStr || '18:00').split(':').map(n => parseInt(n, 10));
  const d = new Date();
  d.setDate(d.getDate() + dayOffset);
  d.setHours(h || 18, m || 0, 0, 0);
  return d;
}
async function rescheduleNativeReminder(forceTomorrow) {
  const plugins = capPlugins();
  if (!plugins || !plugins.LocalNotifications) return;
  const cfg = loadReminderConfig();
  try { await plugins.LocalNotifications.cancel({ notifications: [{ id: REMINDER_NOTIF_ID }] }); } catch (e) {}
  if (!cfg.enabled) return;
  await ensureReminderChannels();
  let fireDate = reminderDateForDay(cfg.time, 0);
  if (forceTomorrow || fireDate.getTime() <= Date.now()) fireDate = reminderDateForDay(cfg.time, 1);
  try {
    await plugins.LocalNotifications.schedule({
      notifications: [{
        id: REMINDER_NOTIF_ID,
        title: 'SYSTEM',
        body: 'ยังไม่ได้เล่น Workout วันนี้เลย — ลุยสักรอบไหม?',
        schedule: { at: fireDate },
        channelId: cfg.sound === 'silent' ? 'cindy_silent' : 'cindy_default',
        smallIcon: 'ic_stat_icon'
      }]
    });
  } catch (e) {}
}
async function testReminderNow() {
  const plugins = capPlugins();
  const cfg = loadReminderConfig();
  if (plugins && plugins.LocalNotifications) {
    await ensureReminderChannels();
    try {
      const perm = await plugins.LocalNotifications.requestPermissions();
      if (perm.display !== 'granted') { showToast('ยังไม่ได้อนุญาตการแจ้งเตือน'); return; }
      await plugins.LocalNotifications.schedule({
        notifications: [{
          id: 9999, title: 'SYSTEM', body: 'นี่คือการแจ้งเตือนทดสอบ',
          schedule: { at: new Date(Date.now() + 3000) },
          channelId: cfg.sound === 'silent' ? 'cindy_silent' : 'cindy_default'
        }]
      });
      showToast('จะแจ้งเตือนใน 3 วิ...');
    } catch (e) { showToast('ทดสอบไม่สำเร็จ'); }
  } else {
    showToast('ทดสอบแจ้งเตือนได้เต็มรูปแบบเมื่อแพ็กเป็นแอป (APK) เท่านั้น');
  }
}

async function toggleReminder(checked) {
  const cfg = loadReminderConfig();
  cfg.enabled = checked;
  saveReminderConfig(cfg);
  if (isNativeApp()) {
    const plugins = capPlugins();
    if (checked && plugins && plugins.LocalNotifications) {
      try {
        const perm = await plugins.LocalNotifications.requestPermissions();
        if (perm.display !== 'granted') { showToast('กรุณาอนุญาตการแจ้งเตือนในตั้งค่าเครื่อง'); cfg.enabled = false; saveReminderConfig(cfg); applyReminderToUI(); return; }
      } catch (e) {}
    }
    await rescheduleNativeReminder(false);
    showToast(checked ? 'เปิดเตือนแล้ว (แจ้งเตือนจริงแม้ปิดแอป)' : 'ปิดการเตือนแล้ว');
    return;
  }
  if (checked && 'Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch (e) {}
  }
  showToast(checked
    ? 'เปิดเตือนแล้ว (จะเตือนตอนเปิดแอปหลังเวลาที่ตั้ง ถ้ายังไม่ได้เล่นวันนี้)'
    : 'ปิดการเตือนแล้ว');
}
function setReminderTime(val) {
  const cfg = loadReminderConfig();
  cfg.time = val || '18:00';
  saveReminderConfig(cfg);
  if (isNativeApp()) rescheduleNativeReminder(false);
}
function setReminderSound(val) {
  const cfg = loadReminderConfig();
  cfg.sound = val === 'silent' ? 'silent' : 'default';
  saveReminderConfig(cfg);
  if (isNativeApp()) rescheduleNativeReminder(false);
}
function checkReminder() {
  const cfg = loadReminderConfig();
  if (!cfg.enabled) return;
  const now = new Date();
  const todayKey = dayKey(now.getTime());
  if (cfg.lastShownDay === todayKey) return;

  const sessions = loadSessions();
  const didToday = sessions.some(s => dayKey(s.finished) === todayKey);
  if (didToday) return;

  const [h, m] = (cfg.time || '18:00').split(':').map(n => parseInt(n, 10));
  const targetMinutes = (h || 0) * 60 + (m || 0);
  const nowMinutes = now.getHours() * 60 + now.getMinutes();
  if (nowMinutes < targetMinutes) return;

  cfg.lastShownDay = todayKey;
  saveReminderConfig(cfg);
  showToast('ยังไม่ได้เล่น SYSTEM วันนี้เลยนะ', 'web');
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => reg.showNotification('SYSTEM', {
          body: 'ยังไม่ได้เล่น Workout วันนี้เลย — ลุยสักรอบไหม?',
          icon: 'icon-192.png'
        })).catch(() => {});
      } else {
        new Notification('SYSTEM', { body: 'ยังไม่ได้เล่น Workout วันนี้เลย — ลุยสักรอบไหม?', icon: 'icon-192.png' });
      }
    } catch (e) {}
  }
}

/* ================= SHARE RESULT (canvas image) ================= */
async function shareResult(id) {
  const sessions = loadSessions();
  const s = sessions.find(x => x.id === id);
  if (!s) { showToast('ไม่พบข้อมูล'); return; }

  const canvas = document.createElement('canvas');
  const W = 1080, H = 1920;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // background: red-to-navy diagonal, spidey palette
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#3a0d10');
  grad.addColorStop(0.45, '#150912');
  grad.addColorStop(1, '#05070f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // radiating web lines from top-left corner
  ctx.save();
  ctx.strokeStyle = 'rgba(232,35,42,0.28)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W * (0.35 + t * 0.65), H * t * 0.9 + 40);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(61,111,224,0.22)';
  ctx.lineWidth = 2.4;
  [0.18, 0.34, 0.5].forEach(r => {
    ctx.beginPath();
    ctx.arc(0, 0, W * r * 1.5, 0, Math.PI / 2);
    ctx.stroke();
  });
  ctx.restore();

  // web-burst behind the big rounds number
  ctx.save();
  const cx = W / 2, cy = 760;
  ctx.strokeStyle = 'rgba(232,35,42,0.5)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const ang = (Math.PI * 2 * i) / 8;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * 330, cy + Math.sin(ang) * 330);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(61,111,224,0.4)';
  ctx.lineWidth = 2.6;
  [130, 230, 330].forEach(r => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.restore();

  ctx.textAlign = 'center';

  // brand row
  ctx.fillStyle = '#E8232A';
  ctx.font = '800 46px Arial';
  ctx.fillText('CINDY', W / 2, 150);
  ctx.fillStyle = 'rgba(245,244,240,0.75)';
  ctx.font = '700 28px Arial';
  ctx.letterSpacing = '3px';
  ctx.fillText(CONFIG.pull + ' PULL-UP · ' + CONFIG.push + ' PUSH-UP · ' + CONFIG.squat + ' SQUAT · ' + CONFIG.durationMin + ' MIN', W / 2, 200);
  ctx.letterSpacing = '0px';

  // big rounds number
  ctx.fillStyle = '#F5F4F0';
  ctx.font = '800 340px Arial';
  ctx.fillText(String(s.rounds), W / 2, cy + 110);

  ctx.fillStyle = 'rgba(245,244,240,0.65)';
  ctx.font = '700 34px Arial';
  ctx.letterSpacing = '4px';
  ctx.fillText('ROUNDS COMPLETED', W / 2, cy + 175);
  ctx.letterSpacing = '0px';

  if (s.isPR) {
    ctx.fillStyle = '#3ED598';
    ctx.font = '800 38px Arial';
    ctx.fillText('★ NEW PERSONAL RECORD', W / 2, cy + 240);
  }

  // stats grid 2x2
  const stats = [['TOTAL REPS', s.total.reps], ['PULL-UP', s.total.pull], ['PUSH-UP', s.total.push], ['SQUAT', s.total.squat]];
  const gridTop = 1330, cellW = W / 2, cellH = 160;
  stats.forEach((st, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = cellW * col + cellW / 2;
    const y = gridTop + row * cellH;
    ctx.fillStyle = '#F5F4F0';
    ctx.font = '800 64px Arial';
    ctx.fillText(String(st[1]), x, y);
    ctx.fillStyle = 'rgba(245,244,240,0.5)';
    ctx.font = '700 24px Arial';
    ctx.letterSpacing = '2px';
    ctx.fillText(st[0], x, y + 40);
    ctx.letterSpacing = '0px';
  });

  // divider bar (red -> blue) like the in-app brand underline
  const barGrad = ctx.createLinearGradient(W / 2 - 140, 0, W / 2 + 140, 0);
  barGrad.addColorStop(0, '#E8232A');
  barGrad.addColorStop(1, '#3D6FE0');
  ctx.fillStyle = barGrad;
  ctx.fillRect(W / 2 - 140, 1690, 280, 6);

  ctx.fillStyle = 'rgba(245,244,240,0.45)';
  ctx.font = '600 30px Arial';
  ctx.fillText(fmtDate(s.finished), W / 2, 1760);

  const fileName = 'cindy_result_' + s.id + '.png';

  /* Native app (Capacitor): write to app cache then hand off to the OS share
     sheet via @capacitor/share. This opens a real "share to..." picker so
     it's explicit where the image goes (Gallery, Files, LINE, etc.) instead
     of a silent browser download that's easy to lose track of. */
  const plugins = capPlugins();
  if (plugins && plugins.Filesystem && plugins.Share) {
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const base64Data = dataUrl.split(',')[1];
      const written = await plugins.Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: 'CACHE'
      });
      await plugins.Share.share({
        title: 'CINDY Result',
        text: s.rounds + ' rounds — CINDY AMRAP',
        url: written.uri,
        dialogTitle: 'แชร์ผลลัพธ์ CINDY'
      });
    } catch (e) {
      if (!(e && String(e.message || e).toLowerCase().includes('cancel'))) {
        showToast('แชร์ไม่สำเร็จ ลองอีกครั้ง');
      }
    }
    return;
  }

  /* Web fallback (running in a normal browser tab, not the packaged app) */
  canvas.toBlob(async (blob) => {
    if (!blob) { showToast('สร้างรูปไม่สำเร็จ'); return; }
    const file = new File([blob], fileName, { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'CINDY Result', text: s.rounds + ' rounds — CINDY AMRAP' });
        return;
      } catch (e) { /* cancelled — fall through to download */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('บันทึกรูปผลลัพธ์แล้ว (เช็คโฟลเดอร์ Download)');
  }, 'image/png');
}

/* Custom-workout analog of shareResult() above — same canvas layout and
   share/download fallback chain, just swapping the fixed PULL/PUSH/SQUAT
   stats for a dynamic top-4 exercise breakdown since Custom Workouts can
   contain any mix of exercises. */
async function shareCustomResult(id) {
  const s = loadCustomWorkoutSessions().find(x => x.id === id);
  if (!s) { showToast('ไม่พบข้อมูล'); return; }

  const totals = {};
  const order = [];
  (s.exerciseLog || []).forEach(entry => {
    if (!(entry.name in totals)) { totals[entry.name] = { value: 0, type: entry.type }; order.push(entry.name); }
    totals[entry.name].value += entry.repsOrSecDone;
  });
  const topExercises = order.slice(0, 4).map(name => [name.toUpperCase(), totals[name].value + (totals[name].type === 'time' ? 'วิ' : '')]);
  while (topExercises.length < 4) topExercises.push(['—', '']);

  const canvas = document.createElement('canvas');
  const W = 1080, H = 1920;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#3a0d10');
  grad.addColorStop(0.45, '#150912');
  grad.addColorStop(1, '#05070f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.strokeStyle = 'rgba(232,35,42,0.28)';
  ctx.lineWidth = 3;
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W * (0.35 + t * 0.65), H * t * 0.9 + 40);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(61,111,224,0.22)';
  ctx.lineWidth = 2.4;
  [0.18, 0.34, 0.5].forEach(r => {
    ctx.beginPath();
    ctx.arc(0, 0, W * r * 1.5, 0, Math.PI / 2);
    ctx.stroke();
  });
  ctx.restore();

  ctx.save();
  const cx = W / 2, cy = 760;
  ctx.strokeStyle = 'rgba(232,35,42,0.5)';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  for (let i = 0; i < 8; i++) {
    const ang = (Math.PI * 2 * i) / 8;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(ang) * 330, cy + Math.sin(ang) * 330);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(61,111,224,0.4)';
  ctx.lineWidth = 2.6;
  [130, 230, 330].forEach(r => {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  });
  ctx.restore();

  ctx.textAlign = 'center';

  ctx.fillStyle = '#E8232A';
  ctx.font = '800 40px Arial';
  ctx.fillText((s.workoutName || 'WORKOUT').toUpperCase(), W / 2, 150);
  ctx.fillStyle = 'rgba(245,244,240,0.75)';
  ctx.font = '700 28px Arial';
  ctx.letterSpacing = '3px';
  ctx.fillText('CUSTOM WORKOUT · ' + fmtTime(s.totalDurationSec), W / 2, 200);
  ctx.letterSpacing = '0px';

  ctx.fillStyle = '#F5F4F0';
  ctx.font = '800 300px Arial';
  ctx.fillText(String(s.setsCompleted), W / 2, cy + 110);

  ctx.fillStyle = 'rgba(245,244,240,0.65)';
  ctx.font = '700 34px Arial';
  ctx.letterSpacing = '4px';
  ctx.fillText('SETS COMPLETED', W / 2, cy + 175);
  ctx.letterSpacing = '0px';

  if (s.isPR) {
    ctx.fillStyle = '#3ED598';
    ctx.font = '800 38px Arial';
    ctx.fillText('★ NEW PERSONAL RECORD', W / 2, cy + 240);
  }

  const gridTop = 1330, cellW = W / 2, cellH = 160;
  topExercises.forEach((st, i) => {
    const col = i % 2, row = Math.floor(i / 2);
    const x = cellW * col + cellW / 2;
    const y = gridTop + row * cellH;
    ctx.fillStyle = '#F5F4F0';
    ctx.font = '800 56px Arial';
    ctx.fillText(String(st[1]), x, y);
    ctx.fillStyle = 'rgba(245,244,240,0.5)';
    ctx.font = '700 22px Arial';
    ctx.letterSpacing = '2px';
    ctx.fillText(st[0], x, y + 40);
    ctx.letterSpacing = '0px';
  });

  const barGrad = ctx.createLinearGradient(W / 2 - 140, 0, W / 2 + 140, 0);
  barGrad.addColorStop(0, '#E8232A');
  barGrad.addColorStop(1, '#3D6FE0');
  ctx.fillStyle = barGrad;
  ctx.fillRect(W / 2 - 140, 1690, 280, 6);

  ctx.fillStyle = 'rgba(245,244,240,0.45)';
  ctx.font = '600 30px Arial';
  ctx.fillText(fmtDate(s.completedAt), W / 2, 1760);

  const fileName = 'cindy_custom_result_' + s.id + '.png';

  const plugins = capPlugins();
  if (plugins && plugins.Filesystem && plugins.Share) {
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const base64Data = dataUrl.split(',')[1];
      const written = await plugins.Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: 'CACHE'
      });
      await plugins.Share.share({
        title: 'SYSTEM Custom Workout Result',
        text: s.setsCompleted + ' sets — ' + (s.workoutName || 'Custom Workout'),
        url: written.uri,
        dialogTitle: 'แชร์ผลลัพธ์ Workout'
      });
    } catch (e) {
      if (!(e && String(e.message || e).toLowerCase().includes('cancel'))) {
        showToast('แชร์ไม่สำเร็จ ลองอีกครั้ง');
      }
    }
    return;
  }

  canvas.toBlob(async (blob) => {
    if (!blob) { showToast('สร้างรูปไม่สำเร็จ'); return; }
    const file = new File([blob], fileName, { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'SYSTEM Custom Workout Result', text: s.setsCompleted + ' sets — ' + (s.workoutName || 'Custom Workout') });
        return;
      } catch (e) { /* cancelled — fall through to download */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('บันทึกรูปผลลัพธ์แล้ว (เช็คโฟลเดอร์ Download)');
  }, 'image/png');
}

/* ================= FORCE REFRESH (bust stale Service Worker cache) =========
   The Service Worker (sw.js) caches app.js/index.html cache-first, keyed by
   CACHE_NAME. If a person updates their bookmarked/installed copy without
   that name changing, or just has an old SW still controlling the page,
   they can be stuck looking at a stale version indefinitely with no visible
   sign anything is wrong. This gives them a manual escape hatch: unregister
   every SW controlling this page, delete every Cache Storage entry this
   origin owns, then hard-reload with a cache-busting query string so the
   browser's own HTTP cache can't quietly hand back the old files either. */
async function forceRefreshApp() {
  showToast('กำลังล้างแคชและโหลดเวอร์ชันล่าสุด...');
  try {
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map(reg => reg.unregister().catch(() => {})));
    }
  } catch (e) { /* SW API unsupported or blocked — continue anyway */ }

  try {
    if (window.caches && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(keys.map(key => caches.delete(key).catch(() => {})));
    }
  } catch (e) { /* Cache Storage unsupported or blocked — continue anyway */ }

  const url = new URL(location.href);
  url.searchParams.set('_refresh', Date.now().toString());
  location.replace(url.toString());
}

/** Reset Character: wipes every piece of saved progress this app owns
 * (sessions, XP/level seen-marker, streak chests, protocols, boss
 * defeats/loot, equipped skin and backdrop, quest/combo bonus flags,
 * custom workouts, weekly plan — every localStorage key prefixed
 * `cindy_`, plus the two legacy-named custom workout keys) and reloads
 * to a fresh LV.1 start. Confirmed via resetCharacterModal first, since
 * this is irreversible — EXPORT via the backup system above is the
 * escape hatch if someone changes their mind after the fact.
 *
 * Must also wipe the Firestore copy (via __cindyResetCloudData from
 * firestore-sync.js) BEFORE clearing localStorage and reloading — that
 * file only watches localStorage.setItem, never removeItem, so clearing
 * local data alone never told the cloud a reset happened. Without this,
 * the next reload's pullFromCloud() would just write the old progress
 * straight back into localStorage from the still-intact cloud document. */
function openResetCharacterModal() {
  requirePin('ใส่ PIN เพื่อรีเซ็ตตัวละคร', () => {
    document.getElementById('resetCharacterModal').classList.add('active');
  });
}
async function resetCharacterExecute() {
  closeModal('resetCharacterModal');
  showToast('กำลังรีเซ็ต...');

  // Cancel any debounced push still pending from actions right before the
  // reset, so it can't fire after the wipe below and re-upload old data.
  if (window.__cindyCancelPendingSync) window.__cindyCancelPendingSync();

  if (window.__cindyResetCloudData) {
    try {
      await window.__cindyResetCloudData();
    } catch (e) {
      // Fail open: still reset the local copy even if the cloud wipe
      // failed (e.g. offline) rather than leaving the user stuck.
      console.error('[reset] cloud reset failed, resetting local data anyway:', e);
    }
  }

  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('cindy_') || k === 'custom_workouts' || k === 'custom_workout_sessions') {
      localStorage.removeItem(k);
    }
  });
  showToast('รีเซ็ตตัวละครแล้ว');
  setTimeout(() => location.reload(), 500);
}

/* ================= LOGOUT (switch Google account) =================
 * Signs the current Google account out via the Firebase Auth compat SDK
 * (loaded globally by index.html — firebase.auth() works regardless of
 * what firebase-auth.js additionally wires up on top of it) and reloads,
 * which lands back on the #loginScreen gate the same way a fresh app
 * launch with no session would. Local data is intentionally left alone:
 * signing back into the same account should find everything as it was,
 * and firestore-sync.js's existing pull-on-login flow is what's expected
 * to reconcile localStorage against whichever account signs in next —
 * the same mechanism the app already relies on elsewhere (see the reset
 * flow above), so logout doesn't need to duplicate that here. */
function openLogoutModal() {
  document.getElementById('logoutModal').classList.add('active');
}
async function logoutExecute() {
  closeModal('logoutModal');
  showToast('กำลังออกจากระบบ...');

  // Cancel any debounced push still pending so it can't fire mid-signout.
  if (window.__cindyCancelPendingSync) window.__cindyCancelPendingSync();

  try {
    if (window.firebase && firebase.auth) {
      await firebase.auth().signOut();
    } else if (window.__cindySignOut) {
      await window.__cindySignOut();
    }
  } catch (e) {
    console.error('[logout] sign-out failed:', e);
    showToast('ออกจากระบบไม่สำเร็จ ลองอีกครั้ง');
    return;
  }
  setTimeout(() => location.reload(), 300);
}

/* ================= BACKUP (Export / Import) =================
   v2: covers ALL locally-stored user data, not just Cindy sessions.
   Previously this only exported KEY_SESSIONS ('cindy_sessions'), so
   Custom Workouts, their completed-session history, and custom protocols
   were silently left out of every backup — a device switch or app-clear
   would permanently destroy them with no way to recover. Fixed by
   collecting every user-data key into the payload, and merging every
   category back in on import (still backward-compatible with old
   v1 backups, which only ever contained `sessions`).

   v4: also covers loot inventory, equipped loot, and active backdrop —
   all three were earned/chosen by the player (boss-drop loot, which piece
   is worn, which backdrop is active) but were never in any export payload
   at all, so a device switch silently lost them even though skins and
   boss-defeat flags were already covered by v3. Loot inventory unions like
   the other achievement-style collections (max count per item, so a
   device that already has 2 of something never loses that to a backup
   that only has 1); equipped loot and backdrop only fill in if this
   device hasn't chosen one yet, same as activeSkin above. */
function exportData() {
  try {
    const sessions = loadSessions();
    const customWorkouts = loadCustomWorkouts();
    const customWorkoutSessions = loadCustomWorkoutSessions();
    const customProtocols = loadCustomProtocols();
    const runSessions = loadRunSessions();
    const streakChestsOpened = loadOpenedChests();
    const bossEverDefeated = loadBossEverDefeated();
    const lootInventory = loadLootInventory();

    if (!sessions.length && !customWorkouts.length && !customWorkoutSessions.length &&
        !customProtocols.length && !runSessions.length && !streakChestsOpened.length &&
        !bossEverDefeated.length && !Object.keys(lootInventory).length) {
      showToast('ยังไม่มีข้อมูลให้ส่งออก');
      return;
    }

    const payload = {
      app: 'CINDY',
      version: 5,
      exportedAt: Date.now(),
      sessions,
      customWorkouts,
      customWorkoutSessions,
      customProtocols,
      runSessions,
      progression: {
        lastSeenLevel: loadLastSeenLevel(),
        streakChestsOpened,
        bossEverDefeated,
        bossDefeatCounts: loadBossDefeatCounts(),
        activeSkin: loadActiveSkin(),
        lootInventory,
        equippedLootId: loadEquippedLootId(),
        activeBackdrop: loadActiveBackdropId()
      },
      settings: {
        theme: localStorage.getItem(KEY_THEME),
        voiceCues: localStorage.getItem(KEY_VOICE_CUES),
        activeProtocolId: loadActiveProtocolId(),
        reminder: loadReminderConfig()
      },
      questsAndGoals: {
        questClaimed: loadQuestClaimState(),
        questBonusXP: loadQuestBonusXP(),
        comboBonusXP: loadComboBonusXP(),
        restSkipBonusXP: loadRestSkipBonusXP(),
        stepsBonusXP: loadStepsBonusXP(),
        ringGoals: loadRingGoals(),
        weeklyPlan: loadWeeklyPlan()
      }
    };

    const d = new Date();
    const fname = 'cindy_backup_' + d.getFullYear() +
      String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
    const json = JSON.stringify(payload, null, 2);
    deliverExportFile(json, fname);
  } catch (e) {
    showToast('ส่งออกไม่สำเร็จ: ' + (e && e.message ? e.message : 'เกิดข้อผิดพลาด'));
  }
}

/* Some mobile browsers/in-app WebViews (notably Samsung Internet, iOS
 * home-screen PWAs, and anything rendering this page from a local file://
 * path rather than a real http(s) origin) silently ignore a *synthetic*
 * <a download> + blob click — the click fires, nothing throws, and the
 * person just sees nothing happen with no error and no download-manager
 * notification. That used to be reported as a fake "ส่งออกสำเร็จ" toast
 * even though no file ever appeared — indistinguishable from Export doing
 * nothing at all. Preference order:
 *   1) File System Access API (showSaveFilePicker) — lets the person pick
 *      the exact folder + filename themselves via the OS's native save
 *      dialog. Only available in Chromium desktop browsers over a real
 *      https/localhost origin, so it's fully optional/progressive: any
 *      browser without it (Safari, Firefox, most mobile browsers) just
 *      falls straight through to the next option below with no change
 *      in behavior.
 *   2) Native share sheet — reliable path on Android/Samsung: hands the
 *      file to "Save to My Files", Drive, etc. and always shows
 *      *something* happening.
 *   3) Guaranteed-visible manual panel (fallbackDownload -> 
 *      openExportFallbackPanel): still attempts the classic anchor+blob
 *      auto-click since it works fine in normal desktop/mobile browser
 *      tabs, but never trusts it alone — always follows up by opening a
 *      panel with a REAL, user-tappable download link (manual taps survive
 *      restrictions that block synthetic clicks) plus a copy-to-clipboard
 *      fallback of the raw JSON, so the person always sees something
 *      concrete on screen no matter what the browser silently no-op'd.
 */
async function deliverExportFile(json, fname) {
  /* Native app (Capacitor): same proven path as shareResult() above — write
     the file into app cache via @capacitor/filesystem, then hand it to the
     OS share sheet via @capacitor/share (Save to Files, Drive, LINE, etc.).
     This MUST come first: none of the plain web APIs below (File System
     Access, navigator.share, <a download>+blob) have anywhere to route to
     inside a bare Android WebView — there's no download manager wired up,
     so they can silently no-op even while still opening the fallback panel.
     That's exactly why the fallback panel was showing a download link that
     never produced a real file. */
  const nativePlugins = capPlugins();
  if (nativePlugins && nativePlugins.Filesystem && nativePlugins.Share) {
    try {
      const written = await nativePlugins.Filesystem.writeFile({
        path: fname,
        data: json,
        directory: 'CACHE',
        encoding: 'utf8'
      });
      await nativePlugins.Share.share({
        title: 'SYSTEM Backup',
        text: 'ไฟล์สำรองข้อมูล SYSTEM',
        url: written.uri,
        dialogTitle: 'บันทึก/แชร์ไฟล์สำรอง SYSTEM'
      });
      showToast('ส่งออกข้อมูลแล้ว (Cindy + Custom Workout + สกิน/ความคืบหน้า)');
      return;
    } catch (e) {
      if (e && String(e.message || e).toLowerCase().includes('cancel')) return; // user backed out of share sheet
      // any other native failure falls through to the web-based paths below
      // as a last resort, rather than leaving the person with nothing
    }
  }

  const blob = new Blob([json], { type: 'application/json' });

  if (window.showSaveFilePicker) {
    const pickerCalledAt = Date.now();
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: fname,
        types: [{ description: 'Cindy backup (JSON)', accept: { 'application/json': ['.json'] } }]
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      showToast('ส่งออกข้อมูลแล้ว (Cindy + Custom Workout + สกิน/ความคืบหน้า)');
      return;
    } catch (e) {
      // A REAL user cancel only happens after the native dialog was actually
      // shown and dismissed by hand — that always takes a non-trivial amount
      // of time. Some contexts (file:// origin, installed/home-screen PWAs,
      // in-app WebViews, sandboxed iframes) instead reject with the exact
      // same AbortError *instantly*, before any dialog ever appeared, because
      // the picker was refused outright rather than cancelled. Treating that
      // as "user cancelled" and returning silently is what caused Export to
      // look like it did nothing at all with no visible error. Guard against
      // that: only trust AbortError as a genuine cancel if enough time
      // passed for a person to have actually seen and closed the dialog.
      const elapsed = Date.now() - pickerCalledAt;
      if (e && e.name === 'AbortError' && elapsed > 400) return;
      // any other failure (e.g. permission denied, or an instant/fake abort)
      // falls through to the share-sheet / guaranteed-visible fallback below
    }
  }

  if (navigator.share && navigator.canShare && window.File) {
    try {
      const file = new File([blob], fname, { type: 'application/json' });
      if (navigator.canShare({ files: [file] })) {
        // Some browsers/standalone PWA contexts (notably iOS home-screen
        // installs) expose navigator.share/canShare as true but the actual
        // share() call can silently hang forever — no share sheet appears,
        // and the promise never resolves or rejects. Racing it against a
        // timeout guarantees this function always reaches an outcome
        // (toast or the guaranteed-visible fallback panel below) instead
        // of leaving the person staring at a button that "did nothing."
        const result = await Promise.race([
          navigator.share({ files: [file], title: fname }).then(() => 'shared').catch(err =>
            (err && err.name === 'AbortError') ? 'cancelled' : 'failed'),
          new Promise(resolve => setTimeout(() => resolve('timeout'), 3500))
        ]);
        if (result === 'shared') {
          showToast('ส่งออกข้อมูลแล้ว (Cindy + Custom Workout + สกิน/ความคืบหน้า)');
          return;
        }
        if (result === 'cancelled') return; // user backed out of the share sheet on purpose
        // 'failed' or 'timeout' — fall through to the guaranteed panel below
      }
    } catch (e) { /* fall through to the download-link path below */ }
  }
  fallbackDownload(blob, fname, json);
}

/* The classic <a download> + blob trick is attempted here, but it is NOT
 * trusted on its own: some mobile browsers/in-app WebViews (notably Samsung
 * Internet, iOS home-screen PWAs, and anything rendering this page from a
 * local file:// path rather than a real http(s) origin) silently ignore a
 * *synthetic* a.click() — no exception is thrown, so the old code here used
 * to just show a "ส่งออกสำเร็จ" toast regardless, which is exactly the "I
 * tapped Export and nothing happened" bug. A manually-tapped link survives
 * restrictions that block synthetic clicks, so this always follows up by
 * opening a small panel with a real, user-tappable download link plus a
 * copy-to-clipboard fallback — something the person can always see and use,
 * no matter what the auto-click silently no-op'd. */
function fallbackDownload(blob, fname, json) {
  let url = null;
  try { url = URL.createObjectURL(blob); } catch (e) { /* handled below */ }

  if (url) {
    try {
      const a = document.createElement('a');
      a.href = url; a.download = fname; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
    } catch (e) { /* ignore — the manual panel below is the real fallback */ }
  }
  openExportFallbackPanel(url, fname, json);
}

/** Guaranteed-visible export fallback: a real tappable download link (not a
 * synthetic click) plus the raw JSON in a copyable textarea. Always shows
 * something on screen, so it can't fail as silently as the auto-download. */
function openExportFallbackPanel(url, fname, json) {
  // iOS home-screen ("Add to Home Screen") installs run in WebKit's
  // standalone display mode, where a long-standing, still-open WebKit bug
  // means an <a download> pointing at a blob: URL is silently a no-op — the
  // tap registers but nothing happens, no error, no share sheet, nothing.
  // The exact same link works fine in a normal Safari tab; it's specifically
  // the installed-icon mode that WebKit doesn't support here. There's no
  // code-side fix for that (Apple's own bug tracker confirms it's
  // unresolved), so in that mode we make Copy the primary, recommended
  // action instead of a link that's known not to work.
  const isStandalone = (typeof navigator !== 'undefined' && navigator.standalone === true) ||
    (typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches);

  const link = document.getElementById('exportManualLink');
  if (link) {
    if (url) {
      link.href = url; link.download = fname;
      link.style.display = '';
    } else {
      link.style.display = 'none'; // couldn't even build a blob URL — copy is the only option
    }
    if (isStandalone) {
      link.classList.remove('btn-primary'); link.classList.add('btn-outline');
    } else {
      link.classList.remove('btn-outline'); link.classList.add('btn-primary');
    }
  }
  const ta = document.getElementById('exportManualText');
  if (ta) ta.value = json;

  const copyBtn = document.getElementById('exportManualCopyBtn');
  const hint = document.getElementById('exportManualHint');
  if (isStandalone) {
    if (copyBtn) { copyBtn.classList.remove('btn-outline'); copyBtn.classList.add('btn-primary'); }
    if (hint) hint.textContent = 'เปิดแอปนี้แบบไอคอนหน้าจอโฮมดาวน์โหลดไฟล์อัตโนมัติไม่ได้ (ข้อจำกัดของ iOS) — ใช้ปุ่ม "คัดลอกข้อมูล" ด้านล่างแทน แล้ววางเก็บไว้ในแอปโน้ตได้เลย';
    // Best-effort: put it on the clipboard immediately so a person who
    // never notices the hint text still ends up with their data saved
    // somewhere the moment this panel opens, not only after tapping Copy.
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(json).catch(() => {});
      }
    } catch (e) { /* ignore — the visible Copy button still works */ }
  } else {
    if (copyBtn) { copyBtn.classList.remove('btn-primary'); copyBtn.classList.add('btn-outline'); }
    if (hint) hint.textContent = '';
  }

  const modal = document.getElementById('exportFallbackModal');
  if (modal) modal.classList.add('active');
}

/** Copies the exported JSON to the clipboard so the person can paste it into
 * Notes/a chat/etc. as a manual backup even if no download path works at all. */
function copyExportData() {
  const ta = document.getElementById('exportManualText');
  if (!ta) return;
  const onDone = () => showToast('คัดลอกข้อมูลแล้ว วางเก็บไว้ในแอปโน้ตหรือแชทได้เลย');
  const onFail = () => showToast('คัดลอกไม่สำเร็จ ลองแตะค้างที่กล่องข้อความแล้วเลือกคัดลอกเอง');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(ta.value).then(onDone).catch(() => {
      try { ta.select(); document.execCommand('copy'); onDone(); }
      catch (e) { onFail(); }
    });
  } else {
    try { ta.select(); document.execCommand('copy'); onDone(); }
    catch (e) { onFail(); }
  }
}

function importData(event) {
  requirePin('ใส่ PIN เพื่อ Import ข้อมูล', () => importDataImpl(event));
}
function importDataImpl(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const incomingSessions = Array.isArray(parsed) ? parsed : parsed.sessions;
      const incomingWorkouts = Array.isArray(parsed) ? null : parsed.customWorkouts;
      const incomingWorkoutSessions = Array.isArray(parsed) ? null : parsed.customWorkoutSessions;
      const incomingProtocols = Array.isArray(parsed) ? null : parsed.customProtocols;
      const incomingRunSessions = Array.isArray(parsed) ? null : parsed.runSessions;
      const incomingProgression = Array.isArray(parsed) ? null : parsed.progression;
      const incomingSettings = Array.isArray(parsed) ? null : parsed.settings;
      const incomingQuestsAndGoals = Array.isArray(parsed) ? null : parsed.questsAndGoals;

      if (!Array.isArray(incomingSessions) && !Array.isArray(incomingWorkouts) &&
          !Array.isArray(incomingWorkoutSessions) && !Array.isArray(incomingProtocols) &&
          !Array.isArray(incomingRunSessions) &&
          !incomingProgression && !incomingSettings && !incomingQuestsAndGoals) {
        throw new Error('invalid format');
      }

      let added = 0;

      if (Array.isArray(incomingSessions)) {
        const existing = loadSessions();
        const byId = new Map(existing.map(s => [s.id, s]));
        incomingSessions.forEach(s => {
          if (s && s.id && s.finished && s.total) {
            if (!byId.has(s.id)) added++;
            byId.set(s.id, s);
          }
        });
        saveSessions(Array.from(byId.values()).sort((a, b) => a.finished - b.finished));
      }

      if (Array.isArray(incomingWorkouts)) {
        const existing = loadCustomWorkouts();
        const byId = new Map(existing.map(w => [w.id, w]));
        incomingWorkouts.forEach(w => {
          if (w && w.id && Array.isArray(w.exercises)) {
            if (!byId.has(w.id)) added++;
            byId.set(w.id, w);
          }
        });
        saveCustomWorkouts(Array.from(byId.values()));
      }

      if (Array.isArray(incomingWorkoutSessions)) {
        const existing = loadCustomWorkoutSessions();
        const byId = new Map(existing.map(s => [s.id, s]));
        incomingWorkoutSessions.forEach(s => {
          if (s && s.id) {
            if (!byId.has(s.id)) added++;
            byId.set(s.id, s);
          }
        });
        saveCustomWorkoutSessions(Array.from(byId.values()).sort((a, b) => a.completedAt - b.completedAt));
      }

      if (Array.isArray(incomingProtocols)) {
        const existing = loadCustomProtocols();
        const byId = new Map(existing.map(p => [p.id, p]));
        incomingProtocols.forEach(p => {
          if (p && p.id) {
            if (!byId.has(p.id)) added++;
            byId.set(p.id, p);
          }
        });
        saveCustomProtocols(Array.from(byId.values()));
      }

      if (Array.isArray(incomingRunSessions)) {
        const existing = loadRunSessions();
        const byId = new Map(existing.map(s => [s.id, s]));
        incomingRunSessions.forEach(s => {
          if (s && s.id && s.completedAt != null) {
            if (!byId.has(s.id)) added++;
            byId.set(s.id, s);
          }
        });
        saveRunSessions(Array.from(byId.values()).sort((a, b) => a.completedAt - b.completedAt));
      }

      // Mascot progression: achievement lists union (never lose an unlock),
      // level is a monotonic high-water mark, equipped skin only fills in
      // if this device doesn't already have one chosen.
      if (incomingProgression && typeof incomingProgression === 'object') {
        if (Array.isArray(incomingProgression.streakChestsOpened)) {
          const merged = Array.from(new Set([...loadOpenedChests(), ...incomingProgression.streakChestsOpened]));
          saveOpenedChests(merged);
        }
        if (Array.isArray(incomingProgression.bossEverDefeated)) {
          const merged = Array.from(new Set([...loadBossEverDefeated(), ...incomingProgression.bossEverDefeated]));
          saveBossEverDefeated(merged);
        }
        if (incomingProgression.bossDefeatCounts && typeof incomingProgression.bossDefeatCounts === 'object') {
          const counts = loadBossDefeatCounts();
          Object.keys(incomingProgression.bossDefeatCounts).forEach(bossId => {
            const incomingCount = incomingProgression.bossDefeatCounts[bossId];
            if (Number.isFinite(incomingCount)) counts[bossId] = Math.max(counts[bossId] || 0, incomingCount);
          });
          saveBossDefeatCounts(counts);
        }
        if (Number.isFinite(incomingProgression.lastSeenLevel)) {
          saveLastSeenLevel(Math.max(loadLastSeenLevel(), incomingProgression.lastSeenLevel));
        }
        if (incomingProgression.activeSkin && loadActiveSkin() === 'default') {
          saveActiveSkin(incomingProgression.activeSkin);
        }
        if (incomingProgression.lootInventory && typeof incomingProgression.lootInventory === 'object') {
          const current = loadLootInventory();
          const merged = { ...current };
          Object.keys(incomingProgression.lootInventory).forEach(itemId => {
            const incomingCount = incomingProgression.lootInventory[itemId];
            if (Number.isFinite(incomingCount)) {
              merged[itemId] = Math.max(current[itemId] || 0, incomingCount);
            }
          });
          saveLootInventory(merged);
        }
        if (incomingProgression.equippedLootId && !loadEquippedLootId()) {
          saveEquippedLootId(incomingProgression.equippedLootId);
        }
        if (incomingProgression.activeBackdrop && !loadActiveBackdropId()) {
          saveActiveBackdropId(incomingProgression.activeBackdrop);
        }
      }

      // Settings: only fill in values this device hasn't set for itself yet,
      // so importing a backup on a device already in use doesn't override
      // choices made on that device.
      if (incomingSettings && typeof incomingSettings === 'object') {
        if (incomingSettings.theme && localStorage.getItem(KEY_THEME) === null) {
          localStorage.setItem(KEY_THEME, incomingSettings.theme);
        }
        if (incomingSettings.voiceCues && localStorage.getItem(KEY_VOICE_CUES) === null) {
          localStorage.setItem(KEY_VOICE_CUES, incomingSettings.voiceCues);
        }
        if (incomingSettings.activeProtocolId && loadActiveProtocolId() === 'builtin_cindy') {
          localStorage.setItem(KEY_ACTIVE_PROTOCOL, incomingSettings.activeProtocolId);
        }
        if (incomingSettings.reminder && localStorage.getItem(KEY_REMINDER) === null) {
          saveReminderConfig(incomingSettings.reminder);
        }
      }

      // Quests/goals: weekly-scoped state fills in only if empty on this
      // device; the two running XP counters take the higher of the two
      // rather than summing, since summing would double-count XP that's
      // already folded into the imported session history.
      if (incomingQuestsAndGoals && typeof incomingQuestsAndGoals === 'object') {
        if (incomingQuestsAndGoals.questClaimed && localStorage.getItem(KEY_QUEST_CLAIMED) === null) {
          saveQuestClaimState(incomingQuestsAndGoals.questClaimed);
        }
        if (Number.isFinite(incomingQuestsAndGoals.questBonusXP)) {
          const bump = incomingQuestsAndGoals.questBonusXP - loadQuestBonusXP();
          if (bump > 0) addQuestBonusXP(bump);
        }
        if (Number.isFinite(incomingQuestsAndGoals.comboBonusXP)) {
          const bump = incomingQuestsAndGoals.comboBonusXP - loadComboBonusXP();
          if (bump > 0) addComboBonusXP(bump);
        }
        if (Number.isFinite(incomingQuestsAndGoals.restSkipBonusXP)) {
          const bump = incomingQuestsAndGoals.restSkipBonusXP - loadRestSkipBonusXP();
          if (bump > 0) addRestSkipBonusXP(bump);
        }
        if (Number.isFinite(incomingQuestsAndGoals.stepsBonusXP)) {
          const bump = incomingQuestsAndGoals.stepsBonusXP - loadStepsBonusXP();
          if (bump > 0) addStepsBonusXP(bump);
        }
        if (incomingQuestsAndGoals.ringGoals && localStorage.getItem(KEY_RING_GOALS) === null) {
          saveRingGoals(incomingQuestsAndGoals.ringGoals);
        }
        if (incomingQuestsAndGoals.weeklyPlan && localStorage.getItem(KEY_WEEKLY_PLAN) === null) {
          saveWeeklyPlan(incomingQuestsAndGoals.weeklyPlan);
        }
      }

      showToast('นำเข้าข้อมูลแล้ว (' + added + ' รายการใหม่)');
      renderProgress();
      renderCustomList();
      applyActiveMascotSkinFilter();
    } catch (e) {
      showToast('ไฟล์ไม่ถูกต้อง');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
}

/* ================= REST TIMER (standalone quick tool, not tied to a session) ================= */
let restTimer = { totalSec: 60, remainingMs: 60000, running: false, endTime: null, handle: null };
function openRestTimer() {
  renderRestTimer();
  document.getElementById('restTimerModal').classList.add('active');
}
function resetRestTimerState(totalSec) {
  stopRestTickLoop();
  restTimer.totalSec = totalSec;
  restTimer.remainingMs = totalSec * 1000;
  restTimer.running = false;
  restTimer.endTime = null;
}
function setRestDuration(sec) {
  resetRestTimerState(sec);
  renderRestTimer();
}
function adjustRestDuration(deltaSec) {
  resetRestTimerState(Math.max(5, restTimer.totalSec + deltaSec));
  renderRestTimer();
}
function toggleRestTimer() {
  if (restTimer.running) {
    restTimer.remainingMs = Math.max(0, restTimer.endTime - Date.now());
    restTimer.running = false;
    stopRestTickLoop();
  } else {
    if (restTimer.remainingMs <= 0) restTimer.remainingMs = restTimer.totalSec * 1000;
    restTimer.endTime = Date.now() + restTimer.remainingMs;
    restTimer.running = true;
    startRestTickLoop();
  }
  renderRestTimer();
}
function resetRestTimer() {
  resetRestTimerState(restTimer.totalSec);
  renderRestTimer();
}
function startRestTickLoop() {
  stopRestTickLoop();
  restTimer.handle = setInterval(tickRestTimer, 250);
}
function stopRestTickLoop() {
  if (restTimer.handle) { clearInterval(restTimer.handle); restTimer.handle = null; }
}
function tickRestTimer() {
  restTimer.remainingMs = Math.max(0, restTimer.endTime - Date.now());
  if (restTimer.remainingMs <= 0) {
    restTimer.running = false;
    stopRestTickLoop();
    vibrate([100, 60, 100, 60, 100]);
    beep(880, 200, 0.2);
    showToast('หมดเวลาพัก!');
  }
  renderRestTimer();
}
function renderRestTimer() {
  const digits = document.getElementById('restTimerDigits');
  if (!digits) return;
  digits.textContent = fmtTime(restTimer.remainingMs / 1000);
  const btn = document.getElementById('restTimerToggleBtn');
  if (btn) btn.textContent = restTimer.running ? 'PAUSE' : (restTimer.remainingMs > 0 && restTimer.remainingMs < restTimer.totalSec * 1000 ? 'RESUME' : 'START');
  document.querySelectorAll('#restQuickRow .period-pill').forEach(el => {
    el.classList.toggle('sel', parseInt(el.dataset.sec, 10) === restTimer.totalSec);
  });
}

/* ================= PWA INSTALL ================= */
let deferredInstallPrompt = null;

function isStandaloneDisplay() {
  return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
}
function isIOSDevice() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream;
}
function updateInstallButton() {
  const btn = document.getElementById('installBtn');
  if (!btn) return;
  if (isStandaloneDisplay()) { btn.classList.remove('show'); return; }
  if (deferredInstallPrompt || isIOSDevice()) {
    btn.classList.add('show');
  } else {
    btn.classList.remove('show');
  }
}
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  updateInstallButton();
});
window.addEventListener('appinstalled', () => {
  deferredInstallPrompt = null;
  updateInstallButton();
  showToast('ติดตั้ง SYSTEM สำเร็จ', 'muscle');
});
async function handleInstallClick() {
  if (deferredInstallPrompt) {
    deferredInstallPrompt.prompt();
    try { await deferredInstallPrompt.userChoice; } catch (e) {}
    deferredInstallPrompt = null;
    updateInstallButton();
    return;
  }
  if (isIOSDevice()) {
    document.getElementById('iosInstallModal').classList.add('active');
    return;
  }
  showToast('เบราว์เซอร์นี้ยังไม่รองรับการติดตั้งอัตโนมัติ');
}

/* ================= INIT ================= */
/* ================= RUNNING (GPS AUTO-TRACK) =================
 * GPS-only tracking — there is deliberately no manual-entry fallback. If
 * location permission is denied/unavailable the run cannot start; see
 * requestRunPermissionAndStart(). Distance is accumulated live via
 * watchPosition() + the Haversine formula, one accepted GPS fix at a time.
 *
 * Anti-noise: any fix with accuracy worse than RUN_GPS_ACCURACY_MAX_M is
 * dropped entirely (not used for distance, doesn't move the "last fix"
 * pointer either) — this is the single agreed-on defense against GPS
 * dropouts (e.g. tunnels) suddenly jumping distance. No additional
 * speed-based filter is applied, by request.
 *
 * XP: 60 XP/km base. The session's average *moving* pace (paused time
 * excluded) must fall within RUN_PACE_CEILING_SEC_PER_KM..
 * RUN_PACE_FLOOR_SEC_PER_KM (3:00–15:00 /km) to earn XP at the full
 * distance-based rate. Outside that range (either direction), XP is
 * capped as if the whole moving duration had been run at the nearer
 * pace boundary instead of the actual (suspicious/too-fast, or
 * idle/drifting-too-slow) pace — so neither GPS spoofing nor standing
 * still with GPS noise running can inflate XP past what a legitimate
 * boundary-pace run of the same duration would earn. Sessions under
 * RUN_MIN_XP_DISTANCE_KM earn 0 XP (anti session-spam-farming) but are
 * still saved to history with their real distance/time.
 */
const RUN_GPS_ACCURACY_MAX_M = 20;
const RUN_PACE_CEILING_SEC_PER_KM = 180; // 3:00 /km — fastest pace paid at full rate
const RUN_PACE_FLOOR_SEC_PER_KM = 900;   // 15:00 /km — slowest pace paid at full rate
const RUN_MIN_XP_DISTANCE_KM = 0.3;
const RUN_XP_PER_KM = 60;
/* GPS jitter while standing still (or barely moving) commonly reads as
 * 1-3m of apparent drift between fixes even when accuracy itself looks
 * fine — well under RUN_GPS_ACCURACY_MAX_M. Without a floor here, that
 * noise silently piles up into fake distance and a jagged fake route.
 * A fix that "moved" less than this from the last accepted fix is
 * treated as noise: dropped entirely, without advancing the anchor
 * point, so it can't nudge the reference and drift over many fixes. */
const RUN_MIN_MOVE_METERS = 4;

let runWatchId = null;
let runTickHandle = null;
/* id of the most recently completed run session, so the "แชร์" button on
 * the run-complete screen knows which session to render — set at the end
 * of finishRunSession(), right after the session is pushed to history. */
let lastCompletedRunId = null;

/** Great-circle distance between two lat/lon points, in meters. */
function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = d => d * Math.PI / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/** mm:ss pace string from seconds-per-km. '--:--' when not yet meaningful. */
function fmtPace(secPerKm) {
  if (!secPerKm || !isFinite(secPerKm) || secPerKm <= 0) return '--:--';
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return String(m) + ':' + String(s).padStart(2, '0');
}

function computeRunXP(distanceKm, movingSec) {
  if (distanceKm < RUN_MIN_XP_DISTANCE_KM || movingSec <= 0) return 0;
  const paceSecPerKm = movingSec / distanceKm;
  if (paceSecPerKm >= RUN_PACE_CEILING_SEC_PER_KM && paceSecPerKm <= RUN_PACE_FLOOR_SEC_PER_KM) {
    return Math.round(distanceKm * RUN_XP_PER_KM);
  }
  const boundaryPace = paceSecPerKm < RUN_PACE_CEILING_SEC_PER_KM ? RUN_PACE_CEILING_SEC_PER_KM : RUN_PACE_FLOOR_SEC_PER_KM;
  const equivalentKm = movingSec / boundaryPace;
  return Math.round(equivalentKm * RUN_XP_PER_KM);
}

/** Moving time so far, in ms — persisted movingMs plus the live segment
 * since the last resume (0 if currently paused). */
function getRunMovingMs(active) {
  if (!active) return 0;
  const extra = active.isPaused ? 0 : (Date.now() - active.lastResumeTs);
  return (active.movingMs || 0) + extra;
}

/* ---- Program screen "RUN" card / start screen ---- */
function renderRunHome() {
  const mainBtn = document.getElementById('runMainBtn');
  const secWrap = document.getElementById('runSecondaryWrap');
  const active = loadRunActive();
  if (mainBtn) {
    if (active) {
      mainBtn.textContent = 'RESUME การวิ่ง';
      mainBtn.classList.remove('btn-primary');
      mainBtn.classList.add('btn-resume');
      if (secWrap) secWrap.style.display = 'block';
    } else {
      mainBtn.textContent = 'เริ่มวิ่ง';
      mainBtn.classList.add('btn-primary');
      mainBtn.classList.remove('btn-resume');
      if (secWrap) secWrap.style.display = 'none';
    }
  }
  const sessions = loadRunSessions();
  const bestEl = document.getElementById('runStatBest');
  const sessionsEl = document.getElementById('runStatSessions');
  const totalEl = document.getElementById('runStatTotal');
  const streakEl = document.getElementById('runStatStreak');
  if (bestEl) {
    const best = sessions.reduce((m, s) => Math.max(m, s.distanceKm), 0);
    bestEl.textContent = best > 0 ? best.toFixed(2) : '0';
  }
  if (sessionsEl) sessionsEl.textContent = sessions.length;
  if (totalEl) {
    const total = sessions.reduce((sum, s) => sum + s.distanceKm, 0);
    totalEl.textContent = total.toFixed(1);
  }
  if (streakEl) streakEl.textContent = computeCombinedStreak();
}
function handleRunMainBtn() {
  unlockAudio();
  const active = loadRunActive();
  if (active) {
    enterRunScreen();
  } else {
    requestRunPermissionAndStart();
  }
}
function confirmDiscardRunAndStartNew() {
  detachRunWatch();
  stopRunTickLoop();
  clearRunActive();
  requestRunPermissionAndStart();
}

/* ---- permission gate + start ---- */
/** On Android (APK/Capacitor build), the WebView's navigator.geolocation
 * never triggers the OS runtime permission dialog on its own — nothing
 * calls the native permission API, so it just fails silently forever even
 * though the manifest declares the permission. window.Capacitor.Plugins.
 * Geolocation.requestPermissions() is the one that actually pops the
 * native Android dialog. We call it first (no-op / instantly resolves on
 * a plain desktop/mobile browser where window.Capacitor doesn't exist),
 * then fall through to the normal navigator.geolocation flow, which will
 * now succeed because the OS-level permission is actually granted. */
async function requestRunPermissionAndStart() {
  if (!('geolocation' in navigator)) {
    document.getElementById('runGpsDeniedModal').classList.add('active');
    return;
  }
  showToast('กำลังขอสิทธิ์ตำแหน่ง...');
  try {
    const geoPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Geolocation;
    if (geoPlugin) {
      const status = await geoPlugin.requestPermissions();
      const granted = status && (status.location === 'granted' || status.coarseLocation === 'granted');
      if (!granted) {
        document.getElementById('runGpsDeniedModal').classList.add('active');
        return;
      }
    }
  } catch (e) {
    // Fall through to navigator.geolocation below, which will surface its
    // own error via the denied-modal if the native plugin call failed.
  }
  navigator.geolocation.getCurrentPosition(
    () => { startNewRun(); },
    () => {
      document.getElementById('runGpsDeniedModal').classList.add('active');
    },
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}
function retryRunPermission() {
  closeModal('runGpsDeniedModal');
  requestRunPermissionAndStart();
}

function startNewRun() {
  const now = Date.now();
  const active = {
    id: 'run_' + now,
    startedAt: now,
    distanceM: 0,
    movingMs: 0,
    lastResumeTs: now,
    isPaused: false,
    lastFixLat: null,
    lastFixLon: null,
    weakGpsFlag: false,
    // Array of segments (array of [lat,lon] point arrays). A new segment
    // starts whenever lastFixLat is null (run start, or right after a
    // pause/resume) so the route drawing never draws a straight line
    // across a gap where the runner wasn't actually moving/tracked.
    path: []
  };
  saveRunActive(active);
  enterRunScreen();
}
function enterRunScreen() {
  go('running');
  acquireWakeLock();
  attachRunWatch();
  startRunTickLoop();
  refreshRunUI();
}

function attachRunWatch() {
  if (runWatchId !== null) return;
  runWatchId = navigator.geolocation.watchPosition(onRunPosition, onRunPositionError, {
    enableHighAccuracy: true, maximumAge: 1000, timeout: 20000
  });
}
function detachRunWatch() {
  if (runWatchId !== null) {
    navigator.geolocation.clearWatch(runWatchId);
    runWatchId = null;
  }
}
function onRunPositionError() {
  // Transient errors mid-run (brief signal loss, timeout) — don't kill the
  // session, just skip this fix and wait for the next one. Only the
  // initial permission check (requestRunPermissionAndStart) treats a
  // failure as fatal.
}
function onRunPosition(pos) {
  const active = loadRunActive();
  if (!active || active.isPaused) return;
  const { latitude, longitude, accuracy } = pos.coords;
  if (accuracy != null && accuracy > RUN_GPS_ACCURACY_MAX_M) {
    active.weakGpsFlag = true;
    saveRunActive(active);
    refreshRunUI();
    return; // fix too noisy — dropped, doesn't move distance or the last-fix pointer
  }
  active.weakGpsFlag = false;
  if (!active.path) active.path = []; // migration guard for a run started before path recording existed
  if (active.lastFixLat != null) {
    const movedM = haversineMeters(active.lastFixLat, active.lastFixLon, latitude, longitude);
    if (movedM < RUN_MIN_MOVE_METERS) {
      // GPS noise, not real movement — save the (possibly just-cleared)
      // weakGpsFlag for the UI, but leave the anchor point, distance and
      // path untouched so jitter can't accumulate fake distance or draw
      // a jagged fake route while standing still.
      saveRunActive(active);
      refreshRunUI();
      return;
    }
    active.distanceM += movedM;
    // continue the current segment
    if (active.path.length === 0) active.path.push([]);
    active.path[active.path.length - 1].push([latitude, longitude]);
  } else {
    // start of the run, or right after a pause/resume — begin a new segment
    active.path.push([[latitude, longitude]]);
  }
  active.lastFixLat = latitude;
  active.lastFixLon = longitude;
  saveRunActive(active);
  refreshRunUI();
}

/* ---- pause / resume / live UI ---- */
function startRunTickLoop() {
  stopRunTickLoop();
  runTickHandle = setInterval(refreshRunUI, 1000);
}
function stopRunTickLoop() {
  if (runTickHandle) { clearInterval(runTickHandle); runTickHandle = null; }
}
function toggleRunPause() {
  const active = loadRunActive();
  if (!active) return;
  if (active.isPaused) {
    active.lastResumeTs = Date.now();
    active.isPaused = false;
    // Don't count the pre-pause -> post-pause gap as distance travelled
    // (tied shoelaces, waited at a light, etc.) — start a fresh fix pair.
    active.lastFixLat = null;
    active.lastFixLon = null;
  } else {
    active.movingMs = getRunMovingMs(active);
    active.isPaused = true;
  }
  saveRunActive(active);
  refreshRunUI();
}
function refreshRunUI() {
  const active = loadRunActive();
  if (!active) return;
  const distanceKm = active.distanceM / 1000;
  const movingSec = getRunMovingMs(active) / 1000;
  const paceSecPerKm = distanceKm > 0.02 ? movingSec / distanceKm : 0;

  const distEl = document.getElementById('runDistanceBig');
  const timeEl = document.getElementById('runTimeVal');
  const paceEl = document.getElementById('runPaceVal');
  const statusPill = document.getElementById('runStatusPill');
  const pauseBtn = document.getElementById('runPauseBtn');
  const gpsWarn = document.getElementById('runGpsWeakHint');
  if (distEl) distEl.textContent = distanceKm.toFixed(2);
  if (timeEl) timeEl.textContent = fmtTime(movingSec);
  if (paceEl) paceEl.textContent = fmtPace(paceSecPerKm);
  if (statusPill) {
    statusPill.textContent = active.isPaused ? 'พักอยู่' : 'กำลังวิ่ง';
    statusPill.classList.toggle('paused', !!active.isPaused);
  }
  if (pauseBtn) pauseBtn.textContent = active.isPaused ? 'RESUME' : 'PAUSE';
  if (gpsWarn) gpsWarn.style.display = active.weakGpsFlag && !active.isPaused ? 'block' : 'none';
}

/* ---- end / discard / save ---- */
function openRunEndModal() { document.getElementById('runEndModal').classList.add('active'); }
function confirmDiscardRun() {
  detachRunWatch();
  stopRunTickLoop();
  releaseWakeLock();
  clearRunActive();
  closeModal('runEndModal');
  go('home');
}
function confirmFinishRun() {
  closeModal('runEndModal');
  finishRunSession();
}
function finishRunSession() {
  const active = loadRunActive();
  if (!active) return;
  detachRunWatch();
  stopRunTickLoop();
  releaseWakeLock();

  const distanceKm = Math.round((active.distanceM / 1000) * 100) / 100;
  const movingSec = Math.round(getRunMovingMs(active) / 1000);
  const paceSecPerKm = distanceKm > 0 ? Math.round(movingSec / distanceKm) : 0;
  const xp = computeRunXP(distanceKm, movingSec);

  const session = {
    id: active.id,
    startedAt: active.startedAt,
    completedAt: Date.now(),
    distanceKm,
    movingSec,
    paceSecPerKm,
    xp,
    path: active.path || []
  };
  const sessions = loadRunSessions();
  sessions.push(session);
  saveRunSessions(sessions);
  clearRunActive();

  lastCompletedRunId = session.id;
  go('bossbattle');
  startBossBattleCutscene(session, 'run', () => {
    renderRunCompleteScreen(session);
    go('runcomplete');
  });
}
function renderRunCompleteScreen(session) {
  document.getElementById('runCompleteDistance').textContent = session.distanceKm.toFixed(2);
  document.getElementById('runCompleteTime').textContent = fmtTime(session.movingSec);
  document.getElementById('runCompletePace').textContent = fmtPace(session.paceSecPerKm) + ' /กม.';
  document.getElementById('runCompleteXp').textContent = '+' + session.xp + ' XP';
  const hint = document.getElementById('runCompleteXpHint');
  if (hint) {
    if (session.xp === 0 && session.distanceKm < RUN_MIN_XP_DISTANCE_KM) {
      hint.textContent = 'ระยะสั้นกว่า ' + RUN_MIN_XP_DISTANCE_KM + ' กม. เลยยังไม่ได้ XP รอบนี้';
      hint.style.display = 'block';
    } else {
      hint.style.display = 'none';
    }
  }
  const canvas = document.getElementById('runCompleteRouteCanvas');
  if (canvas) drawRoutePreview(canvas, session.path);
}
function finishRunCompleteFlow() { go('home'); }
function shareLastCompletedRun() {
  if (lastCompletedRunId != null) shareRunResult(lastCompletedRunId);
}

/* ================= ROUTE PREVIEW (in-app mini canvas) ================= */
/**
 * Draws a small route-shape preview into an on-screen <canvas> — same
 * projection logic as the big share-image renderer below, just scaled to
 * the canvas's own pixel size. Segments (see startNewRun/onRunPosition)
 * are drawn as separate strokes so a pause gap never shows as a straight
 * line cutting across the map.
 */
function drawRoutePreview(canvas, pathSegments) {
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  const allPoints = (pathSegments || []).flat();
  if (allPoints.length < 2) {
    ctx.fillStyle = 'rgba(141,147,166,0.7)';
    ctx.font = '600 13px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ไม่มีข้อมูลเส้นทางสำหรับการวิ่งนี้', W / 2, H / 2);
    return;
  }
  const projected = projectRunPathSegments(pathSegments, W, H, 18);
  ctx.strokeStyle = '#22C7B0';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  projected.forEach(seg => {
    if (seg.length < 2) return;
    ctx.beginPath();
    seg.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
    ctx.stroke();
  });
  const firstSeg = projected.find(s => s.length > 0);
  const lastSeg = [...projected].reverse().find(s => s.length > 0);
  if (firstSeg) {
    ctx.fillStyle = '#3ED598';
    ctx.beginPath(); ctx.arc(firstSeg[0][0], firstSeg[0][1], 5, 0, Math.PI * 2); ctx.fill();
  }
  if (lastSeg) {
    const p = lastSeg[lastSeg.length - 1];
    ctx.fillStyle = '#E8232A';
    ctx.beginPath(); ctx.arc(p[0], p[1], 5, 0, Math.PI * 2); ctx.fill();
  }
}

/**
 * Projects lat/lon segments onto a width x height pixel box, preserving
 * real-world aspect ratio (longitude degrees are scaled by cos(avgLat) so
 * the route shape isn't stretched near non-equatorial latitudes) and
 * centering it within the padded box. Returns the same segment structure
 * with each [lat,lon] replaced by an [x,y] pixel pair.
 */
function projectRunPathSegments(pathSegments, width, height, padding) {
  const allPoints = (pathSegments || []).flat();
  if (allPoints.length === 0) return [];
  const lats = allPoints.map(p => p[0]), lons = allPoints.map(p => p[1]);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLon = Math.min(...lons), maxLon = Math.max(...lons);
  const avgLat = (minLat + maxLat) / 2;
  const lonScale = Math.cos(avgLat * Math.PI / 180) || 1;
  const lonRangeDeg = Math.max((maxLon - minLon) * lonScale, 0.00005);
  const latRangeDeg = Math.max(maxLat - minLat, 0.00005);
  const w = Math.max(width - padding * 2, 1), h = Math.max(height - padding * 2, 1);
  const scale = Math.min(w / lonRangeDeg, h / latRangeDeg);
  const drawnW = lonRangeDeg * scale, drawnH = latRangeDeg * scale;
  const offsetX = padding + (w - drawnW) / 2;
  const offsetY = padding + (h - drawnH) / 2;
  return (pathSegments || []).map(seg => seg.map(([lat, lon]) => [
    offsetX + (lon - minLon) * lonScale * scale,
    offsetY + (maxLat - lat) * scale // flip: higher latitude draws nearer the top
  ]));
}

/* ================= SHARE RUN RESULT (canvas image, Strava-style) =================
 * Renders the GPS route shape together with distance/time/pace stats into
 * one shareable image — same canvas-build + native/web share fallback
 * chain as shareResult()/shareCustomResult() above, just with a route map
 * in place of the workout web-burst decoration. */
async function shareRunResult(id) {
  const s = loadRunSessions().find(x => x.id === id);
  if (!s) { showToast('ไม่พบข้อมูล'); return; }

  const canvas = document.createElement('canvas');
  const W = 1080, H = 1920;
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d');

  // background: teal-to-navy diagonal, matches the RUN mode's accent color
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, '#0d2e2a');
  grad.addColorStop(0.45, '#0a1520');
  grad.addColorStop(1, '#05070f');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // faint concentric arcs, echoes the app's radial brand texture
  ctx.save();
  ctx.strokeStyle = 'rgba(34,199,176,0.18)';
  ctx.lineWidth = 2.4;
  [0.18, 0.34, 0.5].forEach(r => {
    ctx.beginPath();
    ctx.arc(0, 0, W * r * 1.5, 0, Math.PI / 2);
    ctx.stroke();
  });
  ctx.restore();

  // brand row
  ctx.textAlign = 'center';
  ctx.fillStyle = '#22C7B0';
  ctx.font = '800 46px Arial';
  ctx.fillText('SYSTEM RUN', W / 2, 130);
  ctx.fillStyle = 'rgba(245,244,240,0.6)';
  ctx.font = '600 26px Arial';
  ctx.fillText(fmtDate(s.completedAt), W / 2, 172);

  // route map card
  const mapX = 60, mapY = 220, mapW = W - 120, mapH = 760;
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.04)';
  if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(mapX, mapY, mapW, mapH, 24); ctx.fill(); }
  else ctx.fillRect(mapX, mapY, mapW, mapH);
  ctx.restore();

  const allPoints = (s.path || []).flat();
  if (allPoints.length >= 2) {
    const projected = projectRunPathSegments(s.path, mapW, mapH, 70).map(seg =>
      seg.map(([x, y]) => [x + mapX, y + mapY])
    );
    ctx.save();
    ctx.shadowColor = 'rgba(34,199,176,0.55)';
    ctx.shadowBlur = 22;
    ctx.strokeStyle = '#22C7B0';
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    projected.forEach(seg => {
      if (seg.length < 2) return;
      ctx.beginPath();
      seg.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
      ctx.stroke();
    });
    ctx.shadowBlur = 0;
    const firstSeg = projected.find(seg => seg.length > 0);
    const lastSeg = [...projected].reverse().find(seg => seg.length > 0);
    if (firstSeg) {
      ctx.fillStyle = '#3ED598';
      ctx.beginPath(); ctx.arc(firstSeg[0][0], firstSeg[0][1], 13, 0, Math.PI * 2); ctx.fill();
    }
    if (lastSeg) {
      const p = lastSeg[lastSeg.length - 1];
      ctx.fillStyle = '#E8232A';
      ctx.beginPath(); ctx.arc(p[0], p[1], 13, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();
  } else {
    ctx.fillStyle = 'rgba(245,244,240,0.4)';
    ctx.font = '600 30px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('ไม่มีข้อมูลเส้นทางสำหรับการวิ่งนี้', W / 2, mapY + mapH / 2);
  }

  // big distance number
  ctx.textAlign = 'center';
  ctx.fillStyle = '#F5F4F0';
  ctx.font = '800 300px Arial';
  ctx.fillText(s.distanceKm.toFixed(2), W / 2, 1250);
  ctx.fillStyle = 'rgba(245,244,240,0.65)';
  ctx.font = '700 34px Arial';
  ctx.letterSpacing = '4px';
  ctx.fillText('กิโลเมตร', W / 2, 1300);
  ctx.letterSpacing = '0px';

  // stats grid 2x2: time / pace / xp / (blank date already shown up top)
  const stats = [
    ['เวลาที่วิ่ง', fmtTime(s.movingSec)],
    ['เพซเฉลี่ย /กม.', fmtPace(s.paceSecPerKm)],
    ['XP ที่ได้', '+' + (s.xp || 0)],
  ];
  const gridTop = 1420, cellW = W / stats.length, cellH = 160;
  stats.forEach((st, i) => {
    const x = cellW * i + cellW / 2;
    ctx.fillStyle = '#F5F4F0';
    ctx.font = '800 58px Arial';
    ctx.fillText(String(st[1]), x, gridTop);
    ctx.fillStyle = 'rgba(245,244,240,0.5)';
    ctx.font = '700 22px Arial';
    ctx.letterSpacing = '1.5px';
    ctx.fillText(st[0], x, gridTop + 38);
    ctx.letterSpacing = '0px';
  });

  // divider bar (teal), matches the run mode's brand color
  ctx.fillStyle = '#22C7B0';
  ctx.fillRect(W / 2 - 140, 1650, 280, 6);

  ctx.fillStyle = 'rgba(245,244,240,0.45)';
  ctx.font = '600 28px Arial';
  ctx.fillText('SYSTEM — Level Up Your Life', W / 2, 1720);

  const fileName = 'cindy_run_' + s.id + '.png';
  const shareTitle = 'SYSTEM Run';
  const shareText = s.distanceKm.toFixed(2) + ' กม. ในเวลา ' + fmtTime(s.movingSec) + ' เพซเฉลี่ย ' + fmtPace(s.paceSecPerKm) + '/กม. — SYSTEM RUN';

  /* Native app (Capacitor): write to app cache then hand off to the OS
     share sheet via @capacitor/share — same approach as shareResult(). */
  const plugins = capPlugins();
  if (plugins && plugins.Filesystem && plugins.Share) {
    try {
      const dataUrl = canvas.toDataURL('image/png');
      const base64Data = dataUrl.split(',')[1];
      const written = await plugins.Filesystem.writeFile({
        path: fileName,
        data: base64Data,
        directory: 'CACHE'
      });
      await plugins.Share.share({
        title: shareTitle,
        text: shareText,
        url: written.uri,
        dialogTitle: 'แชร์สถิติการวิ่ง'
      });
    } catch (e) {
      if (!(e && String(e.message || e).toLowerCase().includes('cancel'))) {
        showToast('แชร์ไม่สำเร็จ ลองอีกครั้ง');
      }
    }
    return;
  }

  /* Web fallback (running in a normal browser tab, not the packaged app) */
  canvas.toBlob(async (blob) => {
    if (!blob) { showToast('สร้างรูปไม่สำเร็จ'); return; }
    const file = new File([blob], fileName, { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: shareTitle, text: shareText });
        return;
      } catch (e) { /* cancelled — fall through to download */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('บันทึกรูปสถิติการวิ่งแล้ว (เช็คโฟลเดอร์ Download)');
  }, 'image/png');
}

/* ---- history detail / delete ---- */
let currentRunDetailId = null;
function openRunDetail(id) {
  const s = loadRunSessions().find(x => x.id === id);
  if (!s) return;
  currentRunDetailId = id;
  document.getElementById('runDetailWrap').innerHTML = `
    <div class="complete-hero" style="padding-top:4px;">
      <div class="complete-rounds tabular">${s.distanceKm.toFixed(2)}</div>
      <div class="complete-lbl">กม. · ${fmtDate(s.completedAt)}</div>
    </div>
    <div class="metric-card" style="margin-bottom:14px;padding:10px;">
      <canvas id="runDetailRouteCanvas" width="600" height="280" style="width:100%;height:180px;display:block;border-radius:10px;"></canvas>
    </div>
    <div class="metric-grid">
      <div class="metric-card"><div class="v tabular">${fmtTime(s.movingSec)}</div><div class="l">เวลาวิ่ง</div></div>
      <div class="metric-card"><div class="v tabular">${fmtPace(s.paceSecPerKm)}</div><div class="l">เพซเฉลี่ย /กม.</div></div>
      <div class="metric-card"><div class="v">${s.xp}</div><div class="l">XP ที่ได้</div></div>
    </div>
    <button class="btn btn-outline" style="margin-top:14px;" onclick="shareRunResult('${s.id}')">แชร์สถิติการวิ่ง</button>
  `;
  const canvas = document.getElementById('runDetailRouteCanvas');
  if (canvas) drawRoutePreview(canvas, s.path || []);
  go('rundetail');
}
function confirmDeleteRunSession() {
  requirePin('ใส่ PIN เพื่อลบประวัติการวิ่งนี้', () => {
    document.getElementById('deleteRunModal').classList.add('active');
  });
}
function deleteRunSessionExecute() {
  const sessions = loadRunSessions().filter(s => s.id !== currentRunDetailId);
  saveRunSessions(sessions);
  closeModal('deleteRunModal');
  currentRunDetailId = null;
  showToast('ลบการวิ่งนี้แล้ว');
  go('history');
}

/* One-time explanation for the Phase 2B Combat Power redefinition (see
 * computeCombatPower). Fires at most once per player, only for players
 * flagged by the v2 migration above (i.e. only those who'd actually see
 * a number drop). Deliberately placed after go('home') in init() so the
 * toast element is already mounted and visible instead of firing behind
 * the splash screen. */
function maybeShowCPPatchNote() {
  if (!localStorage.getItem(KEY_CP_PATCHNOTE_V1_PENDING)) return;
  localStorage.removeItem(KEY_CP_PATCHNOTE_V1_PENDING);
  showToast('ปรับปรุงระบบ Power ให้แม่นยำขึ้น — Combat Power ไม่นับเรพซ้ำกับ Stat แล้ว', 'target');
}
function init() {
  runMigrationsIfNeeded();
  maybeShowAppLock(); // check first: a locked player still sees the lock screen over whatever renders below
  applyStoredTheme();
  applyProtocolToUI();
  const active = loadActive();
  if (active) {
    // if time already elapsed while app was closed, auto-complete
    const remaining = active.isPaused ? active.pausedRemainingMs : (active.endTime - Date.now());
    if (remaining <= 0) {
      completeWorkout(active, 'timeout');
    }
  }

  const params = new URLSearchParams(window.location.search);
  if (params.get('action') === 'start') {
    if (loadActive()) { enterWorkoutScreen(); }
    else { startNewWorkout(); }
  } else {
    go('home');
  }
  maybeShowCPPatchNote();
  updateInstallButton();
  checkReminder();
  if (isNativeApp()) rescheduleNativeReminder(false);
  initStepsIntegration();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}
/* Splash is just the brand animation — it must hide on its own timer
 * regardless of login state, otherwise a logged-out player would stare at
 * the splash forever instead of seeing the login screen underneath it. */
function hideSplashSoon() {
  const splash = document.getElementById('splash');
  if (splash) setTimeout(() => splash.classList.add('hide'), 1050);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', hideSplashSoon);
} else {
  hideSplashSoon();
}
/* init() must not read localStorage until the storage-shim (storage-shim.js)
 * has finished hydrating its cache from @capacitor/preferences — otherwise
 * the app would render as if there's no save data for a moment on native
 * builds. window.__cindyStorageReady is a no-op-resolved promise on plain
 * web, so this behaves exactly as before there.
 * init() also must not run until window.__cindyAuthReady resolves
 * (firebase-auth.js) — that promise only resolves once a player is signed
 * in with Google, so the game never boots for a logged-out user. */
function whenAppReady(fn) {
  Promise.all([
    Promise.resolve(window.__cindyStorageReady),
    Promise.resolve(window.__cindyAuthReady)
  ]).then(fn);
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => whenAppReady(init));
} else {
  whenAppReady(init);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    if (hasPinSet()) touchPinActivity(); // stamp the moment we left, so the >2min check below is measured from here
  } else if (document.visibilityState === 'visible') {
    maybeShowAppLock();
    checkReminder();
  }
});
/* ================= CUSTOM WORKOUT — EXERCISE LIBRARY (PHASE 5a) ================= */
/* Static list of preset exercises the Builder can offer as shortcuts.
   Purely a UI convenience — selecting one just pre-fills the same
   makeCustomExercise() fields the user could type in manually, so it never
   changes the CustomWorkout schema and never touches storage on its own.
   category: 'pull' | 'push' | 'core' | 'legs' | 'cardio'
   equipment: 'bodyweight' | 'dumbbell' | 'tower'  (tower = pull-up/dip station) */
const EXERCISE_LIBRARY = [
  // ---- PULL ----
  { name: 'Pull-up', category: 'pull', equipment: 'tower', type: 'reps', reps: 5, restAfterSec: 30 },
  { name: 'Chin-up', category: 'pull', equipment: 'tower', type: 'reps', reps: 5, restAfterSec: 30 },
  { name: 'Negative Pull-up', category: 'pull', equipment: 'tower', type: 'reps', reps: 5, restAfterSec: 30 },
  { name: 'Inverted Row', category: 'pull', equipment: 'tower', type: 'reps', reps: 10, restAfterSec: 20 },
  { name: 'Dumbbell Row', category: 'pull', equipment: 'dumbbell', type: 'reps', reps: 12, restAfterSec: 15 },
  { name: 'Dumbbell Deadlift', category: 'pull', equipment: 'dumbbell', type: 'reps', reps: 12, restAfterSec: 20 },
  { name: 'Dumbbell Bicep Curl', category: 'pull', equipment: 'dumbbell', type: 'reps', reps: 12, restAfterSec: 15 },
  { name: 'Dumbbell Hammer Curl', category: 'pull', equipment: 'dumbbell', type: 'reps', reps: 12, restAfterSec: 15 },
  { name: 'Superman', category: 'pull', equipment: 'bodyweight', type: 'reps', reps: 15, restAfterSec: 15 },
  { name: 'Reverse Snow Angel', category: 'pull', equipment: 'bodyweight', type: 'reps', reps: 15, restAfterSec: 15 },

  // ---- PUSH ----
  { name: 'Push-up', category: 'push', equipment: 'bodyweight', type: 'reps', reps: 10, restAfterSec: 15 },
  { name: 'Diamond Push-up', category: 'push', equipment: 'bodyweight', type: 'reps', reps: 8, restAfterSec: 15 },
  { name: 'Wide Push-up', category: 'push', equipment: 'bodyweight', type: 'reps', reps: 10, restAfterSec: 15 },
  { name: 'Incline Push-up', category: 'push', equipment: 'bodyweight', type: 'reps', reps: 12, restAfterSec: 15 },
  { name: 'Decline Push-up', category: 'push', equipment: 'bodyweight', type: 'reps', reps: 8, restAfterSec: 15 },
  { name: 'Pike Push-up', category: 'push', equipment: 'bodyweight', type: 'reps', reps: 8, restAfterSec: 15 },
  { name: 'Dip', category: 'push', equipment: 'tower', type: 'reps', reps: 8, restAfterSec: 30 },
  { name: 'Bench Dip', category: 'push', equipment: 'bodyweight', type: 'reps', reps: 12, restAfterSec: 15 },
  { name: 'Dumbbell Shoulder Press', category: 'push', equipment: 'dumbbell', type: 'reps', reps: 10, restAfterSec: 20 },
  { name: 'Dumbbell Bench Press', category: 'push', equipment: 'dumbbell', type: 'reps', reps: 10, restAfterSec: 20 },
  { name: 'Dumbbell Chest Fly', category: 'push', equipment: 'dumbbell', type: 'reps', reps: 12, restAfterSec: 15 },
  { name: 'Dumbbell Lateral Raise', category: 'push', equipment: 'dumbbell', type: 'reps', reps: 12, restAfterSec: 15 },
  { name: 'Dumbbell Front Raise', category: 'push', equipment: 'dumbbell', type: 'reps', reps: 12, restAfterSec: 15 },
  { name: 'Dumbbell Tricep Extension', category: 'push', equipment: 'dumbbell', type: 'reps', reps: 12, restAfterSec: 15 },
  { name: 'Dumbbell Tricep Kickback', category: 'push', equipment: 'dumbbell', type: 'reps', reps: 12, restAfterSec: 15 },

  // ---- CORE ----
  { name: 'Plank', category: 'core', equipment: 'bodyweight', type: 'time', durationSec: 30, restAfterSec: 15 },
  { name: 'Side Plank', category: 'core', equipment: 'bodyweight', type: 'time', durationSec: 20, restAfterSec: 15 },
  { name: 'Sit-up', category: 'core', equipment: 'bodyweight', type: 'reps', reps: 15, restAfterSec: 15 },
  { name: 'Crunch', category: 'core', equipment: 'bodyweight', type: 'reps', reps: 20, restAfterSec: 15 },
  { name: 'Bicycle Crunch', category: 'core', equipment: 'bodyweight', type: 'reps', reps: 20, restAfterSec: 15 },
  { name: 'Russian Twist', category: 'core', equipment: 'bodyweight', type: 'reps', reps: 20, restAfterSec: 15 },
  { name: 'Leg Raise', category: 'core', equipment: 'bodyweight', type: 'reps', reps: 12, restAfterSec: 15 },
  { name: 'Hanging Leg Raise', category: 'core', equipment: 'tower', type: 'reps', reps: 10, restAfterSec: 30 },
  { name: 'Hanging Knee Raise', category: 'core', equipment: 'tower', type: 'reps', reps: 12, restAfterSec: 30 },
  { name: 'V-up', category: 'core', equipment: 'bodyweight', type: 'reps', reps: 12, restAfterSec: 15 },
  { name: 'Flutter Kick', category: 'core', equipment: 'bodyweight', type: 'time', durationSec: 30, restAfterSec: 15 },
  { name: 'Dead Bug', category: 'core', equipment: 'bodyweight', type: 'reps', reps: 12, restAfterSec: 15 },

  // ---- LEGS ----
  { name: 'Squat', category: 'legs', equipment: 'bodyweight', type: 'reps', reps: 15, restAfterSec: 15 },
  { name: 'Dumbbell Squat', category: 'legs', equipment: 'dumbbell', type: 'reps', reps: 12, restAfterSec: 20 },
  { name: 'Lunge', category: 'legs', equipment: 'bodyweight', type: 'reps', reps: 12, restAfterSec: 15 },
  { name: 'Dumbbell Lunge', category: 'legs', equipment: 'dumbbell', type: 'reps', reps: 12, restAfterSec: 20 },
  { name: 'Bulgarian Split Squat', category: 'legs', equipment: 'dumbbell', type: 'reps', reps: 10, restAfterSec: 20 },
  { name: 'Step-up', category: 'legs', equipment: 'bodyweight', type: 'reps', reps: 12, restAfterSec: 15 },
  { name: 'Glute Bridge', category: 'legs', equipment: 'bodyweight', type: 'reps', reps: 15, restAfterSec: 15 },
  { name: 'Dumbbell Romanian Deadlift', category: 'legs', equipment: 'dumbbell', type: 'reps', reps: 12, restAfterSec: 20 },
  { name: 'Calf Raise', category: 'legs', equipment: 'bodyweight', type: 'reps', reps: 20, restAfterSec: 15 },
  { name: 'Wall Sit', category: 'legs', equipment: 'bodyweight', type: 'time', durationSec: 30, restAfterSec: 15 },
  { name: 'Jump Squat', category: 'legs', equipment: 'bodyweight', type: 'reps', reps: 12, restAfterSec: 20 },

  // ---- CARDIO ----
  { name: 'Jumping Jack', category: 'cardio', equipment: 'bodyweight', type: 'time', durationSec: 30, restAfterSec: 15 },
  { name: 'Burpee', category: 'cardio', equipment: 'bodyweight', type: 'reps', reps: 10, restAfterSec: 20 },
  { name: 'Mountain Climber', category: 'cardio', equipment: 'bodyweight', type: 'time', durationSec: 30, restAfterSec: 15 },
  { name: 'High Knees', category: 'cardio', equipment: 'bodyweight', type: 'time', durationSec: 30, restAfterSec: 15 },
  { name: 'Butt Kick', category: 'cardio', equipment: 'bodyweight', type: 'time', durationSec: 30, restAfterSec: 15 },
  { name: 'Skater Jump', category: 'cardio', equipment: 'bodyweight', type: 'time', durationSec: 30, restAfterSec: 15 },
  { name: 'Star Jump', category: 'cardio', equipment: 'bodyweight', type: 'reps', reps: 15, restAfterSec: 15 }
];
const EXERCISE_CATEGORIES = [
  { id: 'all', label: 'ทั้งหมด' },
  { id: 'pull', label: 'PULL' },
  { id: 'push', label: 'PUSH' },
  { id: 'core', label: 'CORE' },
  { id: 'legs', label: 'LEGS' },
  { id: 'cardio', label: 'CARDIO' }
];
const EQUIPMENT_LABEL = { bodyweight: '', dumbbell: 'ดัมเบล', tower: 'Power Tower' };

/* ================= CARDIO PRESETS (READY-MADE) ================= */
/* Built-in, non-editable Custom Workout "recipes" made from cardio moves
 * that already exist in EXERCISE_LIBRARY — no new exercises introduced.
 * Same object shape as a saved Custom Workout (see makeCustomExercise /
 * saveCustomWorkout above) so they can be handed straight to
 * beginCustomWorkoutPlayerReal() and reuse its entire play/warmup/complete
 * flow untouched. These are NOT persisted to KEY_CUSTOM_WORKOUTS — they're
 * read directly from this array, so there's nothing to migrate or corrupt.
 * `category: 'cardio'` is carried on the preset object only as a forward-
 * looking tag (e.g. to filter Custom Workout History/Progress by category
 * later) — nothing reads it yet, so it has zero effect today. */
const CARDIO_PRESETS = [
  {
    id: 'cardio_hiit_burn',
    name: 'HIIT เบิร์นไว',
    category: 'cardio',
    warmupEnabled: false,
    exercises: [
      makeCustomExercise({ order: 0, name: 'Jumping Jack', type: 'time', durationSec: 30, sets: 3, restBetweenSetsSec: 15, restAfterSec: 15 }),
      makeCustomExercise({ order: 1, name: 'Burpee', type: 'reps', reps: 10, sets: 3, restBetweenSetsSec: 20, restAfterSec: 20 }),
      makeCustomExercise({ order: 2, name: 'Mountain Climber', type: 'time', durationSec: 30, sets: 3, restBetweenSetsSec: 15, restAfterSec: 15 })
    ]
  },
  {
    id: 'cardio_classic_circuit',
    name: 'Cardio Circuit คลาสสิก',
    category: 'cardio',
    warmupEnabled: false,
    exercises: [
      makeCustomExercise({ order: 0, name: 'High Knees', type: 'time', durationSec: 30, sets: 2, restBetweenSetsSec: 15, restAfterSec: 15 }),
      makeCustomExercise({ order: 1, name: 'Butt Kick', type: 'time', durationSec: 30, sets: 2, restBetweenSetsSec: 15, restAfterSec: 15 }),
      makeCustomExercise({ order: 2, name: 'Skater Jump', type: 'time', durationSec: 30, sets: 2, restBetweenSetsSec: 15, restAfterSec: 15 }),
      makeCustomExercise({ order: 3, name: 'Star Jump', type: 'reps', reps: 15, sets: 2, restBetweenSetsSec: 15, restAfterSec: 15 })
    ]
  },
  {
    id: 'cardio_tabata_short',
    name: 'Tabata สั้น กระชับ',
    category: 'cardio',
    warmupEnabled: false,
    // Burpee/Mountain Climber alternate as separate 1-set entries (rather
    // than "all sets of A, then all sets of B") so the player's normal
    // exercise-by-exercise flow naturally produces the fast alternation
    // Tabata calls for, with short rest between each turn.
    exercises: [
      makeCustomExercise({ order: 0, name: 'Burpee', type: 'reps', reps: 8, sets: 1, restBetweenSetsSec: 0, restAfterSec: 10 }),
      makeCustomExercise({ order: 1, name: 'Mountain Climber', type: 'time', durationSec: 20, sets: 1, restBetweenSetsSec: 0, restAfterSec: 10 }),
      makeCustomExercise({ order: 2, name: 'Burpee', type: 'reps', reps: 8, sets: 1, restBetweenSetsSec: 0, restAfterSec: 10 }),
      makeCustomExercise({ order: 3, name: 'Mountain Climber', type: 'time', durationSec: 20, sets: 1, restBetweenSetsSec: 0, restAfterSec: 10 }),
      makeCustomExercise({ order: 4, name: 'Burpee', type: 'reps', reps: 8, sets: 1, restBetweenSetsSec: 0, restAfterSec: 10 }),
      makeCustomExercise({ order: 5, name: 'Mountain Climber', type: 'time', durationSec: 20, sets: 1, restBetweenSetsSec: 0, restAfterSec: 10 }),
      makeCustomExercise({ order: 6, name: 'Burpee', type: 'reps', reps: 8, sets: 1, restBetweenSetsSec: 0, restAfterSec: 10 }),
      makeCustomExercise({ order: 7, name: 'Mountain Climber', type: 'time', durationSec: 20, sets: 1, restBetweenSetsSec: 0, restAfterSec: 10 })
    ]
  }
];

/* ================= CUSTOM WORKOUT (FREE-FORM) — DATA MODEL & STORAGE ================= */
/* Phase 1: schema + CRUD only. No UI/builder/player yet — those come in later phases.
   Kept completely separate from Cindy's protocol/session storage (different keys)
   so nothing here can ever corrupt or interfere with existing Cindy data. */

const KEY_CUSTOM_WORKOUTS = 'custom_workouts';          // saved workout "recipes"
const KEY_CUSTOM_SESSIONS = 'custom_workout_sessions';  // completed workout results

/* ---- Workout definitions (the "recipe" the user builds) ---- */

function loadCustomWorkouts() {
  let saved;
  try {
    saved = JSON.parse(localStorage.getItem(KEY_CUSTOM_WORKOUTS));
    if (!Array.isArray(saved)) return [];
  } catch (e) { return []; }

  /* Schema v1 -> v2 migration: sets/restBetweenSetsSec used to live on the
     whole workout (a "circuit" repeated N times, same rest for every
     exercise). v2 moves both onto each exercise instead, so every exercise
     can have its own set count and its own rest between sets. This runs
     once per legacy workout and persists the migrated shape immediately,
     so it's a no-op on every later load. */
  let migrated = false;
  saved = saved.map(w => {
    const needsMigration = w && Array.isArray(w.exercises) &&
      w.exercises.some(ex => ex.sets == null) && (w.sets != null || w.restBetweenSetsSec != null);
    if (!needsMigration) return w;
    migrated = true;
    const legacySets = Math.max(1, parseInt(w.sets, 10) || 1);
    const legacyRest = Math.max(0, parseInt(w.restBetweenSetsSec, 10) || 0);
    return Object.assign({}, w, {
      exercises: w.exercises.map(ex => Object.assign({}, ex, {
        sets: ex.sets != null ? ex.sets : legacySets,
        restBetweenSetsSec: ex.restBetweenSetsSec != null ? ex.restBetweenSetsSec : legacyRest
      }))
    });
  });
  if (migrated) saveCustomWorkouts(saved);
  return saved;
}

function saveCustomWorkouts(list) {
  localStorage.setItem(KEY_CUSTOM_WORKOUTS, JSON.stringify(list));
}

function getCustomWorkout(id) {
  return loadCustomWorkouts().find(w => w.id === id) || null;
}

/**
 * Creates a blank/valid exercise entry. The (future) builder UI calls this
 * every time the user taps "+ เพิ่มท่า".
 */
function makeCustomExercise(overrides) {
  return Object.assign({
    order: 0,
    name: '',
    type: 'reps',              // 'reps' | 'time'
    reps: 10,                  // used when type === 'reps'
    durationSec: 30,           // used when type === 'time'
    sets: 3,                   // how many sets of THIS exercise before moving on
    restBetweenSetsSec: 45,    // rest between sets of THIS exercise
    restAfterSec: 15,          // rest after the LAST set of this exercise, before the next exercise
    weight: 0,                 // optional load in kg; 0 = bodyweight / not tracked
    supersetWithNext: false,   // true = skip the rest-before-next-exercise, flow straight into it
    category: undefined        // pull|push|legs|core|cardio — which Character Stat this feeds
                                // (see STAT_DEFS). Left unset by default (rather than defaulting
                                // to 'core' here) so exerciseCategoryOrGuess() can fall through to
                                // a name-match against EXERCISE_LIBRARY for callers — like
                                // CARDIO_PRESETS — that never pass one explicitly; defaulting it
                                // here would wrongly lock those in as 'core' before the name-match
                                // ever ran. The exercise editor's category selector shows 'core' as
                                // a UI fallback only (ex.category || 'core'); it isn't saved until
                                // the user actually picks one.
  }, overrides || {});
}

/**
 * Creates or updates a workout definition.
 * Pass an existing `id` to update in place; omit it to create a new one.
 * Always re-numbers exercise order to match array position, so the builder
 * never has to manage order indices itself — just reorder the array and save.
 */
function saveCustomWorkout(workout) {
  const list = loadCustomWorkouts();
  const clean = {
    id: workout.id || ('workout_' + Date.now()),
    name: (workout.name || '').trim() || 'Untitled Workout',
    createdAt: workout.createdAt || Date.now(),
    updatedAt: Date.now(),
    warmupEnabled: !!workout.warmupEnabled,
    exercises: Array.isArray(workout.exercises)
      ? workout.exercises.map((ex, i) => makeCustomExercise(Object.assign({}, ex, { order: i })))
      : []
  };
  const idx = list.findIndex(w => w.id === clean.id);
  if (idx >= 0) list[idx] = clean; else list.push(clean);
  saveCustomWorkouts(list);
  return clean;
}

function deleteCustomWorkout(id) {
  saveCustomWorkouts(loadCustomWorkouts().filter(w => w.id !== id));
}

/* ---- Completed session results ---- */

function loadCustomWorkoutSessions() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_CUSTOM_SESSIONS));
    if (Array.isArray(saved)) return saved;
  } catch (e) {}
  return [];
}

function saveCustomWorkoutSessions(list) {
  localStorage.setItem(KEY_CUSTOM_SESSIONS, JSON.stringify(list));
  invalidateXPCache();
}

/* ================= WORKOUT QUALITY CAP (Phase 2E — anti-cheat) =================
 * Custom Workout reps are typed in by the player (tap +/- to set the count,
 * then confirm — see adjustPlayerReps/confirmPlayerExerciseDone), unlike
 * Cindy's protocol where every round's rep target is fixed by the app.
 * That free-entry step is exactly the gap #19 in the product doc flagged:
 * nothing stops a player from setting an absurd number and confirming
 * instantly, and that number flows straight into XP, the 5-stat totals
 * (loadStatTotals) and Boss damage (currentBossState) with no check at all.
 *
 * The signal used here is the same kind of "does the physical world back
 * this number up" check already used for Run (pace ceiling/floor) and
 * rest-skip (payout cap): total workout duration is real wall-clock time
 * (Date.now() start to finish — see finishCustomPlayerWorkout), so it can't
 * be typed in directly. If the reps-type volume logged this session would
 * need more time than was actually spent — at a floor of
 * CUSTOM_QUALITY_MIN_SEC_PER_REP per rep, already far faster than any real
 * athlete sustains across a full set — the reps-type entries are scaled
 * down proportionally so the total fits what the clock says was possible.
 *
 * Deliberately NOT part of this check:
 * - type:'time' entries (Plank, Flutter Kick, ...) — their value already IS
 *   real elapsed seconds off the in-app timer, not a typed number, so
 *   there's nothing to fake here the way there is for reps. They're also
 *   subtracted out of the time budget before judging the reps-type volume,
 *   since that time wasn't available for reps.
 * - RPE — self-reported, entered after the fact on the complete screen, and
 *   not something the app can verify (same "trust model" as the Training
 *   Camp tests). Gating XP/stats on it would punish honest low-RPE entries,
 *   not catch farming.
 * - Cindy protocol sessions — reps per round are fixed by the app, not
 *   typed by the player, so this exploit doesn't apply to them.
 *
 * A capped entry keeps the player's original typed value in enteredValue
 * alongside the counted repsOrSecDone, so the breakdown UI can show the
 * adjustment transparently instead of silently overwriting a number the
 * player just typed. */
const CUSTOM_QUALITY_MIN_SEC_PER_REP = 0.35; // ~171 reps/min sustained — generous floor, not a realistic pace

function applyWorkoutQualityCap(exerciseLog, totalDurationSec) {
  const log = Array.isArray(exerciseLog) ? exerciseLog : [];
  const repsVolume = log.filter(e => e.type !== 'time').reduce((sum, e) => sum + (e.repsOrSecDone || 0), 0);
  if (repsVolume <= 0) return { exerciseLog: log, capped: false };

  const timeVolumeSec = log.filter(e => e.type === 'time').reduce((sum, e) => sum + (e.repsOrSecDone || 0), 0);
  const timeBudgetForReps = Math.max(0, (totalDurationSec || 0) - timeVolumeSec);
  const maxPlausibleReps = timeBudgetForReps / CUSTOM_QUALITY_MIN_SEC_PER_REP;
  if (repsVolume <= maxPlausibleReps) return { exerciseLog: log, capped: false };

  const scale = maxPlausibleReps / repsVolume;
  const cappedLog = log.map(e => {
    if (e.type === 'time') return e;
    const counted = Math.max(0, Math.round((e.repsOrSecDone || 0) * scale));
    return Object.assign({}, e, { repsOrSecDone: counted, enteredValue: e.repsOrSecDone });
  });
  return { exerciseLog: cappedLog, capped: true };
}

/**
 * Records one completed run of a custom workout. The (future) Workout Player
 * calls this when the user finishes the last set.
 */
function recordCustomWorkoutSession(session) {
  const list = loadCustomWorkoutSessions();
  const totalDurationSec = session.totalDurationSec || 0;
  const quality = applyWorkoutQualityCap(session.exerciseLog, totalDurationSec);
  const clean = {
    id: 'wsession_' + Date.now(),
    workoutId: session.workoutId,
    workoutName: session.workoutName || '',
    completedAt: Date.now(),
    totalDurationSec,
    setsCompleted: session.setsCompleted || 0,
    // e.g. [{ name:'Push-up', exIndex:0, setNumber:1, repsOrSecDone:15, type:'reps' }, ...]
    exerciseLog: quality.exerciseLog,
    qualityCapped: quality.capped, // see applyWorkoutQualityCap() above (Phase 2E)
    restSkipBonusXP: session.restSkipBonusXP > 0 ? session.restSkipBonusXP : 0,
    isPR: !!session.isPR,
    rpe: null,
    feeling: null,
    note: ''
  };
  list.push(clean);
  saveCustomWorkoutSessions(list);
  return clean;
}

function deleteCustomWorkoutSession(id) {
  saveCustomWorkoutSessions(loadCustomWorkoutSessions().filter(s => s.id !== id));
}

/* ================= CUSTOM WORKOUT — BUILDER (PHASE 2) ================= */
/* UI only: create / edit / delete a CustomWorkout "recipe". No player yet
   (that's phase 3) — saving here just persists the recipe via saveCustomWorkout(). */

/* ---- list screen ---- */
function renderCustomList() {
  const wrap = document.getElementById('customWorkoutList');
  if (!wrap) return;
  const list = loadCustomWorkouts().slice().sort((a, b) => b.updatedAt - a.updatedAt);
  if (!list.length) {
    wrap.innerHTML = '<div class="empty-hint">ยังไม่มี Custom Workout — กดปุ่มด้านล่างเพื่อสร้างอันแรก</div>';
    return;
  }
  wrap.innerHTML = list.map(w => {
    const exCount = w.exercises.length;
    const totalSets = w.exercises.reduce((sum, ex) => sum + (ex.sets || 1), 0);
    const detail = exCount + ' ท่า · ' + totalSets + ' เซ็ตรวม';
    return `<div class="history-item protocol-item">
      <div onclick="openCustomEditor('${w.id}')" style="flex:1;min-width:0;cursor:pointer;">
        <div class="date">${escapeHtml(w.name)}</div>
        <div class="reps">${detail}</div>
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="iconbtn" style="width:32px;height:32px;color:var(--success);" onclick="event.stopPropagation();startCustomWorkoutPlayer('${w.id}')" aria-label="Play">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>
        </button>
        <button class="iconbtn" style="width:32px;height:32px;" onclick="event.stopPropagation();duplicateCustomWorkout('${w.id}')" aria-label="Duplicate">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>
        </button>
        <button class="iconbtn" style="width:32px;height:32px;" onclick="event.stopPropagation();openCustomEditor('${w.id}')" aria-label="Edit">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>
        </button>
        <button class="iconbtn" style="width:32px;height:32px;color:var(--danger);" onclick="event.stopPropagation();confirmDeleteCustomWorkout('${w.id}')" aria-label="Delete">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0l-1 14a2 2 0 01-2 2H7a2 2 0 01-2-2L4 6"/></svg>
        </button>
      </div>
    </div>`;
  }).join('');
}

/* ---- cardio preset list screen (read-only, no localStorage) ---- */
function renderCardioList() {
  const wrap = document.getElementById('cardioPresetList');
  if (!wrap) return;
  wrap.innerHTML = CARDIO_PRESETS.map(p => {
    const exCount = p.exercises.length;
    const totalSets = p.exercises.reduce((sum, ex) => sum + (ex.sets || 1), 0);
    const detail = exCount + ' ท่า · ' + totalSets + ' เซ็ตรวม';
    return `<div class="history-item protocol-item">
      <div style="flex:1;min-width:0;">
        <div class="date">${escapeHtml(p.name)}</div>
        <div class="reps">${detail}</div>
      </div>
      <button class="iconbtn" style="width:32px;height:32px;color:var(--success);flex-shrink:0;" onclick="startCardioPreset('${p.id}')" aria-label="Play">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M8 5v14l11-7z"/></svg>
      </button>
    </div>`;
  }).join('');
}

/**
 * Clones an existing workout recipe as a brand-new one (fresh id, "(Copy)"
 * suffix, same exercises/sets/rest). Handy for making a variation of a
 * workout you already like without rebuilding it from scratch.
 */
function duplicateCustomWorkout(id) {
  const original = getCustomWorkout(id);
  if (!original) return;
  saveCustomWorkout({
    id: null,
    name: original.name + ' (Copy)',
    warmupEnabled: !!original.warmupEnabled,
    exercises: original.exercises.map(ex => Object.assign({}, ex))
  });
  renderCustomList();
  showToast('คัดลอก Workout แล้ว');
}
function confirmDeleteCustomWorkout(id) {
  // reuses the existing generic confirm pattern via native confirm-free flow:
  // simple two-step using showToast would be too easy to mis-tap, so we
  // borrow the deleteSessionModal-style pattern with a dedicated handler.
  pendingDeleteCustomWorkoutId = id;
  document.getElementById('customDeleteModal').classList.add('active');
}
let pendingDeleteCustomWorkoutId = null;
function deleteCustomWorkoutExecute() {
  if (pendingDeleteCustomWorkoutId) {
    deleteCustomWorkout(pendingDeleteCustomWorkoutId);
    pendingDeleteCustomWorkoutId = null;
  }
  closeModal('customDeleteModal');
  renderCustomList();
  showToast('ลบ Workout แล้ว');
}

/* ---- editor screen (create / edit) ---- */
let customEditorDraft = null;

function blankCustomWorkoutDraft() {
  return {
    id: null,
    name: '',
    warmupEnabled: false,
    exercises: [makeCustomExercise({ name: '' })]
  };
}
function openCustomEditor(id) {
  const existing = id ? getCustomWorkout(id) : null;
  customEditorDraft = existing
    ? { id: existing.id, name: existing.name, warmupEnabled: !!existing.warmupEnabled, exercises: existing.exercises.map(ex => Object.assign({}, ex)) }
    : blankCustomWorkoutDraft();

  document.getElementById('customEditorTitle').textContent = existing ? 'แก้ไข WORKOUT' : 'สร้าง WORKOUT';
  document.getElementById('customNameInput').value = customEditorDraft.name;
  const warmupToggle = document.getElementById('customWarmupToggle');
  if (warmupToggle) warmupToggle.checked = customEditorDraft.warmupEnabled;
  renderCustomExerciseList();
  go('customeditor');
}
function cancelCustomEditor() {
  customEditorDraft = null;
  go('customlist');
}

function updateCustomHeaderField(field, value) {
  if (!customEditorDraft) return;
  if (field === 'name') customEditorDraft[field] = value;
  else if (field === 'warmupEnabled') customEditorDraft[field] = !!value;
  else customEditorDraft[field] = parseInt(value, 10) || 0;
}

function renderCustomExerciseList() {
  const wrap = document.getElementById('customExerciseList');
  if (!wrap || !customEditorDraft) return;
  const exercises = customEditorDraft.exercises;
  if (!exercises.length) {
    wrap.innerHTML = '<div class="empty-hint">ยังไม่มีท่า — กด "+ เพิ่มท่า" ด้านล่าง</div>';
    return;
  }
  wrap.innerHTML = exercises.map((ex, i) => {
    const isReps = ex.type !== 'time';
    return `<div class="exercise-card">
      <div class="exercise-card-top">
        <div class="exercise-num">${i + 1}</div>
        <input type="text" class="exercise-name-input" placeholder="ชื่อท่า เช่น Push-up" value="${escapeHtml(ex.name)}"
          oninput="updateCustomExerciseField(${i}, 'name', this.value)">
        <button class="iconbtn" onclick="moveCustomExercise(${i}, -1)" aria-label="Move up" ${i === 0 ? 'style="opacity:.3;pointer-events:none;"' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M18 15l-6-6-6 6"/></svg>
        </button>
        <button class="iconbtn" onclick="moveCustomExercise(${i}, 1)" aria-label="Move down" ${i === exercises.length - 1 ? 'style="opacity:.3;pointer-events:none;"' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M6 9l6 6 6-6"/></svg>
        </button>
        <button class="iconbtn" style="color:var(--danger);" onclick="removeCustomExercise(${i})" aria-label="Remove">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6L6 18M6 6l12 12"/></svg>
        </button>
      </div>
      <div class="period-row" style="margin:0 0 10px;">
        <div class="period-pill${isReps ? ' sel' : ''}" onclick="setCustomExerciseType(${i}, 'reps')">REPS</div>
        <div class="period-pill${isReps ? '' : ' sel'}" onclick="setCustomExerciseType(${i}, 'time')">TIME</div>
      </div>
      ${isReps
        ? `<div class="field-row"><label>จำนวนครั้ง/เซ็ต</label><input type="number" min="1" max="999" value="${ex.reps}" oninput="updateCustomExerciseField(${i}, 'reps', this.value)"></div>`
        : `<div class="field-row"><label>ระยะเวลา/เซ็ต (วินาที)</label><input type="number" min="1" max="3600" value="${ex.durationSec}" oninput="updateCustomExerciseField(${i}, 'durationSec', this.value)"></div>`
      }
      <div class="field-row"><label>จำนวนเซ็ต</label><input type="number" min="1" max="20" value="${ex.sets}" oninput="updateCustomExerciseField(${i}, 'sets', this.value)"></div>
      ${ex.sets > 1 ? `<div class="field-row"><label>พักระหว่างเซ็ต (วินาที)</label><input type="number" min="0" max="600" value="${ex.restBetweenSetsSec}" oninput="updateCustomExerciseField(${i}, 'restBetweenSetsSec', this.value)"></div>` : ''}
      ${i < exercises.length - 1 ? `<div class="field-row" style="grid-template-columns:1fr auto;align-items:center;"><label>รวมเป็น Superset กับท่าถัดไป (ไม่พักคั่น)</label><input type="checkbox" style="width:20px;height:20px;" ${ex.supersetWithNext ? 'checked' : ''} onchange="updateCustomExerciseField(${i}, 'supersetWithNext', this.checked)"></div>` : ''}
      ${ex.supersetWithNext
        ? `<div class="empty-hint" style="text-align:left;padding:2px 0 6px;">Superset: ไปท่าถัดไปทันทีไม่มีพักคั่น</div>`
        : `<div class="field-row"><label>พักก่อนไปท่าถัดไป (วินาที)</label><input type="number" min="0" max="600" value="${ex.restAfterSec}" oninput="updateCustomExerciseField(${i}, 'restAfterSec', this.value)"></div>`
      }
      <div class="field-row"><label>น้ำหนักที่ใช้ (กก. — ถ้ามี)</label><input type="number" min="0" max="500" step="0.5" value="${ex.weight || 0}" oninput="updateCustomExerciseField(${i}, 'weight', this.value)"></div>
      <div class="field-row"><label>หมวด (นับเข้า Stat ไหน)</label>
        <select class="time-input" onchange="updateCustomExerciseField(${i}, 'category', this.value)">
          ${EXERCISE_CATEGORIES.filter(c => c.id !== 'all').map(c =>
            `<option value="${c.id}"${(ex.category || 'core') === c.id ? ' selected' : ''}>${c.label}</option>`
          ).join('')}
        </select>
      </div>
    </div>`;
  }).join('');
}

function addCustomExercise() {
  if (!customEditorDraft) return;
  customEditorDraft.exercises.push(makeCustomExercise({ name: '' }));
  renderCustomExerciseList();
}

/* ---- exercise library picker (phase 5a) ---- */
let libraryActiveCategory = 'all';
let libraryQuery = '';
function openExerciseLibrary() {
  if (!customEditorDraft) return;
  libraryActiveCategory = 'all';
  libraryQuery = '';
  const searchInput = document.getElementById('librarySearchInput');
  if (searchInput) searchInput.value = '';
  renderLibraryCategoryRow();
  renderLibraryList();
  document.getElementById('exerciseLibraryModal').classList.add('active');
}
function onLibrarySearchInput(value) {
  libraryQuery = value;
  renderLibraryList();
}
function renderLibraryCategoryRow() {
  const wrap = document.getElementById('libraryCategoryRow');
  if (!wrap) return;
  wrap.innerHTML = EXERCISE_CATEGORIES.map(c =>
    `<div class="period-pill${c.id === libraryActiveCategory ? ' sel' : ''}" onclick="setLibraryCategory('${c.id}')">${c.label}</div>`
  ).join('');
}
function setLibraryCategory(id) {
  libraryActiveCategory = id;
  renderLibraryCategoryRow();
  renderLibraryList();
}
function renderLibraryList() {
  const wrap = document.getElementById('libraryList');
  if (!wrap) return;
  let items = libraryActiveCategory === 'all'
    ? EXERCISE_LIBRARY
    : EXERCISE_LIBRARY.filter(e => e.category === libraryActiveCategory);
  const q = (libraryQuery || '').trim().toLowerCase();
  if (q) items = items.filter(e => e.name.toLowerCase().includes(q));
  if (!items.length) {
    wrap.innerHTML = '<div class="empty-hint">ไม่พบท่าที่ค้นหา</div>';
    return;
  }
  wrap.innerHTML = items.map((ex, i) => {
    const idx = EXERCISE_LIBRARY.indexOf(ex);
    const equip = EQUIPMENT_LABEL[ex.equipment];
    const spec = ex.type === 'time' ? ex.durationSec + ' วิ' : ex.reps + ' ครั้ง';
    return `<div class="history-item protocol-item" onclick="selectLibraryExercise(${idx})">
      <div>
        <div class="date">${escapeHtml(ex.name)}</div>
        <div class="reps">${spec}${equip ? ' · ' + equip : ''}</div>
      </div>
    </div>`;
  }).join('');
}
function selectLibraryExercise(libIdx) {
  if (!customEditorDraft) return;
  const preset = EXERCISE_LIBRARY[libIdx];
  if (!preset) return;
  customEditorDraft.exercises.push(makeCustomExercise({
    name: preset.name,
    type: preset.type,
    reps: preset.reps || 10,
    durationSec: preset.durationSec || 30,
    restAfterSec: preset.restAfterSec != null ? preset.restAfterSec : 15,
    category: preset.category || 'core'
  }));
  closeModal('exerciseLibraryModal');
  renderCustomExerciseList();
}
function removeCustomExercise(idx) {
  if (!customEditorDraft) return;
  customEditorDraft.exercises.splice(idx, 1);
  renderCustomExerciseList();
}
function moveCustomExercise(idx, dir) {
  if (!customEditorDraft) return;
  const list = customEditorDraft.exercises;
  const target = idx + dir;
  if (target < 0 || target >= list.length) return;
  [list[idx], list[target]] = [list[target], list[idx]];
  renderCustomExerciseList();
}
function setCustomExerciseType(idx, type) {
  if (!customEditorDraft) return;
  customEditorDraft.exercises[idx].type = type;
  renderCustomExerciseList();
}
function updateCustomExerciseField(idx, field, value) {
  if (!customEditorDraft) return;
  if (field === 'name') {
    customEditorDraft.exercises[idx][field] = value;
  } else if (field === 'category') {
    customEditorDraft.exercises[idx][field] = STAT_DEFS.some(d => d.key === value) ? value : 'core';
  } else if (field === 'weight') {
    customEditorDraft.exercises[idx][field] = Math.max(0, parseFloat(value) || 0);
  } else if (field === 'supersetWithNext') {
    customEditorDraft.exercises[idx][field] = !!value;
  } else if (field === 'restBetweenSetsSec' || field === 'restAfterSec') {
    // Clamp to the 0-600s range the input's own max="600" already claims —
    // that attribute is a UI hint only and isn't enforced by the browser
    // against every input path, so it must also be enforced here. See the
    // note on REST_SKIP_BONUS_MAX_SEC for why an unbounded rest value here
    // used to be exploitable for free XP.
    customEditorDraft.exercises[idx][field] = Math.min(600, Math.max(0, parseInt(value, 10) || 0));
  } else {
    customEditorDraft.exercises[idx][field] = parseInt(value, 10) || 0;
  }
  if (field === 'sets' || field === 'supersetWithNext') renderCustomExerciseList(); // toggles conditional fields' visibility
}

function saveCustomEditorForm() {
  if (!customEditorDraft) return;
  if (!customEditorDraft.name.trim()) { showToast('กรุณาตั้งชื่อ Workout'); return; }
  if (!customEditorDraft.exercises.length) { showToast('เพิ่มอย่างน้อย 1 ท่า'); return; }
  const emptyName = customEditorDraft.exercises.some(ex => !ex.name.trim());
  if (emptyName) { showToast('ยังมีท่าที่ไม่ได้ตั้งชื่อ'); return; }

  saveCustomWorkout(customEditorDraft);
  customEditorDraft = null;
  showToast('บันทึก Workout แล้ว');
  go('customlist');
}

/* ================= CUSTOM WORKOUT — PLAYER (PHASE 3) ================= */
/* Plays a CustomWorkout recipe in order: exercise -> (rest after exercise) ->
   next exercise -> ... -> (rest between sets) -> next set -> ... -> done.
   Reps-mode exercises are marked done manually; time-mode exercises count
   down automatically. Uses the same beep/vibrate/wakeLock helpers as Cindy's
   player, but is otherwise fully independent — nothing here touches
   KEY_SESSIONS / KEY_ACTIVE, and completed runs are saved via
   recordCustomWorkoutSession() into KEY_CUSTOM_SESSIONS only. */

let customPlayer = null;

/* Fixed general warm-up moves offered before any Custom Workout that has
   warmupEnabled on. Purely a visual checklist — checking items off is just
   a ritual for the person, nothing here is logged or timed. */
const WARMUP_LIBRARY = [
  'หมุนแขน หมุนไหล่ 20 วินาที',
  'Jumping Jack 20 ครั้ง',
  'Bodyweight Squat 10 ครั้ง',
  'Arm Swing / Leg Swing ข้างละ 10 ครั้ง',
  'High Knees 20 วินาที'
];
let warmupPendingWorkoutId = null;

/**
 * Starts a built-in Cardio preset. Reads straight from CARDIO_PRESETS (never
 * touches localStorage) and hands the preset object to
 * beginCustomWorkoutPlayerReal() exactly as startCustomWorkoutPlayer() does
 * for a saved Custom Workout — same player, warm-up and complete-screen flow,
 * with zero new code in any of those.
 */
function startCardioPreset(id) {
  const preset = CARDIO_PRESETS.find(p => p.id === id);
  if (!preset) return;
  beginCustomWorkoutPlayerReal(preset);
}

function startCustomWorkoutPlayer(id) {
  const workout = getCustomWorkout(id);
  if (!workout || !workout.exercises.length) { showToast('Workout นี้ยังไม่มีท่า'); return; }
  if (workout.warmupEnabled) {
    warmupPendingWorkoutId = id;
    renderCustomWarmup();
    go('customwarmup');
    return;
  }
  beginCustomWorkoutPlayerReal(workout);
}

function renderCustomWarmup() {
  const wrap = document.getElementById('customWarmupList');
  if (!wrap) return;
  wrap.innerHTML = WARMUP_LIBRARY.map(item => `
    <label class="history-item" style="cursor:pointer;">
      <div><div class="date">${escapeHtml(item)}</div></div>
      <input type="checkbox" style="width:22px;height:22px;flex-shrink:0;">
    </label>`).join('');
}

function proceedFromCustomWarmup() {
  const workout = getCustomWorkout(warmupPendingWorkoutId);
  warmupPendingWorkoutId = null;
  if (workout) beginCustomWorkoutPlayerReal(workout);
  else go('customlist');
}

function beginCustomWorkoutPlayerReal(workout) {
  customPlayer = {
    workout,
    exIndex: 0,
    setIndex: 0,                 // set index WITHIN the current exercise
    phase: 'exercise',           // 'exercise' | 'restSet' | 'restEx'
    startedAt: Date.now(),
    exerciseLog: [],
    restSkipBonusXP: 0,
    currentValue: 0,
    timer: { endTime: null, totalMs: 0, running: false, paused: false, remainingMs: 0, handle: null, onDone: null }
  };
  unlockAudio();
  acquireWakeLock();
  go('customplayer');
  const voiceBtn = document.getElementById('playerVoiceBtn');
  if (voiceBtn) voiceBtn.classList.toggle('sel', isVoiceCuesEnabled());
  applyCompanionHudSkin();
  beginCustomPlayerPhase();
}

function currentCustomExercise() {
  return customPlayer.workout.exercises[customPlayer.exIndex];
}
function isLastSetOfCurrentExercise() {
  return customPlayer.setIndex >= currentCustomExercise().sets - 1;
}
function isLastCustomExercise() {
  return customPlayer.exIndex >= customPlayer.workout.exercises.length - 1;
}

function clearCustomPlayerTimer() {
  if (!customPlayer) return;
  if (customPlayer.timer.handle) { clearInterval(customPlayer.timer.handle); customPlayer.timer.handle = null; }
  customPlayer.timer.running = false;
  customPlayer.timer.paused = false;
}
function startCustomPlayerCountdown(totalSec, onDone) {
  customPlayer.timer.totalMs = totalSec * 1000;
  customPlayer.timer.endTime = Date.now() + totalSec * 1000;
  customPlayer.timer.running = true;
  customPlayer.timer.paused = false;
  customPlayer.timer.onDone = onDone;
  customPlayer.timer.handle = setInterval(tickCustomPlayerTimer, 250);
}
/**
 * Pauses or resumes the currently running countdown (time-mode exercise or
 * any rest period). While paused, the interval is stopped entirely so the
 * displayed time freezes exactly where it was — resuming shifts endTime
 * forward by the remaining duration so nothing is lost or double-counted.
 */
function togglePlayerPause() {
  if (!customPlayer) return;
  const t = customPlayer.timer;
  if (t.paused) {
    t.endTime = Date.now() + t.remainingMs;
    t.paused = false;
    t.running = true;
    t.handle = setInterval(tickCustomPlayerTimer, 250);
  } else {
    if (!t.running) return; // nothing to pause (e.g. reps-mode exercise)
    t.remainingMs = Math.max(0, t.endTime - Date.now());
    if (t.handle) { clearInterval(t.handle); t.handle = null; }
    t.running = false;
    t.paused = true;
  }
  renderCustomPlayer();
}
function tickCustomPlayerTimer() {
  if (!customPlayer || !customPlayer.timer.running) return;
  const remaining = customPlayer.timer.endTime - Date.now();
  if (remaining <= 0) {
    clearCustomPlayerTimer();
    vibrate([120, 80, 120]);
    beep(880, 150, 0.18);
    const onDone = customPlayer.timer.onDone;
    renderCustomPlayer();
    if (onDone) onDone();
    return;
  }
  renderCustomPlayer();
}

function beginCustomPlayerPhase() {
  clearCustomPlayerTimer();
  if (customPlayer.phase === 'exercise') {
    const ex = currentCustomExercise();
    speak(ex.name + (ex.sets > 1 ? ' เซ็ต ' + (customPlayer.setIndex + 1) : ''));
    if (ex.type === 'time') {
      customPlayer.currentValue = ex.durationSec;
      startCustomPlayerCountdown(ex.durationSec, onCustomExerciseTimeUp);
    } else {
      customPlayer.currentValue = ex.reps;
    }
  } else {
    const exNow = currentCustomExercise();
    const restSec = customPlayer.phase === 'restSet' ? exNow.restBetweenSetsSec : exNow.restAfterSec;
    if (customPlayer.phase === 'restSet') {
      speak('พักระหว่างเซ็ต');
    } else {
      const next = customPlayer.workout.exercises[customPlayer.exIndex + 1];
      speak('พักก่อนไปท่าถัดไป' + (next ? ': ' + next.name : ''));
    }
    if (restSec > 0) {
      startCustomPlayerCountdown(restSec, onCustomRestDone);
    } else {
      onCustomRestDone();
      return;
    }
  }
  renderCustomPlayer();
}

function logCurrentCustomExercise(value) {
  const ex = currentCustomExercise();
  customPlayer.exerciseLog.push({ name: ex.name, exIndex: customPlayer.exIndex, setNumber: customPlayer.setIndex + 1, repsOrSecDone: value, type: ex.type || 'reps', weight: ex.weight || 0, category: exerciseCategoryOrGuess(ex) });
}

function onCustomExerciseTimeUp() {
  logCurrentCustomExercise(currentCustomExercise().durationSec);
  advanceAfterCustomExercise();
}
function confirmPlayerExerciseDone() {
  if (!customPlayer || customPlayer.phase !== 'exercise') return;
  logCurrentCustomExercise(customPlayer.currentValue);
  advanceAfterCustomExercise();
}
function skipPlayerStep() {
  if (!customPlayer) return;
  const t = customPlayer.timer;
  const remainingMs = t.paused ? t.remainingMs : Math.max(0, t.endTime - Date.now());
  if (customPlayer.phase === 'exercise' && currentCustomExercise().type === 'time') {
    const elapsedSec = Math.max(0, currentCustomExercise().durationSec - Math.round(remainingMs / 1000));
    clearCustomPlayerTimer();
    logCurrentCustomExercise(elapsedSec);
    advanceAfterCustomExercise();
  } else if (customPlayer.phase === 'restSet' || customPlayer.phase === 'restEx') {
    const remainingSec = Math.round(remainingMs / 1000);
    const bonus = restSkipBonusXP(remainingSec);
    clearCustomPlayerTimer();
    if (bonus > 0) {
      customPlayer.restSkipBonusXP += bonus;
      addRestSkipBonusXP(bonus);
      showToast('พักน้อยลง ร่างกายแบกรับมากขึ้น +' + bonus + ' XP', 'muscle');
      showRestSkipBonusEffect(bonus);
      vibrate(15);
    }
    onCustomRestDone();
  }
}
function adjustPlayerReps(delta) {
  if (!customPlayer || customPlayer.phase !== 'exercise') return;
  customPlayer.currentValue = Math.max(0, customPlayer.currentValue + delta);
  renderCustomPlayer();
}

/* One "set" of the current exercise just finished. Decide what's next:
   another set of the SAME exercise (with restBetweenSetsSec in between),
   or — once its last set is done — restAfterSec before moving on to the
   next exercise (skipped entirely for a superset pair), or the end of the
   workout if this was the last exercise. */
function advanceAfterCustomExercise() {
  if (!isLastSetOfCurrentExercise()) {
    if (currentCustomExercise().restBetweenSetsSec > 0) {
      customPlayer.phase = 'restSet';
      beginCustomPlayerPhase();
    } else {
      advanceToNextSetSameExercise();
    }
  } else if (isLastCustomExercise()) {
    finishCustomPlayerWorkout();
  } else if (currentCustomExercise().supersetWithNext) {
    advanceToNextCustomExercise();
  } else if (currentCustomExercise().restAfterSec > 0) {
    customPlayer.phase = 'restEx';
    beginCustomPlayerPhase();
  } else {
    advanceToNextCustomExercise();
  }
}
function advanceToNextSetSameExercise() {
  customPlayer.setIndex++;
  customPlayer.phase = 'exercise';
  beginCustomPlayerPhase();
}
function advanceToNextCustomExercise() {
  customPlayer.exIndex++;
  customPlayer.setIndex = 0;
  customPlayer.phase = 'exercise';
  beginCustomPlayerPhase();
}
function onCustomRestDone() {
  if (customPlayer.phase === 'restSet') advanceToNextSetSameExercise();
  else advanceToNextCustomExercise();
}

function finishCustomPlayerWorkout() {
  clearCustomPlayerTimer();
  releaseWakeLock();
  const totalDurationSec = Math.round((Date.now() - customPlayer.startedAt) / 1000);
  const workout = customPlayer.workout;

  const priorSessions = loadCustomWorkoutSessions().filter(s => s.workoutId === workout.id);
  const prevBestSec = priorSessions.reduce((m, s) => Math.min(m, s.totalDurationSec), Infinity);
  const isNewPR = priorSessions.length > 0 && totalDurationSec < prevBestSec;

  const session = recordCustomWorkoutSession({
    workoutId: workout.id,
    workoutName: workout.name,
    totalDurationSec,
    setsCompleted: customPlayer.exerciseLog.length,
    exerciseLog: customPlayer.exerciseLog,
    restSkipBonusXP: customPlayer.restSkipBonusXP || 0,
    isPR: isNewPR
  });

  vibrate([100, 60, 100, 60, 200]);
  beep(660, 200, 0.2);
  customPlayer = null;
  lastCompletedCustomSessionId = session.id;
  // Phase 2E: quiet, non-accusatory heads-up — the number itself was already
  // adjusted in recordCustomWorkoutSession(); this just tells the player why
  // what they see doesn't match what they typed, instead of staying silent.
  if (session.qualityCapped) {
    showToast('เวลาที่ใช้ไม่พอกับจำนวนครั้งที่กด ระบบเลยปรับยอดให้ตรงกับเวลาจริง', 'target');
  }
  go('bossbattle');
  startBossBattleCutscene(session, true, () => {
    renderCustomCompleteScreen(session);
    go('customcomplete');
  });
}

function openCustomPlayerEndModal() {
  document.getElementById('customPlayerEndModal').classList.add('active');
}
function discardCustomPlayerWorkout() {
  clearCustomPlayerTimer();
  releaseWakeLock();
  customPlayer = null;
  closeModal('customPlayerEndModal');
  go('customlist');
}

function renderCustomPlayer() {
  if (!customPlayer) return;
  const w = customPlayer.workout;
  const ex = currentCustomExercise();
  const nameEl = document.getElementById('playerExerciseName');

  document.getElementById('playerStatusPill').textContent = 'เซ็ต ' + (customPlayer.setIndex + 1) + '/' + ex.sets;
  document.getElementById('playerWorkoutName').textContent = w.name;
  document.getElementById('playerProgress').textContent = 'ท่า ' + (customPlayer.exIndex + 1) + '/' + w.exercises.length;

  let digitsText, ringFrac, phaseLabel, showDone = false, showSkip = false, showAdjust = false;

  if (customPlayer.phase === 'exercise') {
    nameEl.style.display = 'block';
    nameEl.textContent = ex.name;
    if (ex.type === 'time') {
      const remainingSec = customPlayer.timer.endTime ? Math.max(0, (customPlayer.timer.endTime - Date.now()) / 1000) : ex.durationSec;
      digitsText = fmtTime(remainingSec);
      ringFrac = customPlayer.timer.totalMs ? (remainingSec * 1000) / customPlayer.timer.totalMs : 1;
      phaseLabel = 'ทำท่านี้';
      showSkip = true;
    } else {
      digitsText = String(customPlayer.currentValue);
      ringFrac = 1;
      phaseLabel = 'ทำครบแล้วกด "เสร็จแล้ว"';
      showDone = true;
      showAdjust = true;
    }
  } else {
    nameEl.style.display = 'none';
    const remainingSec = customPlayer.timer.endTime ? Math.max(0, (customPlayer.timer.endTime - Date.now()) / 1000) : 0;
    digitsText = fmtTime(remainingSec);
    ringFrac = customPlayer.timer.totalMs ? (remainingSec * 1000) / customPlayer.timer.totalMs : 1;
    phaseLabel = customPlayer.phase === 'restSet' ? 'พักก่อนเซ็ตถัดไป' : 'พักก่อนท่าถัดไป';
    showSkip = true;
  }

  document.getElementById('playerDigits').textContent = digitsText;
  document.getElementById('playerPhaseLabel').textContent = phaseLabel;
  const ring = document.getElementById('playerRing');
  if (ring) ring.style.strokeDashoffset = String(RING_CIRC * (1 - ringFrac));
  document.getElementById('playerDoneBtn').style.display = showDone ? 'flex' : 'none';
  document.getElementById('playerSkipBtn').style.display = showSkip ? 'flex' : 'none';
  document.getElementById('playerRepsAdjustRow').style.display = showAdjust ? 'grid' : 'none';

  const pauseBtn = document.getElementById('playerPauseBtn');
  if (pauseBtn) {
    pauseBtn.style.display = showSkip ? 'flex' : 'none';
    pauseBtn.innerHTML = customPlayer.timer.paused ? (iconHtml('play') + ' เล่นต่อ') : (iconHtml('pause') + ' หยุดชั่วคราว');
  }
}

/* ================= CUSTOM WORKOUT — POST-WORKOUT SUMMARY ================= */
/* Mirrors Cindy's own renderCompleteScreen()/finishCompleteFlow() as closely
   as the different data shape allows: same hero/PR-badge/metric-grid/
   breakdown layout, same RPE + FEELING + NOTE capture flow. Writes into
   KEY_CUSTOM_SESSIONS only — never touches Cindy's KEY_SESSIONS. */

function renderCustomCompleteScreen(session) {
  document.getElementById('customCompleteSets').textContent = session.setsCompleted;
  document.getElementById('customCompleteName').textContent = session.workoutName || 'Untitled Workout';
  document.getElementById('cCustomTotalTime').textContent = fmtTime(session.totalDurationSec);
  document.getElementById('cCustomSets').textContent = session.setsCompleted;

  const prBadge = document.getElementById('customPrBadge');
  const completeHero = prBadge.closest('.complete-hero');
  completeHero.classList.remove('pr-burst');
  if (session.isPR) {
    prBadge.textContent = 'NEW PR';
    prBadge.className = 'pr-badge new';
    void completeHero.offsetWidth;
    completeHero.classList.add('pr-burst');
    vibrate([40, 30, 40, 30, 80]);
  } else {
    prBadge.textContent = 'PR —';
    prBadge.className = 'pr-badge no';
  }

  document.getElementById('customBreakdown').innerHTML = buildCustomExerciseBreakdownHtml(session.exerciseLog || []);

  const bonusRow = document.getElementById('customRestBonusRow');
  if (bonusRow) {
    if (session.restSkipBonusXP > 0) {
      bonusRow.style.display = 'flex';
      document.getElementById('cCustomRestBonus').textContent = '+' + session.restSkipBonusXP + ' XP';
    } else {
      bonusRow.style.display = 'none';
    }
  }

  pendingCustomFeedback = { rpe: null, feeling: null };
  document.getElementById('customNoteInput').value = '';
  const rpeRow = document.getElementById('customRpeRow');
  rpeRow.innerHTML = '';
  for (let i = 1; i <= 10; i++) {
    const el = document.createElement('div');
    el.className = 'rpe-pill';
    el.textContent = i;
    el.onclick = () => selectCustomRPE(i, el);
    rpeRow.appendChild(el);
  }
  document.querySelectorAll('#customFeelingRow .feeling-pill').forEach(p => p.classList.remove('sel'));
}

/* Sums each unique exercise's total reps/seconds across all its sets — the
   custom-workout analog of Cindy's fixed PULL/PUSH/SQUAT breakdown rows. */
function buildCustomExerciseBreakdownHtml(exerciseLog) {
  const totals = {};
  const order = [];
  exerciseLog.forEach(entry => {
    if (!(entry.name in totals)) { totals[entry.name] = { value: 0, entered: 0, type: entry.type, weight: entry.weight || 0 }; order.push(entry.name); }
    totals[entry.name].value += entry.repsOrSecDone;
    // enteredValue only exists on entries the Phase 2E quality cap touched
    // (see applyWorkoutQualityCap) — sum the pre-cap number too so the row
    // can show what was typed vs. what actually counted.
    totals[entry.name].entered += (entry.enteredValue != null ? entry.enteredValue : entry.repsOrSecDone);
  });
  if (!order.length) return '<div class="empty-hint">ไม่มีข้อมูลท่าออกกำลังกาย</div>';
  return order.map(name => {
    const t = totals[name];
    const unit = t.type === 'time' ? 'วินาที' : 'ครั้ง';
    const weightTag = t.weight > 0 ? ' · ' + t.weight + ' กก.' : '';
    const enteredTag = t.entered > t.value
      ? ' <span style="font-size:11px;color:var(--text-faint);text-decoration:line-through;">' + t.entered + '</span>'
      : '';
    return `<div class="breakdown-row"><span class="breakdown-name">${escapeHtml(name)}${weightTag}</span><span class="breakdown-val">${t.value}${enteredTag} <span style="font-size:11px;color:var(--text-faint);">${unit}</span></span></div>`;
  }).join('');
}

function selectCustomRPE(val, el) {
  pendingCustomFeedback.rpe = val;
  document.querySelectorAll('#customRpeRow .rpe-pill').forEach(p => p.classList.remove('sel'));
  el.classList.add('sel');
}
function selectCustomFeeling(val) {
  pendingCustomFeedback.feeling = val;
  document.querySelectorAll('#customFeelingRow .feeling-pill').forEach(p => p.classList.toggle('sel', p.dataset.f === val));
}
function finishCustomCompleteFlow() {
  const sessions = loadCustomWorkoutSessions();
  const idx = sessions.findIndex(s => s.id === lastCompletedCustomSessionId);
  if (idx !== -1) {
    sessions[idx].rpe = pendingCustomFeedback.rpe;
    sessions[idx].feeling = pendingCustomFeedback.feeling;
    sessions[idx].note = document.getElementById('customNoteInput').value.trim();
    saveCustomWorkoutSessions(sessions);
  }
  showToast('บันทึก WORKOUT แล้ว', 'muscle');
  go('customlist');
}

/* ================= CUSTOM WORKOUT — HISTORY / REPORT (PHASE 4) ================= */
/* Read-only reporting on top of KEY_CUSTOM_SESSIONS. Fully separate screen from
   Cindy's HISTORY tab/filter — never reads KEY_SESSIONS, never touches Cindy's
   currentDetailId. Detail layout intentionally mirrors Cindy's own
   openDetail(): hero + PR badge, 4-card metric grid, exercise breakdown,
   per-set breakdown table, note, edit/delete. */

let currentCustomHistoryDetailId = null;

/* ---- per-workout progress chart ---- */
function totalVolumeOfCustomSession(s) {
  return (s.exerciseLog || []).reduce((sum, e) => sum + (e.repsOrSecDone || 0), 0);
}
function renderCustomProgress(workoutId) {
  const allSessions = loadCustomWorkoutSessions();
  const workouts = loadCustomWorkouts();
  const ids = [...new Set(allSessions.map(s => s.workoutId))];
  const select = document.getElementById('customProgressWorkoutSelect');
  if (select) {
    if (!ids.length) {
      select.innerHTML = '<option value="">— ยังไม่มีข้อมูล —</option>';
    } else {
      select.innerHTML = ids.map(id => {
        const w = workouts.find(x => x.id === id);
        const name = w ? w.name : ((allSessions.find(s => s.workoutId === id) || {}).workoutName || 'Untitled Workout');
        return `<option value="${id}">${escapeHtml(name)}</option>`;
      }).join('');
    }
  }
  if (!workoutId) workoutId = ids[ids.length - 1];
  if (select && workoutId) select.value = workoutId;

  const chart = document.getElementById('customChartBars');
  const bestEl = document.getElementById('cProgBest');
  const sessEl = document.getElementById('cProgSessions');
  const sessions = allSessions.filter(s => s.workoutId === workoutId).sort((a, b) => a.completedAt - b.completedAt);
  if (!sessions.length) {
    chart.innerHTML = '<div class="empty-hint" style="width:100%;">ยังไม่มีข้อมูล Workout นี้</div>';
    bestEl.textContent = '—';
    sessEl.textContent = '0';
    return;
  }
  const vols = sessions.map(totalVolumeOfCustomSession);
  bestEl.textContent = Math.max(...vols).toLocaleString();
  sessEl.textContent = sessions.length;

  const maxVal = Math.max(1, ...vols);
  chart.innerHTML = '';
  sessions.slice(-14).forEach(s => {
    const val = totalVolumeOfCustomSession(s);
    const barH = Math.max(4, (val / maxVal) * 118);
    const d = new Date(s.completedAt);
    const col = document.createElement('div');
    col.className = 'chart-col';
    col.innerHTML = `<div class="chart-bar${s.isPR ? ' pb' : ''}" style="height:${barH}px;" title="${val}"></div>
      <div class="chart-xlabel">${d.getDate()}/${d.getMonth() + 1}</div>`;
    chart.appendChild(col);
  });
}

/* ---- weekly schedule / rest days ----
   Each day entry is either null (rest day) or {type:'cindy'|'custom', id}.
   Legacy data (pre-Cindy-scheduling) stored a bare Custom Workout id string
   per day — loadWeeklyPlan() upconverts that transparently on read so old
   schedules keep working without a migration step. */
const KEY_WEEKLY_PLAN = 'cindy_custom_weekly_plan';
const WEEKDAY_LABELS = ['อาทิตย์', 'จันทร์', 'อังคาร', 'พุธ', 'พฤหัสบดี', 'ศุกร์', 'เสาร์'];
function normalizeWeeklyPlanEntry(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return { type: 'custom', id: v }; // legacy format
  if (typeof v === 'object' && v.type && v.id) return v;
  return null;
}
function loadWeeklyPlan() {
  let raw = {};
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_WEEKLY_PLAN));
    if (saved && typeof saved === 'object') raw = saved;
  } catch (e) {}
  const plan = {};
  Object.keys(raw).forEach(k => { plan[k] = normalizeWeeklyPlanEntry(raw[k]); });
  return plan;
}
function saveWeeklyPlan(plan) {
  localStorage.setItem(KEY_WEEKLY_PLAN, JSON.stringify(plan));
}
/** value is "" (rest day) or "type:id" e.g. "cindy:builtin_cindy" / "custom:abc123" */
function setWeeklyPlanDay(dayIdx, value) {
  const plan = loadWeeklyPlan();
  if (!value) {
    plan[dayIdx] = null;
  } else {
    const sep = value.indexOf(':');
    plan[dayIdx] = { type: value.slice(0, sep), id: value.slice(sep + 1) };
  }
  saveWeeklyPlan(plan);
  renderHomeWeeklyPlanCard();
}

/* ================= PLAN STREAK (product doc #17) =================
 * Counts consecutive Monday-Sunday weeks where every day the player
 * scheduled in the Weekly Plan (loadWeeklyPlan) actually happened — a
 * "did I follow my own plan" streak, distinct from computeCombinedStreak's
 * "did I do *something* today" streak. Rest days (null entries) and days
 * that were never configured in the plan at all trivially count as
 * satisfied — this is about discipline against a self-set schedule, not
 * about forcing daily activity.
 *
 * Reuses weekStart()/dayKey() already defined for the Boss/Weekly Mission
 * systems, so "a week" and "a day" mean exactly the same thing everywhere
 * in the app — no second calendar definition to keep in sync. */
/** true if the scheduled entry for this specific calendar day was
 * actually completed — rest days (null) and days in the future (haven't
 * happened yet, so can't be judged) both count as satisfied so an
 * in-progress week isn't unfairly broken before it's over. Cardio presets
 * are stored in the same Custom Workout session log as regular Custom
 * Workouts (see currentBossDamageBreakdown's comment on this), so both
 * 'custom' and 'cardio' plan entries check the same session list, keyed
 * only by workoutId. */
function planDaySatisfied(dateTs, entry) {
  if (!entry) return true;
  if (dateTs > Date.now()) return true;
  const key = dayKey(dateTs);
  if (entry.type === 'cindy') {
    return loadSessions().some(s => s.completed !== false && dayKey(s.finished) === key && s.protocolId === entry.id);
  }
  return loadCustomWorkoutSessions().some(s => dayKey(s.completedAt) === key && s.workoutId === entry.id);
}
/** Number of consecutive weeks (walking backward from the current week)
 * where every scheduled day was satisfied. Caps at ~10 years as a safety
 * net against an unbounded loop; in practice the loop stops naturally the
 * moment it reaches a week before any matching session existed. */
function computePlanStreak() {
  const plan = loadWeeklyPlan();
  const hasAnyScheduledDay = Object.keys(plan).some(k => plan[k]);
  if (!hasAnyScheduledDay) return 0;

  const now = Date.now();
  let cursor = weekStart(now);
  let streak = 0;
  const SAFETY_CAP_WEEKS = 520;
  while (streak < SAFETY_CAP_WEEKS) {
    const mondayTs = cursor.getTime();
    let weekOk = true;
    for (let d = 0; d < 7; d++) {
      const dayTs = mondayTs + d * 24 * 60 * 60 * 1000;
      const dayOfWeekIdx = (d + 1) % 7; // Monday(d=0)->1 ... Sunday(d=6)->0, matches getDay()
      if (!planDaySatisfied(dayTs, plan[dayOfWeekIdx])) { weekOk = false; break; }
    }
    if (!weekOk) break;
    streak++;
    cursor.setDate(cursor.getDate() - 7);
  }
  return streak;
}
function renderPlanStreak(elId) {
  const el = document.getElementById(elId || 'progPlanStreak');
  if (!el) return;
  el.textContent = computePlanStreak() + ' WEEKS';
}

function renderCustomSchedule() {
  const wrap = document.getElementById('customScheduleList');
  if (!wrap) return;
  const workouts = loadCustomWorkouts();
  const protocols = allProtocols();
  const plan = loadWeeklyPlan();
  wrap.innerHTML = WEEKDAY_LABELS.map((label, i) => {
    const entry = plan[i];
    const selectedValue = entry ? entry.type + ':' + entry.id : '';
    const cindyOptions = protocols.map(p =>
      `<option value="cindy:${p.id}"${selectedValue === 'cindy:' + p.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');
    const customOptions = workouts.map(w =>
      `<option value="custom:${w.id}"${selectedValue === 'custom:' + w.id ? ' selected' : ''}>${escapeHtml(w.name)}</option>`
    ).join('');
    const cardioOptions = CARDIO_PRESETS.map(p =>
      `<option value="cardio:${p.id}"${selectedValue === 'cardio:' + p.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`
    ).join('');
    return `<div class="field-row" style="grid-template-columns:90px 1fr;align-items:center;">
      <label>${label}</label>
      <select class="time-input" onchange="setWeeklyPlanDay(${i}, this.value)">
        <option value="">วันพัก (Rest Day)</option>
        <optgroup label="Cindy">${cindyOptions}</optgroup>
        <optgroup label="Custom Workout">${customOptions}</optgroup>
        <optgroup label="Cardio">${cardioOptions}</optgroup>
      </select>
    </div>`;
  }).join('');
}
/* Prominent "today's plan" CTA on the Home dashboard: today's scheduled
   Custom Workout, a rest-day note, or (if no weekly schedule is set up yet)
   a nudge toward Program to pick something to do today. */
function renderHomeWeeklyPlanCard() {
  const wrap = document.getElementById('homeWeeklyPlanWrap');
  if (!wrap) return;
  const plan = loadWeeklyPlan();
  const todayIdx = new Date().getDay();
  const hasAnyPlan = Object.keys(plan).length > 0 && Object.values(plan).some(v => v !== undefined);

  if (!hasAnyPlan) {
    wrap.innerHTML = `<div class="plan-cta" onclick="go('program')">
      <div class="eyebrow">แผนวันนี้</div>
      <div class="title-row"><div class="title">ยังไม่ได้ตั้งแผน</div><div class="arrow">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>
      </div></div>
      <div class="meta">ไปที่ Program เพื่อเริ่ม Cindy หรือตั้งตารางประจำสัปดาห์</div>
    </div>`;
    return;
  }

  const entry = plan[todayIdx];
  if (!entry) {
    wrap.innerHTML = `<div class="plan-cta" style="cursor:default;">
      <div class="eyebrow">แผนวันนี้ (${WEEKDAY_LABELS[todayIdx]})</div>
      <div class="title-row"><div class="title">วันพัก</div></div>
      <div class="meta">พักผ่อนให้เต็มที่ ค่อยลุยใหม่พรุ่งนี้</div>
    </div>`;
    return;
  }

  if (entry.type === 'cindy') {
    const protocol = allProtocols().find(p => p.id === entry.id);
    if (!protocol) { wrap.innerHTML = ''; return; }
    const meta = protocol.mode === 'emom'
      ? 'EMOM · ' + protocol.pull + '/' + protocol.push + '/' + protocol.squat + ' · ' + protocol.emomRounds + '×' + protocol.emomIntervalSec + 's · แตะเพื่อเริ่ม'
      : protocol.pull + '/' + protocol.push + '/' + protocol.squat + ' · ' + (protocol.durationMin || 20) + ' นาที · แตะเพื่อเริ่ม';
    wrap.innerHTML = `<div class="plan-cta" onclick="startPlannedCindy('${protocol.id}')">
      <div class="eyebrow">แผนวันนี้ (${WEEKDAY_LABELS[todayIdx]})</div>
      <div class="title-row"><div class="title">${escapeHtml(protocol.name)}</div><div class="arrow">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>
      </div></div>
      <div class="meta">${meta}</div>
    </div>`;
    return;
  }

  if (entry.type === 'cardio') {
    const preset = CARDIO_PRESETS.find(p => p.id === entry.id);
    if (!preset) { wrap.innerHTML = ''; return; }
    wrap.innerHTML = `<div class="plan-cta" onclick="startCardioPreset('${preset.id}')">
      <div class="eyebrow">แผนวันนี้ (${WEEKDAY_LABELS[todayIdx]})</div>
      <div class="title-row"><div class="title">${escapeHtml(preset.name)}</div><div class="arrow">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>
      </div></div>
      <div class="meta">${preset.exercises.length} ท่า · แตะเพื่อเริ่ม</div>
    </div>`;
    return;
  }

  const workout = getCustomWorkout(entry.id);
  if (!workout) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<div class="plan-cta" onclick="startCustomWorkoutPlayer('${workout.id}')">
    <div class="eyebrow">แผนวันนี้ (${WEEKDAY_LABELS[todayIdx]})</div>
    <div class="title-row"><div class="title">${escapeHtml(workout.name)}</div><div class="arrow">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"><path d="M9 6l6 6-6 6"/></svg>
    </div></div>
    <div class="meta">${workout.exercises.length} ท่า · แตะเพื่อเริ่ม</div>
  </div>`;
}

/** Starts (or resumes) the Cindy protocol scheduled for today from the Home
    CTA. Mirrors handleHomeMainBtn(): an in-progress Cindy session always
    takes priority so tapping the card never silently discards it. */
function startPlannedCindy(protocolId) {
  unlockAudio();
  const active = loadActive();
  if (active) {
    enterWorkoutScreen();
    return;
  }
  selectProtocol(protocolId);
  startNewWorkout();
}

function renderCustomHistory() {
  const wrap = document.getElementById('customHistoryList');
  if (!wrap) return;
  const list = loadCustomWorkoutSessions().slice().sort((a, b) => b.completedAt - a.completedAt);
  if (!list.length) {
    wrap.innerHTML = '<div class="empty-hint">ยังไม่มีประวัติ Custom Workout — ไปเล่นสักครั้งก่อนนะ</div>';
    return;
  }
  wrap.innerHTML = list.map(s => {
    const meta = s.setsCompleted + ' เซ็ต · ' + fmtTime(s.totalDurationSec);
    return `<div class="history-item" onclick="openCustomHistoryDetail('${s.id}')">
      <div>
        <div class="date">${fmtDate(s.completedAt)}${s.isPR ? ' <span class="proto-active-tag">PR</span>' : ''}</div>
        <div class="reps">${meta} · ${escapeHtml(s.workoutName || 'Untitled Workout')}</div>
      </div>
      <div class="rounds tabular">${fmtTime(s.totalDurationSec)}</div>
    </div>`;
  }).join('');
}

function openCustomHistoryDetail(id) {
  currentCustomHistoryDetailId = id;
  go('customhistorydetail');
  renderCustomHistoryDetail();
}

function renderCustomHistoryDetail() {
  const wrap = document.getElementById('customHistoryDetailWrap');
  if (!wrap) return;
  const s = loadCustomWorkoutSessions().find(x => x.id === currentCustomHistoryDetailId);
  if (!s) { wrap.innerHTML = '<div class="empty-hint">ไม่พบข้อมูล</div>'; return; }

  const log = s.exerciseLog || [];
  const rows = log.map(entry => {
    const unit = entry.type === 'time' ? 'วิ' : 'ครั้ง';
    const weightTag = entry.weight > 0 ? ' · ' + entry.weight + 'กก.' : '';
    return `<tr><td>${escapeHtml(entry.name)}</td><td>${entry.setNumber}</td><td>${entry.repsOrSecDone} ${unit}${weightTag}</td></tr>`;
  }).join('');
  const tableRows = rows || '<tr><td colspan="3" style="color:var(--text-faint);">ไม่มีข้อมูลเซ็ต</td></tr>';

  wrap.innerHTML = `
    <div class="complete-hero" style="padding-top:4px;">
      <div class="complete-rounds tabular">${s.setsCompleted}</div>
      <div class="complete-lbl">SETS · ${fmtDate(s.completedAt)}</div>
      <div style="font-size:11px;color:var(--text-faint);margin-top:4px;letter-spacing:1px;">${escapeHtml(s.workoutName || 'Untitled Workout')}</div>
      ${s.isPR ? '<div class="pr-badge new">NEW PR</div>' : ''}
    </div>
    <div class="metric-grid">
      <div class="metric-card"><div class="v tabular">${fmtTime(s.totalDurationSec)}</div><div class="l">TOTAL TIME</div></div>
      <div class="metric-card"><div class="v">${s.setsCompleted}</div><div class="l">SETS COMPLETED</div></div>
      <div class="metric-card"><div class="v">${s.rpe ? s.rpe + '/10' : '—'}</div><div class="l">RPE</div></div>
      <div class="metric-card"><div class="v">${s.feeling || '—'}</div><div class="l">FEELING</div></div>
    </div>

    <div class="section-label">EXERCISE BREAKDOWN</div>
    <div class="metric-card">${buildCustomExerciseBreakdownHtml(log)}</div>

    <div class="section-label">SET BREAKDOWN</div>
    <div class="metric-card">
      <table class="detail-table">
        <thead><tr><th>ท่า</th><th>เซ็ต</th><th>ผลลัพธ์</th></tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
    </div>

    ${s.note ? `<div class="section-label">NOTE</div><div class="metric-card" style="font-size:13px;color:var(--text-dim);line-height:1.5;">${escapeHtml(s.note)}</div>` : ''}
  `;
}

/* ---- edit / delete (mirrors Cindy's openEditSessionModal/saveEditSession) ---- */
let pendingEditCustomFeedback = { rpe: null, feeling: null };
function openEditCustomHistorySessionModal(id) {
  requirePin('ใส่ PIN เพื่อแก้ไขประวัติ Workout นี้', () => openEditCustomHistorySessionModalImpl(id));
}
function openEditCustomHistorySessionModalImpl(id) {
  const s = loadCustomWorkoutSessions().find(x => x.id === id);
  if (!s) return;
  currentCustomHistoryDetailId = id;
  pendingEditCustomFeedback = { rpe: s.rpe || null, feeling: s.feeling || null };
  document.getElementById('editCustomNoteInput').value = s.note || '';
  const rpeRow = document.getElementById('editCustomRpeRow');
  rpeRow.innerHTML = '';
  for (let i = 1; i <= 10; i++) {
    const el = document.createElement('div');
    el.className = 'rpe-pill' + (s.rpe === i ? ' sel' : '');
    el.textContent = i;
    el.onclick = () => { pendingEditCustomFeedback.rpe = i; rpeRow.querySelectorAll('.rpe-pill').forEach(p => p.classList.remove('sel')); el.classList.add('sel'); };
    rpeRow.appendChild(el);
  }
  document.querySelectorAll('#editCustomFeelingRow .feeling-pill').forEach(p => p.classList.toggle('sel', p.dataset.f === s.feeling));
  document.getElementById('editCustomHistoryModal').classList.add('active');
}
function selectEditCustomFeeling(val) {
  pendingEditCustomFeedback.feeling = val;
  document.querySelectorAll('#editCustomFeelingRow .feeling-pill').forEach(p => p.classList.toggle('sel', p.dataset.f === val));
}
function saveEditCustomHistorySession() {
  const sessions = loadCustomWorkoutSessions();
  const idx = sessions.findIndex(s => s.id === currentCustomHistoryDetailId);
  if (idx === -1) return;
  sessions[idx].rpe = pendingEditCustomFeedback.rpe;
  sessions[idx].feeling = pendingEditCustomFeedback.feeling;
  sessions[idx].note = document.getElementById('editCustomNoteInput').value.trim();
  saveCustomWorkoutSessions(sessions);
  closeModal('editCustomHistoryModal');
  renderCustomHistoryDetail();
  showToast('บันทึกการแก้ไขแล้ว');
}

function confirmDeleteCustomHistorySession() {
  if (!currentCustomHistoryDetailId) return;
  requirePin('ใส่ PIN เพื่อลบประวัติ Workout นี้', () => {
    document.getElementById('customHistoryDeleteModal').classList.add('active');
  });
}
function deleteCustomHistorySessionExecute() {
  if (currentCustomHistoryDetailId) {
    deleteCustomWorkoutSession(currentCustomHistoryDetailId);
    currentCustomHistoryDetailId = null;
  }
  closeModal('customHistoryDeleteModal');
  go('customhistory');
  showToast('ลบ Workout จากประวัติแล้ว');
}


document.addEventListener('DOMContentLoaded', initBossView);
document.addEventListener('DOMContentLoaded', initWorldMap);
document.addEventListener('DOMContentLoaded', initAchModal);
document.addEventListener('DOMContentLoaded', initSeasonModal);
