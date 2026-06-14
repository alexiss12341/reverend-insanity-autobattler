// Gu library — GENERATED from the 45-path roster (see plan "Gu Types & Effects"). Each Gu carries a
// signed `effects` array (multi-effect, drawbacks negative); magnitudes/essence come from the
// power-budget model (data/guBudget.js). Names come from data/guNames.js where authored, else a
// generic fallback. Mortal lines = 5 Gu (T1-5, renamed each tier); immortal lines = ONE Gu (the
// singular T6+ artifact; `maxTier` flags it can grow to T9 — value baked at its entry tier for now).
import { pathList, isPathLocked, pathName, commOf, PATH_AFFINITY, PATH_STATUSES } from './daoPaths.js';
import { STATUS, statusDuration } from './status.js';
import { GU_ESSENCE, singleLineValue, allocateMulti, budgetOf } from './guBudget.js';
import { GU_NAMES, PATH_EPITHETS, GENERIC_EPITHETS } from './guNames.js';
import { pathResTypes, pathResId, binderId, BINDER_FAMILIES } from './resources.js';

// The 17 universal effect kinds every path carries (Lucky is luck-only; Status is path-gated).
export const UNIVERSAL_KINDS = ['atk','hp','def','spd','crit','critDmg','critRes','statusRes','evasion','hit','armorPen','lifesteal','regen','thorns','potency','essPool','essRcv'];
const KIND_LABEL = {
  atk:'Force', hp:'Vitality', def:'Defense', spd:'Swiftness', crit:'Edge', critDmg:'Ferocity',
  critRes:'Composure', statusRes:'Ward', evasion:'Evasion', hit:'Precision', armorPen:'Sundering',
  lifesteal:'Leeching', regen:'Renewal', thorns:'Reprisal', potency:'Dominance', essPool:'Aperture',
  essRcv:'Circulation', lucky:'Fortune', status:'Affliction',
};
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

// ---- recipe generation: TAG-DRIVEN, RANK-MATCHED (strict 1:1). A tier-N Gu consumes RANK-N resources.
// Its TAGS (guTags: each positive effect kind + a generic `status` tag) choose WHICH of the path's 5
// themed types it draws from, via TAG_SLOT (5 domain buckets → the path's 5 type slots) — so every one
// of a path's types sees use, and multi-effect signatures pull several. Quantities ramp with tier
// (PER_SLOT/BINDER). Stone cost = tier base × path commonality × the Gu's BUDGET RATIO (bp / tier base;
// drawbacks raise bp → cost more). Immortal Gu reuse this at ranks 7-9 via ascension (see byTier below).
// Primeval-stone base cost per tier — calibrated to canonical Reverend Insanity Gu pricing. For MORTAL
// ranks the value is the MIDDLE of each rank's RI band (a typical common-path Gu); rarer paths cost more
// via the commonality multiplier (×1 common → ×3.5 esoteric) + the Gu's budget ratio. RI bands:
// R1 500–1k · R2 1k–2.5k · R3 2.5k–10k · R4 25k–100k · R5 250k–1M+ → midpoints below. Immortal ranks 6-9
// are effectively priceless — they keep the ~×10 per-rank acceleration into the billions.
export const TIER_STONES = {
  1: 750, 2: 1750, 3: 6250, 4: 62500, 5: 625000,
  6: 2500000, 7: 25000000, 8: 250000000, 9: 2500000000,
};
// Tag → type-slot index (0..4). slot 0 OFFENSE · 1 GUARD · 2 MOTION · 3 VITALITY · 4 MYSTIC (the order
// roughly tracks each category's 5 nouns). Every slot holds ≥2 UNIVERSAL kinds, and every path carries
// all 17 universal kinds at T1-6 — so all 5 of a path's types are guaranteed consumers. Tunable.
const TAG_SLOT = {
  atk: 0, crit: 0, critDmg: 0, hit: 0, armorPen: 0,
  def: 1, critRes: 1, statusRes: 1, thorns: 1,
  spd: 2, evasion: 2, lifesteal: 2,
  hp: 3, regen: 3,
  potency: 4, essPool: 4, essRcv: 4, status: 4, lucky: 4,
};
// The 5 effect DOMAINS (mirror of TAG_SLOT's 5 type-slots, same order). A Gu effect kind → its domain,
// used by killer-move composition (data/combos.js) to bucket a core's effects into a dominant theme.
export const EFFECT_DOMAINS = ['offense', 'guard', 'motion', 'vitality', 'mystic'];
export const domainOfTag = (tag) => EFFECT_DOMAINS[TAG_SLOT[tag] != null ? TAG_SLOT[tag] : 0] || 'offense';

