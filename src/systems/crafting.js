// Gu crafting. Every Gu has a recipe (primeval stones + resources). Tier 2+ Gu are REFINED: in addition
// to the materials, crafting consumes spare same-path Gu EXACTLY ONE TIER LOWER (unequipped copies) —
// and those fodder Gu must, BETWEEN THEM, reproduce the TAGS of the Gu being made. A Gu's tags are its
// positive effect kinds (+ a generic `status` tag if it inflicts any). Every consumed fodder must carry
// at least one of the output's tags (no off-tag filler), the union must cover ALL of them, and at least
// REFINE_MIN fodder are spent. E.g. a [ATK, SPD] Gu needs one ATK + one SPD T-1 same-path Gu; a [ATK]
// Gu needs two ATK-carrying T-1 same-path Gu. Paths whose tier directly below doesn't exist in the
// library (e.g. Time, Space, Killing) are crafted from materials alone. No recipe costs Immortal Essence.
// Tiers 6-10 are unique immortal Gu; crafting them is DISABLED for now (canCraft refuses tier 6+).
// A Gu's Dao Path commonality gates it behind a minimum frontier floor (esoteric = deep only),
// and Gu on locked (Three Supreme) paths cannot be crafted yet.
import { S, uid } from '../state.js';
import { GU_LIB, guList, isUnique, guTags, tagLabel, resolveOwned, nextTierOf } from '../data/gu.js';
import { pathFloorReq, isPathLocked, pathName, commOf } from '../data/daoPaths.js';
import { resourceName, RESOURCES } from '../data/resources.js';
import { marketUnlocked, resourceCost, buyResource } from './economy.js';

const REFINE_FODDER_MAX = 5; // unique Gu (tier 6+) are never consumed as fodder
const REFINE_MIN = 2;        // minimum same-path Gu — EXACTLY one tier lower — consumed per higher-tier craft

// The tier a Gu refines FROM: exactly one tier below it.
export const fodderTier = (gu) => gu.tier - 1;
// Is `g` a valid fodder Gu for refining `gu`? Same path, exactly one tier lower, and not a unique (6+).
const fodderEligible = (g, gu) => g.daoPath === gu.daoPath && g.tier === fodderTier(gu) && g.tier <= REFINE_FODDER_MAX;

// Does the library contain a same-path Gu EXACTLY one tier below this one? (If not — the tier directly
// below doesn't exist for this path, or it would be a unique tier 6+ — this Gu is crafted from
// materials alone, with no refinement fodder.)
// The library is STATIC, so precompute the set of `(path:tier)` pairs ONCE (lazily) — turning this from
// an O(library) scan per call into an O(1) lookup. (Naively scanning made rendering the whole ~5,271-Gu
// Refinery O(n²) ≈ 4s; this is what keeps it instant.)
let _fodderTiers = null;
const fodderTierSet = () => {
  if (!_fodderTiers) {
    _fodderTiers = new Set();
    for (const g of guList()) if (g.tier <= REFINE_FODDER_MAX) _fodderTiers.add(`${g.daoPath}:${g.tier}`);
  }
  return _fodderTiers;
};
const libHasAdjacentLower = (gu) => fodderTierSet().has(`${gu.daoPath}:${fodderTier(gu)}`);

// Does refinement (tag-covering fodder) apply to this Gu at all?
export const refineApplies = (gu) => !!gu && gu.tier >= 2 && libHasAdjacentLower(gu);

// The player's SPARE (unequipped) owned Gu eligible as fodder for `gu` — same path, EXACTLY one tier
// lower (never a unique 6+). Each entry resolves the inventory item plus the source Gu's tag set.
function fodderCandidates(gu) {
  const equipped = new Set();
  for (const c of S().roster) for (const u of c.gu) equipped.add(u);
  const out = [];
  for (const it of S().guInv) {
    if (equipped.has(it.uid)) continue;
    const g = GU_LIB[it.guId];
    if (g && fodderEligible(g, gu)) out.push({ it, tags: guTags(g) });
  }
  return out;
}

