// Main orchestrator: boots the title screen, runs the idle loop, executes floor
// encounters, distributes rewards, and exposes the global `G` event API used by the UI.
import { state, S, newGame, load, save, deleteSave, listSaves, SLOT_KEYS, activeTeam, rowOf, laneOf, tileOccupant, rowCount, ROW_CAP, firstFreeTile, normalizeFormation } from './state.js';
import { effectiveStats } from './systems/cultivation.js';
import { resolveEncounter, fightWallMs } from './systems/battle.js';
import { attemptBreakthrough, respecAttributes, respecCost, RESPEC_ESSENCE_COST } from './systems/cultivation.js';
import { rollFloorRewards, firstClearEssence, rollFarmEssence, applyDrops, buyResource, rollImmortalStones, immortalGuUpkeep, addImmortalStones } from './systems/economy.js';
import { pull, dismiss, dismissMany, dismissRefund, imprint, imprintCandidates, IMPRINT_CAP, autoImprintAll, duplicateSpares } from './systems/gacha.js';
import { buyBoon, reincarnate, soulsAward, canReincarnate } from './systems/prestige.js';
import { bumpQuest, claimQuest, claimBonus, DAILY_QUESTS } from './systems/quests.js';
import { attemptsLeft, spendAttempt, slotUnlocked, bountyEncounter, grantBountyRewards } from './systems/bounties.js';
import { craft, upgrade } from './systems/crafting.js';
import { generateEncounter, isBossFloor, MAX_FLOORS } from './data/floors.js';
import { guOf } from './systems/cultivation.js';
import { GU_LIB, effectText, guEssenceCost, isUnique } from './data/gu.js';
import { pathName } from './data/daoPaths.js';
import { autoConfigure, guInDomain, archetypeDomain, ARCHETYPES, KILLER_ARCH_COST } from './data/combos.js';
import { resourceName, RESOURCES } from './data/resources.js';
import { isImmortalRealm, realmName } from './data/realms.js';
import { rarityTier } from './data/rarities.js';
import { accrue, ascend, resolveTribulation, becomeVenerable } from './systems/tribulation.js';
import { addMarks, addComprehension } from './systems/dao.js';
import { affinityCompMult } from './data/traits.js';
import { ATTR_KEYS, unspentPoints, playerPool, spentPoints } from './data/attributes.js';
import * as Audio from './systems/audio.js';
import * as UI from './ui.js';

let activeTab = 'battle';
let battleBusy = false;        // a fight run (animated or timed) is in flight
let idleTimer = null;          // pending next-run handle
let abortBattle = false;       // set when a new attempt/auto-challenge should interrupt the in-flight fight
let challengeRequested = false; // a manual "Attempt Floor" (frontier) is queued for the next run
let autoChallenge = false;      // auto-challenge mode: keep assaulting the frontier until a defeat
let autoChallengeHighest = 0;   // best floor cleared during the current auto-challenge run
let pendingBounty = null;       // a queued bounty-hunt slot — runs as its own animated arena fight (no auto-resolve)
let pendingNew = null;          // in-progress new game: { slot, name, path, guId } across the name→path→Gu→archetype modals
let pendingReincarnate = null;  // in-progress reincarnation: { name, path, line } across the name→affinity→archetype modals

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Like sleep, but bails out early (within ~120ms) if abortBattle is raised — so an off-screen, timed
// background run can also be interrupted by a new attempt / auto-challenge.
async function sleepAbortable(ms) {
  let waited = 0;
  while (waited < ms && !abortBattle) { const chunk = Math.min(120, ms - waited); await sleep(chunk); waited += chunk; }
}

// ---------- rewards / clearing ----------
function distributeRewards(floor, isBoss, fromLog) {
  const { stones, drops } = rollFloorRewards(floor, isBoss);
  S().stones += stones;
  applyDrops(drops);
  const essence = firstClearEssence(floor, isBoss) + rollFarmEssence(floor, isBoss);
  if (essence) S().essence += essence;
  // Immortal Essence Stones (仙石): renewable faucet (only flows once the roster is immortal) minus this
  // clear's immortal-Gu upkeep. `immStones` (gross granted) drives the feed line; the pool floors at 0.
  const immStones = rollImmortalStones(floor, isBoss);
  if (immStones) addImmortalStones(immStones);
  const immUpkeep = immortalGuUpkeep();
  if (immUpkeep) addImmortalStones(-immUpkeep);
  // Combat no longer grants cultivation XP — mortals advance by spending 石 (see G.attemptBreakthrough).
  // advance frontier if we just cleared the frontier floor
  let advanced = false;
  if (floor === S().frontier && S().frontier < MAX_FLOORS) { S().frontier += 1; advanced = true; }
  return { stones, drops, essence, immStones, advanced };
}

function dropSummary(drops) {
  const ids = Object.keys(drops);
  if (!ids.length) return '';
  return ' · ' + ids.map((id) => `${drops[id]}× ${resourceName(id)}`).join(', ');
}

// On each cleared encounter: immortals accrue aperture-years toward tribulations. Dao Marks now
// come from tribulations (not per-fight drips); tribulations are player-initiated (Dao tab).
function processImmortals(won) {
  for (const c of activeTeam()) {
    if (!isImmortalRealm(c.realm)) continue;
    accrue(c, won ? 6 : 2);
  }
}

// Comprehension is earned per combat action: each action a fighter took (returned by the battle
// engine) trains every path they have a Gu equipped in, scaled by how many of that path's Gu they
// wield. Battle stays a pure consumer; the points are banked here after the encounter.
function commitComprehension(allies) {
  for (const a of allies || []) {
    if (!a.ch || !a.actions) continue;
    const byPath = {};
    for (const uid of a.ch.gu) { const gu = guOf(uid); if (gu) byPath[gu.daoPath] = (byPath[gu.daoPath] || 0) + 1; }
    // Dao Path Affinity trait accelerates comprehension XP in the affined path (×1.25).
    for (const p in byPath) addComprehension(a.ch, p, a.actions * byPath[p] * affinityCompMult(a.ch, p));
  }
}

// ---------- battle loop (idle farming + manual challenges share ONE animated loop) ----------
// When idle is on, this loops the chosen FARM floor with the active team; "Attempt Floor" queues a
// one-off run at the FRONTIER (challengeRequested). Every run resolves a REAL fight with the current
// team — on the battle tab it ANIMATES (charge bars, clashes, popups); off-tab it just waits the
// fight's real duration so background progress keeps pace. Rewards are identical either way
// (distributeRewards advances the frontier when the cleared floor IS the frontier).
// End the current auto-challenge climb. `reason`: 'lost' (a defeat — drop passive farm to the best
// floor cleared this run), 'capped' (cleared the final floor), or 'stopped' (manual stop). Safe to
// call repeatedly; only the first call (while the mode is on) takes effect.
function endAutoChallenge(reason) {
  if (!autoChallenge) return;
  autoChallenge = false;
  UI.setAutoChallenge(false);
  let msg, cls = 'rare';
  if (reason === 'lost') {
    if (autoChallengeHighest > 0) {
      S().farmFloor = Math.max(1, Math.min(Math.max(1, S().frontier - 1), autoChallengeHighest));
      msg = `Auto-Challenge ended — defeated. Passive farm set to your best clear: Floor ${S().farmFloor}.`;
    } else {
      msg = 'Auto-Challenge ended — defeated on the first floor; passive farm unchanged.';
    }
    cls = 'lose';
  } else if (reason === 'capped') {
    msg = 'Auto-Challenge complete — the tower has no higher floor!'; cls = 'win';
  } else {
    msg = 'Auto-Challenge stopped.';
  }
  autoChallengeHighest = 0;
  if (activeTab === 'battle') UI.logLine(msg, cls);
  UI.toast(msg);
}

