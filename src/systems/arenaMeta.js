// Arena meta-state: challenge ATTEMPTS (max 5, +1 per 15 min, offline-friendly — mirrors
// systems/bounties.js refill logic) and 3 saved defense LOADOUTS (named formation snapshots).
import { S, save, activeTeam, normalizeFormation } from '../state.js';

export const ARENA_MAX_ATTEMPTS = 5;
export const ARENA_REFILL_MS = 15 * 60 * 1000; // 1 attempt per 15 minutes (tune freely)

// PROGRESSION GATE: the Arena (async PvP) opens only after the player has BEATEN floor 50 —
// same clearedFloors signal the killer-moves gate uses (floor 100). Until then the nav button
// just shows a locked panel (ui.js viewPvp) and openArena skips the network fetch (main.js).
export const ARENA_UNLOCK_FLOOR = 50;
export const arenaUnlocked = () => { const s = S(); return !!(s && s.clearedFloors && s.clearedFloors[ARENA_UNLOCK_FLOOR]); };

// Lazily attach + repair the arena bag on the save (same pattern as bounties.js ensureBounties).
export function ensureArenaMeta() {
  const s = S(); if (!s) return null;
  if (!s.arena || typeof s.arena !== 'object') s.arena = {};
  const a = s.arena;
  if (typeof a.attempts !== 'number') a.attempts = ARENA_MAX_ATTEMPTS;
  if (typeof a.lastRefill !== 'number') a.lastRefill = Date.now();
  if (!Array.isArray(a.loadouts) || a.loadouts.length !== 3) a.loadouts = [null, null, null]; // {name, team:[{id,row,lane}]} | null
  if (typeof a.active !== 'number') a.active = -1; // which slot the current team came from (-1 = unsaved)
  return a;
}

function refill() {
  const a = ensureArenaMeta(); if (!a) return a;
  if (a.attempts >= ARENA_MAX_ATTEMPTS) { a.lastRefill = Date.now(); return a; }
  const gained = Math.floor((Date.now() - a.lastRefill) / ARENA_REFILL_MS);
  if (gained > 0) {
    a.attempts = Math.min(ARENA_MAX_ATTEMPTS, a.attempts + gained);
    a.lastRefill = a.attempts >= ARENA_MAX_ATTEMPTS ? Date.now() : a.lastRefill + gained * ARENA_REFILL_MS;
  }
  return a;
}
export const arenaAttemptsLeft = () => refill().attempts;
export function arenaMsToNextAttempt() {
  const a = refill();
  if (a.attempts >= ARENA_MAX_ATTEMPTS) return 0;
  return Math.max(0, a.lastRefill + ARENA_REFILL_MS - Date.now());
}
export function spendArenaAttempt() {
  const a = refill();
  if (a.attempts <= 0) return false;
  if (a.attempts >= ARENA_MAX_ATTEMPTS) a.lastRefill = Date.now(); // the regen clock starts when leaving full
  a.attempts -= 1; save();
  return true;
}
export function refundArenaAttempt() { // network error after spending → give it back
  const a = ensureArenaMeta();
  a.attempts = Math.min(ARENA_MAX_ATTEMPTS, a.attempts + 1); save();
}

// ---- loadouts: named snapshots of the active team + formation ----
export function saveLoadout(slot, name) {
  const a = ensureArenaMeta();
  const team = activeTeam().map((c) => ({ id: c.id, row: c.row === 'back' ? 'back' : 'front', lane: c.lane | 0 }));
  if (!team.length) return false;
  const prev = a.loadouts[slot];
  a.loadouts[slot] = { name: cleanName(name) || (prev && prev.name) || `Loadout ${slot + 1}`, team };
  a.active = slot; save();
  return true;
}
export function applyLoadout(slot) {
  const a = ensureArenaMeta();
  const ld = a.loadouts[slot]; if (!ld) return false;
  const byId = {}; for (const m of ld.team) byId[m.id] = m;
  // refuse to apply a loadout whose members are all gone (dismissed/reincarnated)
  if (!S().roster.some((c) => byId[c.id])) return false;
  for (const c of S().roster) {
    const m = byId[c.id];
    c.active = !!m;
    if (m) { c.row = m.row; c.lane = m.lane; }
  }
  normalizeFormation(); a.active = slot; save();
  return true;
}
export function renameLoadout(slot, name) {
  const a = ensureArenaMeta();
  if (!a.loadouts[slot]) return false;
  const n = cleanName(name);
  if (n) { a.loadouts[slot].name = n; save(); }
  return !!n;
}
const cleanName = (n) => String(n == null ? '' : n).replace(/[<>]/g, '').trim().slice(0, 24);
