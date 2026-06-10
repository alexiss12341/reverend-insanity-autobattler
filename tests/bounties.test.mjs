// BOUNTIES — daily-rotating lone RAID-BOSS hunts (data/bounties.js + the floors.js raid-boss knobs).
// Verifies (1) slot identity (rank/rarity/gating), (2) the BUILD is good — a coherent same-path kit with
// an offense/mystic core + self-sustain + a fitting killer (rank 3+) + raid-boss bulk — and (3) the fight
// is a real, winnable raid against an on-level mirror team (not a pushover, not a stalemate).
import { ok, section } from './assert.mjs';
import { state, newGame, makeCharacter, normalizeFormation } from '../src/state.js';
import { guList } from '../src/data/gu.js';
import { guSlotsOf } from '../src/data/realms.js';
import { commOf } from '../src/data/daoPaths.js';
import { playerPool, roleAttrs, ATTR_KEYS } from '../src/data/attributes.js';
import { resolveEncounter } from '../src/systems/battle.js';
import { buildBounty, buildBountyEncounter, slotRank, slotRarity, slotUnlockFloor, bountyPath, bountyEssence, BOUNTY_SLOTS } from '../src/data/bounties.js';

const REPORT = process.env.BOUNTY_REPORT === '1';
const DAY = '2026-06-10';

// ---- representative on-level MIRROR team -----------------------------------------------------------
let guUid = 0;
const peakRealmOfRank = (rank) => (rank <= 5 ? (rank - 1) * 4 + 3 : 20 + (rank - 6)); // band Peak

// distinct same-path single-effect Gu (tier ≤ rank), offense-first, to fill `n` slots
function loadoutFor(path, rank, n) {
  const pool = guList().filter((g) => g.daoPath === path && !g.unique && g.tier <= Math.max(1, rank) && (g.effects || []).length === 1);
  const byKind = (k) => pool.filter((g) => g.effects[0].kind === k).sort((a, b) => b.tier - a.tier);
  const picks = [];
  for (const k of ['atk', 'crit', 'lifesteal', 'hp', 'def', 'armorPen', 'spd']) { const g = byKind(k)[0]; if (g && !picks.includes(g)) picks.push(g); }
  for (const g of pool) { if (picks.length >= n) break; if (!picks.includes(g)) picks.push(g); }
  return picks.slice(0, n);
}
function equip(ch, gus) {
  ch.gu = gus.map((g) => { const uid = 'tg_' + (guUid++); state.current.guInv.push({ uid, guId: g.id }); return uid; });
}
// Build a fresh on-level 6-team at `rank`/`rarity` on a strong offense path, fully allocated + kitted.
function buildTeam(rank, rarity, n = 6) {
  const S = state.current;
  S.roster = [];
  S.clearedFloors[100] = true;                 // unlock ally killer moves
  const realm = peakRealmOfRank(rank);
  const roles = ['tank', 'bruiser', 'striker', 'bruiser', 'striker', 'skirmisher'];
  const path = 'metal';                        // common offense path (available at any rank), good resonance
  for (let p = 0; p < n; p++) {
    const ch = makeCharacter(`Ally ${p + 1}`, rarity, false);
    ch.realm = realm;
    const role = roles[p % roles.length];
    const w = roleAttrs(role, playerPool(ch));
    ch.attrs = {}; for (const k of ATTR_KEYS) ch.attrs[k] = Math.round(w[k] || 0);
    ch.active = true;
    equip(ch, loadoutFor(path, rank, guSlotsOf(ch)));
    if (rank >= 3 && ch.gu.length >= 3) ch.killer = { core: ch.gu[0], support: ch.gu.slice(1, 3), archetype: 'bloodrush' };
    S.roster.push(ch);
  }
  normalizeFormation();
  return S.roster;
}

// ---- slot identity ---------------------------------------------------------------------------------
section('bounties: slot identity (rank / rarity / gating)');
ok(BOUNTY_SLOTS === 5, 'five bounty slots');
const RAR = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
let idOK = true;
for (let i = 0; i < 5; i++) idOK = idOK && slotRank(i) === i + 1 && slotRarity(i) === RAR[i];
ok(idOK, 'slot i → rank i+1, rarity Common…Legendary');
ok(slotUnlockFloor(0) === 1 && slotUnlockFloor(1) === 51 && slotUnlockFloor(2) === 101 && slotUnlockFloor(3) === 151 && slotUnlockFloor(4) === 201,
  'gating: R1 from start; R2/R3/R4/R5 at frontier 51/101/151/201');
ok([10, 20, 30, 40, 50].every((e, i) => bountyEssence(i) === e), '✦ reward ladder = 10·rank (10…50)');

