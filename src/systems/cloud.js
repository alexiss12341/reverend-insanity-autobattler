// Cloud account + saves — Supabase Auth (Discord/Google OAuth) over the per-user `saves` table.
// Loaded ONLY in the browser via a dynamic import (it pulls the Supabase SDK from a CDN) and never
// imported by the headless test suite. Every cloud-save query is RLS-limited to the signed-in user, so
// a player can only ever read/write their own rows. Account is capped at CLOUD_MAX_SAVES slots.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = 'https://msqnxvxwccqzqmvqefot.supabase.co';
// The PUBLIC anon key — safe to ship in the client (RLS does the real protection).
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1zcW54dnh3Y2NxenFtdnFlZm90Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEyMDgxNjMsImV4cCI6MjA5Njc4NDE2M30.AE2fmgOXn2c1FDKOaeZq2RxiIMLxuN5yKGMHZ2ImTaI';

export const CLOUD_MAX_SAVES = 2; // up to 2 cloud save slots per account

const supa = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
});

let _user = null;
let _token = null; // current session access token (JWT) — sent to the arena Edge Functions for identity
export const cloudUser = () => _user;
// The signed-in (or guest) session's access token. The arena's register/resolve-battle functions are
// JWT-gated and derive the player id from this token's verified `sub`, so it must ride on those calls.
export const cloudToken = () => _token;
export const isGuest = () => !!(_user && _user.is_anonymous);          // anonymous (guest) session
export const isSignedIn = () => !!(_user && !_user.is_anonymous);      // signed in with a real Discord/Google account
export const cloudUserId = () => (_user ? _user.id : null);
export function cloudName() {
  const m = (_user && _user.user_metadata) || {};
  return m.full_name || m.name || m.user_name || m.preferred_username || (_user && _user.email) || 'Cultivator';
}

// Resolve the current session (including an OAuth redirect just landed in the URL) and subscribe to
// changes. `onChange(user|null)` fires on every auth flip. Returns the initial user (or null).
export async function initCloud(onChange) {
  try {
    let { data } = await supa.auth.getSession();
    if (!data.session) { await supa.auth.signInAnonymously(); ({ data } = await supa.auth.getSession()); } // auto-guest: every player gets a cloud identity
    _user = data && data.session ? data.session.user : null;
    _token = data && data.session ? data.session.access_token : null;
  } catch (e) { console.warn('cloud init failed:', e); _user = null; _token = null; }
  supa.auth.onAuthStateChange((_e, session) => {
    _user = session ? session.user : null;
    _token = session ? session.access_token : null; // keep the arena token fresh across refresh/login/logout
    if (onChange) onChange(_user);
  });
  return _user;
}

export async function signIn(provider) { // 'discord' | 'google'
  // a guest signing in: stash their id + cloud saves so the app can carry the arena rating + offer to bring saves in
  if (isGuest()) {
    let saves = [];
    try { saves = await listCloudSaves(); } catch (e) { console.warn('guest stash failed:', e); }
    localStorage.setItem('guest_claim', JSON.stringify({ from: _user.id, saves }));
  }
  const redirectTo = location.href.split('#')[0].split('?')[0];
  return supa.auth.signInWithOAuth({ provider, options: { redirectTo } });
}

// Move a guest's arena team into this (signed-in) account, preserving its Elo — the server verifies auth
// and only claims if the account has no team yet (never overwrites). Called after a guest upgrades.
export async function claimArena(guestId) {
  const { data, error } = await supa.functions.invoke('claim-arena', { body: { guestId } });
  if (error) throw error;
  return data;
}
export async function signOut() { try { await supa.auth.signOut(); } finally { _user = null; } }

// ---- cloud saves ----
// Reads/writes go through the save-get / save-put Edge Functions (NOT direct table access — the client's
// direct INSERT/UPDATE/SELECT on `saves` is revoked). save-put HMAC-signs the blob with a server-only
// secret; save-get re-verifies it, so a row tampered with in the database refuses to load. supa.functions
// .invoke attaches the session JWT automatically, which the functions use as the authoritative player id.
export async function listCloudSaves() {
  const { data, error } = await supa.functions.invoke('save-get');
  if (error) throw error;
  // [{ slot, data, updated_at, tampered }] — a tampered row carries data:null (failed its integrity check).
  return (data && data.saves) || [];
}
export async function uploadSave(slot, data) {
  if (!_user) throw new Error('not signed in');
  const { error } = await supa.functions.invoke('save-put', { body: { slot, data } });
  if (error) throw error;
}
export async function deleteCloudSave(slot) {
  const { error } = await supa.from('saves').delete().eq('slot', slot);
  if (error) throw error;
}

// ---- live presence: how many players are connected right now (Realtime Presence; no DB schema) ----
// Each connection joins one shared channel keyed by its cloud user id, so multiple tabs of the same
// player collapse to a single key — the distinct-key count is the live player count. `onCount(n)` fires
// on every join/leave/sync. Best-effort: if Realtime is unreachable it simply never calls back.
let _presenceCh = null;
export function trackPresence(onCount) {
  if (_presenceCh) return _presenceCh;
  const key = (_user && _user.id) || ('anon-' + Math.random().toString(36).slice(2));
  const ch = supa.channel('online-players', { config: { presence: { key } } });
  const emit = () => { try { onCount(Object.keys(ch.presenceState()).length); } catch (e) {} };
  ch.on('presence', { event: 'sync' }, emit)
    .on('presence', { event: 'join' }, emit)
    .on('presence', { event: 'leave' }, emit)
    .subscribe(async (status) => {
      if (status === 'SUBSCRIBED') { try { await ch.track({ at: Date.now() }); } catch (e) {} emit(); }
    });
  _presenceCh = ch;
  return ch;
}
export async function untrackPresence() {
  if (!_presenceCh) return;
  try { await supa.removeChannel(_presenceCh); } catch (e) {}
  _presenceCh = null;
}
