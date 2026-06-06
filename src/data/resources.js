// Farmable resources — now on the cultivator RANK ladder (1-9) instead of the old 6-rarity tiers.
// A rank-N resource feeds rank-N Gu recipes. Each resource carries:
//   rank   1..9  (primary axis: drop chance, cost, market gate, recipe matching)
//   rarity        derived from rank, FOR COLOUR/LABEL ONLY (rank→rarity: 1 Common, 2 Uncommon,
//                 3 Rare, 4-5 Epic, 6-7 Legendary, 8-9 Immortal — higher rank within a colour is rarer)
//   floors [s,e]  the band it drops in
//   daoPath       set on path-bound resources
//
// Structure:
//   - PATH resources: every non-locked Dao Path has 5 TYPES (themed nouns per category), and each type
//     is a full rank 1-9 ladder → 5 × 9 = 45 per path.
//   - UNIVERSAL binders: 2 ladders (Family 1 flavour names · Family 2 Spirit Stone), rank 1-9 each.
import { pathList, isPathLocked, pathName, pathFloorReq } from './daoPaths.js';

const TOWER = 450;

// rank (1-9) → rarity, for colour/label only.
const RANK_RARITY = ['Common', 'Uncommon', 'Rare', 'Epic', 'Epic', 'Legendary', 'Legendary', 'Immortal', 'Immortal'];
export const rankRarity = (rank) => RANK_RARITY[Math.max(1, Math.min(9, rank)) - 1];

// 5 resource-type nouns per Dao CATEGORY (applied as "<Path> <Noun>"). Each (path × noun) is one TYPE.
export const CATEGORY_NOUNS = {
  five_elements: ['Mote', 'Vein', 'Crystal', 'Marrow', 'Quintessence'],
  mainstream:    ['Wisp', 'Sliver', 'Prism', 'Halo', 'Aether'],
  combat:        ['Splinter', 'Fang', 'Sinew', 'Heart', 'Relic'],
  mental:        ['Mote', 'Glyph', 'Sigil', 'Soulstone', 'Reverie'],
  utility:       ['Token', 'Charm', 'Talisman', 'Lodestone', 'Reliquary'],
  minor:         ['Sliver', 'Curio', 'Sigil', 'Idol', 'Vestige'],
};
const DEFAULT_NOUNS = ['Mote', 'Shard', 'Crystal', 'Core', 'Relic'];
const nounsForCategory = (cat) => CATEGORY_NOUNS[cat] || DEFAULT_NOUNS;

export const RESOURCES = {};

const bandStart = (rank) => (rank - 1) * 50 + 1;             // realm band start floor for a rank
const hashStr = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
// FLOOR PLACEMENT. A rank-N resource lives in rank N's 50-floor REALM BAND ([(N-1)*50+1 .. N*50]) — so
// rank 1 drops floors 1-50, rank 2 ONLY 51-100, rank 3 ONLY 101-150, … (never before its band; a path's
// mats are also held back to its craft-gate). WITHIN the band each resource drops in an 18-floor
// SUB-WINDOW, offset by id-hash, so the many types SPREAD across the band's floors — each floor's drop
// pool is a varied subset rather than every type of that rank at once.
const SUB = 18;
function floorsFor(rank, gate, id) {
  const base = Math.min(TOWER, Math.max(gate, bandStart(rank)));
  const span = Math.min(49, TOWER - base);            // depth available from `base` (≤ the 50-floor band)
  const slack = Math.max(0, span - (SUB - 1));        // room to slide the sub-window within the band
  const s = base + (slack ? hashStr(id) % (slack + 1) : 0);
  return [s, Math.min(TOWER, s + SUB - 1)];
}
const reg = (id, name, rank, floors, daoPath) => { RESOURCES[id] = { id, name, rank, rarity: rankRarity(rank), floors, daoPath: daoPath || undefined }; };

// --- Universal binder families (2 ladders, rank 1-9) — recipes pull one per path ---
export const BINDER_FAMILIES = ['relic', 'stone'];
const FAMILY1 = ['Spirit Grass', 'Jade Dew', 'Frost Marrow', 'Dragon Tendon', 'Star Sand', 'Primordial Jade', 'Heaven Silk', 'Dao Fragment', 'Chaos Relic'];
const FAMILY2_Q = ['Crude', 'Coarse', 'Refined', 'Pure', 'Earthen', 'Profound', 'Heavenly', 'Saint', 'Immortal'];
export const binderId = (fam, rank) => `bind_${fam}_r${rank}`;
for (let r = 1; r <= 9; r++) {
  const idA = binderId('relic', r), idB = binderId('stone', r);
  reg(idA, FAMILY1[r - 1], r, floorsFor(r, 1, idA), null);
  reg(idB, `${FAMILY2_Q[r - 1]} Spirit Stone`, r, floorsFor(r, 1, idB), null);
}

// --- Path resources: 5 themed types × rank 1-9 per non-locked path ---
const nounKey = (n) => n.toLowerCase();
export const pathResTypes = (pathId) => nounsForCategory((pathList().find((p) => p.id === pathId) || {}).category).map(nounKey);
export const pathResId = (pathId, nounK, rank) => `res_${pathId}_${nounK}_r${rank}`;

for (const p of pathList()) {
  if (isPathLocked(p.id)) continue;
  const short = pathName(p.id).replace(/ Path$/, '');
  const gate = pathFloorReq(p.id);
  for (const noun of nounsForCategory(p.category)) {
    for (let r = 1; r <= 9; r++) {
      const id = pathResId(p.id, nounKey(noun), r);
      reg(id, `${short} ${noun}`, r, floorsFor(r, gate, id), p.id);
    }
  }
}

export const resourceList = () => Object.values(RESOURCES);

// Display name for a resource id (falls back to the id so unknown/legacy ids never crash the UI).
export const resourceName = (id) => (RESOURCES[id] && RESOURCES[id].name) || id;

// All resources bound to a given Dao Path.
export const resourcesForPath = (pathId) => resourceList().filter((r) => r.daoPath === pathId);

// Resources whose drop-band includes this floor (both universal and path-bound).
export function resourcesForFloor(floor) {
  return resourceList().filter((r) => floor >= r.floors[0] && floor <= r.floors[1]);
}
