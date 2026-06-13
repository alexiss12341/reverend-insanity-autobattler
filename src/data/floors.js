// Floor & encounter generation.
//
// The tower is 9 cultivation realms × 50 floors = a 450-floor climb. Every enemy on a floor is of
// that band's REALM (floors 1-50 = rank 1, 51-100 = rank 2, … 401-450 = rank 9). Difficulty ramps
// gently within a realm and jumps hard at each realm boundary (especially the mortal→immortal wall
// at floor 251). This spreads encounters — and the path-specific resource drops — across the tower.
//
// Brief rules:
//  - Player team max 6; each enemy team (wave) max 6.
//  - MOST encounters start with a single enemy; team size grows slowly with depth.
//  - WAVE encounters are RARE: several enemy teams replacing one another (each wave <= 6).
//  - A floor is cleared when every enemy of the encounter (all waves) is defeated.
//  - BOSS encounters on every 10th floor (10, 20, … 450).
//
// Composition is deterministic per floor (seeded by floor number); battle outcomes still vary.
import { resourcesForFloor } from './resources.js';
import { guList, guEssenceCostFor, effectText } from './gu.js';
import { commOf } from './daoPaths.js';
import { deriveStats, roleAttrs, poolAtIndex, realmPointsTotal, apertureCapacity, apertureRegenFactor, aptitudePointBonus, rarityBonus, baseAttr } from './attributes.js';
import { statusForPath, STATUS, statusDuration } from './status.js';
import { essenceQualityByRank, guSlots } from './realms.js';
import { NPC_TEMPLATES, RARITY_ORDER } from './rarities.js';
import { LINES, AFFINITY_EFFECT_MULT } from './traits.js';
import { autoConfigure, assemble, guInDomain, archetypeDomain, KILLER_COST_MULT, KILLER_COOLDOWN, KILLER_MIN_RANK } from './combos.js';

const MOBS = ['Bog Toad', 'Stone Lizard', 'Vicious Wolf Gu', 'Bone Sparrow', 'Venom Centipede',
  'Moonbug Swarm', 'Iron Skin Boar', 'Specter Moth', 'Blood Bat', 'Clay Sentinel'];
// Enemy CULTIVATORS (humanoid Gu users) share the realm with spirit beasts. Each has a role; in
// addition they wield a Gu loadout + gear themed to the floor (see enemyGuLoadout).
const CULTIVATORS = {
  'Rogue Gu Master': 'bruiser', 'Wandering Cultivator': 'bruiser', 'Sect Disciple': 'bruiser',
  'Body Refiner': 'tank', 'Stone Monk': 'tank',
  'Blade Disciple': 'striker', 'Blood Demon': 'striker', 'Venom Adept': 'striker',
  'Phantom Assassin': 'skirmisher', 'Wind Walker': 'skirmisher',
};
const CULT_NAMES = Object.keys(CULTIVATORS);
const BOSSES = ['Gu Hunter Captain', 'Demonic Cultivator', 'Rank 3 Beast King', 'Clan Elder',
  'Heretic Immortal Shade', 'Soul-Devouring Serpent', "Fallen Venerable's Echo"];

// Mob ROLES: a `front` placement preference (higher = wants the front line). Tanks soak, bruisers are
// balanced, skirmishers are fast/evasive, strikers are glass cannons that want the protected back row.
// (Stat profiles now live as attribute spreads in data/attributes.js `ROLE_WEIGHTS`.)
const ROLES = {
  tank:       { front: 3 },
  bruiser:    { front: 1 },
  skirmisher: { front: -1 },
  striker:    { front: -3 },
};
const MOB_ROLE = {
  'Stone Lizard': 'tank', 'Iron Skin Boar': 'tank', 'Clay Sentinel': 'tank',
  'Bog Toad': 'bruiser', 'Vicious Wolf Gu': 'bruiser',
  'Bone Sparrow': 'skirmisher', 'Moonbug Swarm': 'skirmisher', 'Specter Moth': 'skirmisher',
  'Blood Bat': 'striker', 'Venom Centipede': 'striker',
};
const roleOf = (name) => { const n = name.replace(/^Elite /, ''); return MOB_ROLE[n] || CULTIVATORS[n] || 'bruiser'; };

// The Dao paths whose resources drop on this floor, dominant first — used to theme cultivator Gu so
// a (say) Blood-resource floor fields Blood-path cultivators. Falls back to generic combat paths.
function floorThemePaths(floor) {
  const c = {};
  for (const r of resourcesForFloor(floor)) if (r.daoPath) c[r.daoPath] = (c[r.daoPath] || 0) + 1;
  const sorted = Object.keys(c).sort((a, b) => c[b] - c[a]);
  return sorted.length ? sorted : THEME_PATHS;
}
// Same-path resonance ladder for ENEMIES — mirrors systems/dao.js resonanceMult (replicated here to keep
// the data layer free of a systems import): 2→1.05 · 3→1.10 · 4→1.15 · 5→1.20 · 6+→1.25 · else 1.
const enemyResonance = (n) => (n >= 6 ? 1.25 : n >= 2 ? 1 + 0.05 * (n - 1) : 1);

// The signature core KIND each killer DOMAIN wants in a loadout — the role's defining stat, so the
// forced core reads as that role (a tank cores DEF, a striker ATK, …). For mystic, prefer an actual
// STATUS Gu so the move's status ops land; falls back to any in-domain Gu (e.g. potency). See
// enemyGuLoadout's coreDomain arg + lineKillerConfig.
const DOMAIN_CORE_KIND = { offense: 'atk', guard: 'def', motion: 'spd', vigor: 'hp', mystic: 'status' };

