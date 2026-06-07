// Procedural audio — a zero-dependency Web Audio engine. EVERYTHING is synthesized at runtime; there
// are no asset files (keeps the project dependency-free + build-free). It produces:
//   • a generative pentatonic "xianxia" music bed that changes its MOOD per sidebar view (a THEME): the
//     drone, scale/mode, tempo, melody density, lead, percussion, sparkle and reverb are all
//     theme-parameterised, so the Market bustles, the Almanac hushes like a library, Formation builds
//     tension, the Character page plays the soaring hero theme, etc. (THEMES below). Theme switches
//     crossfade (dip → swap drone → restore) so moving tabs feels like a scene change, not a cut.
//   • reactive BATTLE intensity — on the Battle tab a frontier assault swaps to an engaged/boss theme.
//   • one-shot SFX — hit / crit / miss / death / breakthrough / gacha / victory / defeat / forge / click.
//
// Browsers block audio until a user gesture, so the AudioContext is created + resumed on the first
// interaction (init() wires a one-time listener). Prefs persist in S().settings.audio =
// {bgm,sfx (0–10), bgmMuted,sfxMuted} — independent BGM + SFX buses driven by the gear settings panel;
// all reads tolerate a null state (title screen), missing fields, and the legacy {muted,volume} via prefs().
//
// SAFE TO IMPORT IN NODE: nothing touches window/AudioContext at module load — only inside functions
// invoked at runtime — so headless tests that pull in a system file never trip on it.
import { S } from '../state.js';

let ctx = null;        // AudioContext (created lazily on first gesture)
let master = null;     // master GainNode (always 1.0) → destination
let bgmGain = null;    // BGM bus level (user 0–10 + mute) — all music routes through here
let sfxGain = null;    // SFX bus level (user 0–10 + mute) — all one-shots route through here
let musicBus = null;   // music submix (per-theme level) → bgmGain
let fxSend = null;     // feedback-delay send for plucks/leads ("air"/reverb-ish tail)
let started = false;   // is the music loop running?
let schedTimer = null; // look-ahead scheduler interval handle
let droneNodes = [];   // live drone oscillators (recreated each startMusic / theme swap)
let nextNoteTime = 0;  // next melodic step's scheduled time (ctx clock)
let themeStep = 0;     // step counter WITHIN the current theme (drives rhythm + tension build)
let lastMelody = 7;    // index into SCALE for the random-walk melody

const A4 = 440;
const midiToFreq = (m) => A4 * Math.pow(2, (m - 69) / 12);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
// Pentatonic modes — the scales that read as East-Asian. Major = bright/heroic, minor = solemn/mysterious.
const MAJ = [0, 2, 4, 7, 9];
const MIN = [0, 3, 5, 7, 10];

