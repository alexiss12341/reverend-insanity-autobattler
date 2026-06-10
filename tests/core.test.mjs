// Core regression: encounter generation, battle resolution, crafting gates, gacha.
import { ok, section } from './assert.mjs';
import { state, newGame } from '../src/state.js';
import { resolveEncounter } from '../src/systems/battle.js';
import { generateEncounter, isBossFloor } from '../src/data/floors.js';
import { canCraft, craft } from '../src/systems/crafting.js';
import { pull } from '../src/systems/gacha.js';
import { RESOURCES } from '../src/data/resources.js';

section('core: battle & floors');
state.current = newGame('test'); const S = state.current;
ok(resolveEncounter(generateEncounter(1)).win, 'floor 1 is winnable from a fresh start');
ok(isBossFloor(10) && !isBossFloor(11), 'boss floors are every 10th');
ok(generateEncounter(10).isBoss, 'floor 10 generates a boss');
const enc = generateEncounter(1);
ok(enc.waves.length >= 1 && enc.waves[0].length >= 1, 'encounter has at least one wave with one enemy');

section('core: crafting gates');
S.stones = 9e9; S.essence = 9e9;
// grant every material (universal + the path-bound signature resources recipes now require)
S.resources = Object.fromEntries(Object.keys(RESOURCES).map((id) => [id, 999]));
ok(canCraft('gu_strength_atk_t1').ok, 'common Gu craftable at floor 1 (with its path materials)');
ok(!canCraft('gu_killing_crit_t1').ok, 'esoteric Gu gated behind deeper floors at floor 1');
S.frontier = 210;   // esoteric paths unlock at floor 201
ok(canCraft('gu_killing_crit_t1').ok, 'esoteric Gu craftable once the floor gate is met');

section('core: immortal Gu uncraftable & gacha');
// Immortal Gu (tier 6+, the unique artifacts) are NOT craftable for now — even with every material,
// fodder and floor gate satisfied. gu_time_evasion_imm is a T6 Time "Fate" immortal Gu.
S.guInv.push({ uid: 'tf1', guId: 'gu_time_evasion_t5' }, { uid: 'tf2', guId: 'gu_time_evasion_t5' });
ok(!canCraft('gu_time_evasion_imm').ok, 'immortal Gu (tier 6+) cannot be crafted for now');
ok(!craft('gu_time_evasion_imm').ok, 'crafting an immortal Gu is refused');
S.essence = 9e9;
const pr = pull(10);
ok(pr.ok && pr.got.length === 10, '10-pull returns ten recruits');

section('core: tag-coverage refinement');
// (stones, resources and frontier from the crafting-gates section are still generous.)
// Single-tag: a T2 ATK Gu needs TWO atk-carrying T1 same-path fodder — one matching + one off-tag fails.
S.guInv = [{ uid: 'a1', guId: 'gu_strength_atk_t1' }, { uid: 'a2', guId: 'gu_strength_def_t1' }];
ok(!canCraft('gu_strength_atk_t2').ok, 'single-tag Gu NOT craftable with only one matching-tag fodder');
S.guInv = [{ uid: 'a1', guId: 'gu_strength_atk_t1' }, { uid: 'a2', guId: 'gu_strength_atk_t1' }];
ok(canCraft('gu_strength_atk_t2').ok, 'single-tag Gu craftable with two matching-tag fodder');
// Multi-tag: a signature Gu (gu_strength_sig_dbl, T3 [ATK, Max HP]) needs fodder covering BOTH tags.
S.guInv = [{ uid: 'm1', guId: 'gu_strength_atk_t2' }, { uid: 'm2', guId: 'gu_strength_def_t2' }];
ok(!canCraft('gu_strength_sig_dbl').ok, 'multi-tag Gu NOT craftable when a tag is left uncovered');
S.guInv = [{ uid: 'm1', guId: 'gu_strength_atk_t2' }, { uid: 'm2', guId: 'gu_strength_hp_t2' }];
ok(canCraft('gu_strength_sig_dbl').ok, 'multi-tag Gu craftable when fodder covers every tag');
