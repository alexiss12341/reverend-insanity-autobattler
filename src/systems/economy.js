// Economy: floor rewards (primeval stones + resource drops), first-clear / boss Immortal Essence,
// and the stone-funded shop (lower-tier resources). Equipment was removed for now.
import { S, activeTeam, immortalUnlocked } from '../state.js';
import { teamStoneFind, effectiveStats, guOf } from './cultivation.js';
import { resourcesForFloor, RESOURCES, resourceList, universalRankWeights, BINDER_FAMILIES, binderId } from '../data/resources.js';
import { rankOf } from '../data/realms.js';
import { rarityTier } from '../data/rarities.js';
import { prestigeGainMult } from './prestige.js';
import { lineEffects } from '../data/traits.js';
import { effAttr } from '../data/attributes.js';
import { pathList, isPathLocked, commOf, pathFloorReq } from '../data/daoPaths.js';
import { myriadMatId, myriadMatName, refineMatId, refineMatName, DERIVATION_CATALYST, REFINEMENT_CATALYST } from '../data/myriad.js';

// Overall character power for the Fortune tiebreak (mirrors battle.js auraPower: atk+def+hp).
const charPower = (c) => { const s = effectiveStats(c); return (s.atk || 0) + (s.def || 0) + (s.maxHp || 0); };
// Does Fortune cultivator `a` outrank `b` for the single active economy buff? rarity tier → realm → power.
function fortuneBeats(a, b) {
  const dt = rarityTier(a.rarity) - rarityTier(b.rarity); if (dt) return dt;
  const dr = (a.realm || 0) - (b.realm || 0); if (dr) return dr;
  return charPower(a) - charPower(b);
}
// FORTUNE line economy: only ONE instance is active (same rule as the support auras Warden/Mender) —
// the STRONGEST Fortune cultivator (rarity tier → realm → power → random), NOT a sum. Raises drop
// CHANCE and drop QUANTITY (and still nudges stone yield).
export function teamFortune() {
  const fs = activeTeam().filter((c) => { const lb = lineEffects(c); return lb && lb.fortune; });
  if (!fs.length) return 0;
  let best = fs[0];
  for (let i = 1; i < fs.length; i++) { const d = fortuneBeats(fs[i], best); if (d > 0 || (d === 0 && Math.random() < 0.5)) best = fs[i]; }
  return (lineEffects(best).fortune) || 0;
}
// LUCK raises drop chance & quantity, taken from the team's SINGLE highest-luck cultivator (not summed).
const LUCK_PER_POINT = 0.002, LUCK_CAP = 0.5;
export function teamLuck() {
  const team = activeTeam();
  if (!team.length) return 0;
  const maxLuck = team.reduce((m, c) => Math.max(m, effAttr(c, 'luck')), 0);
  return Math.min(LUCK_CAP, maxLuck * LUCK_PER_POINT);
}
// Combined drop bonus, applied to each resource's drop chance, the drop quantity, AND immortal-essence farming.
export const dropBonus = () => teamFortune() + teamLuck();

// ---- Drops on clearing an encounter on `floor` ----
// DROP MODEL. A clear yields at most 5 resource TYPES: up to PATH_DROP_CAP (4) path resources + 1
// universal binder that is ALWAYS granted. PATH resources: a floor's pool = every path resource eligible
// there (resourcesForFloor); each rolls INDEPENDENTLY against its own drop chance, set by its RANK (1-9;
// higher rank = rarer, so rank 5 is rarer than rank 4 even though they share the Epic colour), then the
// hits are trimmed to a random 4. UNIVERSAL binder: exactly one per clear, family ~50/50, RANK drawn from
// the floor's blended weights (universalRankWeights) — so the rank mix still slides up with depth.
// Fortune + Luck (dropBonus) scale each type's drop chance and the per-type quantity; bosses too.
const DROP_CHANCE = [0.50, 0.40, 0.30, 0.22, 0.16, 0.11, 0.07, 0.04, 0.025]; // base per-clear chance by rank 1..9
export const dropChance = (rank) => DROP_CHANCE[Math.max(1, Math.min(9, rank)) - 1] || 0.1;
export const PATH_DROP_CAP = 4; // max distinct PATH-resource types per clear (+1 always-on universal = 5 cap)
// Effective per-clear chance for a resource (rank base × boss × bonus), clamped to 95%.
const effDropChance = (r, isBoss, b) => Math.min(0.95, dropChance(r.rank) * (isBoss ? 1.5 : 1) * (1 + b));
function pickWeightedRank(weights) {
  let roll = Math.random(); // weights already sum to 1
  for (const k in weights) { roll -= weights[k]; if (roll <= 0) return Number(k); }
  return Number(Object.keys(weights)[0] || 1);
}

