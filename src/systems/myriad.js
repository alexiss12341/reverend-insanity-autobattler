// Myriad Gu Refining — state-mutating operations (mirrors systems/crafting.js). Fuse two Gu (a dominant +
// a support) into a custom multi-effect [myriad] Gu, rank a myriad Gu up, or salvage one for Fragments.
// All combat/economy math lives in data/myriad.js (pure); this file reads/writes state.current.
import { S, uid } from '../state.js';
import { resolveOwned, guTags, guList, isUnique, GU_LIB } from '../data/gu.js';
import { pathName, commOf, PATH_AFFINITY } from '../data/daoPaths.js';
import { comprehensionLevelIn, marksIn } from './dao.js';
import { prestigeInsightBonus } from './prestige.js';
import { planAutoCraft, autoCraft } from './crafting.js';
import {
  myriadRefineChance, myriadCosts, rollFusedDef, rerollDef, hasUsableEffect, myriadMatName, refineMatName,
  myriadDestroyChance, effectiveShatterChance, myriadProfLevel,
  MYRIAD_TIER_CAP, PROF_REQ, CATALYST_MAX_STEPS, WARD_MAX, FAIL_LOSS_DOM, FAIL_LOSS_SUP, SALVAGE_RATE, FRAG_COST,
} from '../data/myriad.js';

const mainChar = () => S().roster[0];
// Refining proficiency as a derived LEVEL (points → level via myriadProfLevel); gates + chance read this.
const profLevel = () => myriadProfLevel(S().myriadProficiency || 0);
const coefOf = (def) => (def && def.myriad ? (def.coef || 0) : 0);
const itemOf = (u) => S().guInv.find((g) => g.uid === u);

// Set of equipped Gu uids across the whole roster (fusion inputs must be unequipped).
function equippedSet() {
  const set = new Set();
  for (const c of S().roster) for (const u of (c.gu || [])) set.add(u);
  return set;
}

// Remove a Gu from inventory AND scrub every reference to its uid (equipped slots + killer-move config).
function removeGu(u) {
  const i = S().guInv.findIndex((g) => g.uid === u);
  if (i >= 0) S().guInv.splice(i, 1);
  for (const c of S().roster) {
    if (Array.isArray(c.gu)) c.gu = c.gu.filter((x) => x !== u);
    const k = c.killer;
    if (k) {
      if (k.core === u) { k.core = null; k.support = []; }
      if (Array.isArray(k.support)) k.support = k.support.filter((x) => x !== u);
    }
  }
}

// Build the state-derived ctx data/myriad.js needs (kept state-free there). path = the DOMINANT path.
function chanceCtx(domDef, supDef, { isRankUp = false, catalysts = 0 } = {}) {
  const domPath = domDef.daoPath, supPath = supDef ? supDef.daoPath : domPath;
  const mc = mainChar();
  return {
    domDef, supDef: supDef || domDef, domPath, supPath, isRankUp,
    comp: mc ? comprehensionLevelIn(mc, domPath) : 0,
    marks: mc ? marksIn(mc, domPath) : 0,
    insight: prestigeInsightBonus(),
    profLevel: profLevel(),
    catalysts: Math.min(catalysts || 0, CATALYST_MAX_STEPS),
  };
}

