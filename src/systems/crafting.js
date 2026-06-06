// Gu crafting. Every Gu has a recipe (primeval stones + resources). Tier 2+ Gu are REFINED: in addition
// to the materials, crafting consumes spare same-path Gu EXACTLY ONE TIER LOWER (unequipped copies) —
// and those fodder Gu must, BETWEEN THEM, reproduce the TAGS of the Gu being made. A Gu's tags are its
// positive effect kinds (+ a generic `status` tag if it inflicts any). Every consumed fodder must carry
// at least one of the output's tags (no off-tag filler), the union must cover ALL of them, and at least
// REFINE_MIN fodder are spent. E.g. a [ATK, SPD] Gu needs one ATK + one SPD T-1 same-path Gu; a [ATK]
// Gu needs two ATK-carrying T-1 same-path Gu. Paths whose tier directly below doesn't exist in the
// library (e.g. Time, Space, Killing) are crafted from materials alone. No recipe costs Immortal Essence.
// Tiers 6-10 are unique: only one of each may exist in the world, ever.
// A Gu's Dao Path commonality gates it behind a minimum frontier floor (esoteric = deep only),
// and Gu on locked (Three Supreme) paths cannot be crafted yet.
import { S, uid } from '../state.js';
import { GU_LIB, guList, isUnique, guTags, tagLabel, resolveOwned, nextTierOf } from '../data/gu.js';
import { pathFloorReq, isPathLocked, pathName, commOf } from '../data/daoPaths.js';
import { resourceName } from '../data/resources.js';

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