// Pick the concrete fodder items to consume for refining `gu`, or null if the player can't satisfy the
// tag-coverage requirement. Returns [] when refinement doesn't apply. Greedy set-cover over the spare
// same-path one-tier-lower Gu that share at least one of the output's tags, padded to REFINE_MIN.
export function selectFodder(gu) {
  if (!refineApplies(gu)) return [];
  const required = guTags(gu);
  const reqSet = new Set(required);
  // Under "both must match", only fodder carrying a required tag is ever usable. (No tags → any spare.)
  const pool = required.length ? fodderCandidates(gu).filter((c) => c.tags.some((t) => reqSet.has(t)))
                               : fodderCandidates(gu);

  const chosen = [];
  const used = new Set();
  const uncovered = new Set(required);
  while (uncovered.size) {
    let best = -1, bestGain = 0;
    for (let i = 0; i < pool.length; i++) {
      if (used.has(i)) continue;
      const gain = pool[i].tags.reduce((n, t) => n + (uncovered.has(t) ? 1 : 0), 0);
      if (gain > bestGain) { bestGain = gain; best = i; }
    }
    if (best < 0) return null;                 // remaining tags can't be covered
    used.add(best); chosen.push(pool[best].it);
    for (const t of pool[best].tags) uncovered.delete(t);
  }
  for (let i = 0; i < pool.length && chosen.length < REFINE_MIN; i++) {
    if (!used.has(i)) { used.add(i); chosen.push(pool[i].it); }   // pad to the minimum with more on-tag fodder
  }
  return chosen.length >= REFINE_MIN ? chosen : null;
}

// Refinement requirement summary for the UI: the tier/path of the fodder, the minimum count, and the
// TAGS the fodder must cover between them. `needed:false` when this Gu is materials-only.
export function refineSpec(gu) {
  if (!refineApplies(gu)) return { needed: false, min: 0, tags: [] };
  return { needed: true, min: REFINE_MIN, tier: fodderTier(gu), path: gu.daoPath, tags: guTags(gu).map(tagLabel) };
}

export function canCraft(guId) {
  const gu = GU_LIB[guId];
  if (!gu) return { ok: false, reasons: ['Unknown Gu.'] };
  // Immortal Gu (tier 6+, the unique artifacts) are not craftable for now — short-circuit so the UI shows
  // a single clear reason and the "Craftable now" filter excludes them. (Already-owned immortal Gu still ascend.)
  if (gu.tier >= 6) return { ok: false, reasons: ['Immortal Gu cannot be crafted for now.'] };
  const reasons = [];
  if (isPathLocked(gu.daoPath)) reasons.push(`${pathName(gu.daoPath)} is not yet comprehensible.`);
  const floorReq = pathFloorReq(gu.daoPath);
  if (S().frontier < floorReq) reasons.push(`Requires Floor ${floorReq} (${commOf(gu.daoPath).label} path).`);
  if (isUnique(gu) && S().uniqueClaimed[guId]) reasons.push('Already exists in the world (unique).');
  const r = gu.recipe;
  if (S().stones < (r.stones || 0)) reasons.push(`Need ${r.stones} primeval stones.`);
  for (const id in (r.resources || {})) {
    const have = S().resources[id] || 0;
    if (have < r.resources[id]) reasons.push(`Need ${r.resources[id]}× ${resourceName(id)} (have ${have}).`);
  }
  if (refineApplies(gu) && !selectFodder(gu)) {
    const tags = guTags(gu).map(tagLabel).join(' + ') || '—';
    reasons.push(`Refine: need ≥${REFINE_MIN} spare T${fodderTier(gu)} ${pathName(gu.daoPath)} Gu covering ${tags}.`);
  }
  return { ok: reasons.length === 0, reasons };
}