// ---------- THEMES: one mood per sidebar view ----------
// Each theme tunes the generative bed. Fields (see DEFAULT): melody root + scale, step = seconds per
// note (tempo), mix = music level, drone root/intervals/level/tone, pluck density/gain/brightness,
// wander = melodic range, bass/lead/drum cadences, fx = reverb send, sparkle = bright bell notes,
// build = ramp tension over buildCycle steps (Formation).
const DEFAULT = {
  root: 60, scale: MAJ, step: 0.5, mix: 0.55,
  droneRoot: 36, droneSteps: [0, 7, 12], droneGain: 0.10, droneLp: 700,
  pluckProb: 0.6, pluckGain: 0.18, bright: 1.2, wander: 2,
  bassEvery: 4, bassGain: 0.2, leadEvery: 0, leadGain: 0.08, leadAt: 6,
  drumEvery: 0, drumGain: 0.2, drumBig: 0, fx: 0.3, sparkleEvery: 0, build: false, buildCycle: 16,
};
const T = (o) => ({ ...DEFAULT, ...o });
const THEMES = {
  // ⚔ Battle — martial arena, ready stance (calm while idle-farming this tab).
  battle:       T({ root: 57, scale: MIN, step: 0.40, droneRoot: 33, droneSteps: [0, 7, 12], droneGain: 0.12, droneLp: 720, pluckProb: 0.70, bright: 1.4, drumEvery: 4, drumGain: 0.16, fx: 0.20 }),
  // …engaged in a frontier assault (swapped in by scene()).
  battleActive: T({ root: 57, scale: MIN, step: 0.32, mix: 0.58, droneRoot: 33, droneSteps: [0, 7, 12], droneGain: 0.12, droneLp: 760, pluckProb: 0.85, pluckGain: 0.19, bright: 1.5, wander: 3, drumEvery: 2, drumGain: 0.24, drumBig: 8, fx: 0.20 }),
  // …a BOSS — ominous, low, a minor-2nd clash in the drone, heavy drums.
  boss:         T({ root: 50, scale: MIN, step: 0.30, mix: 0.60, droneRoot: 29, droneSteps: [0, 1, 7], droneGain: 0.16, droneLp: 520, pluckProb: 0.82, pluckGain: 0.20, bright: 1.4, wander: 3, drumEvery: 2, drumGain: 0.32, drumBig: 6, fx: 0.25 }),
  // 己 Character — the SIGNATURE xianxia hero theme: noble, flowing, a soaring dizi lead.
  char:         T({ root: 64, scale: MAJ, step: 0.46, droneRoot: 40, droneSteps: [0, 7, 12, 19], droneGain: 0.11, droneLp: 950, pluckProb: 0.72, pluckGain: 0.17, bright: 1.3, leadEvery: 16, leadGain: 0.09, fx: 0.35 }),
  // 人 Team — companionship, warm and hopeful.
  team:         T({ root: 62, scale: MAJ, step: 0.50, droneRoot: 38, droneSteps: [0, 7, 12], droneGain: 0.11, droneLp: 820, pluckProb: 0.68, bright: 1.1, leadEvery: 24, leadGain: 0.07, fx: 0.32 }),
  // 阵 Formation — BUILDING TENSION: insistent minor pulse that ramps each cycle, drums swelling.
  formation:    T({ root: 55, scale: MIN, step: 0.34, droneRoot: 31, droneSteps: [0, 7], droneGain: 0.13, droneLp: 600, pluckProb: 0.55, pluckGain: 0.16, bright: 1.2, wander: 1, bassEvery: 2, bassGain: 0.22, drumEvery: 2, drumGain: 0.20, drumBig: 8, build: true, buildCycle: 16, fx: 0.20 }),
  // 召 Recruit — fate & fortune: mysterious, high, sparkling anticipation.
  recruit:      T({ root: 67, scale: MAJ, step: 0.42, mix: 0.52, droneRoot: 43, droneSteps: [0, 7, 12], droneGain: 0.09, droneLp: 1150, pluckProb: 0.60, pluckGain: 0.14, bright: 1.9, wander: 3, sparkleEvery: 6, fx: 0.42 }),
  // 蛊 Gu Refinery — alchemy & forging: industrious, metallic clinks over a steady pulse.
  gu:           T({ root: 53, scale: MIN, step: 0.36, droneRoot: 36, droneSteps: [0, 5, 7], droneGain: 0.10, droneLp: 720, pluckProb: 0.60, pluckGain: 0.16, bright: 1.7, drumEvery: 4, drumGain: 0.14, sparkleEvery: 8, fx: 0.18 }),
  // 道 Dao — enlightenment: ethereal, very slow, sparse, vast reverb, floating flute.
  dao:          T({ root: 62, scale: MAJ, step: 0.80, mix: 0.45, droneRoot: 38, droneSteps: [0, 7, 12, 16], droneGain: 0.12, droneLp: 1000, pluckProb: 0.40, pluckGain: 0.13, bright: 1.4, wander: 1, bassEvery: 0, leadEvery: 16, leadGain: 0.08, fx: 0.55 }),
  // 悟 Attainment — transcendence: slow but grand, high and luminous, spacious.
  attainment:   T({ root: 67, scale: MAJ, step: 0.60, mix: 0.50, droneRoot: 43, droneSteps: [0, 7, 12, 19], droneGain: 0.12, droneLp: 1250, pluckProb: 0.50, pluckGain: 0.14, bright: 1.6, leadEvery: 12, leadGain: 0.09, fx: 0.50 }),
  // 市 Market — a BUSTLING BAZAAR: bright, fast, busy plucks, a light hand-drum, coin/ware sparkle, dry/close.
  shop:         T({ root: 64, scale: MAJ, step: 0.28, mix: 0.60, droneRoot: 40, droneSteps: [0, 7], droneGain: 0.07, droneLp: 950, pluckProb: 0.85, pluckGain: 0.16, bright: 1.8, wander: 3, bassEvery: 4, bassGain: 0.18, drumEvery: 2, drumGain: 0.10, sparkleEvery: 6, fx: 0.15 }),
  // 囊 Inventory — neutral & light, unobtrusive sorting music.
  inv:          T({ root: 60, scale: MAJ, step: 0.55, mix: 0.45, droneRoot: 36, droneSteps: [0, 7, 12], droneGain: 0.08, droneLp: 720, pluckProb: 0.45, pluckGain: 0.13, bright: 1.1, bassEvery: 8, fx: 0.30 }),
  // 谱 Almanac — a quiet LIBRARY: slow, soft, solemn minor, very sparse, low volume, contemplative.
  almanac:      T({ root: 57, scale: MIN, step: 0.72, mix: 0.38, droneRoot: 33, droneSteps: [0, 7], droneGain: 0.09, droneLp: 600, pluckProb: 0.40, pluckGain: 0.12, bright: 0.9, wander: 1, bassEvery: 0, fx: 0.45 }),
  // 塔 Floors — the tower & the climb: adventurous, mysterious exploration with a sense of depth.
  floors:       T({ root: 55, scale: MIN, step: 0.44, droneRoot: 31, droneSteps: [0, 7, 12], droneGain: 0.11, droneLp: 760, pluckProb: 0.62, pluckGain: 0.16, bright: 1.3, wander: 3, leadEvery: 20, leadGain: 0.08, drumEvery: 8, drumGain: 0.12, fx: 0.35 }),
  // 典 Guide — gentle, welcoming, instructional calm.
  codex:        T({ root: 60, scale: MAJ, step: 0.60, mix: 0.42, droneRoot: 36, droneSteps: [0, 7, 12], droneGain: 0.09, droneLp: 760, pluckProb: 0.50, pluckGain: 0.13, bright: 1.1, leadEvery: 24, leadGain: 0.06, fx: 0.40 }),
};
THEMES.res = THEMES.inv;     // resource-detail pseudo-tab reuses the calm Inventory mood
THEMES.title = THEMES.char;  // title / new-game flow plays the signature hero theme

