// Newer features: enemy effects, gacha pity/dismiss, prestige, statuses, path-bound recipes.
import { ok, section } from './assert.mjs';
import { state, newGame, immortalUnlocked } from '../src/state.js';
import { generateEncounter } from '../src/data/floors.js';
import { resolveEncounter, applyTeamAuras, teamHeal, cleanseTeam } from '../src/systems/battle.js';
import { pull, dismiss, pityCount, PITY_CAP, imprint, imprintCandidates, IMPRINT_CAP } from '../src/systems/gacha.js';
import { effectiveStats, breakthroughCost, breakthroughChance, breakthroughFloorReq, attemptBreakthrough, isInjured, respecAttributes, respecCost, RESPEC_COST_PER_POINT } from '../src/systems/cultivation.js';
import { addComprehension, injuryMult, resonanceMult } from '../src/systems/dao.js';
import { prestige, buyBoon, reincarnate, canReincarnate, soulsAward, prestigeCombatMult } from '../src/systems/prestige.js';
import { rollFloorRewards, teamFortune, teamLuck, dropBonus, dropChance, farmEssenceEV, rollImmortalStones, immortalGuCount, immortalGuUpkeep, IMM_STONE_UPKEEP_PER_GU } from '../src/systems/economy.js';
import { statusForPath, STATUS } from '../src/data/status.js';
import { guList, guEssenceCost, guEssenceCostFor, recipeFor, GU_LIB, guUsingResource, resolveOwned, nextTierOf, signatureGusForPath, pathStatuses, signatureImmortalGu, effectText } from '../src/data/gu.js';
import { craft, canUpgrade, upgrade } from '../src/systems/crafting.js';
import { B } from '../src/data/guBudget.js';
import { RESOURCES, resourceList, resourcesForPath, rankRarity, universalRankWeights } from '../src/data/resources.js';
import { pathFloorReq, pathList, isPathLocked } from '../src/data/daoPaths.js';
import { NAMED_HEROES, nameForRarity } from '../src/data/npcs.js';
import { makeCharacter } from '../src/state.js';
import { RARITY_ORDER } from '../src/data/rarities.js';
import { apertureCapacity, apertureGrade, apertureRegenFactor, aptThreshold, aptitudeStepBonus, aptitudePointBonus, playerPool, effAttr, effAptitude, imprintAttrMult, spentPoints, unspentPoints } from '../src/data/attributes.js';
import { essenceQuality, IMMORTAL_START } from '../src/data/realms.js';
import { affinityName, affinityCompMult, affinityEffectMult, affinityTrait, AFFINITY, AFFINITY_TRAITS, AFFINITY_COMP_MULT,
  LINES, LINE_ASSIGN, LINE_ORDER, lineEffects, lineGuAmp, lineAura, lineName, lineEffectList, lineTierEffects, lineCjk, lineBlurb } from '../src/data/traits.js';

section('features: enemy effects');
state.current = newGame('t'); const S = state.current;
const boss = generateEncounter(50).waves.flat().find((u) => u.isBoss);
ok(boss && Object.keys(boss.effects).length > 0, 'deep bosses carry combat effects');
const fx1 = generateEncounter(1).waves.flat()[0].effects;
ok(!fx1.burn && !fx1.lifesteal && !fx1.thorns && !fx1.regen && !fx1.extra_turn, 'floor 1 mobs carry no themed effects (baseline crit/evasion only)');
ok(resolveEncounter(generateEncounter(1)).win, 'floor 1 remains winnable with effects in the system');
// ENEMY TRAITS + rarity gradient: shallow floors are plain Common (no trait line); deeper floors field
// higher-rarity foes carrying archetype LINES via per-floor squad themes — while RANK stays band-capped.
ok(generateEncounter(1).waves.flat().every((u) => u.rarity === 'Common' && !u.line), 'floor 1 mobs are plain Common with no trait line (trivially beatable)');
ok(generateEncounter(1).waves.flat().every((u) => u.rank === 1) && generateEncounter(50).waves.flat().every((u) => u.rank === 1),
  'floors 1-50 enemies stay RANK 1 (band-capped) even with traits');
ok(generateEncounter(250).waves.flat().every((u) => u.rank === 5), 'floor-250 enemies are RANK 5 (band-capped)');
const deepMobs = generateEncounter(250).waves.flat();
ok(deepMobs.some((u) => RARITY_ORDER.indexOf(u.rarity) >= 2) && deepMobs.some((u) => u.line), 'deep floors field higher-rarity enemies carrying trait lines');
ok(typeof generateEncounter(50).squad === 'string', 'an encounter exposes its squad-theme name (the floor gimmick)');
// gradient sanity: enemy power (atk+def+hp) rises with depth within the mortal band
const powAt = (f) => generateEncounter(f).waves.flat().reduce((s, u) => s + u.atk + u.def + u.maxHp, 0);
ok(powAt(50) > powAt(10) && powAt(100) > powAt(50), 'enemy power scales up gradually with floor depth');
// ESSENCE CHANNEL FLOOR: equipping a Gu must never lower the unaided base attack — `atkBase` is the atk
// with the Gu atk% stripped, and battle's effAtk only saps (atk − atkBase) by the channel factor.
state.current = newGame('chf'); const CF = state.current; const cc = CF.roster[0];
cc.realm = 3; cc.attrs = { str: 20, agi: 8, con: 12, int: 6, luck: 4 };
const bareAtk = effectiveStats(cc).atk;                       // no Gu → atk == atkBase
ok(effectiveStats(cc).atkBase === bareAtk, 'with no Gu equipped, atkBase equals atk');
CF.guInv.push({ uid: 'gak', guId: 'gu_metal_atk_t1' }); cc.gu = ['gak'];
const eg = effectiveStats(cc);
ok(eg.atk > eg.atkBase && Math.abs(eg.atkBase - bareAtk) <= 1,
  'an atk-Gu raises atk but atkBase stays the bare value (channel can only sap the Gu bonus, never the base swing)');
state.current = S; // restore the 't' save so later sections (gacha, …) keep their state

section('features: gacha pity & dismiss');
S.essence = 1e9; S.gachaPity = PITY_CAP - 1;
const before = S.roster.length; pull(1);
ok(S.roster.length === before + 1, 'pull adds a recruit');
ok(pityCount() === 0 || pityCount() < PITY_CAP, 'pity counter resets on Epic+ or advances otherwise');
const rec = pull(1).got[0]; rec.active = false; const e0 = S.essence; const dr = dismiss(rec.id);
ok(dr.ok && S.essence > e0, 'dismissing a benched recruit refunds essence');
ok(!dismiss(S.roster[0].id).ok, 'the player character cannot be dismissed');

section('features: prestige / reincarnation');
state.current = newGame('t3'); const S3 = state.current;
ok(!canReincarnate(), 'cannot reincarnate from floor 1');
S3.frontier = 22; S3.stats.floorsCleared = 30;
const award = soulsAward(); ok(award >= 5, 'soul award scales with progress');
const r = reincarnate(); ok(r.ok && state.current.frontier === 1, 'reincarnation resets the life');
ok(prestige().souls === award, 'Sovereign Souls persist across reincarnation');
prestige().souls = 999; const mc0 = prestigeCombatMult(); buyBoon('might'); const mc1 = prestigeCombatMult();
ok(mc1 > mc0, 'Sovereign Might raises the combat multiplier');
const g0 = rollFloorRewards(10, false).stones; buyBoon('fortune'); const g1 = rollFloorRewards(10, false).stones;
ok(g1 >= g0, 'Sovereign Fortune raises primeval stone gains');
const me = state.current.roster[0]; me.realm = 10;
ok(effectiveStats(me).atk > 0, 'effectiveStats works after prestige bonuses applied');

section('features: status system (Phase 3)');
ok(statusForPath('poison')?.type === 'poison' && statusForPath('fire')?.type === 'burn' && statusForPath('wood') === null,
  'path→status map is thematic and sparse (utility paths inflict nothing)');
ok(STATUS.stun.base < STATUS.burn.base, 'rarer statuses (Stun) carry a lower base inflict chance');
ok(statusForPath('ice')?.type === 'frozen' && statusForPath('snow')?.type === 'slow', 'Ice freezes (Frozen); Snow slows');
ok(Math.abs(STATUS.frozen.base - (STATUS.stun.base + 0.05)) < 1e-9 && STATUS.frozen.stun && STATUS.frozen.dispelledByFire,
  'Frozen lands 5% above Stun, skips actions, and is fire-dispellable');