// An enemy's Gu loadout: `count` Gu of ONE unlocked theme path (tier ~ realm) — a SAME-PATH, RESONANCE-
// enabled kit (like a player who stacks one Dao), so foes are properly synergized, not a scattered grab-bag.
// Paths are commonality-gated (floors 1-50 common only, uncommon at 51, rare 101, esoteric 201), and the
// loadout repeats the path's Gu to fill every slot so the resonance bonus is real. When `coreDomain` is
// given (a killer-capable line wants its move to match its role), the loadout is guaranteed to field one
// Gu of that domain — always possible since every path stocks a Gu for every universal kind.
function enemyGuLoadout(floor, rank, rng, count, coreDomain, forcePath, sustain) {
  const allowedPath = (p) => commOf(p).floorReq <= floor;       // only paths this floor has unlocked
  const cap = Math.max(1, Math.min(5, rank + 1));
  const lo = Math.max(1, cap - 2);
  const guOfPath = (p) => guList().filter((g) => g.daoPath === p && g.tier <= cap && g.tier >= lo);
  let candidates = floorThemePaths(floor).filter(allowedPath);
  if (forcePath && allowedPath(forcePath)) candidates = [forcePath]; // bounty: theme the WHOLE kit to one path
  if (!candidates.length) candidates = THEME_PATHS.filter(allowedPath);
  let pool = [];
  for (let t = 0; t < Math.max(1, candidates.length); t++) {    // pick ONE path that has tier-fit Gu
    const p = candidates[Math.floor(rng() * candidates.length)] || candidates[0];
    const gp = guOfPath(p);
    if (gp.length) { pool = gp; break; }
  }
  if (!pool.length) pool = guList().filter((g) => allowedPath(g.daoPath) && g.tier <= Math.max(2, cap)); // last resort
  const out = [], avail = [...pool];
  for (let i = 0; i < count; i++) {
    if (!avail.length) { if (!pool.length) break; avail.push(...pool); } // repeat to fill slots (stays same-path)
    out.push(avail.splice(Math.floor(rng() * avail.length), 1)[0]);
  }
  // COHERENCE: guarantee a CORE Gu of the line's favored domain so the mob's killer move can match its
  // archetype. Prefer the domain's signature kind (a real status Gu for mystic); else any in-domain Gu.
  if (coreDomain && out.length && !out.some((g) => guInDomain(g, coreDomain))) {
    const want = DOMAIN_CORE_KIND[coreDomain];
    const core = pool.find((g) => (g.effects || []).some((e) => e.kind === want)) || pool.find((g) => guInDomain(g, coreDomain));
    if (core) out[0] = core; // replace one slot — stays same-path (drawn from the same pool)
  }
  // LONE-BOSS SUSTAIN: a solo raid target must outlast a full team's focus fire — guarantee a self-heal
  // Gu (lifesteal preferred, else regen) of the SAME path (resonance intact), replacing a non-core slot.
  if (sustain && out.length) {
    const has = out.some((g) => (g.effects || []).some((e) => (e.kind === 'lifesteal' || e.kind === 'regen') && (e.value || 0) > 0));
    if (!has) {
      const s = pool.find((g) => (g.effects || []).some((e) => e.kind === 'lifesteal' && (e.value || 0) > 0))
        || pool.find((g) => (g.effects || []).some((e) => e.kind === 'regen' && (e.value || 0) > 0));
      if (s) out[out.length - 1] = s; // last slot — slot 0 is reserved for the domain core
    }
  }
  return out;
}
// Spawn one enemy: ~half spirit beast, ~half cultivator (deterministic via the floor's rng).
// Floors 1-3 are beasts only — a gentle, effect-free introduction before cultivators appear.
function spawn(floor, idx, rng, opts = {}) {
  if (floor >= 4 && rng() < 0.5) return enemyUnit(floor, CULT_NAMES[Math.floor(rng() * CULT_NAMES.length)], { ...opts, kind: 'cultivator', rng });
  return enemyUnit(floor, MOBS[(floor + idx) % MOBS.length], { ...opts, kind: 'beast', rng });
}

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const FLOORS_PER_REALM = 50;
export const MAX_FLOORS = 450;
export const isBossFloor = (floor) => floor % 10 === 0;
// Realm/rank (1..9) of a floor's enemies.
export const floorRealm = (floor) => Math.max(1, Math.min(9, Math.ceil(floor / FLOORS_PER_REALM)));
// The DISCRETE REALM INDEX (0..23) a floor's enemies sit at — the sub-stage STEPS up across a mortal
// rank's 50-floor band in four quarters: Initial → Middle → Upper → Peak. So a foe is a genuine
// "Rank 1 Middle" / "Rank 1 Peak", and the band's last floor (the realm gate, e.g. 50) is always Peak.
// Immortal ranks (6-9) have no sub-stages — one realm index per rank.
function floorRealmIndex(floor) {
  const rank = floorRealm(floor);
  if (rank > 5) return Math.min(23, 20 + (rank - 6));                     // immortal: no sub-stages
  const within = ((floor - 1) % FLOORS_PER_REALM) / FLOORS_PER_REALM;     // 0 .. ~1 across the band
  const stage = Math.min(3, Math.floor(within * 4));                      // 0..3 = Initial/Middle/Upper/Peak
  return (rank - 1) * 4 + stage;
}
// PARITY BASELINE: an enemy's attribute-point pool is built exactly like a player's of its realm + rarity
// — the real total a player earns from rank 1 to that realm (realm points + its rarity's bonus pool + its
// aptitude overflow). The per-attribute rarity FLOOR (baseAttr) is added on top in enemyUnit, and the SAME
// deriveStats turns attributes into stats. This baseline = a bare equivalent cultivator (the DIFF=1.0 / gate
// reference).
function enemyPool(realmIdx, rarity, apt) {
  return poolAtIndex(realmIdx) + rarityBonus(rarity) + aptitudePointBonus(realmIdx, apt);
}
// DIFFICULTY MULTIPLIER layered on top of the parity baseline — scales the INVESTED pool only (never the
// rarity floor, which stays the player-equal pre-investment baseline). A within-band SAWTOOTH: DIFF_START
// right after a rank-up (a gentle respite, enemies under-invested vs a player) ramping to DIFF_END at the
// band's gate (enemies out-stat an equal player), applied UNIFORMLY to every rank so mortal and immortal
// bands share one curve. Bosses field BOSS_POOL_MULT × on top. The player's Gu + same-path resonance are
// the margin that breaks each gate. These are the knobs that move the whole difficulty curve.
const DIFF_START = 0.5;    // invested-pool factor at a band's FIRST floor (gentle post-rank-up on-ramp)
const DIFF_END   = 2.0;    // …and at the band's GATE boss (enemies ~2× an equal player's invested pool)
const BOSS_POOL_MULT = 1.35; // a boss fields this × the floor's invested pool on top of the ramp
// Mirror of battle.js ESS_REGEN_SCALE (essence regenerated per unit of gauge-time) — used to size a foe's
// aperture so it sustains its loadout channel + killer cadence without self-starving (see enemyUnit).
const ESS_REGEN_SCALE = 0.16;
function difficultyMult(floor) {
  const within = ((floor - 1) % FLOORS_PER_REALM) / FLOORS_PER_REALM;     // 0 .. ~1 across the band
  return DIFF_START + (DIFF_END - DIFF_START) * within;
}