let currentName = 'char';
let currentTheme = THEMES.char;
let SCALE = buildScale(currentTheme.root, currentTheme.scale);

function buildScale(root, degs) {
  const out = [];
  for (let o = 0; o < 3; o++) for (const d of degs) out.push(root - 12 + o * 12 + d); // ~root-centred, 3 octaves
  return out;
}

// Switch the music mood. No-op if unchanged. Records the theme even before audio starts; once playing,
// crossfades (dip the mix, swap the drone, restore) for a smooth scene change.
export function setTheme(name) {
  const t = THEMES[name] || currentTheme;
  if (t === currentTheme) return;
  currentName = name; currentTheme = t;
  themeStep = 0;
  SCALE = buildScale(t.root, t.scale);
  lastMelody = Math.floor(SCALE.length / 2);
  if (started && ctx) {
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setTargetAtTime(0.10, ctx.currentTime, 0.08);            // dip out
    stopDrone(); startDrone();                                             // swap the tonal bed
    musicBus.gain.setTargetAtTime(t.mix, ctx.currentTime + 0.35, 0.4);     // …and back up to the new level
    if (fxSend) fxSend.gain.setTargetAtTime(t.fx, ctx.currentTime, 0.3);
  }
}

export const currentThemeName = () => currentName; // which mood is playing (for debugging / a future "now playing" label)

