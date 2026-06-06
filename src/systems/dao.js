// Dao system: per-character Dao PATH progression, in two independent per-path stats.
//   - COMPREHENSION (mortal & immortal): a 0-10 level grown by USING that path's Gu in combat,
//     hard-capped by cultivation rank. It scales each Gu by how the wielder's level compares to
//     the Gu's required level (= its tier): under = penalty, over = bonus (see comprehensionMult).
//   - DAO MARKS (immortal only): gained by passing tribulations; each 1000 marks in a path
//     amplifies that path's Gu effect by +100% (see markAmp). Capacity grows with immortal rank.
// Same-path RESONANCE is a separate set-bonus that applies to everyone. Attainment tiers are now
// just LABELS/GATES (e.g. the Venerable requirement); the combat scalar comes from markAmp.
import { S } from '../state.js';
import { isImmortalRealm, rankOf } from '../data/realms.js';
import { GU_LIB } from '../data/gu.js';
import { pathName } from '../data/daoPaths.js';

// Aperture space (max total Dao Marks) grows with immortal rank (wiki "peak" anchors). Mortals
// have none. The scale is intentionally vast — the rank-to-rank power gulf is by design.
export function apertureCap(realm) {
  if (!isImmortalRealm(realm)) return 0;
  return [9000, 33000, 340000, 1000000][rankOf(realm) - 5] || 9000; // rank 6..9
}
export const apertureUsed = (ch) => Object.values(ch.daoMarks || {}).reduce((s, n) => s + n, 0);
export const apertureFree = (ch) => Math.max(0, apertureCap(ch.realm) - apertureUsed(ch));

// Attainment ladder (per path, from marks in that path). Rescaled to the new mark economy. These
// tiers are LABELS/GATES only (Venerable needs Supreme Grandmaster); the combat multiplier is
// markAmp, not these. Reachable: Supreme Grandmaster (40k) needs rank 8's aperture.
export const ATTAINMENT = [
  { min: 0,      tier: 'Beginner' },
  { min: 500,    tier: 'Minor' },
  { min: 2500,   tier: 'Great' },
  { min: 10000,  tier: 'Grandmaster' },
  { min: 40000,  tier: 'Supreme Grandmaster' },
  { min: 150000, tier: 'Quasi-Supreme' },
];
export function attainmentOf(marks) {
  let cur = ATTAINMENT[0];
  for (const a of ATTAINMENT) if (marks >= a.min) cur = a;
  return cur; // { tier, min }
}
export const ATTAIN_RANK = { 'Beginner': 0, 'Minor': 1, 'Great': 2, 'Grandmaster': 3, 'Supreme Grandmaster': 4, 'Quasi-Supreme': 5 };

// Dao Mark amplification: every 1000 marks in a path = +100% to that path's Gu effect, linear and
// uncapped (100→×1.1, 1000→×2, 16000→×17). Applied to immortals only.
export const markAmp = (marks) => 1 + (marks || 0) / 1000;

// Same-path resonance multiplier from how many same-path Gu a character has equipped. A gentle ladder
// (max Gu slots = 7, so 6 same-path is reachable near the top); compounds with Dao Path Affinity ×1.10.
export function resonanceMult(count) {
  if (count >= 6) return 1.25;
  if (count === 5) return 1.20;
  if (count === 4) return 1.15;
  if (count === 3) return 1.10;
  if (count === 2) return 1.05;
  return 1.0;
}

// Marks a character holds in a path, and that path's attainment for them.
export const marksIn = (ch, pathId) => (ch.daoMarks && ch.daoMarks[pathId]) || 0;
export const attainmentIn = (ch, pathId) => attainmentOf(marksIn(ch, pathId));

// Add marks to a path on a character, clamped to free aperture space. Returns marks actually added.
export function addMarks(ch, pathId, amount) {
  if (!isImmortalRealm(ch.realm)) return 0;
  const room = apertureFree(ch);
  const add = Math.max(0, Math.min(amount, room));
  if (add <= 0) return 0;
  ch.daoMarks = ch.daoMarks || {};
  ch.daoMarks[pathId] = (ch.daoMarks[pathId] || 0) + add;
  return add;
}