state.current = newGame('ts'); const TS = state.current;
const sm = TS.roster[0];
// INT-heavy → high Potency AND enough APERTURE to actually channel a T5 status Gu (per-Gu essence gating
// drops a Gu the wielder can't afford — int 40 keeps the body weak so fights stay long, foes get to act).
sm.attrs = { str: 8, agi: 8, con: 10, int: 40, luck: 4 };
TS.guInv.push({ uid: 'gx', guId: 'gu_poison_st_poison_t5' }); sm.gu = ['gx']; // poison status Gu
ok(effectiveStats(sm).inflicts.some((s) => s.type === 'poison'), 'a poison-path Gu grants its wielder a Poison rider');
let afflicted = 0;
for (let i = 0; i < 60 && afflicted < 1; i++) resolveEncounter(generateEncounter(6), (m) => { if (/afflicted with/.test(m)) afflicted++; });
ok(afflicted > 0, 'statuses are inflicted on foes during combat');
// an Ice-path wielder freezes foes (skip-CC)
TS.guInv.push({ uid: 'gi', guId: 'gu_ice_st_frozen_t5' }); sm.gu = ['gi']; // ice status Gu → Frozen
ok(effectiveStats(sm).inflicts.some((s) => s.type === 'frozen'), 'an Ice-path Gu grants a Frozen rider');
let froze = 0;
for (let i = 0; i < 80 && froze < 1; i++) resolveEncounter(generateEncounter(6), (m) => { if (/frozen and cannot act/.test(m)) froze++; });
ok(froze > 0, 'Frozen foes skip their action');

section('features: per-Gu essence gating');
{
  // effectiveStats(ch, activeSet) is the foundation of battle's CHANNEL LADDER: only the Gu in the set
  // contribute effects / essence cost / HP / aperture — so an essence-starved loadout drops Gu wholesale.
  state.current = newGame('gate'); const Gst = state.current;
  const ch = Gst.roster[0];
  ch.attrs = { str: 40, agi: 10, con: 40, int: 40, luck: 5 };
  ch.realm = 11; // rank 3 Peak — ample aperture for low-tier Gu
  const atkId = Object.keys(GU_LIB).find((id) => { const g = GU_LIB[id]; return g.tier <= 3 && (g.effects || []).some((e) => e.kind === 'atk' && e.value > 0) && !(g.effects || []).some((e) => e.kind === 'status'); });
  // an HP Gu of a DIFFERENT Dao path than the ATK Gu, so same-path resonance doesn't couple their effects
  const atkPath = atkId && GU_LIB[atkId].daoPath;
  const hpId = Object.keys(GU_LIB).find((id) => { const g = GU_LIB[id]; return g.tier <= 3 && g.daoPath !== atkPath && (g.effects || []).some((e) => e.kind === 'hp' && e.value > 0); });
  ok(atkId && hpId, 'found a low-tier ATK Gu and a different-path HP Gu to build a test loadout');
  Gst.guInv.push({ uid: 'ga', guId: atkId }, { uid: 'gh', guId: hpId });
  ch.gu = ['ga', 'gh'];
  const bare = effectiveStats(ch, new Set());        // channel NO Gu = bare-handed attribute profile
  const justAtk = effectiveStats(ch, new Set(['ga'])); // channel only the ATK Gu (slot 1)
  const justHp = effectiveStats(ch, new Set(['gh']));
  const full = effectiveStats(ch);                   // full loadout (no filter)
  ok(bare.essenceCost === 0, 'channelling no Gu costs no essence');
  ok(justAtk.atk > bare.atk, 'channelling the ATK Gu raises ATK above the bare-handed swing');
  ok(justAtk.atk === full.atk, 'dropping the (non-ATK) HP Gu leaves ATK unchanged — effects are per-Gu, not blended');
  ok(full.maxHp > justAtk.maxHp, 'dropping the HP Gu lowers Max HP — HP is gated per-Gu, not structural');
  ok(Math.abs(full.essenceCost - (justAtk.essenceCost + justHp.essenceCost)) < 1e-9, 'full channel cost = sum of each Gu\'s cost (cumulative prefix)');
}
{
  // The gating THRESHOLD: a rank-1 wielder over-reaching with a T5 Gu can't channel it; raising aperture
  // (INT) lets the same wielder sustain it. (Battle picks the largest prefix whose cost ≤ current essence.)
  state.current = newGame('gate2'); const G2 = state.current;
  const w = G2.roster[0];
  w.attrs = { str: 8, agi: 8, con: 10, int: 24, luck: 4 };
  G2.guInv.push({ uid: 'gi', guId: 'gu_ice_st_frozen_t5' }); w.gu = ['gi'];
  const starved = effectiveStats(w, new Set(['gi']));
  ok(starved.essencePool < starved.essenceCost, 'a rank-1 wielder over-reaching with a T5 Gu cannot channel it (aperture < cost)');
  w.attrs = { str: 8, agi: 8, con: 10, int: 40, luck: 4 };
  const fed = effectiveStats(w, new Set(['gi']));
  ok(fed.essencePool >= fed.essenceCost, 'raising aperture (INT) lets the same wielder sustain the T5 Gu');
}

section('features: path-bound Gu recipes');
const allGu = guList();
ok(allGu.every((g) => Object.keys(g.recipe.resources).every((id) => RESOURCES[id])),
  'every Gu recipe references resources that exist');
ok(allGu.every((g) => Object.keys(g.recipe.resources).some((id) => RESOURCES[id] && RESOURCES[id].daoPath === g.daoPath)),
  "every Gu recipe consumes its OWN path's signature resource");
// a common-path tier-1 Gu's path material must be gatherable in its rank-1 realm band (early-accessible;
// resources now sub-window-spread WITHIN the band, so allow the whole 50-floor band rather than the start)
const strRes = Object.keys(GU_LIB_recipe('gu_strength_atk_t1')).find((id) => RESOURCES[id] && RESOURCES[id].daoPath === 'strength');
ok(strRes && RESOURCES[strRes].floors[0] <= Math.max(10, pathFloorReq('strength') + 49),
  'common-path Gu source their material in the early (rank-1) realm band');
function GU_LIB_recipe(id) { return allGu.find((g) => g.id === id).recipe.resources; }
// BP-scaled stone cost: a higher effective budget (e.g. from a drawback) costs MORE stones; a pure Gu
// (bp = tier base) keeps the base cost. Mirrors essenceCost's beff/budgetOf factor.
ok(recipeFor('blood', 5, B[5] * 1.5).stones > recipeFor('blood', 5).stones,
  'a drawback-inflated power budget raises a recipe\'s stone cost');
ok(recipeFor('blood', 5).stones === recipeFor('blood', 5, B[5]).stones,
  'a pure Gu (bp = tier base) keeps the base stone cost (ratio 1)');
// rank↔tier is STRICT 1:1 — a tier-N recipe pulls only rank-N resources (path res + binder).
ok(allGu.every((g) => Object.keys(g.recipe.resources).every((id) => RESOURCES[id].rank === Math.max(1, Math.min(9, g.tier)))),
  'every recipe uses ONLY resources of its own rank (strict rank↔tier)');
// TAG-DRIVEN spread: no path has a dead resource type — across a path's Gu (incl. ascension recipes),
// every one of its 5 themed types is consumed by ≥1 recipe (the placeholder left 4 of 5 unused).
const consumers = {}; for (const r of resourceList()) consumers[r.id] = guUsingResource(r.id).length;
const typeKey = (r) => r.id.split('_').slice(2, -1).join('_'); // res_<path>_<noun>_r<rank> → noun
function pathTypesAllUsed(pid) {
  const used = {}; for (const r of resourcesForPath(pid)) used[typeKey(r)] = (used[typeKey(r)] || 0) + consumers[r.id];
  return Object.keys(used).length === 5 && Object.values(used).every((n) => n > 0);
}
ok(pathList().filter((p) => !isPathLocked(p.id)).every((p) => pathTypesAllUsed(p.id)),
  "all 5 of every non-locked path's resource types have a consuming recipe (no dead types)");
// ranks 7-9 (immortal band) now have consumers via ascension recipes — every path res of rank ≥7 is used.
ok(resourceList().filter((r) => r.daoPath && r.rank >= 7).every((r) => consumers[r.id] > 0),
  'every rank 7-9 path resource is consumed by an immortal ascension recipe');