// Audio prefs: independent BGM + SFX levels (0–10) and mutes. Tolerant of a null state (title screen),
// missing fields, and the legacy {muted,volume} shape (migrated in state.js, but defended here too).
function prefs() {
  const s = S();
  const a = (s && s.settings && s.settings.audio) || {};
  const lvl = (v, d) => (typeof v === 'number' ? clamp(v, 0, 10) : d);
  const legacyVol = typeof a.volume === 'number' ? Math.round(a.volume * 10) : null;
  return {
    bgm: lvl(a.bgm, legacyVol != null ? legacyVol : 7),
    sfx: lvl(a.sfx, legacyVol != null ? legacyVol : 7),
    bgmMuted: a.bgmMuted != null ? !!a.bgmMuted : !!a.muted,
    sfxMuted: a.sfxMuted != null ? !!a.sfxMuted : !!a.muted,
  };
}

// Create the audio graph the first time it's needed. Returns the context, or null if Web Audio is
// unavailable. A context made before a gesture is born "suspended".
function ensureCtx() {
  if (ctx) return ctx;
  if (typeof window === 'undefined') return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  const p = prefs();
  master = ctx.createGain();
  master.gain.value = 1;
  master.connect(ctx.destination);
  // Two independent user-controlled buses fronting the master: BGM (music) and SFX (one-shots).
  bgmGain = ctx.createGain(); bgmGain.gain.value = p.bgmMuted ? 0 : p.bgm / 10; bgmGain.connect(master);
  sfxGain = ctx.createGain(); sfxGain.gain.value = p.sfxMuted ? 0 : p.sfx / 10; sfxGain.connect(master);
  musicBus = ctx.createGain();
  musicBus.gain.value = currentTheme.mix;
  musicBus.connect(bgmGain);
  // "air": a filtered feedback delay the plucks/leads send into, for a long pentatonic tail.
  fxSend = ctx.createGain(); fxSend.gain.value = currentTheme.fx;
  const delay = ctx.createDelay(1.0); delay.delayTime.value = 0.33;
  const fb = ctx.createGain(); fb.gain.value = 0.32;
  const fbLp = ctx.createBiquadFilter(); fbLp.type = 'lowpass'; fbLp.frequency.value = 1800;
  fxSend.connect(delay); delay.connect(fbLp); fbLp.connect(fb); fb.connect(delay); delay.connect(musicBus);
  return ctx;
}

// ---------- public lifecycle ----------
export function init() {
  if (typeof window === 'undefined') return;
  const once = () => {
    if (!ensureCtx()) return;
    if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
    applyLevels();
    refreshMusic();
    window.removeEventListener('pointerdown', once);
    window.removeEventListener('keydown', once);
  };
  window.addEventListener('pointerdown', once, { passive: true });
  window.addEventListener('keydown', once);
  document.addEventListener('pointerdown', (e) => {
    const el = e.target;
    if (el && el.closest && el.closest('button')) click();
  }, true);
  document.addEventListener('visibilitychange', () => {
    if (!ctx) return;
    if (document.hidden) { stopMusic(); if (ctx.suspend) ctx.suspend(); }
    else { if (!prefs().bgmMuted && ctx.resume) ctx.resume(); refreshMusic(); }
  });
}

