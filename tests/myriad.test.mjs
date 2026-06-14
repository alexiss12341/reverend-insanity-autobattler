// Myriad Gu Refining — headless suite. Covers data/myriad math + systems/myriad ops + the Arena economy
// (shop + ranking payout) added to systems/economy.js.
import { ok, section } from './assert.mjs';
import { state, newGame, uid } from '../src/state.js';
import { GU_LIB, resolveOwned, guTags } from '../src/data/gu.js';
import { TIER_STONES } from '../src/data/gu.js';
import { commOf, PATH_AFFINITY } from '../src/data/daoPaths.js';
import {
  myriadRefineChance, myriadCosts, rollFusedDef, rerollDef, blendName, myriadMatId, MYRIAD_MATS,
  REFINEMENT_CATALYST, MYRIAD_TIER_CAP, PROF_REQ, FRAG_COST, CROSS_PATH_MULT, COMMONALITY_BUDGET_MULT,
  MYRIAD_BASE_CHANCE, RANKUP_BASE_CHANCE, myriadDestroyChance,
  effectiveShatterChance, refineMatId, REFINE_MATS, DERIVATION_CATALYST, WARD_STEP,
  myriadProfLevel, profPointsForLevel, PROF_INCR, PROF_MAX_LEVEL, PROF_BONUS_PER_LEVEL, PROF_CAP,
} from '../src/data/myriad.js';
import { canFuse, fuse, canRankUp, rankUp, autoRankUp, planAutoRankUp, salvageMyriad } from '../src/systems/myriad.js';
import { arenaRankBracket, arenaRankReward, arenaShopStock, arenaShopBuy, buyCatalyst, CATALYST_MARKET_PRICE } from '../src/systems/economy.js';

const S = () => state.current;
const grant = (guId) => { const u = uid('g'); S().guInv.push({ uid: u, guId }); return u; };
function fresh() {
  state.current = newGame('t_myriad', 'Tester');
  const s = S();
  s.stones = 1e12; s.essence = 1e6; s.derivationFragments = 1e6;
  s.derivationCatalysts = 50; s.refinementCatalysts = 50;  // fusion success + rank-up shatter wards
  s.myriadProficiency = 1000; s.frontier = 300; // unlock all path shops; clear the proficiency gate
  for (const p of ['fire', 'water', 'metal', 'wind']) { s.myriadMats[p] = 100; s.refineMats[p] = 100; } // Derivation + Refinement Cores
  return s;
}
// run fn with Math.random pinned to `v`
function withRandom(v, fn) { const r = Math.random; Math.random = () => v; try { return fn(); } finally { Math.random = r; } }
const effVal = (def, kind) => { const e = (def.effects || []).find((x) => x.kind === kind); return e ? e.value : null; };

