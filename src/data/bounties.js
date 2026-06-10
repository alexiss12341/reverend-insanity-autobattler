// Bounties — daily-rotating lone RAID-BOSS hunts. Five slots, one per realm band:
//   slot 0 → Rank 1 Common · 1 → Rank 2 Uncommon · 2 → Rank 3 Rare · 3 → Rank 4 Epic · 4 → Rank 5 Legendary.
// Each slot's RANK/RARITY is FIXED (it's the gating + difficulty identity); only the slot's DAO PATH
// ROTATES daily — deterministically seeded by the calendar day + slot — and that path themes the
// target's whole Gu kit, its generated name, and the resource reward.
//
// A bounty is a SINGLE-enemy encounter. A lone unit against a full 6-team would normally be trivial, so
// the target is built as a RAID BOSS: the band's Peak sub-realm, full Gu loadout, a guaranteed offense
// (or mystic) CORE + a self-sustain Gu, a fitting killer move (rank 3+), and the raid-boss bulk/pool
// knobs below — a fat health bar with threatening-but-fair output that one focused team can bring down.
//
// Pure data/build layer (DOM-free, no state mutation): the encounter is assembled via floors.js
// enemyUnit so it shares ALL the enemy build machinery (per-Gu essence ladder, aperture sizing, killer
// assembly, line traits). The attempts pool + reward GRANTING live in systems/bounties.js; the caller
// passes the day key, so this stays headless-testable and free of the systems layer.
import { enemyUnit } from './floors.js';
import { pathList, commOf, pathName, isPathLocked, pathAffinity } from './daoPaths.js';
import { domainOfKind } from './combos.js';
import { lineName } from './traits.js';
import { guList } from './gu.js';
import { RARITY_ORDER } from './rarities.js';

export const BOUNTY_SLOTS = 5;

// ---- slot identity (fixed per slot) --------------------------------------------------------------
export const slotRank = (i) => i + 1;                         // 1..5
export const slotRarity = (i) => RARITY_ORDER[i] || 'Common'; // Common..Legendary
// Anchor floor = the band's GATE floor → Peak sub-realm + the band's TOP rarity (cap === slotRarity).
const slotAnchorFloor = (i) => slotRank(i) * 50;              // 50,100,150,200,250
// Progression gate: a slot unlocks once the player's frontier reaches its band start.
// R1 from the start (1); R2 at 51, R3 at 101, R4 at 151, R5 at 201.
export const slotUnlockFloor = (i) => (i <= 0 ? 1 : i * 50 + 1);

// ---- raid-boss tuning knobs (validated by tests/bounties.test.mjs) -------------------------------
// hpMult = extra bulk over a normal gate boss (so a SOLO target survives a full team's focus fire);
// poolMult = overall invested-pool scale (drives ATK/DEF threat). Kept separate so we fatten the health
// bar without inflating ATK into one-shots. These are THE balance levers for the whole bounty ladder.
// PER SLOT: a lone target is a 6-vs-1, where the boss either out-bursts the team or gets DPS-raced — a
// knife-edge that differs sharply by rank (the R1 boss has no killer + only 3 Gu, so it needs FAR more
// bulk to threaten a 6-team than the fully-kitted R5 boss). Tuned (tests/bounties.test.mjs) so a rank-
// and rarity-MATCHED 6-team wins AT MOST ~60% (target ~45–55%): a genuine raid at every tier.
// (Env scalars + the buildBounty override exist only for headless balance sweeps — never set in the
// browser, so the per-slot defaults ship.)
const envNum = (k, d) => { try { const v = typeof process !== 'undefined' && process.env && process.env[k]; return v ? Number(v) : d; } catch { return d; } };
const HP_SCALE = envNum('BOUNTY_HP_SCALE', 1), POOL_SCALE = envNum('BOUNTY_POOL_SCALE', 1);
// Tuned (tests/bounties.test.mjs) against a FULLY-OPTIMIZED rank/rarity-matched 6-team — comprehension at
// the rank cap, every Gu slot filled with cap-tier same-path Gu (full resonance), and killer moves — since
// that's the real team a player brings to a bounty (a comp-0 team's Gu run at 10–25%, which made earlier
// tuning far too soft). Win for that maxed team: R1 ~65% (the gentle Common intro), R2 ~45%, and ~30–37%
// on R3–R5 (deliberately the harder, more punishing end on the higher bounties) — ordinary teams find a raid.
//                       R1     R2     R3     R4     R5
const BOUNTY_HP_MULT   = [8,     10,    12,    10,    20];
const BOUNTY_POOL_MULT = [0.50,  0.50,  0.55,  0.60,  0.70];
const slotHpMult   = (i) => (BOUNTY_HP_MULT[i]   != null ? BOUNTY_HP_MULT[i]   : 7)    * HP_SCALE;
const slotPoolMult = (i) => (BOUNTY_POOL_MULT[i] != null ? BOUNTY_POOL_MULT[i] : 0.5)  * POOL_SCALE;
// Stones = a big premium on the rank's REALM-GATE boss clear (limited attempts → premium pay). The
// gate-boss base mirrors economy.js rollFloorRewards: (10 + gateFloor×4) × 4 (the ×4 boss factor).
const BOUNTY_STONE_GATE_MULT = 25;
const realmGateBossStone = (floor) => (10 + floor * 4) * 4;  // base stones a boss clear of that gate floor pays
// Immortal Essence (✦) reward: 10·rank → 10 / 20 / 30 / 40 / 50, exactly the design's 10–50 ladder.
export const bountyEssence = (i) => 10 * slotRank(i);