async function runBattle() {
  idleTimer = null;
  if (!S() || battleBusy) return;
  const auto = autoChallenge;                                     // this run is a rung of an auto-challenge
  const manual = challengeRequested;                              // a one-shot "Attempt Floor"
  const bountySlot = pendingBounty;                               // a one-shot bounty hunt (slot index, or null)
  const isBounty = bountySlot != null;
  const challenging = manual || auto;                             // frontier assault (a bounty is its own mode)
  if (!isBounty && !challenging && !S().settings.idle) return;    // idle off and nothing queued → stop
  if (!activeTeam().length) {                                     // no fighters
    challengeRequested = false; pendingBounty = null;
    if (auto) endAutoChallenge('stopped');
    if (S().settings.idle) idleTimer = setTimeout(runBattle, 1000);
    return;
  }
  battleBusy = true;
  challengeRequested = false;
  pendingBounty = null;                                           // consume the queued hunt
  const floor = challenging ? S().frontier : S().farmFloor;       // (unused for a bounty)
  const enc = isBounty ? bountyEncounter(bountySlot) : generateEncounter(floor);
  const bounty = isBounty ? enc.bounty : null;
  const dispFloor = isBounty ? bounty.floor : floor;              // floor label for the arena header / audio
  const animate = activeTab === 'battle';                         // only the visible screen animates
  if (animate) Audio.scene(challenging || isBounty, enc.isBoss); // ramp the music for an assault / hunt
  // record a timeline whenever we animate; a single manual attempt + every bounty hunt get the verbose feed.
  const verbose = animate && ((manual && !auto) || isBounty);
  const log = [];
  const res = resolveEncounter(enc, verbose ? (m) => log.push(m) : undefined, animate ? { record: true } : undefined);

  if (animate) {
    if (isBounty) {
      if (verbose) UI.clearLog();
      UI.logLine(`— Hunting ${bounty.name} · ${bounty.rarity} Rank ${bounty.rank} ${bounty.path} —`, 'rare');
    } else if (challenging) {
      if (verbose) UI.clearLog();                                 // a lone manual attempt starts a fresh feed
      UI.logLine(`— Assaulting Floor ${floor}${enc.isBoss ? ' BOSS' : ''} (${enc.waves.length} wave${enc.waves.length > 1 ? 's' : ''}) —`, auto ? '' : 'rare');
    }
    await UI.playTimeline(res.timeline, { floor: dispFloor, isBoss: enc.isBoss });    // animated arena: charge bars, clashes, damage popups
    if (verbose && !abortBattle) log.forEach((m) => UI.logLine(m)); // dump the full feed after a single manual attempt / hunt
  } else {
    await sleepAbortable(fightWallMs(res.simTime));   // background: pace by the fight's real duration (interruptible)
  }
  if (!S()) { battleBusy = false; return; } // game reset mid-fight
  // A new attempt/hunt interrupted this fight: discard its result (no rewards, no attempt spent, no
  // comprehension) and immediately launch the requested challenge instead.
  if (abortBattle) {
    abortBattle = false;
    battleBusy = false;
    if (!isHidden() && (autoChallenge || challengeRequested || pendingBounty != null || S().settings.idle)) idleTimer = setTimeout(runBattle, 0);
    return;
  }
  commitComprehension(res.allies);

  S().stats.battles += 1;
  if (animate && (challenging || isBounty)) (res.win ? Audio.victory : Audio.defeat)(); // a deliberate fight gets a win/loss sting

  if (isBounty) {                                                 // BOUNTY HUNT: spend an attempt, grant bounty rewards (no floor/frontier logic)
    spendAttempt();                                               // the hunt resolved → consume one attempt (win or lose)
    processImmortals(res.win);
    if (res.win) {
      S().stats.wins += 1;
      const got = grantBountyRewards(bounty.rewards);             // rolls the path-Gu chance + grants stones/essence
      bumpQuest('wins');
      const guMsg = got && got.gu ? `, + ${got.gu.name}` : '';
      if (activeTab === 'battle') UI.logLine(`★ BOUNTY CLAIMED — ${bounty.name} slain! +${bounty.rewards.stones}石, +${bounty.rewards.essence}✦${guMsg}`, 'win');
    } else if (activeTab === 'battle') {
      UI.logLine(`${bounty.name} bested your team. Attempt spent — ${attemptsLeft()} left.`, 'lose');
    }
  } else if (res.win) {
    S().stats.wins += 1;
    const firstTime = !S().clearedFloors[floor];
    const r = distributeRewards(floor, enc.isBoss);
    if (firstTime) S().stats.floorsCleared += 1;
    bumpQuest('wins');                          // daily quest: live battle wins (offline catch-up doesn't count)
    processImmortals(true);
    if (activeTab === 'battle') {
      UI.logLine(challenging
        ? `★ FLOOR ${floor} CLEARED! +${r.stones}石${r.essence ? `, +${r.essence}✦ Immortal Essence` : ''}${r.immStones ? `, +${r.immStones} 仙石` : ''}${dropSummary(r.drops)}`
        : `Cleared F${floor} (+${r.stones}石${r.essence ? `, +${r.essence}✦` : ''}${r.immStones ? `, +${r.immStones} 仙石` : ''})${dropSummary(r.drops)}`, challenging ? 'win' : 'loot');
      if (r.advanced) UI.logLine(`Floor ${S().frontier} is now open.`, 'win');
    }
    if (auto) {                                                  // THIS run was an auto-challenge rung
      autoChallengeHighest = Math.max(autoChallengeHighest, floor);
      if (!r.advanced) endAutoChallenge('capped');               // nowhere higher to climb
    }
  } else {
    if (activeTab === 'battle') UI.logLine(challenging
      ? `Defeated on Floor ${floor}. Farm below, grow stronger, return.`
      : `Wiped on F${floor} — farm a lower floor.`, 'lose');
    if (auto) endAutoChallenge('lost');                          // a defeat ends the climb
  }

  battleBusy = false;
  UI.refreshTop();
  G.claimOnboardingReward();   // finishing the tutorial via idle farming (e.g. the "win a battle" step) pays out now
  // keep the control bar live: a clear that advances the frontier (or the climb ending) must
  // immediately update the buttons/labels without waiting for a re-render.
  if (activeTab === 'battle') UI.renderBattleControls();
  save();
  // Don't reschedule while the browser tab is hidden — its timers are throttled/frozen, so a live loop
  // there just crawls. We pause instead and credit an offline-style estimate when the tab returns (see
  // the visibilitychange handler). The in-flight run that's settling now is the last one until we're back.
  if (!isHidden() && (autoChallenge || S().settings.idle || challengeRequested || pendingBounty != null)) idleTimer = setTimeout(runBattle, animate ? 350 : 0); // loop
  else if (activeTab === 'battle') { Audio.scene(false); UI.render('battle'); } // settled on the battle tab: drop the music back to the calm arena mood + refresh
}

// "Attempt Floor": launch a one-off frontier run NOW — interrupting whatever fight is animating.
function attemptAdvance() {
  if (autoChallenge) return;       // already climbing
  if (!activeTeam().length) return UI.toast('Activate at least one fighter.');
  challengeRequested = true;
  if (battleBusy) { abortBattle = true; UI.abortTimeline(); return; } // cut the in-flight fight short; it restarts as the attempt
  stopIdle();                      // cancel the pending idle tick and start the challenge immediately
  runBattle();
}

// "Auto-Challenge": climb the tower from the current frontier, floor after floor, until a defeat —
// then drop the passive farm floor to the best clear of the run. Toggle off to stop early.
function toggleAutoChallenge() {
  if (autoChallenge) { endAutoChallenge('stopped'); if (activeTab === 'battle') UI.renderBattleControls(); if (!battleBusy) startIdle(); return; }
  if (!activeTeam().length) return UI.toast('Activate at least one fighter.');
  autoChallenge = true; autoChallengeHighest = 0;
  UI.setAutoChallenge(true);
  if (activeTab === 'battle') { UI.clearLog(); UI.logLine(`— Auto-Challenge: climbing from Floor ${S().frontier} —`, 'rare'); UI.renderBattleControls(); }
  if (battleBusy) { abortBattle = true; UI.abortTimeline(); return; } // cut the in-flight fight short; the climb starts now
  stopIdle();
  runBattle();
}

// ---------- offline progress ----------
// Estimate idle-farm gains over an away window by actually SIMULATING fights on the farm floor and
// rolling the SAME rewards a live clear makes — stones, resource DROPS, and the farm-essence trickle —
// then totalling them. We sim fight-by-fight (each its own win/loss + reward roll) within a wall-clock
// budget; if the window affords more clears than we can sim in that budget, we sim a representative
// batch and SCALE the totals to the full window so a multi-hour absence can't freeze the tab on return.
// elapsedMs: explicit idle window to credit. Omitted (load path) → derive from the last save; passed
// (background-tab catch-up) → the time the browser tab spent hidden, since the autosave heartbeat keeps
// freshening lastSave even while throttled in the background. Returns null if the team can't clear it.
const OFFLINE_SIM_BUDGET_MS = 250; // max wall-clock we'll spend simulating fights on return
const OFFLINE_SIM_CAP = 3000;      // hard ceiling on simulated fights regardless of budget
function applyOffline(elapsedMs) {
  const elapsed = elapsedMs != null ? elapsedMs : Date.now() - (S().lastSave || Date.now());
  const capped = Math.min(elapsed, 8 * 3600 * 1000);
  if (capped < 8000 || !activeTeam().length) return null;
  const floor = S().farmFloor;
  const enc = generateEncounter(floor);
  // Sim runs until we've covered the whole window (by simulated wall-time) OR hit the budget/cap. Each
  // run resolves a real fight and, on a win, rolls real rewards — wins/drops vary fight to fight.
  let simmed = 0, wins = 0, simWallMs = 0, stones = 0, ess = 0;
  const drops = {};
  const budgetEnd = Date.now() + OFFLINE_SIM_BUDGET_MS;
  while (simWallMs < capped && simmed < OFFLINE_SIM_CAP && Date.now() < budgetEnd) {
    const res = resolveEncounter(enc);
    simWallMs += Math.max(700, fightWallMs(res.simTime)); // a live run takes this long, so it consumes window
    simmed++;
    if (res.win) {
      wins++;
      const r = rollFloorRewards(floor, enc.isBoss);
      stones += r.stones;
      for (const id in r.drops) drops[id] = (drops[id] || 0) + r.drops[id];
      ess += rollFarmEssence(floor, enc.isBoss);
    }
  }
  if (!simmed) return null;
  // If the budget/cap stopped us before the window was covered, scale the batch up to the full run count.
  const fullRuns = Math.floor(capped / (simWallMs / simmed));
  const scale = simmed >= fullRuns ? 1 : fullRuns / simmed;
  if (scale > 1) {
    wins = Math.round(wins * scale);
    stones = Math.round(stones * scale);
    ess = Math.round(ess * scale);
    for (const id in drops) drops[id] = Math.round(drops[id] * scale);
  }
  if (wins < 1) return null; // couldn't clear the floor even once → nothing to credit
  S().stones += stones;
  S().essence += ess;
  applyDrops(drops);
  // Immortal Essence Stones (仙石): faucet minus immortal-Gu upkeep, both per win (deterministic, so we
  // apply them as a lump over the estimated clears). The pool floors at 0; `imm` is the net delta shown.
  const immBefore = S().immortalStones || 0;
  S().immortalStones = Math.max(0, immBefore + wins * rollImmortalStones(floor, enc.isBoss) - wins * immortalGuUpkeep());
  const imm = S().immortalStones - immBefore;
  // (no cultivation XP — breakthroughs are now stone purchases made manually, not auto-leveled)
  return { eff: wins, stones, ess, imm, drops, hours: (elapsed / 3600000).toFixed(1) };
}

// ---------- lifecycle ----------
function startIdle() { if (S() && S().settings.idle && !battleBusy && !idleTimer) idleTimer = setTimeout(runBattle, 0); }
function stopIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } } // an in-flight run finishes, then won't reschedule