// Themed combat effects, gated by realm depth so realm-1 mobs stay simple. Bosses always bite.
function enemyEffects(floor, name, boss, maxHp) {
  const rank = floorRealm(floor);
  const fx = {};
  if (boss) {
    fx.crit = Math.min(0.4, 0.1 + rank * 0.03);
    fx.lifesteal = Math.min(0.45, 0.12 + rank * 0.02);
    if (rank >= 3) fx.regen = Math.round(maxHp * 0.015);
    if (rank >= 5) fx.thorns = 0.12;
    return fx;
  }
  if (floor <= 5) return fx; // the very first floors are plain
  const mag = Math.min(1, 0.4 + rank / 12);
  if (name.includes('Blood Bat')) fx.lifesteal = 0.2 * mag;
  else if (name.includes('Venom Centipede')) fx.burn = Math.round(maxHp * 0.01 * mag);
  else if (name.includes('Iron Skin Boar') || name.includes('Clay Sentinel')) fx.thorns = 0.18 * mag;
  else if (name.includes('Specter Moth')) fx.dodge = 0.18 * mag;
  else if (name.includes('Moonbug Swarm')) fx.crit = 0.2 * mag;
  else if (name.includes('Bone Sparrow')) fx.crit = 0.1 * mag;
  return fx;
}

// --- Enemy Dao standing (precoded by realm + difficulty, deterministic per floor) ---
// Enemies carry representative Comprehension + Dao Marks for their realm. Immortal-band enemies
// (ranks 6-9, floors 251+) hold marks that amplify their offense (1 + marks/1000) — so the jump to
// immortal floors is a wall, exactly as intended.
const ENEMY_COMP_CAP = [2, 3, 4, 5, 6, 8, 9, 10, 10];           // mirror of dao.js COMP_CAP_BY_RANK
const MARK_BAND = { 6: [1000, 9250], 7: [10000, 32750], 8: [40000, 340000], 9: [150000, 1000000] };
const THEME_PATHS = ['blood', 'metal', 'fire', 'poison', 'bone', 'lightning', 'dark', 'wind'];
function hash32(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0; return h; }
const jitter = (key) => 0.9 + (hash32(key) % 21) / 100; // deterministic 0.90 .. 1.10
const themePath = (name) => THEME_PATHS[hash32(name) % THEME_PATHS.length];

// ---- Enemy RARITY — band-capped, ramping to the cap at the realm gate ------------------------------
// Each realm BAND has a single TOP rarity = its rank: rank 1 = Common, rank 2 = Uncommon, rank 3 = Rare,
// rank 4 = Epic, rank 5 = Legendary, rank 6+ = Immortal (capped). So floors 1-50 are ALL Common; 51-100
// introduce Uncommon; 101-150 Rare; 151-200 Epic; 201-250 Legendary; 251+ Immortal. Within a band the
// pool shifts from the band's BASE rarity (the previous band's cap) — only a FEW of the new top rarity at
// the opening — up to the FULL top rarity at the band's last floors (the gate boss is the hardest fight).
// Bosses always field the cap. Deterministic via the floor rng. Rarity sets aptitude + trait TIER AND (in
// the parity model) the attribute floor + bonus pool, so a higher-rarity foe is a genuinely stronger one.
function enemyRarity(floor, boss, difficulty, rng) {
  const rank = floorRealm(floor);
  const cap = Math.min(5, rank - 1);                   // band's TOP rarity (rank1→Common … rank6+→Immortal)
  const base = Math.max(0, Math.min(5, rank - 2));     // band's BASE rarity (= the previous band's cap)
  if (cap <= base) return RARITY_ORDER[cap];           // single-rarity band: rank 1 (all Common), ranks 7-9 (all Immortal)
  if (boss) return RARITY_ORDER[cap];                  // bosses field the band's top rarity
  const within = ((floor - 1) % FLOORS_PER_REALM) / FLOORS_PER_REALM;     // 0 .. ~0.98 across the band
  const pTop = Math.min(1, 0.12 + 0.9 * within + (difficulty || 0) * 0.3); // a few at the opening → ALL by the gate
  return RARITY_ORDER[rng() < pTop ? cap : base];
}

