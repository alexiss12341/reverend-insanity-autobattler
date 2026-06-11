// Cultivation system: derives a character's effective combat stats from
//   attribute base × (Gu effects × comprehension × resonance × mark-amp) × prestige,
// minus Dao Wound + temporary-injury penalties; and handles mortal STONE-PURCHASED breakthroughs
// (rank 1-5). Immortal ranks (6-9) advance via tribulations (see systems/tribulation.js).
import { S, activeTeam } from '../state.js';
import { guEssenceCostFor, resolveOwned } from '../data/gu.js';
import { MORTAL_PEAK, realmName, isImmortalRealm, essenceQuality, rankOf } from '../data/realms.js';
import { resonanceMult, attainmentOf, marksIn, woundMult, injuryMult, ATTAIN_RANK, markAmp, comprehensionLevelIn, comprehensionMult, comprehensionCap } from './dao.js';
import { affinityEffectMult, lineEffects, lineGuAmp } from '../data/traits.js';
import { prestigeCombatMult } from './prestige.js';
import { effAttr, deriveStats, ATTR_KEYS, apertureCapacity, apertureRegenFactor, realmPointsTotal, aptThreshold, aptitudeStepBonus, effAptitude, spentPoints } from '../data/attributes.js';
import { STATUS } from '../data/status.js';

export function guOf(uid) {
  const owned = S().guInv.find((g) => g.uid === uid);
  return owned ? resolveOwned(owned) : null;   // ascended immortals surface their instance-tier form
}

// Each Gu effect's baked magnitude is further scaled by the wielder's PATH MASTERY: comprehension
// (level-vs-tier) × same-path resonance × Dao-Mark amplification (immortals). The amplified multiplier
// on %-stats is capped to prevent runaway; bounded effects use the un-amplified multiplier.
const STAT_MULT_CAP = 4;
const PCT_KINDS = new Set(['atk', 'def', 'hp', 'spd', 'essPool', 'essRcv', 'regen']);
const FIELD = { atk: 'atkPct', def: 'defPct', hp: 'hpPct', spd: 'spdPct', essPool: 'essPoolPct',
  essRcv: 'essRcvPct', regen: 'regenPct', crit: 'crit', critDmg: 'critDmg', critRes: 'critRes',
  statusRes: 'statusRes', evasion: 'evasion', hit: 'hit', armorPen: 'armorPen', lifesteal: 'lifesteal',
  thorns: 'thorns', potency: 'potency', lucky: 'lucky' };

function applyEffect(e, mB, mA, add) {
  const f = FIELD[e.kind]; if (!f) return;
  const mult = PCT_KINDS.has(e.kind) ? Math.min(mA, STAT_MULT_CAP) : mB;
  add[f] += (e.value || 0) * mult; // signed — drawbacks subtract
}

