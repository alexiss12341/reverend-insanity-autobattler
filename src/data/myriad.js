// Myriad Gu Refining — PURE DATA + MATH (no state, no DOM; safe for headless tests). Drives the
// fuse/rank-up of two Gu into a custom multi-effect "[myriad]"-tagged Gu, surfaced via state inventory
// items shaped { uid, myriad:{ name, daoPath, tier, coef, effects, essence, bp, cjk } } and resolved by
// data/gu.js resolveOwned. The state-mutating ops (canFuse/fuse/canRankUp/rankUp/salvage) live in
// systems/myriad.js; this file only computes chances, costs, and the rolled effect allocation.
import { pathList, isPathLocked, pathName, pathCjk, commOf, PATH_AFFINITY } from './daoPaths.js';
import { budgetOf, TAU, W, magFromBp, essenceCost, maxEffects, statusCost, isDot } from './guBudget.js';
import { TIER_STONES } from './gu.js';

// ---- tunable constants ---------------------------------------------------------------------------
export const MYRIAD_BUDGET_LO = 0.9, MYRIAD_BUDGET_HI = 1.15; // per-fusion budget roll (mean ≈ 1.02)
export const DOM_SHARE = 0.65;        // dominant Gu's slice of the stat budget
export const CROSS_PATH_MULT = 0.7;   // multiplicative success factor when the two inputs differ in path
export const HARMONIZE_FACTOR = 0.5;  // same-path: halve the coefficient penalty
export const LINE_JITTER = 0;         // optional extra per-line magnitude variance (off by default)
export const FAIL_LOSS_DOM = 0.25, FAIL_LOSS_SUP = 0.50; // per-input destruction % on a failed fuse
export const SALVAGE_RATE = 0.30;     // fragment refund fraction when dismantling
export const CATALYST_STEP = 0.10, CATALYST_MAX_STEPS = 3; // Derivation Catalyst: per-step fusion success boost
export const WARD_STEP = 0.10, WARD_MAX = 3;               // Refinement Catalyst: per-step shatter-on-fail reduction
// rarer DOMINANT path → higher effect budget + stronger affinity (the power upside for its cost premium)
export const COMMONALITY_BUDGET_MULT = { common: 1.0, uncommon: 1.05, rare: 1.12, esoteric: 1.22, supreme: 1.22 };
export const COMMONALITY_AFFINITY   = { common: 1.10, uncommon: 1.13, rare: 1.18, esoteric: 1.25, supreme: 1.25 };

// success-chance knobs
export const SC_MIN = 0.05, SC_MAX = 0.95, SC_COEF = 0.04, COMP_BONUS = 0.02, SIM_SPAN = 0.20;
export const MASTERY_CAP = 0.20, MARK_DIV = 2000;        // immortal-only mastery term
// Refining proficiency is LEVEL-based (like dao COMPREHENSION): myriadProficiency accumulates POINTS
// (+tier per successful refine) which convert to discrete LEVELS via PROF_INCR. Both the tier-gate
// (PROF_REQ) and the chance bonus below read the LEVEL, never the raw points.
export const PROF_INCR = [5, 10, 15, 20, 30, 40, 55, 75, 100, 130, 140]; // points to advance from level L → L+1
export const PROF_BONUS_PER_LEVEL = 0.015, PROF_CAP = 0.15;             // success bonus = min(PROF_CAP, per-level × level); cap at Lv.10
export const PROF_MAX_LEVEL = PROF_INCR.length;                          // levels derivable from the curve
// Banked points → proficiency level (cumulative thresholds; naturally caps at PROF_MAX_LEVEL).
export function myriadProfLevel(points) {
  let lvl = 0, acc = 0;
  for (let i = 0; i < PROF_INCR.length; i++) { acc += PROF_INCR[i]; if ((points || 0) >= acc) lvl = i + 1; else break; }
  return lvl;
}
// Cumulative points required to REACH a given level (for UI progress bars; clamps to the curve).
export function profPointsForLevel(level) {
  let acc = 0; for (let i = 0; i < Math.min(Math.max(0, level), PROF_INCR.length); i++) acc += PROF_INCR[i];
  return acc;
}
// Base success keyed by the tier you're advancing INTO. Fusion uses MYRIAD_BASE_CHANCE; RANK-UP uses its
// OWN, markedly LOWER curve (keyed by target tier) — pushing an existing artifact higher is riskier than
// forging a fresh one, and it drops harder per tier.
export const MYRIAD_BASE_CHANCE = { 1: 0.90, 2: 0.80, 3: 0.70, 4: 0.58, 5: 0.46, 6: 0.25, 7: 0.18, 8: 0.10, 9: 0.05 };
export const RANKUP_BASE_CHANCE = { 2: 0.55, 3: 0.42, 4: 0.30, 5: 0.20, 6: 0.13, 7: 0.08, 8: 0.05, 9: 0.03 };
// On a FAILED rank-up, the myriad Gu being upgraded has this chance to be DESTROYED — a curve that rises
// with the Gu's CURRENT tier (the higher it climbs, the more it risks shattering). Tunable.
export const DESTROY_BASE = 0.06, DESTROY_PER = 0.10, DESTROY_CAP = 0.65;
export const myriadDestroyChance = (tier) => Math.max(0, Math.min(DESTROY_CAP, DESTROY_BASE + DESTROY_PER * (Math.max(1, tier) - 1)));

