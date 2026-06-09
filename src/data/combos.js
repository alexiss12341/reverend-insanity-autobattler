// KILLER MOVES — a player-authored, composable special-move skeleton (see plan/memory). A killer move
// is NOT enumerated; it is ASSEMBLED at runtime from a character's chosen CORE + SUPPORT Gu + an
// ARCHETYPE.
//
//   - CORE  = exactly 1 equipped Gu whose effect DOMAIN matches the chosen archetype's favored domain
//             (e.g. an ATK/lifesteal Gu for an OFFENSE move). Gates which archetypes are usable.
//   - SUPPORT = 2+ equipped Gu that all share the CORE's Dao path (the whole set is one path).
//   - FAVORABILITY = how PURE the same-path support is toward the favored domain (purity multiplier).
//
// The path supplies the move's name + status flavor; the archetype supplies its shape (an op list).
// Pipeline:  core+support (resolved Gu) ─▶ assemble(archetypeId, coreGu, supportGu) ─▶ spec{name,cjk,ops}
//            systems/battle.js then runs spec.ops through its generic executeKillerMove interpreter.
//
// Pure data/logic — no state, DOM-free (safe to import in headless tests). Resolving uids → Gu objects
// is the CALLER's job (battle.js/ui.js via guOf); this module works on already-resolved Gu + uids.
import { guTags } from './gu.js';
import { pathName, pathCjk } from './daoPaths.js';

// ---- tuning constants (the cadence/power knobs) --------------------------------------------------
// comboCost = KILLER_COST_MULT × Σ guEssenceCostFor(core + support) — the move costs a few turns' worth
// of channelling its own set (computed at combatant attach in battle.js, NOT here).
export const KILLER_COST_MULT = 3;
// A killer move can fire at most once every KILLER_COOLDOWN of the unit's OWN actions (fixed, uniform).
export const KILLER_COOLDOWN = 3;
// PROGRESSION GATE: killer moves unlock only after the player has cleared this floor, and only on
// cultivators of at least this (1-based) rank. Enforced authoritatively in battle.js attachKiller
// (allies: both checks) and data/floors.js enemyUnit (enemies: rank only). UI mirrors it in ui.js.
export const KILLER_UNLOCK_FLOOR = 100; // must have cleared Floor 100 (player-progression unlock)
export const KILLER_MIN_RANK = 3;       // rank 3+ cultivators only (applies to allies AND enemies)

const round2 = (v) => Math.round(v * 100) / 100;
// Per-target damage multiplier by delivery shape — the headline balance lever: AoE is FAR below
// single-target per hit (its only balancing; cost is uniform across delivery).
const DELIVERY_MULT = { single: 3.0, lane: 1.3, reach: 1.0, all: 0.7 };
// More set Gu rewards commitment; deeper-tier sets hit harder.
const depthFactor = (count) => (count >= 5 ? 1.45 : count >= 4 ? 1.2 : 1.0);
const tierFactor = (tierAvg) => 1 + 0.06 * Math.max(0, (tierAvg || 1) - 1);

