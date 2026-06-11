// KILLER MOVES — composable Gu special moves (data/combos.js + battle.js). REVISION 2: 1 favored-domain
// CORE + 2+ same-path SUPPORT; favorability = support's purity toward the favored domain; lifesteal in
// OFFENSE, essPool/essRcv in VIGOR; 27 archetypes.
import { ok, section } from './assert.mjs';
import { state, newGame } from '../src/state.js';
import { validateKiller, profileKiller, assemble, autoConfigure, nearestCore, describeOps, synergyLabel,
  guInDomain, guDomains, KM_TAG_DOMAIN, EFFECT_DOMAINS, ARCHETYPES, ARCHETYPE_ORDER, KILLER_COST_MULT, KILLER_COOLDOWN } from '../src/data/combos.js';
import { guList } from '../src/data/gu.js';
import { generateEncounter } from '../src/data/floors.js';
import { resolveEncounter, damageUnit, killerTargets, executeKillerMove, shieldTotal, ageShields } from '../src/systems/battle.js';

// single-effect fire Gu of a given effect kind (robust lookup by daoPath + kind)
const fireKind = (kind) => guList().find((g) => g.daoPath === 'fire' && (g.tier || 1) <= 4
  && (g.effects || []).some((e) => e.kind === kind && (e.value || 0) > 0));
const atkA = fireKind('atk'), atkB = guList().find((g) => g.daoPath === 'fire' && g.id !== (atkA && atkA.id) && (g.effects || []).some((e) => e.kind === 'atk' && e.value > 0));
const critG = fireKind('crit'), hpG = fireKind('hp'), regenG = fireKind('regen');
const lifestealG = fireKind('lifesteal'), essPoolG = fireKind('essPool'), potencyG = fireKind('potency');
const spdG = fireKind('spd'), defG = fireKind('def');

section('killer: KM domains (lifesteal→offense, essPool/essRcv→vigor, mystic slim)');
ok(KM_TAG_DOMAIN.lifesteal === 'offense', 'lifesteal is in OFFENSE');
ok(KM_TAG_DOMAIN.essPool === 'vigor' && KM_TAG_DOMAIN.essRcv === 'vigor', 'essPool/essRcv are in VIGOR');
ok(KM_TAG_DOMAIN.hp === 'vigor' && KM_TAG_DOMAIN.regen === 'vigor', 'hp/regen are in VIGOR');
ok(KM_TAG_DOMAIN.potency === 'mystic' && KM_TAG_DOMAIN.status === 'mystic' && KM_TAG_DOMAIN.lucky === 'mystic', 'MYSTIC = potency/status/lucky only');
ok(KM_TAG_DOMAIN.spd === 'motion' && KM_TAG_DOMAIN.evasion === 'motion' && KM_TAG_DOMAIN.lifesteal !== 'motion', 'MOTION = spd/evasion (no lifesteal)');
ok(EFFECT_DOMAINS.includes('vigor') && !EFFECT_DOMAINS.includes('vitality'), 'domain renamed vitality → vigor');
if (lifestealG) ok(guInDomain(lifestealG, 'offense') && !guInDomain(lifestealG, 'motion'), 'a lifesteal Gu reads as OFFENSE, not MOTION');
else ok(true, 'skip lifesteal Gu (none generated)');
if (essPoolG) ok(guInDomain(essPoolG, 'vigor'), 'an essPool Gu reads as VIGOR');
else ok(true, 'skip essPool Gu');
ok(atkA && guDomains(atkA).includes('offense'), 'guDomains lists a Gu\'s domains');

section('killer: validateKiller gate (core domain + support same-path)');
const guById = {}; for (const g of [atkA, atkB, critG, hpG, regenG, spdG, defG, potencyG].filter(Boolean)) guById[g.id] = g;
const resolve = (uid) => guById[uid] || null;
const equipped = Object.keys(guById);
const cfgOK = { core: atkA.id, support: [atkB.id, critG.id], archetype: 'onslaught' };
ok(validateKiller(cfgOK, equipped, resolve), 'valid: offense core + 2 same-path support for an OFFENSE move');
ok(!validateKiller({ core: atkA.id, support: [atkB.id, critG.id], archetype: 'bulwark' }, equipped, resolve),
  'invalid: an OFFENSE core cannot arm a GUARD move (Bulwark)');