// Shared stones/essence/fragments affordability. Returns reasons[] (empty = ok).
function affordCommon(costs) {
  const r = [];
  if ((S().stones || 0) < costs.stones) r.push(`Need ${costs.stones.toLocaleString()} primeval stones.`);
  if ((S().essence || 0) < costs.essence) r.push(`Need ${costs.essence} ✦ Immortal Essence.`);
  if ((S().derivationFragments || 0) < costs.fragments) r.push(`Need ${costs.fragments} Derivation Fragments.`);
  return r;
}
// FUSION affordability/spend: Derivation Core (myriadMats) + Derivation Catalyst (derivationCatalysts, success).
function fuseAfford(costs, path, cats) {
  const r = affordCommon(costs);
  if (((S().myriadMats || {})[path] || 0) < costs.material.qty) r.push(`Need ${costs.material.qty}× ${myriadMatName(path)}.`);
  if ((S().derivationCatalysts || 0) < cats) r.push(`Need ${cats} Derivation Catalyst${cats === 1 ? '' : 's'}.`);
  return r;
}
function fuseSpend(costs, path, cats) {
  S().stones -= costs.stones; S().essence -= costs.essence; S().derivationFragments -= costs.fragments;
  S().myriadMats[path] = (S().myriadMats[path] || 0) - costs.material.qty;
  if (cats) S().derivationCatalysts = (S().derivationCatalysts || 0) - cats;
}
// RANK-UP affordability/spend: Refinement Core (refineMats) + Refinement Catalyst (refinementCatalysts, wards).
function rankAfford(costs, path, wards) {
  const r = affordCommon(costs);
  if (((S().refineMats || {})[path] || 0) < costs.material.qty) r.push(`Need ${costs.material.qty}× ${refineMatName(path)}.`);
  if ((S().refinementCatalysts || 0) < wards) r.push(`Need ${wards} Refinement Catalyst${wards === 1 ? '' : 's'}.`);
  return r;
}
function rankSpend(costs, path, wards) {
  S().stones -= costs.stones; S().essence -= costs.essence; S().derivationFragments -= costs.fragments;
  S().refineMats[path] = (S().refineMats[path] || 0) - costs.material.qty;
  if (wards) S().refinementCatalysts = (S().refinementCatalysts || 0) - wards;
}

// ---- FUSE (dominant + support → new myriad Gu) ---------------------------------------------------
export function canFuse(domUid, supUid, catalysts = 0) {
  const domItem = itemOf(domUid), supItem = itemOf(supUid);
  if (!domItem || !supItem) return { ok: false, reasons: ['Select a dominant and a support Gu.'] };
  if (domUid === supUid) return { ok: false, reasons: ['Pick two different Gu.'] };
  const domDef = resolveOwned(domItem), supDef = resolveOwned(supItem);
  if (!domDef || !supDef) return { ok: false, reasons: ['Unknown Gu.'] };
  const tier = domDef.tier, path = domDef.daoPath;
  const cat = Math.min(catalysts || 0, CATALYST_MAX_STEPS);
  const reasons = [];
  if (supDef.tier !== tier) reasons.push('Both Gu must be the same rank.');
  if (!hasUsableEffect(domDef) || !hasUsableEffect(supDef)) reasons.push('Each Gu must carry an effect.');
  const eq = equippedSet();
  if (eq.has(domUid) || eq.has(supUid)) reasons.push('Unequip the Gu before refining.');
  if (tier > MYRIAD_TIER_CAP) reasons.push(`Myriad refining is capped at tier ${MYRIAD_TIER_CAP} for now.`);
  if (profLevel() < (PROF_REQ[tier] || 0)) reasons.push(`Needs refining proficiency Lv.${PROF_REQ[tier]} (have Lv.${profLevel()}).`);
  const costs = myriadCosts(tier, coefOf(domDef), coefOf(supDef), path);
  reasons.push(...fuseAfford(costs, path, cat));
  const chance = myriadRefineChance(tier, coefOf(domDef) + coefOf(supDef), chanceCtx(domDef, supDef, { catalysts: cat }));
  return { ok: reasons.length === 0, reasons, costs, chance, tier, path };
}