// ---- Squad THEMES: a coherent per-floor team gimmick. A theme maps each ROLE → a trait LINE, and may
// carry a team AURA (commander ATK/SPD · warden DEF/thorns · mender regen) baked across the wave. Themes
// phase in with depth; the first floors use 'rabble' (no lines, no aura) so they stay trivially beatable.
const SQUADS = {
  rabble:       { name: 'Rabble',       lines: {},                                                                                              aura: null },
  onslaught:    { name: 'Onslaught',    lines: { tank: 'vanguard', bruiser: 'vanguard', striker: 'slayer',    skirmisher: 'tempest',  boss: 'slayer'    }, aura: 'commander' }, // ATK rush
  bulwark:      { name: 'Bulwark',      lines: { tank: 'wall',     bruiser: 'wall',     striker: 'vanguard',  skirmisher: 'tempest',  boss: 'wall'      }, aura: 'warden' },    // DEF turtle + taunt
  coven:        { name: 'Coven',        lines: { tank: 'wall',     bruiser: 'afflictor',striker: 'afflictor', skirmisher: 'reaver',   boss: 'afflictor' }, aura: 'mender' },    // status + sustain
  storm:        { name: 'Storm',        lines: { tank: 'vanguard', bruiser: 'tempest',  striker: 'assassin',  skirmisher: 'tempest',  boss: 'assassin'  }, aura: 'commander' }, // fast crit burst
  bloodpack:    { name: 'Bloodpack',    lines: { tank: 'wall',     bruiser: 'reaver',   striker: 'reaver',    skirmisher: 'tempest',  boss: 'reaver'    }, aura: 'mender' },    // lifesteal pack
  phalanx:      { name: 'Phalanx',      lines: { tank: 'wall',     bruiser: 'wall',     striker: 'wall',      skirmisher: 'vanguard', boss: 'wall'      }, aura: 'warden' },    // all-wall fortress
  executioners: { name: 'Executioners', lines: { tank: 'vanguard', bruiser: 'assassin', striker: 'assassin',  skirmisher: 'assassin', boss: 'slayer'    }, aura: 'commander' }, // crit assassins
  swarm:        { name: 'Swarm',        lines: { tank: 'tempest',  bruiser: 'tempest',  striker: 'tempest',   skirmisher: 'tempest',  boss: 'tempest'   }, aura: 'commander' }, // hyper-fast swarm
  warhost:      { name: 'Warhost',      lines: { tank: 'wall',     bruiser: 'vanguard', striker: 'slayer',    skirmisher: 'tempest',  boss: 'vanguard'  }, aura: 'commander' }, // balanced legion
  plague:       { name: 'Plague',       lines: { tank: 'wall',     bruiser: 'afflictor',striker: 'afflictor', skirmisher: 'afflictor',boss: 'afflictor' }, aura: 'mender' },    // heavy debuff
};
const SQUAD_KEYS = ['onslaught', 'bulwark', 'coven', 'storm', 'bloodpack', 'phalanx', 'executioners', 'swarm', 'warhost', 'plague'];
// The squad gimmick for a floor: plain rabble on the opening floors, then a deterministic themed squad
// (auras only start mattering once enemies are rich enough to carry them — gated by depth in applyEnemyAura).
function squadFor(floor, rng) {
  if (floor <= 8) return SQUADS.rabble;
  return SQUADS[SQUAD_KEYS[Math.floor(rng() * SQUAD_KEYS.length)]];
}

// Apply the squad's TEAM AURA across a BUILT wave, baked as flat stat buffs (commander ATK/SPD, warden
// DEF/thorns, mender passive regen) at the wave's strongest (lead) rarity tier — no battle-engine change.
// Skipped on shallow floors and when the lead is too low-rarity to "lead" (keeps early floors gentle).
function applyEnemyAura(wave, squad, floor) {
  if (!squad || !squad.aura || floor <= 15 || !wave.length) return wave;
  const auraLine = LINES[squad.aura];
  if (!auraLine || !auraLine.aura) return wave;
  const lead = wave.reduce((m, u) => (RARITY_ORDER.indexOf(u.rarity) > RARITY_ORDER.indexOf(m.rarity) ? u : m), wave[0]);
  if (RARITY_ORDER.indexOf(lead.rarity) < 1) return wave;   // a Common lead grants no aura
  const a = auraLine.aura[lead.rarity];
  if (!a) return wave;
  for (const u of wave) {
    const rungs = (u.tiers && u.tiers.length) ? u.tiers : null;
    if (rungs) {
      // bake the aura into EVERY channel rung so it survives applyChannel's per-action profile swap
      // (mirrors the ally side's applyTeamAuras), then re-sync the flat display fields from the top rung.
      for (const t of rungs) {
        if (a.atkMul) t.atk = Math.round(t.atk * (1 + a.atkMul));
        if (a.defMul) t.def = Math.round(t.def * (1 + a.defMul));
        if (a.spdMul) t.spd = Math.max(1, Math.round(t.spd * (1 + a.spdMul)));
        if (a.thorns) t.fx.thorns = Math.min(0.6, (t.fx.thorns || 0) + a.thorns);
        if (a.regenPct) t.fx.regen = (t.fx.regen || 0) + Math.round((t.max || 0) * a.regenPct);
      }
      const top = rungs[rungs.length - 1];
      u.atk = top.atk; u.def = top.def; u.spd = top.spd;
      u.effects.thorns = top.fx.thorns || 0; u.effects.regen = top.fx.regen || 0;
    } else {                                   // legacy single-tier path (no ladder)
      if (a.atkMul) u.atk = Math.round(u.atk * (1 + a.atkMul));
      if (a.defMul) u.def = Math.round(u.def * (1 + a.defMul));
      if (a.spdMul) u.spd = Math.max(1, Math.round(u.spd * (1 + a.spdMul)));
      if (a.thorns) u.effects.thorns = Math.min(0.6, (u.effects.thorns || 0) + a.thorns);
      if (a.regenPct) u.effects.regen = (u.effects.regen || 0) + Math.round((u.maxHp || 0) * a.regenPct);
    }
  }
  wave.aura = squad.aura; // tag for UI/debug
  return wave;
}

// the realm a rank's PEAK sits at (for full-loadout slot counts) — mortal (R-1)*4+3, immortal 20+(R-6).
const rankPeakRealm = (rank) => (rank <= 5 ? (rank - 1) * 4 + 3 : 20 + (rank - 6));