// Returns combat-ready stats + battle-effect bundle. Base stats DERIVE from the 5 attributes; each
// Gu's SIGNED effects (affinity ×1.10 already baked in at generation) layer on, scaled by path
// mastery, then wounds/prestige. Multi-effect Gu contribute every line; status-Gu add inflict riders.
// `activeSet` (optional Set of equipped uids) gates which Gu are CHANNELLED: when supplied, only those
// uids contribute effects/essCost/resonance — letting the battle engine compute the stat profile for a
// partially-essence-starved loadout (the un-channelled Gu vanish entirely, incl. their HP/aperture). When
// omitted, the FULL loadout applies (every other caller — UI, economy, idle preview — passes nothing).
export function effectiveStats(ch, activeSet) {
  const guOn = (uid) => !activeSet || activeSet.has(uid); // un-channelled (essence-starved) Gu drop out
  const a = {}; for (const k of ATTR_KEYS) a[k] = effAttr(ch, k);
  const d = deriveStats(a);
  const add = { atkPct: 0, defPct: 0, hpPct: 0, spdPct: 0, essPoolPct: 0, essRcvPct: 0, regenPct: 0,
    crit: 0, critDmg: 0, critRes: 0, statusRes: 0, evasion: 0, hit: 0, armorPen: 0, lifesteal: 0,
    thorns: 0, potency: 0, lucky: 0 };
  const inflicts = [];
  const immortal = isImmortalRealm(ch.realm);
  const cultRank = rankOf(ch.realm) + 1; // wielder rank 1-9 → discounts low Gu, surcharges high Gu
  // IMMORTAL GU FUEL: an immortal-rank Gu (tier 6+) is UNUSABLE without Immortal Essence Stones (仙石) —
  // when the pool is empty it contributes nothing (no effects, no essence cost, no resonance), exactly
  // like an un-channelled Gu. The 仙石 faucet only flows once the roster is immortal (state.immortalUnlocked).
  const immFuel = (S().immortalStones || 0) > 0;
  const guInert = (gu) => gu.tier >= 6 && !immFuel; // skip immortal Gu while out of 仙石

  const pathCount = {};
  for (const uid of ch.gu) { if (!guOn(uid)) continue; const gu = guOf(uid); if (gu && !guInert(gu)) pathCount[gu.daoPath] = (pathCount[gu.daoPath] || 0) + 1; }
  let essCost = 0;
  const guAmp = 1 + lineGuAmp(ch); // Adept line: amplifies EVERY Gu's effect (path-agnostic)

  for (const uid of ch.gu) {
    if (!guOn(uid)) continue;
    const gu = guOf(uid); if (!gu) continue;
    if (guInert(gu)) continue; // immortal Gu with no 仙石 to power it → contributes nothing
    const path = gu.daoPath;
    essCost += guEssenceCostFor(gu, cultRank);
    const marks = marksIn(ch, path);
    const cMult = comprehensionMult(comprehensionLevelIn(ch, path), gu.tier);
    const aff = affinityEffectMult(ch, path);                       // Dao Path Affinity trait (×1.10 on its path)
    const mB = resonanceMult(pathCount[path]) * cMult * aff * guAmp; // comprehension × resonance × affinity × Adept
    const mA = mB * (immortal ? markAmp(marks) : 1);                // + Dao-Mark amplification (immortals)
    for (const e of (gu.effects || [])) {
      if (e.kind === 'status') inflicts.push({ type: e.status, base: e.chance, dur: e.dur, mag: e.dot });
      else applyEffect(e, mB, mA, add);
    }
  }

  // Gu-only ATK% so far (captured BEFORE line/aura) → lets battle floor the essence channel penalty at
  // the unaided base: under-channeling only saps the Gu-ADDED attack, never your bare-handed swing.
  const guAtkPct = add.atkPct;

  // Archetype LINE trait: flat combat bonuses fold into the same add-bag; a few NON-add-bag extras are
  // pulled out separately — essDrain (Reaver, on-hit), dotSpread (Afflictor, on-kill), apBase (Foundation,
  // flat base-pool boost). (Support lines have no `tiers` → null. `fortune` is economy, read in economy.js.)
  const lb = lineEffects(ch);
  if (lb) for (const k in lb) if (k in add) add[k] += lb[k];
  const lnEssDrain = (lb && lb.essDrain) || 0;
  const lnDotSpread = (lb && lb.dotSpread) || 0;
  const lnApBase = (lb && lb.apBase) || 0;

  const w = woundMult(ch) * injuryMult(ch);
  const pm = prestigeCombatMult();
  const maxHpF = d.maxHp * (1 + add.hpPct);
  return {
    maxHp: Math.round(maxHpF * w * pm),
    atk: Math.round(d.atk * (1 + add.atkPct) * w * pm),
    atkBase: Math.round(d.atk * (1 + add.atkPct - guAtkPct) * w * pm), // atk WITHOUT the Gu atk% (channel floor)
    def: Math.round(d.def * (1 + add.defPct) * w),
    spd: Math.max(1, Math.round(d.spd * (1 + add.spdPct) * w)),
    lifesteal: Math.max(0, add.lifesteal),               // UNCAPPED (heal still bounded by max HP at use)
    crit: Math.max(0, d.critChance + add.crit),          // UNCAPPED — battle.js subtracts target critResist FIRST, then clamps the contested roll (like hit/evasion)
    dodge: Math.max(0, d.evasion + add.evasion),         // UNCAPPED — scales past 100% like potency (no 95% pin)
    thorns: Math.min(1, Math.max(0, add.thorns)),
    essDrain: Math.max(0, lnEssDrain),   // Reaver: fraction of target essence stolen on hit
    dotSpread: Math.max(0, lnDotSpread), // Afflictor: chance to spread the victim's DoTs on a kill
    regen: Math.round((a.con || 0) * 0.15 + add.regenPct * maxHpF),
    burn: 0, extra_turn: 0, stone_find: 0, // legacy fields (battle reads them; no Gu grants them now)
    critDamage: Math.max(1, d.critDamage + add.critDmg),
    critResist: Math.max(0, d.critResist + add.critRes), // UNCAPPED — subtracted raw from attacker crit in battle.js, so overcap resist fully counters overcap crit
    hitChance: d.hitChance + add.hit,
    armorPen: Math.max(0, d.armorPen + add.armorPen),    // UNCAPPED (battle.js floors def-reduction at 0, so ≥100% just fully ignores DEF)
    potency: Math.max(0, d.potency + add.potency),
    statusResist: Math.max(0, d.statusResist + add.statusRes), // UNCAPPED (contested inflict roll clamps the result in battle.js)
    luckyHit: Math.max(0, d.luckyHit + add.lucky),
    // APERTURE pool = INT base × essence QUALITY × CAPACITY (aptitude), + Gu essence-pool %.
    essencePool: Math.round((d.essencePool + lnApBase) * essenceQuality(ch.realm) * apertureCapacity(effAptitude(ch)) * (1 + add.essPoolPct)),
    essenceRegen: d.essenceRegen * apertureRegenFactor(effAptitude(ch)) * (1 + add.essRcvPct),
    essenceCost: essCost,
    inflicts, // status riders, one per equipped status-Gu effect
  };
}