// cost knobs
export const FRAG_COST = { 1: 10, 2: 25, 3: 45, 4: 75, 5: 125, 6: 210, 7: 360, 8: 600, 9: 1000 };
export const ESS_BASE = 15, ESS_GROW = 1.7;
export const matQty = (tier) => 1 + Math.floor((Math.max(1, tier) - 1) / 2); // 1/1/2/2/3/3/4/4/5

// proficiency tier-gate (gates CRAFTING): a fuse/rank-up producing tier T needs proficiency LEVEL ≥ PROF_REQ[T]
// (compare myriadProfLevel(points), NOT the raw points). Roughly tracks the old point thresholds at the
// new curve's cumulative breakpoints: T3≈Lv2(25) · T4≈Lv4(70) · T5≈Lv5(100) · … · T9≈Lv11(620).
export const PROF_REQ = { 1: 0, 2: 0, 3: 2, 4: 4, 5: 5, 6: 6, 7: 8, 8: 10, 9: 11 };
// Tier cap while ascension is UI-locked (no roster reaches Rank 6 → immortalStones stay 0 → T6+ inert).
// Mirrors ui.js ASCENSION_LOCKED — bump to 9 when ascension is re-enabled.
export const MYRIAD_TIER_CAP = 5;

// ---- new resources -------------------------------------------------------------------------------
// Two parallel per-path "Core" material families + two global "Catalyst" consumables:
//   DERIVATION (fusion):  Derivation Core (material)  + Derivation Catalyst  (boosts SUCCESS)
//   REFINEMENT (rank-up): Refinement Core (material)  + Refinement Catalyst  (REDUCES shatter-on-fail)
// Cores are per-path (consumed for the DOMINANT/own path); priced identically in the Arena Shop.

// Derivation Cores — fusion material (state.myriadMats[path]).
export const MYRIAD_MATS = {};
for (const p of pathList()) if (!isPathLocked(p.id)) MYRIAD_MATS[p.id] = { id: `mat_myriad_${p.id}`, name: `${pathName(p.id)} Derivation Core`, daoPath: p.id };
export const myriadMatId = (path) => `mat_myriad_${path}`;
export const myriadMatName = (path) => (MYRIAD_MATS[path] && MYRIAD_MATS[path].name) || `${pathName(path)} Derivation Core`;

// Refinement Cores — rank-up material, REQUIRED to attempt a rank-up (state.refineMats[path]).
export const REFINE_MATS = {};
for (const p of pathList()) if (!isPathLocked(p.id)) REFINE_MATS[p.id] = { id: `mat_refine_${p.id}`, name: `${pathName(p.id)} Refinement Core`, daoPath: p.id };
export const refineMatId = (path) => `mat_refine_${path}`;
export const refineMatName = (path) => (REFINE_MATS[path] && REFINE_MATS[path].name) || `${pathName(path)} Refinement Core`;

