// Server-side validation for a player-forged MYRIAD Gu def (data/myriad.js) submitted in an ARENA team.
// PURE DATA + MATH (no state/DOM) — safe for headless tests AND the Supabase Edge Functions (imported by
// _shared/team.ts). The whole point: a myriad Gu's definition lives INLINE on the inventory item (no GU_LIB
// entry), so unlike a regular Gu — whose effects the server reads authoritatively from GU_LIB by guId — the
// CLIENT supplies the effect magnitudes. A modified client could inflate them, so we bound the def against
// the maximum a legitimate fusion/rank-up could roll for that (tier, daoPath):
//   • per-effect SINGLE-LINE ceiling — no one effect bigger than a whole-budget line could be, and
//   • TOTAL BUDGET ceiling — the implied effective budget can't exceed a max roll (+ rank-up never-worse
//     headroom), recomputed exactly the way data/myriad.js allocateMyriad spends it.
// On success returns a CLEANED def (validated effects kept; name/cjk/coef clamped; essence + bp RECOMPUTED
// server-side so a client can't cheat the essence channel cost either). Mirrors data/myriad.js + guBudget.js.
import { isPathLocked, commOf, PATH, PATH_AFFINITY } from './daoPaths.js';
import { budgetOf, W, TAU, maxEffects, statusCost, magFromBp, essenceCost, STATUS_KC, STATUS_KD } from './guBudget.js';
import { MYRIAD_BUDGET_HI, COMMONALITY_BUDGET_MULT, COMMONALITY_AFFINITY, MYRIAD_TIER_CAP } from './myriad.js';

const STAT_KINDS = new Set(Object.keys(W));                                   // the budgetable stat kinds
const STATUS_IDS = new Set([...Object.keys(STATUS_KC), ...Object.keys(STATUS_KD)]); // the 9 battle statuses
const SINGLE_SLACK = 1.10; // per-effect single-line ceiling slack (rounding + affinity edge cases)
const ROUND_SLACK  = 1.05; // total-budget rounding slack on top of the max-roll + rank-up headroom

// Validate a myriad def. Returns { def } (cleaned, safe to equip server-side) or { error } (string).
export function validateMyriad(def) {
  if (!def || typeof def !== 'object') return { error: 'myriad: missing def' };
  const path = def.daoPath;
  if (typeof path !== 'string' || !PATH(path) || isPathLocked(path)) return { error: `myriad: bad daoPath ${path}` };
  const tier = def.tier | 0;
  if (tier < 1 || tier > MYRIAD_TIER_CAP) return { error: `myriad: tier ${tier} out of range (1..${MYRIAD_TIER_CAP})` };
  const effects = Array.isArray(def.effects) ? def.effects : null;
  if (!effects || !effects.length) return { error: 'myriad: no effects' };
  if (effects.length > maxEffects(tier)) return { error: `myriad: ${effects.length} effects > tier ${tier} cap ${maxEffects(tier)}` };

  const comm = (commOf(path) && commOf(path).key) || 'common';
  const affMult = COMMONALITY_AFFINITY[comm] || 1.10;
  const affSet = new Set(PATH_AFFINITY[path] || []);
  const commMult = COMMONALITY_BUDGET_MULT[comm] || 1;
  const maxBeff = budgetOf(tier) * MYRIAD_BUDGET_HI * commMult; // a max-roll fusion's effective budget
  // rank-up (rerollDef) keeps a never-worse floor vs the PREVIOUS tier's magnitudes, which can push the
  // implied budget slightly past this tier's max-roll. Allow one prev-tier max-roll of headroom for that.
  const prevAllow = tier > 1 ? budgetOf(tier - 1) * MYRIAD_BUDGET_HI * commMult : 0;
  const budgetCeil = (maxBeff + prevAllow) * ROUND_SLACK;

  let statBp = 0, statusBp = 0;
  const clean = [];
  for (const e of effects) {
    if (!e || typeof e !== 'object') return { error: 'myriad: bad effect' };
    if (e.kind === 'status') {
      if (!STATUS_IDS.has(e.status)) return { error: `myriad: bad status ${e.status}` };
      const chance = Math.max(0, Math.min(1, Number(e.chance) || 0));
      const dot = Math.max(0, Math.min(5, Number(e.dot) || 0));
      statusBp += statusCost(e.status, Math.round(chance * 100), Math.round(dot * 100));
      clean.push({ kind: 'status', status: e.status, chance, dot });
    } else {
      if (!STAT_KINDS.has(e.kind)) return { error: `myriad: bad effect kind ${e.kind}` };
      const value = Number(e.value);
      if (!isFinite(value)) return { error: `myriad: bad value for ${e.kind}` };
      const isAff = affSet.has(e.kind);
      // a single line taking the WHOLE budget (n=1, TAU=1), with this path's affinity bonus if applicable
      const maxSingle = magFromBp(e.kind, maxBeff, false) * (isAff ? affMult : 1);
      if (Math.abs(value) > maxSingle * SINGLE_SLACK)
        return { error: `myriad: ${e.kind} ${value.toFixed(3)} exceeds single-line cap ${maxSingle.toFixed(3)}` };
      // invert allocateMyriad's magOf: value = (bp/W/100) × (affinity ? affMult : 1)  ⇒  bp = |value|·100·W / affMult
      if (value > 0) statBp += value * 100 * (W[e.kind] || 1) / (isAff ? affMult : 1);
      clean.push({ kind: e.kind, value });
    }
  }

  // allocateMyriad: usable = beff / TAU[n]; usable = Σ(stat bp) + Σ(status bp)  ⇒  impliedBeff = usable · TAU[n]
  const n = clean.length;
  const tau = TAU[Math.min(n, TAU.length - 1)] || 1;
  const impliedBeff = (statBp + statusBp) * tau;
  if (impliedBeff > budgetCeil)
    return { error: `myriad: budget ${impliedBeff.toFixed(1)} exceeds tier ${tier} max ${budgetCeil.toFixed(1)}` };

  // Cleaned, sanitized def: keep the validated effects; clamp metadata; RECOMPUTE essence + bp so the
  // client can't understate the channel cost. (No `myriad` flag here — resolveOwned adds it.)
  const beff = Math.max(budgetOf(tier), impliedBeff);
  return {
    def: {
      name: String(def.name || 'Myriad Gu').slice(0, 60),
      cjk: String(def.cjk || '').slice(0, 4),
      daoPath: path,
      tier,
      coef: Math.max(0, Math.min(50, def.coef | 0)),
      effects: clean,
      essence: essenceCost(tier, beff),
      bp: Math.round(beff),
    },
  };
}