// ---- deterministic helpers -----------------------------------------------------------------------
const hash32 = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Paths this slot may roll: any non-locked path already unlocked at the slot's anchor floor.
function eligiblePaths(i) {
  const cap = slotAnchorFloor(i);
  return pathList().filter((p) => !isPathLocked(p.id) && commOf(p.id).floorReq <= cap).map((p) => p.id);
}
// Bias the daily roll toward the DEEPEST commonality a slot has unlocked, so higher bounties tend to
// show off the rarer paths they just opened (a few common still slip through for variety).
const pathWeight = (p) => { const f = commOf(p).floorReq; return f >= 201 ? 8 : f >= 101 ? 4 : f >= 51 ? 2 : 1; };

// The Dao path for slot `i` on calendar day `dayKey` (e.g. '2026-06-10') — stable across reloads/offline.
export function bountyPath(i, dayKey) {
  const paths = eligiblePaths(i);
  if (!paths.length) return 'metal';
  let total = 0; for (const p of paths) total += pathWeight(p);
  let r = (hash32(`${dayKey}|bpath|${i}`) % 1000000) / 1000000 * total;
  for (const p of paths) { r -= pathWeight(p); if (r <= 0) return p; }
  return paths[paths.length - 1];
}

// ---- generated target name -----------------------------------------------------------------------
const MENACE = { Common: 'Rogue', Uncommon: 'Outlaw', Rare: 'Demon', Epic: 'Devil', Legendary: 'Calamity' };
const GIVEN = ['Sha Tu', 'Du Yan', 'Hun Sha', 'Huan Jing', 'Wu Hen', 'Mo Gui', 'Xie Feng', 'Gui Mu',
  'Yan Luo', 'Ku Rong', 'Sang Yu', 'Bai Gu', 'Xue Ming', 'Du Gu', 'Han Shuang', 'Qian Shou'];
// "<given> the <Path> <Archetype-epithet>", e.g. "Mo Gui the Blade Worldcleaver" — the title carries
// BOTH the path theme and the rarity-tiered archetype epithet (traits.js lineName).
export function bountyName(i, path, line, dayKey) {
  const theme = pathName(path).replace(/ Path$/, '');
  const given = GIVEN[hash32(`${dayKey}|bname|${i}|${path}`) % GIVEN.length];
  const title = lineName(line, slotRarity(i)) || MENACE[slotRarity(i)] || 'Rogue';
  return `${given} the ${theme} ${title}`;
}

// The combat ARCHETYPE LINE a bounty boss wears. The rolled path's dominant effect-domain selects a POOL
// of fitting lines, and the day's slots are assigned together (least-used spread) — so same-domain bosses
// still DIVERSIFY while staying coherent with the path. The line both grants tiered stat bonuses
// (data/traits.js LINES) AND drives a matching killer (floors.js LINE_KILLER): an offense path → a
// Slayer/Vanguard nuke or a Plaguebringer (Afflictor) hex, a defensive path → a Wall's shield/taunt, etc.
// EXCLUDED archetypes (BOUNTY_LINE_BLOCKLIST): REAVER (stacked lifesteal out-sustains a team's DPS on a
// lone boss → near-unkillable) and ASSASSIN (replaced by the debuff-focused Afflictor / "Plaguebringer").
const BOUNTY_LINE_BLOCKLIST = new Set(['reaver', 'assassin']); // archetypes excluded from the lone-boss mode
function bountyLinePool(path) {
  const aff = pathAffinity(path), counts = {};
  for (const k of aff) { const d = domainOfKind(k); if (d) counts[d] = (counts[d] || 0) + 1; }
  const domain = Object.keys(counts).sort((a, b) => counts[b] - counts[a])[0] || 'offense';
  let pool;
  if (domain === 'offense') pool = ['slayer', 'vanguard', 'afflictor']; // Afflictor (Plaguebringer) replaces Assassin
  else if (domain === 'motion') pool = ['tempest', 'afflictor'];
  else if (domain === 'mystic') pool = ['afflictor', 'tempest'];        // status paths → debuff-focused Afflictor
  else pool = ['wall', 'vanguard', 'slayer'];       // guard + vigor → bulk/bruiser/aggressive
  return pool.filter((l) => !BOUNTY_LINE_BLOCKLIST.has(l));
}
// Assign all five slots' lines TOGETHER so a day's archetypes spread out instead of clustering (when
// several rolled paths share a domain). Deterministic greedy: walk the slots in order and pick, from each
// slot's fitting pool, the line used LEAST across the day so far (hash tiebreak) — every pick still comes
// from that slot's own path-pool, so it stays coherent. Stable per day (bountyPath is deterministic).
function assignDayLines(dayKey) {
  const used = {}, out = {};
  for (let s = 0; s < BOUNTY_SLOTS; s++) {
    const path = bountyPath(s, dayKey);
    const pool = bountyLinePool(path);
    if (!pool.length) { out[s] = 'slayer'; continue; }
    let best = pool[0], bestCount = Infinity, bestH = -1;
    for (const l of pool) {
      const c = used[l] || 0, h = hash32(`${dayKey}|bline|${s}|${path}|${l}`);
      if (c < bestCount || (c === bestCount && h > bestH)) { best = l; bestCount = c; bestH = h; }
    }
    used[best] = (used[best] || 0) + 1;
    out[s] = best;
  }
  return out;
}
const bountyLine = (i, dayKey) => assignDayLines(dayKey)[i] || 'slayer';

