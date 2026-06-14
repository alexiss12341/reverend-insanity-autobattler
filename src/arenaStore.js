// Arena client — the browser's only link to the async-PvP backend (Supabase Edge Functions). The
// functions are open (verify_jwt=false) and routed so the page needs NO keys, just the project URL.
//   register(team)        -> validate + recompute + store your defense team (server-authoritative)
//   list()                -> all registered teams, sorted by arena points (Elo)
//   challenge(defenderId) -> server runs the authoritative fight + Elo update, returns { winner, seed, ... }
// Identity is an anonymous per-browser UUID + an editable display name, both in localStorage.
import { S, activeTeam } from './state.js';
import { prestigeCombatMult } from './systems/prestige.js';

// The Supabase project's Functions base URL (public — safe to ship in the client).
const BASE = 'https://msqnxvxwccqzqmvqefot.supabase.co/functions/v1';
// Public anon key (same one in systems/cloud.js) — sent as `apikey` so these raw-fetch calls carry the
// exact header pair the Supabase SDK uses for the JWT-gated functions (apikey + Bearer user token).
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zcW54dnh3Y2NxenFtdnFlZm90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDgxNjMsImV4cCI6MjA5Njc4NDE2M30.AE2fmgOXn2c1FDKOaeZq2RxiIMLxuN5yKGMHZ2ImTaI';

const LS_ID = 'arena_player_id';
const LS_NAME = 'arena_name';

// Arena identity = the CLOUD user id (guest anon id, or signed-in account) when available — set by main.js
// on auth change, so a guest's Elo follows them into their account. Falls back to a stable per-browser UUID
// only when the cloud is unavailable.
let _cloudId = null;
export function setCloudId(id) { _cloudId = id || null; }

// Bearer token for the arena Edge Functions. register + resolve-battle are JWT-gated (verify_jwt=true):
// the server derives the player id from this token's verified `sub`, so a caller can't act as anyone else.
// Pushed by main.js on every cloud auth change (login / logout / token refresh). `list` is public and
// ignores it. Without a token those two calls 401 server-side, which is the intended "must be signed in".
let _authToken = null;
export function setAuthToken(t) { _authToken = t || null; }
export function playerId() {
  if (_cloudId) return _cloudId;
  let id = localStorage.getItem(LS_ID);
  if (!id) {
    id = (typeof crypto !== 'undefined' && crypto.randomUUID)
      ? crypto.randomUUID()
      : 'p_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
    localStorage.setItem(LS_ID, id);
  }
  return id;
}
export function playerName() {
  return localStorage.getItem(LS_NAME) || (S() && S().roster[0] && S().roster[0].name) || 'Anonymous';
}
export function setPlayerName(n) { localStorage.setItem(LS_NAME, String(n || '').replace(/[<>]/g, '').trim().slice(0, 40)); }

// Last-known arena rating, cached so the tab header can show it instantly (the server is authoritative).
const LS_POINTS = 'arena_points';
export function getMyPoints() { const v = localStorage.getItem(LS_POINTS); return v == null ? null : (parseInt(v, 10) || 0); }
export function setMyPoints(n) { if (n != null) localStorage.setItem(LS_POINTS, String(n | 0)); }
// Drop the cached rating (on reincarnation) so the tab shows "unranked" until the server confirms a fresh
// standing. getMyPoints() then returns null, which the UI renders as the default rating.
export function clearMyPoints() { localStorage.removeItem(LS_POINTS); }

// The REINCARNATION arena reset is DURABLE + identity-safe. The server delete (arena-reset) can fail at the
// moment of rebirth (offline, cloud not yet ready, an expired/un-refreshed JWT). A fire-and-forget call would
// then silently leave the player's OLD — now nonexistent — defense team on the ladder forever, still holding
// their Elo and still challengeable. So we persist WHICH identity owes the delete and RETRY it whenever that
// SAME verified identity becomes available (boot / cloud auth change). Storing the player_id (not a bare flag)
// is the safeguard: arena-reset only ever deletes the CALLER's own row, so flushing under any OTHER identity
// (e.g. after a sign-out flips us back to a guest) would clear the marker without deleting the right team.
// A fresh register() also clears it (a deliberate new defense team supersedes any owed reset).
const LS_RESET_PENDING = 'arena_reset_pending';
export function markArenaResetPending(pid) {
  const id = pid || playerId(); // playerId() already prefers the cloud id (the server-side arena identity)
  try { localStorage.setItem(LS_RESET_PENDING, String(id || '')); } catch (e) {}
}
export function arenaResetPendingFor() { return localStorage.getItem(LS_RESET_PENDING) || null; }
function clearArenaResetPending() { try { localStorage.removeItem(LS_RESET_PENDING); } catch (e) {} }