// ---------- background-tab handling ----------
// Browsers throttle (or fully freeze) setTimeout in hidden tabs, so the setTimeout-driven idle loop
// stalls when the player switches to another browser tab. Instead of letting it crawl, we PAUSE the loop
// while hidden and credit an offline-style estimate for the away time when the tab returns — the same
// model as load-time offline progress, just scoped to the time the tab spent backgrounded.
const isHidden = () => typeof document !== 'undefined' && document.hidden;
let hiddenAt = 0;
function onVisibilityChange() {
  if (!S()) return;
  if (isHidden()) {
    hiddenAt = Date.now();
    save();          // persist before the tab goes quiet
    stopIdle();      // cancel the pending tick; any in-flight run settles and then won't reschedule
    return;
  }
  // Tab is back in the foreground: credit the away window, then resume the live loop.
  const elapsed = hiddenAt ? Date.now() - hiddenAt : 0;
  hiddenAt = 0;
  if (elapsed > 0 && S().settings.idle && !battleBusy && !autoChallenge) {  // only catch up if idle farm is on
    const off = applyOffline(elapsed);
    if (off) {
      // human-friendly away duration — tab switches are usually seconds/minutes, where "0.0h" reads broken
      const secs = elapsed / 1000;
      const away = secs < 60 ? `${Math.round(secs)}s` : secs < 3600 ? `${Math.round(secs / 60)}m` : `${off.hours}h`;
      const dropN = Object.values(off.drops).reduce((a, n) => a + n, 0);
      UI.refreshTop();
      UI.toast(`Idle catch-up over ~${away}: ${off.eff.toLocaleString()} clears · +${off.stones.toLocaleString()}石${off.ess ? `, +${off.ess.toLocaleString()}✦` : ''}${off.imm > 0 ? `, +${off.imm.toLocaleString()} 仙石` : ''}${dropN ? `, +${dropN.toLocaleString()} resources` : ''}`, 4500, 'loot');
      if (activeTab === 'battle') UI.renderBattleControls();
      save();
    }
  }
  if (!battleBusy && (autoChallenge || challengeRequested)) runBattle();  // resume a climb / queued attempt
  else startIdle();                                                       // or just resume passive farming
}

// Legacy saves predate the attribute system: auto-allocate a balanced pool so existing teams keep
// their power (a sensible default — players can later reshape it via Respec for a fee, see
// respecAttributes). New characters carry an explicit zero `attrs` object, so this only fires for
// pre-attribute saves.
function migrateAttributes() {
  for (const c of S().roster) {
    if (!c.attrs) {
      const pool = playerPool(c), each = Math.floor(pool / 5);
      c.attrs = { str: each, agi: each, con: each, int: each, luck: pool - each * 4 };
    }
  }
  if (S().settings.allocStep == null) S().settings.allocStep = 10;
}
function startGame(obj, isNew) {
  state.current = obj;
  autoChallenge = false; autoChallengeHighest = 0; challengeRequested = false; abortBattle = false; UI.setAutoChallenge(false);
  migrateAttributes();
  normalizeFormation(); // give every active fighter a unique board tile (repairs legacy saves)
  document.getElementById('title').classList.add('hidden');
  document.getElementById('game').classList.remove('hidden');
  activeTab = 'battle';
  UI.render('battle');
  if (!isNew) { const off = applyOffline(); if (off) setTimeout(() => showOffline(off), 200); }
  startIdle();
  save();
}
function showOffline(off) {
  const drops = off.drops || {};
  const dropIds = Object.keys(drops);
  const dropsLine = dropIds.length
    ? `• Collected ${dropIds.map((id) => `<b style="color:var(--jade)">${drops[id].toLocaleString()}× ${resourceName(id)}</b>`).join(', ')}<br>`
    : '';
  UI.showModal(`<h3>While you cultivated away…</h3>
    <div class="body">Over ~<b>${off.hours}h</b> your team auto-farmed Floor ${S().farmFloor}:<br>
    • Cleared it <b style="color:var(--jade)">${off.eff.toLocaleString()}</b> times<br>
    • Gathered <b style="color:var(--stone)">${off.stones.toLocaleString()} primeval stones</b> and <b style="color:var(--jade)">${off.ess.toLocaleString()} ✦</b><br>
    ${off.imm > 0 ? `• Drew <b style="color:var(--immstone)">${off.imm.toLocaleString()} 仙石</b> Immortal Essence Stones<br>` : ''}
    ${dropsLine}</div>
    <div class="right"><button class="primary" onclick="G.closeModal()">Continue</button></div>`);
  UI.refreshTop();
}

function renderTitle() {
  const host = document.getElementById('slots'); host.innerHTML = '';
  listSaves().forEach((sv, i) => {
    const div = document.createElement('div'); div.className = 'slot';
    if (sv) {
      div.innerHTML = `<div><div class="nm">Save ${i + 1} — Frontier Floor ${sv.frontier}</div>
        <div class="meta">${sv.roster.length} cultivators · ${Math.floor(sv.stones).toLocaleString()} 石 · ${Math.floor(sv.essence)} ✦${sv.immortalStones > 0 ? ` · ${Math.floor(sv.immortalStones).toLocaleString()} 仙石` : ''} · ${Object.keys(sv.uniqueClaimed || {}).length} unique Gu</div>
        <div class="meta">last played ${new Date(sv.lastSave).toLocaleString()}</div></div>
        <div class="acts"><button class="primary" onclick="G.continueGame(${i})">Continue</button>
        <button class="danger" onclick="G.deleteSlot(${i})">Delete</button></div>`;
    } else {
      div.innerHTML = `<div><div class="nm">Save ${i + 1}</div><div class="meta">empty slot</div></div>
        <div class="acts"><button class="primary" onclick="G.startNew(${i})">New Game</button></div>`;
    }
    host.appendChild(div);
  });
}

function toTitle() {
  stopIdle();
  autoChallenge = false; autoChallengeHighest = 0; challengeRequested = false; abortBattle = false; UI.setAutoChallenge(false);
  save();
  document.getElementById('game').classList.add('hidden');
  document.getElementById('title').classList.remove('hidden');
  renderTitle();
}

// ---------- equip pickers (modals) ----------
// Spare Gu (not equipped on this or any other cultivator) eligible to slot onto `c`.
function guPickerAvail(c) {
  const usedElsewhere = (uid) => S().roster.some((o) => o !== c && o.gu.includes(uid));
  return S().guInv.filter((g) => !c.gu.includes(g.uid) && !usedElsewhere(g.uid));
}
// Live filter state for the equip modal: which char/slot, plus the path filter + name search.
let guPick = null;
// The filtered + sorted spare-Gu rows for the equip picker (repainted live as the user filters/types).
function guPickerListHtml() {
  if (!guPick) return '';
  const c = S().roster.find((x) => x.id === guPick.charId); if (!c) return '';
  const tierOf = (g) => g.tier || GU_LIB[g.guId].tier; // ascended immortals carry an instance tier
  let avail = guPickerAvail(c).map((g) => ({ g, gu: guOf(g.uid) })).filter((x) => x.gu);
  const total = avail.length;
  if (guPick.path !== 'all') avail = avail.filter((x) => x.gu.daoPath === guPick.path);
  const q = (guPick.q || '').trim().toLowerCase();
  if (q) avail = avail.filter((x) => x.gu.name.toLowerCase().includes(q)
    || pathName(x.gu.daoPath).toLowerCase().includes(q) || effectText(x.gu).toLowerCase().includes(q));
  if (!total) return '<div class="muted small">No spare Gu. Craft some in the Refinery.</div>';
  if (!avail.length) return '<div class="muted small">No spare Gu match this filter.</div>';
  const immInertNow = (S().immortalStones || 0) <= 0;
  return avail.sort((a, b) => tierOf(b.g) - tierOf(a.g)).map(({ g, gu }) => {
    const t = gu.tier;
    // Immortal Gu (tier 6+) are inert without Immortal Essence Stones (仙石) — warn before equipping one.
    const immNote = t >= 6 && immInertNow
      ? '<div class="gu-ess" style="color:var(--immstone)">仙石 needs Immortal Essence Stones — inert until you gather some</div>' : '';
    return `<div class="pickrow gu-pick"><div class="gp-info">
        <div class="gp-head"><b style="color:var(--t${t})">T${t}</b> <span class="gp-name">${gu.name}</span>
          ${isUnique(gu) ? '<span class="pill unique">UNIQUE</span>' : ''}<span class="gp-path">${pathName(gu.daoPath)}</span></div>
        <div class="gu-eff">${effectText(gu)}</div>
        <div class="gu-ess">◇ ${guEssenceCost(gu)} essence / use</div>${immNote}</div>
      <button class="primary" onclick="G.equipGu('${guPick.charId}',${guPick.slotIdx},'${g.uid}')">Equip</button></div>`;
  }).join('');
}
function openGuPicker(charId, slotIdx) {
  const c = S().roster.find((x) => x.id === charId); if (!c) return;
  guPick = { charId, slotIdx, path: 'all', q: '' };
  const cur = c.gu[slotIdx] ? guOf(c.gu[slotIdx]) : null;
  const availGu = guPickerAvail(c).map((g) => guOf(g.uid)).filter(Boolean);
  const pathsPresent = [...new Set(availGu.map((gu) => gu.daoPath))].sort((a, b) => pathName(a).localeCompare(pathName(b)));
  const pathOpts = ['all', ...pathsPresent].map((p) => `<option value="${p}">${p === 'all' ? 'All paths' : pathName(p)}</option>`).join('');
  let html = `<h3>Equip Gu — ${c.name} · Slot ${slotIdx + 1}</h3>`;
  if (cur) html += `<div class="pickrow gu-pick"><div class="gp-info">
      <div class="gp-head"><b style="color:var(--t${cur.tier})">T${cur.tier}</b> <span class="gp-name">Equipped: ${cur.name}</span>
        ${isUnique(cur) ? '<span class="pill unique">UNIQUE</span>' : ''}<span class="gp-path">${pathName(cur.daoPath)}</span></div>
      <div class="gu-eff">${effectText(cur)}</div>
      <div class="gu-ess">◇ ${guEssenceCost(cur)} essence / use</div></div>
    <button class="danger" onclick="G.unequipGu('${charId}',${slotIdx})">Unequip</button></div>`;
  html += `<div class="teamctl" style="margin:12px 0 10px">
      <span class="muted small">Path</span><select onchange="G.guPickFilter('path',this.value)">${pathOpts}</select>
      <input class="searchbox" type="text" placeholder="Search Gu…" oninput="G.guPickFilter('q',this.value)">
    </div>
    <div id="gupick-list">${guPickerListHtml()}</div>
    <div class="right"><button onclick="G.closeModal()">Close</button></div>`;
  UI.showModal(html);
}

