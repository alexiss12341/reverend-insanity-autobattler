// Character TRAITS — canon, hand-assigned per recruit (no rolling). A trait is a permanent character
// tag with a mechanical effect, mapped from Reverend Insanity lore.
//
// The FIRST and universal trait is the DAO PATH AFFINITY: every (non-special) character has exactly
// one, fixed by canon. An affinity does two things, BOTH MULTIPLICATIVE, for its path only:
//   1. EFFECTIVENESS — multiplies that path's Gu effects by AFFINITY_EFFECT_MULT. Folds into the
//      comprehension × resonance multiplier chain in systems/cultivation.js `effectiveStats`.
//   2. COMPREHENSION — accelerates that path's comprehension-XP gain by AFFINITY_COMP_MULT, applied
//      in main.js `commitComprehension`.
//
// The non-affinity trait LINES (Slayer / Wall / Plaguebringer / …) are designed but NOT built yet —
// they'll live here too. See project memory `npc-traits-system`.
import { pathList, pathCjk, pathName } from './daoPaths.js';
import { rarityTier } from './rarities.js';

export const AFFINITY_EFFECT_MULT = 1.10; // +10% effectiveness of the affined path's Gu effects
export const AFFINITY_COMP_MULT = 1.25;   // +25% comprehension-XP gain in the affined path

// Display label for an affinity, e.g. 'strength' → "Strength Dao Affinity". Path names in the registry
// carry a " Path" suffix, so strip it before swapping in "Dao Affinity".
export const affinityName = (pathId) =>
  pathId ? `${pathName(pathId).replace(/ Path$/, '')} Dao Affinity` : null;

// FULL CATALOGUE: one Dao Path Affinity trait per dao path, generated from the registry so it stays in
// lockstep with daoPaths.js. INCLUDES the three locked Supreme paths (Heaven/Human/Rule) as
// AFFINITY-ONLY traits — a character may be born with a Supreme affinity even though that path's Gu and
// crafting stay locked (the affinity is an identity tag + its bonus until the path ever opens).
// These are the trait DEFINITIONS; ASSIGNING one to a character is separate (see AFFINITY below).
export const AFFINITY_TRAITS = pathList()
  .map((p) => ({
    id: `affinity_${p.id}`,
    path: p.id,
    name: affinityName(p.id),
    cjk: pathCjk(p.id),
    effectMult: AFFINITY_EFFECT_MULT,
    compMult: AFFINITY_COMP_MULT,
  }));

const _affinityByPath = Object.fromEntries(AFFINITY_TRAITS.map((t) => [t.path, t]));
// The affinity-trait definition for a path id (or null for locked/unknown paths).
export const affinityTrait = (pathId) => _affinityByPath[pathId] || null;