export function craft(guId) {
  const check = canCraft(guId);
  if (!check.ok) return { ok: false, msg: check.reasons.join(' ') };
  const gu = GU_LIB[guId];
  const r = gu.recipe;
  S().stones -= (r.stones || 0);
  for (const id in (r.resources || {})) S().resources[id] -= r.resources[id];
  // consume the tag-covering lower-tier same-path Gu as refinement fodder
  const consumed = selectFodder(gu) || [];
  for (const it of consumed) {
    const idx = S().guInv.findIndex((x) => x.uid === it.uid);
    if (idx >= 0) S().guInv.splice(idx, 1);
  }
  if (isUnique(gu)) S().uniqueClaimed[guId] = true;

  const item = { uid: uid('g'), guId };
  if (gu.byTier) item.tier = gu.tier;   // immortal artifacts track an instance tier (ascendable later)
  S().guInv.push(item);
  S().stats.crafts += 1;
  return { ok: true, item, gu, consumed: consumed.length };
}

// ---- AUTO-CRAFT: forge a Gu even when you lack the lower-tier fodder or some materials, by BUYING the
// missing resources from the Market and RECURSIVELY crafting the missing same-path fodder. So with enough
// primeval stones you can jump straight to a tier-5 Gu without hand-building the T1→T4 refinement chain.
//
// planAutoCraft(guId) walks the full dependency tree on a WORKING COPY of your resources + spare Gu
// (reserving what you already own FIRST, so it only buys/forges the deficit) and returns a complete,
// ordered plan: which resources to buy, which fodder Gu to forge (leaf→root), and the TOTAL stone cost
// (every sub-recipe's stones + every market purchase). It bypasses NOTHING that is a hard gate — locked
// (Supreme) paths, the path's floor requirement, immortal tier-6+ Gu, and resources you can't yet buy
// (not Market-unlocked AND not owned) all still block it, with a precise reason. The Market's own roster-
// rank gate therefore caps how high you can leap: buying a rank-5 material still needs a rank-5 cultivator.

// Spare (unequipped) owned Gu, grouped by guId — the starting fodder pool for a plan.
function sparePool() {
  const equipped = new Set();
  for (const c of S().roster) for (const u of c.gu) equipped.add(u);
  const pool = {};
  for (const it of S().guInv) if (!equipped.has(it.uid)) pool[it.guId] = (pool[it.guId] || 0) + 1;
  return pool;
}

// One-level buildability heuristic — used only to ORDER/exclude fodder candidates (the recursive planGu is
// the authority). True if this Gu's own hard gates pass and each recipe resource is owned or Market-buyable.
function looksBuildable(gu) {
  if (!gu || gu.tier >= 6 || isPathLocked(gu.daoPath) || S().frontier < pathFloorReq(gu.daoPath)) return false;
  for (const id in (gu.recipe.resources || {})) {
    const r = RESOURCES[id];
    if ((S().resources[id] || 0) <= 0 && !(r && marketUnlocked(r))) return false;
  }
  return true;
}

// Reserve `gu`'s recipe resources from the working pool, queuing a Market buy for any deficit. Mutates ctx;
// pushes a reason + returns false if a missing resource can't be bought (not unlocked).
function reserveResources(gu, ctx) {
  for (const [id, qty] of Object.entries(gu.recipe.resources || {})) {
    const use = Math.min(ctx.res[id] || 0, qty);
    ctx.res[id] = (ctx.res[id] || 0) - use;
    const deficit = qty - use;
    if (deficit > 0) {
      const r = RESOURCES[id];
      if (!r || !marketUnlocked(r)) { ctx.reasons.push(`Can't buy ${resourceName(id)} — not unlocked in the Market.`); return false; }
      ctx.buys[id] = (ctx.buys[id] || 0) + deficit;
      ctx.buyCost += resourceCost(id) * deficit;
    }
  }
  return true;
}

// Obtain ONE copy of fodder Gu `g`: take a spare if available, else recursively plan to craft it (the
// crafted copy is consumed by its parent, so it is NOT returned to the pool).
function obtainFodder(g, ctx) {
  if ((ctx.pool[g.id] || 0) > 0) { ctx.pool[g.id]--; return true; }
  return planGu(g.id, ctx);
}