ok(defG ? validateKiller({ core: defG.id, support: [atkB.id, critG.id], archetype: 'bulwark' }, equipped, resolve) : true,
  'valid: a GUARD (def) core arms Bulwark');
ok(!validateKiller({ core: atkA.id, support: [atkB.id], archetype: 'onslaught' }, equipped, resolve), 'invalid: only 1 support (<2)');
ok(!validateKiller({ core: atkA.id, support: [atkB.id, atkA.id], archetype: 'onslaught' }, equipped, resolve), 'invalid: core listed as its own support');
// support of a different path
const iceAtk = guList().find((g) => g.daoPath === 'ice' && (g.effects || []).some((e) => e.kind === 'atk' && e.value > 0));
if (iceAtk) { const r2 = (uid) => guById[uid] || (uid === iceAtk.id ? iceAtk : null);
  ok(!validateKiller({ core: atkA.id, support: [atkB.id, iceAtk.id], archetype: 'onslaught' }, [...equipped, iceAtk.id], r2), 'invalid: support not same path as core');
} else ok(true, 'skip cross-path test');

section('killer: profileKiller + favorability purity');
const profPure = profileKiller(atkA, [atkB, critG], 'offense');
ok(profPure.count === 3 && profPure.path === 'fire', 'profile counts the set (core + support) and carries the path');
const sPure = assemble('onslaught', atkA, [atkB, critG]);
ok(sPure.favorability >= 0.99, 'all-offense support → favorability 1.0');
if (hpG && regenG) { const sOff = assemble('onslaught', atkA, [hpG, regenG]);
  ok(sOff.favorability <= 0.61, 'same-path but off-domain (vigor) support → 0.6 floor');
  const sMix = assemble('onslaught', atkA, [atkB, hpG]);
  ok(sMix.favorability > 0.6 && sMix.favorability < 1, 'mixed support → between floor and 1.0');
} else { ok(true, 'skip off-domain favorability'); ok(true, 'skip mixed favorability'); }

section('killer: AoE per-target mult ≪ single + deeper set scales up');
const dmgMult = (id, core, sup) => { const s = assemble(id, core, sup); const d = s.ops.find((o) => o.op === 'damage'); return d ? d.mult : 0; };
ok(dmgMult('onslaught', atkA, [atkB, critG]) > dmgMult('cataclysm', atkA, [atkB, critG]), 'single mult > reach mult');
ok(dmgMult('cataclysm', atkA, [atkB, critG]) > dmgMult('annihilation', atkA, [atkB, critG]), 'reach mult > board mult');
ok(dmgMult('onslaught', atkA, [atkB, critG]) > dmgMult('annihilation', atkA, [atkB, critG]) * 2, 'single hits FAR harder per foe than board AoE');
if (atkB && critG) { const deep = guList().filter((g) => g.daoPath === 'fire' && (g.effects || []).some((e) => e.kind === 'atk' && e.value > 0)).slice(0, 4);
  if (deep.length >= 4) ok(dmgMult('onslaught', deep[0], deep.slice(1)) > dmgMult('onslaught', atkA, [atkB, critG]), 'a deeper (4-Gu) set raises the mult');
  else ok(true, 'skip depth test'); } else ok(true, 'skip depth test');

section('killer: catalogue (27) + Enervate replaces Dominion');
ok(ARCHETYPE_ORDER.length === 27 && ARCHETYPE_ORDER.every((id) => ARCHETYPES[id]), '27 archetypes, every order entry valid');
ok(!ARCHETYPES.dominion && ARCHETYPES.enervate, 'Dominion removed; Enervate present');
ok(ARCHETYPES.bloodrush.domain === 'offense' && ARCHETYPES.whirlwind.domain === 'offense', 'Bloodrush/Whirlwind favor OFFENSE');
ok(ARCHETYPES.ascendance.domain === 'motion' && ARCHETYPES.warcry.domain === 'offense', 'Ascendance→MOTION, Warcry stays OFFENSE');
ok(ARCHETYPES.renewal.domain === 'vigor' && ARCHETYPES.sanctuary.domain === 'vigor', 'heals favor VIGOR');
const domCount = (d) => ARCHETYPE_ORDER.filter((id) => ARCHETYPES[id].domain === d).length;
ok(domCount('offense') === 8 && domCount('mystic') === 5 && domCount('guard') === 5 && domCount('motion') === 5 && domCount('vigor') === 4, 'domain tally 8/5/5/5/4');

