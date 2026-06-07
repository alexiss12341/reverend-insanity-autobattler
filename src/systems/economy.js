// Economy: floor rewards (primeval stones + resource drops), first-clear / boss Immortal Essence,
// and the stone-funded shop (lower-tier resources). Equipment was removed for now.
import { S, activeTeam } from '../state.js';
import { teamStoneFind, effectiveStats } from './cultivation.js';
import { resourcesForFloor, RESOURCES, resourceList, universalRankWeights, BINDER_FAMILIES, binderId } from '../data/resources.js';
import { rankOf } from '../data/realms.js';
import { rarityTier } from '../data/rarities.js';
import { prestigeGainMult } from './prestige.js';
import { lineEffects } from '../data/traits.js';
import { effAttr } from '../data/attributes.js';

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
// DROP MODEL. PATH resources: a floor's pool = every path resource eligible there (resourcesForFloor);
// on each clear EVERY one rolls INDEPENDENTLY against its own drop chance, set by its RANK (1-9; higher
// rank = rarer, so rank 5 is rarer than rank 4 even though they share the Epic colour). UNIVERSAL binders
// follow a different rule (see universalRankWeights): each family rolls ONCE, and on a hit the RANK is
// drawn from the floor's blended weights — so the rank mix slides up with depth while deep binders still
// thin out. Fortune + Luck (dropBonus) scale both the chance and the quantity; bosses too.
const DROP_CHANCE = [0.50, 0.40, 0.30, 0.22, 0.16, 0.11, 0.07, 0.04, 0.025]; // base per-clear chance by rank 1..9
export const dropChance = (rank) => DROP_CHANCE[Math.max(1, Math.min(9, rank)) - 1] || 0.1;
// Effective per-clear chance for a resource (rank base × boss × bonus), clamped to 95%.
const effDropChance = (r, isBoss, b) => Math.min(0.95, dropChance(r.rank) * (isBoss ? 1.5 : 1) * (1 + b));
// A binder FAMILY's per-clear fire-chance on `floor` = the active ranks' shares × each rank's base
// chance (so a floor dominated by rarer ranks fires less often), then the usual boss/bonus scaling.
function universalChance(weights, isBoss, b) {
  let c = 0; for (const k in weights) c += weights[k] * dropChance(Number(k));
  return Math.min(0.95, c * (isBoss ? 1.5 : 1) * (1 + b));
}
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
  for (const r of resourcesForFloor(floor)) {
    if (!r.daoPath) continue; // universal binders handled below via the blended rank mix
    if (Math.random() < effDropChance(r, isBoss, b)) drops[r.id] = (drops[r.id] || 0) + qty();
  }
  // Universal binders: each family rolls once; a hit draws its rank from the floor's blended weights.
  const uw = universalRankWeights(floor);
  if (Object.keys(uw).length) {
    const uChance = universalChance(uw, isBoss, b);
    for (const fam of BINDER_FAMILIES) {
      if (Math.random() < uChance) { const id = binderId(fam, pickWeightedRank(uw)); drops[id] = (drops[id] || 0) + qty(); }
    }
  }
  return { stones, drops };
}

// Deterministic drop chance for `resId` on `floor` — surfaced by the Almanac. For PATH resources this is
// just the resource's own effective chance (independent rolls). For a UNIVERSAL binder it's the family's
// fire-chance × that rank's share of the floor's blend. Both factor in the team's Fortune + Luck. Returns
// null if it can't drop here.
export function dropEstimate(resId, floor, isBoss) {
  const r = RESOURCES[resId];
  if (!r) return null;
  if (!r.daoPath) {
    const uw = universalRankWeights(floor);
    if (!uw[r.rank]) return null;
    return { perClear: universalChance(uw, isBoss, dropBonus()) * uw[r.rank] };
  }
  const pool = resourcesForFloor(floor);
  if (!pool.some((x) => x.id === resId)) return null;
  return { perClear: effDropChance(r, isBoss, dropBonus()) };
}

// First-clear Immortal Essence (boss floors give far more). Returns essence granted (0 if repeat).
export function firstClearEssence(floor, isBoss) {
  if (S().clearedFloors[floor]) return 0;
  S().clearedFloors[floor] = true;
  const base = isBoss ? 25 + floor : 4 + Math.floor(floor / 2);
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

export function addStones(n) { S().stones += n; }
export function addEssence(n) { S().essence += n; }
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