// ---------- bulk dismiss (multi-select + filters) ----------
let bulkSel = new Set();                                   // ids ticked in the bulk-dismiss modal
let bulkFilter = { rarity: 'all', imprint: 'all', realm: 'all' }; // modal's rarity / imprint / realm filters
// Every benched, non-player cultivator (the dismissable pool) — rarest, then deepest realm, first.
function dismissableAll() {
  return S().roster.filter((c) => !c.isPlayer && !c.active)
    .sort((a, b) => (rarityTier(b.rarity) - rarityTier(a.rarity)) || (b.realm - a.realm) || a.name.localeCompare(b.name));
}
// The pool narrowed by the modal's active filters (what the checklist currently shows).
function dismissableList() {
  const f = bulkFilter;
  return dismissableAll().filter((c) =>
    (f.rarity === 'all' || c.rarity === f.rarity)
    && (f.imprint === 'all' || (c.imprint || 0) === Number(f.imprint))
    && (f.realm === 'all' || c.realm === Number(f.realm)));
}
function renderBulkModal() { UI.showModal(bulkDismissModalHtml(), 'bulk'); }
// Footer (live total + confirm) — counts the WHOLE selection (incl. rows hidden by a filter), repainted
// on each tick so the checklist keeps its scroll/checkboxes.
function bulkDismissFootHtml() {
  let total = 0; bulkSel.forEach((id) => { const c = S().roster.find((x) => x.id === id); if (c) total += dismissRefund(c.rarity); });
  const n = bulkSel.size;
  return `<div class="row gap" style="margin-top:14px;justify-content:space-between;align-items:center">
    <span class="muted small">${n} selected${n ? ` · +${total} ✦ Immortal Essence` : ''}</span>
    <span class="gap" style="display:flex">
      <button class="danger" ${n ? '' : 'disabled'} onclick="G.bulkDismissConfirm()">Dismiss ${n || ''}${n ? ` · +${total} ✦` : ''}</button>
      <button onclick="G.closeModal()">Cancel</button>
    </span></div>`;
}
function bulkDismissModalHtml() {
  const all = dismissableAll(), list = dismissableList(), f = bulkFilter;
  // option sets drawn from the UNFILTERED pool so a narrowing filter never hides the others
  const rarities = [...new Set(all.map((c) => c.rarity))].sort((a, b) => rarityTier(b) - rarityTier(a));
  const imprints = [...new Set(all.map((c) => c.imprint || 0))].sort((a, b) => a - b);
  const realms = [...new Set(all.map((c) => c.realm))].sort((a, b) => b - a);
  const opt = (cur, v, label) => `<option value="${v}" ${String(cur) === String(v) ? 'selected' : ''}>${label}</option>`;
  const rarityOpts = opt(f.rarity, 'all', 'All rarities') + rarities.map((r) => opt(f.rarity, r, r)).join('');
  const imprintOpts = opt(f.imprint, 'all', 'All imprints') + imprints.map((l) => opt(f.imprint, l, l === 0 ? 'No imprint' : '魂印 Lv ' + l)).join('');
  const realmOpts = opt(f.realm, 'all', 'All realms') + realms.map((r) => opt(f.realm, r, realmName(r))).join('');
  const dupCount = duplicateSpares().length;
  const rows = list.length ? list.map((c) => `<label class="bulk-row">
      <input type="checkbox" ${bulkSel.has(c.id) ? 'checked' : ''} onchange="G.bulkDismissToggle('${c.id}')">
      <span class="bulk-name">${c.name}</span>
      <span class="muted small">${c.rarity} · ${realmName(c.realm)}${(c.imprint || 0) > 0 ? ` · 魂印 ${c.imprint}` : ''}</span>
      <span class="stone" style="margin-left:auto;white-space:nowrap">+${dismissRefund(c.rarity)} ✦</span>
    </label>`).join('') : '<div class="muted" style="padding:18px 12px">No benched cultivators match these filters.</div>';
  return `<h3>Dismiss Cultivators · 遣散</h3>
    <p class="muted">Tick benched cultivators to release for <b>Immortal Essence</b>. This is <b>permanent</b> — they leave your roster for good. (You and active fighters can't be dismissed.)</p>
    <div class="teamctl" style="margin:12px 0 8px">
      <span class="muted small">Rarity</span><select onchange="G.bulkDismissFilter('rarity',this.value)">${rarityOpts}</select>
      <span class="muted small">Imprint</span><select onchange="G.bulkDismissFilter('imprint',this.value)">${imprintOpts}</select>
      <span class="muted small">Realm</span><select onchange="G.bulkDismissFilter('realm',this.value)">${realmOpts}</select>
    </div>
    <div class="row gap" style="margin:0 0 8px;flex-wrap:wrap">
      <button onclick="G.bulkDismissAll(true)">Select shown (${list.length})</button>
      <button onclick="G.bulkDismissAll(false)">Clear</button>
      <button onclick="G.bulkDismissDupes()" ${dupCount ? '' : 'disabled'} title="Select every duplicate copy except the best of each (highest realm/imprint)">⧉ Select duplicates (${dupCount})</button>
    </div>
    <div class="bulk-list">${rows}</div>
    <div id="bulk-dismiss-foot">${bulkDismissFootHtml()}</div>`;
}

// Set (or clear, id=null) a character's killer archetype AFTER the unlock gate, then repaint. Drops
// the core if it no longer matches the new archetype's favored domain (mirrors the old inline logic).
function applyKillerArchetype(c, id) {
  c.killer = c.killer || { core: null, support: [], archetype: null };
  c.killer.archetype = id;
  const dom = archetypeDomain(id);
  if (dom && c.killer.core) { const cg = guOf(c.killer.core); if (!cg || !guInDomain(cg, dom)) { c.killer.core = null; c.killer.support = []; } }
  UI.refreshTop(); UI.render(activeTab === 'battle' ? 'team' : activeTab); save();
}

