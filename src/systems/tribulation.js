// Immortal-tier progression: Ascension, Tribulations, Dao Wounds, and the Venerable capstone.
//
// At Rank 5 Peak a mortal may attempt ASCENSION (a solo trial) to become a Gu Immortal (Rank 6).
// From there, ranks 6-9 advance NOT by XP but by surviving TRIBULATIONS — solo trials where the
// cultivator fights a manifestation scaled to their own power × a tier multiplier:
//   Rank 6 Heavenly (×1.6) · Rank 7 Grand (×2.2) · Rank 8 Myriad (×3.0, lethal) · capstone Chaos (×4.5, lethal)
// Passing TRIBS_NEEDED apex tribulations at a rank advances it and grows aperture space; each pass
// also deposits Dao Marks into the cultivator's dominant path.
//
// FAILURE leaves a permanent DAO WOUND (a stacking stat penalty). At WOUND_CAP wounds, the next
// failure is fatal; failing a lethal-tier tribulation (Myriad/Chaos) is also fatal. Death removes the
// cultivator and scatters their marks. The player character is spared death (wounds only).
//
// Rank 8 -> 9 (Venerable) is gated behind the four canonical conditions (see canBecomeVenerable).
import { S } from '../state.js';
import { effectiveStats } from './cultivation.js';
import { MORTAL_PEAK, IMMORTAL_START, MAX_REALM, isImmortalRealm, rankOf, realmName } from '../data/realms.js';
import { addMarks, dominantPath, scatterMarks, attainmentIn, ATTAIN_RANK, apertureCap, comprehensionLevelIn } from './dao.js';

export const TRIBS_NEEDED = 3;
export const TRIB_THRESHOLD = 100; // aperture-years to manifest the next tribulation
export const WOUND_CAP = 3;        // wounds tolerated; the next failure after this is fatal
const WOUND_SEVERITY = 0.08;
export const ASCEND_COST = 1000;   // Immortal Essence to attempt ascension

// `marks` = average Dao Marks granted on passing this tier (wiki anchors); each pass rolls ±33%.
const TIER = {
  ascension: { name: 'Ascension Trial',     mult: 1.4, lethal: false, marks: 250 },
  6: { name: 'Heavenly Tribulation', mult: 1.6, lethal: false, marks: 750 },
  7: { name: 'Grand Tribulation',    mult: 2.2, lethal: false, marks: 7250 },
  8: { name: 'Myriad Tribulation',   mult: 3.0, lethal: true,  marks: 86750 },
  9: { name: 'Chaos Tribulation',    mult: 4.5, lethal: true,  marks: 300000 },
};
export const tierForRank = (rank) => TIER[rank] || TIER[6];
// A tribulation grants Dao Marks of its own PATH; until the holy land lands, that path is the
// cultivator's dominant equipped path. The amount is the tier's average rolled ±33%.
const rollMarks = (base) => Math.round(base * (0.67 + Math.random() * 0.66));