const PER_SLOT = [0, 2, 3, 4, 5, 6, 7, 9, 11, 14];   // path-resource count per used type-slot, by rank 1-9
const BINDER   = [0, 1, 1, 2, 2, 3, 3, 4,  5,  6];   // universal binder count, by rank 1-9
export function recipeFor(path, tier, bp = budgetOf(tier), tags = ['atk']) {
  const rank = Math.max(1, Math.min(9, tier));
  const types = pathResTypes(path);
  const slots = new Set((tags && tags.length ? tags : ['atk']).map((t) => (TAG_SLOT[t] ?? 0) % types.length));
  const resources = {};
  for (const s of slots) resources[pathResId(path, types[s], rank)] = PER_SLOT[rank];
  // one universal binder; family chosen from the primary slot so BOTH families (relic/stone) see use.
  const fam = BINDER_FAMILIES[[...slots][0] < 3 ? 0 : 1];
  resources[binderId(fam, rank)] = BINDER[rank];
  const ratio = (bp || budgetOf(tier)) / (budgetOf(tier) || 1);
  return { stones: Math.round((TIER_STONES[tier] || TIER_STONES[9]) * (commOf(path).costMult || 1) * ratio), resources };
}

// ---- name resolution -----------------------------------------------------------------------------
// GU_NAMES[path][kind] = { mortal:[5 names], immortal:'core name' }; falls back to a generic label.
function names(path, kind) { return (GU_NAMES[path] && GU_NAMES[path][kind]) || null; }
function mortalName(path, kind, tier) {
  const n = names(path, kind);
  if (n && n.mortal && n.mortal[tier - 1]) return `${n.mortal[tier - 1]} Gu`;
  return `${pathName(path)} ${KIND_LABEL[kind] || kind} ${ROMAN[tier] || tier} Gu`;
}
function immortalName(path, kind) {
  const n = names(path, kind);
  const core = (n && n.immortal) || `${pathName(path)} ${KIND_LABEL[kind] || kind}`;
  return `${core} Immortal Gu`;
}
// Bespoke status-line names: GU_NAMES[path].status[statusId] = { mortal:[5], immortal:'core' }.
function statusGuName(path, st, tier) {
  const n = (GU_NAMES[path] && GU_NAMES[path].status && GU_NAMES[path].status[st]) || null;
  const label = STATUS[st] ? STATUS[st].label : st;
  if (tier >= 6) return `${(n && n.immortal) || `${label} of ${pathName(path)}`} Immortal Gu`;
  if (n && n.mortal && n.mortal[tier - 1]) return `${n.mortal[tier - 1]} Gu`;
  return `${pathName(path)} ${label} ${ROMAN[tier] || tier} Gu`;
}
// Bespoke signature names: GU_NAMES[path].sig = { dbl, tri, quad } (cores). quad = immortal capstone.
function sigGuName(path, key) {
  const core = GU_NAMES[path] && GU_NAMES[path].sig && GU_NAMES[path].sig[key];
  if (key === 'quad') return `${core || `${pathName(path)} Sovereign`} Immortal Gu`;
  return `${core || `${pathName(path)} ${key === 'dbl' ? 'Adept' : 'Master'}`} Gu`;
}

// ---- status spec for a pure status line (chance / per-tick DoT / duration) ------------------------
function statusSpec(type, tier) {
  const base = (STATUS[type] && STATUS[type].base) || 0.3;
  const chance = Math.min(0.85, base + 0.05 * tier);
  const dot = (STATUS[type] && STATUS[type].dot) ? (STATUS[type].mag || 0) * (1 + 0.08 * tier) : 0; // per-tick (DoTs), tier-scaled
  return { kind: 'status', status: type, chance, dot, dur: statusDuration(type, tier) };
}

