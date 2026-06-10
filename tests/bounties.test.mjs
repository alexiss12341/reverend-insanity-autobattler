// BOUNTIES — daily-rotating lone RAID-BOSS hunts (data/bounties.js + the floors.js raid-boss knobs).
// Verifies (1) slot identity (rank/rarity/gating), (2) the BUILD is good — a coherent same-path kit with
// an offense/mystic core + self-sustain + a fitting killer (rank 3+) + raid-boss bulk — and (3) the fight
// is a real, winnable raid against an on-level mirror team (not a pushover, not a stalemate).
import { ok, section } from './assert.mjs';
import { state, newGame, makeCharacter, normalizeFormation } from '../src/state.js';
import { guList, GU_LIB } from '../src/data/gu.js';
import { guSlotsOf } from '../src/data/realms.js';
import { commOf } from '../src/data/daoPaths.js';
import { playerPool, roleAttrs, ATTR_KEYS } from '../src/data/attributes.js';
import { resolveEncounter } from '../src/systems/battle.js';
import { buildBounty, buildBountyEncounter, slotRank, slotRarity, slotUnlockFloor, bountyPath, bountyEssence, bountyGuChances, rollBountyGu, BOUNTY_SLOTS } from '../src/data/bounties.js';
import { attemptsLeft, spendAttempt, refillAttempts, msToNextAttempt, slotUnlocked, grantBountyRewards, BOUNTY_MAX_ATTEMPTS, BOUNTY_REFILL_MS } from '../src/systems/bounties.js';

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
    ch.comprehension = { [path]: 1e7 };          // DEVELOPED: comprehension at the rank cap → Gu run at full power
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
// Reaver (too strong on a lone sustain boss) and Assassin (replaced by the debuff Afflictor) are locked
// out of the bounty mode — never assigned. Afflictor ("Plaguebringer") IS fielded.
let noBlocked = true, sawAfflictor = false;
for (let d = 1; d <= 28; d++) for (let i = 0; i < 5; i++) {
  const ln = buildBounty(i, `2026-08-${String(d).padStart(2, '0')}`).line;
  if (ln === 'reaver' || ln === 'assassin') noBlocked = false;
  if (ln === 'afflictor') sawAfflictor = true;
}
ok(noBlocked, 'Reaver and Assassin are never assigned to a bounty boss (locked out)');
ok(sawAfflictor, 'Afflictor (Plaguebringer) debuff archetype IS fielded');

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
  // archetype: every boss wears a combat LINE (its stat bonuses) AND arms a line-coherent killer move
  ok(u.line && b.line === u.line, `slot ${i}: has an archetype line (${u.line})`);
  ok(u.killer && u.killer.ops && u.comboCost > 0, `slot ${i}: arms a killer move (${u.killer && u.killer.name})`);
  ok(u.maxHp > 0, `slot ${i}: positive HP (${u.maxHp})`);
  ok(b.rewards.stones > 0 && b.rewards.essence === bountyEssence(i)
    && b.rewards.guReward && b.rewards.guReward.path === b.path
    && Math.abs((b.rewards.guReward.chances[b.rank] || 0) - 0.30) < 1e-9,
    `slot ${i}: rewards = stones + ${bountyEssence(i)}✦ + a 30% path-Gu chance`);
}

// ---- the FIGHT is a real, winnable raid vs a FULLY-OPTIMIZED matched team --------------------------
// The reference is the strongest team a player can field at the band: comprehension at the rank cap (Gu
// at full power — a comp-0 team's Gu run at only 10–25%), every slot a cap-tier same-path Gu (full
// resonance), and killer moves. Bosses are tuned so even THAT team wins ≤60% (≈40–50%).
section('bounties: a real raid vs a fully-optimized matched team (winnable, ≤60%, no stalemate)');
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
  ok(wr >= 0.12, `slot ${i}: still winnable by a fully-optimized team (winrate ${(wr * 100).toFixed(0)}%)`);
  ok(wr <= 0.60, `slot ${i}: AT MOST 60% team win for a fully-optimized matched team (winrate ${(wr * 100).toFixed(0)}%)`);
  ok(avgLost > 0.5, `slot ${i}: the boss is a real threat (costs casualties — avg ${avgLost.toFixed(1)} lost)`);
}