// Plan the refinement fodder for `gu`: a tag-covering set of spare-or-crafted same-path one-tier-lower Gu,
// ≥ REFINE_MIN of them, every member on-tag, the union covering all of `gu`'s tags. Greedy set-cover that
// prefers fodder you already own (free), then the cheapest buildable to forge. Mutates ctx; false + reason.
function planFodder(gu, ctx) {
  const required = guTags(gu);
  const reqSet = new Set(required);
  // candidate library fodder: same path, exactly one tier lower, carrying ≥1 required tag (any when the
  // output has no positive tags). Keep only those we own a spare of OR could plausibly forge.
  const cands = guList()
    .filter((g) => fodderEligible(g, gu) && (!required.length || guTags(g).some((t) => reqSet.has(t))))
    .map((g) => ({ g, tags: guTags(g) }))
    .filter((c) => (ctx.pool[c.g.id] || 0) > 0 || looksBuildable(c.g));
  // ranking key per candidate (recomputed each pick, since the pool drains): own-a-spare ≻ buildable ≻ cheaper.
  const rank = (c) => [(ctx.pool[c.g.id] || 0) > 0 ? 1 : 0, looksBuildable(c.g) ? 1 : 0, -(c.g.recipe.stones || 0)];
  const better = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
  let count = 0;
  const uncovered = new Set(required);
  while (uncovered.size) {                          // cover every required tag, most-coverage-first
    let best = null, bestGain = 0, bestRank = null;
    for (const c of cands) {
      const gain = c.tags.reduce((n, t) => n + (uncovered.has(t) ? 1 : 0), 0);
      if (gain <= 0) continue;
      const rk = rank(c);
      if (gain > bestGain || (gain === bestGain && better(rk, bestRank) > 0)) { best = c; bestGain = gain; bestRank = rk; }
    }
    if (!best) { ctx.reasons.push(`Refine: no T${fodderTier(gu)} ${pathName(gu.daoPath)} Gu covers ${guTags(gu).map(tagLabel).join(' + ') || '—'}.`); return false; }
    if (!obtainFodder(best.g, ctx)) return false;
    for (const t of best.tags) uncovered.delete(t);
    count++;
  }
  while (count < REFINE_MIN) {                       // pad to the minimum count with the cheapest available
    let best = null, bestRank = null;
    for (const c of cands) { const rk = rank(c); if (!best || better(rk, bestRank) > 0) { best = c; bestRank = rk; } }
    if (!best) { ctx.reasons.push(`Refine: need ≥${REFINE_MIN} spare T${fodderTier(gu)} ${pathName(gu.daoPath)} Gu.`); return false; }
    if (!obtainFodder(best.g, ctx)) return false;
    count++;
  }
  return true;
}

// Recursively plan to craft ONE `guId`, accumulating resource buys, sub-crafts and the running stone total
// into ctx. Records the craft (leaf→root) on success. False + reason on any hard block. (Recursion always
// terminates: fodder is strictly one tier lower, bottoming out at materials-only tier-1 Gu.)
function planGu(guId, ctx) {
  const gu = GU_LIB[guId];
  if (!gu) { ctx.reasons.push('Unknown Gu.'); return false; }
  if (gu.tier >= 6) { ctx.reasons.push('Immortal Gu cannot be crafted for now.'); return false; }
  if (isUnique(gu) && S().uniqueClaimed[guId]) { ctx.reasons.push('Already exists in the world (unique).'); return false; }
  if (isPathLocked(gu.daoPath)) { ctx.reasons.push(`${pathName(gu.daoPath)} is not yet comprehensible.`); return false; }
  const floorReq = pathFloorReq(gu.daoPath);
  if (S().frontier < floorReq) { ctx.reasons.push(`Requires Floor ${floorReq} (${commOf(gu.daoPath).label} path).`); return false; }
  if (!reserveResources(gu, ctx)) return false;
  ctx.recipeStones += (gu.recipe.stones || 0);
  if (refineApplies(gu) && !planFodder(gu, ctx)) return false;
  ctx.crafts.push(guId);
  return true;
}

