/* ===== CINDY — App Logic ===== */
const RING_CIRC = 2 * Math.PI * 108;
const KEY_SESSIONS = 'cindy_sessions';
const KEY_ACTIVE = 'cindy_active_workout';
const KEY_LAST_SEEN_LEVEL = 'cindy_last_seen_level';

/* ================= SCHEMA / MIGRATIONS =================
 * Single version stamp in localStorage + a chokepoint that runs once per
 * app load. Future fields get backfilled onto old data here instead of at
 * every save/load call site — keeps the fragility in one place instead of
 * scattered across the many localStorage touches in this file.
 * Each migration must be idempotent (safe to re-run) since a stamp write
 * failing mid-way must not corrupt anything on retry. */
const KEY_SCHEMA_VERSION = 'cindy_schema_version';
const CURRENT_SCHEMA_VERSION = 1;

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
  muscle: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M2 13c0-2 1.3-3 3-3 .3-1.6 1.4-2.5 3-2.5 2 0 3 1.3 3 3.2V15c1.6-1 2.6-.7 3.4.3.5-2 1.7-3 3.6-3 2.3 0 4 1.8 4 4.3 0 3-2.3 5.2-5.6 5.2H8.4C4.8 21.8 2 19 2 15.3z"/></svg>'
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
    story: 'ต่อขึ้นจากเศษเหล็กที่ทิ้งไว้ตอนเลิกกลางคัน มันคือด่านแรกที่ทุกคนต้องเจอ — แค่ลุกมาเริ่มในวันที่ไม่อยากขยับตัวเลย GRINDER-1 ไม่ได้แข็งแกร่ง มันแค่รอให้คุณยอมแพ้ก่อนยกแรก' },
  { id: 'ironmaw', name: 'IRON MAW', tag: 'SPLIT JAW', baseHp: 350, accent: '#8aa0b8',
    bg: 'assets/boss-backgrounds/bg-ironmaw.png',
    story: 'ขากรรไกรเหล็กที่งับกลืนแรงจูงใจของนักสู้ที่เริ่มชินชากับกิจวัตรเดิม ๆ มันคือกำแพงเมื่อทุกอย่างเริ่ม "ง่ายเกินไป" จนลืมไปว่าความชินชาคือจุดที่คนส่วนใหญ่หยุดพัฒนา' },
  { id: 'void9', name: 'VOID-9', tag: 'FORMLESS THREAT', baseHp: 450, accent: '#a855f7',
    bg: 'assets/boss-backgrounds/bg-void9.png',
    story: 'ไม่มีรูปร่างตายตัว เปลี่ยนหน้ากากไปเรื่อยตามข้ออ้างของแต่ละวัน — งานยุ่ง นอนไม่พอ ไม่มีอารมณ์ VOID-9 คือความไม่สม่ำเสมอที่กัดกร่อน streak จากข้างในโดยไม่ทันรู้ตัว' },
  { id: 'wingreaper', name: 'WING REAPER', tag: 'SKY HUNTER', baseHp: 550, accent: '#38bdf8',
    bg: 'assets/boss-backgrounds/bg-wingreaper.png',
    story: 'โฉบลงมาตอนที่มั่นใจที่สุด เมื่อเริ่มฝืนหักโหมเกินร่างกายจะรับไหว WING REAPER คือเงาของอาการบาดเจ็บและ burnout ที่คอยจับตาอยู่บนฟ้า รอจังหวะที่ความทะเยอทะยานมาเกินความอดทน' },
  { id: 'corezero', name: 'CORE-ZERO', tag: 'FINAL REACTOR', baseHp: 700, accent: '#fbbf24',
    bg: 'assets/boss-backgrounds/bg-corezero.png',
    story: 'แกนปฏิกรณ์ที่หลอมจากทุกวันที่เคยเลิกล้ม มันคือภาพของตัวเองในเวอร์ชันก่อนเริ่มฝึก ยังคงยืนรอเป็นด่านสุดท้ายเสมอ เพราะบอสตัวจริงไม่เคยเป็นใครอื่นนอกจากคนที่คุณเคยเป็น' }
];
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
const LOOT_ITEMS = [
  { id: 'scrapPlate',    name: 'แผ่นเกราะเศษเหล็ก',   icon: 'gearCog', rarity: 'common',
    img: 'assets/loot/scrapPlate.png',
    lore: 'ปะติดปะต่อจากเศษเกราะที่เก็บได้หลังศึกแรก ๆ ยังไม่สวยหรู แต่กันได้ทุกหมัดแรกที่ไม่มีใครกันให้' },
  { id: 'wornGrip',      name: 'ผ้าพันมือเก่า',       icon: 'mitten',  rarity: 'common',
    img: 'assets/loot/wornGrip.png',
    lore: 'ผ้าพันมือผืนแรกที่แลกมาด้วยเหงื่อ เก่าจนสีซีดแต่ไม่เคยขาดแม้แต่เซตเดียว' },
  { id: 'basicShield',   name: 'โล่ฝึกหัด',           icon: 'shield',  rarity: 'common',
    img: 'assets/loot/basicShield.png',
    lore: 'โล่ไม้แผ่นแรกที่ใช้ฝึกรับแรงกระแทก รอยบุบทุกรอยคือบทเรียนของวันที่ยังไม่แข็งแรงพอ' },
  { id: 'ironFang',      name: 'เขี้ยว IRON MAW',      icon: 'fang',    rarity: 'uncommon',
    img: 'assets/loot/ironFang.png',
    lore: 'เขี้ยวที่หลุดจากขากรรไกรของ IRON MAW ตอนมันพ่ายให้ความแข็งแกร่งที่ฝึกมาไม่หยุด' },
  { id: 'scoutScarf',    name: 'ผ้าพันคอสอดแนม',      icon: 'scarf',   rarity: 'uncommon',
    img: 'assets/loot/scoutScarf.png',
    lore: 'ผ้าพันคอของนักสอดแนมที่แอบตามดูฟอร์มการฝึกอยู่ไกล ๆ ก่อนยอมมอบให้ด้วยความเคารพ' },
  { id: 'trainerGi',     name: 'ชุดฝึกซ้อมเก่าแก่',    icon: 'gi',      rarity: 'uncommon',
    img: 'assets/loot/trainerGi.png',
    lore: 'ชุดฝึกของครูฝึกรุ่นก่อน ส่งต่อกันมาให้คนที่พิสูจน์แล้วว่าไม่ยอมแพ้กลางทาง' },
  { id: 'voidShard',     name: 'เศษเสี้ยว VOID',       icon: 'vortex',  rarity: 'rare',
    img: 'assets/loot/voidShard.png',
    lore: 'เศษเสี้ยวที่หลุดออกจากร่าง VOID-9 หลังมันแตกสลาย ยังสั่นไหวราวกับมีพลังงานเหลืออยู่ในนั้น' },
  { id: 'reaperFeather', name: 'ขนปีก WING REAPER',    icon: 'wing',    rarity: 'rare',
    img: 'assets/loot/reaperFeather.png',
    lore: 'ขนปีกที่ร่วงจาก WING REAPER ตอนมันโฉบลงมาท้าทาย แล้วพ่ายให้ความอึดที่ไม่มีวันหมด' },
  { id: 'grinderCog',    name: 'เฟือง GRINDER-1',      icon: 'gearCog', rarity: 'epic',
    img: 'assets/loot/grinderCog.png',
    lore: 'เฟืองหลักของ GRINDER-1 ที่หยุดหมุนเป็นครั้งแรกในรอบหลายสัปดาห์ เมื่อเจอแรงที่มันหยุดไม่ได้' },
  { id: 'coreFragment',  name: 'ชิ้นส่วนแกนปฏิกรณ์',   icon: 'core',    rarity: 'epic',
    img: 'assets/loot/coreFragment.png',
    lore: 'ชิ้นส่วนแกนปฏิกรณ์จาก CORE-ZERO ยังเปล่งแสงจาง ๆ เหมือนไม่ยอมรับว่าตัวเองพ่ายไปแล้ว' },
  { id: 'twinBlades',    name: 'ดาบคู่นักรบ',          icon: 'swordsCross', rarity: 'epic',
    img: 'assets/loot/twinBlades.png',
    lore: 'ดาบคู่ที่ตีขึ้นจากชัยชนะติดต่อกันหลายศึก แต่ละครั้งที่ฟันคือแรงที่สะสมมาโดยไม่มีวันหยุด' },
  { id: 'championCrown', name: 'มงกุฎผู้พิชิต',        icon: 'crown',   rarity: 'mythic',
    img: 'assets/loot/championCrown.png',
    lore: 'มงกุฎที่มอบให้เฉพาะผู้พิชิตทุก Boss ในสังเวียน สัญลักษณ์ของนักสู้ที่ไม่เคยเลิกกลางคัน' },
  { id: 'phoenixCore',   name: 'แก่นเพลิงอมตะ',        icon: 'flame',   rarity: 'mythic',
    img: 'assets/loot/phoenixCore.png',
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
  const damage = cindyDamage + customDamage;

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

let bossBattleTimer = null;
function startBossBattleCutscene(session, isCustom, onDone) {
  const sessionDmg = isCustom ? totalVolumeOfCustomSession(session) : session.total.reps;
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
  if (!nameEl || !stage || !hpFill) { onDone(); return; }

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
  logEl.textContent = 'เตรียมตัว...';

  let hp = beforeHp;
  let i = 0;
  let finished = false;
  function finish() {
    if (finished) return;
    finished = true;
    clearTimeout(bossBattleTimer);
    bossBattleTimer = null;
    skipBtn.onclick = null;
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
    logEl.textContent = turn.label + ' x' + turn.dmg + ' — โจมตี!';
    vibrate([30]);
    bossBattleTimer = setTimeout(step, 800);
  }
  skipBtn.onclick = finish;
  bossBattleTimer = setTimeout(step, 450);
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
  list.innerHTML = BOSS_ROSTER.map((boss, i) => {
    const current = boss.id === state.boss.id;
    const next = i === (idx + 1) % BOSS_ROSTER.length;
    return `<div class="boss-view-item${current ? ' current' : ''}">
      <div class="boss-view-item-top">
        <div>
          <div class="boss-view-item-name">${boss.name}</div>
          <div class="boss-view-item-tag">${boss.tag}</div>
        </div>
        <div class="boss-view-item-status">${current ? 'CURRENT' : (next ? 'NEXT WEEK' : 'UPCOMING')}</div>
      </div>
      ${boss.story ? `<div class="boss-view-item-story">${boss.story}</div>` : ''}
    </div>`;
  }).join('');
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
  document.querySelectorAll('[data-boss-close]').forEach(el => el.addEventListener('click', closeBossView));
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
  // last stretch of a fight gets a red pulse — the "finish it off" nudge
  stage.classList.toggle('boss-critical', !state.defeated && pct > 0 && pct <= 0.25);

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
    const loot = rollLootDrop(state);
    const lootCount = addLootItem(loot.id);
    const lootRarity = rarityDef(loot.rarity);
    let msg = 'ปราบ ' + state.boss.name + ' สำเร็จ!';
    if (firstTimeEver) msg += ' ปลดล็อคสกิน Mascot ใหม่ ·';
    msg += ' ได้ [' + lootRarity.label + '] ' + loot.name + (lootCount > 1 ? ' x' + lootCount : '');
    showToast(msg, firstTimeEver ? 'palette' : 'gift');
  }
  renderBossDmgBreakdown();
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

  return { pull, push, squat, custom, cardio };
}
function renderBossDmgBreakdown() {
  const wrap = document.getElementById('bossDmgBreakdown');
  if (!wrap) return;
  const dmg = currentBossDamageBreakdown();
  const rows = [
    { label: 'PULL', val: dmg.pull, color: 'var(--pull)' },
    { label: 'PUSH', val: dmg.push, color: 'var(--push)' },
    { label: 'SQUAT', val: dmg.squat, color: 'var(--squat)' }
  ];
  if (dmg.custom > 0) rows.push({ label: 'CUSTOM', val: dmg.custom, color: 'var(--success)' });
  if (dmg.cardio > 0) rows.push({ label: 'CARDIO', val: dmg.cardio, color: 'var(--danger)' });
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

/* ---------- navigation ---------- */
function go(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById('screen-' + name).classList.add('active');
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => {
    if (t.getAttribute('onclick') === "go('" + name + "')") t.classList.add('active');
  });
  if (name === 'home') renderHome();
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
}

/* ================= HOME (dashboard) ================= */
/**
 * Home is now a combined dashboard summarizing both Cindy and Custom
 * Workouts: mascot status, today's plan, a weekly progress ring split by
 * mode, and the single most recent workout regardless of which mode it
 * came from. Mode-specific starting/browsing UI lives on the Program tab
 * (see renderProgram()).
 */
function renderHome() {
  renderMascotCard();
  renderHomeWeeklyPlanCard();
  renderBossCard();
  renderWeekRing();
  renderHomeLastWorkout();
  renderTreasureChest();
  renderDailyQuests();
}

/** Combined streak across Cindy sessions + Custom Workout sessions. */
function computeCombinedStreak() {
  const cindyDays = loadSessions().map(s => dayKey(s.finished));
  const customDays = loadCustomWorkoutSessions().map(s => dayKey(s.completedAt));
  const days = new Set(cindyDays.concat(customDays));
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
    check: (ctx) => ctx.customPlayedToday }
];
function todayQuestContext() {
  const todayKey = dayKey(Date.now());
  const cindyToday = loadSessions().filter(s => dayKey(s.finished) === todayKey);
  const customToday = loadCustomWorkoutSessions().filter(s => dayKey(s.completedAt) === todayKey);
  const cindyRepsToday = cindyToday.reduce((sum, s) => sum + (s.total ? s.total.reps : 0), 0);
  const customRepsToday = customToday.reduce((sum, s) => sum + totalVolumeOfCustomSession(s), 0);
  return {
    playedToday: cindyToday.length > 0 || customToday.length > 0,
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
  return maxCombo >= COMBO_BONUS_MIN ? maxCombo * 2 : 0;
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
 * so mashing skip right at 0:01 isn't a meaningful farm. */
const KEY_REST_SKIP_BONUS_XP = 'cindy_rest_skip_bonus_xp';
const REST_SKIP_BONUS_RATE = 0.5;   // XP per second of rest skipped
const REST_SKIP_BONUS_MIN_SEC = 3;  // below this, no bonus — not worth the toast spam
function restSkipBonusXP(remainingSec) {
  if (!Number.isFinite(remainingSec) || remainingSec < REST_SKIP_BONUS_MIN_SEC) return 0;
  return Math.round(remainingSec * REST_SKIP_BONUS_RATE);
}
function loadRestSkipBonusXP() {
  const n = parseInt(localStorage.getItem(KEY_REST_SKIP_BONUS_XP), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
function addRestSkipBonusXP(amount) {
  if (amount <= 0) return;
  localStorage.setItem(KEY_REST_SKIP_BONUS_XP, String(loadRestSkipBonusXP() + amount));
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
    badge.textContent = 'COMBO x' + combo;
    badge.classList.add('show');
    if (increased) {
      badge.classList.remove('pulse');
      void badge.offsetWidth;
      badge.classList.add('pulse');
      vibrate(20);
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
    const done = q.check(ctx);
    let statusHtml;
    if (claimed) statusHtml = '<div class="quest-claimed">' + iconHtml('check') + ' รับแล้ว</div>';
    else if (done) statusHtml = '<button class="quest-claim-btn" onclick="claimDailyQuest(\'' + id + '\')">รับ +' + q.xp + ' XP</button>';
    else statusHtml = '<div class="quest-xp-tag">+' + q.xp + ' XP</div>';
    return '<div class="quest-row' + (claimed ? ' done' : '') + '">'
      + '<div class="quest-info"><div class="quest-title">' + escapeHtml(q.title) + '</div><div class="quest-desc">' + escapeHtml(q.desc) + '</div></div>'
      + statusHtml
      + '</div>';
  }).join('');
}
function claimDailyQuest(id) {
  const state = loadQuestClaimState();
  if (state.ids.indexOf(id) !== -1) return;
  const q = QUEST_POOL.find(x => x.id === id);
  if (!q || !q.check(todayQuestContext())) return;
  state.ids.push(id);
  saveQuestClaimState(state);
  addQuestBonusXP(q.xp);
  renderDailyQuests();
  renderXpBar();
  vibrate([40, 30, 60]);
  showToast('รับเควสสำเร็จ +' + q.xp + ' XP', 'target');
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

function renderMascotCard() {
  const headline = document.getElementById('mascotHeadline');
  const sub = document.getElementById('mascotSub');
  const img = document.getElementById('mascotImg');
  const imgGlow = document.getElementById('mascotImgGlow');
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
  if (img) img.src = 'assets/mascot/mascot.png';
  if (imgGlow) imgGlow.src = 'assets/mascot/mascot.png';

  renderXpBar();
  applyActiveMascotSkinFilter();
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
  const cindyXP = loadSessions().reduce((sum, s) => sum + (s.total ? s.total.reps : 0), 0);
  const customXP = loadCustomWorkoutSessions().reduce((sum, s) => sum + totalVolumeOfCustomSession(s), 0);
  _xpCache = { cindyXP, customXP };
  return _xpCache;
}
function computeTotalXP() {
  const { cindyXP, customXP } = computeSessionXP();
  return cindyXP + customXP + loadQuestBonusXP() + loadComboBonusXP() + loadRestSkipBonusXP();
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
  const avatar = document.getElementById('mascotAvatar');
  if (!badge || !fill || !label) return;

  const info = computeLevelInfo(computeTotalXP());
  badge.textContent = 'LV.' + info.level;
  fill.style.width = Math.round(info.pct * 100) + '%';
  label.textContent = info.xpIntoLevel + ' / ' + info.xpForNextLevel + ' XP';

  const lastSeen = loadLastSeenLevel();
  if (info.level > lastSeen) {
    saveLastSeenLevel(info.level);
    if (avatar) {
      avatar.classList.remove('level-up-glow');
      void avatar.offsetWidth; // reflow so the animation can replay
      avatar.classList.add('level-up-glow');
      avatar.addEventListener('animationend', () => avatar.classList.remove('level-up-glow'), { once: true });
    }
    badge.classList.remove('bump');
    void badge.offsetWidth;
    badge.classList.add('bump');
    badge.addEventListener('animationend', () => badge.classList.remove('bump'), { once: true });
    vibrate([60, 40, 60]);
    showToast('เลเวลอัพ! ตอนนี้ LV.' + info.level);
  }
  renderRankTag(info.level);
  applyMascotBackdrop(info.level);
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

/* ================= PROGRESSIVE BACKDROP =================
 * First 2 tiers only, wired for an APK smoke test — same "same training
 * ground, evolving with the player" concept as MASCOT_SKINS. Deliberately
 * paired with the same level milestones as the skins (LV.5 etc.) rather than
 * its own unlock track, so a level-up reveals both at once. LV.10/15/20
 * added below continue the same escalation (cyber-energy hall → arcane
 * blue rune circle → gold/crimson legend throne room), each a visibly
 * bigger leap than the last so leveling up keeps paying off visually.
 * User-selectable via the backdrop picker below (same staged/confirm
 * pattern as the skin picker) — the saved pick is used as long as it's
 * still unlocked, otherwise falls back to the highest unlocked tier for
 * the current level. */
const BACKDROPS = [
  { id: 'default', name: 'สนามฝึกเปล่า', img: 'assets/backdrops/bg-default.jpg', unlock: null },
  { id: 'lv5', name: 'สนามเริ่มมีพลังงาน', img: 'assets/backdrops/bg-lv5.jpg',
    unlock: { type: 'level', value: 5 }, cond: 'ถึง LV.5' },
  { id: 'lv10', name: 'สนามฝึกพลังไซเบอร์', img: 'assets/backdrops/bg-lv10.jpg',
    unlock: { type: 'level', value: 10 }, cond: 'ถึง LV.10' },
  { id: 'lv15', name: 'สนามพลังเวทอาถรรพ์', img: 'assets/backdrops/bg-lv15.jpg',
    unlock: { type: 'level', value: 15 }, cond: 'ถึง LV.15' },
  { id: 'lv20', name: 'ห้องบัลลังก์นักสู้ในตำนาน', img: 'assets/backdrops/bg-lv20.jpg',
    unlock: { type: 'level', value: 20 }, cond: 'ถึง LV.20' }
];
function isBackdropUnlocked(bd) {
  if (!bd.unlock) return true;
  if (bd.unlock.type === 'level') return computeLevelInfo(computeTotalXP()).level >= bd.unlock.value;
  return false;
}
/** Highest-tier backdrop the current level has unlocked (BACKDROPS is kept in
 * ascending unlock order, so the last match wins). */
function activeBackdropForLevel(level) {
  let picked = BACKDROPS[0];
  for (const bd of BACKDROPS) {
    if (!bd.unlock) { picked = bd; continue; }
    if (bd.unlock.type === 'level' && level >= bd.unlock.value) picked = bd;
  }
  return picked;
}
/** Applies the right backdrop image to one card element (.mascot-card on
 * Home, or .character-hero-img-wrap on the Character sheet) for the given
 * level. Both elements share the same --backdrop-img + .has-backdrop
 * convention set up in CSS. */
function applyBackdropToEl(el, level) {
  if (!el) return;
  const bd = activeBackdropForDisplay(level);
  el.style.setProperty('--backdrop-img', 'url("' + bd.img + '")');
  el.classList.add('has-backdrop');
}
function applyMascotBackdrop(level) {
  applyBackdropToEl(document.querySelector('.mascot-card'), level);
  applyBackdropToEl(document.querySelector('.character-hero-img-wrap'), level);
}

/* ================= BACKDROP PICKER (user-selectable) =================
 * Lets the player manually choose among unlocked BACKDROPS instead of
 * always showing the auto highest-unlocked tier. Mirrors the mascot skin
 * picker's staged/confirm flow: a tap in the grid only "stages" a pick,
 * nothing is saved/applied until confirmBackdropChange(). */
const KEY_ACTIVE_BACKDROP = 'cindy_active_backdrop';
function loadActiveBackdropId() {
  return localStorage.getItem(KEY_ACTIVE_BACKDROP) || null;
}
function saveActiveBackdropId(id) {
  localStorage.setItem(KEY_ACTIVE_BACKDROP, id);
}
/** Resolves which backdrop should actually be shown: the player's saved
 * pick if it's still unlocked, otherwise the highest tier the current
 * level has unlocked (same behavior as before the picker existed). */
function activeBackdropForDisplay(level) {
  const savedId = loadActiveBackdropId();
  if (savedId) {
    const bd = BACKDROPS.find(b => b.id === savedId);
    if (bd && isBackdropUnlocked(bd)) return bd;
  }
  return activeBackdropForLevel(level);
}
let stagedBackdropId = null;
function openBackdropPicker() {
  const info = computeLevelInfo(computeTotalXP());
  stagedBackdropId = activeBackdropForDisplay(info.level).id;
  renderBackdropGrid();
  document.getElementById('backdropPickerModal').classList.add('active');
}
function stageBackdrop(id) {
  const bd = BACKDROPS.find(b => b.id === id);
  if (!bd || !isBackdropUnlocked(bd)) return;
  stagedBackdropId = id;
  renderBackdropGrid();
}
function renderBackdropGrid() {
  const grid = document.getElementById('backdropGrid');
  if (!grid) return;
  const info = computeLevelInfo(computeTotalXP());
  const activeId = activeBackdropForDisplay(info.level).id;
  const stagedId = stagedBackdropId || activeId;
  grid.innerHTML = BACKDROPS.map(bd => {
    const unlocked = isBackdropUnlocked(bd);
    const isActive = bd.id === activeId;
    const isStaged = bd.id === stagedId;
    const cls = 'backdrop-item' + (isActive ? ' active' : '') + (isStaged && !isActive ? ' staged' : '') + (unlocked ? '' : ' locked');
    const clickAttr = unlocked ? ' onclick="stageBackdrop(\'' + bd.id + '\')"' : '';
    const cornerHtml = isStaged ? '<div class="active-check">' + iconHtml('check') + '</div>' : (unlocked ? '' : '<div class="lock-icon">' + iconHtml('lock') + '</div>');
    const thumbStyle = 'background-image:url(\'' + bd.img + '\');' + (unlocked ? '' : 'filter:grayscale(1) brightness(.5);');
    return '<div class="' + cls + '"' + clickAttr + '>' + cornerHtml +
      '<div class="backdrop-thumb" style="' + thumbStyle + '"></div>' +
      '<div class="skin-name">' + bd.name + '</div>' +
      (unlocked ? '' : '<div class="skin-cond">' + bd.cond + '</div>') +
      '</div>';
  }).join('');
  const bar = document.getElementById('backdropConfirmBar');
  if (bar) bar.classList.toggle('show', stagedId !== activeId);
}
/** Applies the staged backdrop (if different from what's shown) and closes
 * the picker. No one-shot FX here (unlike skins) — the backdrop is a
 * static scene behind the card, so a clean re-render is enough. */
function confirmBackdropChange() {
  const info = computeLevelInfo(computeTotalXP());
  const activeId = activeBackdropForDisplay(info.level).id;
  if (!stagedBackdropId || stagedBackdropId === activeId) {
    closeModal('backdropPickerModal');
    return;
  }
  const bd = BACKDROPS.find(b => b.id === stagedBackdropId);
  if (!bd || !isBackdropUnlocked(bd)) return;
  closeModal('backdropPickerModal');
  saveActiveBackdropId(bd.id);
  applyMascotBackdrop(info.level);
  showToast('เปลี่ยนพื้นหลังเป็น ' + bd.name);
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
  { key: 'squat', label: 'ENDURANCE', short: 'END', color: 'var(--squat)' }
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
/** Lifetime Cindy rep totals per stat (pull/push/squat) — the same raw
 * numbers computeStatInfo() levels up, shared by the stat bars, the
 * derived "class" flavor title, and the CP number so none of them drift
 * out of sync with each other. */
function loadStatTotals() {
  const all = loadSessions();
  const totals = { pull: 0, push: 0, squat: 0 };
  all.forEach(s => {
    if (!s.total) return;
    totals.pull += s.total.pull || 0;
    totals.push += s.total.push || 0;
    totals.squat += s.total.squat || 0;
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

/* ---- derived "class" flavor title — whichever stat (STR/PWR/END) has
 * the most lifetime reps gets a title, so two people at the same level
 * can feel like a different build. Pure lookup on loadStatTotals(),
 * nothing new stored. */
const STAT_CLASS_TITLES = { pull: 'นักดึงข้อ', push: 'นักทุบพลัง', squat: 'นักวิ่งทน' };
function computeClassTitle(totals) {
  if (!totals.pull && !totals.push && !totals.squat) return '';
  let best = 'pull';
  ['push', 'squat'].forEach(k => { if (totals[k] > totals[best]) best = k; });
  return STAT_CLASS_TITLES[best];
}

/* ---- CP (power level) — a single big number combining total XP with
 * the summed levels of all 3 stats, purely derived from numbers already
 * computed elsewhere (computeTotalXP, computeStatInfo). */
function computeCharacterPower() {
  const totalXp = computeTotalXP();
  const totals = loadStatTotals();
  const statLevelSum = STAT_DEFS.reduce((sum, def) => sum + computeStatInfo(totals[def.key]).level, 0);
  return Math.round(totalXp) + statLevelSum;
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

/* ---- equipment slots — the equipped skin + equipped loot badge, both
 * already tracked (loadActiveSkin / equippedLootItem) for the mascot
 * avatar itself; this just surfaces the same two picks as RPG-style
 * equipment slots that link back to where they're changed. */
function renderCharacterEquipment() {
  const skin = MASCOT_SKINS.find(s => s.id === loadActiveSkin()) || MASCOT_SKINS[0];
  const skinIconEl = document.getElementById('characterEquipSkinIcon');
  const skinNameEl = document.getElementById('characterEquipSkinName');
  if (skinIconEl) {
    // Same coin-shell hook used everywhere else on this screen (loot slot,
    // trophy wall) so the SKIN slot doesn't stand out on its own — every
    // skin including the default now has its own custom-designed icon.
    skinIconEl.innerHTML = skinIconHtml(skin, { glow: !!skin.strong });
  }
  if (skinNameEl) skinNameEl.textContent = skin.name;

  const item = equippedLootItem();
  const lootIconEl = document.getElementById('characterEquipLootIcon');
  const lootNameEl = document.getElementById('characterEquipLootName');
  if (lootIconEl) {
    lootIconEl.innerHTML = item
      ? lootBadgeHtml(item, { glow: true, ring: true })
      : lockedBadgeHtml();
  }
  if (lootNameEl) lootNameEl.textContent = item ? item.name : 'ยังไม่ได้สวม';
}
/** Jumps to the Collection screen and scrolls straight to the relevant
 * section (skins or loot) — used by the Character sheet's equipment
 * slots so tapping one goes right to where it's changed. */
function goToCollectionSection(section) {
  go('collection');
  const targetId = section === 'loot' ? 'collectionLootGrid' : 'collectionSkinGrid';
  setTimeout(() => {
    const el = document.getElementById(targetId);
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
  const img = document.getElementById('characterMascotImg');
  const avatar = document.getElementById('characterAvatar');
  const accessory = document.getElementById('characterSkinAccessory');
  const levelBadge = document.getElementById('characterLevelBadge');
  const gear = document.getElementById('characterGearBadge');
  if (!img || !avatar) return;

  const skin = MASCOT_SKINS.find(s => s.id === loadActiveSkin()) || MASCOT_SKINS[0];
  const unlocked = isSkinUnlocked(skin);
  img.src = (unlocked && skin.img) ? skin.img : 'assets/mascot/mascot.png';
  img.style.filter = unlocked ? skin.filter : 'none';

  const hasAura = !!(unlocked && skin.aura);
  avatar.classList.toggle('skin-glow', hasAura);
  avatar.classList.toggle('skin-glow-strong', hasAura && !!skin.strong);
  avatar.style.setProperty('--skin-aura', hasAura ? skin.aura : 'transparent');

  if (accessory) {
    if (unlocked && skin.accIcon) {
      accessory.innerHTML = skinIconHtml(skin, { glow: !!skin.strong });
      accessory.classList.add('show');
    } else {
      accessory.classList.remove('show');
    }
  }

  const info = computeLevelInfo(computeTotalXP());
  if (levelBadge) levelBadge.textContent = 'LV.' + info.level;
  const rank = rankForLevel(info.level);
  const rankEl = document.getElementById('characterRank');
  if (rankEl) {
    rankEl.innerHTML = iconHtml(rank.icon) + ' ' + rank.title;
    RANK_TIERS.forEach(r => rankEl.classList.remove('rank-' + r.title.toLowerCase()));
    rankEl.classList.add('rank-' + rank.title.toLowerCase());
  }
  applyMascotBackdrop(info.level);
  const tier = rank.title.toLowerCase();
  // Character page's img-wrap lives outside .mascot-card's subtree, so it never
  // inherited that element's --mascot-accent-rgb — the rank tint here (and the
  // ::after edge-fade that depends on the same var) was silently a no-op before
  // this. Set it directly on the wrap, same lookup Home's version uses.
  const heroWrap = document.querySelector('.character-hero-img-wrap');
  if (heroWrap) heroWrap.style.setProperty('--mascot-accent-rgb', hexToRgbTriplet(RANK_ACCENT_HEX[tier] || RANK_ACCENT_HEX.recruit));
  RANK_TIERS.forEach(r => avatar.classList.remove('aura-' + r.title.toLowerCase()));
  if (tier !== 'recruit') avatar.classList.add('aura-' + tier);
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

  renderMascotTitle('characterSkinTitle', skin, unlocked);
  applyEquippedLootBadge('characterLootBadge');
  renderStatBars('characterStatBarList');

  const cpEl = document.getElementById('characterCP');
  if (cpEl) {
    cpEl.innerHTML = '<div class="character-cp-val">' + computeCharacterPower().toLocaleString() + '</div>'
      + '<div class="character-cp-lbl">CP</div>';
  }
  const classEl = document.getElementById('characterClassTitle');
  if (classEl) classEl.textContent = computeClassTitle(loadStatTotals());

  renderCharacterEquipment();
  renderCharacterBossTrophyRow();
  renderCharacterRecentLog();
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
 * (rank badge alone covers that case). */
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
/* ================= COMPANION HUD (Custom Workout player) =================
 * Small corner mascot shown while a Custom Workout is in progress, wearing
 * whatever skin is currently equipped on Home — same lookup, just a
 * different, smaller target element so it isn't a duplicate skin system.
 * It reacts (a quick bounce) whenever a rest-skip bonus lands, tying the
 * in-workout moment back to the same mascot card on Home. */
function applyCompanionHudSkin() {
  const img = document.getElementById('playerCompanionImg');
  const hud = document.getElementById('playerCompanionHud');
  if (!img || !hud) return;
  const skin = MASCOT_SKINS.find(s => s.id === loadActiveSkin()) || MASCOT_SKINS[0];
  const unlocked = isSkinUnlocked(skin);
  img.src = (unlocked && skin.img) ? skin.img : 'assets/mascot/mascot.png';
  img.style.filter = unlocked ? skin.filter : 'none';
  const hasAura = !!(unlocked && skin.aura);
  hud.classList.toggle('skin-glow', hasAura);
  hud.style.setProperty('--skin-aura', hasAura ? skin.aura : 'transparent');
  applyEquippedLootBadge('playerCompanionLootBadge');
}
/** Rest-skip bonus visual: a bouncing "+N XP" badge on the timer ring
 * (same pop/scale language as the AMRAP screen's .combo-badge, just a
 * cooler-toned gradient so it doesn't read as a combo) plus a quick bounce
 * on the companion mascot HUD. */
function showRestSkipBonusEffect(bonus) {
  const badge = document.getElementById('restBonusBadge');
  if (badge) {
    badge.textContent = '+' + bonus + ' XP';
    badge.classList.remove('show', 'pulse');
    void badge.offsetWidth;
    badge.classList.add('show', 'pulse');
    clearTimeout(showRestSkipBonusEffect._h);
    showRestSkipBonusEffect._h = setTimeout(() => badge.classList.remove('show'), 900);
  }
  const hud = document.getElementById('playerCompanionHud');
  if (hud) {
    hud.classList.remove('companion-react');
    void hud.offsetWidth;
    hud.classList.add('companion-react');
  }
}

/* Selection made inside the picker is only "staged" until confirmed —
 * nothing is saved/applied to the avatar until confirmMascotSkinChange().
 * Resets to the currently-equipped skin every time the modal opens. */
let stagedSkinId = null;
function openSkinPicker() {
  stagedSkinId = loadActiveSkin();
  renderSkinGrid();
  document.getElementById('skinPickerModal').classList.add('active');
}
function stageMascotSkin(id) {
  const skin = MASCOT_SKINS.find(s => s.id === id);
  if (!skin || !isSkinUnlocked(skin)) return;
  stagedSkinId = id;
  renderSkinGrid();
}
function renderSkinGrid() {
  const grid = document.getElementById('skinGrid');
  if (!grid) return;
  const activeId = loadActiveSkin();
  const stagedId = stagedSkinId || activeId;
  grid.innerHTML = MASCOT_SKINS.map(skin => {
    const unlocked = isSkinUnlocked(skin);
    const isActive = skin.id === activeId;
    const isStaged = skin.id === stagedId;
    const cls = 'skin-item' + (isActive ? ' active' : '') + (isStaged && !isActive ? ' staged' : '') + (unlocked ? '' : ' locked');
    const clickAttr = unlocked ? ' onclick="stageMascotSkin(\'' + skin.id + '\')"' : '';
    const cornerHtml = isStaged ? '<div class="active-check">' + iconHtml('check') + '</div>' : (unlocked ? '' : '<div class="lock-icon">' + iconHtml('lock') + '</div>');
    const thumbFilter = unlocked ? skin.filter : 'grayscale(1) brightness(.4)';
    const thumbShadow = unlocked && skin.aura ? 'box-shadow:0 0 ' + (skin.strong ? '14px 3px' : '9px 2px') + ' ' + skin.aura + ';border-radius:50%;' : '';
    const accessoryHtml = unlocked && skin.icon ? '<div class="skin-thumb-accessory">' + skinIconHtml(skin, { glow: !!skin.strong }) + '</div>' : '';
    const thumbSrc = (unlocked && skin.img) ? skin.img : 'assets/mascot/mascot.png';
    return '<div class="' + cls + '"' + clickAttr + '>' + cornerHtml +
      '<div class="skin-thumb-wrap" style="' + thumbShadow + '"><img src="' + thumbSrc + '" style="filter:' + thumbFilter + ';" alt="" />' + accessoryHtml + '</div>' +
      '<div class="skin-name">' + skin.name + '</div>' +
      (unlocked ? '' : '<div class="skin-cond">' + skin.cond + '</div>') +
      '</div>';
  }).join('');
  const bar = document.getElementById('skinConfirmBar');
  if (bar) bar.classList.toggle('show', stagedId !== activeId);
}
/** Applies the staged skin (if different from what's equipped) and plays
 * the one-shot equip effect on the home avatar. Closes the picker first so
 * the effect is visible immediately behind it, no lingering overlay. */
function confirmMascotSkinChange() {
  const activeId = loadActiveSkin();
  if (!stagedSkinId || stagedSkinId === activeId) {
    closeModal('skinPickerModal');
    return;
  }
  const skin = MASCOT_SKINS.find(s => s.id === stagedSkinId);
  if (!skin || !isSkinUnlocked(skin)) return;
  closeModal('skinPickerModal');
  saveActiveSkin(skin.id);
  playMascotSkinChangeEffect(skin);
  showToast('เปลี่ยนสกินเป็น ' + skin.name);
}
/** One-shot equip effect: expanding ring + particle burst tinted to the
 * new skin's own aura color, with the avatar art cross-fading to the new
 * skin at the burst's peak. Never loops — plays once per confirm, then the
 * .play class is removed so it can be re-triggered next time. */
function playMascotSkinChangeEffect(skin) {
  const avatar = document.getElementById('mascotAvatar');
  const fx = document.getElementById('mascotSkinFx');
  if (!avatar || !fx) { applyActiveMascotSkinFilter(); return; }
  const fxColor = skin.aura || 'rgba(255,255,255,.6)';
  avatar.style.setProperty('--fx-color', fxColor);
  fx.classList.remove('play');
  void fx.offsetWidth; // restart animation
  fx.classList.add('play');
  avatar.classList.add('skin-fx-swap');
  setTimeout(() => {
    applyActiveMascotSkinFilter();
    avatar.classList.remove('skin-fx-swap');
    avatar.classList.remove('skin-fx-bounce');
    void avatar.offsetWidth;
    avatar.classList.add('skin-fx-bounce');
  }, 220);
  setTimeout(() => {
    fx.classList.remove('play');
    avatar.classList.remove('skin-fx-bounce');
  }, 1000);
}
/* ================= COLLECTION / TROPHY ROOM =================
 * One screen combining the three collectible sets that already exist
 * elsewhere (chest badges, mascot skins, rank titles). Nothing new is
 * stored — each grid just reuses the same unlock checks as the chest
 * modal and skin picker, rendered with the same .skin-item card. */
function renderCollection() {
  renderCollectionBadges();
  renderCollectionSkins();
  renderCollectionTitles();
  renderLootGrid('collectionLootGrid');
  const badgeCount = STREAK_MILESTONES.filter(m => loadOpenedChests().indexOf(m) !== -1).length;
  const skinCount = MASCOT_SKINS.filter(isSkinUnlocked).length;
  const titleCount = RANK_TIERS.filter(r => loadLastSeenLevel() >= r.min).length;
  const summary = document.getElementById('collectionSummary');
  if (summary) {
    summary.textContent = 'สะสมแล้ว ' + (badgeCount + skinCount + titleCount) + ' / ' + (STREAK_MILESTONES.length + MASCOT_SKINS.length + RANK_TIERS.length);
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
function renderCollectionSkins() {
  const grid = document.getElementById('collectionSkinGrid');
  if (!grid) return;
  const activeId = loadActiveSkin();
  grid.innerHTML = MASCOT_SKINS.map(skin => {
    const unlocked = isSkinUnlocked(skin);
    const isActive = skin.id === activeId;
    const cls = 'skin-item' + (isActive ? ' active' : '') + (unlocked ? '' : ' locked');
    const thumbFilter = unlocked ? skin.filter : 'grayscale(1) brightness(.4)';
    const thumbShadow = unlocked && skin.aura ? 'box-shadow:0 0 ' + (skin.strong ? '14px 3px' : '9px 2px') + ' ' + skin.aura + ';border-radius:50%;' : '';
    const accessoryHtml = unlocked && skin.icon ? '<div class="skin-thumb-accessory">' + skinIconHtml(skin, { glow: !!skin.strong }) + '</div>' : '';
    const thumbSrc = (unlocked && skin.img) ? skin.img : 'assets/mascot/mascot.png';
    return '<div class="' + cls + '">'
      + (isActive ? '<div class="active-check">' + iconHtml('check') + '</div>' : (unlocked ? '' : '<div class="lock-icon">' + iconHtml('lock') + '</div>'))
      + '<div class="skin-thumb-wrap" style="' + thumbShadow + '"><img src="' + thumbSrc + '" style="filter:' + thumbFilter + ';" alt="" />' + accessoryHtml + '</div>'
      + '<div class="skin-name">' + skin.name + '</div>'
      + (unlocked ? '' : '<div class="skin-cond">' + skin.cond + '</div>')
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
  return loadCustomWorkoutSessions().some(s => dayKey(s.completedAt) === todayKey);
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
  active.combo = 0;
  saveActive(active);
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

  const maxCombo = active.maxCombo || 0;
  const comboBonusXp = comboBonusForMaxCombo(maxCombo);
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
  });
}

function renderCompleteScreen(session) {
  document.getElementById('completeRounds').textContent = session.rounds;
  document.getElementById('cTotalReps').textContent = session.total.reps;
  const avgRoundSec = session.rounds > 0 ? session.duration / session.rounds : 0;
  document.getElementById('cAvgRound').textContent = fmtTime(avgRoundSec);
  document.getElementById('bdPull').textContent = session.total.pull;
  document.getElementById('bdPush').textContent = session.total.push;
  document.getElementById('bdSquat').textContent = session.total.squat;

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
  const merged = cindyItems.concat(customItems).sort((a, b) => b.ts - a.ts);

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
          <div class="date">${fmtDate(s.finished)}<span class="type-tag cindy">CINDY</span>${s.mode === 'emom' ? ' <span class="proto-active-tag">EMOM</span>' : ''}</div>
          <div class="reps">${s.total.reps} REPS · ${escapeHtml(s.protocolName || 'Cindy')}</div>
        </div>
        <div class="rounds">${s.rounds} R</div>
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
  renderStatBars();
  renderProgressRecords();

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
  let merged = cindyItems.concat(customItems);

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
      <div class="rounds tabular" style="color:var(--warning);">🏆</div>
    </div>`;
  }).join('');
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
  showToast('ยังไม่ได้เล่น CINDY วันนี้เลยนะ', 'web');
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
        title: 'CINDY Custom Workout Result',
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
        await navigator.share({ files: [file], title: 'CINDY Custom Workout Result', text: s.setsCompleted + ' sets — ' + (s.workoutName || 'Custom Workout') });
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
 * escape hatch if someone changes their mind after the fact. */
function openResetCharacterModal() {
  document.getElementById('resetCharacterModal').classList.add('active');
}
function resetCharacterExecute() {
  Object.keys(localStorage).forEach(k => {
    if (k.startsWith('cindy_') || k === 'custom_workouts' || k === 'custom_workout_sessions') {
      localStorage.removeItem(k);
    }
  });
  closeModal('resetCharacterModal');
  showToast('รีเซ็ตตัวละครแล้ว');
  setTimeout(() => location.reload(), 500);
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

   v3: also covers mascot progression (level/streak-chest/boss unlocks and
   the equipped skin — none of which lived in `sessions`, so a v2 backup
   would restore workout history but silently reset every unlocked skin,
   including bossVoid9, back to locked) plus the small settings/state
   pieces (theme, voice cues, reminder, active protocol, quests/combo
   bonus XP, ring goals, weekly plan). Achievement-style lists (opened
   chests, defeated bosses) are unioned like the v2 collections; single
   values that aren't naturally mergeable only fill in if this device
   doesn't already have one set, so importing a backup never clobbers
   whatever's already active on the device it's imported into; running
   XP counters take the max of the two rather than adding, since adding
   would double-count XP that's also embedded in the session history. */
function exportData() {
  try {
    const sessions = loadSessions();
    const customWorkouts = loadCustomWorkouts();
    const customWorkoutSessions = loadCustomWorkoutSessions();
    const customProtocols = loadCustomProtocols();
    const streakChestsOpened = loadOpenedChests();
    const bossEverDefeated = loadBossEverDefeated();

    if (!sessions.length && !customWorkouts.length && !customWorkoutSessions.length &&
        !customProtocols.length && !streakChestsOpened.length && !bossEverDefeated.length) {
      showToast('ยังไม่มีข้อมูลให้ส่งออก');
      return;
    }

    const payload = {
      app: 'CINDY',
      version: 3,
      exportedAt: Date.now(),
      sessions,
      customWorkouts,
      customWorkoutSessions,
      customProtocols,
      progression: {
        lastSeenLevel: loadLastSeenLevel(),
        streakChestsOpened,
        bossEverDefeated,
        activeSkin: loadActiveSkin()
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
  const blob = new Blob([json], { type: 'application/json' });

  if (window.showSaveFilePicker) {
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
      if (e && e.name === 'AbortError') return; // user cancelled the save dialog
      // any other failure (e.g. permission denied) falls through below
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
  const link = document.getElementById('exportManualLink');
  if (link) {
    if (url) {
      link.href = url; link.download = fname;
      link.style.display = '';
    } else {
      link.style.display = 'none'; // couldn't even build a blob URL — copy is the only option
    }
  }
  const ta = document.getElementById('exportManualText');
  if (ta) ta.value = json;
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
      const incomingProgression = Array.isArray(parsed) ? null : parsed.progression;
      const incomingSettings = Array.isArray(parsed) ? null : parsed.settings;
      const incomingQuestsAndGoals = Array.isArray(parsed) ? null : parsed.questsAndGoals;

      if (!Array.isArray(incomingSessions) && !Array.isArray(incomingWorkouts) &&
          !Array.isArray(incomingWorkoutSessions) && !Array.isArray(incomingProtocols) &&
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
        if (Number.isFinite(incomingProgression.lastSeenLevel)) {
          saveLastSeenLevel(Math.max(loadLastSeenLevel(), incomingProgression.lastSeenLevel));
        }
        if (incomingProgression.activeSkin && loadActiveSkin() === 'default') {
          saveActiveSkin(incomingProgression.activeSkin);
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
  showToast('ติดตั้ง CINDY สำเร็จ', 'muscle');
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
  runMigrationsIfNeeded();
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
    supersetWithNext: false    // true = skip the rest-before-next-exercise, flow straight into it
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
    // e.g. [{ name:'Push-up', exIndex:0, setNumber:1, repsOrSecDone:15, type:'reps' }, ...]
    exerciseLog: Array.isArray(session.exerciseLog) ? session.exerciseLog : [],
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
  if (field === 'name') {
    customEditorDraft.exercises[idx][field] = value;
  } else if (field === 'weight') {
    customEditorDraft.exercises[idx][field] = Math.max(0, parseFloat(value) || 0);
  } else if (field === 'supersetWithNext') {
    customEditorDraft.exercises[idx][field] = !!value;
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
  customPlayer.exerciseLog.push({ name: ex.name, exIndex: customPlayer.exIndex, setNumber: customPlayer.setIndex + 1, repsOrSecDone: value, type: ex.type || 'reps', weight: ex.weight || 0 });
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
    if (!(entry.name in totals)) { totals[entry.name] = { value: 0, type: entry.type, weight: entry.weight || 0 }; order.push(entry.name); }
    totals[entry.name].value += entry.repsOrSecDone;
  });
  if (!order.length) return '<div class="empty-hint">ไม่มีข้อมูลท่าออกกำลังกาย</div>';
  return order.map(name => {
    const t = totals[name];
    const unit = t.type === 'time' ? 'วินาที' : 'ครั้ง';
    const weightTag = t.weight > 0 ? ' · ' + t.weight + ' กก.' : '';
    return `<div class="breakdown-row"><span class="breakdown-name">${escapeHtml(name)}${weightTag}</span><span class="breakdown-val">${t.value} <span style="font-size:11px;color:var(--text-faint);">${unit}</span></span></div>`;
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


document.addEventListener('DOMContentLoaded', initBossView);