section('myriad: data — chance, costs, names');
// Isolate the FUSION base curve: overlapping kinds {atk} vs {atk,spd} → jaccard 0.5 → similarity term 0
// (no comp/prof/mastery in ctx → those are 0 too), so the result equals base × crossMult.
const mkdef = (kinds) => ({ daoPath: 'fire', effects: kinds.map((k) => ({ kind: k, value: 0.2 })) });
const baseCtx = (dom, sup) => ({ domDef: mkdef(['atk']), supDef: mkdef(['atk', 'spd']), domPath: dom, supPath: sup });
ok(myriadRefineChance(3, 0, baseCtx('fire', 'fire')) === 0.70, 'T3 same-path base chance = 0.70 (no bonuses)');
ok(Math.abs(myriadRefineChance(3, 0, baseCtx('fire', 'water')) - 0.70 * CROSS_PATH_MULT) < 1e-9, 'cross-path multiplies chance by 0.7');
ok(myriadRefineChance(5, 0, baseCtx('fire', 'fire')) === 0.46, 'T5 same-path base = 0.46');
ok(myriadRefineChance(6, 0, baseCtx('fire', 'fire')) === 0.25, 'T6 base = 0.25 (immortal cliff)');
ok(myriadRefineChance(9, 99, baseCtx('fire', 'fire')) === 0.05, 'deep/high-tier clamps to the 0.05 floor');
// harmonization: same-path halves the coef penalty
ok(myriadRefineChance(5, 4, baseCtx('fire', 'fire')) === 0.46 - 0.04 * 4 * 0.5, 'same-path halves the coefficient penalty (lineage harmonization)');
ok(myriadCosts(3, 0, 0, 'fire').stones === 0, 'first fuse (X=0) costs no stones');
ok(myriadCosts(3, 1, 1, 'fire').stones === Math.round(TIER_STONES[3] * commOf('fire').costMult * 2), 'stones = TIER_STONES × commonality × (coefA+coefB)');
ok(myriadCosts(5, 0, 0, 'fire').fragments === FRAG_COST[5], 'fragment cost reads the FRAG_COST table');
ok(myriadCosts(5, 0, 0, 'fire').material.qty === 3, 'T5 needs 3 path materials');
ok(blendName('Blazing Ember Gu', 'Frost Lance Gu', 'fire') === 'Blazing-Frost Myriad Gu', 'blendName leads with the dominant word');
ok(!!MYRIAD_MATS.fire && MYRIAD_MATS.fire.id === myriadMatId('fire'), 'a path has a generated myriad material');
ok(!MYRIAD_MATS.heaven, 'locked (Supreme) paths get no myriad material');

section('myriad: data — refining proficiency is LEVEL-based (like comprehension)');
ok(myriadProfLevel(0) === 0, '0 points = proficiency Lv.0');
ok(myriadProfLevel(PROF_INCR[0] - 1) === 0, 'just below the first threshold is still Lv.0');
ok(myriadProfLevel(PROF_INCR[0]) === 1, 'reaching the first increment = Lv.1');
ok(myriadProfLevel(PROF_INCR[0] + PROF_INCR[1]) === 2, 'cumulative second increment = Lv.2');
ok(myriadProfLevel(1e9) === PROF_MAX_LEVEL, 'level saturates at PROF_MAX_LEVEL');
ok(profPointsForLevel(1) === PROF_INCR[0] && profPointsForLevel(0) === 0, 'profPointsForLevel returns the cumulative threshold');
// gates are now LEVELS, not raw points: tier T needs myriadProfLevel(points) ≥ PROF_REQ[T]
ok(myriadProfLevel(profPointsForLevel(PROF_REQ[3])) >= PROF_REQ[3], 'T3 gate clears exactly at its level threshold');
ok(myriadProfLevel(profPointsForLevel(PROF_REQ[5]) - 1) < PROF_REQ[5], 'one point shy of the T5 level still fails its gate');
// chance bonus scales with LEVEL and caps at PROF_CAP. Inputs {atk} vs {atk,spd} → jaccard 0.5 → sim term 0,
// so chance = base(0.70) + proficiency bonus only.
const ctxAt = (pts) => ({ domDef: mkdef(['atk']), supDef: mkdef(['atk', 'spd']), domPath: 'fire', supPath: 'fire', profLevel: myriadProfLevel(pts) });
ok(Math.abs(myriadRefineChance(3, 0, ctxAt(profPointsForLevel(3))) - (0.70 + PROF_BONUS_PER_LEVEL * 3)) < 1e-9, 'proficiency level adds its per-level success bonus');
ok(myriadRefineChance(3, 0, ctxAt(1e9)) <= 0.70 + PROF_CAP + 1e-9, 'the proficiency bonus is capped at PROF_CAP');

