// Gu power-budget economy — the tuned cost model from the design plan ("Gu Types & Effects").
// PURE DATA + MATH (no state, safe for headless tests). Drives data/gu.js roster generation and is the
// single tuning surface. A Gu spends a tier-scaled budget across 1..4 signed effect lines; drawbacks
// refund budget (soft-capped); affinity lines get ×1.10; essence channel cost scales with effective
// budget. Effect magnitudes are stored as FRACTIONS (0.27 = +27%), matching systems/cultivation.js.

// Total power budget per tier (tiers 1-9; mortal 1-5, immortal 6-9; no T10). 1 bp ≈ "+1% ATK".
// GU_POWER globally scales every Gu's effect MAGNITUDE (a cultivator's strength comes from their Gu — a
// Gu-less team should be unable to keep pace with Gu-wielding foes). It's budget-RELATIVE, so essence cost
// (essenceCost = GU_ESSENCE × beff/budgetOf) and recipe stone cost (bp/budgetOf ratio) are unchanged.
export const GU_POWER = 3.0;
export const B = [0, 8, 12, 16, 21, 27, 34, 43, 58, 78].map((v) => Math.round(v * GU_POWER));

// Per-kind cost weight: bp to buy +1% (or +1 unit) of that kind. Strong/conditional kinds cost more.
export const W = {
  hp: 0.9, def: 0.85, atk: 1.0, spd: 1.6, crit: 0.8, critDmg: 1.0, critRes: 0.8, statusRes: 0.8,
  evasion: 1.5, hit: 1.2, armorPen: 1.4, lifesteal: 1.3, regen: 1.4, thorns: 0.8, potency: 1.1,
  essPool: 1.3, essRcv: 1.2, lucky: 2.2,
};

// Line-count tax (convex): indexed by N positive lines. Splitting wastes budget to overhead.
export const TAU = [0, 1.0, 1.10, 1.22, 1.36];

export const RHO = 0.6;        // drawback refund rate
export const AFFINITY = 1.10;  // path-affinity line bonus (post budget-calc)

// Essence channelled per action by a Gu of `tier` (pure/no-drawback baseline), tiers 1-9.
// GU_ESSENCE_MULT globally scales every Gu's essence channel cost. It flows through ALL essence paths:
// the direct GU_ESSENCE[t] single/status lines (data/gu.js), the budget-relative essenceCost() for
// signatures, and the battle channel cost (guEssenceCost/guEssenceCostFor read the baked gu.essence).
export const GU_ESSENCE_MULT = 1.5;
export const GU_ESSENCE = [0, 6, 9, 13, 18, 24, 31, 39, 48, 58].map((v) => Math.round(v * GU_ESSENCE_MULT));

// Status-cost weights (bp). Control = chance% × Kc. DoT = chance% × 0.15 + (perTick% × 2) × Kd.
export const STATUS_KC = { stun: 0.55, frozen: 0.45, frail: 0.40, weaken: 0.35, sunder: 0.35, slow: 0.30 };
export const STATUS_KD = { burn: 0.22, poison: 0.30, bleed: 0.55 };
export const DOT_TYPES = ['burn', 'poison', 'bleed'];
export const isDot = (t) => DOT_TYPES.includes(t);

// Max POSITIVE effect lines a Gu of `tier` may carry; ≤2 drawbacks always allowed on top.
export const maxEffects = (tier) => (tier <= 2 ? 1 : tier <= 4 ? 2 : tier === 5 ? 3 : 4);
export const MAX_DRAWBACKS = 2;
export const DRAWBACK_CAP = { stat: 0.25, premium: 0.20 }; // per-drawback magnitude cap (fraction)

export const budgetOf = (tier) => B[Math.max(1, Math.min(9, tier | 0))] || 0;

// Soft cap on the drawback-augmented budget: full to 1.9×B, half-value to 2.0×B (hard stop).
export function softcap(braw, base) {
  const floor = 1.9 * base, ceil = 2.0 * base;
  if (braw <= floor) return braw;
  return Math.min(ceil, floor + (braw - floor) * 0.5);
}

// Magnitude (fraction) for a single line of `kind` given the bp allocated to it. bp/W = a percentage
// (e.g. 27/1.0 = 27 → 0.27); critDmg is the same scale (0.27 = +0.27 multiplier).
export const magFromBp = (kind, bp, isAffinity) => (bp / (W[kind] || 1)) / 100 * (isAffinity ? AFFINITY : 1);

// Convenience: a PURE single-effect line (the 17 universal lines per path), N=1, full tier budget.
export const singleLineValue = (kind, tier, isAffinity) => magFromBp(kind, budgetOf(tier), isAffinity);

// Essence cost for a Gu whose effective (drawback-augmented) budget is `beff`.
export const essenceCost = (tier, beff) => Math.round((GU_ESSENCE[tier] || 0) * (beff / (budgetOf(tier) || 1)));

// Status inflict-cost in bp (for validation / signature budgeting). chance & perTick in PERCENT.
export function statusCost(type, chancePct, perTickPct = 0) {
  if (isDot(type)) return chancePct * 0.15 + (perTickPct * 2) * (STATUS_KD[type] || 0.25);
  return chancePct * (STATUS_KC[type] || 0.4);
}

// Allocate a multi-effect signature's budget → per-kind magnitudes (fractions) + essence.
//   positives: [kind,...]  drawbacks: [{kind, mag}] (mag a positive fraction, the amount sacrificed)
// Even-split of the soft-capped budget across positives; affinity kinds get ×1.10. Returns
// { values: {kind: signedFraction...}, essence, beff }.
export function allocateMulti(positives, drawbacks, tier, affinitySet) {
  const base = budgetOf(tier);
  const refund = (drawbacks || []).reduce((s, d) => s + (W[d.kind] || 1) * (d.mag * 100) * RHO, 0);
  const beff = softcap(base + refund, base);
  const n = positives.length;
  const perLineBp = beff / (n * (TAU[n] || 1));
  const values = {};
  for (const k of positives) values[k] = magFromBp(k, perLineBp, affinitySet && affinitySet.has(k));
  for (const d of (drawbacks || [])) values[d.kind] = (values[d.kind] || 0) - d.mag; // drawbacks are negative
  return { values, essence: essenceCost(tier, beff), beff };
}

// Dev-time sanity check on a generated Gu's effect list (returns [] or a list of problems).
export function validateGu(gu) {
  const errs = [];
  const eff = gu.effects || [];
  const pos = eff.filter((e) => e.kind !== 'status' && e.value > 0);
  const neg = eff.filter((e) => e.kind !== 'status' && e.value < 0);
  if (pos.length > maxEffects(gu.tier)) errs.push(`${gu.id}: ${pos.length} positives > tier ${gu.tier} cap`);
  if (neg.length > MAX_DRAWBACKS) errs.push(`${gu.id}: ${neg.length} drawbacks > ${MAX_DRAWBACKS}`);
  return errs;
}