export function rollFloorRewards(floor, isBoss) {
  const b = dropBonus(); // Fortune + Luck → +drop chance & +quantity
  const stoneBase = Math.round((10 + floor * 4) * (isBoss ? 4 : 1));
  const stones = Math.round(stoneBase * (1 + teamStoneFind() + teamFortune()) * prestigeGainMult());

  const drops = {};
  const qty = () => Math.max(1, Math.round((isBoss ? 2 : 1) * (1 + b)));
  // PATH resources: roll each eligible one independently, then keep at most PATH_DROP_CAP distinct types.
  const hits = [];
  for (const r of resourcesForFloor(floor)) {
    if (!r.daoPath) continue; // the universal binder is granted separately below (always one)
    if (Math.random() < effDropChance(r, isBoss, b)) hits.push(r.id);
  }
  for (let i = hits.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [hits[i], hits[j]] = [hits[j], hits[i]]; } // Fisher–Yates
  for (const id of hits.slice(0, PATH_DROP_CAP)) drops[id] = (drops[id] || 0) + qty();
  // Universal binder: ALWAYS exactly one per clear — family ~50/50 (both stay obtainable), rank from the
  // floor's blended weights; quantity keeps the boss / Fortune+Luck scaling.
  const uw = universalRankWeights(floor);
  if (Object.keys(uw).length) {
    const id = binderId(BINDER_FAMILIES[Math.random() < 0.5 ? 0 : 1], pickWeightedRank(uw));
    drops[id] = (drops[id] || 0) + qty();
  }
  return { stones, drops };
}

// Deterministic drop chance for `resId` on `floor` — surfaced by the Almanac. For PATH resources this is
// the resource's own effective chance (independent rolls, factoring the team's Fortune + Luck; the 4-type
// cap only trims when >4 hit, so it's effectively this resource's marginal rate). For a UNIVERSAL binder
// the single guaranteed grant lands on this id at 0.5 (family pick) × its rank's share of the floor's
// blend. Returns null if it can't drop here.
export function dropEstimate(resId, floor, isBoss) {
  const r = RESOURCES[resId];
  if (!r) return null;
  if (!r.daoPath) {
    const uw = universalRankWeights(floor);
    if (!uw[r.rank]) return null;
    // One binder is guaranteed per clear; family is picked ~50/50, so a given binder id lands at
    // 0.5 × its rank's share of the floor's blend. (Boss/bonus scale quantity, not the type chance.)
    return { perClear: 0.5 * uw[r.rank] };
  }
  const pool = resourcesForFloor(floor);
  if (!pool.some((x) => x.id === resId)) return null;
  return { perClear: effDropChance(r, isBoss, dropBonus()) };
}

// First-clear Immortal Essence — a FLAT two-tier schedule (no per-floor scaling, so the deep tower
// can't balloon the faucet): floors 1-100 pay a healthy lump, floors 101-450 pay less; bosses ~2×.
// Returns essence granted (0 if repeat).
export function firstClearEssence(floor, isBoss) {
  if (S().clearedFloors[floor]) return 0;
  S().clearedFloors[floor] = true;
  const early = floor <= 100;                       // floors 1-100 = the early band
  const base = isBoss ? (early ? 80 : 50) : (early ? 40 : 20);
  return Math.round(base * prestigeGainMult());
}