// ---- KILLER-MOVE effect DOMAINS (DECOUPLED from gu.js TAG_SLOT, which drives crafting) ------------
// 5 domains; a Gu effect kind → its domain. NOTE the deliberate differences from crafting's TAG_SLOT:
// lifesteal lives in OFFENSE here, and essPool/essRcv live in VIGOR (life + essence reserves) — not mystic.
export const KM_TAG_DOMAIN = {
  atk: 'offense', crit: 'offense', critDmg: 'offense', hit: 'offense', armorPen: 'offense', lifesteal: 'offense',
  def: 'guard', critRes: 'guard', statusRes: 'guard', thorns: 'guard',
  spd: 'motion', evasion: 'motion',
  hp: 'vigor', regen: 'vigor', essPool: 'vigor', essRcv: 'vigor',
  potency: 'mystic', status: 'mystic', lucky: 'mystic',
};
export const EFFECT_DOMAINS = ['offense', 'guard', 'motion', 'mystic', 'vigor'];
export const domainOfKind = (kind) => KM_TAG_DOMAIN[kind] || null;
// The domain bucket of an effect line (status lines map via the 'status' key).
const lineDomain = (e) => KM_TAG_DOMAIN[e.kind === 'status' ? 'status' : e.kind];
// Whether a Gu carries ≥1 POSITIVE effect in `domain` (multi-effect Gu can satisfy several domains).
export function guInDomain(gu, domain) {
  for (const e of (gu && gu.effects) || []) {
    if ((e.kind === 'status' || (e.value || 0) > 0) && lineDomain(e) === domain) return true;
  }
  return false;
}
// All domains a Gu's positive effects belong to.
export function guDomains(gu) {
  const s = new Set();
  for (const e of (gu && gu.effects) || []) {
    if (e.kind === 'status' || (e.value || 0) > 0) { const d = lineDomain(e); if (d) s.add(d); }
  }
  return [...s];
}

// ---- validation ---------------------------------------------------------------------------------
// A killer config { core (uid), support ([uids]), archetype (id) } is valid iff: archetype exists; the
// core Gu is equipped AND of the archetype's favored DOMAIN; there are ≥2 support Gu, all equipped, all
// the SAME Dao path as the core, and the core is not also a support. `guResolve(uid)` → the Gu object.
export function validateKiller(cfg, equippedUids, guResolve) {
  if (!cfg || !cfg.archetype || !ARCHETYPES[cfg.archetype]) return false;
  if (!cfg.core || !Array.isArray(cfg.support) || cfg.support.length < 2) return false;
  const eq = new Set(equippedUids || []);
  if (!eq.has(cfg.core) || cfg.support.includes(cfg.core)) return false;
  if (!cfg.support.every((u) => eq.has(u))) return false;
  const core = guResolve(cfg.core); if (!core) return false;
  if (!guInDomain(core, ARCHETYPES[cfg.archetype].domain)) return false;
  const support = cfg.support.map(guResolve);
  if (support.some((g) => !g)) return false;
  return support.every((g) => g.daoPath === core.daoPath);
}

// ---- set profile --------------------------------------------------------------------------------
// Summarize a resolved CORE Gu + SUPPORT Gu (assumed valid: same path, ≥2 support) for `assemble`.
// `favoredDomain` (the archetype's) drives `favoredSupport` = # support Gu that are ALSO that domain.
export function profileKiller(coreGu, supportGu, favoredDomain) {
  if (!coreGu) return null;
  const support = (supportGu || []).filter(Boolean);
  const set = [coreGu, ...support];
  let tierSum = 0, tierMax = 0; const statuses = [];
  for (const g of set) {
    tierSum += g.tier || 1; tierMax = Math.max(tierMax, g.tier || 1);
    for (const e of (g.effects || [])) if (e.kind === 'status') statuses.push({ type: e.status, base: e.chance, dur: e.dur, mag: e.dot });
  }
  const favoredSupport = support.filter((g) => guInDomain(g, favoredDomain)).length;
  return { path: coreGu.daoPath, count: set.length, tierAvg: tierSum / set.length, tierMax, statuses,
    favoredSupport, supportCount: support.length };
}

// FAVORABILITY = purity of the (same-path) support toward the favored domain. All favored-domain support
// → 1.0; none → the 0.6 floor. (Path-resonance still amplifies the underlying Gu damage via effAtk.)
const SUIT_FLOOR = 0.6;
const favorabilityOf = (profile) =>
  Math.max(SUIT_FLOOR, Math.min(1, SUIT_FLOOR + (1 - SUIT_FLOOR) * (profile.supportCount ? profile.favoredSupport / profile.supportCount : 0)));