export const teamStoneFind = () => activeTeam().reduce((s, c) => s + effectiveStats(c).stone_find, 0);

// ---- Mortal breakthroughs (ranks 1-5) ----
// Combat no longer grants cultivation XP; a mortal advances by SPENDING Primeval Essence Stones (石)
// to attempt a breakthrough that can FAIL. Cost is anchored to the attribute points the step would
// grant (so a big-realm boundary — granting ~8× a sub-stage — costs ~8× more). Immortals (>=
// MORTAL_PEAK) still advance only by tribulation.
const STONES_PER_POINT = 2500;  // 石 per attribute point the step grants (cultivation is a major stone sink)
const COST_REALM_GROWTH = 1.20; // cost compounds per realm step — deeper realms cost progressively more

// A "big-realm boundary" is the Peak → next rank's Initial step (realm index ...3, 7, 11, 15).
const isBoundaryRealm = (realm) => (realm % 4) === 3;

// 石 cost to break through FROM `realm` to realm+1 (only meaningful below MORTAL_PEAK). Anchored to the
// attribute points the step grants, then compounded by COST_REALM_GROWTH^realm so the price climbs the
// deeper the realm (on top of the points-driven boundary walls).
export const breakthroughCost = (realm) =>
  Math.round(STONES_PER_POINT * (realmPointsTotal(realm + 1) - realmPointsTotal(realm)) * Math.pow(COST_REALM_GROWTH, realm));

// Big-realm boundaries are FLOOR-GATED: you must have BEATEN floor 50 × (the rank you're entering − 1)
// before crossing — rank 2 ← Floor 50, rank 3 ← 100, rank 4 ← 150, rank 5 ← 200. Sub-realm steps are
// never gated. Returns 0 when the step has no floor gate. (rankOf(realm)+1 = the rank you'd enter.)
export const breakthroughFloorReq = (realm) => (isBoundaryRealm(realm) ? 50 * (rankOf(realm) + 1) : 0);

// Highest comprehension LEVEL across all the character's paths (0 if none).
function maxComprehensionLevel(ch) {
  let lvl = 0;
  for (const p in (ch.comprehension || {})) lvl = Math.max(lvl, comprehensionLevelIn(ch, p));
  return lvl;
}

// Breakthrough success = 70% from APTITUDE (absolute, gradient up to a per-step threshold) + 30% from
// the highest dao COMPREHENSION level (gradient up to a per-step target). Both targets ramp per small
// realm so the big-realm boundaries are the hardest within a rank, and 100% is reachable only with
// aptitude ≥ threshold AND a fully rank-capped comprehension level.
//   aptThreshold(realm) = (9 + realm)/16  → boundaries 0.75 / 1.00 / 1.25 / 1.50 (+0.25 per big realm,
//                                            +0.0625 per small realm) — shared with attributes.js, which
//                                            also uses it for the aptitude-overflow attribute-point bonus
//   compTarget(realm)   = comprehensionCap(realm) × (substage+1)/4  → the rank's cap at the boundary
const compTarget = (realm) => comprehensionCap(realm) * ((realm % 4) + 1) / 4;
export function breakthroughChance(ch) {
  const apt = 0.70 * Math.min(1, effAptitude(ch) / aptThreshold(ch.realm));
  const tgt = compTarget(ch.realm);
  const comp = 0.30 * (tgt > 0 ? Math.min(1, maxComprehensionLevel(ch) / tgt) : 1);
  return Math.max(0, Math.min(1, apt + comp));
}