// ---- generation ----------------------------------------------------------------------------------
const LIST = [];
const push = (gu) => {
  if (gu.bp == null) gu.bp = budgetOf(gu.tier);   // effective power budget (drives stone cost); pure → tier base
  gu.recipe = recipeFor(gu.daoPath, gu.tier, gu.bp, guTags(gu)); // materials chosen by THIS Gu's tags
  LIST.push(gu);
};

// Compute an immortal Gu's { effects, essence, bp } at an arbitrary tier from its NATURE spec, reusing
// the same generators that built its tier-6 form. (`kind` = one universal line · `status` = a DoT/control
// line · `sig` = a multi-line signature.)
function immortalVariant(spec, aff, t) {
  if (spec.type === 'kind') {
    return { effects: [{ kind: spec.kind, value: singleLineValue(spec.kind, t, aff.has(spec.kind)) }],
      essence: GU_ESSENCE[t], bp: budgetOf(t) };
  }
  if (spec.type === 'status') {
    return { effects: [statusSpec(spec.st, t)], essence: GU_ESSENCE[t], bp: budgetOf(t) };
  }
  const { values, essence, beff } = allocateMulti(spec.kinds, [], t, aff);
  return { effects: spec.kinds.map((k) => ({ kind: k, value: values[k] })), essence, bp: beff };
}

// Push an immortal Gu (entry tier 6, ASCENDABLE to 9). Builds `byTier` {6..9}: per-tier effects/essence/bp
// plus a RANK-t recipe — so ascending consumes that rank's resources (crafting.upgrade) and the deeper
// resource ranks 7-9 get real consumers. The stored Gu IS its tier-6 form; resolveOwned surfaces the rest.
function pushImmortal(base, spec, path, aff) {
  const byTier = {};
  for (let t = 6; t <= 9; t++) {
    const v = immortalVariant(spec, aff, t);
    v.recipe = recipeFor(path, t, v.bp, guTags(v));
    byTier[t] = v;
  }
  const v6 = byTier[6];
  push({ ...base, tier: 6, maxTier: 9, daoPath: path, unique: true,
    effects: v6.effects, essence: v6.essence, bp: v6.bp, byTier });
}

for (const p of pathList()) {
  if (isPathLocked(p.id)) continue;            // Three Supreme: no Gu yet
  const path = p.id;
  const aff = new Set(PATH_AFFINITY[path] || []);
  const kinds = [...UNIVERSAL_KINDS];
  if (path === 'luck') kinds.push('lucky');

  for (const kind of kinds) {
    const isAff = aff.has(kind);
    for (let t = 1; t <= 5; t++) {             // mortal: 5 distinct Gu
      push({ id: `gu_${path}_${kind}_t${t}`, name: mortalName(path, kind, t), tier: t, daoPath: path,
        effects: [{ kind, value: singleLineValue(kind, t, isAff) }], essence: GU_ESSENCE[t], unique: false });
    }
    // immortal: ONE ascendable artifact (entry tier 6; ascends to 9, byTier holds each rank's form)
    pushImmortal({ id: `gu_${path}_${kind}_imm`, name: immortalName(path, kind) }, { type: 'kind', kind }, path, aff);
  }

  // 2 status lines per path (mortal 1-5 + immortal), bespoke-named where authored
  for (const st of (PATH_STATUSES[path] || [])) {
    for (let t = 1; t <= 5; t++) {
      push({ id: `gu_${path}_st_${st}_t${t}`, name: statusGuName(path, st, t),
        tier: t, daoPath: path, effects: [statusSpec(st, t)], essence: GU_ESSENCE[t], unique: false });
    }
    pushImmortal({ id: `gu_${path}_st_${st}_imm`, name: statusGuName(path, st, 6) }, { type: 'status', st }, path, aff);
  }

  // signatures: a double (T3), a triple (T5), a quad immortal (T6) drawn from the path's affinity.
  const a = PATH_AFFINITY[path] || [];
  const sig = (id, name, tier, kindsList) => {
    const { values, essence, beff } = allocateMulti(kindsList, [], tier, aff);
    push({ id: `gu_${path}_sig_${id}`, name, tier, daoPath: path,
      effects: kindsList.map((k) => ({ kind: k, value: values[k] })), essence, bp: beff, unique: tier >= 6 });
  };
  if (a.length >= 2) sig('dbl', sigGuName(path, 'dbl'), 3, a.slice(0, 2));
  if (a.length >= 3) sig('tri', sigGuName(path, 'tri'), 5, a.slice(0, 3));
  if (a.length >= 2) pushImmortal({ id: `gu_${path}_sig_quad`, name: sigGuName(path, 'quad') },
    { type: 'sig', kinds: a.slice(0, Math.min(4, a.length)) }, path, aff);
}