// immortal Gu carry a byTier {6..9} whose recipes are rank-matched and whose effect value RISES with tier.
const immFire = GU_LIB['gu_fire_atk_imm'];
ok(immFire.byTier && [6, 7, 8, 9].every((t) => immFire.byTier[t] && Object.keys(immFire.byTier[t].recipe.resources).every((id) => RESOURCES[id].rank === t)),
  'an immortal Gu has byTier 6-9 each pulling that exact rank');
ok(resolveOwned({ guId: 'gu_fire_atk_imm', tier: 9 }).effects[0].value > resolveOwned({ guId: 'gu_fire_atk_imm' }).effects[0].value,
  'resolveOwned surfaces a STRONGER effect at a higher ascension tier');
ok(nextTierOf({ guId: 'gu_fire_atk_imm' }) === 7 && nextTierOf({ guId: 'gu_fire_atk_imm', tier: 9 }) === null,
  'nextTierOf advances 6→7 and caps at 9');
ok(nextTierOf({ guId: 'gu_fire_atk_t3' }) === null, 'mortal (non-byTier) Gu cannot ascend');
// ascension END-TO-END: crafting.upgrade spends the NEXT rank's resources and bumps the instance tier.
state.current = newGame('ascend-test'); const AS = state.current;
const immId = 'gu_metal_atk_imm'; const r7 = GU_LIB[immId].byTier[7].recipe;
AS.uniqueClaimed[immId] = true; AS.guInv.push({ uid: 'asc1', guId: immId, tier: 6 });
AS.stones = (r7.stones || 0) + 10; for (const id in r7.resources) AS.resources[id] = r7.resources[id] + 3;
ok(canUpgrade('asc1').ok && canUpgrade('asc1').next === 7, 'a tier-6 immortal can ascend to 7 when affordable');
const up = upgrade('asc1');
ok(up.ok && AS.guInv.find((g) => g.uid === 'asc1').tier === 7, 'ascension bumps the instance tier to 7');
ok(Object.keys(r7.resources).every((id) => AS.resources[id] === 3), 'ascension consumed exactly the rank-7 resource cost');

section('features: named recruit roster + start realms');
const START_REALM = { Common: 0, Uncommon: 1, Rare: 2, Epic: 4, Legendary: 6, Immortal: 8 };
ok(RARITY_ORDER.every((r) => Array.isArray(NAMED_HEROES[r]) && NAMED_HEROES[r].length > 0),
  'every rarity tier has a non-empty named-hero pool (no pull can throw)');
ok(RARITY_ORDER.every((r) => { for (let i = 0; i < 50; i++) if (!NAMED_HEROES[r].includes(nameForRarity(r))) return false; return true; }),
  'nameForRarity always returns a name from the rolled tier');
const allRecruitNames = RARITY_ORDER.flatMap((r) => NAMED_HEROES[r]);
ok(!allRecruitNames.includes('Fang Yuan'), 'Fang Yuan is never a recruit (he is the player)');
ok(new Set(allRecruitNames).size === allRecruitNames.length, 'no recruit name appears in two tiers');
ok(RARITY_ORDER.every((r) => makeCharacter('x', r).realm === START_REALM[r]),
  'recruit start realm is fixed by rarity (Immortal R3-Initial, −2 small realms per rarity down; C/U/R distinct rank-1 stages)');

section('features: Dao Path Affinity trait');
// full catalogue: one affinity trait per non-locked dao path; nothing assigned to characters yet.
ok(AFFINITY_TRAITS.length === pathList().length,
  'an affinity trait exists for every dao path (incl. Supreme, affinity-only)');
ok(affinityTrait('strength') && affinityTrait('strength').name === 'Strength Dao Affinity',
  'each affinity trait carries its "<Path> Dao Affinity" label');
ok(affinityTrait('rule') && affinityTrait('rule').name === 'Rule Dao Affinity',
  'Supreme paths are affinity-able (affinity-only; their Gu/crafting stay locked)');
ok(makeCharacter('Gu Yue Bei', 'Common').affinity.length === 0, 'an unassigned recruit is created with no affinity (empty list)');
ok(affinityName('strength') === 'Strength Dao Affinity', 'affinityName strips the " Path" suffix → "Strength Dao Affinity"');
// special "very special" characters can hold MULTIPLE affinities.
{
  const ss = makeCharacter('Spectral Soul Demon Venerable', 'Immortal');
  ok(ss.affinity.length === 2 && ss.affinity.includes('killing') && ss.affinity.includes('soul'),
    'Spectral Soul is created with dual Killing + Soul affinity');
  ok(affinityEffectMult(ss, 'killing') > 1 && affinityEffectMult(ss, 'soul') > 1 && affinityEffectMult(ss, 'fire') === 1,
    'dual affinity boosts both affined paths and nothing else');
}
// canon AFFINITY map integrity: every key is a real recruit, every path valid & non-locked.
{
  const allNames = new Set(RARITY_ORDER.flatMap((r) => NAMED_HEROES[r]));
  const validPaths = new Set(pathList().map((p) => p.id));
  ok(Object.keys(AFFINITY).every((n) => allNames.has(n)), 'every AFFINITY key is a real recruit name');
  ok(Object.values(AFFINITY).every((v) => (Array.isArray(v) ? v : [v]).every((p) => validPaths.has(p))),
    'every assigned affinity path is a real dao path');
  const sup = makeCharacter('w', 'Common'); sup.affinity = ['rule'];
  ok(affinityEffectMult(sup, 'rule') > 1, 'a Supreme-path affinity still grants its bonus (capability retained, even if unassigned)');
  ok(['Ren Zu', 'Great Dream Venerable', 'Suan Bu Jin'].every((n) => !allNames.has(n)),
    'removed special characters (Ren Zu / Great Dream / Suan Bu Jin) are out of the recruit pool');
  ok(makeCharacter('Hei Lou Lan', 'Epic').affinity.length === 3, 'triple-affinity special (Hei Lou Lan) lands all three');
}
// multipliers are path-scoped and apply only when a character HAS the matching affinity.
{
  const aff = makeCharacter('w', 'Common'); aff.affinity = 'strength';
  ok(affinityCompMult(aff, 'strength') === AFFINITY_COMP_MULT && affinityCompMult(aff, 'fire') === 1,
    'comp-XP multiplier applies only to the affined path');
  ok(affinityEffectMult(aff, 'strength') > 1 && affinityEffectMult(aff, 'fire') === 1,
    'effectiveness multiplier applies only to the affined path');
}
// resonance ladder (gentle 5-step, capped at 6+).
ok(resonanceMult(1) === 1 && resonanceMult(2) === 1.05 && resonanceMult(3) === 1.10 && resonanceMult(4) === 1.15 &&
   resonanceMult(5) === 1.20 && resonanceMult(6) === 1.25 && resonanceMult(7) === 1.25,
  'same-path resonance ladder: 1.00/1.05/1.10/1.15/1.20/1.25, capped at 6+');
// effectiveness: an affined wielder out-stats an identical unaffined one on the affined path's Gu.
{
  state.current = newGame('taff'); const St = state.current;
  St.guInv = [{ uid: 'g1', guId: 'gu_strength_atk_t3' }, { uid: 'g2', guId: 'gu_strength_atk_t3' }];
  const mk = () => { const c = makeCharacter('w', 'Common'); c.realm = 12; c.attrs = { str: 40, agi: 0, con: 40, int: 0, luck: 0 }; addComprehension(c, 'strength', 1e6); return c; };
  const plain = mk(); plain.affinity = null; plain.gu = ['g1'];
  const affined = mk(); affined.affinity = 'strength'; affined.gu = ['g2'];
  St.roster.push(plain, affined);
  ok(effectiveStats(affined).atk > effectiveStats(plain).atk,
    'Strength affinity raises ATK from a Strength Gu vs an identical unaffined wielder');
}