// CANON assignment: recruit NAME → a dao path id, OR an ARRAY of path ids for the rare "very special"
// characters (Venerables and the like) who hold MORE THAN ONE affinity. Most heroes have exactly one.
// Names MUST match data/npcs.js NAMED_HEROES exactly. Fang Yuan (the player) stays absent. Filled
// hero-by-hero during the canon assignment pass.
export const AFFINITY = {
  // ---- Immortal (Venerables) ----
  'Spectral Soul Demon Venerable': ['killing', 'soul'],   // Reaver
  'Red Lotus Demon Venerable': 'time',                    // Tempest
  'Star Constellation Sage': ['wisdom', 'star'],          // Commander
  'Giant Sun Immortal Venerable': ['luck', 'blood'],      // Fortune
  'Paradise Earth Venerable': 'earth',                    // Mender
  'Genesis Lotus': ['wood', 'painting'],                  // Foundation
  'Limitless Demon Venerable': ['restriction', 'phantom'],// Adept
  'Thieving Heaven': ['theft', 'space'],                  // Reaver
  'Reckless Savage Demon Venerable': 'transformation',    // Slayer
  // ---- Legendary (rank 8) ----
  'Feng Jiu Ge': 'sound',                                 // Vanguard
  'Bai Ning Bing': ['ice', 'snow'],                       // Afflictor
  'Tai Bai Yun Sheng': ['time', 'cloud'],                 // Warden
  'Wu Yong': 'wind',                                      // Slayer
  'Bo Qing': 'sword',                                     // Slayer
  'Lang Ya': 'refinement',                                // Commander
  'Duke Long': ['qi', 'transformation'],                  // Vanguard
  'Lu Wei Yin': 'earth',                                  // Warden
  'Bing Sai Chuan': 'time',                               // Tempest
  'Qing Chou': 'soul',                                    // Slayer
  'Chu Du': 'strength',                                   // Slayer
  'Fairy Zi Wei': 'wisdom',                               // Commander
  'Purple Mountain True Monarch': 'wisdom',               // Commander
  'Bai Cang Shui': 'water',                               // Tempest
  'Hei Fan': ['time', 'enslavement'],                     // Afflictor
  'Shi Lei': ['earth', 'transformation'],                 // Wall
  'Ba Shi Ba': ['phantom', 'restriction'],                // Wall
  // ---- Epic (rank 6-7) ----
  'Hei Lou Lan': ['strength', 'fire', 'dark'],            // Vanguard (triple affinity)
  'Mo Yao': 'refinement',                                 // Mender
  'Zhao Lian Yun': 'wisdom',                              // Mender
  'Zi Yan Ran': 'dream',                                  // Afflictor
  'Dong Fang Chang Fan': 'wisdom',                        // Slayer
  'Murong Qing Si': 'wood',                               // Tempest
  'Hei Cheng': 'dark',                                    // Assassin
  'Qin Bai Sheng': ['soul', 'metal'],                     // Commander
  'Chi Shang': 'formation',                               // Afflictor
  'Gu Yue Fang Zheng': 'blood',                           // Vanguard
  'Fairy Li Shan': 'information',                         // Afflictor
  'Fairy Jiang Yu': 'dark',                               // Assassin
  'Fairy Qing Suo': 'wood',                               // Mender
  'Fairy Fen Meng': 'wood',                               // Afflictor
  'Old Man Yan Shi': 'wisdom',                            // Commander
  'Yin Liu Gong': 'transformation',                       // Wall
  'Jian Yi Sheng': ['sword', 'metal'],                    // Assassin
  'Qian Zhu Xian': 'wood',                                // Afflictor
  'Valley Lord Ming He': ['water', 'soul'],               // Commander
  'Guan Shen Zhao': 'information',                         // Afflictor
  'Ye Lui Qun Xing': 'star',                              // Wall
  'Ma Hong Yun': 'luck',                                  // Fortune (moved Rare→Epic)
  'Feng Jin Huang': 'dream',                              // Afflictor (moved Rare→Epic)
};

// Normalize a map value / stored field (string | array | null) into an array of path ids (a copy, so
// callers can't mutate the canon map).
const _arr = (v) => (Array.isArray(v) ? v.slice() : v ? [v] : []);

// The canon affinity path(s) for a character NAME — an array (empty if none assigned yet).
export const affinityFor = (name) => _arr(AFFINITY[name]);

// A character's affinity path ids — an array (tolerant of a legacy single string / null).
export const affinityPaths = (ch) => _arr(ch && ch.affinity);

// Whether a character is affined to a given path.
export const hasAffinity = (ch, pathId) => affinityPaths(ch).includes(pathId);

// Multiplier a character's affinity grants to a GIVEN path (1 = no bonus on off-affinity paths).
export const affinityEffectMult = (ch, pathId) => (hasAffinity(ch, pathId) ? AFFINITY_EFFECT_MULT : 1);
export const affinityCompMult = (ch, pathId) => (hasAffinity(ch, pathId) ? AFFINITY_COMP_MULT : 1);