// ---- rewards (spec + roll; granting lives in systems/bounties.js) --------------------------------
// A guaranteed stone lump + 10·rank ✦, plus a CHANCE at a random Gu of the boss's Dao path. The Gu's
// RANK is a lottery: 30% at the bounty's OWN rank, the remaining 70% split EVENLY across all LOWER ranks.
// Rank 1 has no lower rank, so its 70% is a MISS (no Gu). e.g. R3 → 30% R3 · 35% R2 · 35% R1.
export function bountyGuChances(rank) {
  const out = { [rank]: 0.30 };
  const lowers = rank - 1;
  if (lowers > 0) { const each = 0.70 / lowers; for (let r = 1; r < rank; r++) out[r] = each; }
  return out; // rank 1 sums to 0.30 → the other 0.70 is an implicit miss
}
// The non-unique (mortal, tier 1-5) Gu of a path at a given tier — the pool a bounty Gu reward draws from.
const guPoolForPathTier = (path, tier) => guList().filter((g) => g.daoPath === path && g.tier === tier && !g.unique);
// Roll the Gu reward for a `rank` bounty on `path`: pick a rank by the chance ladder, then a random
// non-unique Gu of the path at that tier. Returns a guId, or null (the rank-1 miss / empty pool).
export function rollBountyGu(path, rank, rng = Math.random) {
  const chances = bountyGuChances(rank);
  let roll = rng(), chosen = null;
  for (let r = rank; r >= 1; r--) { const p = chances[r] || 0; if (roll < p) { chosen = r; break; } roll -= p; }
  if (!chosen) return null;
  const pool = guPoolForPathTier(path, chosen);
  return pool.length ? pool[Math.floor(rng() * pool.length)].id : null;
}
export function bountyRewards(i, path) {
  const rank = slotRank(i);
  const floor = slotAnchorFloor(i);             // = the rank's realm-gate floor
  const stones = realmGateBossStone(floor) * BOUNTY_STONE_GATE_MULT;  // 25× the gate boss's stone yield
  // guReward = the chance descriptor (for the UI); the actual Gu is rolled at win time in systems/bounties.js.
  return { stones, essence: bountyEssence(i), guReward: { path, rank, chances: bountyGuChances(rank) } };
}

// ---- the build -----------------------------------------------------------------------------------
// Compose slot `i`'s lone target for calendar day `dayKey`. Deterministic: same day → same target.
// `tune` (poolMult/hpMult) is an optional override for headless balance sweeps; production passes none.
export function buildBounty(i, dayKey, tune = {}) {
  const rank = slotRank(i);
  const rarity = slotRarity(i);
  const path = bountyPath(i, dayKey);
  const floor = slotAnchorFloor(i);
  const line = bountyLine(i, dayKey);         // archetype line (day-spread; drives stat bonuses + killer)
  const name = bountyName(i, path, line, dayKey);
  const rng = mulberry32(hash32(`${dayKey}|bunit|${i}|${path}`));
  const unit = enemyUnit(floor, name, {
    boss: true, fullGu: true, rng,            // boss → rarity = band cap (= slotRarity) + baked sustain effects + full kit
    squad: { lines: { boss: line }, aura: null }, // wear the derived archetype line (its tiered bonuses + killer pool)
    forceKiller: true,                        // even the R1/R2 elite targets arm their line's signature move
    forcePath: path, sustain: true,           // one-path resonant kit + a guaranteed self-heal Gu
    poolMult: tune.poolMult != null ? tune.poolMult : slotPoolMult(i),
    hpMult: tune.hpMult != null ? tune.hpMult : slotHpMult(i),
  });
  unit.row = 'front'; unit.lane = 2;          // a lone boss stands front-and-centre
  return { slot: i, rank, rarity, path, line, floor, name, unit, rewards: bountyRewards(i, path) };
}

// A full single-wave encounter for slot `i` on `dayKey`, shaped exactly like generateEncounter's output
// so systems/battle.js resolveEncounter can fight it unchanged.
export function buildBountyEncounter(i, dayKey, tune = {}) {
  const b = buildBounty(i, dayKey, tune);
  return { floor: b.floor, isBoss: true, isWaveEncounter: false, isBounty: true,
    squad: 'Bounty', bounty: b, waves: [[b.unit]] };
}