// ---- GUARANTEE globally-unique display names ------------------------------------------------------
// Authored names (data/guNames.js) are written per-path and freely reuse evocative words, so the same
// string lands on different effect kinds/tiers within a path AND on like-themed paths — a raw build
// yields 200+ collisions ("Slip Gu" alone spans 9 paths). This pass walks LIST in its deterministic
// build order, lets the FIRST claim keep a name, and renames every later claimant with the least-
// intrusive qualifier still free: (1) a thematic epithet from the Gu's PATH pool, spoken in that
// path's voice ("Searing Immolate Gu", "Sanguine Bloodpoint Gu") and ROTATED per path for variety,
// then the shared xianxia overflow pool; failing that (2) a fully generic "{Path} {Effect} {tier}"
// form, then (3) a numeric suffix as a final guarantee. Names are display-only — ids and recipes
// never read them — so renaming after the build is safe.
const shortPath = (id) => { const n = pathName(id); return n.endsWith(' Path') ? n.slice(0, -5) : n; };
const tierMark = (tier) => (tier <= 5 ? (ROMAN[tier] || tier) : 'Immortal');
function genericLabel(gu) {
  const eff = gu.effects || [];
  if (eff.length > 1) return gu.tier >= 6 ? 'Sovereign' : gu.tier >= 5 ? 'Master' : 'Adept';
  const e = eff[0];
  if (e && e.kind === 'status') return (STATUS[e.status] && STATUS[e.status].label) || 'Affliction';
  return KIND_LABEL[(e && e.kind) || 'atk'] || 'Power';
}
(function ensureUniqueNames() {
  const seen = new Set();
  const epIdx = {};                                   // per-path rotation cursor into the epithet pool
  for (const g of LIST) {
    if (!seen.has(g.name)) { seen.add(g.name); continue; }   // first claim keeps the authored name
    const path = g.daoPath;
    const pool = (PATH_EPITHETS[path] || []).concat(GENERIC_EPITHETS);
    let chosen = null;
    const start = epIdx[path] || 0;                   // rotate so repeat collisions vary their epithet
    for (let i = 0; i < pool.length && !chosen; i++) {
      const c = `${pool[(start + i) % pool.length]} ${g.name}`;
      if (!seen.has(c)) { chosen = c; epIdx[path] = start + i + 1; }
    }
    if (!chosen) {                                    // pool exhausted — fall to a generic, then numeric, form
      const generic = `${shortPath(path)} ${genericLabel(g)} ${tierMark(g.tier)} Gu`;
      chosen = seen.has(generic) ? null : generic;
      for (let n = 2; !chosen; n++) { const c = `${generic} (${n})`; if (!seen.has(c)) chosen = c; }
    }
    g.name = chosen;
    seen.add(chosen);
  }
})();

export const GU_LIB = {};
for (const g of LIST) GU_LIB[g.id] = g;
export const guList = () => Object.values(GU_LIB);
export const isUnique = (gu) => !!(gu && gu.unique);

// ---- new-game starter helpers --------------------------------------------------------------------
// A curated, thematic set of tier-1 Gu to offer as a fresh cultivator's first Gu on the chosen path:
// the path's AFFINITY-kind single-effect lines plus its status lines (~5-6 per path) — not the full
// ~19 universal-kind T1 roster. Used by the new-game path → Gu picker (ui.js starterGuPicker).
export function starterGusForPath(path) {
  const aff = new Set(PATH_AFFINITY[path] || []);
  return guList().filter((g) => g.daoPath === path && g.tier === 1 && !g.unique
    && g.effects.length === 1
    && (aff.has(g.effects[0].kind) || g.effects[0].kind === 'status'));
}
// The path's marquee immortal artifact — its quad signature Gu (built for every path with affinity ≥3,
// i.e. all common paths). Shown as the "pursue this path toward…" preview on the starter path picker.
export const signatureImmortalGu = (path) => GU_LIB[`gu_${path}_sig_quad`] || null;