// Push the saved BGM/SFX levels onto their buses (and wake a suspended context if anything's audible).
function applyLevels() {
  if (!ensureCtx()) return;
  const p = prefs();
  if (ctx.state === 'suspended' && !(p.bgmMuted && p.sfxMuted) && ctx.resume) ctx.resume();
  bgmGain.gain.setTargetAtTime(p.bgmMuted ? 0 : p.bgm / 10, ctx.currentTime, 0.05);
  sfxGain.gain.setTargetAtTime(p.sfxMuted ? 0 : p.sfx / 10, ctx.currentTime, 0.05);
}

function refreshMusic() {
  if (!ctx) return;
  const shouldPlay = !prefs().bgmMuted && !(typeof document !== 'undefined' && document.hidden);
  if (shouldPlay && !started) startMusic();
  else if (!shouldPlay && started) stopMusic();
}

// ---- public BGM / SFX controls (read by the settings panel; 0–10 levels + independent mutes) ----
export const getBgm = () => prefs().bgm;
export const getSfx = () => prefs().sfx;
export const isBgmMuted = () => prefs().bgmMuted;
export const isSfxMuted = () => prefs().sfxMuted;
function writePrefs(patch) { const s = S(); if (s) { s.settings = s.settings || {}; s.settings.audio = { ...prefs(), ...patch }; } }
export function setBgm(v) { writePrefs({ bgm: clamp(+v || 0, 0, 10) }); applyLevels(); refreshMusic(); }
export function setSfx(v) { writePrefs({ sfx: clamp(+v || 0, 0, 10) }); applyLevels(); }
export function setBgmMuted(m) { writePrefs({ bgmMuted: !!m }); applyLevels(); refreshMusic(); }
export function setSfxMuted(m) { writePrefs({ sfxMuted: !!m }); applyLevels(); }

// Battle context → theme. On the Battle tab a frontier assault swaps to the engaged/boss mood; idle
// farming stays on the calm `battle` mood. (Off the Battle tab the view's own theme is left alone.)
export function scene(challenging, isBoss) { setTheme(challenging ? (isBoss ? 'boss' : 'battleActive') : 'battle'); }

// ---------- music bed ----------
function startMusic() {
  if (!ensureCtx() || started) return;
  if (ctx.state === 'suspended' && ctx.resume) ctx.resume();
  started = true;
  musicBus.gain.value = currentTheme.mix;
  if (fxSend) fxSend.gain.value = currentTheme.fx;
  startDrone();
  themeStep = 0;
  nextNoteTime = ctx.currentTime + 0.1;
  schedTimer = setInterval(scheduler, 25); // 25ms look-ahead tick
}

function stopMusic() {
  started = false;
  if (schedTimer) { clearInterval(schedTimer); schedTimer = null; }
  stopDrone();
}

function startDrone() {
  const t = currentTheme;
  t.droneSteps.forEach((st, i) => {
    const o = ctx.createOscillator(); o.type = i === 0 ? 'sine' : 'triangle';
    o.frequency.value = midiToFreq(t.droneRoot + st); o.detune.value = (i - 1) * 5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = t.droneLp;
    const g = ctx.createGain(); g.gain.value = 0;
    o.connect(lp); lp.connect(g); g.connect(musicBus);
    const now = ctx.currentTime;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(t.droneGain / (i + 1), now + 1.3); // fade-in (quick enough for tab switches)
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.05 + i * 0.02; // slow "breathing"
    const lfoG = ctx.createGain(); lfoG.gain.value = 0.025;
    lfo.connect(lfoG); lfoG.connect(g.gain); lfo.start();
    o.start();
    droneNodes.push({ o, lfo, g });
  });
}

function stopDrone() {
  if (!ctx) { droneNodes = []; return; }
  const now = ctx.currentTime;
  for (const n of droneNodes) {
    try { n.g.gain.cancelScheduledValues(now); n.g.gain.setTargetAtTime(0, now, 0.25); n.o.stop(now + 1); n.lfo.stop(now + 1); } catch (e) {}
  }
  droneNodes = [];
}

