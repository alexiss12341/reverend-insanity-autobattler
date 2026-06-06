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
import { deriveStats, roleAttrs, budget, poolAtIndex, realmPointsTotal, apertureCapacity, apertureRegenFactor, aptitudePointBonus, rarityBonus } from './attributes.js';
import { statusForPath, STATUS, statusDuration } from './status.js';
import { essenceQualityByRank, guSlots } from './realms.js';
import { NPC_TEMPLATES, RARITY_ORDER } from './rarities.js';
import { LINES, AFFINITY_EFFECT_MULT } from './traits.js';

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

// An enemy's Gu loadout: `count` Gu of ONE unlocked theme path (tier ~ realm) — a SAME-PATH, RESONANCE-
// enabled kit (like a player who stacks one Dao), so foes are properly synergized, not a scattered grab-bag.
// Paths are commonality-gated (floors 1-50 common only, uncommon at 51, rare 101, esoteric 201), and the
// loadout repeats the path's Gu to fill every slot so the resonance bonus is real.
function enemyGuLoadout(floor, rank, rng, count) {
  const allowedPath = (p) => commOf(p).floorReq <= floor;       // only paths this floor has unlocked
  const cap = Math.max(1, Math.min(5, rank + 1));
  const lo = Math.max(1, cap - 2);
  const guOfPath = (p) => guList().filter((g) => g.daoPath === p && g.tier <= cap && g.tier >= lo);
  let candidates = floorThemePaths(floor).filter(allowedPath);
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
// Enemy attribute-point pool for a floor: ramps across a rank's 4 stages (mortal), flat within an
// immortal rank, jumping hard at each rank barrier — mirrors the player's realm-point curve so the two
// sides stay aligned at every depth. PLUS a floor-RAMPED additive EDGE: the player arrives rarity-,
// attribute-floor- and aptitude-boosted (a lone Epic main already out-pools a raw rank-1 enemy), so flat
// realm-parity lets a lone strong cultivator solo-stomp deep into a band. The edge is ~0 on floor 1 (so
// floor 1 stays a trivial solo win), ramps so a STAGNANT lone char is outpaced within ~a dozen floors,
// and CAPS so deep floors (whose realm pool already dwarfs it) aren't overtuned.
// DIFFICULTY MODEL — enemies are scaled against a REFERENCE appropriately-leveled cultivator (a solid
// Epic-grade build) at the rank/stage each floor expects, NOT the raw realm-point table. This tracks the
// player's real pool curve — including the aptitude point-bonus SPIKES at every rank-up — so the challenge
// stays uniform across ranks instead of going soft in the mid-ranks. A within-band difficulty RAMP makes
// each band a SAWTOOTH: gentle right after a rank-up (respite), building to a hard gate boss at the band's
// end. DIFF_END > 1 means the gate enemy out-pools a Gu-LESS rank-peak team — so Gu (and their resonance)
// are what let a synergized team break the wall; a Gu-less team simply can't.
const REF_RARITY_BONUS = rarityBonus('Epic');  // reference player's rarity head-start (pool)
const REF_APT = 2.2;                            // …and aptitude (drives the attribute-point bonus)
const DIFF_START = 0.35;   // enemy pool ÷ reference player pool at a band's FIRST floor (post rank-up respite; keeps floor 1 / band-openings a gentle on-ramp)
const DIFF_END   = 1.0;    // …and at the band's GATE boss. With strong Gu (GU_POWER) the GATE bite comes from foes' Gu, not raw pool
const BOSS_POOL_MULT = 1.35; // the gate boss itself fields this × the floor pool on top of the ramp
function refPlayerPool(realm) {
  return poolAtIndex(realm) + REF_RARITY_BONUS + aptitudePointBonus(Math.round(realm), REF_APT);
}
// Ranks 1-3 are otherwise trivialized (few mobs + the team's numbers/Gu dominate), so their foes hit
// HARDER per-unit. Indexed by rank (1-9); 1 for ranks 4+. Combined with bigger early waves (baseSize),
// this forces Gu even at low ranks. EARLY_POWER[3] (rank 3) is the focus tweak.
const EARLY_POWER = [0, 1.2, 1.25, 1.35, 1.3, 1.05, 1, 1, 1, 1];
function poolForFloor(floor) {
  const rank = floorRealm(floor);
  const within = ((floor - 1) % FLOORS_PER_REALM) / FLOORS_PER_REALM;     // 0 .. ~1 across the band
  const refRealm = rank <= 5 ? (rank - 1) * 4 + within * 3 : Math.min(23, 20 + (rank - 6));
  return refPlayerPool(refRealm) * (DIFF_START + (DIFF_END - DIFF_START) * within) * (EARLY_POWER[rank] || 1);
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
    if (rank >= 7) fx.extra_turn = 0.15;
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

// ---- Enemy RARITY (gradient by depth) → aptitude (essence pool) + the tier of its traits ----------
// Rarity ramps GENTLY with floor depth so shallow floors are almost all Common (negligible traits) and
// higher rarities phase in deeper — trait strength grows gradually, not a cliff. Bosses/guards get a
// bump. RARITY_CAP keeps it bounded. Deterministic via the floor rng. (Rarity does NOT add attribute
// points — those stay realm-based; rarity only sets aptitude + which trait TIER the unit uses.)
function enemyRarity(floor, boss, difficulty, rng) {
  let lvl = (floor - 1) / 120 - 0.45 + (boss ? 1.4 : difficulty * 0.8) + (rng() - 0.5) * 0.9;
  return RARITY_ORDER[Math.max(0, Math.min(5, Math.round(lvl)))];
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
    if (a.atkMul) u.atk = Math.round(u.atk * (1 + a.atkMul));
    if (a.defMul) u.def = Math.round(u.def * (1 + a.defMul));
    if (a.spdMul) u.spd = Math.max(1, Math.round(u.spd * (1 + a.spdMul)));
    if (a.thorns) u.effects.thorns = Math.min(0.6, (u.effects.thorns || 0) + a.thorns);
    if (a.regenPct) u.effects.regen = (u.effects.regen || 0) + Math.round((u.maxHp || 0) * a.regenPct);
  }
  wave.aura = squad.aura; // tag for UI/debug
  return wave;
}

// the realm a rank's PEAK sits at (for full-loadout slot counts) — mortal (R-1)*4+3, immortal 20+(R-6).
const rankPeakRealm = (rank) => (rank <= 5 ? (rank - 1) * 4 + 3 : 20 + (rank - 6));
function enemyUnit(floor, name, { boss = false, difficulty = 0, kind = 'beast', rng = Math.random, squad = SQUADS.rabble, fullGu = false } = {}) {
  const rank = floorRealm(floor);
  const role = boss ? 'boss' : roleOf(name);
  const rarity = enemyRarity(floor, boss, difficulty, rng);    // gradient rarity → aptitude + trait tier
  const apt = (NPC_TEMPLATES[rarity] || NPC_TEMPLATES.Common).aptitude;
  let pool = poolForFloor(floor);
  if (boss) pool *= BOSS_POOL_MULT;               // bosses field a larger point pool (edge included)
  const base = deriveStats(roleAttrs(role, pool), budget(pool)); // attribute-derived stats (same as allies)

  // Gu loadout + traits apply as stat MULTIPLIERS + an effect bundle on top of the derived base.
  // Cultivators/bosses get a Gu kit; beasts get a few WILD Gu. Floors 1-3 stay plain.
  let atkM = 1, defM = 1, hpM = 1, spdM = 1;
  const cultivator = kind === 'cultivator' || boss;
  const wantGu = cultivator || floor >= 4;
  // gate-boss teams (fullGu) carry a FULL rank-appropriate loadout (every slot) like a serious cultivator;
  // ordinary foes carry fewer (cultivators a kit, beasts a couple of wild Gu).
  const guCount = fullGu ? guSlots(rankPeakRealm(rank))
    : cultivator ? Math.min(4, 2 + Math.floor(rank / 3)) : Math.min(2, 1 + Math.floor(rank / 4));
  const loadout = wantGu ? enemyGuLoadout(floor, rank, rng, guCount) : [];
  const affPath = (loadout[0] && loadout[0].daoPath) || themePath(name); // DAO PATH AFFINITY trait (its theme path)
  const samePath = loadout.filter((g) => g.daoPath === affPath).length;  // same-path count → RESONANCE
  const reso = enemyResonance(samePath);                                 // stacking one path pays off (like allies)
  const rateFx = {}, riders = []; let regenFrac = 0, guAtkM = 1; // guAtkM = Gu-only atk mult (channel floor)
  const RATE_MAP = { crit: 'crit', critDmg: 'critDamage', critRes: 'critResist', statusRes: 'statusResist',
    evasion: 'dodge', hit: 'hitChance', armorPen: 'armorPen', lifesteal: 'lifesteal', thorns: 'thorns',
    potency: 'potency', lucky: 'luckyHit' };
  for (const gu of loadout) {
    const amp = gu.daoPath === affPath ? AFFINITY_EFFECT_MULT * reso : 1; // affinity (+10%) × resonance on its path
    for (const e of (gu.effects || [])) {
      const k = e.kind, v = (e.value || 0) * amp;
      if (k === 'status') riders.push({ type: e.status, base: e.chance, dur: e.dur, mag: e.dot });
      else if (k === 'atk') { atkM *= 1 + v; guAtkM *= 1 + v; }
      else if (k === 'def') defM *= 1 + v;
      else if (k === 'hp') hpM *= 1 + v;
      else if (k === 'spd') spdM *= 1 + v;
      else if (k === 'regen') regenFrac += v;
      else if (RATE_MAP[k]) rateFx[RATE_MAP[k]] = (rateFx[RATE_MAP[k]] || 0) + v;
      // essPool/essRcv: not modelled for enemy Gu lines
    }
  }
  if (cultivator) {
    // cultivators are inherently better-honed than wild beasts of the same role (deepens with rank)
    const gt = Math.max(1, Math.min(6, 1 + Math.floor(rank * 0.7)));
    atkM *= 1.10 + gt * 0.02; defM *= 1.14 + gt * 0.03; hpM *= 1.08 + gt * 0.02;
  }

  // TIERED LINE trait (archetype) at this unit's RARITY, chosen by the floor's squad theme for its role —
  // folded into the SAME stat mults / combat-rate adds allies use (lineEffects bag). Support-line auras
  // are applied later at the wave level (applyEnemyAura). Essence %/apBase fold into the pool below.
  const lineId = squad.lines[role] || null;
  const lb = (lineId && LINES[lineId] && LINES[lineId].tiers) ? LINES[lineId].tiers[rarity] : null;
  let essPoolPct = 0, essRcvPct = 0, apBase = 0;
  if (lb) {
    atkM *= 1 + (lb.atkPct || 0); defM *= 1 + (lb.defPct || 0); hpM *= 1 + (lb.hpPct || 0); spdM *= 1 + (lb.spdPct || 0);
    for (const k in RATE_MAP) if (lb[k]) rateFx[RATE_MAP[k]] = (rateFx[RATE_MAP[k]] || 0) + lb[k];
    essPoolPct = lb.essPoolPct || 0; essRcvPct = lb.essRcvPct || 0; apBase = lb.apBase || 0;
  }

  const maxHp = Math.round(base.maxHp * hpM);
  let atk = Math.round(base.atk * atkM);
  const atkBase = Math.round(base.atk * atkM / guAtkM); // atk WITHOUT the Gu atk% (the essence-channel floor)

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
  effects.inflicts = riders; // one rider per equipped status-Gu effect (declared chance/dot/dur)
  if (lb && lb.dotSpread) effects.dotSpread = (effects.dotSpread || 0) + lb.dotSpread;   // Afflictor extra
  if (lb && lb.essDrain) effects.essDrain = (effects.essDrain || 0) + lb.essDrain;       // Reaver extra
  for (const k in rateFx) effects[k] = (effects[k] || 0) + rateFx[k];
  if (regenFrac) effects.regen = (effects.regen || 0) + Math.round(regenFrac * maxHp);
  const CAP = { lifesteal: 0.9, crit: 0.95, dodge: 0.9, thorns: 0.6, extra_turn: 0.5 };
  for (const k in CAP) if (effects[k]) effects[k] = Math.min(effects[k], CAP[k]);

  const compCap = ENEMY_COMP_CAP[rank - 1];
  const comprehension = Math.min(compCap, Math.round(compCap * jitter(name + floor)));
  let daoMarks = 0; // stored for display / future; mark amplification on combat is deferred (the pool carries realm power now)
  if (rank >= 6) {
    const [lo, hi] = MARK_BAND[rank];
    daoMarks = Math.round((lo + (hi - lo) * (boss ? 1 : difficulty)) * jitter('m' + name + floor));
  }

  return {
    name, isBoss: boss, kind: cultivator ? 'cultivator' : 'beast', rank, role, rarity, line: lineId,
    daoPath: affPath,
    comprehension, daoMarks, gu: loadout.map((g) => g.name),
    guInfo: loadout.map((g) => ({ name: g.name, eff: effectText(g) })), // name + effect text for the arena traits panel

    maxHp, hp: maxHp, atk, atkBase,
    def: Math.round(base.def * defM),
    spd: Math.max(1, Math.round(base.spd * spdM)),
    // essence pool/regen: aptitude (by rarity) caps the usable APERTURE fraction, exactly like allies —
    // low-rarity (low-aptitude) foes under-power their Gu channeling, high-rarity sustain a heavy loadout.
    essencePool: Math.round((base.essencePool + apBase) * essenceQualityByRank(rank - 1) * apertureCapacity(apt) * (1 + essPoolPct)),
    essenceRegen: base.essenceRegen * apertureRegenFactor(apt) * (1 + essRcvPct),
    essenceCost: loadout.reduce((s, g) => s + guEssenceCostFor(g, rank), 0),
    effects,
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