// ===================== ARCHETYPE LINES (build/role traits) =====================
// A character carries ONE line, canon-assigned by name (like affinity). The line grants a tier-scaled
// bonus AT THE CHARACTER'S RARITY. Combat lines express their bonus as an effect bag using the SAME
// field names as `effectiveStats`'s `add` accumulator (atkPct/defPct/hpPct/spdPct/crit/critDmg/
// evasion/hit/armorPen/lifesteal/thorns/potency/statusRes/lucky/essPoolPct/essRcvPct) — so they layer
// straight into the existing combat math, no new fields. The ADEPT line instead amplifies EVERY Gu's
// effect (path-agnostic) via `guAmp` (a multiplier on the per-Gu chain, like affinity but for all paths).
//
// The SUPPORT trio (Warden/Commander/Mender) use TEAM effects instead of a per-unit add-bag: each has
// an `aura` bag per rarity (systems/battle.js). Commander buffs team ATK/SPD and Warden hardens team
// DEF/thorns + draws aggro (TAUNT) — both applied once at battle start by `applyTeamAuras`. The Mender's
// `regenPct` instead drives a TEAM HEAL that fires on the Mender's OWN action (`teamHeal`), restoring
// each living ally by that % of their max HP. Magnitudes are first-draft tuning.
export const LINES = {
  wall:      { name: 'The Wall',      role: 'Tank / lane anchor', tiers: {
    Common:    { hpPct: 0.05 },
    Uncommon:  { defPct: 0.10 },
    Rare:      { defPct: 0.12, statusRes: 0.08 },
    Epic:      { defPct: 0.18, hpPct: 0.12 },
    Legendary: { defPct: 0.30, hpPct: 0.30, thorns: 0.15 },
    Immortal:  { hpPct: 0.40, defPct: 0.40 },
  } },
  vanguard:  { name: 'The Vanguard',  role: 'Bruiser', tiers: {
    Common:    { atkPct: 0.05, hpPct: 0.05 },
    Uncommon:  { atkPct: 0.08, defPct: 0.08 },
    Rare:      { atkPct: 0.12, hpPct: 0.10 },
    Epic:      { atkPct: 0.18, defPct: 0.12 },
    Legendary: { atkPct: 0.25, hpPct: 0.18, defPct: 0.18 },
    Immortal:  { atkPct: 0.35, hpPct: 0.30, defPct: 0.30 },
  } },
  slayer:    { name: 'The Slayer',    role: 'Carry / glass ATK', tiers: {
    Common:    { atkPct: 0.05 },
    Uncommon:  { atkPct: 0.08, hit: 0.05 },
    Rare:      { atkPct: 0.15, defPct: -0.08 },   // Berserker (flaw)
    Epic:      { atkPct: 0.20, armorPen: 0.10 },
    Legendary: { atkPct: 0.28, critDmg: 0.15 },
    Immortal:  { atkPct: 0.40, armorPen: 0.20 },
  } },
  assassin:  { name: 'The Assassin',  role: 'Crit burst / kill-securer', tiers: {
    Common:    { crit: 0.03 },
    Uncommon:  { crit: 0.05 },
    Rare:      { crit: 0.08, critDmg: 0.15 },
    Epic:      { crit: 0.12, critDmg: 0.20 },
    Legendary: { crit: 0.15, critDmg: 0.35 },
    Immortal:  { crit: 0.25, critDmg: 0.50 },
  } },
  tempest:   { name: 'The Tempest',   role: 'Skirmisher / tempo', tiers: {
    Common:    { spdPct: 0.04 },
    Uncommon:  { spdPct: 0.08 },
    Rare:      { spdPct: 0.10, evasion: 0.06 },
    Epic:      { spdPct: 0.12, crit: 0.10 },
    Legendary: { spdPct: 0.18, evasion: 0.15 },
    Immortal:  { spdPct: 0.25, evasion: 0.10 },
  } },
  afflictor: { name: 'The Afflictor', role: 'Debuffer / control', tiers: {
    Common:    { potency: 0.04 },
    Uncommon:  { potency: 0.10 },
    Rare:      { potency: 0.15 },
    Epic:      { potency: 0.25, dotSpread: 0.15 },
    Legendary: { potency: 0.30, dotSpread: 0.30 },
    Immortal:  { potency: 0.40, dotSpread: 0.50 },
  } },
  reaver:    { name: 'The Reaver',    role: 'Vampire / sustain', tiers: {
    Common:    { lifesteal: 0.03 },
    Uncommon:  { lifesteal: 0.06 },
    Rare:      { lifesteal: 0.09 },
    Epic:      { lifesteal: 0.12 },
    Legendary: { lifesteal: 0.18, essDrain: 0.10 },
    Immortal:  { lifesteal: 0.25, essDrain: 0.15 },
  } },
  foundation:{ name: 'The Foundation',role: 'Channeler / aperture', tiers: {
    // apBase = flat boost to the BASE essence pool, added BEFORE the rank-quality & aptitude-capacity
    // multipliers in effectiveStats (the "aperture-capacity" half); essPoolPct/essRcvPct are the % half.
    Common:    { essPoolPct: 0.05, apBase: 8 },
    Uncommon:  { essPoolPct: 0.08, apBase: 14 },
    Rare:      { essPoolPct: 0.12, essRcvPct: 0.12, apBase: 22 },
    Epic:      { essPoolPct: 0.18, essRcvPct: 0.15, apBase: 32 },
    Legendary: { essPoolPct: 0.25, essRcvPct: 0.20, apBase: 46 },
    Immortal:  { essPoolPct: 0.35, essRcvPct: 0.30, apBase: 64 },
  } },
  fortune:   { name: 'The Fortune',   role: 'Prospector / luck-striker', tiers: {
    // `fortune` = the ECONOMY half (read by economy.js): raises each resource's drop CHANCE and the drop
    // QUANTITY while farming (and nudges stone yield). Combat half (crit / lucky-hit / crit-dmg) rides effectiveStats.
    Common:    { crit: 0.01, lucky: 0.05, fortune: 0.08 },
    Uncommon:  { crit: 0.02, lucky: 0.08, fortune: 0.10 },
    Rare:      { crit: 0.03, lucky: 0.10, fortune: 0.12 },
    Epic:      { crit: 0.04, lucky: 0.12, critDmg: 0.10, fortune: 0.15 },
    Legendary: { crit: 0.05, lucky: 0.15, critDmg: 0.20, fortune: 0.20 },
    Immortal:  { crit: 0.07, lucky: 0.20, critDmg: 0.30, fortune: 0.25 },
  } },
  // ADEPT: amplifies EVERY Gu's effect (all paths) — applied as a per-Gu multiplier, not an add-bag.
  adept:     { name: 'The Adept',     role: 'Gu virtuoso / amplifier', guAmp: {
    Common: 0.05, Uncommon: 0.08, Rare: 0.12, Epic: 0.16, Legendary: 0.22, Immortal: 0.30,
  } },
  // SUPPORT trio — TEAM AURAS (no add-bag `tiers`; the per-rarity `aura` bag is summed across the team
  // and applied at battle start by systems/battle.js applyTeamAuras). Warden also flags TAUNT.
  warden:    { name: 'The Warden',    role: 'Protector support', aura: {
    Common:    { defMul: 0.05, taunt: true },
    Uncommon:  { defMul: 0.08, taunt: true },
    Rare:      { defMul: 0.10, taunt: true },
    Epic:      { defMul: 0.12, thorns: 0.10, taunt: true },
    Legendary: { defMul: 0.18, thorns: 0.15, taunt: true },
    Immortal:  { defMul: 0.25, thorns: 0.20, taunt: true },
  } },
  commander: { name: 'The Commander', role: 'Buffer / leader', aura: {
    Common:    { atkMul: 0.03 },
    Uncommon:  { atkMul: 0.05, spdMul: 0.03 },
    Rare:      { atkMul: 0.08 },
    Epic:      { atkMul: 0.10, spdMul: 0.05 },
    Legendary: { atkMul: 0.14, spdMul: 0.08 },
    Immortal:  { atkMul: 0.20, spdMul: 0.12 },
  } },
  mender:    { name: 'The Mender',    role: 'Healer / restoration', aura: {
    Common:    { regenPct: 0.01 },
    Uncommon:  { regenPct: 0.02 },
    Rare:      { regenPct: 0.03 },
    Epic:      { regenPct: 0.04 },
    Legendary: { regenPct: 0.06 },
    Immortal:  { regenPct: 0.08 },
  } },
};

