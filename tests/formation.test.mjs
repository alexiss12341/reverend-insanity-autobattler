// Formation: flexible front/back split with back-row protection (rows from the explicit field).
import { ok, section } from './assert.mjs';
import { state, newGame, makeCharacter, frontTeam, backTeam } from '../src/state.js';
import { resolveEncounter } from '../src/systems/battle.js';

section('formation: flexible split & protection');
state.current = newGame('t'); const S = state.current;
S.roster = [
  makeCharacter('Tank', 'Common', false),
  makeCharacter('G1', 'Common', false), makeCharacter('G2', 'Common', false),
  makeCharacter('G3', 'Common', false), makeCharacter('G4', 'Common', false), makeCharacter('G5', 'Common', false),
];
S.roster.forEach((c) => { c.active = true; c.realm = 0; });
S.roster[0].row = 'front'; S.roster[0].base = { hp: 6000, atk: 1, def: 80, spd: 6 };
S.roster.slice(1).forEach((c) => { c.row = 'back'; c.base = { hp: 8, atk: 30, def: 0, spd: 10 }; });
ok(frontTeam().length === 1 && backTeam().length === 5, '1-front / 5-back split is recognized');

const enc = { floor: 1, isBoss: false, isWaveEncounter: false, waves: [[
  { name: 'Striker', isBoss: false, maxHp: 300, hp: 300, atk: 60, def: 0, spd: 18, effects: {} },
]] };
let leak = 0;
for (let i = 0; i < 40; i++) {
  const res = resolveEncounter(JSON.parse(JSON.stringify(enc)));
  if (res.allies[0].hp > 0 && res.allies.slice(1).some((a) => a.hp <= 0)) leak++;
}
ok(leak === 0, 'back row never dies while the single front tank still lives (40 fights)');

S.roster.forEach((c) => { c.row = 'back'; });
ok(frontTeam().length === 0, 'all-back split is allowed');
ok(typeof resolveEncounter(JSON.parse(JSON.stringify(enc))).win === 'boolean', 'all-back encounter resolves without error');
