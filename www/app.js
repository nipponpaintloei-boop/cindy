/* ===== CINDY — App Logic ===== */
const KEY_CONFIG = 'cindy_config';
const DEFAULT_CONFIG = { pull: 5, push: 10, squat: 15, durationMin: 20 };
let CONFIG = loadConfig();
let DURATION_MS = CONFIG.durationMin * 60 * 1000;
let REPS = { pull: CONFIG.pull, push: CONFIG.push, squat: CONFIG.squat };
const RING_CIRC = 2 * Math.PI * 108;
const KEY_SESSIONS = 'cindy_sessions';
const KEY_ACTIVE = 'cindy_active_workout';

function loadConfig() {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY_CONFIG));
    if (saved && typeof saved === 'object') return Object.assign({}, DEFAULT_CONFIG, saved);
  } catch (e) {}
  return Object.assign({}, DEFAULT_CONFIG);
}
function saveConfig(cfg) {
  CONFIG = cfg;
  localStorage.setItem(KEY_CONFIG, JSON.stringify(cfg));
  REPS = { pull: cfg.pull, push: cfg.push, squat: cfg.squat };
  DURATION_MS = cfg.durationMin * 60 * 1000;
  applyProtocolToUI();
}
function applyProtocolToUI() {
  const heroEyebrow = document.getElementById('heroEyebrow');
  const heroTitle = document.getElementById('heroTitle');
  if (heroEyebrow) heroEyebrow.textContent = CONFIG.durationMin + ' MIN AMRAP';
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
  if (timerDigits && !loadActive()) timerDigits.textContent = fmtTime(CONFIG.durationMin * 60);
}
function openSettingsModal() {
  document.getElementById('cfgPull').value = CONFIG.pull;
  document.getElementById('cfgPush').value = CONFIG.push;
  document.getElementById('cfgSquat').value = CONFIG.squat;
  document.getElementById('cfgDuration').value = CONFIG.durationMin;
  document.getElementById('settingsModal').classList.add('active');
}
function saveSettings() {
  const cfg = {
    pull: Math.max(0, parseInt(document.getElementById('cfgPull').value, 10) || 0),
    push: Math.max(0, parseInt(document.getElementById('cfgPush').value, 10) || 0),
    squat: Math.max(0, parseInt(document.getElementById('cfgSquat').value, 10) || 0),
    durationMin: Math.max(1, parseInt(document.getElementById('cfgDuration').value, 10) || DEFAULT_CONFIG.durationMin)
  };
  saveConfig(cfg);
  closeModal('settingsModal');
  showToast('บันทึกโปรโตคอลแล้ว');
}
function resetSettingsDefault() {
  document.getElementById('cfgPull').value = DEFAULT_CONFIG.pull;
  document.getElementById('cfgPush').value = DEFAULT_CONFIG.push;
  document.getElementById('cfgSquat').value = DEFAULT_CONFIG.squat;
  document.getElementById('cfgDuration').value = DEFAULT_CONFIG.durationMin;
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
  const workoutActive = document.getElementById('screen-workout').classList.contains('active');
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
  const now = Date.now();
  const active = {
    id: 'w_' + now,
    startTime: now,
    endTime: now + DURATION_MS,
    isPaused: false,
    pausedRemainingMs: null,
    roundsSaved: 0,
    roundLog: [], // {number, pull, push, squat, time} time = elapsed seconds since start
    skipLog: []   // {time} rounds skipped — never counted toward roundsSaved
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
        <div class="date">${fmtDate(s.finished)}</div>
        <div class="reps">${s.total.reps} REPS</div>
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
function shareResult(id) {
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

  canvas.toBlob(async (blob) => {
    if (!blob) { showToast('สร้างรูปไม่สำเร็จ'); return; }
    const file = new File([blob], 'cindy_result.png', { type: 'image/png' });
    if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], title: 'CINDY Result', text: s.rounds + ' rounds — CINDY AMRAP' });
        return;
      } catch (e) { /* cancelled — fall through to download */ }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = 'cindy_result_' + s.id + '.png';
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('บันทึกรูปผลลัพธ์แล้ว');
  }, 'image/png');
}

/* ================= BACKUP (Export / Import) ================= */
function exportData() {
  const sessions = loadSessions();
  if (sessions.length === 0) { showToast('ยังไม่มีข้อมูลให้ส่งออก'); return; }
  const payload = { app: 'CINDY', version: 1, exportedAt: Date.now(), sessions };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const d = new Date();
  const fname = 'cindy_backup_' + d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '.json';
  const a = document.createElement('a');
  a.href = url; a.download = fname;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('ส่งออกข้อมูลแล้ว');
}

function importData(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(reader.result);
      const incoming = Array.isArray(parsed) ? parsed : parsed.sessions;
      if (!Array.isArray(incoming)) throw new Error('invalid format');
      const existing = loadSessions();
      const byId = new Map(existing.map(s => [s.id, s]));
      let added = 0;
      incoming.forEach(s => {
        if (s && s.id && s.finished && s.total) {
          if (!byId.has(s.id)) added++;
          byId.set(s.id, s);
        }
      });
      const merged = Array.from(byId.values()).sort((a, b) => a.finished - b.finished);
      saveSessions(merged);
      showToast('นำเข้าข้อมูลแล้ว (' + added + ' รายการใหม่)');
      renderProgress();
    } catch (e) {
      showToast('ไฟล์ไม่ถูกต้อง');
    }
  };
  reader.readAsText(file);
  event.target.value = '';
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