// Renewable Immortal Essence from farming: a low CHANCE per clear to drop 1-3 ✦, scaling with floor
// depth. Base chance = 0.01% × floor (0.01% at F1 … 4.5% at F450), ×3 on bosses, × prestige Fortune.
// The team DROP BONUS (Fortune line + highest Luck) now ALSO scales BOTH this chance and the quantity,
// exactly like resource drops. First-clears remain the main faucet; this is an occasional bonus.
export function farmEssenceChance(floor, isBoss) {
  return Math.min(0.95, 0.0001 * floor * (isBoss ? 3 : 1) * prestigeGainMult());
}
function farmEssenceQty() { const r = Math.random(); return r < 0.20 ? 3 : r < 0.50 ? 2 : 1; }
export function rollFarmEssence(floor, isBoss) {
  const b = dropBonus(); // Fortune + Luck also boost immortal-essence drop rate & quantity
  if (Math.random() >= Math.min(0.95, farmEssenceChance(floor, isBoss) * (1 + b))) return 0;
  return Math.max(1, Math.round(farmEssenceQty() * (1 + b)));
}
// Expected ✦ per clear — effective chance × mean quantity (1.7), both scaled by the team drop bonus.
export const farmEssenceEV = (floor, isBoss) => {
  const b = dropBonus();
  return Math.min(0.95, farmEssenceChance(floor, isBoss) * (1 + b)) * 1.7 * (1 + b);
};

// ---- Immortal Essence Stones (仙石) — the fuel for immortal-rank Gu ----
// A renewable faucet from clearing floors, GATED to immortal cultivation: nothing flows until the
// roster reaches Rank 6 (immortalUnlocked). Yield is floor-scaled (the immortal band starts at Floor
// 251) and rides the same boss / Fortune+Luck / prestige multipliers as the stone reward. Tuning knob.
const IMM_STONE_BASE = 30;     // flat per-clear floor once unlocked
const IMM_STONE_PER_FLOOR = 0.6; // additional 仙石 per floor of depth
export function rollImmortalStones(floor, isBoss) {
  if (!immortalUnlocked()) return 0;
  const base = (IMM_STONE_BASE + IMM_STONE_PER_FLOOR * floor) * (isBoss ? 3 : 1);
  return Math.max(1, Math.round(base * (1 + dropBonus()) * prestigeGainMult()));
}

// Per-clear UPKEEP: every immortal Gu (tier 6+) the ACTIVE team channels burns this much 仙石 each clear,
// so a heavy immortal loadout is a real drain (run out → those Gu go inert, see cultivation.effectiveStats).
// The faucet above comfortably covers a normal loadout at appropriate depth; grinding a far-too-low floor
// with many immortal Gu can run the pool dry. Tuning knob.
export const IMM_STONE_UPKEEP_PER_GU = 5;
// How many immortal Gu (tier 6+) the active team has equipped — the upkeep multiplier.
export function immortalGuCount() {
  let n = 0;
  for (const c of activeTeam()) for (const uid of (c.gu || [])) { const g = guOf(uid); if (g && g.tier >= 6) n++; }
  return n;
}
export const immortalGuUpkeep = () => immortalGuCount() * IMM_STONE_UPKEEP_PER_GU;

export function addStones(n) { S().stones += n; }
export function addEssence(n) { S().essence += n; }
export function addImmortalStones(n) { S().immortalStones = Math.max(0, (S().immortalStones || 0) + n); }
export function addResource(id, n) { S().resources[id] = (S().resources[id] || 0) + n; }
export function applyDrops(drops) { for (const id in drops) addResource(id, drops[id]); }

// ---- Shop (spend primeval stones) ----
// (Equipment — weapons/armor — was removed for now; the shop sells only resources.)
// The Market stocks any floor-droppable resource you have UNLOCKED. Two gates, BOTH required:
//   1. Floor clear — you must have beaten the first floor the resource can drop from (its band start).
//   2. Roster rank — its RANK must be ≤ your highest cultivator's rank (a rank-3 roster gets no rank-4+
//      resources), so you can't buy materials your cultivation is nowhere near.
// Price climbs steeply by RANK (1..9) so deep materials are a real stone sink.
export const resourceCost = (id) => Math.round(300 * Math.pow(2.6, ((RESOURCES[id] && RESOURCES[id].rank) || 1) - 1));