// ---- archetype catalog --------------------------------------------------------------------------
// Each archetype: favored `domain` (= the required CORE Gu domain), `delivery` shape, display `name` +
// CJK `glyph`, and a `build(p, m)` that emits the op list. `m` = { dmg: per-target damage mult, scale:
// depth×tier×favorability (for heal/buff/shield/essence), count }.
//   ops: { op, sel, ... }  selectors: self|target|lane|reach|allFoes|team|lowestAlly
//   op kinds: damage(mult,hits,exec,perStatus) · status(from:'set',stacks) · heal(pct,of) · cleanse(max)
//             · buff(stat:atk/def/spd/thorns/evasion,amount,dur) · shield(pct) · taunt(dur) · essence(pct ±)
const setStatus = (p, sel, extra = {}) => (p.statuses.length ? [{ op: 'status', sel, from: 'set', forced: true, ...extra }] : []);

export const ARCHETYPES = {
  // ===== OFFENSE — burst, AoE & lifesteal (core: atk/crit/critDmg/hit/armorPen/lifesteal) =====
  onslaught:    { domain: 'offense', delivery: 'single', name: 'Onslaught', glyph: '斬',
    build: (p, m) => [{ op: 'damage', sel: 'target', mult: m.dmg, crit: true }, ...setStatus(p, 'target')] },
  cataclysm:    { domain: 'offense', delivery: 'reach', name: 'Cataclysm', glyph: '災',
    build: (p, m) => [{ op: 'damage', sel: 'reach', mult: m.dmg }, ...setStatus(p, 'reach')] },
  annihilation: { domain: 'offense', delivery: 'all', name: 'Annihilation', glyph: '滅',
    build: (p, m) => [{ op: 'damage', sel: 'allFoes', mult: m.dmg }] },
  barrage:      { domain: 'offense', delivery: 'lane', name: 'Barrage', glyph: '亂',
    build: (p, m) => [{ op: 'damage', sel: 'lane', mult: m.dmg, hits: 3 }] },
  execution:    { domain: 'offense', delivery: 'single', name: 'Execution', glyph: '誅',
    build: (p, m) => [{ op: 'damage', sel: 'target', mult: m.dmg, exec: 0.5 }] },
  bloodrush:    { domain: 'offense', delivery: 'single', name: 'Bloodrush', glyph: '血',
    build: (p, m) => [{ op: 'damage', sel: 'target', mult: m.dmg }, { op: 'heal', sel: 'self', pct: 0.6, of: 'dmg' }] },
  whirlwind:    { domain: 'offense', delivery: 'reach', name: 'Whirlwind', glyph: '旋',
    build: (p, m) => [{ op: 'damage', sel: 'reach', mult: m.dmg }, { op: 'heal', sel: 'self', pct: 0.4, of: 'dmg' }] },
  warcry:       { domain: 'offense', delivery: 'team', name: 'Warcry', glyph: '吼',
    build: (p, m) => [{ op: 'buff', sel: 'team', stat: 'atk', amount: round2(0.20 * m.scale), dur: 3 }] },
  // ===== MYSTIC — affliction & disruption (core: potency/status/lucky) =====
  hexweave:     { domain: 'mystic', delivery: 'reach', name: 'Hexweave', glyph: '蠱',
    build: (p, m) => [...setStatus(p, 'reach'), { op: 'damage', sel: 'reach', mult: m.dmg * 0.5 }] },
  contagion:    { domain: 'mystic', delivery: 'all', name: 'Contagion', glyph: '瘟',
    build: (p, m) => [...setStatus(p, 'allFoes', { stacks: 2 }), { op: 'damage', sel: 'allFoes', mult: m.dmg * 0.4 }] },
  soulrend:     { domain: 'mystic', delivery: 'single', name: 'Soulrend', glyph: '魂',
    build: (p, m) => [...setStatus(p, 'target', { stacks: 2 }), { op: 'damage', sel: 'target', mult: m.dmg }] },
  anathema:     { domain: 'mystic', delivery: 'single', name: 'Anathema', glyph: '詛',
    build: (p, m) => [...setStatus(p, 'target'), { op: 'damage', sel: 'target', mult: m.dmg, perStatus: 0.5 }] },
  enervate:     { domain: 'mystic', delivery: 'reach', name: 'Enervate', glyph: '枯', // saps foes' essence (no Gu channel / no killers)
    build: (p, m) => [{ op: 'essence', sel: 'reach', pct: -0.5 }, ...setStatus(p, 'reach')] },
  // ===== GUARD — protection (core: def/critRes/statusRes/thorns) =====
  aegis:        { domain: 'guard', delivery: 'self', name: 'Aegis', glyph: '盾',
    build: (p, m) => [{ op: 'shield', sel: 'self', pct: round2(0.25 * m.scale) },
      { op: 'buff', sel: 'self', stat: 'def', amount: round2(0.30 * m.scale), dur: 3 },
      { op: 'damage', sel: 'target', mult: m.dmg * 0.5 }] },
  bulwark:      { domain: 'guard', delivery: 'team', name: 'Bulwark', glyph: '壁',
    build: (p, m) => [{ op: 'buff', sel: 'team', stat: 'def', amount: round2(0.20 * m.scale), dur: 3 },
      { op: 'buff', sel: 'team', stat: 'thorns', amount: round2(0.15 * m.scale), dur: 3 }] },
  sentinel:     { domain: 'guard', delivery: 'self', name: 'Sentinel', glyph: '衛',
    build: (p, m) => [{ op: 'taunt', sel: 'self', dur: 3 }, { op: 'shield', sel: 'self', pct: round2(0.35 * m.scale) }] },
  bastion:      { domain: 'guard', delivery: 'team', name: 'Bastion', glyph: '堡',
    build: (p, m) => [{ op: 'shield', sel: 'team', pct: round2(0.20 * m.scale) },
      { op: 'buff', sel: 'team', stat: 'def', amount: round2(0.12 * m.scale), dur: 3 }] },
  reprisal:     { domain: 'guard', delivery: 'self', name: 'Reprisal', glyph: '報',
    build: (p, m) => [{ op: 'buff', sel: 'self', stat: 'thorns', amount: round2(0.50 * m.scale), dur: 3 },
      { op: 'taunt', sel: 'self', dur: 3 }, { op: 'damage', sel: 'target', mult: m.dmg * 0.5 }] },
  // ===== MOTION — tempo & evasion (core: spd/evasion) =====
  tempest:      { domain: 'motion', delivery: 'self', name: 'Tempest', glyph: '颶',
    build: (p, m) => [{ op: 'buff', sel: 'self', stat: 'spd', amount: round2(0.40 * m.scale), dur: 3 }] },
  cadence:      { domain: 'motion', delivery: 'team', name: 'Cadence', glyph: '律',
    build: (p, m) => [{ op: 'buff', sel: 'team', stat: 'spd', amount: round2(0.20 * m.scale), dur: 3 }] },
  ascendance:   { domain: 'motion', delivery: 'team', name: 'Ascendance', glyph: '升', // ATK+SPD split ≈ one single-stat buff
    build: (p, m) => [{ op: 'buff', sel: 'team', stat: 'atk', amount: round2(0.10 * m.scale), dur: 3 },
      { op: 'buff', sel: 'team', stat: 'spd', amount: round2(0.10 * m.scale), dur: 3 }] },
  flurry:       { domain: 'motion', delivery: 'lane', name: 'Flurry', glyph: '疾',
    build: (p, m) => [{ op: 'damage', sel: 'lane', mult: round2(m.dmg * 0.45), hits: 4 }, { op: 'buff', sel: 'self', stat: 'spd', amount: round2(0.20 * m.scale), dur: 2 }] },
  blur:         { domain: 'motion', delivery: 'self', name: 'Blur', glyph: '影',
    build: (p, m) => [{ op: 'buff', sel: 'self', stat: 'spd', amount: round2(0.30 * m.scale), dur: 3 }, { op: 'buff', sel: 'self', stat: 'evasion', amount: round2(0.25 * m.scale), dur: 3 }] },
  // ===== VIGOR — life & essence reserves (core: hp/regen/essPool/essRcv) =====
  renewal:      { domain: 'vigor', delivery: 'team', name: 'Renewal', glyph: '癒',
    build: (p, m) => [{ op: 'heal', sel: 'team', pct: round2(0.25 * m.scale), of: 'max' }, { op: 'cleanse', sel: 'team', max: 2 }] },
  sanctuary:    { domain: 'vigor', delivery: 'self', name: 'Sanctuary', glyph: '聖',
    build: (p, m) => [{ op: 'heal', sel: 'lowestAlly', pct: round2(0.60 * m.scale), of: 'max' }, { op: 'cleanse', sel: 'lowestAlly', max: 3 }] },
  lifesurge:    { domain: 'vigor', delivery: 'self', name: 'Lifesurge', glyph: '盈',
    build: (p, m) => [{ op: 'heal', sel: 'self', pct: round2(0.60 * m.scale), of: 'max' }, { op: 'buff', sel: 'self', stat: 'def', amount: round2(0.20 * m.scale), dur: 3 }] },
  wellspring:   { domain: 'vigor', delivery: 'team', name: 'Wellspring', glyph: '泉', // refuels allies' channeling/killer essence
    build: (p, m) => [{ op: 'essence', sel: 'team', pct: round2(0.30 * m.scale) }, { op: 'heal', sel: 'team', pct: round2(0.12 * m.scale), of: 'max' }] },
};
// Stable display order for the chooser, grouped by favored domain.
export const ARCHETYPE_ORDER = [
  'onslaught', 'cataclysm', 'annihilation', 'barrage', 'execution', 'bloodrush', 'whirlwind', 'warcry',
  'hexweave', 'contagion', 'soulrend', 'anathema', 'enervate',
  'aegis', 'bulwark', 'sentinel', 'bastion', 'reprisal',
  'tempest', 'cadence', 'ascendance', 'flurry', 'blur',
  'renewal', 'sanctuary', 'lifesurge', 'wellspring',
];

