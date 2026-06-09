// Gacha recruitment. Costs Immortal Essence. Rolls one of the six rarity tiers
// (Common → Immortal) by weight, then creates a recruited cultivator of that rarity.
// Includes a PITY system (a dry streak guarantees an Epic+) and DISMISSAL (release an
// unwanted recruit back into Immortal Essence).
import { S, makeCharacter } from '../state.js';
import { RARITIES, RARITY_ORDER, rarityTier } from '../data/rarities.js';
import { nameForRarity } from '../data/npcs.js';

export const PULL_COST = 50;        // single pull (Immortal Essence)
export const PULL_COST_10 = 450;    // 10-pull, slight discount
export const PITY_CAP = 80;         // pulls without an Epic+ that force one

export function rollRarity() {
  const total = RARITY_ORDER.reduce((s, k) => s + RARITIES[k].weight, 0);
  let x = Math.random() * total;
  for (const k of RARITY_ORDER) { if ((x -= RARITIES[k].weight) <= 0) return k; }
  return 'Common';
}

// 10-pulls guarantee at least one Rare or better.
function guaranteedRarePlus() {
  const r = Math.random();
  return r < 0.7 ? 'Rare' : r < 0.93 ? 'Epic' : r < 0.99 ? 'Legendary' : 'Immortal';
}
function guaranteedEpicPlus() {
  const r = Math.random();
  return r < 0.8 ? 'Epic' : r < 0.97 ? 'Legendary' : 'Immortal';
}

export const pityCount = () => S().gachaPity || 0;

export function pull(n = 1) {
  const cost = n === 10 ? PULL_COST_10 : PULL_COST * n;
  if (S().essence < cost) return { ok: false, msg: 'Not enough Immortal Essence.' };
  S().essence -= cost;
  S().stats.pulls += n;

  const got = [];
  for (let i = 0; i < n; i++) {
    let rarity = rollRarity();
    if (n === 10 && i === n - 1 && !got.some((c) => RARITIES[c.rarity].tier >= 3)) {
      rarity = guaranteedRarePlus();
    }
    // pity: a long Epic-less streak forces an Epic+.
    S().gachaPity = (S().gachaPity || 0) + 1;
    if (rarityTier(rarity) < 4 && S().gachaPity >= PITY_CAP) rarity = guaranteedEpicPlus();
    if (rarityTier(rarity) >= 4) S().gachaPity = 0;

    const c = makeCharacter(nameForRarity(rarity), rarity);
    S().roster.push(c);
    got.push(c);
  }
  return { ok: true, got, pity: S().gachaPity };
}

// ---- Soul Imprint (魂印) ----
// Sacrifice a DUPLICATE copy (same name, since names map 1:1 to a rarity tier) into a target copy to
// raise its imprint level 0..10. Each level grants +5% to all base attributes and +0.1 aptitude
// (see data/attributes.js imprintAttrMult/effAptitude). The fodder copy is destroyed.
export const IMPRINT_CAP = 10;

// Benched, non-player duplicates (same name, different id) eligible as fodder for `targetId`.
export function imprintCandidates(targetId) {
  const t = S().roster.find((c) => c.id === targetId);
  if (!t) return [];
  return S().roster.filter((c) => c.id !== t.id && c.name === t.name && !c.isPlayer && !c.active);
}

export function imprint(targetId, fodderId) {
  const t = S().roster.find((c) => c.id === targetId);
  if (!t) return { ok: false, msg: 'No such cultivator.' };
  if ((t.imprint || 0) >= IMPRINT_CAP) return { ok: false, msg: `${t.name} is at max Soul Imprint (Lv ${IMPRINT_CAP}).` };
  const i = S().roster.findIndex((c) => c.id === fodderId);
  const f = i >= 0 ? S().roster[i] : null;
  if (!f || f.id === t.id || f.name !== t.name || f.isPlayer || f.active)
    return { ok: false, msg: 'That copy cannot be sacrificed — it must be a benched duplicate.' };
  S().roster.splice(i, 1);
  t.imprint = (t.imprint || 0) + 1;
  return { ok: true, name: t.name, level: t.imprint };
}