section('myriad: data — dominant-weighted BP + cap');
const dwd = rollFusedDef(GU_LIB['gu_fire_atk_t3'], GU_LIB['gu_water_def_t3'], 3, { rng: () => 0.5 });
ok(dwd.daoPath === 'fire', 'dominant sets the result daoPath');
ok(effVal(dwd, 'atk') != null && effVal(dwd, 'def') != null, 'union carries both inputs’ effects');
ok(effVal(dwd, 'atk') >= effVal(dwd, 'def'), 'dominant effect reads ≥ the support effect (rebalance)');
ok(dwd.coef === 1, 'first fusion coef = 0+0+1');
// rarer dominant ⇒ bigger budget (compare same effect kind, esoteric vs common dominant, same rng)
const commonAtk = rollFusedDef(GU_LIB['gu_fire_atk_t3'], GU_LIB['gu_fire_def_t3'], 3, { rng: () => 0.5 });
const esoPath = Object.keys(MYRIAD_MATS).find((p) => commOf(p).key === 'esoteric');
ok(COMMONALITY_BUDGET_MULT.esoteric > COMMONALITY_BUDGET_MULT.common, 'esoteric dominant has a higher budget multiplier');
// cap: a T3 fusion holds ≤ maxEffects(3)=2 stat lines
ok(dwd.effects.filter((e) => e.kind !== 'status').length <= 2, 'effect count capped at maxEffects(tier)');

section('myriad: systems — fuse validation');
fresh();
const fa = grant('gu_fire_atk_t3'), fs = grant('gu_fire_spd_t3');
ok(canFuse(fa, fs).ok, 'same-path same-rank fuse is allowed');
const fa2 = grant('gu_fire_atk_t2');
ok(!canFuse(fa, fa2).ok, 'mismatched-rank fuse is rejected');
S().myriadProficiency = 0;
ok(!canFuse(fa, fs).ok, 'proficiency gate blocks a T3 fuse below proficiency Lv.PROF_REQ[3]');
S().myriadProficiency = 1000;
// cross-path allowed but lower chance
const wd = grant('gu_water_def_t3');
ok(canFuse(fa, wd).ok, 'cross-path fuse is allowed');
ok(canFuse(fa, wd).chance < canFuse(fa, fs).chance, 'cross-path fuse has a lower success chance');

section('myriad: systems — fuse success/failure');
fresh();
const a1 = grant('gu_fire_atk_t3'), s1 = grant('gu_fire_spd_t3');
const before = S().guInv.length, profBefore = S().myriadProficiency;
const r = withRandom(0, () => fuse(a1, s1)); // 0 < chance → success; m roll = LO
ok(r.ok && r.success, 'forced fuse succeeds');
ok(r.item && r.item.myriad, 'result is a myriad inventory item');
ok(resolveOwned(r.item).myriad === true && guTags(resolveOwned(r.item)).includes('myriad'), 'resolveOwned + guTags surface the [myriad] tag');
ok(!S().guInv.find((g) => g.uid === a1) && !S().guInv.find((g) => g.uid === s1), 'both inputs consumed on success');
ok(S().myriadProficiency === profBefore + 3, 'success grants +tier proficiency');
// failure path: both inputs roll to be destroyed (0.999 > any chance → fail; then 0.999 > loss% → survive)
fresh();
const a2 = grant('gu_fire_atk_t3'), s2 = grant('gu_fire_spd_t3');
const rf = withRandom(0.999, () => fuse(a2, s2));
ok(rf.ok && !rf.success, 'forced fuse fails');
ok(S().guInv.find((g) => g.uid === a2) && S().guInv.find((g) => g.uid === s2), 'at 0.999 roll, both inputs survive a failed fuse');