// ---- solo trial simulation (one cultivator vs one manifestation, gauge-based) ----
function soloFight(ch, mult) {
  const s = effectiveStats(ch);
  const me = { hp: s.maxHp, max: s.maxHp, atk: s.atk, def: s.def, spd: Math.max(1, s.spd), fx: s, gauge: 0 };
  const foe = {
    hp: Math.round(s.maxHp * mult * 1.0), max: Math.round(s.maxHp * mult * 1.0),
    atk: Math.round(s.atk * mult * 0.35), def: Math.round(s.def * 0.3), spd: Math.max(1, Math.round(s.spd * 0.9)),
    fx: { crit: 0.08, dodge: 0, lifesteal: 0, thorns: 0, burn: 0, regen: 0, extra_turn: 0,
      hitChance: 0, critDamage: 1.8, critResist: 0, armorPen: 0, luckyHit: 0 }, gauge: 0,
  };
  const T = 1000; let guard = 0;
  const clampP = (p) => Math.max(0.01, Math.min(0.99, p));
  // Same Hit → Lucky → Crit → Armor-Pen pipeline as the main battle engine, minus logging/timeline.
  const act = (u, t) => {
    if (u.fx.regen > 0) u.hp = Math.min(u.max, u.hp + u.fx.regen);
    if (Math.random() > clampP(0.85 + (u.fx.hitChance || 0) - (t.fx.dodge || 0))) return; // miss
    const def = t.def * 0.6 * Math.max(0, 1 - (u.fx.armorPen || 0));
    let dmg = Math.max(1, Math.round(u.atk - def));
    if (Math.random() < (u.fx.luckyHit || 0)) dmg = Math.round(dmg * 1.5 * (u.fx.critDamage || 1.5));
    else if ((u.fx.crit || 0) > 0 && Math.random() < clampP((u.fx.crit || 0) - (t.fx.critResist || 0))) dmg = Math.round(dmg * (u.fx.critDamage || 1.5));
    t.hp -= dmg;
    if (u.fx.lifesteal > 0) u.hp = Math.min(u.max, u.hp + Math.round(dmg * u.fx.lifesteal));
    if (t.fx.thorns > 0 && t.hp > 0) u.hp -= Math.round(dmg * t.fx.thorns);
    if (u.fx.burn > 0) t.hp -= u.fx.burn;
  };
  while (me.hp > 0 && foe.hp > 0 && guard++ < 4000) {
    const dt = Math.min((T - me.gauge) / me.spd, (T - foe.gauge) / foe.spd);
    me.gauge += dt * me.spd; foe.gauge += dt * foe.spd;
    const order = me.gauge >= foe.gauge ? [me, foe] : [foe, me];
    for (const u of order) {
      if (u.gauge < T - 1e-6 || u.hp <= 0) continue;
      u.gauge = 0;
      act(u, u === me ? foe : me);
      if (u === me && Math.random() < me.fx.extra_turn && foe.hp > 0) act(me, foe);
      if (me.hp <= 0 || foe.hp <= 0) break;
    }
  }
  return me.hp > 0;
}

const isPlayerC = (ch) => !!ch.isPlayer;

function woundOrKill(ch, lethalTier) {
  const fatal = (lethalTier || (ch.wounds || []).length >= WOUND_CAP);
  if (fatal && !isPlayerC(ch)) {
    scatterMarks(ch, 1);
    S().roster = S().roster.filter((c) => c.id !== ch.id);
    return { died: true };
  }
  ch.wounds = ch.wounds || [];
  ch.wounds.push(WOUND_SEVERITY);
  return { died: false, wounds: ch.wounds.length };
}

// ---- Ascension (Rank 5 Peak -> Rank 6) ----
export const canAscend = (ch) => ch.realm === MORTAL_PEAK;
export function ascend(charId) {
  const ch = S().roster.find((c) => c.id === charId);
  if (!ch) return { ok: false, msg: 'No such cultivator.' };
  if (!canAscend(ch)) return { ok: false, msg: 'Must be at Rank 5 Peak to attempt ascension.' };
  if (S().essence < ASCEND_COST) return { ok: false, msg: `Need ${ASCEND_COST} Immortal Essence to attempt.` };
  S().essence -= ASCEND_COST;
  const win = soloFight(ch, TIER.ascension.mult);
  if (!win) return { ok: true, ascended: false, msg: `${ch.name}'s ascension failed; the essence is spent. Grow stronger and try again.` };
  ch.realm = IMMORTAL_START; // Rank 6 Initial
  ch.xp = 0; ch.trib = { progress: 0, passed: 0 };
  // ascension's earthly calamity + heavenly tribulation carve the first Dao Marks
  const p = dominantPath(ch);
  if (p) addMarks(ch, p, rollMarks(TIER.ascension.marks));
  return { ok: true, ascended: true, msg: `${ch.name} has ascended — now a Gu Immortal (${realmName(ch.realm)})!` };
}