section('killer: new op templates (perStatus, evasion, signed essence)');
ok(assemble('anathema', atkA, [atkB, critG]).ops.some((o) => o.op === 'damage' && o.perStatus > 0), 'Anathema damage has perStatus scaling');
if (spdG) { const evGu = fireKind('evasion') || spdG; ok(assemble('blur', spdG, [evGu, spdG === evGu ? spdG : spdG]).ops.some((o) => o.op === 'buff' && o.stat === 'evasion'), 'Blur grants an evasion buff'); }
else ok(true, 'skip Blur');
if (potencyG) ok(assemble('enervate', potencyG, [potencyG, potencyG]).ops.some((o) => o.op === 'essence' && o.pct < 0), 'Enervate drains essence (−pct)');
else ok(true, 'skip Enervate');
if (hpG) ok(assemble('wellspring', hpG, [hpG, hpG]).ops.some((o) => o.op === 'essence' && o.pct > 0), 'Wellspring restores essence (+pct)');
else ok(true, 'skip Wellspring');
ok(describeOps(sPure).length >= 1 && ['Low', 'Medium', 'High'].includes(synergyLabel(sPure.favorability)), 'display helpers produce text + synergy label');

section('killer: autoConfigure (new shape) + hints + constants');
const items = [atkA, atkB, critG].map((g) => ({ uid: g.id, gu: g }));
const auto = autoConfigure(items);
ok(auto && auto.core && Array.isArray(auto.support) && auto.support.length >= 2 && auto.archetype, 'autoConfigure → { core, support(≥2), archetype }');
ok(guInDomain(guById[auto.core] || atkA, ARCHETYPES[auto.archetype].domain), 'auto core matches the chosen archetype\'s domain');
ok(autoConfigure([{ uid: atkA.id, gu: atkA }, { uid: atkB.id, gu: atkB }]) === null, 'autoConfigure null with <3 same-path');
const near = nearestCore([{ uid: atkA.id, gu: atkA }, { uid: atkB.id, gu: atkB }]);
ok(near && near.have === 2 && near.need === 1, 'nearestCore reports closest-to-3 path');
ok(KILLER_COOLDOWN === 3 && KILLER_COST_MULT >= 2 && KILLER_COST_MULT <= 4, 'constants in band');

section('killer: AoE ignores formation (board-wide splashes the protected back row)');
{
  // foeBack sits behind a living foeFront in the SAME lane — under per-lane protection a single-target
  // attack can only reach foeFront. An AREA attack must splash the back row anyway.
  const caster   = { ally: true, side: 'ally', idx: 0, row: 'front', lane: 2, hp: 100, max: 100, atk: 10 };
  const foeFront  = { side: 'foe', idx: 0, row: 'front', lane: 2, hp: 100, max: 100, atk: 10 };
  const foeBack   = { side: 'foe', idx: 1, row: 'back',  lane: 2, hp: 100, max: 100, atk: 10 };
  const foes = [foeFront, foeBack];
  const board = killerTargets('allFoes', caster, foes, [caster]); // Annihilation / Contagion delivery
  ok(board.includes(foeFront) && board.includes(foeBack), 'board-wide AoE hits BOTH front and the PROTECTED back-row foe');
  const reach = killerTargets('reach', caster, foes, [caster]);   // ±1-lane column
  ok(reach.includes(foeBack), 'reach (±1 column) AoE includes the protected back-row foe in range');
  const single = killerTargets('target', caster, foes, [caster]); // single-target still gated by protection
  ok(single.length === 1 && single[0] === foeFront, 'single-target STILL respects protection (only the unshielded front)');
  // a dead front no longer shields the back from single-target either (sanity that protection is real)
  foeFront.hp = 0;
  const single2 = killerTargets('target', caster, foes, [caster]);
  ok(single2.length === 1 && single2[0] === foeBack, 'with the front dead, single-target reaches the back row');
}

