// @ts-nocheck
// Shared arena helpers for the register + resolve-battle Edge Functions. prepareTeam is the cheat-resistant
// core: raw inputs in → a legality check → character objects + a STATE-FREE ctx the engine recomputes from
// (so any stats the client tried to inject are ignored). Both functions validate teams identically, so an
// attacker's team is checked the same way a registered defender's was.
import { resolveOwned, GU_LIB } from "../../../src/data/gu.js";
import { realmPointsTotal, rarityBonus, ATTR_KEYS } from "../../../src/data/attributes.js";
import { guSlots } from "../../../src/data/realms.js";
import { RARITY_ORDER } from "../../../src/data/rarities.js";

export const MAX_TEAM = 6;
export const ENGINE_VERSION = 1; // bump on any combat-math change so clients can detect replay-skew

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  // x-client-info + x-supabase-api-version are sent by supabase-js `functions.invoke`; omitting them makes
  // the browser preflight FAIL ("Failed to send a request to the Edge Function"). Keep this list in sync
  // with whatever headers the client sends.
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-api-version",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};
export const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "content-type": "application/json" } });

// Verified caller identity. register + resolve-battle run with verify_jwt=true, so the platform gateway
// has ALREADY validated this token's signature before the function ran — we just read the `sub` claim.
// Returns the authenticated user id (a real account OR an anonymous guest, both of which carry a sub), or
// null when there's no user token (e.g. the bare anon key, which has no `sub`). This is the anti-cheat
// linchpin: the player id is taken from the unforgeable token, NEVER from the request body, so a caller
// can only ever register/challenge AS THEMSELVES.
export function callerId(req) {
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  try { return JSON.parse(atob(token.split(".")[1])).sub || null; } catch { return null; }
}

function validateMember(m, i) {
  if (!m || typeof m !== "object") return `member ${i}: not an object`;
  if (typeof m.name !== "string" || !m.name) return `member ${i}: missing name`;
  if (!RARITY_ORDER.includes(m.rarity)) return `member ${i}: bad rarity`;
  const realm = m.realm | 0;
  if (realm < 0 || realm > 23) return `member ${i}: realm out of range`;
  if (!m.attrs || typeof m.attrs !== "object") return `member ${i}: missing attrs`;
  let sum = 0;
  for (const k of ATTR_KEYS) {
    const v = Number(m.attrs[k] || 0);
    if (!(v >= 0) || !isFinite(v)) return `member ${i}: bad attr ${k}`;
    sum += v;
  }
  // loose v1 cap: base realm pool + rarity bonus, tripled to allow legit aptitude overflow but block gross
  // inflation. buildSnapshot recomputes stats regardless, so this is a secondary guard on the recompute.
  const legalMax = (realmPointsTotal(realm) + rarityBonus(m.rarity)) * 3;
  if (sum > legalMax) return `member ${i}: attribute total ${sum} exceeds legal max ${legalMax}`;
  const gu = Array.isArray(m.gu) ? m.gu : [];
  if (gu.length > guSlots(realm) + 5) return `member ${i}: too many equipped Gu (${gu.length})`;
  if (m.row !== "front" && m.row !== "back") return `member ${i}: bad row`;
  const lane = m.lane | 0;
  if (lane < 0 || lane > 4) return `member ${i}: bad lane`;
  return null;
}

// Validate + reconstruct a raw team into engine character objects + a state-free ctx.
// Returns { error } on rejection, or { chars, ctx }. Formation (row/lane) + killer config carried verbatim.
export function prepareTeam(team, ctxIn) {
  if (!Array.isArray(team) || team.length < 1 || team.length > MAX_TEAM)
    return { error: "team must be 1..6 members" };
  for (let i = 0; i < team.length; i++) { const e = validateMember(team[i], i); if (e) return { error: e }; }

  const invMap = new Map();
  for (const m of team) for (const it of (m.guInv || [])) {
    if (!it || typeof it.uid !== "string" || typeof it.guId !== "string") return { error: "bad guInv entry" };
    if (!GU_LIB[it.guId]) return { error: `unknown Gu ${it.guId}` };
    invMap.set(it.uid, it);
  }
  for (const m of team) for (const uid of (m.gu || [])) if (!invMap.has(uid)) return { error: `equipped Gu ${uid} not in guInv` };

  const chars = team.map((m) => ({
    name: m.name, rarity: m.rarity, realm: m.realm | 0, aptitude: Number(m.aptitude) || 1, imprint: m.imprint | 0,
    attrs: { str: m.attrs.str | 0, agi: m.attrs.agi | 0, con: m.attrs.con | 0, int: m.attrs.int | 0, luck: m.attrs.luck | 0 },
    line: m.line || null, affinity: Array.isArray(m.affinity) ? m.affinity : [],
    comprehension: m.comprehension || {}, daoMarks: m.daoMarks || {}, wounds: Array.isArray(m.wounds) ? m.wounds : [],
    bonusSlots: m.bonusSlots | 0, gu: Array.isArray(m.gu) ? m.gu : [],
    killer: m.killer || { core: null, support: [], archetype: null },
    row: m.row, lane: m.lane | 0, active: true,
  }));

  const ctx = {
    guLookup: (uid) => { const o = invMap.get(uid); return o ? resolveOwned(o) : null; },
    immFuel: !!(ctxIn && ctxIn.immFuel),
    prestigeMult: Math.max(1, Math.min(2, Number(ctxIn && ctxIn.prestigeMult) || 1)),
    killerUnlocked: !!(ctxIn && ctxIn.killerUnlocked),
  };
  return { chars, ctx };
}