// Global catalysts. Derivation = fusion success boost (state.derivationCatalysts). Refinement = rank-up
// shatter-on-fail reducer (state.refinementCatalysts — the old "Stabilizing Catalyst" field, repurposed;
// its prior value migrates to derivationCatalysts, see state.js migrateSave).
export const DERIVATION_CATALYST = { id: 'mat_derivation_catalyst', name: 'Derivation Catalyst' };
export const REFINEMENT_CATALYST = { id: 'mat_refinement_catalyst', name: 'Refinement Catalyst' };

// Effective shatter chance on a failed rank-up after burning `wards` Refinement Catalysts (−WARD_STEP each).
export const effectiveShatterChance = (tier, wards = 0) => Math.max(0, myriadDestroyChance(tier) - WARD_STEP * Math.min(wards || 0, WARD_MAX));

// ---- effect helpers ------------------------------------------------------------------------------
const effs = (def) => (def && def.effects) || [];
const posKinds = (def) => effs(def).filter((e) => e.kind !== 'status' && e.value > 0).map((e) => e.kind);
const statusEffs = (def) => effs(def).filter((e) => e.kind === 'status');
export const positiveKinds = posKinds; // a def's positive stat kinds
// A def contributes something usable to a fusion if it has ≥1 positive stat OR ≥1 status rider (so a
// status-only Gu is a valid input; only a pure-drawback / effect-less Gu is rejected as degenerate).
export const hasUsableEffect = (def) => posKinds(def).length > 0 || statusEffs(def).length > 0;
// similarity kind-set: positive stat kinds PLUS concrete status ids (so Burn ≠ Poison).
export const simKinds = (def) => [...new Set([...posKinds(def), ...statusEffs(def).map((e) => `st:${e.status}`)])];
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  if (!A.size && !B.size) return 1;
  let inter = 0; for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter || 1);
}

// ---- success chance ------------------------------------------------------------------------------
// ctx (built by systems/myriad.js so this stays state-free): { domDef, supDef, domPath, supPath, comp,
//   marks, insight, profLevel, catalysts, isRankUp }. comp/marks are the MAIN character's levels; insight
//   is the prestige Insight chance bonus; profLevel = myriadProfLevel(state.myriadProficiency).
export function myriadRefineChance(tier, X = 0, ctx = {}) {
  const samePath = !!ctx.domPath && ctx.domPath === ctx.supPath;
  const table = ctx.isRankUp ? RANKUP_BASE_CHANCE : MYRIAD_BASE_CHANCE; // rank-up is harder than a fresh fuse
  // Lineage harmonization (halved coef penalty) is a SAME-PATH FUSION bonus only — a rank-up uses a single
  // Gu (no second path to harmonize with), so it pays the FULL coefficient penalty.
  const harmonized = samePath && !ctx.isRankUp;
  const base = (table[tier] != null ? table[tier] : 0.05)
    - SC_COEF * (X || 0) * (harmonized ? HARMONIZE_FACTOR : 1);
  const comp = COMP_BONUS * (ctx.comp || 0);
  const sim = ctx.isRankUp ? 0 : SIM_SPAN * (jaccard(simKinds(ctx.domDef), simKinds(ctx.supDef)) - 0.5);
  const mastery = tier >= 6 ? Math.min(MASTERY_CAP, (ctx.marks || 0) / MARK_DIV + (ctx.insight || 0)) : 0;
  const prof = Math.min(PROF_CAP, PROF_BONUS_PER_LEVEL * (ctx.profLevel || 0));
  const crossMult = samePath ? 1 : CROSS_PATH_MULT;
  const catalystBonus = CATALYST_STEP * Math.min(ctx.catalysts || 0, CATALYST_MAX_STEPS);
  const raw = (base + comp + sim + mastery + prof) * crossMult + catalystBonus;
  return Math.max(SC_MIN, Math.min(SC_MAX, raw));
}