// Stable display ORDER for the lines (roughly offense → defense → sustain → utility → support). Drives
// the new-game archetype picker (ui.js starterArchetypePicker); also a single source of truth for "all
// lines". Every key of LINES must appear here exactly once (guarded by a features.test integrity check).
export const LINE_ORDER = [
  'vanguard', 'slayer', 'assassin', 'tempest', 'wall',
  'reaver', 'afflictor', 'foundation', 'fortune', 'adept',
  'warden', 'commander', 'mender',
];

// CANON line assignment: recruit NAME → line id. Immortal→Epic filled; Rare/Uncommon/Common pending.
export const LINE_ASSIGN = {
  // ---- Immortal ----
  'Spectral Soul Demon Venerable': 'reaver',
  'Red Lotus Demon Venerable': 'tempest',
  'Star Constellation Sage': 'commander',
  'Giant Sun Immortal Venerable': 'fortune',
  'Paradise Earth Venerable': 'wall',
  'Genesis Lotus': 'foundation',
  'Limitless Demon Venerable': 'adept',
  'Thieving Heaven': 'reaver',
  'Reckless Savage Demon Venerable': 'slayer',
  // ---- Legendary ----
  'Feng Jiu Ge': 'vanguard',
  'Bai Ning Bing': 'afflictor',
  'Tai Bai Yun Sheng': 'warden',
  'Wu Yong': 'slayer',
  'Bo Qing': 'slayer',
  'Lang Ya': 'commander',
  'Duke Long': 'vanguard',
  'Lu Wei Yin': 'warden',
  'Bing Sai Chuan': 'tempest',
  'Qing Chou': 'slayer',
  'Chu Du': 'slayer',
  'Fairy Zi Wei': 'commander',
  'Purple Mountain True Monarch': 'commander',
  'Bai Cang Shui': 'tempest',
  'Hei Fan': 'afflictor',
  'Shi Lei': 'wall',
  'Ba Shi Ba': 'wall',
  // ---- Epic ----
  'Hei Lou Lan': 'vanguard',
  'Mo Yao': 'mender',
  'Zhao Lian Yun': 'mender',
  'Zi Yan Ran': 'afflictor',
  'Dong Fang Chang Fan': 'slayer',
  'Murong Qing Si': 'tempest',
  'Hei Cheng': 'assassin',
  'Qin Bai Sheng': 'commander',
  'Chi Shang': 'afflictor',
  'Gu Yue Fang Zheng': 'vanguard',
  'Fairy Li Shan': 'afflictor',
  'Fairy Jiang Yu': 'assassin',
  'Fairy Qing Suo': 'mender',
  'Fairy Fen Meng': 'afflictor',
  'Old Man Yan Shi': 'commander',
  'Yin Liu Gong': 'wall',
  'Jian Yi Sheng': 'assassin',
  'Qian Zhu Xian': 'afflictor',
  'Valley Lord Ming He': 'commander',
  'Guan Shen Zhao': 'afflictor',
  'Ye Lui Qun Xing': 'wall',
  'Ma Hong Yun': 'fortune',
  'Feng Jin Huang': 'afflictor',
};