export function fuse(domUid, supUid, catalysts = 0) {
  const chk = canFuse(domUid, supUid, catalysts);
  if (!chk.ok) return { ok: false, msg: chk.reasons.join(' ') };
  const domDef = resolveOwned(itemOf(domUid)), supDef = resolveOwned(itemOf(supUid));
  const { tier, path, costs, chance } = chk;
  const cat = Math.min(catalysts || 0, CATALYST_MAX_STEPS);
  fuseSpend(costs, path, cat);
  if (Math.random() < chance) {
    removeGu(domUid); removeGu(supUid);
    const def = rollFusedDef(domDef, supDef, tier, { domCoef: coefOf(domDef), supCoef: coefOf(supDef) });
    const item = { uid: uid('g'), myriad: def };
    S().guInv.push(item);
    S().myriadProficiency = (S().myriadProficiency || 0) + tier;
    S().stats.myriadRefines = (S().stats.myriadRefines || 0) + 1;
    return { ok: true, success: true, item, def, msg: `Forged ${def.name}!` };
  }
  const lost = [];
  if (Math.random() < FAIL_LOSS_DOM) { removeGu(domUid); lost.push(domUid); }
  if (Math.random() < FAIL_LOSS_SUP) { removeGu(supUid); lost.push(supUid); }
  return { ok: true, success: false, lost, msg: lost.length ? `Refining failed — ${lost.length} Gu lost.` : 'Refining failed — both Gu survived.' };
}

// ---- RANK-UP (a myriad Gu, tier N → N+1) ---------------------------------------------------------
// Fodder: spare (unequipped, non-myriad) same-path Gu of the CURRENT tier that, between them, cover every
// effect-kind tag of the myriad Gu (≥1 each). Greedy set-cover. Returns chosen item uids, or null.
function selectRankFodder(path, tier, tags, excludeUid) {
  const eq = equippedSet();
  const need = new Set(tags);
  const cands = [];
  for (const it of S().guInv) {
    if (it.uid === excludeUid || it.myriad || eq.has(it.uid)) continue;
    const g = resolveOwned(it);
    if (!g || g.daoPath !== path || g.tier !== tier) continue;
    const t = guTags(g).filter((x) => need.has(x));
    if (t.length) cands.push({ uid: it.uid, tags: t });
  }
  const used = new Set(); const chosen = [];
  const uncovered = new Set(tags);
  while (uncovered.size) {
    let best = -1, gain = 0;
    for (let i = 0; i < cands.length; i++) {
      if (used.has(i)) continue;
      const g = cands[i].tags.reduce((n, t) => n + (uncovered.has(t) ? 1 : 0), 0);
      if (g > gain) { gain = g; best = i; }
    }
    if (best < 0) return null;
    used.add(best); chosen.push(cands[best].uid);
    for (const t of cands[best].tags) uncovered.delete(t);
  }
  return chosen;
}

// `wards` = Refinement Catalysts to burn — they do NOT boost success; they REDUCE the shatter-on-fail chance.
export function canRankUp(uid_, wards = 0) {
  const item = itemOf(uid_);
  if (!item || !item.myriad) return { ok: false, reasons: ['Not a myriad Gu.'] };
  const def = resolveOwned(item);
  const tier = def.tier, target = tier + 1, path = def.daoPath;
  const w = Math.min(wards || 0, WARD_MAX);
  const reasons = [];
  if (target > MYRIAD_TIER_CAP) reasons.push(`Myriad refining is capped at tier ${MYRIAD_TIER_CAP} for now.`);
  if (profLevel() < (PROF_REQ[target] || 0)) reasons.push(`Needs refining proficiency Lv.${PROF_REQ[target]} (have Lv.${profLevel()}).`);
  const tags = guTags(def).filter((t) => t !== 'myriad');
  const fodder = target <= MYRIAD_TIER_CAP ? selectRankFodder(path, tier, tags, uid_) : null;
  if (target <= MYRIAD_TIER_CAP && !fodder) reasons.push(`Need spare T${tier} ${pathName(path)} Gu covering ${tags.map((t) => t).join(' + ') || '—'}.`);
  const costs = myriadCosts(target, coefOf(def), 0, path);
  reasons.push(...rankAfford(costs, path, w));
  const chance = myriadRefineChance(target, coefOf(def), chanceCtx(def, def, { isRankUp: true, catalysts: 0 }));
  return { ok: reasons.length === 0, reasons, costs, chance, fodder, target, path, destroyChance: effectiveShatterChance(def.tier, w), wards: w };
}