// Highest cultivation rank (1-based: 1..9) across the player's roster — the realm gate's ceiling.
export const highestRosterRank = () => S().roster.reduce((m, c) => Math.max(m, rankOf(c.realm) + 1), 1);

// Is this resource currently for sale? (both gates above). `r` is a resource object.
export function marketUnlocked(r) {
  if (!r) return false;
  const beatenDropFloor = (S().frontier - 1) >= r.floors[0]; // cleared a floor in its drop band
  const withinRosterRank = (r.rank || 1) <= highestRosterRank();
  return beatenDropFloor && withinRosterRank;
}

// All resources currently purchasable, sorted by rank, then universal-before-path, then name.
export function shopResources() {
  return resourceList()
    .filter(marketUnlocked)
    .sort((a, b) => (a.rank || 0) - (b.rank || 0)
      || (a.daoPath ? 1 : 0) - (b.daoPath ? 1 : 0)
      || a.name.localeCompare(b.name));
}

export function buyResource(id, qty = 1) {
  const r = RESOURCES[id];
  if (!r) return { ok: false, msg: 'Unknown resource.' };
  if (!marketUnlocked(r)) return { ok: false, msg: 'Locked — beat the floor it drops from and raise a cultivator to its tier.' };
  const cost = resourceCost(id) * qty;
  if (S().stones < cost) return { ok: false, msg: 'Not enough primeval stones.' };
  S().stones -= cost;
  addResource(id, qty);
  return { ok: true };
}

// ---- Myriad Refining economy: the regular Market's Stabilizing Catalyst, the Arena Shop (Merit scrip),
// and the ranking-bracket payout. All faucet through the Arena (see data/myriad.js / systems/myriad.js).

// The Derivation Catalyst (fusion success boost) is also buyable in the regular Market for primeval stones
// (steep — it stays a rare trump; the cheap routes are boss first-clears + Arena win drops).
export const CATALYST_MARKET_PRICE = 250000;
export function buyCatalyst(qty = 1) {
  qty = Math.max(1, qty | 0);
  const cost = CATALYST_MARKET_PRICE * qty;
  if ((S().stones || 0) < cost) return { ok: false, msg: 'Not enough primeval stones.' };
  S().stones -= cost;
  S().derivationCatalysts = (S().derivationCatalysts || 0) + qty;
  return { ok: true, cost };
}

// ---- Arena Shop (spend Arena Merits) — always-available, per-week purchase caps ----
const MAT_MERIT_PRICE = { common: 45, uncommon: 85, rare: 150, esoteric: 250, supreme: 250 };
const CATALYST_MERIT_PRICE = 180, FRAG_BUNDLE = 50, FRAG_BUNDLE_PRICE = 80;
const SHOP_CAP = { material: 15, catalyst: 6, fragments: 10 };
const FRAG_BUNDLE_ID = 'frag_bundle';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const shopWeekKey = () => Math.floor(Date.now() / WEEK_MS);
// Reset the weekly purchase-cap counters when the season boundary rolls over.
function ensureShopWeek() {
  const s = S(); if (!s) return;
  if (s._shopWeek !== shopWeekKey()) { s._shopWeek = shopWeekKey(); s.arenaShopBought = {}; }
}
// Has the player cleared the floor that gates this path? (mirrors the Market's beaten-drop-floor gate)
const pathUnlockedForShop = (pid) => (S().frontier - 1) >= pathFloorReq(pid);