export const isInjured = (ch) => !!(ch.injuryUntil && Date.now() < ch.injuryUntil);

// Attempt a paid, fallible mortal breakthrough. Returns an outcome object consumed by main.js.
// A FAILURE simply spends the stones — NO injury and NO Dao Wound, at any step (sub-realm OR big-realm
// boundary); breakthrough RNG can never harm a cultivator. The player just re-attempts once they can
// afford the cost again. (The injury debuff has been retired; `isInjured`/`injuryMult` stay inert.)
export function attemptBreakthrough(charId) {
  const ch = S().roster.find((c) => c.id === charId);
  if (!ch) return { ok: false, msg: 'No such cultivator.' };
  if (ch.realm >= MORTAL_PEAK) return { ok: false, msg: 'Already at the mortal ceiling — attempt Ascension instead.' };
  const gate = breakthroughFloorReq(ch.realm);
  if (gate && S().frontier <= gate) return { ok: false, msg: `Clear Floor ${gate} before crossing into ${realmName(ch.realm + 1)}.` };
  const cost = breakthroughCost(ch.realm);
  if (S().stones < cost) return { ok: false, msg: `Need ${cost.toLocaleString()} 石 to attempt this breakthrough.` };
  S().stones -= cost;
  if (Math.random() < breakthroughChance(ch)) {
    const from = ch.realm;
    ch.realm += 1;
    const bonus = aptitudeStepBonus(from, effAptitude(ch));                              // aptitude-overflow attribute points (incl. Soul Imprint)
    const points = (realmPointsTotal(ch.realm) - realmPointsTotal(from)) + bonus;        // base step grant + bonus
    return { ok: true, success: true, cost, points, bonus,
      msg: `${ch.name} breaks through to ${realmName(ch.realm)} — +${points} attribute points${bonus > 0 ? ` (incl. +${bonus} from aptitude overflow)` : ''}.` };
  }
  return { ok: true, success: false, cost,
    msg: `${ch.name}'s breakthrough fails — the primeval stones are spent, but the cultivator is unharmed.` };
}

// Respec: release every allocated attribute point back into the unspent pool for a stone fee plus a
// flat Immortal Essence toll. Each point currently invested costs RESPEC_COST_PER_POINT 石 to unbind
// (so a heavily-built cultivator pays more to reshape) AND a flat RESPEC_ESSENCE_COST ✦ regardless of
// build size. After paying, all five attributes drop to zero and the points become re-distributable.
// Pure refund — no realm/aptitude change, no risk.
export const RESPEC_COST_PER_POINT = 1000;
export const RESPEC_ESSENCE_COST = 100;
export const respecCost = (ch) => RESPEC_COST_PER_POINT * (ch ? spentPoints(ch) : 0);

export function respecAttributes(charId) {
  const ch = S().roster.find((c) => c.id === charId);
  if (!ch) return { ok: false, msg: 'No such cultivator.' };
  const invested = spentPoints(ch);
  if (invested <= 0) return { ok: false, msg: `${ch.name} has no allocated attributes to respec.` };
  const cost = respecCost(ch);
  const ess = RESPEC_ESSENCE_COST;
  if (S().stones < cost) return { ok: false, msg: `Need ${cost.toLocaleString()} 石 to respec ${ch.name}'s attributes.` };
  if (S().essence < ess) return { ok: false, msg: `Need ${ess.toLocaleString()} ✦ Immortal Essence to respec ${ch.name}'s attributes.` };
  S().stones -= cost;
  S().essence -= ess;
  ch.attrs = { str: 0, agi: 0, con: 0, int: 0, luck: 0 };
  return { ok: true, cost, ess, refunded: invested,
    msg: `${ch.name}'s attributes reset — ${invested.toLocaleString()} point${invested === 1 ? '' : 's'} unallocated for ${cost.toLocaleString()} 石 + ${ess.toLocaleString()} ✦.` };
}