export const archetypeName = (id) => (ARCHETYPES[id] ? ARCHETYPES[id].name : null);
export const archetypeDomain = (id) => (ARCHETYPES[id] ? ARCHETYPES[id].domain : null);

// One-line plain-language description of what each archetype DOES (shown under its name in the picker).
const ARCHETYPE_BLURB = {
  onslaught:    'Single-target burst + the core’s status.',
  cataclysm:    'AoE damage + the core’s status to all foes in reach.',
  annihilation: 'Lighter damage to the entire enemy board.',
  barrage:      'Rapid ×3 multi-hit down the target’s column.',
  execution:    'Single-target nuke; bonus damage vs low-HP foes.',
  bloodrush:    'Single hit that heals you for part of the damage.',
  whirlwind:    'AoE hit that heals you for each foe struck.',
  warcry:       'Buffs the whole team’s ATK for a few turns.',
  hexweave:     'Applies the core’s statuses to all in reach + light damage.',
  contagion:    'Spreads the core’s DoTs board-wide at double stacks.',
  soulrend:     'Single-target: heavy damage + the core’s statuses ×2.',
  anathema:     'Single-target nuke that scales with the target’s debuffs.',
  enervate:     'Drains foes’ essence (chokes their Gu & killer moves) + status.',
  aegis:        'Shields you, buffs your DEF, and counter-strikes.',
  bulwark:      'Buffs the whole team’s DEF + thorns.',
  sentinel:     'Taunts foes onto you and shields yourself.',
  bastion:      'Shields the whole team + buffs their DEF.',
  reprisal:     'Heavy thorns + taunt — punishes attackers.',
  tempest:      'Surges your own SPD for a few turns.',
  cadence:      'Hastens the whole team’s SPD.',
  ascendance:   'Buffs the whole team’s ATK + SPD (split).',
  flurry:       'Fast ×4 flurry down a column + a self-haste.',
  blur:         'Self SPD + evasion — act often and slip blows.',
  renewal:      'Heals the whole team + cleanses debuffs.',
  sanctuary:    'Big heal to your most-hurt ally + cleanse.',
  lifesurge:    'Big self-heal + a DEF buff.',
  wellspring:   'Refuels the team’s essence + a small team heal.',
};
export const archetypeBlurb = (id) => ARCHETYPE_BLURB[id] || '';
// Domain header info for the picker: label + the core-Gu kinds that domain accepts.
export const DOMAIN_INFO = {
  offense: { label: 'Offense', cores: 'ATK · Crit · Armor-Pen · Lifesteal' },
  mystic:  { label: 'Mystic',  cores: 'Potency · Status · Luck' },
  guard:   { label: 'Guard',   cores: 'DEF · Resist · Thorns' },
  motion:  { label: 'Motion',  cores: 'SPD · Evasion' },
  vigor:   { label: 'Vigor',   cores: 'HP · Regen · Essence pool/regen' },
};
const DELIVERY_LABEL = { single: 'single-target', all: 'whole-board AoE', reach: 'AoE', lane: 'column', team: 'team', self: 'self' };
export const archetypeRole = (id) => {
  const A = ARCHETYPES[id]; if (!A) return '';
  return `${A.domain} · ${DELIVERY_LABEL[A.delivery] || A.delivery}`;
};
// A default archetype favouring a domain (used by autoConfigure / enemies). Damage-leaning where it can.
const DOMAIN_DEFAULT = { offense: 'onslaught', mystic: 'hexweave', motion: 'flurry', guard: 'bulwark', vigor: 'renewal' };
export const archetypeForDomain = (domain) => DOMAIN_DEFAULT[domain] || 'onslaught';