// The path's DISTINCTIVE immortal Gu — what actually sets the path apart: its quad-signature capstone
// plus its dao-specific STATUS-inflict immortals. (Every path also has generic immortal Gu for the
// universal stat kinds — atk/def/etc — which are NOT path-defining, so they're deliberately excluded
// here to keep the new-game preview honest.) Used by the new-game path picker.
export function signatureGusForPath(path) {
  const ids = [];
  const quad = `gu_${path}_sig_quad`; if (GU_LIB[quad]) ids.push(quad);
  for (const st of (PATH_STATUSES[path] || [])) { const id = `gu_${path}_st_${st}_imm`; if (GU_LIB[id] && !ids.includes(id)) ids.push(id); }
  return ids.map((id) => GU_LIB[id]).filter(Boolean);
}

// The status ids a path's Gu inflict on hit (e.g. ['burn']), or []. Authoritative source the generator
// itself uses to build the path's status Gu lines.
export const pathStatuses = (path) => (PATH_STATUSES[path] || []).slice();

// Resolve an OWNED inventory item ({ uid, guId, tier? }) to its effective Gu view. An ASCENDED immortal
// (instance `tier` 7-9, set by crafting.upgrade) surfaces that rank's precomputed effects/essence/bp so
// effectiveStats sees the bumped value. Non-immortal or un-ascended items return the library Gu as-is.
export function resolveOwned(item) {
  // Myriad Gu (data/myriad.js): a player-forged, multi-effect Gu whose full definition lives INLINE on the
  // inventory item (no GU_LIB entry). Surface it as a synthetic Gu so the whole engine — effectiveStats,
  // battle, equip, the sheet — treats it like any Gu. Per-instance id = the item uid; never unique.
  if (item && item.myriad) return { id: item.uid, ...item.myriad, unique: false, myriad: true };
  const gu = item && GU_LIB[item.guId]; if (!gu) return null;
  const t = item.tier;
  if (!t || t === gu.tier || !gu.byTier || !gu.byTier[t]) return gu;
  const v = gu.byTier[t];
  return { ...gu, tier: t, effects: v.effects, essence: v.essence, bp: v.bp };
}
// The craftable next tier for an owned immortal item (its instance tier + 1, capped at maxTier), or null.
export function nextTierOf(item) {
  const gu = item && GU_LIB[item.guId]; if (!gu || !gu.byTier) return null;
  const cur = item.tier || gu.tier;
  return cur < (gu.maxTier || gu.tier) ? cur + 1 : null;
}

// ---- essence channel cost ------------------------------------------------------------------------
// Base per-action essence is baked on each Gu (`gu.essence`, already budget-scaled). Effective cost
// also scales with the gap between the wielder's rank and the Gu's tier (cheaper below, costlier above).
export const guEssenceCost = (gu) => (gu ? (gu.essence || GU_ESSENCE[Math.max(1, Math.min(9, gu.tier | 0))] || 0) : 0);
export function guEssenceCostFor(gu, wielderRank) {
  const base = guEssenceCost(gu);
  if (!base) return 0;
  const d = (wielderRank || 1) - (gu.tier || 1);
  return base * (d >= 0 ? Math.pow(0.75, d) : Math.pow(1.5, -d));
}