// ---- attempts economy + gating + rewards (systems/bounties.js) -------------------------------------
section('bounties: attempts pool (5 max, +1/hour, offline-aware) + gating + rewards');
state.current = newGame('tbounty2');
ok(attemptsLeft() === BOUNTY_MAX_ATTEMPTS, 'a fresh save starts with a full 5 attempts');
ok(spendAttempt() && attemptsLeft() === 4, 'spending one attempt leaves 4');
for (let k = 0; k < 4; k++) spendAttempt();
ok(attemptsLeft() === 0 && spendAttempt() === false, 'attempts deplete to 0; can\'t spend below 0');
// rewind lastRefill 2.5h → 2 attempts recharge (offline-aware, partial remainder preserved)
state.current.bounties.lastRefill = Date.now() - Math.round(2.5 * BOUNTY_REFILL_MS);
ok(attemptsLeft() === 2, 'two attempts recharge after 2.5h away (offline-aware)');
ok(msToNextAttempt() > 0 && msToNextAttempt() <= BOUNTY_REFILL_MS, 'next-attempt countdown is within one refill period');
// progression gating mirrors the band starts
state.current.frontier = 1;
ok(slotUnlocked(0) && !slotUnlocked(1) && !slotUnlocked(4), 'frontier 1 → only R1 bounty open');
state.current.frontier = 151;
ok(slotUnlocked(0) && slotUnlocked(2) && slotUnlocked(3) && !slotUnlocked(4), 'frontier 151 → R1-R4 open, R5 still locked');
// reward granting adds stones + essence + the path resources
const before = { st: state.current.stones, es: state.current.essence, gu: state.current.guInv.length };
const rw = buildBounty(2, DAY).rewards;                 // slot 2 = rank 3 → the Gu roll always hits (sums to 100%)
const got = grantBountyRewards(rw);
ok(state.current.stones === before.st + rw.stones, 'granting a bounty adds its primeval stones');
ok(state.current.essence === before.es + rw.essence, 'granting a bounty adds its Immortal Essence');
ok(got.gu && state.current.guInv.length === before.gu + 1, 'a rank-3 bounty grants a path Gu into the inventory');
ok(GU_LIB[state.current.guInv[state.current.guInv.length - 1].guId].daoPath === rw.guReward.path, 'the granted Gu is of the bounty boss\'s Dao path');

// ---- Gu-reward chance ladder + roll --------------------------------------------------------------
section('bounties: Gu-reward chance ladder (30% own rank, 70% split across lower ranks)');
ok(Object.keys(bountyGuChances(1)).length === 1 && Math.abs(bountyGuChances(1)[1] - 0.30) < 1e-9, 'R1: 30% rank-1 (70% miss — no lower rank)');
{ const c = bountyGuChances(2); ok(Math.abs(c[2] - 0.30) < 1e-9 && Math.abs(c[1] - 0.70) < 1e-9, 'R2: 30% R2 · 70% R1'); }
{ const c = bountyGuChances(3); ok(Math.abs(c[3] - 0.30) < 1e-9 && Math.abs(c[2] - 0.35) < 1e-9 && Math.abs(c[1] - 0.35) < 1e-9, 'R3: 30% R3 · 35% R2 · 35% R1'); }
{ const c = bountyGuChances(5); const sum = Object.values(c).reduce((a, b) => a + b, 0); ok(Math.abs(c[5] - 0.30) < 1e-9 && Math.abs(c[4] - 0.175) < 1e-9 && Math.abs(sum - 1) < 1e-9, 'R5: 30% R5 + 17.5% each lower (sums to 100%)'); }
{ let hits = 0, clean = true; for (let t = 0; t < 200; t++) { const id = rollBountyGu('fire', 5); if (id) { hits++; const g = GU_LIB[id]; if (g.daoPath !== 'fire' || g.tier < 1 || g.tier > 5 || g.unique) clean = false; } }
  ok(hits === 200 && clean, 'R5 roll always yields a non-unique fire Gu of tier 1-5'); }
{ let miss = 0; for (let t = 0; t < 400; t++) if (rollBountyGu('fire', 1) === null) miss++; ok(miss > 0 && miss < 400, 'R1 roll both hits (~30%) and misses (~70%)'); }