section('features: archetype line traits');
// integrity: every assignment points at a real recruit and a real line.
{
  const allNames = new Set(RARITY_ORDER.flatMap((r) => NAMED_HEROES[r]));
  ok(Object.keys(LINE_ASSIGN).every((n) => allNames.has(n)), 'every LINE_ASSIGN key is a real recruit name');
  ok(Object.values(LINE_ASSIGN).every((id) => !!LINES[id]), 'every assigned line id is a real LINES entry');
}
// canon line lands on the character at creation
ok(makeCharacter('Chu Du', 'Legendary').line === 'slayer', 'Chu Du is created with the Slayer line');
ok(makeCharacter('Paradise Earth Venerable', 'Immortal').line === 'wall', 'Paradise Earth → Wall line');
// effect bag is tier-scaled; support lines are phase-2 (no combat bag); Adept uses a Gu amplifier.
ok(lineEffects({ line: 'wall', rarity: 'Immortal' }).hpPct === 0.40, 'Wall (Immortal) grants +40% HP');
ok(lineEffects({ line: 'commander', rarity: 'Legendary' }) === null, 'support lines (Commander) are phase-2 — no combat bag yet');
ok(lineGuAmp({ line: 'adept', rarity: 'Immortal' }) === 0.30, 'Adept (Immortal) amplifies all Gu by +30%');
// a combat line actually raises the stat through effectiveStats.
{
  state.current = newGame('tline'); const St = state.current; St.guInv = [];
  const mk = () => { const c = makeCharacter('w', 'Common'); c.rarity = 'Legendary'; c.realm = 12; c.attrs = { str: 40, agi: 0, con: 40, int: 0, luck: 0 }; return c; };
  const plain = mk(); plain.line = null;
  const slayer = mk(); slayer.line = 'slayer';   // Legendary Slayer: +28% ATK
  St.roster.push(plain, slayer);
  ok(effectiveStats(slayer).atk > effectiveStats(plain).atk, 'the Slayer line raises ATK vs an identical lineless char');
}

section('features: support line auras');
ok(lineAura({ line: 'commander', rarity: 'Immortal' }).atkMul === 0.20, 'Commander (Immortal) = +20% team ATK aura');
ok(lineAura({ line: 'warden', rarity: 'Legendary' }).taunt === true, 'Warden carries a taunt');
ok(lineAura({ line: 'mender', rarity: 'Epic' }).regenPct === 0.04, 'Mender (Epic) = team regen aura');
ok(lineAura({ line: 'slayer', rarity: 'Epic' }) === null, 'non-support combat lines have no aura');
{
  // Commander buffs the whole team's ATK; Warden hardens DEF + is the one taunting; Mender carries a
  // per-action team-heal flag on ITSELF (not a team-wide regen).
  const team = [
    { ch: { line: 'commander', rarity: 'Immortal' }, atk: 100, def: 100, spd: 100, max: 1000, fx: {} },
    { ch: { line: 'warden', rarity: 'Legendary' }, atk: 100, def: 100, spd: 100, max: 1000, fx: {} },
    { ch: { line: 'mender', rarity: 'Epic' }, atk: 100, def: 100, spd: 100, max: 1000, fx: {} },
    { ch: { line: null }, atk: 100, def: 100, spd: 100, max: 1000, fx: {} },
  ];
  applyTeamAuras(team);
  ok(team[3].atk === 120, 'Commander aura raises a teammate ATK +20% (100→120)');
  ok(team[3].def === 118, 'Warden aura raises a teammate DEF +18% (100→118)');
  ok(team[1].taunt === true && !team[3].taunt, 'only the Warden is flagged taunt');
  ok(team[2].teamHealPct === 0.04 && !team[3].teamHealPct, 'only the Mender carries the per-action team-heal');
}
{
  // teamHeal restores living allies by % of their max HP, capped, only when the Mender acts.
  const ally = { hp: 500, max: 1000 }, mender = { teamHealPct: 0.04, hp: 1000, max: 1000 };
  teamHeal(mender, [ally, mender]);
  ok(ally.hp === 540, 'Mender team-heal restores a wounded ally by +4% max HP on its action');
  ok(mender.hp === 1000, 'a full-HP ally stays capped');
}
{
  // auras DON'T STACK: with two Menders, only the strongest (higher rarity tier) aura is active.
  const lo = { ch: { line: 'mender', rarity: 'Epic', realm: 8 }, atk: 100, def: 100, spd: 100, max: 1000, fx: {} };
  const hi = { ch: { line: 'mender', rarity: 'Immortal', realm: 12 }, atk: 100, def: 100, spd: 100, max: 1000, fx: {} };
  applyTeamAuras([lo, hi]);
  ok(hi.teamHealPct === lineAura(hi.ch).regenPct && !lo.teamHealPct, 'only the higher-tier Mender aura is active (no stacking)');
}
{
  // end-to-end: a Commander on the active team buffs a teammate's ATK inside a real encounter.
  state.current = newGame('taura'); const St = state.current;
  const p = St.roster[0]; p.active = true; p.line = null; p.affinity = []; p.realm = 12; p.attrs = { str: 30, agi: 0, con: 30, int: 0, luck: 0 }; p.row = 'front'; p.lane = 0;
  const cmd = makeCharacter('c', 'Immortal'); cmd.line = 'commander'; cmd.active = true; cmd.realm = 12; cmd.attrs = { str: 30, agi: 0, con: 30, int: 0, luck: 0 }; cmd.row = 'front'; cmd.lane = 1;
  St.roster.push(cmd);
  const baseAtk = effectiveStats(p).atk;
  const res = resolveEncounter(generateEncounter(1));
  const pAfter = res.allies.find((u) => u.ch === p);
  ok(pAfter && pAfter.atk > baseAtk, 'Commander aura buffs a teammate ATK inside resolveEncounter');
}

section('features: line combat/economy extras');
ok(lineEffects({ line: 'reaver', rarity: 'Immortal' }).essDrain === 0.15, 'Reaver (Immortal) drains essence on hit');
ok(!lineEffects({ line: 'reaver', rarity: 'Epic' }).essDrain, 'Reaver essence-drain only at Legendary+');
ok(lineEffects({ line: 'afflictor', rarity: 'Immortal' }).dotSpread === 0.50, 'Afflictor (Immortal) 50% on-death DoT spread');
ok(lineEffects({ line: 'foundation', rarity: 'Immortal' }).apBase === 64, 'Foundation (Immortal) flat base-pool boost');
ok(lineEffects({ line: 'fortune', rarity: 'Immortal' }).fortune === 0.25, 'Fortune (Immortal) economy scalar');
{
  // effectiveStats surfaces essDrain/dotSpread; Foundation apBase grows the essence pool.
  state.current = newGame('tex'); const c = state.current.roster[0]; c.realm = 12; c.attrs = { str: 0, agi: 0, con: 0, int: 40, luck: 0 };
  c.line = 'foundation'; c.rarity = 'Immortal'; const withF = effectiveStats(c).essencePool;
  c.line = null; const without = effectiveStats(c).essencePool;
  ok(withF > without, 'Foundation raises the essence pool');
  c.line = 'reaver'; c.rarity = 'Immortal'; ok(effectiveStats(c).essDrain === 0.15, 'essDrain surfaces on effectiveStats');
  c.line = 'afflictor'; ok(effectiveStats(c).dotSpread === 0.50, 'dotSpread surfaces on effectiveStats');
}
{
  // Fortune economy: a Fortune cultivator contributes its scalar to teamFortune().
  state.current = newGame('tfo'); const p = state.current.roster[0]; p.active = true; p.line = 'fortune'; p.rarity = 'Immortal';
  ok(Math.abs(teamFortune() - 0.25) < 1e-9, 'a Fortune cultivator contributes to teamFortune()');
}
{
  // new DROP MODEL: rarity sets each resource's base drop chance; Luck (capped) adds to dropBonus.
  ok(dropChance(1) === 0.50 && dropChance(9) === 0.025, 'base drop chance is rank-set (rank 1 50% → rank 9 2.5%, higher rank rarer)');
  state.current = newGame('tlk'); const p = state.current.roster[0]; p.active = true; p.line = null;
  p.realm = 12; p.attrs = { str: 0, agi: 0, con: 0, int: 0, luck: 300 };
  ok(teamLuck() === 0.5, 'team Luck bonus caps at 0.5');
  ok(Math.abs(dropBonus() - teamLuck()) < 1e-9, 'dropBonus = teamFortune + teamLuck');
}
{
  // Fortune economy does NOT stack — only the strongest Fortune cultivator's buff is active (aura rule).
  state.current = newGame('tf2'); const St = state.current;
  const a = St.roster[0]; a.active = true; a.line = 'fortune'; a.rarity = 'Immortal';
  const solo = teamFortune();
  const b2 = makeCharacter('b', 'Epic'); b2.active = true; b2.line = 'fortune'; b2.rarity = 'Epic'; St.roster.push(b2);
  ok(teamFortune() === 0.25 && Math.abs(teamFortune() - solo) < 1e-9, 'only the strongest Fortune buff is active (no stacking)');
}
{
  // Luck is taken from the team's SINGLE highest-luck cultivator, not summed.
  state.current = newGame('tl2'); const St = state.current;
  const a = St.roster[0]; a.active = true; a.line = null; a.realm = 0; a.attrs = { str: 0, agi: 0, con: 0, int: 0, luck: 60 };
  const solo = teamLuck();
  const b2 = makeCharacter('b', 'Common'); b2.active = true; b2.realm = 0; b2.attrs = { str: 0, agi: 0, con: 0, int: 0, luck: 10 }; St.roster.push(b2);
  ok(Math.abs(teamLuck() - solo) < 1e-9, 'team Luck uses only the highest-luck cultivator (a lower-luck ally adds nothing)');
}
{
  // immortal-essence yield now scales with the team drop bonus (Fortune/Luck).
  state.current = newGame('tie'); const a = state.current.roster[0]; a.active = true; a.line = null;
  const base = farmEssenceEV(100, false);
  a.line = 'fortune'; a.rarity = 'Immortal';
  ok(farmEssenceEV(100, false) > base, 'immortal-essence yield scales with the drop bonus (Fortune/Luck)');
}
{
  // Mender cleanse: rarity-scaled params + strips up to max debuffs when it procs.
  const m = { ch: { line: 'mender', rarity: 'Immortal', realm: 12 }, atk: 100, def: 100, spd: 100, max: 1000, fx: {} };
  applyTeamAuras([m]);
  ok(m.cleanseChance === 0.25 && m.cleanseMax === 4, 'Immortal Mender: 25% cleanse chance, up to 4 debuffs');
  const a1 = { hp: 100, statuses: { slow: { turns: 2, mag: 0.2 }, burn: [{ turns: 2, per: 5 }] } };
  const a2 = { hp: 100, statuses: { weaken: { turns: 2, mag: 0.2 } } };
  cleanseTeam({ cleanseChance: 1, cleanseMax: 2 }, [a1, a2]);
  ok(Object.keys(a1.statuses).length + Object.keys(a2.statuses).length === 1, 'cleanseTeam stripped 2 of 3 debuffs');
}