// Display name for an assembled move: path flavor + archetype, e.g. "Fire Onslaught".
const moveName = (id, path) => `${pathName(path).replace(/ Path$/, '')} ${archetypeName(id) || ''}`.trim();

// ---- assemble -----------------------------------------------------------------------------------
// Turn a chosen archetype + core/support Gu into a concrete move spec. `comboCost` is NOT included —
// the engine derives it from the set's essence cost at attach time (see battle.js).
export function assemble(archetypeId, coreGu, supportGu) {
  const A = ARCHETYPES[archetypeId];
  if (!A || !coreGu) return null;
  const profile = profileKiller(coreGu, supportGu, A.domain);
  if (!profile) return null;
  const favorability = favorabilityOf(profile);
  const scale = depthFactor(profile.count) * tierFactor(profile.tierAvg) * favorability;
  const dmg = (DELIVERY_MULT[A.delivery] || 1) * scale;
  const ops = A.build(profile, { dmg, scale, count: profile.count });
  return {
    id: archetypeId, name: moveName(archetypeId, profile.path), cjk: `${pathCjk(profile.path)}${A.glyph || ''}`,
    domain: A.domain, delivery: A.delivery, favorability: round2(favorability), ops,
    statuses: profile.statuses, // the set's status riders — applied by the move's `status` ops (from:'set')
  };
}