section('killer: status lands AFTER the hit, only on struck foes, rolled vs Status Resistance');
{
  const FX0 = { atk:0, hitChance:0, crit:0, critDamage:1.5, critResist:0, armorPen:0, luckyHit:0, potency:0,
    statusResist:0, essDrain:0, dotSpread:0, thorns:0, lifesteal:0, regen:0, burn:0, inflicts:[], dodge:0 };
  const mk = (side, idx, row, lane, fx = {}) => ({ side, idx, row, lane, ally: side === 'ally', name: side + idx,
    hp: 1000, max: 1000, atk: 200, def: 0, actions: 0, statuses: {}, essMax: 0, ess: 0, fx: { ...FX0, ...fx } });
  const caster = mk('ally', 0, 'front', 0);
  const foeA = mk('foe', 0, 'front', 0);                  // struck, no resist → afflicted
  const foeB = mk('foe', 1, 'back',  0, { dodge: 2 });    // always dodges → never afflicted
  const foeC = mk('foe', 2, 'front', 1, { statusResist: 0.95 }); // struck but resists → not afflicted
  const foes = [foeA, foeB, foeC];
  // status op listed FIRST (proving the two-pass reorder); board-wide damage; burn rider at 90% base.
  const spec = { name: 'TestNova', cjk: '試', statuses: [{ type: 'burn', base: 0.9, dur: 2, mag: 0.1 }],
    ops: [{ op: 'status', sel: 'allFoes', from: 'set' }, { op: 'damage', sel: 'allFoes', mult: 2 }] };
  const realRandom = Math.random;
  Math.random = () => 0.5; // foeA/foeC hit (0.5<0.85), foeB dodges (0.5>0.01); burn lands at 0.9, resisted at 0.01
  try { executeKillerMove(caster, foes, [caster], spec, () => {}, null); }
  finally { Math.random = realRandom; }
  ok(Array.isArray(foeA.statuses.burn) && foeA.statuses.burn.length === 1, 'struck low-resist foe IS afflicted (status follows the hit)');
  ok(!foeB.statuses.burn, 'DODGED foe is NOT afflicted (status needs a connecting hit)');
  ok(!foeC.statuses.burn, 'struck HIGH-RESIST foe resists the status (inflict vs Status Resistance)');
  ok(foeA.hp < 1000 && foeC.hp < 1000 && foeB.hp === 1000, 'damage landed on the struck foes, dodged foe took none');
}

section('killer: Anathema afflicts BEFORE its damage (perStatus counts the fresh debuff)');
{
  const FX0 = { atk:0, hitChance:0, crit:0, critDamage:1.5, critResist:0, armorPen:0, luckyHit:0, potency:0,
    statusResist:0, essDrain:0, dotSpread:0, thorns:0, lifesteal:0, regen:0, burn:0, inflicts:[], dodge:0 };
  const mk = (side, idx, fx = {}) => ({ side, idx, row:'front', lane:0, ally: side === 'ally', name: side + idx,
    hp: 1000, max: 1000, atk: 200, def: 0, actions: 0, statuses: {}, essMax: 0, ess: 0, fx: { ...FX0, ...fx } });
  const caster = mk('ally', 0);
  const foe = mk('foe', 0);                                  // no pre-existing debuff
  // Anathema shape: single damage with perStatus 0.5 + inflictFirst, weaken rider at 100% base.
  const spec = { name: 'Anathema', cjk: '詛', statuses: [{ type: 'weaken', base: 1, dur: 2 }],
    ops: [{ op: 'damage', sel: 'target', mult: 1, perStatus: 0.5, inflictFirst: true }] };
  const realRandom = Math.random; Math.random = () => 0.5; // hit lands; weaken applies (chance ~0.99)
  try { executeKillerMove(caster, [foe], [caster], spec, () => {}, null); }
  finally { Math.random = realRandom; }
  // 200 base ATK × (1 + 0.5 × 1 debuff) = 300 — the +50% only happens if weaken was applied BEFORE the
  // damage calc. (Applied after, debuffCount would be 0 → 200 damage → hp 800.)
  ok(foe.statuses.weaken, 'Anathema applied its debuff on the hit');
  ok(foe.hp === 700, 'damage counted the freshly-applied debuff (300 dmg, not 200) — afflict resolves before damage calc');
}