section('features: resource rank ladder');
ok(resourceList().every((r) => r.rank >= 1 && r.rank <= 9), 'every resource carries a rank 1-9');
ok(rankRarity(1) === 'Common' && rankRarity(4) === 'Epic' && rankRarity(5) === 'Epic' && rankRarity(8) === 'Immortal',
  'rank→rarity colour map: 1 Common, 4-5 Epic, 8-9 Immortal');
ok(resourcesForPath('blade').length === 45, 'each path has 5 types × rank 1-9 = 45 resources');
{
  // each path type spans all 9 ranks (one resource per rank per noun)
  const ranks = resourcesForPath('blade').filter((r) => r.id.startsWith('res_blade_fang_')).map((r) => r.rank).sort((a, b) => a - b);
  ok(ranks.length === 9 && ranks[0] === 1 && ranks[8] === 9, 'a path type (Blade Fang) is a full rank 1-9 ladder');
}
ok(RESOURCES['bind_relic_r1'] && RESOURCES['bind_stone_r9'], 'both universal binder ladders exist (rank 1-9)');
ok(resourceList().length === 45 * 45 + 18, '45 paths × 45 + 18 binders = 2043 resources total');
// FLOOR DISTRIBUTION: rank-N never drops before its realm band (rank 2 ≥ 51, rank 3 ≥ 101, …). PATH
// resources sit in an ≤18-floor SUB-WINDOW (types spread across the band); UNIVERSAL binders instead
// span a 3-band gradient window (own band + 2 above), so they're excluded from the sub-window check.
ok(resourceList().every((r) => r.floors[0] >= (r.rank - 1) * 50 + 1), 'rank-N resources never drop before floor (N-1)×50+1 (rank 2 ≥ 51, rank 3 ≥ 101 …)');
ok(resourceList().filter((r) => r.daoPath).every((r) => r.floors[1] >= r.floors[0] && r.floors[1] - r.floors[0] <= 17), 'each PATH resource drops in an ≤18-floor sub-window within its band');
ok(resourceList().filter((r) => !r.daoPath).every((r) => r.floors[0] === (r.rank - 1) * 50 + 1 && r.floors[1] === Math.min(450, (r.rank + 2) * 50)), 'each UNIVERSAL binder spans its 3-band gradient window [bandStart .. (rank+2)×50]');
{
  // a path's 5 rank-1 types are SPREAD across distinct floor sub-windows within realm 1 (not all stacked).
  const r1 = resourceList().filter((r) => r.rank === 1);
  ok(new Set(r1.map((r) => r.floors[0])).size > 10, 'rank-1 resource types are spread across many distinct floor windows');
  // and a given floor only sees a SUBSET of its rank's resources (spread, not the full ~227)
  const poolAt25 = resourceList().filter((r) => 25 >= r.floors[0] && 25 <= r.floors[1]);
  ok(poolAt25.length > 0 && poolAt25.length < r1.length, 'a single floor holds only a subset of its rank-band resources (spread)');
}
{
  // NO RANK INVERSION (PATH resources): within any single path a higher-rank resource never drops earlier
  // than a lower-rank one — rank bands/segments are strictly ordered & non-overlapping. Gated paths whose
  // low ranks are held back to the gate band get spread across it lowest-rank-first.
  const bySource = {};
  for (const r of resourceList()) {
    if (!r.daoPath) continue; // universal binders overlap by design — checked separately below
    const g = bySource[r.daoPath] || (bySource[r.daoPath] = {});
    const cur = g[r.rank] || (g[r.rank] = { lo: Infinity, hi: -Infinity });
    cur.lo = Math.min(cur.lo, r.floors[0]);
    cur.hi = Math.max(cur.hi, r.floors[1]);
  }
  let inversion = null;
  for (const [key, ranks] of Object.entries(bySource)) {
    for (let rk = 1; rk < 9; rk++) {
      if (ranks[rk] && ranks[rk + 1] && !(ranks[rk].hi < ranks[rk + 1].lo)) {
        inversion = `${key} rank ${rk} (ends F${ranks[rk].hi}) overlaps rank ${rk + 1} (starts F${ranks[rk + 1].lo})`;
      }
    }
  }
  ok(inversion === null, `no rank inversion within any path${inversion ? ' — ' + inversion : ''}`);

  // Theft path (gate F101, a rank-3 band) spreads its CLAMPED ranks 1/2/3 across the thirds of floors 101-150.
  const theft = (rk) => resourcesForPath('theft').filter((r) => r.rank === rk);
  const within = (rs, a, b) => rs.length > 0 && rs.every((r) => r.floors[0] >= a && r.floors[1] <= b);
  ok(within(theft(1), 101, 116) && within(theft(2), 117, 133) && within(theft(3), 134, 150),
    'Theft ranks 1/2/3 occupy the first/second/third thirds of floors 101-150 (gated-path gradient)');
}

section('features: universal binder drop gradient');
{
  const w = (f) => universalRankWeights(f);
  const sum = (f) => Object.values(w(f)).reduce((a, x) => a + x, 0);
  const close = (a, b, eps = 0.005) => Math.abs(a - b) <= eps;
  // Shares always normalize to a 100% pie.
  ok([1, 25, 51, 100, 150, 201, 300, 450].every((f) => close(sum(f), 1)), 'rank weights sum to 1 at every floor');
  // F1-50: pure rank 1.
  ok([1, 25, 50].every((f) => Object.keys(w(f)).length === 1 && close(w(f)[1], 1)), 'floors 1-50 drop only rank-1 universal resources');
  // The exact gradient the spec calls out: F51 = 98/2, F52 = 96/4.
  ok(close(w(51)[1], 0.98, 0.005) && close(w(51)[2], 0.02, 0.005), 'floor 51 universal mix is ≈98% rank 1 / 2% rank 2');
  ok(close(w(52)[1], 0.96, 0.005) && close(w(52)[2], 0.04, 0.005), 'floor 52 universal mix is ≈96% rank 1 / 4% rank 2');
  // A new rank debuts each band start and the prior-prior rank retires: F101 adds R3, F151 drops R1 & adds R4.
  ok(Object.keys(w(101)).map(Number).sort((a, b) => a - b).join(',') === '1,2,3', 'floor 101 mixes ranks 1,2,3 (rank 3 debuts small)');
  ok(w(101)[3] > 0 && w(101)[3] < 0.05, 'rank 3 debuts as a small share at floor 101');
  ok(!w(150)[4] && w(150)[1] > 0, 'rank 1 still drops at floor 150 (last floor before it retires)');
  ok(!w(151)[1] && Object.keys(w(151)).map(Number).sort((a, b) => a - b).join(',') === '2,3,4', 'floor 151 retires rank 1 and debuts rank 4 (mix 2,3,4)');
  // Within a band the newest (top) rank's share rises monotonically with depth.
  ok(w(105)[3] < w(125)[3] && w(125)[3] < w(149)[3], 'the band-top rank share grows as you climb within the band');
  // A higher rank never APPEARS earlier than a lower one (debut floors stay ordered, even though windows overlap).
  ok(w(50)[2] === undefined && w(100)[3] === undefined && w(150)[4] === undefined, 'a higher-rank universal never debuts before its band start');
}

