// Attribute & derived-stat system — Phase 1 of the stat/combat overhaul (see project memory
// `stat-combat-overhaul.md`). Characters are defined by FIVE attributes; every combat stat DERIVES
// from them. Realm progression grants attribute points and the whole power gulf lives in those
// points — there is NO realm multiplier. Pure data/math: imported by systems/cultivation.js (allies)
// and data/floors.js (enemies) so both sides share one derivation.
import { rankOf, MORTAL_PEAK } from './realms.js';

export const ATTR_KEYS = ['str', 'agi', 'con', 'int', 'luck'];

// Flat per-attribute FLOOR by rarity (a fresh, unallocated character is still functional; higher
// rarity = higher innate floor). Added to allocated points in the derivation.
const BASE_ATTR = { Common: 4, Uncommon: 5, Rare: 7, Epic: 10, Legendary: 14, Immortal: 20 };
export const baseAttr = (rarity) => BASE_ATTR[rarity] || BASE_ATTR.Common;

// Bonus allocatable points by rarity (head start in the point economy).
const RARITY_BONUS = { Common: 0, Uncommon: 8, Rare: 20, Epic: 40, Legendary: 80, Immortal: 150 };
export const rarityBonus = (rarity) => RARITY_BONUS[rarity] || 0;

// Cumulative attribute points available at each realm index 0..23 (mortal stages 0-19, immortal
// 20-23). Small per-stage grants (scaling by rank); huge, escalating rank-up grants (immortal ~×4-5).
const P = [20, 25, 30, 35, 75, 85, 95, 105, 195, 215, 235, 255, 455, 495, 535, 575, 975, 1055, 1135, 1215, 3715, 15715, 70715, 320715];
export const realmPointsTotal = (realm) => P[Math.max(0, Math.min(23, realm | 0))];
// Interpolate the P table at a fractional realm index (used to scale enemies across a floor band).
export function poolAtIndex(idx) {
  idx = Math.max(0, Math.min(23, idx));
  const lo = Math.floor(idx), hi = Math.min(23, lo + 1);
  return P[lo] + (P[hi] - P[lo]) * (idx - lo);
}

// Per-attribute "budget" for the diminishing % stats — realm-relative, so a % stat depends on the
// ALLOCATION RATIO, not raw magnitude (all-in ≈ 83% of cap, even spread ≈ 50%, at any realm).
export const budget = (pool) => Math.max(1, pool / 5);

// Enemy role → how it spreads its point pool across the five attributes (sums to ~1).
export const ROLE_WEIGHTS = {
  tank:       { con: 0.56, str: 0.16, agi: 0.10, int: 0.12, luck: 0.06 },
  bruiser:    { con: 0.28, str: 0.34, agi: 0.20, int: 0.12, luck: 0.06 },
  skirmisher: { con: 0.13, str: 0.21, agi: 0.48, int: 0.12, luck: 0.06 },
  striker:    { con: 0.13, str: 0.53, agi: 0.16, int: 0.12, luck: 0.06 },
  boss:       { con: 0.34, str: 0.34, agi: 0.14, int: 0.12, luck: 0.06 },
};
export function roleAttrs(role, pool) {
  const w = ROLE_WEIGHTS[role] || ROLE_WEIGHTS.bruiser;
  const a = {};
  for (const k of ATTR_KEYS) a[k] = pool * (w[k] || 0);
  return a;
}

// Diminishing-returns % toward `cap`, realm-relative via B.
const dim = (attr, B, cap) => (cap * attr) / (attr + B);

// APERTURE CAPACITY: aptitude sets the FRACTION of the (INT-derived) aperture a cultivator can fill.
// Per Reverend Insanity, talent grades map to % capacity; here aptitude 2.5 = 100% (Extreme), so
// capacity = min(1, aptitude/2.5). Grades: Extreme 100 · A 80-99 · B 60-79 · C 40-59 · D 20-39.
export const apertureCapacity = (aptitude) => Math.min(1, Math.max(0, (aptitude || 0) / 2.5));
export function apertureGrade(cap) {
  const pct = Math.round(cap * 100);
  const grade = pct >= 100 ? 'Extreme' : pct >= 80 ? 'A' : pct >= 60 ? 'B' : pct >= 40 ? 'C' : 'D';
  return { pct, grade };
}
// Aptitude ALSO scales essence regen — same shape as capacity but HALF the harshness: the shortfall
// below 100% is halved, so D-grade (20% capacity) still regens at 60%, A at 94%, Extreme at 100%.
export const apertureRegenFactor = (aptitude) => (1 + apertureCapacity(aptitude)) / 2;