// ---- costs ---------------------------------------------------------------------------------------
// Stones carry the coefficient escalation; fragments/material/essence are tier-based. For a fuse pass
// coefA/coefB; for a rank-up pass (coef, 0).
export function myriadCosts(tier, coefA = 0, coefB = 0, path = 'metal') {
  const X = (coefA || 0) + (coefB || 0);
  return {
    fragments: FRAG_COST[tier] || FRAG_COST[9],
    material: { path, qty: matQty(tier) },
    essence: Math.round(ESS_BASE * Math.pow(ESS_GROW, Math.max(0, tier - 1))),
    stones: Math.round((TIER_STONES[tier] || TIER_STONES[9]) * (commOf(path).costMult || 1) * X),
  };
}

// ---- dominant-weighted BP allocation -------------------------------------------------------------
// Build the result's effect list (stat lines + status riders), essence, and beff from two parent defs.
// `m` is the rolled budget multiplier; `commKey` the dominant path's commonality; `affSet` its affinity kinds.
// Reuses guBudget primitives but with a DOMINANT-weighted split + a dominant-leads rebalance.
export function allocateMyriad(domDef, supDef, tier, m, commKey = 'common', affSet = new Set()) {
  const affMult = COMMONALITY_AFFINITY[commKey] || 1.10;
  const beff = budgetOf(tier) * m * (COMMONALITY_BUDGET_MULT[commKey] || 1);

  // Ordered, de-duplicated effect slots: dominant's first (origin 'dom'), then support-only (origin 'sup').
  const domStats = posKinds(domDef), supStats = posKinds(supDef);
  const slots = [];
  const seen = new Set();
  const addStat = (kind, origin) => { if (!seen.has(kind)) { seen.add(kind); slots.push({ type: 'stat', kind, origin }); } };
  const addStatus = (e, origin) => { const k = `st:${e.status}`; if (!seen.has(k)) { seen.add(k); slots.push({ type: 'status', e: { ...e }, origin }); } };
  for (const k of domStats) addStat(k, 'dom');
  for (const e of statusEffs(domDef)) addStatus(e, 'dom');
  for (const k of supStats) addStat(k, 'sup');
  for (const e of statusEffs(supDef)) addStatus(e, 'sup');
  // cap to maxEffects(tier) — keeps dominant's slots (they're first), trims trailing support, then dominant.
  const cap = maxEffects(tier);
  const kept = slots.slice(0, cap);

  const n = kept.length || 1;
  const usable = beff / (TAU[Math.min(n, TAU.length - 1)] || 1);

  // status riders consume their statusCost from the usable budget BEFORE the stat split
  let statusBp = 0;
  for (const s of kept) if (s.type === 'status') statusBp += statusCost(s.e.status, Math.round((s.e.chance || 0) * 100), Math.round((s.e.dot || 0) * 100));
  const statBudget = Math.max(0, usable - statusBp);

  const domStatKinds = kept.filter((s) => s.type === 'stat' && s.origin === 'dom').map((s) => s.kind);
  const supStatKinds = kept.filter((s) => s.type === 'stat' && s.origin === 'sup').map((s) => s.kind);
  // bp per kind: dominant pool DOM_SHARE, support pool the rest; whole budget to whichever group is non-empty alone.
  const bp = {};
  const split = (kinds, pool) => { const per = kinds.length ? pool / kinds.length : 0; for (const k of kinds) bp[k] = (bp[k] || 0) + per; };
  if (domStatKinds.length && supStatKinds.length) { split(domStatKinds, statBudget * DOM_SHARE); split(supStatKinds, statBudget * (1 - DOM_SHARE)); }
  else { split(domStatKinds, domStatKinds.length ? statBudget : 0); split(supStatKinds, domStatKinds.length ? 0 : statBudget); }

  const magOf = (k) => magFromBp(k, bp[k] || 0, false) * (affSet.has(k) ? affMult : 1);
  // dominant-leads rebalance: cap each support stat at the weakest dominant stat, return freed bp to dominant.
  if (domStatKinds.length && supStatKinds.length) {
    const floor = Math.min(...domStatKinds.map(magOf));
    let freed = 0;
    for (const k of supStatKinds) {
      if (magOf(k) > floor) {
        const needBp = floor / ((affSet.has(k) ? affMult : 1) / (W[k] || 1)) * 100; // invert magFromBp
        freed += (bp[k] - needBp);
        bp[k] = needBp;
      }
    }
    if (freed > 0) for (const k of domStatKinds) bp[k] += freed / domStatKinds.length;
  }

  // assemble effects in the kept order
  const effects = [];
  for (const s of kept) {
    if (s.type === 'stat') effects.push({ kind: s.kind, value: magOf(s.kind) });
    else effects.push({ ...s.e });
  }
  return { effects, essence: essenceCost(tier, beff), beff };
}

