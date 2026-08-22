/* ===== CINDY — App Logic ===== */
const RING_CIRC = 2 * Math.PI * 108;
const KEY_SESSIONS = 'cindy_sessions';
const KEY_ACTIVE = 'cindy_active_workout';

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
    pull: Math.max(0, parseInt(document.getElementById('cfgPull').value, 10) || 0),
    push: Math.max(0, parseInt(document.getElementById('cfgPush').value, 10) || 0),
    squat: Math.max(0, parseInt(document.getElementById('cfgSquat').value, 10) || 0)
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
    || (document.getElementById('screen-customplayer') && document.getElementById('screen-customplayer').classList.contains('active'));
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

/* ---------- storage helpers ---------- */
function loadSessions() {
  try { return JSON.parse(localStorage.getItem(KEY_SESSIONS)) || []; }
  catch (e) { return []; }
}
function saveSessions(list) {
  localStorage.setItem(KEY_SESSIONS, JSON.stringify(list));
}
function loadActive() {
  try { return JSON.parse(localStorage.getItem(KEY_ACTIVE)); }
  catch (e) { return null; }
}
function saveActive(a) {
  localStorage.setItem(KEY_ACTIVE, JSON.stringify(a));
}
function clearActive() {
  localStorage.removeItem(KEY_ACTIVE);
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
function fmtDate(ts) {
  const d = new Date(ts);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return d.getDate() + ' ' + months[d.getMonth()] + ' ' + d.getFullYear();
}
function dayKey(ts) {
  const d = new Date(ts);
  return d.getFullYear() + '-' + d.getMonth() + '-' + d.getDate();
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(showToast._h);
  showToast._h = setTimeout(() => t.classList.remove('show'), 1600);
}

/* ---------- navigation ---------- */
function go(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => {
    if (t.getAttribute('onclick') === "go('" + name + "')") t.classList.add('active');
  });
  if (name === 'home') renderHome();
  if (name === 'history') renderHistory();
  if (name === 'progress') { renderProgress(); applyReminderToUI(); }
  if (name === 'customlist') renderCustomList();
  if (name === 'customhistory') renderCustomHistory();
}

/* ================= HOME ================= */
function renderHome() {
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

  const wrap = document.getElementById('lastWorkoutWrap');
  if (sessions.length === 0) {
    wrap.innerHTML = '<div class="empty-hint">ยังไม่มีประวัติการเล่น</div>';
  } else {
    const last = sessions[sessions.length - 1];
    wrap.innerHTML = `<div class="last-workout" onclick="openDetail('${last.id}')">
      <div><div class="date">${fmtDate(last.finished)}</div></div>
      <div class="rounds">${last.rounds} ROUNDS</div>
    </div>`;
  }

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
  const detail = recent.exercises.length + ' ท่า · ' + recent.sets + ' เซ็ต';
  card.innerHTML = `<div class="history-item" onclick="startCustomWorkoutPlayer('${recent.id}')">
    <div>
      <div class="date">${escapeHtml(recent.name)}</div>
      <div class="reps">${detail}</div>
    </div>
    <div class="rounds" style="color:var(--success);">▶</div>
  </div>`;
  homeWrap.style.display = 'block';
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

function handleHomeMainBtn() {
  unlockAudio();
  const active = loadActive();
  if (active) {
    enterWorkoutScreen();
  } else {
    startNewWorkout();
  }
}

function confirmDiscardAndStartNew() {
  clearActive();
  startNewWorkout();
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
  document.getElementById('saveRoundBtn').textContent = '✓ บันทึกรอบที่ ' + (active.roundsSaved + 1);

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
  saveActive(active);
  vibrate(40);
  beep(880, 90, 0.15);
  showToast('บันทึกรอบที่ ' + active.roundsSaved + ' แล้ว');
  refreshWorkoutUI();
}

function skipRound() {
  const active = loadActive();
  if (!active) return;
  if (active.mode === 'emom') return; // not applicable in EMOM — rounds auto-log on the clock
  const elapsedSec = getElapsedMs(active) / 1000;
  if (!active.skipLog) active.skipLog = [];
  active.skipLog.push({ time: Math.round(elapsedSec) });
  saveActive(active);
  showToast('ข้ามรอบนี้แล้ว (ไม่นับเป็น Round)');
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

/* ================= COMPLETE ================= */
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

  const sessions = loadSessions();
  const prevBest = sessions.reduce((m, s) => Math.max(m, s.rounds), 0);
  const isNewPR = rounds > prevBest && rounds > 0;

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
    protocolName: active.protocolName || 'Cindy (Classic)',
    mode: active.mode || 'amrap',
    rpe: null,
    feeling: null,
    note: ''
  };

  sessions.push(session);
  saveSessions(sessions);
  clearActive();
  lastCompletedSessionId = session.id;

  if (isNativeApp()) rescheduleNativeReminder(true); // done today — push reminder to tomorrow

  renderCompleteScreen(session);
  go('complete');
}