// THE derivation: attributes (a) + realm budget (B) → full derived-stat block. Raw stats are linear
// (carry the gulf); % stats are diminishing toward ~100% (Lucky Hit ~50%); Speed is deliberately
// flat. Roll-chances are NOT clamped here — the battle engine applies the [1%,99%] clamp at use.
export function deriveStats(a, B) {
  const str = a.str || 0, agi = a.agi || 0, con = a.con || 0, int = a.int || 0, luck = a.luck || 0;
  return {
    maxHp: 60 + con * 9,
    atk: 6 + str * 1.5,
    def: 3 + con * 0.5,
    spd: 8 + 30 * dim(agi, B, 1),            // flat-ish (8..~38) so gauge timing never explodes
    essencePool: Math.round(40 + int * 4),
    essenceRegen: 2 + int * 0.25,
    critChance: dim(luck, B, 1),
    critDamage: 1.5 + 4.0 * dim(str, B, 1),  // multiplier ~1.5 .. ~5.5
    critResist: dim(con, B, 1),
    evasion: dim(agi + 0.25 * luck, B, 1),
    hitChance: dim(agi, B, 0.9),             // +bonus over the 85% base hit
    armorPen: dim(str, B, 1),
    potency: dim(int, B, 0.9),               // +bonus over a status's base inflict
    statusResist: dim(con, B, 1),
    luckyHit: dim(luck, B, 0.5),
  };
}

// APTITUDE-OVERFLOW point bonus. Each MORTAL breakthrough (the step FROM realm r, r = 0 .. MORTAL_PEAK-1)
// grants its base attribute points PLUS a bonus for aptitude ABOVE that step's threshold:
//   bonus(r) = floor( basePoints(r) × max(0, aptitude − aptThreshold(r)) / aptThreshold(r) )   (per step)
// so a high-aptitude cultivator banks far more attributes from the same realms; meeting the threshold
// exactly grants only the base, and below it there's no penalty. aptThreshold mirrors the breakthrough
// formula in systems/cultivation.js: (9+realm)/16 → big-realm boundaries 0.75 / 1.00 / 1.25 / 1.50.
// Immortal steps (realm ≥ MORTAL_PEAK) carry no aptitude bonus. Pure fn of (realm, aptitude) — aptitude is
// immutable, so this needs no stored field and applies retroactively to any save.
export const aptThreshold = (realm) => (9 + realm) / 16;
export function aptitudeStepBonus(realm, aptitude) {
  if (realm < 0 || realm >= MORTAL_PEAK) return 0;
  const base = realmPointsTotal(realm + 1) - realmPointsTotal(realm);
  const thr = aptThreshold(realm);
  return Math.floor(base * Math.max(0, (aptitude || 0) - thr) / thr);
}
export function aptitudePointBonus(realm, aptitude) {
  let bonus = 0;
  const steps = Math.min(realm | 0, MORTAL_PEAK);
  for (let r = 0; r < steps; r++) bonus += aptitudeStepBonus(r, aptitude);
  return bonus;
}

// SOUL IMPRINT (魂印): sacrificing a duplicate copy raises ch.imprint (0..10). Each level adds a flat
// +5% to every base attribute (independent linear multiplier) and +0.1 aptitude. See systems/gacha.js.
export const imprintAttrMult = (ch) => 1 + 0.05 * ((ch && ch.imprint) || 0);
export const effAptitude = (ch) => ((ch && ch.aptitude) || 0) + 0.1 * ((ch && ch.imprint) || 0);

// A character's effective attribute = (rarity floor + allocated points) × Soul-Imprint multiplier.
export const effAttr = (ch, key) => (baseAttr(ch.rarity) + ((ch.attrs && ch.attrs[key]) || 0)) * imprintAttrMult(ch);
// Effective aptitude (incl. Soul Imprint) feeds the retroactive attribute-point bonus, so imprinting
// banks the points the cultivator would have earned crossing past realms at that higher aptitude.
export const playerPool = (ch) => realmPointsTotal(ch.realm) + rarityBonus(ch.rarity) + aptitudePointBonus(ch.realm, effAptitude(ch));
export const spentPoints = (ch) => ATTR_KEYS.reduce((s, k) => s + ((ch.attrs && ch.attrs[k]) || 0), 0);
export const unspentPoints = (ch) => Math.max(0, playerPool(ch) - spentPoints(ch));