section('myriad: systems — status fusion, salvage, rank-up, T5 cap');
fresh();
const burn = grant('gu_fire_st_burn_t3'); // status-only Gu allowed as an input (brings a rider)
const atkS = grant('gu_fire_atk_t3');
ok(canFuse(atkS, burn).ok, 'a status Gu is a valid fusion input');
const rs = withRandom(0, () => fuse(atkS, burn));
ok(rs.success && resolveOwned(rs.item).effects.some((e) => e.kind === 'status'), 'fused Gu carries a status rider');
// salvage
const sv = salvageMyriad(rs.item.uid);
ok(sv.ok && sv.refund > 0 && !S().guInv.find((g) => g.uid === rs.item.uid), 'salvage refunds Fragments + removes the Gu');
// rank-up: forge a T3 myriad, give it T3 fodder covering its tags, rank to T4
fresh();
const da = grant('gu_fire_atk_t3'), db = grant('gu_fire_def_t3');
const fused = withRandom(0, () => fuse(da, db)).item;
grant('gu_fire_atk_t3'); grant('gu_fire_def_t3'); // tag-cover fodder (atk + def) at the current tier
const ruChk = canRankUp(fused.uid);
ok(ruChk.ok && ruChk.target === 4, 'rank-up to T4 is available with tag-cover fodder');
const oldAtk = effVal(resolveOwned(fused), 'atk');
const ru = withRandom(0, () => rankUp(fused.uid));
ok(ru.ok && ru.success && resolveOwned(fused).tier === 4, 'rank-up bumps the tier');
ok(effVal(resolveOwned(fused), 'atk') >= oldAtk, 'rank-up never lowers an effect (never-worse floor)');
// T5 cap: rank a T5 myriad → target T6 rejected while ascension is locked
ok(MYRIAD_TIER_CAP === 5, 'tier cap is 5 while ascension is UI-locked');
// rank-up is HARDER than fusion (lower base) + the destroy-on-failure curve rises with tier
ok([2, 3, 4, 5].every((t) => RANKUP_BASE_CHANCE[t] < MYRIAD_BASE_CHANCE[t]), 'rank-up base chance is lower than fusion at every tier');
ok([1, 2, 3, 4, 5].every((t) => myriadDestroyChance(t + 1) > myriadDestroyChance(t)), 'destroy-on-failure chance rises with tier');
ok(myriadDestroyChance(1) > 0 && myriadDestroyChance(9) <= 0.65, 'destroy chance is bounded [>0, cap]');
// a FAILED rank-up can now SHATTER the myriad Gu (sequence: success-roll fails, then destroy-roll hits)
fresh();
const fa3 = grant('gu_fire_atk_t3'), fd3 = grant('gu_fire_def_t3');
const doomed = withRandom(0, () => fuse(fa3, fd3)).item;
grant('gu_fire_atk_t3'); grant('gu_fire_def_t3'); // fodder so the attempt proceeds
let seq = [0.999, 0]; const _r = Math.random; Math.random = () => (seq.length ? seq.shift() : 0.999);
const fail = rankUp(doomed.uid); Math.random = _r;
ok(fail.ok && !fail.success && fail.shattered && !S().guInv.find((g) => g.uid === doomed.uid), 'a failed rank-up can destroy the myriad Gu (shatter)');

section('myriad: economy — Arena Shop + ranking payout');
ok(arenaRankBracket(3, 100) === '3', 'rank 3 → its own bracket');
ok(arenaRankBracket(7, 100) === 'top10', 'rank 7 → Top 10');
ok(arenaRankBracket(200, 1000) === 'p25', 'rank 200 of 1000 → Top 25%');
ok(arenaRankReward(1, 100, 'weekly').merits === 500, 'weekly Rank 1 = 500 Merits');
ok(arenaRankReward(1, 100, 'daily').merits === 100, 'daily Rank 1 = 100 Merits');
fresh();
S().arenaMerits = 1000;
const matId = myriadMatId('fire'), beforeMat = S().myriadMats.fire || 0;
const buy = arenaShopBuy(matId, 2);
ok(buy.ok && S().myriadMats.fire === beforeMat + 2, 'Arena Shop sells path materials for Merits');
ok(S().arenaShopBought[matId] === 2, 'purchase counts toward the weekly cap');
const bigBuy = arenaShopBuy(matId, 999);
ok(!bigBuy.ok, 'buying past the weekly cap is blocked');
const fragB = arenaShopBuy('frag_bundle', 1);
ok(fragB.ok && S().derivationFragments >= 1e6 + 50, 'Arena Shop sells Fragment bundles');
// regular Market catalyst → grants the Derivation Catalyst (fusion success)
S().stones = CATALYST_MARKET_PRICE * 2; const catBefore = S().derivationCatalysts;
ok(buyCatalyst(1).ok && S().derivationCatalysts === catBefore + 1, 'the Market sells Derivation Catalysts for stones');