// ---- auto-configure (enemies + player "Suggest") ------------------------------------------------
// `items` = [{ uid, gu }] (gu = resolved Gu object). Pick the largest ≥3 same-path group; choose a CORE
// Gu in that group of a present domain (prefer offense → mystic → motion → guard → vigor), its matching
// archetype, and the rest of the group as support. Returns { core, coreGu, support, supportGu, archetype }.
const DOMAIN_PREF = ['offense', 'mystic', 'motion', 'guard', 'vigor'];
export function autoConfigure(items) {
  const byPath = {};
  for (const it of (items || [])) { const p = it && it.gu && it.gu.daoPath; if (!p) continue; (byPath[p] = byPath[p] || []).push(it); }
  let best = null;
  for (const p in byPath) if (byPath[p].length >= 3 && (!best || byPath[p].length > best.length)) best = byPath[p];
  if (!best) return null;
  let coreItem = null, domain = null;
  for (const d of DOMAIN_PREF) { const c = best.find((it) => guInDomain(it.gu, d)); if (c) { coreItem = c; domain = d; break; } }
  if (!coreItem) { coreItem = best[0]; domain = guDomains(coreItem.gu)[0] || 'offense'; }
  const support = best.filter((it) => it !== coreItem);
  if (support.length < 2) return null;
  return { core: coreItem.uid, coreGu: coreItem.gu, support: support.map((it) => it.uid), supportGu: support.map((it) => it.gu), archetype: archetypeForDomain(domain) };
}