function renderCompleteScreen(session) {
  document.getElementById('completeRounds').textContent = session.rounds;
  document.getElementById('cTotalReps').textContent = session.total.reps;
  const avgRoundSec = session.rounds > 0 ? session.duration / session.rounds : 0;
  document.getElementById('cAvgRound').textContent = fmtTime(avgRoundSec);
  document.getElementById('bdPull').textContent = session.total.pull;
  document.getElementById('bdPush').textContent = session.total.push;
  document.getElementById('bdSquat').textContent = session.total.squat;

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

/* ================= HISTORY ================= */
function renderHistory() {
  const sessions = loadSessions().slice().reverse();
  const wrap = document.getElementById('historyList');
  if (sessions.length === 0) {
    wrap.innerHTML = '<div class="empty-hint">ยังไม่มีประวัติการเล่น</div>';
    return;
  }
  wrap.innerHTML = sessions.map(s => `
    <div class="history-item" onclick="openDetail('${s.id}')">
      <div>
        <div class="date">${fmtDate(s.finished)}${s.mode === 'emom' ? ' <span class="proto-active-tag">EMOM</span>' : ''}</div>
        <div class="reps">${s.total.reps} REPS · ${escapeHtml(s.protocolName || 'Cindy')}</div>
      </div>
      <div class="rounds">${s.rounds} R</div>
    </div>
  `).join('');
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
  document.getElementById('deleteSessionModal').classList.add('active');
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
  const best = all.reduce((m, s) => Math.max(m, s.rounds), 0);
  const avg = all.length ? (all.reduce((sum, s) => sum + s.rounds, 0) / all.length) : 0;
  const totalReps = all.reduce((sum, s) => sum + s.total.reps, 0);

  document.getElementById('pBest').textContent = best + ' R';
  document.getElementById('pAvg').textContent = avg.toFixed(1) + ' R';
  document.getElementById('pSessions').textContent = all.length;
  document.getElementById('pTotalReps').textContent = totalReps.toLocaleString();
  document.getElementById('progStreak').textContent = computeStreak(all) + ' DAYS';

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
      id: 'cindy_default', name: 'CINDY เตือนประจำวัน (มีเสียง)', importance: 4, visibility: 1, sound: 'default', vibration: true
    });
    await plugins.LocalNotifications.createChannel({
      id: 'cindy_silent', name: 'CINDY เตือนประจำวัน (สั่นอย่างเดียว)', importance: 3, visibility: 1, vibration: true
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
        title: 'CINDY',
        body: 'ยังไม่ได้เล่น Workout วันนี้เลย — ลุยสักรอบไหม? 🕸️',
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
          id: 9999, title: 'CINDY', body: 'นี่คือการแจ้งเตือนทดสอบ 🕸️',
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
  showToast('ยังไม่ได้เล่น CINDY วันนี้เลยนะ 🕸️');
  if ('Notification' in window && Notification.permission === 'granted') {
    try {
      if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        navigator.serviceWorker.ready.then(reg => reg.showNotification('CINDY', {
          body: 'ยังไม่ได้เล่น Workout วันนี้เลย — ลุยสักรอบไหม?',
          icon: 'icon.svg'
        })).catch(() => {});
      } else {
        new Notification('CINDY', { body: 'ยังไม่ได้เล่น Workout วันนี้เลย — ลุยสักรอบไหม?', icon: 'icon.svg' });
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

/* ================= BACKUP (Export / Import) =================
   v2: covers ALL locally-stored user data, not just Cindy sessions.
   Previously this only exported KEY_SESSIONS ('cindy_sessions'), so
   Custom Workouts, their completed-session history, and custom protocols
   were silently left out of every backup — a device switch or app-clear
   would permanently destroy them with no way to recover. Fixed by
   collecting every user-data key into the payload, and merging every
   category back in on import (still backward-compatible with old
   v1 backups, which only ever contained `sessions`). */
function exportData() {
  const sessions = loadSessions();
  const customWorkouts = loadCustomWorkouts();
  const customWorkoutSessions = loadCustomWorkoutSessions();
  const customProtocols = loadCustomProtocols();

  if (!sessions.length && !customWorkouts.length && !customWorkoutSessions.length && !customProtocols.length) {
    showToast('ยังไม่มีข้อมูลให้ส่งออก');
    return;
  }

  const payload = {
    app: 'CINDY',
    version: 2,
    exportedAt: Date.now(),
    sessions,
    customWorkouts,
    customWorkoutSessions,
    customProtocols
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const fname = 'cindy_backup_' + d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
  const a = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('ส่งออกข้อมูลแล้ว (Cindy + Custom Workout)');
}

function importData(event) {
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

      if (!Array.isArray(incomingSessions) && !Array.isArray(incomingWorkouts) &&
          !Array.isArray(incomingWorkoutSessions) && !Array.isArray(incomingProtocols)) {
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

      showToast('นำเข้าข้อมูลแล้ว (' + added + ' รายการใหม่)');
      renderProgress();
      renderCustomList();
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
  showToast('ติดตั้ง CINDY สำเร็จ 💪');
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
function init() {
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
  updateInstallButton();
  checkReminder();
  if (isNativeApp()) rescheduleNativeReminder(false);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  const splash = document.getElementById('splash');
  if (splash) {
    setTimeout(() => splash.classList.add('hide'), 1050);
  }
}
document.addEventListener('DOMContentLoaded', init);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') checkReminder();
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

/* ================= CUSTOM WORKOUT (FREE-FORM) — DATA MODEL & STORAGE ================= */
/* Phase 1: schema + CRUD only. No UI/builder/player yet — those come in later phases.
   Kept completely separate from Cindy's protocol/session storage (different keys)
   so nothing here can ever corrupt or interfere with existing Cindy data. */

const KEY_CUSTOM_WORKOUTS = 'custom_workouts';          // saved workout "recipes"
const KEY_CUSTOM_SESSIONS = 'custom_workout_sessions';  // completed workout results

/* ---- Workout definitions (the "recipe" the user builds) ---- */

function loadCustomWorkouts() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_CUSTOM_WORKOUTS));
    if (Array.isArray(saved)) return saved;
  } catch (e) {}
  return [];
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
    type: 'reps',        // 'reps' | 'time'
    reps: 10,             // used when type === 'reps'
    durationSec: 30,      // used when type === 'time'
    restAfterSec: 15
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
    exercises: Array.isArray(workout.exercises)
      ? workout.exercises.map((ex, i) => makeCustomExercise(Object.assign({}, ex, { order: i })))
      : [],
    sets: Math.max(1, parseInt(workout.sets, 10) || 1),
    restBetweenSetsSec: Math.max(0, parseInt(workout.restBetweenSetsSec, 10) || 0)
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
}

/**
 * Records one completed run of a custom workout. The (future) Workout Player
 * calls this when the user finishes the last set.
 */
function recordCustomWorkoutSession(session) {
  const list = loadCustomWorkoutSessions();
  const clean = {
    id: 'wsession_' + Date.now(),
    workoutId: session.workoutId,
    workoutName: session.workoutName || '',
    completedAt: Date.now(),
    totalDurationSec: session.totalDurationSec || 0,
    setsCompleted: session.setsCompleted || 0,
    // e.g. [{ name:'Push-up', setNumber:1, repsOrSecDone:15 }, ...]
    exerciseLog: Array.isArray(session.exerciseLog) ? session.exerciseLog : []
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
    const detail = exCount + ' ท่า · ' + w.sets + ' เซ็ต' + (w.restBetweenSetsSec ? ' · พัก ' + w.restBetweenSetsSec + 'วิ' : '');
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
    sets: original.sets,
    restBetweenSetsSec: original.restBetweenSetsSec,
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
    sets: 1,
    restBetweenSetsSec: 30,
    exercises: [makeCustomExercise({ name: '' })]
  };
}
function openCustomEditor(id) {
  const existing = id ? getCustomWorkout(id) : null;
  customEditorDraft = existing
    ? { id: existing.id, name: existing.name, sets: existing.sets, restBetweenSetsSec: existing.restBetweenSetsSec,
        exercises: existing.exercises.map(ex => Object.assign({}, ex)) }
    : blankCustomWorkoutDraft();

  document.getElementById('customEditorTitle').textContent = existing ? 'แก้ไข WORKOUT' : 'สร้าง WORKOUT';
  document.getElementById('customNameInput').value = customEditorDraft.name;
  document.getElementById('customSetsInput').value = customEditorDraft.sets;
  document.getElementById('customRestInput').value = customEditorDraft.restBetweenSetsSec;
  renderCustomExerciseList();
  go('customeditor');
}
function cancelCustomEditor() {
  customEditorDraft = null;
  go('customlist');
}

function updateCustomHeaderField(field, value) {
  if (!customEditorDraft) return;
  customEditorDraft[field] = (field === 'name') ? value : (parseInt(value, 10) || 0);
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
        ? `<div class="field-row"><label>จำนวนครั้ง</label><input type="number" min="1" max="999" value="${ex.reps}" oninput="updateCustomExerciseField(${i}, 'reps', this.value)"></div>`
        : `<div class="field-row"><label>ระยะเวลา (วินาที)</label><input type="number" min="1" max="3600" value="${ex.durationSec}" oninput="updateCustomExerciseField(${i}, 'durationSec', this.value)"></div>`
      }
      <div class="field-row"><label>พักหลังท่านี้ (วินาที)</label><input type="number" min="0" max="600" value="${ex.restAfterSec}" oninput="updateCustomExerciseField(${i}, 'restAfterSec', this.value)"></div>
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
    restAfterSec: preset.restAfterSec != null ? preset.restAfterSec : 15
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
  customEditorDraft.exercises[idx][field] = (field === 'name') ? value : (parseInt(value, 10) || 0);
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

function startCustomWorkoutPlayer(id) {
  const workout = getCustomWorkout(id);
  if (!workout || !workout.exercises.length) { showToast('Workout นี้ยังไม่มีท่า'); return; }
  customPlayer = {
    workout,
    setIndex: 0,
    exIndex: 0,
    phase: 'exercise',           // 'exercise' | 'restEx' | 'restSet'
    startedAt: Date.now(),
    exerciseLog: [],
    currentValue: 0,
    timer: { endTime: null, totalMs: 0, running: false, paused: false, remainingMs: 0, handle: null, onDone: null }
  };
  unlockAudio();
  acquireWakeLock();
  go('customplayer');
  beginCustomPlayerPhase();
}

function currentCustomExercise() {
  return customPlayer.workout.exercises[customPlayer.exIndex];
}
function isLastExerciseInSet() {
  return customPlayer.exIndex >= customPlayer.workout.exercises.length - 1;
}
function isLastSet() {
  return customPlayer.setIndex >= customPlayer.workout.sets - 1;
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
    if (ex.type === 'time') {
      customPlayer.currentValue = ex.durationSec;
      startCustomPlayerCountdown(ex.durationSec, onCustomExerciseTimeUp);
    } else {
      customPlayer.currentValue = ex.reps;
    }
  } else {
    const restSec = customPlayer.phase === 'restEx'
      ? currentCustomExercise().restAfterSec
      : customPlayer.workout.restBetweenSetsSec;
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
  customPlayer.exerciseLog.push({ name: ex.name, setNumber: customPlayer.setIndex + 1, repsOrSecDone: value, type: ex.type || 'reps' });
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
  } else if (customPlayer.phase === 'restEx' || customPlayer.phase === 'restSet') {
    clearCustomPlayerTimer();
    onCustomRestDone();
  }
}
function adjustPlayerReps(delta) {
  if (!customPlayer || customPlayer.phase !== 'exercise') return;
  customPlayer.currentValue = Math.max(0, customPlayer.currentValue + delta);
  renderCustomPlayer();
}

function advanceAfterCustomExercise() {
  if (isLastExerciseInSet()) {
    advanceAfterCustomSet();
  } else if (currentCustomExercise().restAfterSec > 0) {
    customPlayer.phase = 'restEx';
    beginCustomPlayerPhase();
  } else {
    advanceToNextCustomExercise();
  }
}
function advanceToNextCustomExercise() {
  customPlayer.exIndex++;
  customPlayer.phase = 'exercise';
  beginCustomPlayerPhase();
}
function advanceAfterCustomSet() {
  if (isLastSet()) {
    finishCustomPlayerWorkout();
  } else if (customPlayer.workout.restBetweenSetsSec > 0) {
    customPlayer.phase = 'restSet';
    beginCustomPlayerPhase();
  } else {
    advanceToNextCustomSet();
  }
}
function advanceToNextCustomSet() {
  customPlayer.setIndex++;
  customPlayer.exIndex = 0;
  customPlayer.phase = 'exercise';
  beginCustomPlayerPhase();
}
function onCustomRestDone() {
  if (customPlayer.phase === 'restEx') advanceToNextCustomExercise();
  else advanceToNextCustomSet();
}

function finishCustomPlayerWorkout() {
  clearCustomPlayerTimer();
  releaseWakeLock();
  const totalDurationSec = Math.round((Date.now() - customPlayer.startedAt) / 1000);
  recordCustomWorkoutSession({
    workoutId: customPlayer.workout.id,
    workoutName: customPlayer.workout.name,
    totalDurationSec,
    setsCompleted: customPlayer.workout.sets,
    exerciseLog: customPlayer.exerciseLog
  });
  vibrate([100, 60, 100, 60, 200]);
  beep(660, 200, 0.2);
  showToast('จบ WORKOUT แล้ว 💪 บันทึกผลแล้ว');
  customPlayer = null;
  go('customlist');
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

  document.getElementById('playerStatusPill').textContent = 'SET ' + (customPlayer.setIndex + 1) + '/' + w.sets;
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
    phaseLabel = customPlayer.phase === 'restEx' ? 'พักก่อนท่าถัดไป' : 'พักก่อนเซ็ตถัดไป';
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
    pauseBtn.textContent = customPlayer.timer.paused ? '▶ เล่นต่อ' : '⏸ หยุดชั่วคราว';
  }
}

/* ================= CUSTOM WORKOUT — HISTORY / REPORT (PHASE 4) ================= */
/* Read-only reporting on top of KEY_CUSTOM_SESSIONS. Fully separate screen from
   Cindy's HISTORY tab/filter — never reads KEY_SESSIONS, never touches Cindy's
   currentDetailId. */

let currentCustomHistoryDetailId = null;

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
        <div class="date">${escapeHtml(s.workoutName || 'Untitled Workout')}</div>
        <div class="reps">${fmtDate(s.completedAt)} · ${meta}</div>
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

  const setsGrouped = {};
  (s.exerciseLog || []).forEach(entry => {
    if (!setsGrouped[entry.setNumber]) setsGrouped[entry.setNumber] = [];
    setsGrouped[entry.setNumber].push(entry);
  });
  const setNumbers = Object.keys(setsGrouped).map(n => parseInt(n, 10)).sort((a, b) => a - b);

  const setsHtml = setNumbers.map(n => {
    const rows = setsGrouped[n].map(entry => {
      const unit = entry.type === 'time' ? 'วินาที' : 'ครั้ง';
      return `<div class="history-item" style="cursor:default;">
        <div><div class="date">${escapeHtml(entry.name)}</div></div>
        <div class="rounds tabular" style="font-size:18px;">${entry.repsOrSecDone} <span style="font-size:11px;color:var(--text-faint);">${unit}</span></div>
      </div>`;
    }).join('');
    return `<div class="section-label">เซ็ต ${n}</div>${rows}`;
  }).join('');

  wrap.innerHTML = `
    <div class="stats-grid">
      <div class="stat-card"><div class="v">${fmtTime(s.totalDurationSec)}</div><div class="l">เวลารวม</div></div>
      <div class="stat-card"><div class="v">${s.setsCompleted}</div><div class="l">เซ็ตที่ทำ</div></div>
    </div>
    <div class="empty-hint" style="text-align:left;padding:4px 0 0;">${fmtDate(s.completedAt)}</div>
    ${setsHtml || '<div class="empty-hint">ไม่มีข้อมูลท่าออกกำลังกาย</div>'}
  `;
}

function confirmDeleteCustomHistorySession() {
  if (!currentCustomHistoryDetailId) return;
  document.getElementById('customHistoryDeleteModal').classList.add('active');
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