export function rankUp(uid_, wards = 0) {
  const chk = canRankUp(uid_, wards);
  if (!chk.ok) return { ok: false, msg: chk.reasons.join(' ') };
  const item = itemOf(uid_);
  const def = resolveOwned(item);
  const { target, path, costs, chance, fodder } = chk;
  const w = Math.min(wards || 0, WARD_MAX);
  rankSpend(costs, path, w);
  if (Math.random() < chance) {
    for (const u of (fodder || [])) removeGu(u);
    item.myriad = rerollDef(def, target);   // bump tier, re-roll mags (never-worse), keep name + coef
    S().myriadProficiency = (S().myriadProficiency || 0) + target;
    S().stats.myriadRefines = (S().stats.myriadRefines || 0) + 1;
    return { ok: true, success: true, item, def: item.myriad, msg: `${item.myriad.name} advanced to tier ${target}!` };
  }
  // failure: the myriad Gu rolls to be DESTROYED at the WARD-reduced shatter chance; the tag-fodder also rolls to be lost.
  const shattered = Math.random() < effectiveShatterChance(def.tier, w);
  const lost = [];
  for (const u of (fodder || [])) if (Math.random() < FAIL_LOSS_SUP) { removeGu(u); lost.push(u); }
  if (shattered) { removeGu(uid_); return { ok: true, success: false, shattered: true, lost, msg: `Rank-up failed — ${def.name} shattered!` }; }
  return { ok: true, success: false, shattered: false, lost, msg: 'Rank-up failed — the Gu survived.' };
}

// ---- AUTO-RANK-UP: reuse the Refinery's auto-craft so the tag-cover fodder is FORGED (buy materials +
// build the lower-tier chain) when you don't already own it, then rank the myriad Gu up — mirroring
// crafting.js autoCraft. So with enough stones you can rank a myriad Gu without hand-crafting its fodder.

// Spare (unequipped, non-myriad) owned Gu counts, by guId — the free fodder pool for the plan.
function spareByGuId() {
  const eq = equippedSet();
  const pool = {};
  for (const it of S().guInv) if (!it.myriad && !eq.has(it.uid)) pool[it.guId] = (pool[it.guId] || 0) + 1;
  return pool;
}
// Pick a tag-COVER of same-path, CURRENT-tier, non-unique library Gu ids covering `tags`. Greedy:
// most-coverage-first, preferring Gu you already have a spare of, then the cheapest recipe. Returns
// [{ id, owned }] or null when no cover exists. (Buildability of the non-owned picks is validated by
// planAutoRankUp via planAutoCraft — kept out of here so this stays cheap to call on every render.)
function chooseRankFodderIds(path, tier, tags) {
  if (!tags.length) return [];
  const spare = spareByGuId();
  const need = new Set(tags);
  const cands = guList().filter((g) => g.daoPath === path && g.tier === tier && !isUnique(g))
    .map((g) => ({ id: g.id, tags: guTags(g).filter((t) => need.has(t)), owned: (spare[g.id] || 0) > 0, stones: (g.recipe && g.recipe.stones) || 0 }))
    .filter((c) => c.tags.length);
  const used = new Set(); const chosen = []; const uncovered = new Set(tags);
  while (uncovered.size) {
    let best = -1, score = null;
    for (let i = 0; i < cands.length; i++) {
      if (used.has(i)) continue;
      const gain = cands[i].tags.reduce((n, t) => n + (uncovered.has(t) ? 1 : 0), 0);
      if (gain <= 0) continue;
      const s = [gain, cands[i].owned ? 1 : 0, -cands[i].stones]; // coverage ≻ owned ≻ cheaper
      if (best < 0 || s[0] > score[0] || (s[0] === score[0] && (s[1] > score[1] || (s[1] === score[1] && s[2] > score[2])))) { best = i; score = s; }
    }
    if (best < 0) return null;
    used.add(best); chosen.push({ id: cands[best].id, owned: cands[best].owned });
    for (const t of cands[best].tags) uncovered.delete(t);
  }
  return chosen;
}