// Hint for the character sheet: how many MORE same-path Gu a loadout needs to form a 3-Gu set, for the
// closest-to-3 path. `items` = [{ uid, gu }]. Returns { path, have, need } or null (a 3-set already exists).
export function nearestCore(items) {
  const byPath = {};
  for (const it of (items || [])) { const p = it && it.gu && it.gu.daoPath; if (!p) continue; byPath[p] = (byPath[p] || 0) + 1; }
  let bestPath = null, bestHave = 0;
  for (const p in byPath) { if (byPath[p] >= 3) return null; if (byPath[p] > bestHave) { bestHave = byPath[p]; bestPath = p; } }
  return bestPath ? { path: bestPath, have: bestHave, need: 3 - bestHave } : null;
}

// ---- display helpers (UI preview + codex) -------------------------------------------------------
const SEL_LABEL = { self: 'self', team: 'whole team', lowestAlly: 'lowest ally', target: 'one foe',
  lane: 'a column', reach: 'foes in reach', allFoes: 'all foes' };
// Human-readable one-liners for an assembled spec's ops.
export function describeOps(spec) {
  if (!spec || !spec.ops) return [];
  const where = (s) => SEL_LABEL[s] || s;
  return spec.ops.map((op) => {
    if (op.op === 'damage') return `${op.hits > 1 ? `${op.hits}× ` : ''}strike ${where(op.sel)} for ${Math.round(op.mult * 100)}% ATK${op.exec ? ' (+execute)' : ''}${op.perStatus ? ' (+per debuff)' : ''}`;
    if (op.op === 'status') return `afflict ${where(op.sel)} with the core's status${op.stacks ? ` ×${op.stacks}` : ''}`;
    if (op.op === 'heal') return `heal ${where(op.sel)} ${Math.round(op.pct * 100)}% ${op.of === 'dmg' ? 'of damage dealt' : 'max HP'}`;
    if (op.op === 'cleanse') return `cleanse ${where(op.sel)} (up to ${op.max})`;
    if (op.op === 'buff') return `+${Math.round(op.amount * 100)}% ${(op.stat || '').toUpperCase()} to ${where(op.sel)} (${op.dur} turns)`;
    if (op.op === 'shield') return `shield ${where(op.sel)} for ${Math.round(op.pct * 100)}% of max HP`;
    if (op.op === 'taunt') return `taunt foes (${op.dur} turns)`;
    if (op.op === 'essence') return `${op.pct >= 0 ? 'restore' : 'drain'} ${Math.round(Math.abs(op.pct) * 100)}% essence ${op.pct >= 0 ? 'to ' + where(op.sel) : 'from ' + where(op.sel)}`;
    return op.op;
  });
}
// Synergy label from a favorability factor (1.0 = support fully matches the favored domain).
export const synergyLabel = (s) => (s >= 0.95 ? 'High' : s >= 0.78 ? 'Medium' : 'Low');

// re-export for callers that want the tag list without importing gu.js directly
export { guTags };