// Build the auto-craft plan for `guId`. Pure (mutates only its local ctx) — safe to call on every render.
export function planAutoCraft(guId) {
  const ctx = { res: { ...S().resources }, pool: sparePool(), buys: {}, buyCost: 0, recipeStones: 0, crafts: [], reasons: [] };
  const ok = planGu(guId, ctx);
  const stonesTotal = ctx.recipeStones + ctx.buyCost;
  return {
    ok, reasons: ok ? [] : (ctx.reasons.length ? ctx.reasons : ['Cannot craft.']),
    stonesTotal, buyCost: ctx.buyCost, recipeStones: ctx.recipeStones,
    buys: ctx.buys, crafts: ctx.crafts, subCrafts: ctx.crafts.slice(0, -1), // sub-crafts = everything but the target
    affordable: S().stones >= stonesTotal,
    direct: ok && ctx.buyCost === 0 && ctx.crafts.length === 1, // craftable right now with no purchases/forging
  };
}

// Execute an auto-craft: validate the plan + total affordability, buy the resources, then forge every Gu
// leaf→root (the existing craft() consumes each step's resources/fodder). Mirrors craft()'s return shape.
export function autoCraft(guId) {
  const plan = planAutoCraft(guId);
  if (!plan.ok) return { ok: false, msg: plan.reasons.join(' ') };
  if (!plan.affordable) return { ok: false, msg: `Need ${plan.stonesTotal} 石 total — have ${S().stones}.` };
  for (const id in plan.buys) {
    const r = buyResource(id, plan.buys[id]);
    if (!r.ok) return { ok: false, msg: `Market: ${r.msg}` };
  }
  let last = null;
  for (const id of plan.crafts) {
    const r = craft(id);
    if (!r.ok) return { ok: false, msg: `Refine: ${r.msg}` };
    last = r;
  }
  return last ? { ok: true, item: last.item, gu: last.gu, bought: plan.buyCost, forged: plan.crafts.length, plan }
              : { ok: false, msg: 'Nothing to craft.' };
}

// ---- Ascension: grow an OWNED immortal Gu one rank (tier 6→7→8→9). Each step consumes stones + THAT
// rank's resources (gu.byTier[next].recipe — strict 1:1 rank↔tier), and NO refinement fodder: you already
// own the artifact, so ascending feeds it deeper materials rather than refining a fresh copy. Bumps the
// instance `tier`; resolveOwned then surfaces the stronger per-tier form to combat & the sheet.
export function upgradeRecipe(item) {
  const gu = item && GU_LIB[item.guId];
  const next = nextTierOf(item);
  return (gu && gu.byTier && next && gu.byTier[next]) ? gu.byTier[next].recipe : null;
}

export function canUpgrade(uid) {
  const item = S().guInv.find((g) => g.uid === uid);
  if (!item) return { ok: false, reasons: ['No such Gu.'] };
  if (!GU_LIB[item.guId]) return { ok: false, reasons: ['Unknown Gu.'] };
  const next = nextTierOf(item);
  if (!next) return { ok: false, reasons: ['Already at its peak rank.'] };
  const r = upgradeRecipe(item);
  const reasons = [];
  if (S().stones < (r.stones || 0)) reasons.push(`Need ${r.stones} primeval stones.`);
  for (const id in (r.resources || {})) {
    const have = S().resources[id] || 0;
    if (have < r.resources[id]) reasons.push(`Need ${r.resources[id]}× ${resourceName(id)} (have ${have}).`);
  }
  return { ok: reasons.length === 0, reasons, next, recipe: r };
}

export function upgrade(uid) {
  const check = canUpgrade(uid);
  if (!check.ok) return { ok: false, msg: check.reasons.join(' ') };
  const item = S().guInv.find((g) => g.uid === uid);
  const r = check.recipe;
  S().stones -= (r.stones || 0);
  for (const id in (r.resources || {})) S().resources[id] -= r.resources[id];
  item.tier = check.next;
  return { ok: true, item, gu: resolveOwned(item), tier: check.next };
}