// ---- Gu TAGS (what a Gu DOES) + short stat labels ------------------------------------------------
// A Gu's tags = each positive effect kind, plus a single generic `status` tag if it inflicts any
// status. Drawbacks (negative lines) are NOT tags. Refinement requires fodder whose tags cover the
// output Gu's tags (systems/crafting.js). Short labels below are shared by tag pills + effect summary.
const STAT_LABEL = {
  atk:'ATK', hp:'Max HP', def:'DEF', spd:'SPD', crit:'Crit', critDmg:'Crit Dmg', critRes:'Crit Resist',
  statusRes:'Status Resist', evasion:'Evasion', hit:'Hit', armorPen:'Armor Pen', lifesteal:'Lifesteal',
  regen:'Regen', thorns:'Thorns', potency:'Potency', essPool:'Aperture', essRcv:'Essence Regen',
  lucky:'Lucky Hit', status:'Status',
};
export const tagLabel = (t) => STAT_LABEL[t] || t;
export function guTags(gu) {
  const tags = new Set();
  if (gu && gu.myriad) tags.add('myriad');   // player-forged myriad Gu carry the [myriad] tag
  for (const e of (gu && gu.effects) || []) {
    if (e.kind === 'status') tags.add('status');
    else if (e.value > 0) tags.add(e.kind);
  }
  return [...tags];
}

// ---- human-readable effect summary (multi-effect, signed) ----------------------------------------
const pct = (v) => `${v >= 0 ? '+' : ''}${Math.round(v * 100)}%`;
// Concrete status rider: base inflict CHANCE + base EFFECT magnitude (DoT per-tick %, control-debuff %,
// or skip) + duration in the victim's turns — so a status Gu never shows a bare, ambiguous "(65%)".
// Magnitudes come from the Gu's own effect for DoTs (tier-scaled `dot`) and from the status registry
// for control debuffs/CC (fixed `mag`). Inflict chance is the authored per-Gu `chance`.
function statusEffectText(e) {
  const d = STATUS[e.status]; if (!d) return `inflict ${e.status}`;
  const chance = Math.round((e.chance != null ? e.chance : d.base) * 100);
  const dur = e.dur || d.dur || 1;
  const turns = `${dur} turn${dur === 1 ? '' : 's'}`;
  const m = (v) => Math.round((v || 0) * 100);
  let detail = '';
  if (d.dot === 'casterAtk')        detail = `${m(e.dot || d.mag)}% ATK/turn for ${turns}`;
  else if (d.dot === 'targetMaxHp') detail = `${m(e.dot || d.mag)}% max HP/turn for ${turns}`;
  else if (d.debuff === 'spd')      detail = `−${m(d.mag)}% SPD for ${turns}`;
  else if (d.debuff === 'atk')      detail = `−${m(d.mag)}% ATK for ${turns}`;
  else if (d.debuff === 'def')      detail = `−${m(d.mag)}% DEF for ${turns}`;
  else if (d.debuff === 'taken')    detail = `+${m(d.mag)}% dmg taken for ${turns}`;
  else if (e.status === 'frozen')   detail = `skips ${turns} (fire breaks it)`;
  else if (d.stun)                  detail = `skips ${turns}`;
  return `inflict ${d.label} ${chance}%${detail ? ` · ${detail}` : ''}`;
}
function oneEffect(e) {
  if (e.kind === 'status') return statusEffectText(e);
  if (e.kind === 'critDmg') return `${e.value >= 0 ? '+' : ''}${e.value.toFixed(2)} Crit Dmg`;
  return `${pct(e.value)} ${STAT_LABEL[e.kind] || e.kind}`;
}
export function effectText(gu) {
  if (!gu || !gu.effects) return '';
  return gu.effects.map(oneEffect).join(' · ');
}

// ---- reverse recipe index (Almanac "what is this used for") --------------------------------------
let _usedBy = null;
export function guUsingResource(resId) {
  if (!_usedBy) {
    _usedBy = {};
    const add = (g, rec, tier) => { for (const id in (rec.resources || {})) (_usedBy[id] = _usedBy[id] || []).push({ gu: g, qty: rec.resources[id], tier }); };
    for (const g of LIST) {
      add(g, g.recipe, g.tier);                                 // base craft (tier 6 for immortals)
      if (g.byTier) for (let t = 7; t <= 9; t++) if (g.byTier[t]) add(g, g.byTier[t].recipe, t); // ascension recipes → ranks 7-9
    }
    for (const id in _usedBy) _usedBy[id].sort((x, y) => x.tier - y.tier || x.gu.name.localeCompare(y.gu.name));
  }
  return _usedBy[resId] || [];
}