// ---- daily rotation determinism + eligibility ------------------------------------------------------
section('bounties: daily path rotation (deterministic + floor-eligible)');
ok(bountyPath(2, DAY) === bountyPath(2, DAY), 'same day + slot → same path (deterministic)');
const seen = new Set(); for (let d = 1; d <= 60; d++) seen.add(bountyPath(4, `2026-06-${String(d).padStart(2, '0')}`));
ok(seen.size > 1, 'a slot rolls different paths across days');
let r1common = true, r5deep = false;
for (let d = 1; d <= 90; d++) {
  const k = `2026-07-${String(d).padStart(2, '0')}`;
  if (commOf(bountyPath(0, k)).floorReq > 50) r1common = false;
  if (commOf(bountyPath(4, k)).floorReq >= 201) r5deep = true;
}
ok(r1common, 'R1 slot only ever rolls a common-path target');
ok(r5deep, 'R5 slot can roll a deep (esoteric) path');

// ---- the BUILD is good -----------------------------------------------------------------------------
section('bounties: lone target is a well-formed raid boss');
const guByName = {}; for (const g of guList()) guByName[g.name] = g;
for (let i = 0; i < 5; i++) {
  const b = buildBounty(i, DAY);
  const u = b.unit;
  ok(u.daoPath === b.path, `slot ${i}: target daoPath === rolled path (${b.path})`);
  ok(u.rarity === slotRarity(i), `slot ${i}: rarity is ${slotRarity(i)}`);
  ok(u.gu && u.gu.length >= 1, `slot ${i}: has a Gu loadout`);
  // self-sustain: a lifesteal/regen Gu in the kit OR the boss's baked lifesteal/regen effect
  const loadoutSustain = (u.gu || []).map((n) => guByName[n]).filter(Boolean)
    .some((g) => (g.effects || []).some((e) => (e.kind === 'lifesteal' || e.kind === 'regen') && e.value > 0));
  const fxSustain = (u.effects.lifesteal || 0) > 0 || (u.effects.regen || 0) > 0;
  ok(loadoutSustain || fxSustain, `slot ${i}: has self-sustain (lifesteal/regen Gu or baked effect)`);
  if (slotRank(i) >= 3) ok(u.killer && u.killer.ops && u.comboCost > 0, `slot ${i}: rank ${slotRank(i)} has a killer move`);
  else ok(!u.killer, `slot ${i}: rank ${slotRank(i)} has no killer (below KILLER_MIN_RANK)`);
  ok(u.maxHp > 0, `slot ${i}: positive HP (${u.maxHp})`);
  ok(b.rewards.stones > 0 && b.rewards.essence === bountyEssence(i) && Object.keys(b.rewards.drops).length >= 1,
    `slot ${i}: rewards = stones + ${bountyEssence(i)}✦ + path resources`);
}

// ---- the FIGHT is a real, winnable raid ------------------------------------------------------------
section('bounties: balanced vs an on-level mirror team (winnable, not a stalemate)');
state.current = newGame('tbounty');
const TRIALS = 100;   // enough samples that the ≤60% cap check isn't flaky on RNG variance
for (let i = 0; i < 5; i++) {
  const rank = slotRank(i), rarity = slotRarity(i);
  buildTeam(rank, rarity);
  let wins = 0, totActions = 0, capped = 0, alliesLostTot = 0;
  for (let t = 0; t < TRIALS; t++) {
    const enc = buildBountyEncounter(i, `sim-${i}-${t}`);   // vary path/day across trials
    const res = resolveEncounter(enc);
    if (res.win) wins++;
    totActions += res.rounds;
    if (res.rounds >= 3000) capped++;
    alliesLostTot += res.allies.filter((a) => a.hp <= 0).length;
  }
  const wr = wins / TRIALS, avgAct = Math.round(totActions / TRIALS), avgLost = alliesLostTot / TRIALS;
  if (REPORT) console.log(`  R${rank} ${rarity}: winrate ${(wr * 100).toFixed(0)}% · avg ${avgAct} actions · avg allies lost ${avgLost.toFixed(1)} · capped ${capped}/${TRIALS}`);
  ok(capped === 0, `slot ${i}: fights resolve (no 3000-action stalemate)`);
  ok(wr >= 0.2, `slot ${i}: the raid is winnable by an on-level team (winrate ${(wr * 100).toFixed(0)}%)`);
  ok(wr <= 0.60, `slot ${i}: AT MOST 60% team win on a rank/rarity-matched team (winrate ${(wr * 100).toFixed(0)}%)`);
  ok(avgLost > 0.5, `slot ${i}: the boss is a real threat (costs casualties — avg ${avgLost.toFixed(1)} lost)`);
}