// The canon line id for a character NAME (or null if unassigned).
export const lineFor = (name) => LINE_ASSIGN[name] || null;
// A character's line id (null if none).
export const lineOf = (ch) => (ch && ch.line) || null;

// TIERED archetype epithets: a rarity ladder of display names per line. The line's EFFECTS are tiered via
// LINES[id].tiers; this tiers the NAME, so a Common Wall reads "Shieldbearer" and an Immortal one
// "Immovable World-Root". lineName() resolves by rarity, falling back to the flat LINES[id].name.
const LINE_NAMES = {
  wall:      { Common: 'Shieldbearer', Uncommon: 'Bulwark Guard', Rare: 'Ironwall Sentinel', Epic: 'Aegis Warden', Legendary: 'Mountain Bastion', Immortal: 'Immovable World-Root' },
  vanguard:  { Common: 'Footsoldier', Uncommon: 'Shock Trooper', Rare: 'War-Captain', Epic: 'Battle Marshal', Legendary: 'Warlord', Immortal: 'Calamity Vanguard' },
  slayer:    { Common: 'Cutthroat', Uncommon: 'Blade-for-Hire', Rare: 'Executioner', Epic: 'Deathbringer', Legendary: 'Worldcleaver', Immortal: 'Calamity Edge' },
  assassin:  { Common: 'Knifehand', Uncommon: 'Nightstalker', Rare: 'Shadowblade', Epic: 'Soulreaper', Legendary: 'Phantom Killer', Immortal: 'Crimson Specter' },
  tempest:   { Common: 'Skirmisher', Uncommon: 'Windrunner', Rare: 'Galewalker', Epic: 'Storm-dancer', Legendary: 'Tempest Lord', Immortal: 'Eye of the Storm' },
  afflictor: { Common: 'Hexling', Uncommon: 'Plague-touched', Rare: 'Curse-weaver', Epic: 'Plaguebringer', Legendary: 'Doomcaller', Immortal: 'Calamity Witch' },
  reaver:    { Common: 'Bloodletter', Uncommon: 'Leech', Rare: 'Bloodreaver', Epic: 'Lifedrinker', Legendary: 'Crimson Glutton', Immortal: 'Blood Sovereign' },
  foundation:{ Common: 'Apprentice', Uncommon: 'Adept Channeler', Rare: 'Aperture Sage', Epic: 'Essence Vessel', Legendary: 'Dao Wellspring', Immortal: 'Boundless Aperture' },
  fortune:   { Common: 'Scrounger', Uncommon: 'Coin-touched', Rare: 'Lucky Hand', Epic: 'Fortune-seeker', Legendary: 'Golden Omen', Immortal: "Heaven's Favored" },
  adept:     { Common: 'Gu-handler', Uncommon: 'Gu Adept', Rare: 'Gu Virtuoso', Epic: 'Gu Master', Legendary: 'Gu Grandmaster', Immortal: 'Gu Sovereign' },
  warden:    { Common: 'Guardsman', Uncommon: 'Protector', Rare: 'Shield-warden', Epic: 'Lifeguard', Legendary: 'Bulwark Lord', Immortal: 'Eternal Warden' },
  commander: { Common: 'Sergeant', Uncommon: 'Lieutenant', Rare: 'Captain', Epic: 'Battle Commander', Legendary: 'War-Marshal', Immortal: 'Supreme Commander' },
  mender:    { Common: 'Field-medic', Uncommon: 'Healer', Rare: 'Life-tender', Epic: 'Restorer', Legendary: 'Lifebloom Sage', Immortal: 'Genesis Healer' },
};
// Rarity-appropriate display name for a line (falls back to the flat name when rarity is unknown).
export const lineName = (id, rarity) => {
  const L = LINES[id]; if (!L) return null;
  return (rarity && LINE_NAMES[id] && LINE_NAMES[id][rarity]) || L.name;
};
export const lineRole = (id) => (LINES[id] ? LINES[id].role : null);