function scheduler() {
  if (!ctx || !started) return;
  while (nextNoteTime < ctx.currentTime + 0.15) {
    scheduleStep(themeStep, nextNoteTime);
    nextNoteTime += currentTheme.step;
    themeStep++;
  }
}

function scheduleStep(s, time) {
  const t = currentTheme;
  const energy = t.build ? 0.35 + 0.65 * ((s % t.buildCycle) / t.buildCycle) : 1; // Formation: tension ramps each cycle
  // random-walk melody over the theme's scale (range = wander)
  const move = (Math.random() * (2 * t.wander + 1) | 0) - t.wander;
  lastMelody = clamp(lastMelody + move, 0, SCALE.length - 1);
  if (Math.random() < t.pluckProb * (t.build ? 0.6 + 0.4 * energy : 1)) pluck(midiToFreq(SCALE[lastMelody]), time, t.pluckGain, t.bright);
  if (t.bassEvery && s % t.bassEvery === 0) pluck(midiToFreq(t.droneRoot + (s % (t.bassEvery * 2) ? 7 : 0)), time, t.bassGain, 0.6); // bass on the downbeat
  if (t.leadEvery && s % t.leadEvery === t.leadAt) lead(midiToFreq(SCALE[lastMelody] + 12), time, 1.4, t.leadGain); // soaring flute
  if (t.sparkleEvery && s % t.sparkleEvery === 2) pluck(midiToFreq(SCALE[Math.min(SCALE.length - 1, lastMelody + 5)] + 12), time, 0.06, 2.4); // bright bell/coin
  if (t.drumEvery && s % t.drumEvery === 0) drum(time, t.drumGain * energy, false);
  if (t.drumBig && s % t.drumBig === Math.floor(t.drumBig / 2)) drum(time, (t.drumGain + 0.1) * energy, true);
}

// A plucked string (guqin/zheng-ish): bright transient that decays as a lowpass closes, + an octave shimmer.
function pluck(freq, time, gain = 0.18, bright = 1) {
  const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = freq;
  const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = freq * 2;
  const o2g = ctx.createGain(); o2g.gain.value = 0.25;
  const lp = ctx.createBiquadFilter(); lp.type = 'lowpass';
  lp.frequency.setValueAtTime(2200 * bright, time);
  lp.frequency.exponentialRampToValueAtTime(500, time + 0.5);
  const g = ctx.createGain();
  o.connect(g); o2.connect(o2g); o2g.connect(g); g.connect(lp);
  lp.connect(musicBus); if (fxSend) lp.connect(fxSend);
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gain, time + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, time + 0.9);
  o.start(time); o2.start(time); o.stop(time + 1.0); o2.stop(time + 1.0);
}

// A sustained reed/flute-ish lead with vibrato.
function lead(freq, time, dur = 1.2, gain = 0.08) {
  const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = freq;
  const vib = ctx.createOscillator(); vib.frequency.value = 5.5;
  const vibG = ctx.createGain(); vibG.gain.value = 6;
  vib.connect(vibG); vibG.connect(o.detune); vib.start(time); vib.stop(time + dur + 0.2);
  const g = ctx.createGain();
  o.connect(g); g.connect(musicBus); if (fxSend) g.connect(fxSend);
  g.gain.setValueAtTime(0.0001, time);
  g.gain.linearRampToValueAtTime(gain, time + 0.15);
  g.gain.setValueAtTime(gain, time + Math.max(0.16, dur - 0.2));
  g.gain.exponentialRampToValueAtTime(0.0001, time + dur);
  o.start(time); o.stop(time + dur + 0.05);
}

// A membrane drum: a pitch-dropping sine thump.
function drum(time, gain = 0.2, big = false) {
  if (gain <= 0.001) return;
  const o = ctx.createOscillator(); o.type = 'sine';
  o.frequency.setValueAtTime(big ? 160 : 120, time);
  o.frequency.exponentialRampToValueAtTime(50, time + 0.12);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, time);
  g.gain.exponentialRampToValueAtTime(0.001, time + (big ? 0.3 : 0.18));
  o.connect(g); g.connect(musicBus);
  o.start(time); o.stop(time + 0.35);
}