// ---------- global event API ----------
const G = {
  // New game is a four-step modal chain (name → Dao path → first Gu → archetype), carried by `pendingNew`
  // so user text never has to be escaped into inline onclick handlers.
  startNew(i) {
    pendingNew = { slot: i };
    UI.showModal(`<h3>Begin Cultivation</h3>
      <div class="body">Name your cultivator — you walk the path of Fang Yuan:<br>
      <input id="newName" type="text" maxlength="24" value="Fang Yuan"
        style="width:100%;margin-top:10px;padding:8px;font:inherit"
        onkeydown="if(event.key==='Enter'){event.preventDefault();G.starterName();}"></div>
      <div class="right"><button onclick="G.closeModal()">Cancel</button>
      <button class="primary" onclick="G.starterName()">Continue →</button></div>`);
    setTimeout(() => { const el = document.getElementById('newName'); if (el) el.select(); }, 0);
  },
  // Step 2: capture + sanitize the name, then show the Dao-path picker.
  starterName() {
    if (!pendingNew) return;
    const el = document.getElementById('newName');
    let name = ((el && el.value) || '').replace(/[<>]/g, '').trim().slice(0, 24);
    pendingNew.name = name || 'Fang Yuan';
    UI.showModal(UI.starterPathPicker(), 'wide');
  },
  starterPath(pid) { if (pendingNew) { pendingNew.path = pid; UI.showModal(UI.starterGuPicker(pid), 'wide'); } },
  starterBack() { if (pendingNew) UI.showModal(UI.starterPathPicker(), 'wide'); },
  // Step 3: chosen Gu → on to the archetype picker (kept in pendingNew; creation finalizes at step 4).
  starterGu(guId) { if (pendingNew) { pendingNew.guId = guId; UI.showModal(UI.starterArchetypePicker(), 'wide'); } },
  starterArchetypeBack() { if (pendingNew) UI.showModal(UI.starterGuPicker(pendingNew.path), 'wide'); },
  // Step 4: chosen archetype LINE finalizes creation (path affinity + starter Gu + archetype line).
  starterArchetype(lineId) {
    if (!pendingNew) return;
    const { slot, name, path, guId } = pendingNew;
    pendingNew = null;
    UI.closeModal();
    startGame(newGame(SLOT_KEYS[slot], name, { path, guId, line: lineId }), true);
  },
  continueGame(i) { startGame(load(SLOT_KEYS[i]), false); },
  deleteSlot(i) { deleteSave(SLOT_KEYS[i]); renderTitle(); },
  toTitle,
  setTab(t) { activeTab = t; document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === t)); UI.render(t); },
  // Open a single character's full design sheet (pseudo-tab; no nav button is highlighted).
  openChar(id) {
    if (!S().roster.find((x) => x.id === id)) return;
    activeTab = 'char';
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'char'));
    UI.openCharSheet(id);
  },
  // Nav "Character" button: open the last-viewed sheet, else your own character, else the first.
  openCharTab() {
    const roster = S().roster; if (!roster.length) return;
    const last = UI.currentCharId();
    const target = (last && roster.find((x) => x.id === last)) || roster.find((x) => x.isPlayer) || roster[0];
    G.openChar(target.id);
  },
  // Flip to the prev/next character on the sheet (dir = -1 | +1), wrapping around. Order = active
  // fighters first, then reserves by rarity (highest → lowest) — see UI.charNavOrder.
  stepChar(dir) {
    const order = UI.charNavOrder(); if (order.length < 2) return;
    let i = order.findIndex((x) => x.id === UI.currentCharId());
    if (i < 0) i = 0;
    i = (i + dir + order.length) % order.length;
    G.openChar(order[i].id);
  },
  setView(key, mode) { S().settings[key] = mode; UI.render(activeTab); save(); },
  // Live roster search (Team tab): repaint only the cards so the input keeps focus while typing.
  teamSearch(v) { S().settings.teamSearch = v; UI.renderRosterResults(); save(); },
  clearTeamFilters() { const s = S().settings; s.teamFilter = 'all'; s.teamRarity = 'all'; s.teamPath = 'all'; s.teamSearch = ''; UI.render(activeTab); save(); },
  // Refinery boolean filters: "guCraftable" (craftable-now only) / "guUnlocked" (unlocked paths only).
  toggleGuFlag(key) { S().settings[key] = !S().settings[key]; UI.render(activeTab); save(); },
  // Live Refinery search: repaint only the path sections so the input keeps focus.
  guSearch(v) { S().settings.guSearch = v; UI.renderGuResults(); save(); },
  clearGuFilters() { const s = S().settings; s.guTier = 'all'; s.guPath = 'all'; s.guCraftable = false; s.guUnlocked = false; s.guSearch = ''; UI.render(activeTab); save(); },
  // Refinery: expand/collapse a single Dao-path section (collapsed sections build no cards).
  toggleGuPath(pid) { const o = S().settings.guOpen || (S().settings.guOpen = {}); if (o[pid]) delete o[pid]; else o[pid] = true; UI.render(activeTab); save(); },
  collapseGu() { S().settings.guOpen = {}; UI.render(activeTab); save(); },
  // Live Market search: repaint only the results list so the input keeps focus while typing.
  shopSearch(v) { S().settings.shopSearch = v; UI.renderShopResults(); save(); },
  clearShopFilters() { S().settings.shopRarity = 'all'; S().settings.shopPath = 'all'; S().settings.shopSearch = ''; UI.render(activeTab); save(); },
  // Open a resource's detail page (pseudo-tab 'res'); keep the Almanac nav button lit while drilled in.
  openRes(id) {
    if (!RESOURCES[id]) return;
    activeTab = 'res';
    document.querySelectorAll('#nav button').forEach((b) => b.classList.toggle('active', b.dataset.tab === 'almanac'));
    UI.openResSheet(id);
  },
  // Live Almanac search: repaint only the resource cards so the input keeps focus.
  almanacSearch(v) { S().settings.almSearch = v; UI.renderAlmanacResults(); save(); },
  clearAlmanacFilters() { S().settings.almRarity = 'all'; S().settings.almPath = 'all'; S().settings.almSearch = ''; UI.render(activeTab); save(); },
  // Equip-picker filter/search (path | name): repaint only the modal's Gu list, keeping input focus.
  guPickFilter(key, v) { if (!guPick) return; guPick[key] = v; const host = document.getElementById('gupick-list'); if (host) host.innerHTML = guPickerListHtml(); },
  // Jump from a resource's recipe list into the Gu Refinery, pre-filtered to that Dao Path.
  openRefinery(path) { S().settings.guPath = path; G.setTab('gu'); save(); },
  setAllocStep(s) { S().settings.allocStep = s === 'max' ? 'max' : Number(s); UI.render(activeTab); save(); },
  // Stage (dir=+1) or unstage (dir=-1) the current per-click step into a pending draft on this
  // character. Nothing is committed until G.allocCommit — the draft just records intent and is
  // clamped so the staged total never exceeds the character's unspent points.
  allocStage(id, key, dir) {
    const c = S().roster.find((x) => x.id === id); if (!c || !ATTR_KEYS.includes(key)) return;
    const unspent = unspentPoints(c); if (unspent <= 0) return;
    let d = S().allocDraft;
    if (!d || d.id !== id) d = S().allocDraft = { id, str: 0, agi: 0, con: 0, int: 0, luck: 0 };
    const step = S().settings.allocStep || 10;
    if (dir > 0) {
      const remaining = unspent - ATTR_KEYS.reduce((s, k) => s + (d[k] || 0), 0);
      const inc = step === 'max' ? remaining : Math.min(remaining, Number(step) || 1);
      if (inc <= 0) return;
      d[key] = (d[key] || 0) + inc;
    } else {
      const cur = d[key] || 0; if (cur <= 0) return;
      const dec = step === 'max' ? cur : Math.min(cur, Number(step) || 1);
      d[key] = cur - dec;
    }
    UI.render(activeTab); save();
  },
  // Commit the pending draft: pour staged points into the real attrs (re-clamped to unspent), then clear it.
  allocCommit(id) {
    const c = S().roster.find((x) => x.id === id); if (!c) return;
    const d = S().allocDraft; if (!d || d.id !== id) return;
    if (!c.attrs) c.attrs = { str: 0, agi: 0, con: 0, int: 0, luck: 0 };
    let budget = unspentPoints(c), applied = 0;
    for (const k of ATTR_KEYS) {
      const add = Math.min(budget, Math.max(0, d[k] || 0));
      if (add > 0) { c.attrs[k] += add; budget -= add; applied += add; }
    }
    S().allocDraft = null;
    UI.toast(applied > 0 ? `Allocated ${applied} point${applied === 1 ? '' : 's'}.` : 'Nothing staged.');
    UI.render(activeTab); save();
  },
  // Discard the pending draft without committing.
  allocClear(id) {
    if (S().allocDraft && S().allocDraft.id === id) S().allocDraft = null;
    UI.render(activeTab); save();
  },
  // Respec: spend 石 (1000 per invested point) + a flat 100 ✦ to release every allocated attribute
  // back into the unspent pool. Confirm first — it wipes the whole distribution.
  respecPrompt(id) {
    const c = S().roster.find((x) => x.id === id); if (!c) return;
    const invested = spentPoints(c);
    if (invested <= 0) return UI.toast(`${c.name} has no allocated attributes to respec.`);
    const cost = respecCost(c), ess = RESPEC_ESSENCE_COST;
    const lowStones = S().stones < cost, lowEss = S().essence < ess;
    const afford = !lowStones && !lowEss;
    const short = lowStones && lowEss ? `You only have ${Math.floor(S().stones).toLocaleString()} 石 and ${Math.floor(S().essence).toLocaleString()} ✦.`
      : lowStones ? `You only have ${Math.floor(S().stones).toLocaleString()} 石.`
      : lowEss ? `You only have ${Math.floor(S().essence).toLocaleString()} ✦.` : '';
    UI.showModal(`<h3>Respec attributes?</h3>
      <p class="muted">Release all of <b>${c.name}</b>'s allocated attributes back into the unspent pool. This unbinds <b>${invested.toLocaleString()}</b> point${invested === 1 ? '' : 's'} for <b class="stone">${cost.toLocaleString()} 石</b> <span class="muted small">(1,000 石 per invested point)</span> plus <b style="color:var(--jade)">${ess.toLocaleString()} ✦</b> — you can then redistribute them freely.${afford ? '' : `<br><br><span class="blood-text">${short}</span>`}</p>
      <div class="row gap" style="margin-top:14px">
        <button class="danger" ${afford ? '' : 'disabled'} onclick="G.respecConfirm('${id}')">Respec · −${cost.toLocaleString()} 石 · −${ess.toLocaleString()} ✦</button>
        <button onclick="G.closeModal()">Cancel</button>
      </div>`);
  },
  respecConfirm(id) {
    const r = respecAttributes(id);
    UI.closeModal();
    if (!r.ok) return UI.toast(r.msg);
    if (S().allocDraft && S().allocDraft.id === id) S().allocDraft = null; // any staged draft is now stale
    UI.toast(r.msg, 5000, 'loot');
    UI.refreshTop();                          // stones + essence changed
    UI.render(activeTab); save();
  },
  toggleIdle() { if (autoChallenge) return; S().settings.idle = !S().settings.idle; if (S().settings.idle) startIdle(); else stopIdle(); UI.renderBattleControls(); save(); },
  attemptAdvance,
  toggleAutoChallenge,
  // Challenge a bounty (a lone raid-boss target). The hunt plays out in the ARENA like a frontier assault —
  // never an auto-resolve: it queues `pendingBounty`, switches to the Battle tab, and runs the animated
  // fight (interrupting any in-flight fight). The attempt is spent + rewards granted when it resolves
  // (runBattle's bounty branch), so an interrupted/queued hunt costs nothing.
  attemptBounty(slot) {
    if (battleBusy && pendingBounty != null) return;  // a hunt is already queued/running
    if (!activeTeam().length) return UI.toast('Activate at least one fighter first.');
    if (!slotUnlocked(slot)) return UI.toast('That bounty is still locked — climb the tower to unlock it.');
    if (attemptsLeft() <= 0) return UI.toast('No bounty attempts left — they recharge +1 per hour.');
    if (autoChallenge) endAutoChallenge('stopped');   // a hunt supersedes an auto-climb…
    challengeRequested = false;                        // …and a queued frontier attempt
    pendingBounty = slot;
    if (activeTab !== 'battle') G.setTab('battle');    // watch the hunt unfold in the arena
    if (battleBusy) { abortBattle = true; UI.abortTimeline(); return; } // cut the in-flight fight; the hunt starts next
    stopIdle();
    runBattle();
  },
  setFarm(f) {
    // only cleared/beaten floors (1 .. frontier-1) are farmable; floor 1 is the bootstrap target
    f = Math.max(1, Math.min(Math.max(1, S().frontier - 1), f));
    if (f === S().farmFloor) return;
    S().farmFloor = f;
    UI.renderBattleControls();                                    // update controls without clobbering an in-flight animation
    if (!battleBusy && activeTab === 'battle') UI.renderArena();  // refresh the static enemy preview when idle
    UI.toast('Now farming Floor ' + f); save();
  },
  pull(n) { const r = pull(n); if (!r.ok) return UI.toast(r.msg);
    Audio.gacha(Math.max(...r.got.map((c) => rarityTier(c.rarity)))); // sparkle scales with the best roll
    bumpQuest('recruit', r.got.length);          // daily quest: recruited a cultivator
    UI.render('recruit'); UI.renderPulls(r.got); save(); },
  // Confirm before dismissing — releasing a cultivator is permanent, so guard against a mis-click.
  dismissPrompt(id) {
    const c = S().roster.find((x) => x.id === id); if (!c) return;
    if (c.isPlayer) return UI.toast('You cannot dismiss yourself.');
    if (c.active) return UI.toast('Bench them first, then dismiss.');
    const refund = dismissRefund(c.rarity);
    UI.showModal(`<h3>Dismiss ${c.name}?</h3>
      <p class="muted">Releasing this <b>${c.rarity}</b> cultivator is <b>permanent</b> — they leave your roster for good. You'll be refunded <b>${refund} ✦</b> Immortal Essence.</p>
      <div class="row gap" style="margin-top:14px">
        <button class="danger" onclick="G.dismissConfirm('${c.id}')">Dismiss · +${refund} ✦</button>
        <button onclick="G.closeModal()">Cancel</button>
      </div>`);
  },
  dismissConfirm(id) { UI.closeModal(); G.dismiss(id); },
  dismiss(id) {
    const r = dismiss(id);
    if (!r.ok) return UI.toast(r.msg);
    UI.toast(`Dismissed ${r.name} (+${r.refund} ✦).`);
    if (activeTab === 'char') G.setTab('team'); else UI.render('team'); // the sheet's subject is gone
    save();
  },
  // Bulk dismiss: open a checkbox picker of benched cultivators (filterable) to release together for essence.
  bulkDismissPrompt() {
    if (!dismissableAll().length) return UI.toast('No benched cultivators to dismiss — bench fighters first.');
    bulkSel = new Set();
    bulkFilter = { rarity: 'all', imprint: 'all', realm: 'all' };
    renderBulkModal();
  },
  bulkDismissFilter(key, v) { bulkFilter[key] = v; renderBulkModal(); },
  bulkDismissToggle(id) {
    if (bulkSel.has(id)) bulkSel.delete(id); else bulkSel.add(id);
    const f = document.getElementById('bulk-dismiss-foot'); if (f) f.innerHTML = bulkDismissFootHtml();
  },
  bulkDismissAll(on) {
    if (on) dismissableList().forEach((c) => bulkSel.add(c.id)); // select the SHOWN (filtered) rows, unioned
    else bulkSel = new Set();                                    // Clear wipes the whole selection
    renderBulkModal();
  },
  // Tick every duplicate spare (keep the best of each name); reset filters so all selected rows are visible.
  bulkDismissDupes() {
    duplicateSpares().forEach((c) => bulkSel.add(c.id));
    bulkFilter = { rarity: 'all', imprint: 'all', realm: 'all' };
    renderBulkModal();
  },
  bulkDismissConfirm() {
    const ids = [...bulkSel]; if (!ids.length) return;
    const r = dismissMany(ids);
    bulkSel = new Set();
    UI.closeModal();
    if (!r.count) return UI.toast('Nothing dismissed.');
    UI.toast(`Dismissed ${r.count} cultivator${r.count === 1 ? '' : 's'} (+${r.refund} ✦).`);
    UI.render(activeTab === 'char' || activeTab === 'battle' ? 'team' : activeTab);
    UI.refreshTop(); save();
  },
  // Soul Imprint: open a picker of benched duplicates to sacrifice into the character `id`.
  imprintPrompt(id) {
    const t = S().roster.find((c) => c.id === id);
    if (!t) return;
    if ((t.imprint || 0) >= IMPRINT_CAP) return UI.toast(`${t.name} is already at max Soul Imprint (Lv ${IMPRINT_CAP}).`);
    const cands = imprintCandidates(id);
    if (!cands.length) return UI.toast('No benched duplicates to imprint. Recruit (or bench) another copy first.');
    const rows = cands.map((c) =>
      `<div class="row gap" style="justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--line)">
        <span>${c.name} <span class="muted small">${realmName(c.realm)}${(c.imprint || 0) > 0 ? ` · 魂印 ${c.imprint}` : ''}</span></span>
        <button class="danger" onclick="G.imprintConfirm('${id}','${c.id}')">Sacrifice</button>
      </div>`).join('');
    UI.showModal(`<h3>Soul Imprint · 魂印</h3>
      <p class="muted">Sacrifice a duplicate of <b>${t.name}</b> to raise its Soul Imprint to <b>Lv ${(t.imprint || 0) + 1}</b> — permanently +5% to all attributes and +0.1 aptitude. The sacrificed copy is destroyed.</p>
      <div style="margin:12px 0">${rows}</div>
      <div class="row" style="margin-top:8px"><button onclick="G.closeModal()">Cancel</button></div>`);
  },
  imprintConfirm(targetId, fodderId) {
    const r = imprint(targetId, fodderId);
    UI.closeModal();
    if (!r.ok) return UI.toast(r.msg);
    UI.toast(`${r.name} → Soul Imprint Lv ${r.level}.`);
    UI.render(activeTab); UI.refreshTop(); save();
  },
  // One-click consolidate every duplicate set: keep the best copy (highest realm), imprint the rest in.
  autoImprint() {
    const r = autoImprintAll();
    if (!r.merged) return UI.toast('No duplicate copies to imprint.');
    normalizeFormation(); // repair any board slot freed by a sacrificed active duplicate
    UI.toast(`Soul Imprint · merged ${r.merged} duplicate${r.merged === 1 ? '' : 's'} into ${r.sets} cultivator${r.sets === 1 ? '' : 's'}.`);
    UI.render(activeTab); UI.refreshTop(); save();
  },
  buyBoon(key) {
    const r = buyBoon(key);
    if (!r.ok) return UI.toast(r.msg);
    UI.toast(`${key} boon → Lv ${r.level}.`); UI.render('dao');
  },
  // Reincarnation is a three-step modal chain (confirm + name → new Dao affinity → new archetype),
  // carried by `pendingReincarnate`. The affinity choices are THIS life's mastered paths (previous
  // affinity + every path at Comprehension level 5+) — read off the current life before it's wiped.
  reincarnatePrompt() {
    if (!canReincarnate()) return UI.toast('Reach Floor 20 or forge a Venerable before reincarnating.');
    pendingReincarnate = {};
    const cur = S().roster.find((c) => c.isPlayer) || S().roster[0];
    const name = ((cur && cur.name) || 'Fang Yuan').replace(/"/g, '&quot;');
    UI.showModal(`<h3>Reincarnate?</h3>
      <p class="muted">This severs your current life — floors, roster, Gu, resources and Dao Marks are all reset. In return you claim about <b>${soulsAward()}</b> Sovereign Souls and keep every permanent boon. You'll re-choose your name, Dao affinity, and archetype for the new life.</p>
      <div class="body">Name your reborn cultivator:<br>
      <input id="reincName" type="text" maxlength="24" value="${name}"
        style="width:100%;margin-top:10px;padding:8px;font:inherit"
        onkeydown="if(event.key==='Enter'){event.preventDefault();G.reincarnateName();}"></div>
      <div class="right"><button onclick="G.closeModal()">Keep cultivating</button>
      <button class="primary" onclick="G.reincarnateName()">Continue →</button></div>`);
    setTimeout(() => { const el = document.getElementById('reincName'); if (el) el.select(); }, 0);
  },
  // Step 2: capture + sanitize the new name, then show the Dao-affinity picker (mastered paths only).
  reincarnateName() {
    if (!pendingReincarnate) return;
    const el = document.getElementById('reincName');
    let name = ((el && el.value) || '').replace(/[<>]/g, '').trim().slice(0, 24);
    pendingReincarnate.name = name || 'Fang Yuan';
    UI.showModal(UI.reincarnatePathPicker(), 'wide');
  },
  reincarnatePath(pid) { if (pendingReincarnate) { pendingReincarnate.path = pid; UI.showModal(UI.reincarnateArchetypePicker(), 'wide'); } },
  reincarnatePathBack() { if (pendingReincarnate) UI.showModal(UI.reincarnatePathPicker(), 'wide'); },
  // Step 3: chosen archetype LINE finalizes the rebirth (new name + affinity + archetype line).
  reincarnateArchetype(lineId) {
    if (!pendingReincarnate) return;
    const choice = { ...pendingReincarnate, line: lineId };
    pendingReincarnate = null;
    const r = reincarnate(choice);
    UI.closeModal();
    if (!r.ok) return UI.toast(r.msg);
    UI.toast(`Reincarnated — +${r.award} Sovereign Souls (${r.souls} total).`);
    G.setTab('battle'); UI.refreshTop(); save();
  },
  craft(guId) { const r = craft(guId); if (r.ok) { Audio.forge(); bumpQuest('craft'); } UI.toast(r.ok ? `Refined ${r.gu.name}.` : r.msg); UI.render('gu'); save(); },
  // Audio settings (gear FAB, bottom-left): independent BGM + SFX level bars (0–10) + mute overrides.
  openSettings() { UI.showModal(UI.settingsModal(), 'narrow'); },
  setBgm(v) { Audio.setBgm(v); const el = document.getElementById('set-bgm-val'); if (el) el.textContent = v; save(); },
  setSfx(v) { Audio.setSfx(v); const el = document.getElementById('set-sfx-val'); if (el) el.textContent = v; Audio.click(); save(); }, // tick lets you hear the SFX level
  setBgmMute(on) { Audio.setBgmMuted(on); const s = document.getElementById('set-bgm'); if (s) s.disabled = on; const el = document.getElementById('set-bgm-val'); if (el) el.textContent = on ? '—' : Audio.getBgm(); save(); },
  setSfxMute(on) { Audio.setSfxMuted(on); const s = document.getElementById('set-sfx'); if (s) s.disabled = on; const el = document.getElementById('set-sfx-val'); if (el) el.textContent = on ? '—' : Audio.getSfx(); if (!on) Audio.hit(); save(); },
  // Ascend an OWNED immortal Gu one rank (consumes stones + that rank's resources; resolveOwned then
  // surfaces the stronger form). Re-renders the active view (usually the character sheet) + top bar.
  upgradeGu(uid) {
    const r = upgrade(uid);
    UI.toast(r.ok ? `Ascended ${r.gu.name} to Tier ${r.tier}.` : r.msg);
    UI.render(activeTab); UI.refreshTop(); save();
  },
  // Market buy-amount selector (×1/×10/×100/×1000): sets how many units each Buy click purchases.
  setShopQty(n) { S().settings.shopQty = Number(n) || 1; UI.render('shop'); save(); },
  buyResource(id) { const q = S().settings.shopQty || 1; const r = buyResource(id, q); if (r.ok) bumpQuest('market'); UI.toast(r.ok ? `Purchased ×${q}.` : r.msg); if (r.ok) UI.render('shop'); UI.refreshTop(); save(); },
  toggleActive(id) {
    const c = S().roster.find((x) => x.id === id); if (!c) return;
    if (!c.active) {
      if (activeTeam().length >= 6) return UI.toast('Team is full (max 6).');
      const free = firstFreeTile(); if (!free) return UI.toast('Board is full (max 5 per row).');
      c.active = true; c.row = free.row; c.lane = free.lane;
    } else {
      if (activeTeam().length <= 1) return UI.toast("Can't bench your last fighter.");
      c.active = false;
    }
    UI.render(activeTab); save();
  },
  // Place a fighter on the formation board at (row, lane). Activates a reserve, moves an active unit,
  // or swaps with whoever holds the tile. Enforces ≤6 active and ≤5 per row (reverts on violation).
  placeAt(charId, row, lane) {
    const c = S().roster.find((x) => x.id === charId); if (!c) return;
    row = row === 'back' ? 'back' : 'front';
    const occ = tileOccupant(row, lane);
    if (occ && occ.id === c.id) return;
    const snap = [c, occ].filter(Boolean).map((x) => ({ x, active: x.active, row: rowOf(x), lane: laneOf(x) }));
    const restore = () => snap.forEach((s) => { s.x.active = s.active; s.x.row = s.row; s.x.lane = s.lane; });
    if (occ) { if (c.active) { occ.row = rowOf(c); occ.lane = laneOf(c); } else { occ.active = false; } }
    if (!c.active && activeTeam().length >= 6) { restore(); return UI.toast('Team is full (max 6).'); }
    c.active = true; c.row = row; c.lane = lane;
    if (rowCount('front') > ROW_CAP || rowCount('back') > ROW_CAP) { restore(); return UI.toast('Max 5 per row.'); }
    UI.render(activeTab); save();    // stay on the current tab (Formation) — don't bounce to the Team page
  },
  benchChar(id) {
    const c = S().roster.find((x) => x.id === id); if (!c) return;
    if (c.isPlayer) return UI.toast('You cannot bench yourself.');
    if (activeTeam().length <= 1) return UI.toast("Can't bench your last fighter.");
    c.active = false; UI.render(activeTab); save();    // re-render the active tab in place (Formation)
  },
  dragStart(ev, id) { try { ev.dataTransfer.setData('text/plain', id); ev.dataTransfer.effectAllowed = 'move'; } catch (e) {} },
  dragOver(ev) { ev.preventDefault(); try { ev.dataTransfer.dropEffect = 'move'; ev.currentTarget.classList.add('drop'); } catch (e) {} },
  dragLeave(ev) { try { ev.currentTarget.classList.remove('drop'); } catch (e) {} },
  dropTile(ev, row, lane) {
    ev.preventDefault();
    try { ev.currentTarget.classList.remove('drop'); } catch (e) {}
    let id = ''; try { id = ev.dataTransfer.getData('text/plain'); } catch (e) {}
    if (id) G.placeAt(id, row, lane);
  },
  ascend(id) {
    const r = ascend(id);
    if (!r.ok) return UI.toast(r.msg);
    if (r.ascended) Audio.breakthrough(true);
    UI.toast(r.msg); if (activeTab === 'battle') UI.logLine(r.msg, r.ascended ? 'win' : 'lose');
    UI.render(activeTab === 'battle' ? 'dao' : activeTab); save();
  },
  // Spend 石 on a fallible mortal breakthrough. Success → realm up (new attribute points); failure →
  // stones spent + a short temporary injury (see systems/cultivation.js attemptBreakthrough).
  attemptBreakthrough(id) {
    const r = attemptBreakthrough(id);
    if (!r.ok) return UI.toast(r.msg);
    bumpQuest('breakthrough');                    // daily quest: any breakthrough attempt counts (win or fail)
    if (r.success) Audio.breakthrough(); else Audio.defeat();
    UI.toast(r.msg, 5000, r.success ? 'ascend' : '');
    if (activeTab === 'battle') UI.logLine(r.msg, r.success ? 'win' : 'lose');
    UI.refreshTop();                                          // stones changed (and maybe realm)
    UI.render(activeTab === 'battle' ? 'team' : activeTab); save();
  },
  faceTribulation(id) {
    const r = resolveTribulation(id);
    if (!r.ok) return UI.toast(r.msg);
    UI.toast(r.msg); if (activeTab === 'battle') UI.logLine(r.msg, r.win ? 'win' : (r.died ? 'lose' : 'rare'));
    UI.render(activeTab === 'battle' ? 'dao' : activeTab); save();
  },
  becomeVenerable(id) {
    const r = becomeVenerable(id);
    if (!r.ok) return UI.toast(r.msg);
    if (r.ascended) Audio.breakthrough(true);
    UI.toast(r.msg); if (activeTab === 'battle') UI.logLine(r.msg, r.ascended ? 'win' : 'lose');
    UI.render(activeTab === 'battle' ? 'dao' : activeTab); save();
  },
  openGuPicker,
  equipGu(charId, slot, uid) { const c = S().roster.find((x) => x.id === charId); c.gu[slot] = uid; UI.closeModal(); UI.render(activeTab === 'battle' ? 'team' : activeTab); save(); },
  unequipGu(charId, slot) { const c = S().roster.find((x) => x.id === charId); c.gu.splice(slot, 1); UI.closeModal(); UI.render(activeTab === 'battle' ? 'team' : activeTab); save(); },
  // Reorder a Gu's channel PRIORITY (slot order): swap it with the adjacent equipped Gu (skipping empty
  // slots). dir = -1 raises priority (fires earlier when essence is tight), +1 lowers it.
  moveGu(charId, slot, dir) {
    const c = S().roster.find((x) => x.id === charId); if (!c) return;
    let j = slot + dir;
    while (j >= 0 && j < c.gu.length && !c.gu[j]) j += dir; // skip empties to the nearest equipped slot
    if (j < 0 || j >= c.gu.length || !c.gu[j]) return;       // no neighbour that way → already at the end
    const t = c.gu[slot]; c.gu[slot] = c.gu[j]; c.gu[j] = t;
    UI.render(activeTab === 'battle' ? 'team' : activeTab); save();
  },
  // KILLER MOVE config (character sheet). CORE = 1 Gu of the archetype's favored domain; SUPPORT = 2+ Gu
  // of the core's Dao path. setKillerArchetype picks the archetype (clears a core that no longer matches
  // its domain). autoKiller pre-fills core+support+archetype.
  setKillerCore(charId, uid) {
    const c = S().roster.find((x) => x.id === charId); if (!c) return;
    c.killer = c.killer || { core: null, support: [], archetype: null };
    if (c.killer.core === uid) { c.killer.core = null; c.killer.support = []; } // toggle off → clear the set
    else {
      const g = guOf(uid); if (!g) return;
      c.killer.core = uid;
      // keep only support that's a different Gu of the new core's path
      c.killer.support = (c.killer.support || []).filter((u) => u !== uid && (guOf(u) || {}).daoPath === g.daoPath);
    }
    UI.render(activeTab === 'battle' ? 'team' : activeTab); save();
  },
  setKillerSupport(charId, uid) {
    const c = S().roster.find((x) => x.id === charId); if (!c) return;
    c.killer = c.killer || { core: null, support: [], archetype: null };
    if (!c.killer.core) return UI.toast('Pick a core Gu first.');
    if (uid === c.killer.core) return;
    const cg = guOf(c.killer.core), g = guOf(uid); if (!cg || !g) return;
    if (g.daoPath !== cg.daoPath) return UI.toast("Support Gu must share the core's Dao path.");
    const sup = c.killer.support = (c.killer.support || []).slice();
    const i = sup.indexOf(uid);
    if (i >= 0) sup.splice(i, 1); else sup.push(uid);
    UI.render(activeTab === 'battle' ? 'team' : activeTab); save();
  },
  // Pick a killer-move archetype. Toggling off the active one, or switching to an ALREADY-UNLOCKED
  // archetype, is free + immediate. A NEW archetype is gated by a confirm modal: the character's FIRST
  // is free (with a warning that future ones cost essence); every subsequent one costs KILLER_ARCH_COST.
  setKillerArchetype(charId, id) {
    const c = S().roster.find((x) => x.id === charId); if (!c) return;
    c.killer = c.killer || { core: null, support: [], archetype: null };
    c.killerArchUnlocked = c.killerArchUnlocked || {};
    if (c.killer.archetype === id) return applyKillerArchetype(c, null);   // re-click → toggle off (free)
    if (c.killerArchUnlocked[id]) return applyKillerArchetype(c, id);       // already owned → switch (free)
    const A = ARCHETYPES[id]; if (!A) return;
    const first = Object.keys(c.killerArchUnlocked).length === 0;
    if (first) {
      UI.showModal(`<h3>${c.name}'s First Killer Move</h3>
        <p class="muted">Unlocking <b>${A.name}</b> is <b>free</b> — every cultivator's first killer-move archetype costs nothing.</p>
        <p class="muted">⚠ Any <b>other</b> archetype you unlock for ${c.name} later will cost <b>${KILLER_ARCH_COST} ✦</b> Immortal Essence each. (Re-selecting one you've already unlocked is always free.)</p>
        <div class="row gap" style="margin-top:14px">
          <button class="primary" onclick="G.confirmKillerArchetype('${charId}','${id}')">Unlock ${A.name} · free</button>
          <button onclick="G.closeModal()">Cancel</button>
        </div>`);
    } else {
      if (S().essence < KILLER_ARCH_COST) return UI.toast(`Need ${KILLER_ARCH_COST} ✦ to unlock ${A.name}.`);
      const after = Math.floor(S().essence) - KILLER_ARCH_COST;
      UI.showModal(`<h3>Unlock ${A.name}?</h3>
        <p class="muted">${c.name} has already chosen a free first killer move. Unlocking <b>${A.name}</b> costs <b>${KILLER_ARCH_COST} ✦</b> Immortal Essence.</p>
        <p class="muted">Balance: <b>${Math.floor(S().essence).toLocaleString()} ✦</b> → <b>${after.toLocaleString()} ✦</b>. Once unlocked, switching back to it is free.</p>
        <div class="row gap" style="margin-top:14px">
          <button class="primary" onclick="G.confirmKillerArchetype('${charId}','${id}')">Unlock · −${KILLER_ARCH_COST} ✦</button>
          <button onclick="G.closeModal()">Cancel</button>
        </div>`);
    }
  },
  // Confirm an archetype unlock from the modal: charge only when it's NOT the free first pick, mark it
  // unlocked, then apply it. Defensive re-check of essence (state may have changed since the prompt).
  confirmKillerArchetype(charId, id) {
    const c = S().roster.find((x) => x.id === charId); if (!c) return UI.closeModal();
    c.killerArchUnlocked = c.killerArchUnlocked || {};
    if (!c.killerArchUnlocked[id]) {
      const paid = Object.keys(c.killerArchUnlocked).length > 0;
      if (paid) {
        if (S().essence < KILLER_ARCH_COST) { UI.closeModal(); return UI.toast(`Need ${KILLER_ARCH_COST} ✦.`); }
        S().essence -= KILLER_ARCH_COST;
        UI.toast(`Unlocked ${ARCHETYPES[id].name} for ${c.name} (−${KILLER_ARCH_COST} ✦).`, 3500, 'loot');
      } else {
        UI.toast(`${ARCHETYPES[id].name} unlocked for ${c.name} — free first killer move.`, 3500, 'loot');
      }
      c.killerArchUnlocked[id] = true;
    }
    UI.closeModal();
    applyKillerArchetype(c, id);
  },
  autoKiller(charId) {
    const c = S().roster.find((x) => x.id === charId); if (!c) return;
    const items = (c.gu || []).filter(Boolean).map((uid) => ({ uid, gu: guOf(uid) })).filter((it) => it.gu);
    const auto = autoConfigure(items);
    if (!auto) return UI.toast('Equip 3+ Gu of one Dao path to form a killer move.');
    c.killerArchUnlocked = c.killerArchUnlocked || {};
    const owned = !!c.killerArchUnlocked[auto.archetype];
    const first = Object.keys(c.killerArchUnlocked).length === 0;
    // Don't silently spend essence via "Suggest": a PAID unlock must be confirmed by picking it in
    // the list. Owned archetypes (and the free first pick) auto-fill directly.
    if (!owned && !first) return UI.toast(`Suggested ${ARCHETYPES[auto.archetype].name} — unlock it for ${KILLER_ARCH_COST} ✦ by selecting it in the Archetype list.`);
    if (!owned) { c.killerArchUnlocked[auto.archetype] = true; UI.toast(`${ARCHETYPES[auto.archetype].name} unlocked for ${c.name} — free first killer move.`, 3500, 'loot'); }
    c.killer = { core: auto.core, support: auto.support, archetype: auto.archetype };
    UI.refreshTop(); UI.render(activeTab === 'battle' ? 'team' : activeTab); save();
  },
  // Team tab: expand/collapse the inline killer-move editor on a roster card.
  toggleKillerEdit(charId) {
    const s = S().settings; const o = s.killerOpen || (s.killerOpen = {});
    if (o[charId]) delete o[charId]; else o[charId] = true;
    UI.render(activeTab === 'battle' ? 'team' : activeTab); save();
  },
  // Guide (Codex): collapsible <details class="cdx-sec"> sections. Pure DOM helpers (no state) — sections
  // default collapsed each render so the page opens short. cdxOpen expands + scrolls to a TOC target;
  // cdxToggleAll flips every section and relabels its own button.
  cdxOpen(id) {
    const d = document.getElementById(id);
    if (!d) return;
    d.open = true;
    d.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },
  cdxToggleAll(btn) {
    const secs = [...document.querySelectorAll('.cdx-sec')];
    const expand = secs.some((d) => !d.open); // any collapsed → expand all; otherwise collapse all
    secs.forEach((d) => { d.open = expand; });
    if (btn) btn.textContent = expand ? '⊖ Collapse all' : '⊕ Expand all';
  },
  // One-time bonus for completing EVERY First-Steps tutorial goal. Idempotent — the persistent
  // onboarding.rewarded flag guards it, so re-arming the guide (or repeated renders) can't farm it.
  // Fires from UI.render (manual final steps) and the battle-win path (finishing via idle farming);
  // self-checks completion so the extra call sites are harmless. Independent of the widget's
  // `dismissed` state — dismissing the checklist never forfeits the reward.
  claimOnboardingReward() {
    const o = S() && S().onboarding;
    if (!o || !o.active || !UI.onboardingComplete()) return;
    // Tutorial complete → RETIRE it (active:false) so undoing a step later (e.g. unequipping the starter
    // Gu) can't re-pop the widget. Decoupled from the payout so a re-armed guide also retires when redone.
    o.active = false;
    if (!o.rewarded) {                       // one-time bonus — guarded so re-arming never re-pays
      o.rewarded = true;
      const amt = 450;
      S().essence += amt;
      UI.banner(`<span class="cjk b-seal">道</span><span class="b-text"><b>First Steps complete</b><span class="b-sub">+${amt} <span class="essence">✦</span> Immortal Essence</span></span>`, 'reward');
    }
    UI.refreshTop();
    save();
  },
  // Permanently close the First-Steps onboarding widget (per-save; tips are independent and stop on their own).
  dismissOnboard() { if (!S() || !S().onboarding) return; S().onboarding.dismissed = true; UI.renderOnboard(); save(); },
  // (Re)start the First-Steps guide on demand — works on ANY save, incl. older ones migrated as onboarded.
  // Resets the widget + replays first-visit tips. Steps still auto-check from state, so already-done goals
  // show as complete (the widget hides if every step is already met).
  startOnboarding() {
    if (!S()) return;
    const wasRewarded = !!(S().onboarding && S().onboarding.rewarded); // preserve the one-time bonus guard
    S().onboarding = { active: true, dismissed: false, tipsSeen: {}, rewarded: wasRewarded };
    UI.render(activeTab);   // repaint current tab → renderOnboard() shows the widget
    UI.toast('First-Steps guide started — follow the checklist at the bottom-right.', 4000, 'tip');
    save();
  },
  // ---------- daily quests ----------
  // Claim a single completed quest's ✦ reward. Repaints the Quests page + top bar + nav badge.
  claimQuest(id) {
    const r = claimQuest(id);
    if (!r.ok) return UI.toast('Not ready to claim.');
    Audio.victory();
    UI.toast(`Quest complete — +${r.reward} ✦ Immortal Essence.`, 3500, 'loot');
    UI.render('quests'); UI.refreshTop(); save();
  },
  // Claim the all-clear bonus (only once every quest is claimed).
  claimDailyBonus() {
    const r = claimBonus();
    if (!r.ok) return UI.toast('Claim every quest first.');
    Audio.breakthrough(true);
    UI.banner(`<span class="cjk b-seal">日</span><span class="b-text"><b>Daily quests complete</b><span class="b-sub">+${r.reward} <span class="essence">✦</span> Immortal Essence</span></span>`, 'reward');
    UI.render('quests'); UI.refreshTop(); save();
  },
  // Collect everything claimable at once (each completed quest + the all-clear bonus if it's earned).
  claimAllQuests() {
    let total = 0, n = 0;
    for (const q of DAILY_QUESTS) { const r = claimQuest(q.id); if (r.ok) { total += r.reward; n++; } }
    const b = claimBonus(); if (b.ok) total += b.reward;
    if (!total) return UI.toast('Nothing ready to claim.');
    Audio.victory();
    UI.toast(`Claimed ${n} quest${n === 1 ? '' : 's'}${b.ok ? ' + bonus' : ''} — +${total} ✦.`, 4000, 'loot');
    UI.render('quests'); UI.refreshTop(); save();
  },
  closeModal: UI.closeModal,
};
window.G = G;

// ---------- boot ----------
window.addEventListener('load', () => {
  renderTitle();
  Audio.init(); // procedural music + SFX; the context starts on the first user gesture (autoplay policy)
  setInterval(() => { if (S()) save(); }, 20000); // autosave heartbeat
  document.addEventListener('visibilitychange', onVisibilityChange); // pause + catch up across browser-tab switches
});