section('killer: shield buffs — independent, oldest-first depletion, total + 2-turn expiry');
{
  const u = { hp: 100, max: 100, shields: [{ amt: 10, turns: 2 }] };
  damageUnit(u, 6); ok(shieldTotal(u) === 4 && u.hp === 100, 'shield soaks a small hit (no HP loss)');
  damageUnit(u, 8); ok(shieldTotal(u) === 0 && u.shields.length === 0 && u.hp === 96, 'a hit past the shield drains it, spills to HP, and the emptied buff is removed');
  // two INDEPENDENT buffs: damage consumes the OLDEST first
  u.shields = [{ amt: 5, turns: 2 }, { amt: 20, turns: 2 }];
  damageUnit(u, 8); // 5 (oldest, fully) + 3 from the newer
  ok(u.shields.length === 1 && u.shields[0].amt === 17, 'depletion starts from the OLDEST shield buff');
  ok(shieldTotal(u) === 17, 'displayed total = sum of the remaining buffs');
  // 2-turn expiry: each buff ages on its own timer and drops at 0
  const v = { shields: [{ amt: 10, turns: 2 }, { amt: 5, turns: 1 }] };
  ageShields(v); ok(v.shields.length === 1 && v.shields[0].amt === 10 && v.shields[0].turns === 1, 'buffs age independently — the 1-turn one expires, the 2-turn survives at 1');
  ageShields(v); ok(v.shields.length === 0, 'a shield buff is gone after 2 turns');
}

section('killer: fires in battle + enemy parity');
state.current = newGame('tkiller2'); const S2 = state.current;
const pl = S2.roster[0];
S2.clearedFloors[100] = true; // PROGRESSION GATE: killer moves unlock after clearing Floor 100
pl.realm = 8;                 // ...and only on rank 3+ (realm 8 = Rank 3 Initial; rankOf(8)+1 === 3)
pl.attrs.int = 80;
const core = atkA, sup = [atkB, critG].filter(Boolean);
pl.gu = [core, ...sup].map((g) => { const uid = 'kg_' + g.id; S2.guInv.push({ uid, guId: g.id }); return uid; });
pl.killer = { core: pl.gu[0], support: pl.gu.slice(1), archetype: 'cataclysm' };
const res = resolveEncounter(generateEncounter(2), null, { record: true });
const fired = res.timeline.steps.some((st) => (st.acts || []).some((a) => a.combo && a.combo.name));
ok(fired, 'a configured killer move fires in a recorded encounter');
ok(res.win === true || res.win === false, 'encounter resolves cleanly');
const enemyKiller = [50, 100, 250, 450].some((f) => generateEncounter(f).waves.flat().some((eu) => eu.killer && eu.killer.ops));
ok(enemyKiller, 'some deep/boss enemy auto-configures a killer move');

// REGRESSION (reported bug): the player set up a valid move, then swapped out an unrelated Gu, leaving a
// STALE support uid in the saved config (no longer in c.gu). The UI still showed the move + its cost, but
// battle.js attachKiller used to reject the whole move on the stale uid → it silently never fired despite
// a full essence pool. attachKiller now filters support to equipped (mirroring the UI), so it fires.
state.current = newGame('tkiller_stale'); const S3 = state.current;
const pst = S3.roster[0];
S3.clearedFloors[100] = true; pst.realm = 8; pst.attrs.int = 80;
const kcore = atkA, ksup = [atkB, critG].filter(Boolean);
pst.gu = [kcore, ...ksup].map((g) => { const uid = 'ks_' + g.id; S3.guInv.push({ uid, guId: g.id }); return uid; });
// saved support = the 2 equipped support PLUS a dangling uid for a Gu that's no longer equipped
pst.killer = { core: pst.gu[0], support: [...pst.gu.slice(1), 'ks_unequipped_stale'], archetype: 'cataclysm' };
const resStale = resolveEncounter(generateEncounter(2), null, { record: true });
const firedStale = resStale.timeline.steps.some((st) => (st.acts || []).some((a) => a.combo && a.combo.name));
ok(firedStale, 'a killer move with a STALE (unequipped) support uid still fires');