section('features: aperture capacity (aptitude)');
ok(apertureCapacity(2.5) === 1 && apertureCapacity(3.8) === 1, 'aptitude >= 2.5 → 100% aperture (capped)');
ok(Math.abs(apertureCapacity(1.0) - 0.4) < 1e-9, 'aptitude 1.0 → 40% aperture capacity');
ok(apertureGrade(1).grade === 'Extreme' && apertureGrade(0.85).grade === 'A' && apertureGrade(0.7).grade === 'B'
  && apertureGrade(0.45).grade === 'C' && apertureGrade(0.3).grade === 'D', 'grade bands map Extreme/A/B/C/D by capacity%');
const apLo = makeCharacter('lo', 'Common'); apLo.aptitude = 1.0;   // 40% aperture
const apHi = makeCharacter('hi', 'Common'); apHi.aptitude = 2.5;   // 100% aperture (same base attrs/realm)
ok(effectiveStats(apHi).essencePool > effectiveStats(apLo).essencePool, 'higher aptitude → larger aperture pool');
ok(Math.abs(effectiveStats(apLo).essencePool / effectiveStats(apHi).essencePool - 0.4) < 0.03,
  'aperture pool scales ~linearly with capacity (40% vs 100%)');
ok(apertureRegenFactor(2.5) === 1 && Math.abs(apertureRegenFactor(0.5) - 0.6) < 1e-9,
  'aptitude scales essence regen: Extreme 100%, D-grade 60%');
ok(Math.abs((1 - apertureRegenFactor(1.0)) - (1 - apertureCapacity(1.0)) / 2) < 1e-9,
  'regen harshness is exactly half the capacity harshness');
ok(effectiveStats(apHi).essenceRegen > effectiveStats(apLo).essenceRegen,
  'higher aptitude → faster essence regen (same base)');
// essence pool also grows with BIG realm (rank) advancement — essence quality
ok(essenceQuality(0) === 1 && essenceQuality(4) > essenceQuality(0) && essenceQuality(8) > essenceQuality(4),
  'essence quality steps up each rank (R1<R2<R3)');
ok(essenceQuality(0) === essenceQuality(3) && essenceQuality(4) === essenceQuality(7),
  'essence quality is constant within a rank (per big realm, not per sub-stage)');
const erLo = makeCharacter('r1', 'Common'); erLo.aptitude = 2.5; erLo.realm = 0;  // R1 Initial
const erHi = makeCharacter('r4', 'Common'); erHi.aptitude = 2.5; erHi.realm = 12; // R4 Initial, same attrs/aptitude
ok(effectiveStats(erHi).essencePool > effectiveStats(erLo).essencePool,
  'a deeper rank holds a larger essence pool (quality), same attrs/aptitude');
// essence cost scales with wielder-rank vs Gu-tier gap
const g5 = { tier: 5 };
ok(guEssenceCostFor(g5, 5) === guEssenceCost(g5), 'a Gu at your rank costs its base essence');
ok(Math.abs(guEssenceCostFor(g5, 6) - guEssenceCost(g5) * 0.75) < 1e-9, 'a Gu one rank below you is 25% cheaper');
ok(Math.abs(guEssenceCostFor(g5, 3) - guEssenceCost(g5) * 2.25) < 1e-9, 'a Gu two ranks above you costs +50%/rank (×2.25)');
ok(guEssenceCostFor(g5, 9) < guEssenceCostFor(g5, 1), 'higher wielder rank → cheaper to channel the same Gu');

section('features: stone-purchased breakthroughs');
{
  // cost is anchored to the attribute points the step grants → a big-realm boundary (realm%4===3) costs far more
  ok(breakthroughCost(3) > breakthroughCost(2) * 3, 'a big-realm boundary costs many× a sub-realm step');
  // success = 70% × min(1, aptitude/aptThreshold) + 30% × min(1, highestComp/compTarget); both targets ramp
  // per small realm (boundary hardest). aptThreshold (9+realm)/16 → boundaries 0.75/1.00/1.25/1.50; full
  // 100% needs aptitude ≥ threshold AND a rank-capped comprehension. Clamped to [0%, 100%].
  const sub = makeCharacter('bt', 'Common'); sub.aptitude = 0.4; sub.realm = 2;           // sub-step, below threshold
  const bound = makeCharacter('bt2', 'Common'); bound.aptitude = 0.4; bound.realm = 3;    // boundary (higher threshold)
  ok(breakthroughChance(bound) < breakthroughChance(sub), 'a big-realm boundary (higher aptitude threshold) is harder at fixed aptitude');
  const hiApt = makeCharacter('bt3', 'Common'); hiApt.aptitude = 0.6; hiApt.realm = 2;
  ok(breakthroughChance(hiApt) > breakthroughChance(sub), 'higher aptitude → better odds below the threshold');
  const sat = makeCharacter('bts', 'Common'); sat.aptitude = 5; sat.realm = 2;            // aptitude saturates the 70%
  ok(Math.abs(breakthroughChance(sat) - 0.70) < 1e-9, 'aptitude ≥ threshold + 0 comprehension → exactly 70%');
  const full = makeCharacter('btf', 'Common'); full.aptitude = 5; full.realm = 2; addComprehension(full, 'fire', 1e9);
  ok(Math.abs(breakthroughChance(full) - 1.0) < 1e-9, 'aptitude ≥ threshold + rank-capped comprehension → 100%');
  ok(breakthroughChance(full) > breakthroughChance(sat), 'higher comprehension → better odds (up to +30%)');
  ok(breakthroughChance(sub) >= 0 && breakthroughChance(full) <= 1, 'chance is clamped to [0%, 100%]');
  // big-realm boundaries are FLOOR-GATED (rank2 ← Floor 50 … rank5 ← Floor 200); sub-steps are not gated
  ok(breakthroughFloorReq(3) === 50 && breakthroughFloorReq(7) === 100 && breakthroughFloorReq(11) === 150 && breakthroughFloorReq(15) === 200, 'boundary floor gates ramp 50 → 200');
  ok(breakthroughFloorReq(2) === 0 && breakthroughFloorReq(0) === 0, 'sub-realm steps have no floor gate');

  // APTITUDE-OVERFLOW attribute bonus: each step grants base + floor(base × overflow/threshold); none below threshold
  ok(aptitudeStepBonus(3, aptThreshold(3)) === 0, 'aptitude exactly at a step threshold grants no bonus points');
  ok(aptitudeStepBonus(3, aptThreshold(3) - 0.1) === 0, 'aptitude below threshold grants no bonus (no penalty)');
  ok(aptitudeStepBonus(3, 5) > aptitudeStepBonus(3, 2) && aptitudeStepBonus(3, 2) > 0, 'more aptitude overflow → more bonus points');
  ok(aptitudePointBonus(0, 5) === 0, 'no aptitude bonus before any breakthrough (realm 0)');
  ok(playerPool({ realm: 10, rarity: 'Common', aptitude: 3 }) > playerPool({ realm: 10, rarity: 'Common', aptitude: 0.5 }),
    'higher aptitude → a larger attribute pool at the same realm');

  // attemptBreakthrough: success advances + spends; failure spends ONLY (no injury, no Dao Wound)
  state.current = newGame('btg'); const B = state.current; const ch = B.roster[0]; ch.realm = 1; B.stones = 1e7;
  const cost = breakthroughCost(1), before = B.stones, rnd = Math.random;
  Math.random = () => 0;                                   // force success
  const win = attemptBreakthrough(ch.id);
  ok(win.success && ch.realm === 2 && B.stones === before - cost, 'a successful breakthrough advances the realm and spends the cost');
  Math.random = () => 0.999;                               // force failure (kept through the re-attempt below)
  const cost2 = breakthroughCost(ch.realm), before2 = B.stones;
  const lose = attemptBreakthrough(ch.id);
  ok(!lose.success && ch.realm === 2 && B.stones === before2 - cost2, 'a failed breakthrough spends the cost without advancing');
  ok(!isInjured(ch) && (ch.wounds || []).length === 0, 'a failed breakthrough inflicts NO injury and NO Dao Wound');
  ok(injuryMult(ch) === 1 && effectiveStats(ch).atk > 0, 'no injury → combat stats are unpenalised');
  ok(attemptBreakthrough(ch.id).ok && ch.realm === 2, 'can immediately re-attempt after a failure (no injury cooldown)');
  Math.random = rnd;
  B.stones = 0;
  ok(!attemptBreakthrough(ch.id).ok, 'cannot attempt a breakthrough without enough stones');

  // big-realm boundary is locked until its gate floor is beaten (frontier > gate)
  state.current = newGame('btg2'); const B2 = state.current; const c2 = B2.roster[0]; c2.realm = 3; B2.stones = 1e9;
  B2.frontier = 40;
  ok(!attemptBreakthrough(c2.id).ok && c2.realm === 3, 'a big-realm boundary is locked until its gate floor is beaten');
  B2.frontier = 60;                                       // cleared floor 50
  const r2 = Math.random; Math.random = () => 0;          // force success
  ok(attemptBreakthrough(c2.id).ok && c2.realm === 4, 'beating the gate floor (50) unlocks the rank-2 boundary');
  Math.random = r2;
}

