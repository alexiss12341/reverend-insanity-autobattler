// Immortal tier: resonance, attainment, ascension, tribulations, Dao Wounds, Venerable capstone.
import { ok, section } from './assert.mjs';
import { state, newGame } from '../src/state.js';
import { effectiveStats } from '../src/systems/cultivation.js';
import { addMarks, apertureCap, apertureUsed, attainmentIn,
  addComprehension, comprehensionLevelIn, comprehensionMult } from '../src/systems/dao.js';
import { ascend, accrue, pending, resolveTribulation, canBecomeVenerable, becomeVenerable,
  TRIBS_NEEDED, TRIB_THRESHOLD, tierForRank } from '../src/systems/tribulation.js';
import { MORTAL_PEAK, isImmortalRealm, realmName, rankOf } from '../src/data/realms.js';

section('immortal: resonance');
state.current = newGame('t'); const S = state.current; const me = S.roster[0]; me.active = true;
S.guInv = [{ uid: 'a', guId: 'gu_fire_atk_t3' }, { uid: 'b', guId: 'gu_fire_atk_t3' }]; me.gu = ['a', 'b'];
const both = effectiveStats(me).atk; me.gu = ['b']; const one = effectiveStats(me).atk; me.gu = ['a', 'b'];
ok(both > one, 'two same-path Gu resonate for more ATK than one');
me.realm = MORTAL_PEAK; // Rank 5 Peak — ready to ascend (mortals now advance by buying breakthroughs)

section('immortal: comprehension scaling & cap');
{
  const ch = newGame('tc').roster[0];
  ch.realm = 0; addComprehension(ch, 'fire', 1e9); // rank 1 → cap 2
  ok(comprehensionLevelIn(ch, 'fire') === 2, 'comprehension is hard-capped by rank (rank 1 → 2)');
  ch.realm = 22; // rank 8 → cap 10 unlocks banked points
  ok(comprehensionLevelIn(ch, 'fire') === 10, 'higher rank unlocks banked comprehension (rank 8 → 10)');
  ok(comprehensionMult(3, 5) < 1 && comprehensionMult(7, 5) > 1, 'under tier penalises, over tier rewards');
  ok(comprehensionMult(0, 10) === 0.10, 'deep under-comprehension floors at 10%');
}

section('immortal: ascension & attainment');
S.essence = 1e6; let asc = null, tries = 0;
do { me.realm = MORTAL_PEAK; asc = ascend(me.id); tries++; } while (!asc.ascended && tries < 80);
ok(asc.ascended && isImmortalRealm(me.realm), 'ascended to Gu Immortal');
me.realm = 22; // Rank 8 — aperture large enough for Supreme Grandmaster (40k marks)
const before = effectiveStats(me).atk; addMarks(me, 'fire', 40000);
ok(attainmentIn(me, 'fire').tier === 'Supreme Grandmaster', 'marks raise fire attainment to Supreme Grandmaster');
ok(effectiveStats(me).atk > before, 'Dao Mark amplification raises that path\'s Gu ATK');
addMarks(me, 'metal', 9999999);
ok(apertureUsed(me) <= apertureCap(me.realm), 'aperture cap is enforced');

section('immortal: tribulation tiers & advancement');
me.realm = 20; ok(tierForRank(rankOf(me.realm) + 1).name === 'Heavenly Tribulation', 'rank 6 → Heavenly');
me.realm = 21; ok(tierForRank(rankOf(me.realm) + 1).name === 'Grand Tribulation', 'rank 7 → Grand');
me.realm = 22; ok(tierForRank(rankOf(me.realm) + 1).lethal, 'rank 8 → Myriad is lethal');
me.realm = 20; me.trib = { progress: 0, passed: 0 }; me.base = { hp: 2e5, atk: 3e4, def: 12e4, spd: 30 };
let ranks = 0;
for (let i = 0; i < 160 && rankOf(me.realm) + 1 < 8; i++) { accrue(me, TRIB_THRESHOLD); if (pending(me)) { const r = resolveTribulation(me.id); if (r.rankUp) ranks++; if (r.died) break; } }
ok(rankOf(me.realm) + 1 === 8, 'tribulations advance the immortal to Rank 8');
for (let i = 0; i < 40 && me.trib.passed < TRIBS_NEEDED; i++) { accrue(me, TRIB_THRESHOLD); if (pending(me)) resolveTribulation(me.id); }
ok(me.trib.passed >= TRIBS_NEEDED, 'all three Myriad Tribulations passed at Rank 8');

section('immortal: Venerable capstone & wounds');
S.guInv.push({ uid: 'l', guId: 'gu_blood_lifesteal_imm' }, { uid: 'f', guId: 'gu_time_evasion_imm' });
addComprehension(me, 'fire', 1e9); // Comprehension 10 in fire (rank 8 cap) — a Venerable gate
ok(canBecomeVenerable(me).ok, 'Venerable conditions met (rank 8 + Supreme + Comp 10 + Lifespan/Fate Gu)');
let vr = null, vt = 0; do { vr = becomeVenerable(me.id); if (me.realm === 23) break; me.trib = { progress: 0, passed: TRIBS_NEEDED }; vt++; } while (vt < 80);
ok(me.realm === 23, `became Venerable (${realmName(me.realm)})`);
// guaranteed lethal failure on a frail cultivator → Dao Wound (player spared death)
state.current = newGame('t2'); const w = state.current.roster[0]; w.active = true;
w.realm = 22; w.trib = { progress: 0, passed: 0 }; w.base = { hp: 1, atk: 1, def: 0, spd: 1 };
accrue(w, TRIB_THRESHOLD); const wr = resolveTribulation(w.id);
ok(!wr.win && (w.wounds || []).length > 0, 'failed Myriad → Dao Wound (player spared death)');