// ---- Duplicate detection / auto-consolidation ----
// Groups of same-name, non-player cultivators with ≥2 copies (a "duplicate set"). Each entry is the
// array of copies sharing that name. Used by the nav badge, the Team-tab banner, and auto-imprint.
export function duplicateGroups() {
  const by = new Map();
  for (const c of S().roster) {
    if (c.isPlayer) continue;
    if (!by.has(c.name)) by.set(c.name, []);
    by.get(c.name).push(c);
  }
  return [...by.values()].filter((g) => g.length >= 2);
}
// Pick the copy to KEEP from a duplicate set: highest realm, then highest existing imprint, then random.
function bestKeeper(group) {
  return group.slice().sort((a, b) =>
    (b.realm - a.realm) || (((b.imprint || 0) - (a.imprint || 0))) || (Math.random() - 0.5))[0];
}
// How many duplicate sets still have an imprint to spend (a keeper below the cap) — the nav-badge count.
export function imprintableDuplicateCount() {
  return duplicateGroups().filter((g) => (bestKeeper(g).imprint || 0) < IMPRINT_CAP).length;
}
// The DISMISSABLE spare copies among duplicates: for each same-name set keep the best (highest realm,
// then imprint) and return every OTHER benched copy. Drives the bulk-dismiss "Select duplicates" shortcut.
export function duplicateSpares() {
  const spares = [];
  for (const g of duplicateGroups()) {
    const keeper = bestKeeper(g);
    for (const c of g) if (c.id !== keeper.id && !c.active) spares.push(c);
  }
  return spares;
}
// Consolidate EVERY duplicate set into a single copy: keep the best (highest realm; ties → highest
// imprint → random) and sacrifice the rest into it, each raising its Soul Imprint by one (capped at
// IMPRINT_CAP — any overflow copies are left untouched). If a sacrificed copy was on the active team
// and the keeper wasn't, the keeper inherits that board slot so the team isn't thinned. Returns the
// number of copies merged and the number of distinct cultivators affected.
export function autoImprintAll() {
  let merged = 0, sets = 0;
  for (const group of duplicateGroups()) {
    const keeper = bestKeeper(group);
    if ((keeper.imprint || 0) >= IMPRINT_CAP) continue;
    let did = 0;
    for (const f of group) {
      if (f.id === keeper.id) continue;
      if ((keeper.imprint || 0) >= IMPRINT_CAP) break;
      const idx = S().roster.findIndex((c) => c.id === f.id);
      if (idx < 0) continue;
      if (f.active && !keeper.active) { keeper.active = true; keeper.row = f.row; keeper.lane = f.lane; }
      S().roster.splice(idx, 1);
      keeper.imprint = (keeper.imprint || 0) + 1;
      merged++; did++;
    }
    if (did) sets++;
  }
  return { merged, sets };
}

// Immortal Essence refunded for dismissing a recruit of `rarity` (rarer = bigger refund). Exported so the
// UI can preview the amount in the dismiss confirmation prompt.
export const dismissRefund = (rarity) => Math.round(PULL_COST * 0.4 * Math.pow(1.8, rarityTier(rarity) - 1));

// Release a benched recruit back into Immortal Essence (rarer = bigger refund).
export function dismiss(charId) {
  const i = S().roster.findIndex((c) => c.id === charId);
  if (i < 0) return { ok: false, msg: 'No such cultivator.' };
  const c = S().roster[i];
  if (c.isPlayer) return { ok: false, msg: 'You cannot dismiss yourself.' };
  if (c.active) return { ok: false, msg: 'Bench them first, then dismiss.' };
  const refund = dismissRefund(c.rarity);
  S().roster.splice(i, 1);
  S().essence += refund;
  return { ok: true, refund, name: c.name, rarity: c.rarity };
}
// Dismiss several recruits at once (bulk release). Reuses dismiss() per id, so the player / active /
// missing guards apply individually — a stale or invalid id is skipped, never mis-refunded. Returns the
// number actually released, the total essence refunded, and their names.
export function dismissMany(ids) {
  let count = 0, refund = 0; const names = [];
  for (const id of ids) { const r = dismiss(id); if (r.ok) { count++; refund += r.refund; names.push(r.name); } }
  return { count, refund, names };
}