// ---- LINE-COHERENT KILLER MOVES -------------------------------------------------------------------
// Map each combat LINE (the squad's role→trait assignment) → a fitting killer-move DOMAIN + a small
// archetype pool, so a cultivator's special move matches its battlefield ROLE (tanks shield, strikers
// nuke, afflictors hex, skirmishers blitz) while the move's NAME + status still come from its loadout's
// DAO PATH. Every path stocks a Gu for every universal kind, so the domain core is always craftable.
const LINE_KILLER = {
  vanguard:   { domain: 'offense', archs: ['onslaught', 'cataclysm'] },                 // front bruiser → burst
  slayer:     { domain: 'offense', archs: ['execution', 'annihilation', 'onslaught'] }, // glass carry → nukes/AoE
  assassin:   { domain: 'offense', archs: ['execution', 'onslaught'] },                 // crit kill-securer
  reaver:     { domain: 'offense', archs: ['bloodrush', 'whirlwind'] },                 // vampire → lifesteal strikes
  afflictor:  { domain: 'mystic',  archs: ['hexweave', 'soulrend', 'contagion', 'anathema'] }, // debuffer → hexes
  tempest:    { domain: 'motion',  archs: ['flurry', 'blur', 'tempest'] },              // skirmisher → tempo/blitz
  wall:       { domain: 'guard',   archs: ['aegis', 'sentinel', 'reprisal', 'bulwark'] }, // anchor → shields/taunt
  foundation: { domain: 'vigor',   archs: ['lifesurge', 'renewal'] },                   // channeler → sustain
  fortune:    { domain: 'offense', archs: ['onslaught', 'execution'] },                 // luck-striker → burst
  adept:      { domain: 'offense', archs: ['onslaught', 'cataclysm'] },                 // amplifier → burst
  warden:     { domain: 'guard',   archs: ['bulwark', 'bastion'] },                     // (support lines, if ever a role line)
  commander:  { domain: 'offense', archs: ['warcry', 'onslaught'] },
  mender:     { domain: 'vigor',   archs: ['renewal', 'sanctuary'] },
};
// Build a LINE-COHERENT killer config from a resolved loadout (`items` = [{uid, gu}]): core = a loadout
// Gu in the line's favored domain (the loadout guarantees one via enemyGuLoadout's coreDomain), support =
// the rest of the core's path, archetype = a deterministic pick from the line's pool (varies by mob/floor,
// no rng draw so the spawn stream is unperturbed). Returns null → caller falls back to generic autoConfigure.
function lineKillerConfig(lineId, items, name, floor) {
  const lk = lineId && LINE_KILLER[lineId];
  if (!lk || !items || items.length < 3) return null;
  const core = items.find((it) => guInDomain(it.gu, lk.domain));
  if (!core) return null;
  const support = items.filter((it) => it !== core && it.gu.daoPath === core.gu.daoPath);
  if (support.length < 2) return null;
  const archetype = lk.archs[hash32(name + floor + lineId) % lk.archs.length];
  return { core: core.uid, coreGu: core.gu, support: support.map((it) => it.uid), supportGu: support.map((it) => it.gu), archetype };
}
export function enemyUnit(floor, name, { boss = false, difficulty = 0, kind = 'beast', rng = Math.random, squad = SQUADS.rabble, fullGu = false,
  forcePath = null, poolMult = 1, hpMult = 1, killerArch = null, sustain = false, forceKiller = false } = {}) {
  const rank = floorRealm(floor);
  const role = boss ? 'boss' : roleOf(name);
  const lineId = squad.lines[role] || null;       // the squad's trait LINE for this role (drives the killer archetype)
  const rarity = enemyRarity(floor, boss, difficulty, rng);    // gradient rarity → aptitude + trait tier
  const apt = (NPC_TEMPLATES[rarity] || NPC_TEMPLATES.Common).aptitude;
  // parity baseline (rank-1→realm pool for this rarity) × difficulty multiplier (within-band sawtooth),
  // ×boss bump — the multiplier scales the INVESTED pool; the rarity floor below stays player-equal.
  const realmIdx = floorRealmIndex(floor);          // discrete sub-stage (Initial→Peak across the band)
  // poolMult is the BOUNTY raid-boss knob: an extra multiplier on the invested pool on top of the
  // within-band sawtooth + boss bump (1 = no change, so ordinary floor enemies are unaffected).
  const pool = enemyPool(realmIdx, rarity, apt) * difficultyMult(floor) * (boss ? BOSS_POOL_MULT : 1) * (poolMult || 1);
  const attrs = roleAttrs(role, pool);            // invested points, distributed across the five attributes by role
  const floorA = baseAttr(rarity);                // …plus the SAME per-attribute rarity floor a player gets
  for (const k in attrs) attrs[k] += floorA;
  const base = deriveStats(attrs);                // attribute-derived stats — identical derivation to allies

  // Gu loadout + traits apply as stat MULTIPLIERS + an effect bundle on top of the derived base.
  // Cultivators/bosses get a Gu kit; beasts get a few WILD Gu. Floors 1-3 stay plain.
  const cultivator = kind === 'cultivator' || boss;
  const wantGu = cultivator || floor >= 4;
  // gate-boss teams (fullGu) carry a FULL rank-appropriate loadout (every slot) like a serious cultivator;
  // ordinary foes carry fewer (cultivators a kit, beasts a couple of wild Gu).
  const guCount = fullGu ? guSlots(rankPeakRealm(rank))
    : cultivator ? Math.min(4, 2 + Math.floor(rank / 3)) : Math.min(2, 1 + Math.floor(rank / 4));
  // a killer-capable line steers the loadout to field a core of its favored domain (so its move fits its
  // role). A forced bounty killer pins the core domain to that archetype's domain instead. forceKiller
  // (bounties) lifts the rank gate so even a rank-1/2 elite target arms its line's signature move.
  const killerOK = rank >= KILLER_MIN_RANK || forceKiller;
  const coreDomain = (killerArch ? archetypeDomain(killerArch) : null)
    || ((killerOK && lineId && LINE_KILLER[lineId]) ? LINE_KILLER[lineId].domain : null);
  const loadout = wantGu ? enemyGuLoadout(floor, rank, rng, guCount, coreDomain, forcePath, sustain) : [];
  const affPath = (loadout[0] && loadout[0].daoPath) || themePath(name); // DAO PATH AFFINITY trait (its theme path)
  const RATE_MAP = { crit: 'crit', critDmg: 'critDamage', critRes: 'critResist', statusRes: 'statusResist',
    evasion: 'dodge', hit: 'hitChance', armorPen: 'armorPen', lifesteal: 'lifesteal', thorns: 'thorns',
    potency: 'potency', lucky: 'luckyHit' };

  // CONSTANT (non-Gu) modifiers — identical across every channel tier. Cultivator honing + the squad's
  // TIERED LINE trait fold into the SAME stat mults / combat-rate adds allies use; line essence %/apBase
  // feed the pool. (Support-line auras are applied later, at the wave level, by applyEnemyAura.)
  let cAtk = 1, cDef = 1, cHp = 1;
  if (cultivator) {
    const gt = Math.max(1, Math.min(6, 1 + Math.floor(rank * 0.7)));
    cAtk = 1.10 + gt * 0.02; cDef = 1.14 + gt * 0.03; cHp = 1.08 + gt * 0.02;
  }
  const lb = (lineId && LINES[lineId] && LINES[lineId].tiers) ? LINES[lineId].tiers[rarity] : null;
  const lineRate = {}; let essPoolPct = 0, essRcvPct = 0, apBase = 0;
  if (lb) { for (const k in RATE_MAP) if (lb[k]) lineRate[RATE_MAP[k]] = (lineRate[RATE_MAP[k]] || 0) + lb[k];
    essPoolPct = lb.essPoolPct || 0; essRcvPct = lb.essRcvPct || 0; apBase = lb.apBase || 0; }
  // aperture pool/regen carry NO Gu contribution for enemies (Gu lines don't grant essPool/essRcv), so
  // they're the same across tiers — aptitude (by rarity) still caps the usable fraction, like allies.
  let essencePool = Math.round((base.essencePool + apBase) * essenceQualityByRank(rank - 1) * apertureCapacity(apt) * (1 + essPoolPct));
  let essenceRegen = base.essenceRegen * apertureRegenFactor(apt) * (1 + essRcvPct);   // both may be RAISED below to sustain a killer-capable foe's kit
  const CAP = { extra_turn: 0.5 }; // thorns/lifesteal/statusResist/armorPen/dodge/crit/critResist all UNCAPPED (parity with allies)

  // Aggregate the Gu-derived modifiers for a loadout PREFIX (resonance recomputed from the prefix's
  // same-path count, exactly like the ally subset path), with the prefix's cumulative channel cost.
  const guAgg = (prefix) => {
    const rate = {}, riders = []; let aM = 1, dM = 1, hM = 1, sM = 1, regenFrac = 0, cost = 0;
    const reso = enemyResonance(prefix.filter((g) => g.daoPath === affPath).length); // same-path count → RESONANCE
    for (const gu of prefix) {
      cost += guEssenceCostFor(gu, rank);
      const amp = gu.daoPath === affPath ? AFFINITY_EFFECT_MULT * reso : 1; // affinity (+10%) × resonance on its path
      for (const e of (gu.effects || [])) {
        const k = e.kind, v = (e.value || 0) * amp;
        if (k === 'status') riders.push({ type: e.status, base: e.chance, dur: e.dur, mag: e.dot });
        else if (k === 'atk') aM *= 1 + v;
        else if (k === 'def') dM *= 1 + v;
        else if (k === 'hp') hM *= 1 + v;
        else if (k === 'spd') sM *= 1 + v;
        else if (k === 'regen') regenFrac += v;
        else if (RATE_MAP[k]) rate[RATE_MAP[k]] = (rate[RATE_MAP[k]] || 0) + v;
      }
    }
    return { rate, riders, aM, dM, hM, sM, regenFrac, cost };
  };
  // Build the enemy's stat/effect profile from a loadout PREFIX. Gu → cultivator → line multipliers apply
  // in that order (matching the old single-pass build). Called once per ladder rung (loadout.slice(0,k))
  // below to emit `tiers`, so per-Gu essence gating now applies to ENEMIES too (parity with the player):
  // a starved foe drops whole Gu via battle.js applyChannel. Cultivator honing + line traits are non-Gu, so
  // they live in EVERY rung (including k=0); only the Gu effects + their cumulative essence cost vary by k.
  const buildTier = (prefix) => {
    const g = guAgg(prefix);
    // build each combined multiplier (Gu × cultivator × line) FIRST, then multiply base once — the exact
    // association the old single-pass build used, so the full-loadout tier is byte-identical to before.
    let aM = g.aM * cAtk, dM = g.dM * cDef, hM = g.hM * cHp, sM = g.sM;
    if (lb) { aM *= 1 + (lb.atkPct || 0); dM *= 1 + (lb.defPct || 0); hM *= 1 + (lb.hpPct || 0); sM *= 1 + (lb.spdPct || 0); }
    const maxHp = Math.round(base.maxHp * hM * (hpMult || 1));   // hpMult = the BOUNTY bulk knob (1 elsewhere)
    const atk = Math.round(base.atk * aM);
    const def = Math.round(base.def * dM);
    const spd = Math.max(1, Math.round(base.spd * sM));
    // effects: attribute-derived combat block + themed beast/boss effects + Gu + line effects. The derived
    // %s feed the battle engine's roll pipeline, so enemies resolve hits exactly like allies.
    const effects = enemyEffects(floor, name, boss, maxHp);
    effects.crit = (effects.crit || 0) + base.critChance;
    effects.dodge = (effects.dodge || 0) + base.evasion;
    effects.hitChance = base.hitChance;
    effects.critDamage = base.critDamage;
    effects.critResist = base.critResist;
    effects.armorPen = base.armorPen;
    effects.luckyHit = base.luckyHit;
    effects.potency = base.potency;            // INT-derived status potency — parity with allies
    effects.statusResist = base.statusResist;  // CON-derived status resist — parity with allies
    effects.inflicts = g.riders; // one rider per CHANNELLED status-Gu effect (declared chance/dot/dur)
    if (lb && lb.dotSpread) effects.dotSpread = (effects.dotSpread || 0) + lb.dotSpread;   // Afflictor extra
    if (lb && lb.essDrain) effects.essDrain = (effects.essDrain || 0) + lb.essDrain;       // Reaver extra
    const rate = { ...g.rate };                          // channelled Gu rates + constant line rates (Gu first,
    for (const k in lineRate) rate[k] = (rate[k] || 0) + lineRate[k]; // matching the old single rateFx merge)
    for (const k in rate) effects[k] = (effects[k] || 0) + rate[k];
    if (g.regenFrac) effects.regen = (effects.regen || 0) + Math.round(g.regenFrac * maxHp);
    for (const k in CAP) if (effects[k]) effects[k] = Math.min(effects[k], CAP[k]);
    return { cost: g.cost, atk, def, spd, max: maxHp, essMax: essencePool, essRegen: essenceRegen, fx: effects };
  };
  // PER-GU ESSENCE LADDER (parity with the player): tiers[k] = the profile when only the first k loadout
  // Gu are channelled — k=0 the bare-handed attribute swing (cultivator honing + line traits still apply),
  // k=N the full kit — each with its CUMULATIVE essence cost. battle.js applyChannel gates EVERY unit to the
  // largest affordable prefix each action, so an essence-starved foe now DROPS whole Gu (and their HP/aperture/
  // riders), exactly like an over-reaching player — never weaker than bare-handed. Resonance recomputes per
  // prefix (guAgg counts same-path Gu in the slice), so a shortened loadout also loses resonance.
  const tiers = [];
  for (let k = 0; k <= loadout.length; k++) tiers.push(buildTier(loadout.slice(0, k)));
  const full = tiers[tiers.length - 1]; // top rung = full loadout (the fight starts here, then gates down)

  const compCap = ENEMY_COMP_CAP[rank - 1];
  const comprehension = Math.min(compCap, Math.round(compCap * jitter(name + floor)));
  let daoMarks = 0; // stored for display / future; mark amplification on combat is deferred (the pool carries realm power now)
  if (rank >= 6) {
    const [lo, hi] = MARK_BAND[rank];
    daoMarks = Math.round((lo + (hi - lo) * (boss ? 1 : difficulty)) * jitter('m' + name + floor));
  }

  // KILLER MOVE: a rank-3+ cultivator's special move is built to fit its trait LINE (lineKillerConfig:
  // a tank guards, a striker nukes, an afflictor hexes) off its loadout's core+support, with the move's
  // name + status flavored by its Dao path. Falls back to the generic loadout-driven autoConfigure when
  // the unit has no line (e.g. rabble) or can't field a domain core. Costed like an ally's core
  // (KILLER_COST_MULT × Σ the core/support Gu's rank-adjusted channel cost).
  // PROGRESSION GATE: only rank 3+ foes get a killer move (combos.js KILLER_MIN_RANK), mirroring the player
  // gate. Rank-3+ enemies appear only on Floor 101+ (where the player has cleared Floor 100), so it's symmetric.
  let killer = null, comboCost = 0;
  if (killerOK) {
    const items = loadout.map((g, i) => ({ uid: 'e' + i, gu: g }));
    let autoK = null;
    if (killerArch) {                               // bounty: force a specific killer archetype off the loadout
      const dom = archetypeDomain(killerArch);
      const core = items.find((it) => guInDomain(it.gu, dom));
      const support = core ? items.filter((it) => it !== core && it.gu.daoPath === core.gu.daoPath) : [];
      if (core && support.length >= 2) autoK = { archetype: killerArch, coreGu: core.gu, supportGu: support.map((it) => it.gu) };
    }
    autoK = autoK || lineKillerConfig(lineId, items, name, floor) || autoConfigure(items); // line-coherent, then generic
    if (autoK) {
      const spec = assemble(autoK.archetype, autoK.coreGu, autoK.supportGu);
      if (spec) { killer = spec; comboCost = Math.round(KILLER_COST_MULT * [autoK.coreGu, ...autoK.supportGu].reduce((s, g) => s + guEssenceCostFor(g, rank), 0)); }
    }
  }

  // SELF-SUFFICIENT APERTURE: a killer's comboCost (≈3× a channel) on top of per-action channelling would
  // otherwise starve a killer-capable foe's OWN Gu right after it casts (they'd gate off until regen caught
  // up). Size the pool + regen to its loadout so it sustains its full-loadout channel AND its killer cadence:
  //   • regen covers one channel/action + the killer amortised over ~2 cooldowns (so killers recur but don't
  //     drain it dry). per-action regen ≈ essRegen × (1000/spd) × ESS_REGEN_SCALE → invert for the stat.
  //   • pool banks a full killer + ~2 actions of channel buffer, so casting near-full never drops below the
  //     channel cost. Floors only RAISE — a naturally rich aperture is left alone. The essence GATING still
  //     bites under EXTERNAL pressure (player essence-drain / Enervate) or a genuinely over-tier loadout.
  if (comboCost > 0 && loadout.length) {
    const channel = full.cost;                                           // full-loadout essence per action
    const perActionNeed = channel + comboCost / (2 * KILLER_COOLDOWN);   // sustain channel + amortised killer
    const regenFloor = perActionNeed * Math.max(1, full.spd) / (1000 * ESS_REGEN_SCALE) * 1.15; // +15% margin
    const poolFloor = comboCost + channel * 2;
    if (essenceRegen < regenFloor) essenceRegen = regenFloor;
    if (essencePool < poolFloor) essencePool = Math.round(poolFloor);
    for (const t of tiers) { t.essMax = essencePool; t.essRegen = essenceRegen; } // ladder rungs share the aperture
  }

  return {
    name, isBoss: boss, kind: cultivator ? 'cultivator' : 'beast', rank, realm: realmIdx, role, rarity, line: lineId,
    daoPath: affPath, killer, comboCost,
    comprehension, daoMarks, gu: loadout.map((g) => g.name),
    guInfo: loadout.map((g) => ({ name: g.name, eff: effectText(g) })), // name + effect text for the arena traits panel

    maxHp: full.max, hp: full.max, atk: full.atk, def: full.def, spd: full.spd,
    essencePool, essenceRegen,
    essenceCost: full.cost,    // Σ all Gu (full kit) — display/legacy fallback; live gating reads `tiers`
    effects: full.fx,
    tiers,                     // per-Gu channel ladder → battle.js applyChannel gates the foe by essence
  };
}