section('features: combat-line effect display (lineEffectList)');
{
  const reaver = lineEffectList(LINES.reaver.tiers.Immortal);
  ok(reaver.includes('+25% Lifesteal') && reaver.includes('+15% Essence Drain'),
    'a Reaver shows its Lifesteal + Essence Drain bonuses');
  ok(lineEffectList(LINES.vanguard.tiers.Legendary).includes('+25% ATK'),
    'a Vanguard shows its ATK bonus');
  ok(lineEffectList(LINES.slayer.tiers.Rare).includes('−8% DEF'),
    'the Slayer flaw renders as a signed −8% DEF');
  ok(lineEffectList(null).length === 0 && lineEffectList(LINES.warden.tiers && LINES.warden.tiers.Common).length === 0,
    'support lines (no tiers bag) yield no combat-line effects — their bonus is the team aura');
}

section('features: tiered archetype names + enemy guInfo');
ok(lineName('wall', 'Common') === 'Shieldbearer' && lineName('wall', 'Immortal') === 'Immovable World-Root',
  'lineName resolves rarity-specific epithets (Common → Immortal)');
ok(lineName('wall') === 'The Wall', 'lineName falls back to the flat name when no rarity is given');
ok(Object.keys(LINES).every((id) => RARITY_ORDER.every((r) => { const n = lineName(id, r); return n && n !== LINES[id].name; })),
  'every archetype line has a distinct tiered epithet for all 6 rarities');
{
  // enemy units carry guInfo (name + effect text) for the arena traits panel
  const foes = generateEncounter(120).waves.flat();
  ok(foes.every((u) => Array.isArray(u.guInfo)), 'every enemy unit exposes a guInfo array');
  const withGu = foes.find((u) => u.guInfo && u.guInfo.length);
  ok(withGu && withGu.guInfo[0].name && typeof withGu.guInfo[0].eff === 'string',
    'each guInfo entry carries a Gu name + its effect text');
}

section('features: starter path preview helpers');
{
  const fire = signatureGusForPath('fire');
  ok(fire.length >= 2, 'a common path previews MULTIPLE immortal Gu (not just one)');
  ok(fire.every((g) => g.daoPath === 'fire' && g.unique), 'every marquee Gu is a unique immortal Gu of that path');
  ok(fire[0] === signatureImmortalGu('fire'), 'the quad signature leads the marquee lineup');
  ok(pathStatuses('fire').includes('burn'), 'Fire inflicts Burn');
  ok(pathStatuses('metal').includes('sunder'), 'Metal inflicts Sunder');
}

section('features: starter archetype picker + new-game line choice');
{
  // LINE_ORDER must cover every line in LINES exactly once (drives the picker grid).
  ok(LINE_ORDER.length === Object.keys(LINES).length, 'LINE_ORDER has one entry per line');
  ok(LINE_ORDER.every((id) => LINES[id]) && new Set(LINE_ORDER).size === LINE_ORDER.length,
    'every LINE_ORDER id is a real, unique line');
  ok(LINE_ORDER.every((id) => lineCjk(id) && lineBlurb(id)), 'every line has a CJK seal + blurb for the card');

  // lineTierEffects renders all three line shapes: combat add-bag, support aura, and Adept's guAmp.
  ok(lineTierEffects('slayer', 'Immortal').join(' ').includes('+40% ATK'), 'combat line ladder reads its add-bag (Slayer Immortal +40% ATK)');
  ok(lineTierEffects('commander', 'Immortal').join(' ').match(/ATK/) && lineTierEffects('commander', 'Immortal').join(' ').match(/SPD/),
    'support line ladder reads its team aura (Commander ATK+SPD)');
  ok(/\+\d+% all Gu effects/.test(lineTierEffects('adept', 'Epic')[0]), 'Adept ladder reads its per-Gu amplifier');
  ok(RARITY_ORDER.every((r) => Array.isArray(lineTierEffects('reaver', r))), 'Reaver renders a row at every rarity');

  // The new-game starter wires the chosen line onto the player at the player's (Epic) rarity.
  const g = newGame('tarch', 'Tester', { path: 'fire', guId: null, line: 'reaver' });
  const p = g.roster[0];
  ok(p.line === 'reaver' && p.rarity === 'Epic', 'newGame stamps the chosen archetype line onto the Epic player');
  ok(lineEffects(p) === LINES.reaver.tiers.Epic, 'the player gains the rarity-appropriate (Epic) tier of the line');
}

section('features: status effect text (chance + base magnitude)');
{
  // a DoT status Gu shows the inflict CHANCE and the per-tick BASE magnitude + duration (not a bare %)
  const burn = effectText(GU_LIB['gu_fire_st_burn_imm']);
  ok(/inflict Burn \d+% ·/.test(burn) && /\d+% ATK\/turn for \d+ turn/.test(burn),
    'a Burn Gu shows inflict chance AND per-tick ATK% magnitude + duration');
  const bleed = effectText(GU_LIB['gu_metal_st_bleed_imm']);
  ok(/\d+% max HP\/turn for \d+ turn/.test(bleed), 'a Bleed Gu shows its per-tick max-HP% magnitude');
  // a control-debuff status Gu shows the magnitude of the stat it lowers + duration
  const sunder = effectText(GU_LIB['gu_metal_st_sunder_imm']);
  ok(/inflict Sunder \d+% ·/.test(sunder) && /\d+% DEF for \d+ turn/.test(sunder),
    'a Sunder Gu shows inflict chance AND its −DEF% magnitude + duration');
}

section('features: Soul Imprint (duplicate merge)');
{
  state.current = newGame('timp'); const St = state.current;
  // two copies of the same recruit (same name ⇒ same rarity) + an unrelated benched character.
  const a = makeCharacter('Bai Ning Bing', 'Legendary'); a.active = false;
  const b = makeCharacter('Bai Ning Bing', 'Legendary'); b.active = false;
  const other = makeCharacter('Feng Jiu Ge', 'Legendary'); other.active = false;
  St.roster.push(a, b, other);

  ok((a.imprint || 0) === 0, 'a fresh character starts at Soul Imprint Lv 0');
  const cands = imprintCandidates(a.id);
  ok(cands.length === 1 && cands[0].id === b.id, 'imprintCandidates lists the benched same-name duplicate only (not a different-named char)');

  const strBefore = effAttr(a, 'str'), aptBefore = effAptitude(a), hpBefore = effectiveStats(a).maxHp;
  const r = imprint(a.id, b.id);
  ok(r.ok && a.imprint === 1, 'imprint() raises the target to Lv 1');
  ok(!St.roster.some((c) => c.id === b.id), 'the sacrificed duplicate is removed from the roster');
  ok(Math.abs(imprintAttrMult(a) - 1.05) < 1e-9 && Math.abs(effAttr(a, 'str') - strBefore * 1.05) < 1e-9,
    'Lv 1 multiplies every base attribute by exactly 1.05 (+5%)');
  ok(Math.abs(effAptitude(a) - (aptBefore + 0.1)) < 1e-9, 'Lv 1 adds +0.1 aptitude');
  ok(effectiveStats(a).maxHp > hpBefore, 'the imprint bonus flows through into derived combat stats');

  // rejections: wrong name / self / active duplicate / player
  ok(!imprint(a.id, other.id).ok, 'cannot sacrifice a different-named character');
  ok(!imprint(a.id, a.id).ok, 'cannot sacrifice the target into itself');
  const act = makeCharacter('Bai Ning Bing', 'Legendary'); act.active = true; St.roster.push(act);
  ok(!imprint(a.id, act.id).ok, 'cannot sacrifice an ACTIVE duplicate (must be benched first)');
  ok(imprintCandidates(a.id).length === 0, 'an active duplicate is not offered as a candidate');

  // FULL aptitude: the +0.1 feeds aptitudePointBonus (retroactive points), aperture, and breakthrough odds.
  state.current = newGame('timp2'); const S2 = state.current;
  const m = makeCharacter('Bai Ning Bing', 'Legendary'); m.realm = 10; m.aptitude = 1.0;
  const f = makeCharacter('Bai Ning Bing', 'Legendary');
  S2.roster.push(m, f);
  const poolPre = playerPool(m), capPre = apertureCapacity(effAptitude(m)), btPre = breakthroughChance(m);
  imprint(m.id, f.id);
  ok(playerPool(m) > poolPre, 'imprint grants retroactive attribute points (effAptitude feeds aptitudePointBonus)');
  ok(apertureCapacity(effAptitude(m)) > capPre, 'imprint raises aperture capacity');
  ok(breakthroughChance(m) > btPre, 'imprint raises breakthrough success chance');

  // hard cap at IMPRINT_CAP (10)
  const t = makeCharacter('Bai Ning Bing', 'Legendary'); t.imprint = IMPRINT_CAP; S2.roster.push(t);
  const food = makeCharacter('Bai Ning Bing', 'Legendary'); S2.roster.push(food);
  ok(!imprint(t.id, food.id).ok && t.imprint === IMPRINT_CAP, 'Soul Imprint is hard-capped at Lv 10');
}