section('myriad: REFINEMENT family (rank-up materials/catalysts)');
fresh(); S().arenaMerits = 1000;
ok(!!REFINE_MATS.fire && REFINE_MATS.fire.id === refineMatId('fire'), 'each path has a Refinement Core');
// Arena Shop sells Refinement Cores (rcore), Derivation + Refinement Catalysts — priced like their counterparts
const dcorePrice = arenaShopStock().find((s) => s.id === 'mat_myriad_fire').price;
const rcorePrice = arenaShopStock().find((s) => s.id === refineMatId('fire')).price;
ok(dcorePrice === rcorePrice, 'Refinement Core costs the same Merits as the Derivation Core');
const dcatPrice = arenaShopStock().find((s) => s.id === DERIVATION_CATALYST.id).price;
const rcatPrice = arenaShopStock().find((s) => s.id === REFINEMENT_CATALYST.id).price;
ok(dcatPrice === rcatPrice, 'Refinement Catalyst costs the same Merits as the Derivation Catalyst');
const rmBefore = S().refineMats.fire || 0;
ok(arenaShopBuy(refineMatId('fire'), 1).ok && S().refineMats.fire === rmBefore + 1, 'Arena Shop sells Refinement Cores → refineMats');
const rcatBefore = S().refinementCatalysts; ok(arenaShopBuy(REFINEMENT_CATALYST.id, 1).ok && S().refinementCatalysts === rcatBefore + 1, 'Arena Shop sells Refinement Catalysts → refinementCatalysts');
const dcatBefore = S().derivationCatalysts; ok(arenaShopBuy(DERIVATION_CATALYST.id, 1).ok && S().derivationCatalysts === dcatBefore + 1, 'Arena Shop sells Derivation Catalysts → derivationCatalysts');
// rank-up consumes a REFINEMENT Core (not a Derivation Core), and wards cut the shatter chance
ok(effectiveShatterChance(5, 3) === Math.max(0, myriadDestroyChance(5) - WARD_STEP * 3), 'Refinement Catalysts reduce shatter (−WARD_STEP each)');
fresh();
const rda = grant('gu_fire_atk_t3'), rdb = grant('gu_fire_def_t3');
const rmu = withRandom(0, () => fuse(rda, rdb)).item;
grant('gu_fire_atk_t3'); grant('gu_fire_def_t3');
const refBefore = S().refineMats.fire, derBefore = S().myriadMats.fire;
withRandom(0, () => rankUp(rmu.uid));
ok(S().refineMats.fire < refBefore && S().myriadMats.fire === derBefore, 'rank-up spends a Refinement Core, not a Derivation Core');
ok(canRankUp(rmu.uid, 2).destroyChance < canRankUp(rmu.uid, 0).destroyChance, 'burning Refinement Catalysts lowers the rank-up shatter chance');

section('myriad: systems — AUTO rank-up (forge missing fodder via the Refinery)');
fresh();
S().frontier = 60;                                  // Market unlocks rank-1 fire resources (rank-1 roster)
const ua = grant('gu_fire_atk_t1'), ub = grant('gu_fire_spd_t1');
const myr = withRandom(0, () => fuse(ua, ub)).item;  // T1 fire myriad {atk, spd}; inputs consumed
ok(myr && resolveOwned(myr).tier === 1, 'made a T1 myriad to rank up');
ok(!canRankUp(myr.uid).ok, 'manual rank-up is blocked with no owned fodder');
const plan = planAutoRankUp(myr.uid);
ok(plan.ok && plan.forge.length >= 1 && plan.totalStones > 0, 'auto-rank plan forges the missing T1 tag-cover fodder');
const ar = withRandom(0, () => autoRankUp(myr.uid));  // forge fodder via the Market, then rank up
ok(ar.ok && ar.success && resolveOwned(myr).tier === 2, 'auto-rank forges fodder + ranks the myriad Gu to T2');