// --- Deliberate enemy formations on the 2×5 board ---
// Each template is an ordered list of [row, lane] slots; a wave's units fill them in priority order
// (bosses first, then elites, then mobs), so the key unit lands the meaningful slot. All templates
// keep ≤5 per row and exploit the per-lane protection + ±1 column-reach rules.
const FORMS = {
  vanguard: [['front', 2], ['front', 1], ['front', 3], ['front', 0], ['front', 4], ['back', 2]], // a solid front wall
  skirmish: [['front', 0], ['front', 2], ['front', 4], ['front', 1], ['front', 3], ['back', 2]], // wide spread line
  center:   [['front', 2], ['front', 1], ['front', 3], ['back', 2], ['back', 1], ['back', 3]],    // press the middle lanes
  flanks:   [['front', 0], ['front', 4], ['front', 1], ['front', 3], ['back', 0], ['back', 4]],   // hold the edges
  echelon:  [['front', 1], ['front', 3], ['back', 2], ['back', 0], ['back', 4], ['front', 2]],    // staggered line
  spear:    [['front', 2], ['back', 2], ['front', 1], ['back', 1], ['front', 3], ['back', 3]],     // stacked columns, deep push
  guarded:  [['back', 2], ['front', 2], ['front', 1], ['front', 3], ['back', 1], ['back', 3]],      // VIP shielded behind a wall
};
// Choose a formation deterministically. Bosses shield themselves (guarded/spear) when they have
// guards; lone bosses stand front-and-centre. Normal floors draw from a pool that gains more
// tactical shapes as the realm deepens.
function pickForm(floor, boss, units, rng) {
  if (boss) return units.length > 1 ? (rng() < 0.7 ? FORMS.guarded : FORMS.spear) : FORMS.vanguard;
  const realm = floorRealm(floor);
  const pref = (u) => (ROLES[u.role] ? ROLES[u.role].front : 0);
  const mixed = units.some((u) => pref(u) < 0) && units.some((u) => pref(u) > 0);
  let pool;
  if (mixed) {                          // shield squishies: lane-aligned back tiles (center/spear)
    pool = ['center'];
    if (realm >= 4) pool.push('spear');
  } else {                              // homogeneous → line/stagger shapes
    pool = ['vanguard', 'skirmish'];
    if (realm >= 3) pool.push('flanks');
    if (realm >= 5) pool.push('echelon');
  }
  return FORMS[pool[Math.floor(rng() * pool.length)]];
}
function placeWave(units, floor, rng) {
  const boss = units.some((u) => u.isBoss);
  const form = pickForm(floor, boss, units, rng);
  const slots = form.slice(0, units.length);
  if (boss) {
    // boss/elites take the template's priority slots — the boss self-shields per the chosen form.
    const imp = (u) => (u.isBoss ? 2 : /^Elite/.test(u.name) ? 1 : 0);
    [...units].sort((a, b) => imp(b) - imp(a))
      .forEach((u, i) => { const s = slots[i] || slots[slots.length - 1]; u.row = s[0]; u.lane = s[1]; });
    return units;
  }
  // role-aware: front-preferring units (tanks → bruisers) take the front tiles; skirmishers/strikers
  // take the back tiles (shielded when the template puts a frontliner in their lane).
  const fronts = slots.filter((s) => s[0] === 'front');
  const backs = slots.filter((s) => s[0] === 'back');
  const pref = (u) => (ROLES[u.role] ? ROLES[u.role].front : 0);
  [...units].sort((a, b) => pref(b) - pref(a)).forEach((u, i) => {
    const s = i < fronts.length ? fronts[i] : (backs[i - fronts.length] || slots[i] || slots[slots.length - 1]);
    u.row = s[0]; u.lane = s[1];
  });
  return units;
}