// ---- name blending -------------------------------------------------------------------------------
const ROMAN_RE = /\s+(?:[IVX]+|\d+)$/i;
function leadWord(name) {
  let n = String(name || '').replace(/\s+Immortal Gu$/i, '').replace(/\s+Gu$/i, '').replace(ROMAN_RE, '').trim();
  const w = n.split(/[\s-]+/).filter(Boolean);
  return w[0] || '';
}
export function blendName(domName, supName, path) {
  const a = leadWord(domName), b = leadWord(supName);
  if (a && b && a.toLowerCase() !== b.toLowerCase()) return `${a}-${b} Myriad Gu`;
  if (a) return `${a} Myriad Gu`;
  return `Myriad ${pathName(path)} Gu`;
}

// ---- build a fused myriad def --------------------------------------------------------------------
// ctx: { rng, domCoef, supCoef, commKey, affSet, name(optional, for rank-up keep-name), prevEffects(optional,
//        never-worse floor for rank-up) }.
export function rollFusedDef(domDef, supDef, tier, ctx = {}) {
  const rng = ctx.rng || Math.random;
  const path = domDef.daoPath;
  const m = MYRIAD_BUDGET_LO + rng() * (MYRIAD_BUDGET_HI - MYRIAD_BUDGET_LO);
  const commKey = ctx.commKey || commOf(path).key || 'common';
  const affSet = ctx.affSet || new Set(PATH_AFFINITY[path] || []);
  const { effects, essence, beff } = allocateMyriad(domDef, supDef, tier, m, commKey, affSet);
  // never-worse floor (rank-up): each stat effect ≥ its raw previous magnitude for the same kind.
  if (ctx.prevEffects) {
    const prev = {}; for (const e of ctx.prevEffects) if (e.kind !== 'status') prev[e.kind] = e.value;
    for (const e of effects) if (e.kind !== 'status' && prev[e.kind] != null) e.value = Math.max(e.value, prev[e.kind]);
  }
  return {
    name: ctx.name || blendName(domDef.name, supDef.name, path),
    daoPath: path, tier,
    coef: (ctx.domCoef || 0) + (ctx.supCoef || 0) + 1,
    effects, essence, bp: beff,
    cjk: pathCjk(path),
  };
}

// Rank-up re-roll: re-allocate a myriad def's OWN kinds at `newTier` (all dominant, no support), keeping its
// name + coef, with the never-worse floor vs the previous magnitudes. `def` is the resolved myriad def.
export function rerollDef(def, newTier, ctx = {}) {
  const path = def.daoPath;
  const rng = ctx.rng || Math.random;
  const m = MYRIAD_BUDGET_LO + rng() * (MYRIAD_BUDGET_HI - MYRIAD_BUDGET_LO);
  const commKey = ctx.commKey || commOf(path).key || 'common';
  const affSet = ctx.affSet || new Set(PATH_AFFINITY[path] || []);
  const { effects, essence, beff } = allocateMyriad(def, def, newTier, m, commKey, affSet);
  const prev = {}; for (const e of (def.effects || [])) if (e.kind !== 'status') prev[e.kind] = e.value;
  for (const e of effects) if (e.kind !== 'status' && prev[e.kind] != null) e.value = Math.max(e.value, prev[e.kind]);
  return { name: def.name, daoPath: path, tier: newTier, coef: def.coef || 0, effects, essence, bp: beff, cjk: def.cjk || pathCjk(path) };
}