// A single-glyph CJK SEAL per line (UI accent, mirrors daoPaths.js pathCjk). Thematic, not mechanical.
const LINE_CJK = {
  wall: '壁', vanguard: '鋒', slayer: '殺', assassin: '刺', tempest: '風',
  afflictor: '疫', reaver: '血', foundation: '基', fortune: '福', adept: '蠱',
  warden: '護', commander: '帥', mender: '醫',
};
export const lineCjk = (id) => LINE_CJK[id] || '蛊';

// One-line plain-language summary of what each line DOES (the archetype picker shows it under the name).
const LINE_BLURB = {
  wall:      'An immovable anchor — stacks DEF and HP to shield the lane behind it.',
  vanguard:  'A frontline bruiser — balanced ATK, HP and DEF to trade blows and endure.',
  slayer:    'A glass cannon — raw ATK and armour-shredding, at the cost of its own guard.',
  assassin:  'A burst killer — high crit chance and crit damage to delete soft targets.',
  tempest:   'A skirmisher — extra SPD and evasion to act often and slip blows.',
  afflictor: 'A debuffer — boosts status potency and spreads damage-over-time on a kill.',
  reaver:    'A vampire — heals on every hit and drains the enemy’s essence reserves.',
  foundation:'A channeller — deepens the essence aperture so heavy Gu loadouts never starve.',
  fortune:   'A lucky striker — crit/lucky hits in battle and richer loot while farming.',
  adept:     'A Gu virtuoso — amplifies EVERY equipped Gu’s effect, whatever its path.',
  warden:    'A protector — taunts foes and hardens the whole team’s DEF (team aura).',
  commander: 'A leader — buffs the whole team’s ATK and SPD (team aura).',
  mender:    'A healer — restores the team and cleanses debuffs when it acts (team aura).',
};
export const lineBlurb = (id) => LINE_BLURB[id] || '';
// The effect bag for a character's line AT THEIR RARITY (null if none / support phase-2 / unknown tier).
export function lineEffects(ch) {
  const L = LINES[lineOf(ch)];
  if (!L || !L.tiers) return null;
  return L.tiers[ch && ch.rarity] || null;
}
// Adept-line Gu amplifier for a character at their rarity (0 if not an Adept).
export function lineGuAmp(ch) {
  const L = LINES[lineOf(ch)];
  if (!L || !L.guAmp) return 0;
  return L.guAmp[ch && ch.rarity] || 0;
}
// Support-line TEAM AURA bag for a character at their rarity (applied team-wide in battle; null if none).
export function lineAura(ch) {
  const L = LINES[lineOf(ch)];
  if (!L || !L.aura) return null;
  return L.aura[ch && ch.rarity] || null;
}

