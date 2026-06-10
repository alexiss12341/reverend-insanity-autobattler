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
import { resourcesForPath } from './resources.js';
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
// (Env overrides exist only for headless balance sweeps — never set in the browser, so defaults ship.)
const envNum = (k, d) => { try { const v = typeof process !== 'undefined' && process.env && process.env[k]; return v ? Number(v) : d; } catch { return d; } };
// Tuned against an on-level mirror 6-team (tests/bounties.test.mjs): every slot is a winnable raid that
// costs 2–4 casualties (R1 Common the gentle intro), fights run ~30–65 actions, none stalemate.
const BOUNTY_HP_MULT = envNum('BOUNTY_HP_MULT', 7);
const BOUNTY_POOL_MULT = envNum('BOUNTY_POOL_MULT', 0.45);
// Stones scale on the same curve as floor rewards, with a bounty premium (limited attempts = better pay).
const BOUNTY_STONE_MULT = 6;
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
export function bountyName(i, path, dayKey) {
  const theme = pathName(path).replace(/ Path$/, '');
  const given = GIVEN[hash32(`${dayKey}|bname|${i}|${path}`) % GIVEN.length];
  return `${theme} ${MENACE[slotRarity(i)] || 'Rogue'} ${given}`;
}

// The killer archetype a lone boss arms (rank 3+ only): a status/affliction-leaning path gets a mystic
// single-target hex; everyone else gets a SELF-HEALING nuke (Bloodrush) — ideal for a solo target that
// has to both threaten and outlast a team. coreDomain is pinned to the archetype's domain in enemyUnit,
// so the loadout always fields a valid core.
function bountyKillerArch(path) {
  return pathAffinity(path).includes('potency') ? 'soulrend' : 'bloodrush';
}

// ---- rewards (spec only; granting lives in systems/bounties.js) ----------------------------------
// Guaranteed (attempts are the limiter): a stone lump + the rolled path's resources at the bounty's rank
// (a reliable source of that path's crafting mats) + 10·rank ✦ Immortal Essence.
export function bountyRewards(i, path) {
  const rank = slotRank(i);
  const floor = slotAnchorFloor(i);
  const stones = Math.round((10 + floor * 4) * BOUNTY_STONE_MULT);
  const drops = {};
  const qty = 2 + rank;                                   // 3..7 of each granted type
  for (const r of resourcesForPath(path).filter((r) => r.rank === rank).slice(0, 2)) drops[r.id] = qty;
  return { stones, essence: bountyEssence(i), drops };
}

// ---- the build -----------------------------------------------------------------------------------
// Compose slot `i`'s lone target for calendar day `dayKey`. Deterministic: same day → same target.
export function buildBounty(i, dayKey) {
  const rank = slotRank(i);
  const rarity = slotRarity(i);
  const path = bountyPath(i, dayKey);
  const floor = slotAnchorFloor(i);
  const name = bountyName(i, path, dayKey);
  const killerArch = rank >= 3 ? bountyKillerArch(path) : null;
  const rng = mulberry32(hash32(`${dayKey}|bunit|${i}|${path}`));
  const unit = enemyUnit(floor, name, {
    boss: true, fullGu: true, rng,            // boss → rarity = band cap (= slotRarity) + baked sustain effects + full kit
    forcePath: path, sustain: true,           // one-path resonant kit + a guaranteed self-heal Gu
    poolMult: BOUNTY_POOL_MULT, hpMult: BOUNTY_HP_MULT,
    killerArch,
  });
  unit.row = 'front'; unit.lane = 2;          // a lone boss stands front-and-centre
  return { slot: i, rank, rarity, path, floor, name, killerArch, unit, rewards: bountyRewards(i, path) };
}

// A full single-wave encounter for slot `i` on `dayKey`, shaped exactly like generateEncounter's output
// so systems/battle.js resolveEncounter can fight it unchanged.
export function buildBountyEncounter(i, dayKey) {
  const b = buildBounty(i, dayKey);
  return { floor: b.floor, isBoss: true, isWaveEncounter: false, isBounty: true,
    squad: 'Bounty', bounty: b, waves: [[b.unit]] };
}