// Serialize the two writers of the player's OWN `teams` row — the reset DELETE and the register POST — so they
// can never race (an in-flight reset deleting a team the player just registered, or two auth-change flushes
// firing the same delete). Every flush/register threads through this one-at-a-time queue.
let _arenaOp = Promise.resolve();
function enqueue(fn) { const run = _arenaOp.then(fn, fn); _arenaOp = run.then(() => {}, () => {}); return run; }

// Attempt the owed reset, but ONLY while authenticated AS the identity that owes it (else we'd 401, or clear
// the marker under the wrong identity). No-op otherwise — the marker survives for the next auth-ready moment.
// The in-queue re-check lets a fresh register() (which clears the marker) supersede a still-queued reset.
// Resolves true only when the server confirms the deletion; never throws.
export function flushArenaReset() {
  const owed = arenaResetPendingFor();
  if (!owed || !_authToken || _cloudId !== owed) return Promise.resolve(false);
  return enqueue(() => {
    if (arenaResetPendingFor() !== owed || _cloudId !== owed) return false; // superseded / identity changed
    return arenaReset().then(() => { clearArenaResetPending(); return true; }).catch(() => false);
  });
}

// Serialize the LOCAL active team into the raw-input contract the Edge Functions validate + recompute.
// Only raw inputs (attrs/realm/gu ids/killer/formation) — never computed stats, which the server derives.
export function serializeTeam() {
  const team = activeTeam().map((c) => {
    const gu = (c.gu || []).filter(Boolean);
    const guInv = (S().guInv || []).filter((o) => gu.includes(o.uid)).map((o) => ({ uid: o.uid, guId: o.guId }));
    return {
      name: c.name, rarity: c.rarity, realm: c.realm | 0, aptitude: c.aptitude || 1, imprint: c.imprint || 0,
      attrs: { str: c.attrs.str | 0, agi: c.attrs.agi | 0, con: c.attrs.con | 0, int: c.attrs.int | 0, luck: c.attrs.luck | 0 },
      line: c.line || null, affinity: Array.isArray(c.affinity) ? c.affinity : [],
      comprehension: c.comprehension || {}, daoMarks: c.daoMarks || {}, wounds: c.wounds || [],
      bonusSlots: c.bonusSlots || 0, gu, guInv,
      killer: c.killer || { core: null, support: [], archetype: null },
      row: c.row === 'back' ? 'back' : 'front', lane: Math.max(0, Math.min(4, c.lane | 0)),
    };
  });
  const ctx = {
    prestigeMult: prestigeCombatMult(),
    immFuel: (S().immortalStones || 0) > 0,
    killerUnlocked: !!(S().clearedFloors && S().clearedFloors[100]),
  };
  return { team, ctx };
}

async function call(path, body) {
  let res;
  const headers = { apikey: SUPABASE_ANON };
  if (_authToken) headers.authorization = `Bearer ${_authToken}`; // verified identity for register/resolve-battle
  try {
    res = await fetch(`${BASE}/${path}`, body === undefined
      ? { method: 'GET', headers }
      : { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  } catch (e) { throw new Error('Network error — could not reach the arena.'); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(data.error || `Arena error (HTTP ${res.status}).`);
  return data;
}

export function arenaRegister() {
  const { team, ctx } = serializeTeam();
  if (!team.length) return Promise.reject(new Error('Put at least one cultivator on your battle team first.'));
  // A deliberate registration is the player's current defense team — it supersedes any owed reincarnation
  // reset, so clear the marker on success (else a later flush would delete the team they just registered).
  // Threaded through the same queue as flush so the DELETE and this POST can never cross on the wire.
  return enqueue(() => call('register', { playerId: playerId(), name: playerName(), team, ctx })
    .then((r) => { clearArenaResetPending(); return r; }));
}
export function arenaList() { return call('list'); }
// Does THIS identity already have a registered defense team? JWT-gated server lookup (resolves { ok, exists,
// points }) — used by the one-time resync migration so it only ever touches players who ALREADY registered,
// never auto-enrolling a newcomer. Authoritative where the capped `list` can't be (top-100 only).
export function arenaMyTeam() { return call('my-team', {}); }
// REINCARNATION reset: delete this player's registered defense team server-side, wiping their Elo rating +
// win/loss record. JWT-gated, so it no-ops (401) for guests/offline — the caller swallows that and relies on
// clearMyPoints() for the local display reset.
export function arenaReset() { return call('arena-reset', {}); }
export function arenaChallenge(defenderId) {
  const { team, ctx } = serializeTeam();
  if (!team.length) return Promise.reject(new Error('Put at least one cultivator on your battle team first.'));
  return call('resolve-battle', { defenderId, attacker: { playerId: playerId(), team, ctx } });
}