// ===================== ARENA DISPLAY SUMMARIES (auras + their sources) =====================
// These build the data the battle arena's per-side "Auras & Traits" panel reads. They DON'T touch
// combat — battle.js (allies) / floors.js (enemies) already applied the actual stat buffs; these just
// re-derive WHICH aura is active and FROM WHOM so the UI can attribute it.

// An aura effect bag → short human-readable effect strings, e.g. {atkMul:.2, spdMul:.12} →
// ["+20% ATK", "+12% SPD"]. Order mirrors how the auras read thematically.
export function auraEffectList(bag) {
  if (!bag) return [];
  const out = [];
  if (bag.atkMul)   out.push(`+${Math.round(bag.atkMul * 100)}% ATK`);
  if (bag.defMul)   out.push(`+${Math.round(bag.defMul * 100)}% DEF`);
  if (bag.spdMul)   out.push(`+${Math.round(bag.spdMul * 100)}% SPD`);
  if (bag.thorns)   out.push(`+${Math.round(bag.thorns * 100)}% Thorns`);
  if (bag.regenPct) out.push(`Heal ${Math.round(bag.regenPct * 100)}%/turn`);
  if (bag.taunt)    out.push('Taunt');
  return out;
}

// A COMBAT-line effect bag (the per-rarity LINES[id].tiers[rarity], which uses effectiveStats `add` field
// names) → human-readable strings, e.g. {atkPct:.25, hpPct:.18} → ["+25% ATK", "+18% Max HP"]. Signed, so
// a flaw like the Slayer's defPct:-0.08 reads "−8% DEF". apBase is a flat aperture boost. Used by the arena
// panel to show each cultivator's archetype bonuses (these are folded into the unit's own stats, not auras).
const LINE_EFF_LABEL = [
  ['atkPct', 'ATK'], ['hpPct', 'Max HP'], ['defPct', 'DEF'], ['spdPct', 'SPD'], ['crit', 'Crit'],
  ['critDmg', 'Crit Dmg'], ['evasion', 'Evasion'], ['hit', 'Hit'], ['armorPen', 'Armor Pen'],
  ['lifesteal', 'Lifesteal'], ['thorns', 'Thorns'], ['potency', 'Potency'], ['statusRes', 'Status Resist'],
  ['lucky', 'Lucky Hit'], ['essPoolPct', 'Aperture'], ['essRcvPct', 'Essence Regen'],
  ['dotSpread', 'DoT Spread'], ['essDrain', 'Essence Drain'], ['fortune', 'Fortune (loot)'],
];
export function lineEffectList(bag) {
  if (!bag) return [];
  const out = [];
  for (const [k, label] of LINE_EFF_LABEL) { const v = bag[k]; if (v) out.push(`${v >= 0 ? '+' : '−'}${Math.round(Math.abs(v) * 100)}% ${label}`); }
  if (bag.apBase) out.push(`+${bag.apBase} base Aperture`);
  return out;
}