// Plan an auto-rank-up: the rank-up cost PLUS the auto-craft cost of any fodder not already owned. Pure
// (planAutoCraft mutates only its own working copy), so it's safe to call on every render.
export function planAutoRankUp(uid_) {
  const item = itemOf(uid_);
  if (!item || !item.myriad) return { ok: false, reasons: ['Not a myriad Gu.'] };
  const def = resolveOwned(item);
  const tier = def.tier, target = tier + 1, path = def.daoPath;
  const reasons = [];
  if (target > MYRIAD_TIER_CAP) reasons.push(`Myriad refining is capped at tier ${MYRIAD_TIER_CAP} for now.`);
  if (profLevel() < (PROF_REQ[target] || 0)) reasons.push(`Needs refining proficiency Lv.${PROF_REQ[target]} (have Lv.${profLevel()}).`);
  const tags = guTags(def).filter((t) => t !== 'myriad');
  const cover = target <= MYRIAD_TIER_CAP ? chooseRankFodderIds(path, tier, tags) : null;
  if (target <= MYRIAD_TIER_CAP && !cover) reasons.push(`No T${tier} ${pathName(path)} Gu can cover ${tags.join(' + ') || '—'}.`);
  // Which cover entries must be FORGED (owned spares are consumed first, decrementing a local pool).
  const localSpare = spareByGuId();
  const forge = [];
  for (const c of (cover || [])) {
    if ((localSpare[c.id] || 0) > 0) localSpare[c.id]--;
    else forge.push(c.id);
  }
  let forgeStones = 0;
  for (const id of forge) {
    const p = planAutoCraft(id);
    if (!p.ok) { reasons.push(`Can't auto-forge ${(GU_LIB[id] || {}).name || id}: ${p.reasons.join(' ')}`); continue; }
    forgeStones += p.stonesTotal;
  }
  const costs = myriadCosts(target, coefOf(def), 0, path);
  const totalStones = costs.stones + forgeStones;
  // affordability: the rank-up's non-stone costs + the COMBINED stone bill (rank-up + forging). Material is
  // the Refinement Core (rank-up family), NOT the Derivation Core.
  if ((S().stones || 0) < totalStones) reasons.push(`Need ${totalStones.toLocaleString()} primeval stones total (rank-up + forging).`);
  if ((S().essence || 0) < costs.essence) reasons.push(`Need ${costs.essence} ✦ Immortal Essence.`);
  if ((S().derivationFragments || 0) < costs.fragments) reasons.push(`Need ${costs.fragments} Derivation Fragments.`);
  if (((S().refineMats || {})[path] || 0) < costs.material.qty) reasons.push(`Need ${costs.material.qty}× ${refineMatName(path)}.`);
  const chance = myriadRefineChance(target, coefOf(def), chanceCtx(def, def, { isRankUp: true }));
  return { ok: reasons.length === 0, reasons, target, path, costs, forge, forgeStones, totalStones, chance, forgeCount: forge.length, destroyChance: myriadDestroyChance(def.tier) };
}

export function autoRankUp(uid_, wards = 0) {
  const plan = planAutoRankUp(uid_);
  if (!plan.ok) return { ok: false, msg: plan.reasons.join(' ') };
  for (const id of plan.forge) {           // forge the missing tag-cover fodder (leaf→root, via the Market)
    const r = autoCraft(id);
    if (!r.ok) return { ok: false, msg: `Auto-forge: ${r.msg}` };
  }
  return rankUp(uid_, wards);                 // fodder is now owned → the normal rank-up consumes it
}

// ---- SALVAGE (dismantle a myriad Gu for a partial Fragment refund) -------------------------------
export function salvageMyriad(uid_) {
  const item = itemOf(uid_);
  if (!item || !item.myriad) return { ok: false, msg: 'Not a myriad Gu.' };
  const def = item.myriad;
  const refund = Math.round((FRAG_COST[def.tier] || FRAG_COST[9]) * SALVAGE_RATE * (1 + 0.1 * (def.coef || 0)));
  removeGu(uid_);
  S().derivationFragments = (S().derivationFragments || 0) + refund;
  return { ok: true, refund, name: def.name };
}