export function arenaShopStock() {
  ensureShopWeek();
  const bought = S().arenaShopBought || {};
  const left = (id, cap) => Math.max(0, cap - (bought[id] || 0));
  const out = [];
  for (const p of pathList()) {
    if (isPathLocked(p.id) || !pathUnlockedForShop(p.id)) continue;
    const price = MAT_MERIT_PRICE[commOf(p.id).key] || 45;
    // Derivation Core (fusion) + Refinement Core (rank-up) — same per-commonality price.
    out.push({ id: myriadMatId(p.id), kind: 'dcore', path: p.id, name: myriadMatName(p.id), price, cap: SHOP_CAP.material, left: left(myriadMatId(p.id), SHOP_CAP.material) });
    out.push({ id: refineMatId(p.id), kind: 'rcore', path: p.id, name: refineMatName(p.id), price, cap: SHOP_CAP.material, left: left(refineMatId(p.id), SHOP_CAP.material) });
  }
  // Derivation Catalyst (fusion success) + Refinement Catalyst (rank-up shatter reducer) — same price.
  out.push({ id: DERIVATION_CATALYST.id, kind: 'dcat', name: DERIVATION_CATALYST.name, price: CATALYST_MERIT_PRICE, cap: SHOP_CAP.catalyst, left: left(DERIVATION_CATALYST.id, SHOP_CAP.catalyst) });
  out.push({ id: REFINEMENT_CATALYST.id, kind: 'rcat', name: REFINEMENT_CATALYST.name, price: CATALYST_MERIT_PRICE, cap: SHOP_CAP.catalyst, left: left(REFINEMENT_CATALYST.id, SHOP_CAP.catalyst) });
  out.push({ id: FRAG_BUNDLE_ID, kind: 'fragments', name: `${FRAG_BUNDLE} Derivation Fragments`,
    price: FRAG_BUNDLE_PRICE, cap: SHOP_CAP.fragments, left: left(FRAG_BUNDLE_ID, SHOP_CAP.fragments) });
  return out;
}

export function arenaShopBuy(id, qty = 1) {
  ensureShopWeek();
  const stock = arenaShopStock().find((s) => s.id === id);
  if (!stock) return { ok: false, msg: 'Not available.' };
  qty = Math.max(1, qty | 0);
  if (qty > stock.left) return { ok: false, msg: `Weekly limit — ${stock.left} left.` };
  const cost = stock.price * qty;
  if ((S().arenaMerits || 0) < cost) return { ok: false, msg: `Need ${cost} Arena Merits.` };
  S().arenaMerits -= cost;
  S().arenaShopBought[id] = (S().arenaShopBought[id] || 0) + qty;
  if (stock.kind === 'dcore') S().myriadMats[stock.path] = (S().myriadMats[stock.path] || 0) + qty;
  else if (stock.kind === 'rcore') S().refineMats[stock.path] = (S().refineMats[stock.path] || 0) + qty;
  else if (stock.kind === 'dcat') S().derivationCatalysts = (S().derivationCatalysts || 0) + qty;
  else if (stock.kind === 'rcat') S().refinementCatalysts = (S().refinementCatalysts || 0) + qty;
  else if (stock.kind === 'fragments') S().derivationFragments = (S().derivationFragments || 0) + qty * FRAG_BUNDLE;
  return { ok: true, cost };
}

// ---- Ranking-bracket payout (Merits + Fragments by ladder standing; highest eligible bracket only) ----
export const ARENA_RANK_REWARDS = {
  weekly: { 1: [500, 300], 2: [430, 260], 3: [380, 230], 4: [340, 205], 5: [300, 180],
    top10: [240, 145], top50: [180, 110], top100: [140, 85], p10: [100, 60], p25: [70, 42], p50: [45, 27], rest: [25, 15] },
  daily:  { 1: [100, 60], 2: [85, 50], 3: [75, 45], 4: [68, 40], 5: [60, 36],
    top10: [48, 29], top50: [36, 22], top100: [28, 17], p10: [20, 12], p25: [14, 8], p50: [9, 5], rest: [5, 3] },
};
// Absolute ranks 1-5 / Top 10/50/100 take priority (more generous); percentiles only beyond rank 100.
export function arenaRankBracket(rank, N) {
  if (rank <= 5) return String(rank);
  if (rank <= 10) return 'top10';
  if (rank <= 50) return 'top50';
  if (rank <= 100) return 'top100';
  const pct = N > 0 ? rank / N : 1;
  if (pct <= 0.10) return 'p10';
  if (pct <= 0.25) return 'p25';
  if (pct <= 0.50) return 'p50';
  return 'rest';
}
export function arenaRankReward(rank, N, cadence = 'daily') {
  const tbl = ARENA_RANK_REWARDS[cadence] || ARENA_RANK_REWARDS.daily;
  const b = arenaRankBracket(rank, N);
  const [merits, fragments] = tbl[b] || tbl.rest;
  return { merits, fragments, bracket: b };
}
