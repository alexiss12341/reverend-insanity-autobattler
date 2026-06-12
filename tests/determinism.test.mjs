// Deterministic seeded replay — the foundation of server-authoritative arena fights: the server runs a
// battle and the client RE-ANIMATES it from just a seed, so the same seed must reproduce a fight
// bit-for-bit on any V8. No seed must stay live-random (single-player is untouched). See battle.js `rng`.
import { ok, section } from './assert.mjs';
import { state, newGame } from '../src/state.js';
import { resolveEncounter, buildSnapshot } from '../src/systems/battle.js';
import { generateEncounter } from '../src/data/floors.js';
import { guList } from '../src/data/gu.js';
import { guOf, effectiveStats } from '../src/systems/cultivation.js';
import { prestigeCombatMult } from '../src/systems/prestige.js';

section('determinism: seeded battle replay');
state.current = newGame('tdet');
// A sturdy player vs a multi-enemy floor → a long, RNG-rich fight (target picks, hit/crit/evasion,
// ±10% variance, status rolls) so seed effects are unmistakable. The enemy team is itself deterministic
// (floors.js seeds it from the floor number), so the ONLY thing that varies between runs is battle RNG.
const me = state.current.roster[0];
me.realm = 8; me.attrs = { str: 80, agi: 50, con: 80, int: 40, luck: 40 };

const enc = () => generateEncounter(24);
const sig = (r) => JSON.stringify(r.timeline); // timeline is plain, fully serializable (no char refs)

const a = resolveEncounter(enc(), null, { record: true, seed: 0xC0FFEE });
const b = resolveEncounter(enc(), null, { record: true, seed: 0xC0FFEE });
ok(sig(a) === sig(b), 'same seed → byte-identical timeline (deterministic replay)');
ok(a.win === b.win && a.rounds === b.rounds && a.simTime === b.simTime, 'same seed → identical outcome / rounds / simTime');

const c = resolveEncounter(enc(), null, { record: true, seed: 0xBADBAD });
ok(sig(a) !== sig(c), 'a different seed → a different fight (the seed truly drives the RNG)');

let varied = false;
for (let i = 0; i < 10 && !varied; i++) {
  if (sig(resolveEncounter(enc(), null, { record: true })) !== sig(resolveEncounter(enc(), null, { record: true }))) varied = true;
}
ok(varied, 'no seed → still live-random (unseeded runs differ)');

section('decouple: allyChars + ctx reproduces the activeTeam path');
// Building allies from PROVIDED character objects + a ctx that MIRRORS the live globals must produce a
// byte-identical fight to the default activeTeam()/global-state path — proving the server-side recompute
// path is faithful. (The real Edge Function swaps guLookup/immFuel/prestigeMult/killerUnlocked for
// validated submitted data; here they mirror the live globals, so the two paths must coincide exactly.)
const team = state.current.roster.filter((c) => c.active);
const ctx = {
  guLookup: guOf,
  immFuel: (state.current.immortalStones || 0) > 0,
  prestigeMult: prestigeCombatMult(),
  killerUnlocked: !!state.current.clearedFloors[100],
};
const viaState = resolveEncounter(enc(), null, { record: true, seed: 4242 });
const viaChars = resolveEncounter(enc(), null, { record: true, seed: 4242, allyChars: team, ctx });
ok(JSON.stringify(viaState.timeline) === JSON.stringify(viaChars.timeline),
  'allyChars + ctx (mirroring globals) → byte-identical fight to the activeTeam path');

section('snapshot: buildSnapshot serializes a recomputable defense team');
const snap1 = buildSnapshot(team, ctx);
ok(snap1.length === team.length && snap1[0].tiers && snap1[0].tiers.length >= 1, 'snapshot carries a per-Gu tier ladder for each member');
const es = effectiveStats(team[0]);
const top = snap1[0].tiers[snap1[0].tiers.length - 1];
ok(top.atk === es.atk && top.max === es.maxHp, 'snapshot top tier matches live effectiveStats (atk + maxHp)');
// the serialized team fights as a FOE side (what a challenger faces) without crashing, deterministically
const arenaEnc = { floor: 0, isBoss: false, isWaveEncounter: false, squad: 'Arena', waves: [snap1] };
const f1 = resolveEncounter(arenaEnc, null, { record: true, seed: 77, allyChars: team, ctx });
const f2 = resolveEncounter(arenaEnc, null, { record: true, seed: 77, allyChars: team, ctx });
ok(JSON.stringify(f1.timeline) === JSON.stringify(f2.timeline), 'arena-style fight (allyChars vs snapshot foes) replays deterministically');

section('snapshot: preserves formation + killer-move setup');
// equip a valid fire-path killer (offense core + 2 same-path support) and pin a non-default tile, then
// confirm buildSnapshot carries BOTH the formation (row/lane) and the resolved killer move through —
// the two things a registered arena team must keep intact.
const fA = guList().find((g) => g.daoPath === 'fire' && (g.effects || []).some((e) => e.kind === 'atk' && e.value > 0));
const fB = guList().find((g) => g.daoPath === 'fire' && fA && g.id !== fA.id && (g.effects || []).some((e) => e.kind === 'atk' && e.value > 0));
const fC = guList().find((g) => g.daoPath === 'fire' && (g.effects || []).some((e) => e.kind === 'crit' && e.value > 0));
if (fA && fB && fC) {
  me.gu = [fA, fB, fC].map((g, i) => { const uid = 'kmreg_' + i; state.current.guInv.push({ uid, guId: g.id }); return uid; });
  me.killer = { core: me.gu[0], support: [me.gu[1], me.gu[2]], archetype: 'onslaught' };
  me.row = 'back'; me.lane = 3;
  const kctx = { guLookup: guOf, immFuel: false, prestigeMult: prestigeCombatMult(), killerUnlocked: true };
  const ks = buildSnapshot([me], kctx);
  ok(ks[0].row === 'back' && ks[0].lane === 3, 'snapshot preserves the formation tile (row + lane)');
  ok(!!ks[0].killer && !!ks[0].killer.name && ks[0].comboCost > 0, 'snapshot preserves the configured killer move (spec + cost)');
  ok(ks[0].gu.length === 3, 'snapshot preserves the equipped Gu loadout');
} else {
  ok(true, '(skipped killer round-trip — no fire-path atk/crit Gu found in the library)');
}