// ---- Tribulations (Rank 6-8 advancement) ----
// Accrue aperture-years onto every active immortal (called from the idle loop / on wins).
export function accrue(ch, amount) {
  if (!isImmortalRealm(ch.realm) || ch.realm >= MAX_REALM) return; // rank 9 (Venerable) is the end
  ch.trib = ch.trib || { progress: 0, passed: 0 };
  if (ch.trib.passed < TRIBS_NEEDED) ch.trib.progress += amount;
}
export function pending(ch) {
  if (!isImmortalRealm(ch.realm) || ch.realm >= MAX_REALM) return null;
  const t = ch.trib || { progress: 0, passed: 0 };
  if (t.passed >= TRIBS_NEEDED || t.progress < TRIB_THRESHOLD) return null;
  return tierForRank(rankOf(ch.realm) + 1);
}
// Resolve the pending tribulation for a character. Returns an outcome object.
export function resolveTribulation(charId) {
  const ch = S().roster.find((c) => c.id === charId);
  if (!ch) return { ok: false, msg: 'No such cultivator.' };
  const tier = pending(ch);
  if (!tier) return { ok: false, msg: 'No tribulation is manifesting.' };
  ch.trib.progress -= TRIB_THRESHOLD;
  const win = soloFight(ch, tier.mult);
  if (win) {
    ch.trib.passed += 1;
    const p = dominantPath(ch);
    const marks = p ? addMarks(ch, p, rollMarks(tier.marks)) : 0;
    let msg = `${ch.name} survives the ${tier.name}! (${ch.trib.passed}/${TRIBS_NEEDED})`;
    if (marks) msg += ` +${marks} ${p} Dao Marks.`;
    let rankUp = false;
    if (ch.trib.passed >= TRIBS_NEEDED && ch.realm < 22) {
      ch.realm += 1; ch.trib = { progress: 0, passed: 0 }; rankUp = true;
      msg += ` Breakthrough to ${realmName(ch.realm)}!`;
    } else if (ch.trib.passed >= TRIBS_NEEDED) {
      msg += ' Rank 8 trials complete — the path to Venerable lies open.';
    }
    return { ok: true, win: true, rankUp, tier, msg };
  }
  const r = woundOrKill(ch, tier.lethal);
  return { ok: true, win: false, died: r.died, tier,
    msg: r.died ? `${ch.name} perished in the ${tier.name}. Their Dao scatters to the wind.`
                : `${ch.name} fails the ${tier.name} and suffers a Dao Wound (${r.wounds}/${WOUND_CAP}).` };
}

// ---- Venerable capstone (Rank 8 -> Rank 9) ----
export function canBecomeVenerable(ch) {
  const reasons = [];
  if (ch.realm !== 22) reasons.push('Must be at Rank 8.');
  if (!ch.trib || ch.trib.passed < TRIBS_NEEDED) reasons.push('Must pass all 3 Myriad Tribulations.');
  // Venerable is forged on ONE chosen path: it needs Supreme Grandmaster attainment (40k marks)
  // AND Comprehension 10 in that same path.
  const venPath = Object.keys(ch.daoMarks || {}).find(
    (p) => ATTAIN_RANK[attainmentIn(ch, p).tier] >= 4 && comprehensionLevelIn(ch, p) >= 10);
  if (!venPath) reasons.push('Need Supreme Grandmaster attainment AND Comprehension 10 in a single path.');
  const owns = (id) => S().guInv.some((g) => g.guId === id);
  if (!owns('gu_blood_lifesteal_imm')) reasons.push('Must possess the Lifespan (blood-lifesteal immortal) Gu.');
  if (!owns('gu_time_evasion_imm')) reasons.push('Must possess the Fate (time-evasion immortal) Gu.');
  return { ok: reasons.length === 0, reasons };
}
export function becomeVenerable(charId) {
  const ch = S().roster.find((c) => c.id === charId);
  if (!ch) return { ok: false, msg: 'No such cultivator.' };
  const chk = canBecomeVenerable(ch);
  if (!chk.ok) return { ok: false, msg: chk.reasons.join(' ') };
  // The final blockade: survive the Chaos Tribulation.
  const win = soloFight(ch, TIER[9].mult);
  if (!win) {
    const r = woundOrKill(ch, true);
    return { ok: true, ascended: false, died: r.died,
      msg: r.died ? `${ch.name} was undone by the Chaos Tribulation.` : `${ch.name} survives but is gravely wounded by the Chaos Tribulation.` };
  }
  ch.realm = MAX_REALM; // Rank 9
  const title = ch.isPlayer ? 'Demon Venerable' : 'Venerable';
  return { ok: true, ascended: true, msg: `${ch.name} breaks the Heavenly Dao's three blockades and becomes ${title}!` };
}