// ---------- SFX (one-shots, routed to master so they cut through the music) ----------
function blip({ type = 'sine', f0, f1, dur = 0.15, gain = 0.3, when = 0, dest = null }) {
  if (!ensureCtx()) return;
  const t = ctx.currentTime + when;
  const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t);
  if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g); g.connect(dest || sfxGain);
  o.start(t); o.stop(t + dur + 0.02);
}

function noise(dur, gain, freq, type = 'lowpass', when = 0) {
  if (!ensureCtx()) return;
  const t = ctx.currentTime + when;
  const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource(); src.buffer = buf;
  const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f); f.connect(g); g.connect(sfxGain);
  src.start(t); src.stop(t + dur + 0.02);
}

export function hit()  { noise(0.08, 0.16, 1300, 'lowpass'); blip({ type: 'triangle', f0: 180, f1: 80, dur: 0.1, gain: 0.16 }); }
export function crit() { noise(0.09, 0.18, 1600, 'lowpass'); blip({ type: 'triangle', f0: 200, f1: 80, dur: 0.12, gain: 0.18 });
                         blip({ type: 'square', f0: 1000, f1: 1700, dur: 0.18, gain: 0.10 }); blip({ type: 'sine', f0: 2300, dur: 0.22, gain: 0.07, when: 0.02 }); }
export function miss() { noise(0.12, 0.07, 2400, 'highpass'); }
export function death() { blip({ type: 'sine', f0: 220, f1: 55, dur: 0.45, gain: 0.16 }); blip({ type: 'triangle', f0: 110, f1: 40, dur: 0.5, gain: 0.1, when: 0.02 }); }
export function forge() { noise(0.05, 0.14, 3000, 'bandpass'); blip({ type: 'square', f0: 1400, f1: 700, dur: 0.08, gain: 0.08, when: 0.04 }); }
export function click() { blip({ type: 'sine', f0: 660, dur: 0.03, gain: 0.045 }); }

export function breakthrough(big = false) {
  if (!ensureCtx()) return;
  const degs = big ? [0, 2, 4, 7, 9, 12, 16] : [0, 4, 7, 12];
  degs.forEach((d, i) => blip({ type: 'triangle', f0: midiToFreq(60 + d), dur: big ? 0.5 : 0.38, gain: 0.16, when: i * (big ? 0.08 : 0.07) }));
  blip({ type: 'sine', f0: midiToFreq(72 + (big ? 12 : 0)), dur: big ? 1.1 : 0.8, gain: 0.1, when: degs.length * (big ? 0.08 : 0.07) });
}
export const victory = () => { [0, 4, 7].forEach((d, i) => blip({ type: 'triangle', f0: midiToFreq(64 + d), dur: 0.3, gain: 0.15, when: i * 0.09 })); };
export const defeat  = () => { [0, -3].forEach((d, i) => blip({ type: 'triangle', f0: midiToFreq(55 + d), f1: midiToFreq(48 + d), dur: 0.5, gain: 0.14, when: i * 0.14 })); };

export function gacha(rank = 1) {
  if (!ensureCtx()) return;
  const r = Math.max(1, Math.min(6, rank | 0));
  const notes = [0, 4, 7, 12, 16, 19].slice(0, 2 + r);
  notes.forEach((d, i) => blip({ type: 'triangle', f0: midiToFreq(67 + d), dur: 0.25 + r * 0.04, gain: 0.07 + r * 0.012, when: i * 0.05 }));
  if (r >= 4) blip({ type: 'sine', f0: midiToFreq(91), dur: 0.6 + r * 0.1, gain: 0.06, when: notes.length * 0.05 });
}