// Returns { floor, isBoss, isWaveEncounter, waves: [[unit,...], ...] }
export function generateEncounter(floor) {
  const rng = mulberry32(floor * 2654435761);
  const boss = isBossFloor(floor);
  const squad = squadFor(floor, rng);          // the floor's coherent team gimmick (role→line + optional aura)

  // base team size: single mob for the first floors (gentle on-ramp); the slow baseline growth elsewhere;
  // BUT ranks 1-3 (floors 4-150) field +2 extra mobs so a 6-team can't trivially out-number them (the
  // early-game easiness fix — R4-R5 keep the baseline count, they're already busy).
  const baseSize0 = Math.max(1, Math.min(6, Math.floor(1 + (floor - 1) / 90 + rng() * 1.2)));
  const baseSize = floor <= 3 ? 1 : (floorRealm(floor) <= 3 ? Math.min(6, baseSize0 + 2) : baseSize0);

  // RARE multi-wave encounters (~10-28% of normal floors), more likely deeper.
  const waveChance = 0.10 + Math.min(0.18, floor / 1500);
  const isWaveEncounter = !boss && floor > 3 && rng() < waveChance;

  const waves = [];

  if (boss) {
    // REALM-GATE boss team: every unit (pre-guards, boss, escorts) carries a FULL rank-appropriate Gu
    // loadout — a serious, fully-kitted squad worthy of the gate.
    if (floor >= 20 && rng() < 0.45) {
      const guards = Math.min(4, 2 + Math.floor(rng() * 2));
      waves.push(Array.from({ length: guards }, (_, i) => spawn(floor, i, rng, { squad, fullGu: true })));
    }
    const bossName = `${BOSSES[(floor / 10) % BOSSES.length | 0]} · F${floor}`;
    const guardCount = 2 + Math.floor(rng() * 2); // boss + 2-3 escorts → a 3-4 unit gate squad (full-loadout)
    const bossWave = [enemyUnit(floor, bossName, { boss: true, rng, squad, fullGu: true })];
    for (let i = 0; i < guardCount; i++) bossWave.push(spawn(floor, i, rng, { difficulty: 0.4, squad, fullGu: true }));
    waves.push(bossWave);
  } else if (isWaveEncounter) {
    const waveCount = 2 + Math.floor(rng() * 2); // 2-3 waves
    for (let w = 0; w < waveCount; w++) {
      const size = Math.max(1, Math.min(6, baseSize + Math.floor(rng() * 2)));
      waves.push(Array.from({ length: size }, (_, i) => spawn(floor, w * 7 + i, rng, { squad })));
    }
  } else {
    // standard encounter: a single wave, often a single enemy.
    waves.push(Array.from({ length: baseSize }, (_, i) => spawn(floor, i, rng, { squad })));
  }

  waves.forEach((w) => placeWave(w, floor, rng));
  waves.forEach((w) => applyEnemyAura(w, squad, floor)); // bake the squad's team aura across each wave
  return { floor, isBoss: boss, isWaveEncounter, squad: squad.name, waves };
}

// Total enemy count across all waves (for UI).
export const encounterSize = (enc) => enc.waves.reduce((s, w) => s + w.length, 0);