section('features: daily quests (essence rewards + reset)');
{
  const { DAILY_QUESTS, COMPLETE_ALL_BONUS, ensureDaily, bumpQuest, claimQuest, claimBonus,
    questComplete, questClaimable, questClaimed, allClaimed, bonusClaimable, claimableCount, pendingReward }
    = await import('../src/systems/quests.js');
  state.current = newGame('tq'); const Q = state.current;
  ensureDaily();
  ok(Q.daily.date && Q.daily.date.length === 10, 'ensureDaily stamps the local calendar day');
  const wins = DAILY_QUESTS.find((x) => x.id === 'wins');

  // progress + completion
  ok(!questComplete('wins'), 'a fresh quest is not complete');
  for (let i = 0; i < wins.goal - 1; i++) bumpQuest('wins');
  ok(!questComplete('wins') && !questClaimable('wins'), 'below goal: not complete, not claimable');
  bumpQuest('wins');
  ok(questComplete('wins') && questClaimable('wins'), 'reaching the goal makes the quest claimable');

  // overflow never pushes past the goal
  bumpQuest('wins', 99);
  ok((Q.daily.progress.wins || 0) === wins.goal, 'progress is clamped to the goal');

  // claim grants essence exactly once
  const before = Q.essence;
  const r = claimQuest('wins');
  ok(r.ok && r.reward === wins.reward && Q.essence === before + wins.reward, 'claiming a quest grants its ✦ reward');
  ok(questClaimed('wins') && !questClaimable('wins'), 'a claimed quest is no longer claimable');
  ok(!claimQuest('wins').ok && Q.essence === before + wins.reward, 'a quest cannot be double-claimed');

  // claimableCount + pendingReward reflect outstanding rewards
  bumpQuest('recruit', 5);
  ok(questClaimable('recruit') && claimableCount() >= 1, 'claimableCount counts completed-unclaimed quests');
  ok(pendingReward() >= DAILY_QUESTS.find((x) => x.id === 'recruit').reward, 'pendingReward sums outstanding ✦');

  // all-clear bonus: only after EVERY quest is claimed
  for (const q of DAILY_QUESTS) { bumpQuest(q.id, q.goal); claimQuest(q.id); }
  ok(allClaimed() && bonusClaimable(), 'bonus unlocks once every quest is claimed');
  const pb = Q.essence; const b = claimBonus();
  ok(b.ok && b.reward === COMPLETE_ALL_BONUS && Q.essence === pb + COMPLETE_ALL_BONUS, 'the all-clear bonus pays out once');
  ok(!claimBonus().ok, 'the bonus cannot be claimed twice');

  // a calendar-day rollover resets the board
  Q.daily.date = '2000-01-01';
  ensureDaily();
  ok(!questComplete('wins') && !questClaimed('wins') && !Q.daily.bonusClaimed, 'a date rollover resets progress, claims and the bonus');
}

section('features: attribute respec');
{
  state.current = newGame('respec'); const SR = state.current;
  const rc = SR.roster[0];
  rc.attrs = { str: 30, agi: 10, con: 8, int: 2, luck: 0 };   // 50 points invested
  const invested = spentPoints(rc);
  ok(invested === 50, 'spentPoints sums the allocated attributes');
  ok(respecCost(rc) === RESPEC_COST_PER_POINT * invested, 'respec cost = 1,000 石 per invested point');

  // too poor → refusal, no mutation
  SR.stones = respecCost(rc) - 1;
  const poolBefore = playerPool(rc);
  const r0 = respecAttributes(rc.id);
  ok(!r0.ok && spentPoints(rc) === invested && SR.stones === respecCost(rc) - 1, 'a respec you cannot afford fails and changes nothing');

  // affordable → all points refunded into the unspent pool, stones charged
  SR.stones = respecCost(rc) + 500;
  const cost = respecCost(rc);
  const r1 = respecAttributes(rc.id);
  ok(r1.ok && r1.refunded === invested && r1.cost === cost, 'respec succeeds, reporting the refund and cost');
  ok(spentPoints(rc) === 0 && unspentPoints(rc) === poolBefore, 'every allocated point becomes unspent again (pool intact)');
  ok(SR.stones === 500, 'the stone fee is deducted exactly once');

  // nothing left to respec → refusal, free of charge
  const r2 = respecAttributes(rc.id);
  ok(!r2.ok && SR.stones === 500, 'respeccing a fresh (unallocated) cultivator fails without charging');
}

section('features: immortal essence stones — currency + immortal-Gu fuel gate');
{
  state.current = newGame('immstone'); const SI = state.current;
  const me = SI.roster[0]; me.active = true;
  ok(SI.immortalStones === 0, 'a new game starts with no Immortal Essence Stones');

  // (1) UNLOCK GATE — the currency is inaccessible until a cultivator reaches immortal Rank 6.
  ok(!immortalUnlocked(), 'a mortal roster has NOT unlocked Immortal Essence Stones');
  ok(rollImmortalStones(300, false) === 0, 'no 仙石 faucet flows while locked');
  me.realm = IMMORTAL_START; // Rank 6 Initial — first immortal rank
  ok(immortalUnlocked(), 'reaching immortal Rank 6 unlocks the currency');
  ok(rollImmortalStones(300, false) > 0, 'an immortal roster draws 仙石 from floor clears');
  ok(rollImmortalStones(300, true) > rollImmortalStones(300, false), 'bosses yield more 仙石');

  // (2) FUEL GATE — an immortal Gu (tier 6+) is inert without 仙石, and powers up with it.
  SI.guInv = [{ uid: 'imm1', guId: 'gu_fire_atk_imm' }]; me.gu = ['imm1'];
  SI.immortalStones = 0;
  const inert = effectiveStats(me);
  ok(inert.atk === inert.atkBase, 'an immortal ATK Gu adds NOTHING while the 仙石 pool is empty');
  SI.immortalStones = 50;
  const fueled = effectiveStats(me);
  ok(fueled.atk > inert.atk && fueled.atk > fueled.atkBase, 'with 仙石 in the pool the immortal Gu powers up ATK');

  // a MORTAL Gu (tier 1-5) is unaffected by the currency
  SI.guInv.push({ uid: 'mort', guId: 'gu_fire_atk_t3' });
  me.gu = ['mort']; SI.immortalStones = 0;
  const m = effectiveStats(me);
  ok(m.atk > m.atkBase, 'a tier-3 (mortal) Gu still works with an empty 仙石 pool');

  // (3) UPKEEP — each immortal Gu the active team channels costs IMM_STONE_UPKEEP_PER_GU per clear.
  me.gu = ['imm1'];
  ok(immortalGuCount() === 1 && immortalGuUpkeep() === IMM_STONE_UPKEEP_PER_GU, 'one immortal Gu → one unit of upkeep');
  me.gu = ['imm1', 'mort'];
  ok(immortalGuCount() === 1, 'mortal Gu are not counted toward immortal upkeep');
}