// Human-readable effect strings for ANY line at a GIVEN rarity, abstracting over the three shapes a line
// can take: combat `tiers` (add-bag), `aura` (support team buff), or `guAmp` (Adept's per-Gu multiplier).
// Used by the new-game archetype picker to show each line's full rarity ladder.
export function lineTierEffects(id, rarity) {
  const L = LINES[id];
  if (!L) return [];
  if (L.guAmp) { const v = L.guAmp[rarity]; return v ? [`+${Math.round(v * 100)}% all Gu effects`] : []; }
  if (L.aura) return auraEffectList(L.aura[rarity]);
  return lineEffectList(L.tiers ? L.tiers[rarity] : null);
}

// ALLY support-team auras for display: ONE winner per support line (Commander/Warden/Mender). `units`
// is a LITE list [{ line, rarity, realm, name }]. Winner per line = highest rarity → realm (first wins
// ties) — mirrors systems/battle.js applyTeamAuras' selection, minus its random tiebreak (stable for UI).
// Returns [{ lineId, name, source, bag }] (bag = the winner's aura at its rarity).
export function allyAuraSummary(units) {
  const byLine = {};
  for (const u of units || []) {
    const L = LINES[u.line];
    if (L && L.aura && L.aura[u.rarity]) (byLine[u.line] = byLine[u.line] || []).push(u);
  }
  const out = [];
  for (const id in byLine) {
    let best = byLine[id][0];
    for (const u of byLine[id]) {
      const dr = rarityTier(u.rarity) - rarityTier(best.rarity);
      if (dr > 0 || (dr === 0 && (u.realm || 0) > (best.realm || 0))) best = u;
    }
    out.push({ lineId: id, name: lineName(id, best.rarity), source: best.name, bag: LINES[id].aura[best.rarity] });
  }
  return out;
}

// ENEMY wave aura for display: floors.js bakes at most ONE squad aura across a wave, tagged on the wave
// array as `wave.aura` (a support-line id) at the LEAD (highest-rarity) unit's rarity. `wave` is the raw
// unit array carrying that tag. Returns { lineId, name, source, bag } or null when the wave has no aura.
export function enemyWaveAura(wave) {
  if (!wave || !wave.aura) return null;
  const L = LINES[wave.aura];
  if (!L || !L.aura || !wave.length) return null;
  let lead = wave[0];
  for (const u of wave) if (rarityTier(u.rarity) > rarityTier(lead.rarity)) lead = u;
  const bag = L.aura[lead.rarity];
  return bag ? { lineId: wave.aura, name: lineName(wave.aura, lead.rarity), source: lead.name, bag } : null;
}