// ---- Comprehension (use-driven path mastery, levels 0-10, hard-capped by cultivation rank) ----
// Cap by rank (rankOf 0..8 = ranks 1..9). The +2 jump at rank 5->6 is the leap on becoming a Gu
// Immortal; level 10 (reachable at rank 8) is one of the Venerable prerequisites.
const COMP_CAP_BY_RANK = [2, 3, 4, 5, 6, 8, 9, 10, 10];
export const comprehensionCap = (realm) => COMP_CAP_BY_RANK[rankOf(realm)] ?? 2;

// Points to advance from level L to L+1 (index = current level). Comprehension is earned +1 per
// combat action per equipped Gu of the path, and idle farming racks up actions fast — so costs are
// LARGE to keep path mastery a long-haul investment (a mortal masters a path over hundreds of
// fights, not a handful of floors). Cumulative to reach each level:
//   L1 250 · L2 850 · L3 2.25k · L4 5.45k · L5 12.45k · L6 27.45k · L7 87.45k · L8 267k · L9 767k · L10 2.27M
// Gentle-ish through the mortal ceiling (L6), then a hard wall from 6->7 onward — the immortal grind.
const COMP_INCR = [250, 600, 1400, 3200, 7000, 15000, 60000, 180000, 500000, 1500000];
function rawComprehensionLevel(points) {
  let lvl = 0, acc = 0;
  for (let i = 0; i < COMP_INCR.length; i++) { acc += COMP_INCR[i]; if (points >= acc) lvl = i + 1; else break; }
  return lvl;
}
export const compPointsIn = (ch, pathId) => (ch.comprehension && ch.comprehension[pathId]) || 0;
// Effective level: raw level from banked points, clamped to the cultivator's rank cap. Points
// earned past the cap are banked and unlock automatically on the next breakthrough.
export const comprehensionLevelIn = (ch, pathId) =>
  Math.min(rawComprehensionLevel(compPointsIn(ch, pathId)), comprehensionCap(ch.realm));
export function addComprehension(ch, pathId, points) {
  if (!(points > 0)) return;
  ch.comprehension = ch.comprehension || {};
  ch.comprehension[pathId] = (ch.comprehension[pathId] || 0) + points;
}
// Gu effectiveness from comprehension vs the Gu's required level (= its tier, or gu.compReq):
// under-comprehension is penalised harder (0.25/level, floored at 10%) than over-comprehension
// rewards (0.15/level, uncapped).
export function comprehensionMult(comp, required) {
  const d = comp - required;
  return d < 0 ? Math.max(0.10, 1 + 0.25 * d) : 1 + 0.15 * d;
}

// Scatter (lose) a fraction of a character's marks — used on tribulation death.
export function scatterMarks(ch, frac = 1) {
  for (const p in (ch.daoMarks || {})) ch.daoMarks[p] = Math.floor(ch.daoMarks[p] * (1 - frac));
}

// The path a character is most invested in (most equipped Gu of that path), for auto-deposits.
export function dominantPath(ch) {
  const counts = {};
  for (const uid of ch.gu || []) {
    const owned = S().guInv.find((g) => g.uid === uid);
    const gu = owned && GU_LIB[owned.guId];
    if (gu) counts[gu.daoPath] = (counts[gu.daoPath] || 0) + 1;
  }
  let best = null, n = 0;
  for (const p in counts) if (counts[p] > n) { n = counts[p]; best = p; }
  return best;
}

// Combined Dao Wound penalty multiplier (permanent). Each wound is a severity in [0,1).
export const woundMult = (ch) => (ch.wounds || []).reduce((m, sev) => m * (1 - sev), 1);

// Temporary breakthrough INJURY (mortal-tier) — a NEW, lightweight debuff, SEPARATE from the permanent
// Dao Wounds above. A failed breakthrough sets `injuryUntil` (timestamp) + `injurySeverity`; the
// penalty multiplies combat stats while it lasts and auto-expires (a past timestamp reads as healed).
// Never touches `ch.wounds` / the lethal WOUND_CAP, so a mortal can't die from breakthrough RNG.
export const injuryRemainingMs = (ch) => Math.max(0, (ch.injuryUntil || 0) - Date.now());
export const injuryMult = (ch) => (injuryRemainingMs(ch) > 0 ? 1 - (ch.injurySeverity || 0) : 1);
