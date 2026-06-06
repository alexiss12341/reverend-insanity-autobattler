// Main orchestrator: boots the title screen, runs the idle loop, executes floor
// encounters, distributes rewards, and exposes the global `G` event API used by the UI.
import { state, S, newGame, load, save, deleteSave, listSaves, SLOT_KEYS, activeTeam, rowOf, laneOf, tileOccupant, rowCount, ROW_CAP, firstFreeTile, normalizeFormation } from './state.js';
import { effectiveStats } from './systems/cultivation.js';
import { resolveEncounter, fightWallMs } from './systems/battle.js';
import { attemptBreakthrough } from './systems/cultivation.js';
import { rollFloorRewards, firstClearEssence, rollFarmEssence, farmEssenceEV, applyDrops, buyResource } from './systems/economy.js';
import { pull, dismiss, dismissRefund, imprint, imprintCandidates, IMPRINT_CAP } from './systems/gacha.js';
import { buyBoon, reincarnate, soulsAward } from './systems/prestige.js';
import { craft, upgrade } from './systems/crafting.js';
import { generateEncounter, isBossFloor, MAX_FLOORS } from './data/floors.js';
import { guOf } from './systems/cultivation.js';
import { GU_LIB, effectText, guEssenceCost, isUnique } from './data/gu.js';
import { pathName } from './data/daoPaths.js';
import { resourceName, RESOURCES } from './data/resources.js';
import { isImmortalRealm, realmName } from './data/realms.js';
import { accrue, ascend, resolveTribulation, becomeVenerable } from './systems/tribulation.js';
import { addMarks, addComprehension } from './systems/dao.js';
import { affinityCompMult } from './data/traits.js';
import { ATTR_KEYS, unspentPoints, playerPool } from './data/attributes.js';
import * as UI from './ui.js';

let activeTab = 'battle';
let battleBusy = false;        // a fight run (animated or timed) is in flight
let idleTimer = null;          // pending next-run handle
let challengeRequested = false; // a manual "Attempt Floor" (frontier) is queued for the next run
let autoChallenge = false;      // auto-challenge mode: keep assaulting the frontier until a defeat
let autoChallengeHighest = 0;   // best floor cleared during the current auto-challenge run
let pendingNew = null;          // in-progress new game: { slot, name, path, guId } across the name→path→Gu→archetype modals

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- rewards / clearing ----------
function distributeRewards(floor, isBoss, fromLog) {
  const { stones, drops } = rollFloorRewards(floor, isBoss);
  S().stones += stones;
  applyDrops(drops);
  const essence = firstClearEssence(floor, isBoss) + rollFarmEssence(floor, isBoss);
  if (essence) S().essence += essence;
  // Combat no longer grants cultivation XP — mortals advance by spending 石 (see G.attemptBreakthrough).
  // advance frontier if we just cleared the frontier floor
  let advanced = false;
  if (floor === S().frontier && S().frontier < MAX_FLOORS) { S().frontier += 1; advanced = true; }
  return { stones, drops, essence, advanced };
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
  const challenging = manual || auto;                             // either way → assault the frontier
  if (!challenging && !S().settings.idle) return;                 // idle off and nothing queued → stop
  if (!activeTeam().length) {                                     // no fighters
    challengeRequested = false;
    if (auto) endAutoChallenge('stopped');
    if (S().settings.idle) idleTimer = setTimeout(runBattle, 1000);
    return;
  }
  battleBusy = true;
  challengeRequested = false;
  const floor = challenging ? S().frontier : S().farmFloor;
  const enc = generateEncounter(floor);
  const animate = activeTab === 'battle';                         // only the visible screen animates
  // record a timeline whenever we animate; collect the verbose per-hit feed only for a SINGLE manual
  // attempt. Auto-challenge keeps a concise running history (one result line per floor), like idle farming.
  const verbose = animate && manual && !auto;
  const log = [];
  const res = resolveEncounter(enc, verbose ? (m) => log.push(m) : undefined, animate ? { record: true } : undefined);
  commitComprehension(res.allies);

  if (animate) {
    if (challenging) {
      if (verbose) UI.clearLog();                                 // a lone manual attempt starts a fresh feed
      UI.logLine(`— Assaulting Floor ${floor}${enc.isBoss ? ' BOSS' : ''} (${enc.waves.length} wave${enc.waves.length > 1 ? 's' : ''}) —`, auto ? '' : 'rare');
    }
    await UI.playTimeline(res.timeline);    // animated arena: charge bars, clashes, damage popups
    if (verbose) log.forEach((m) => UI.logLine(m)); // dump the full feed after a single manual attempt
  } else {
    await sleep(fightWallMs(res.simTime));   // background: pace by the fight's real duration
  }
  if (!S()) { battleBusy = false; return; } // game reset mid-fight

  S().stats.battles += 1;
  if (res.win) {
    S().stats.wins += 1;
    const firstTime = !S().clearedFloors[floor];
    const r = distributeRewards(floor, enc.isBoss);
    if (firstTime) S().stats.floorsCleared += 1;
    processImmortals(true);
    if (activeTab === 'battle') {
      UI.logLine(challenging
        ? `★ FLOOR ${floor} CLEARED! +${r.stones}石${r.essence ? `, +${r.essence}✦ Immortal Essence` : ''}${dropSummary(r.drops)}`
        : `Cleared F${floor} (+${r.stones}石${r.essence ? `, +${r.essence}✦` : ''})${dropSummary(r.drops)}`, challenging ? 'win' : 'loot');
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
  if (autoChallenge || S().settings.idle || challengeRequested) idleTimer = setTimeout(runBattle, animate ? 350 : 0); // loop
  else if (activeTab === 'battle') UI.render('battle');           // settled: refresh controls + static arena
}

// "Attempt Floor": queue a one-off frontier run. If a run is animating it's picked up next; else now.
function attemptAdvance() {
  if (autoChallenge) return;       // already climbing
  if (!activeTeam().length) return UI.toast('Activate at least one fighter.');
  challengeRequested = true;
  if (battleBusy) return;          // a run is in flight — it will run the challenge next
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
  if (battleBusy) return;          // a run is in flight — it will pick up the climb next
  stopIdle();
  runBattle();
}

// ---------- offline progress ----------
function applyOffline() {
  const elapsed = Date.now() - (S().lastSave || Date.now());
  const capped = Math.min(elapsed, 8 * 3600 * 1000);
  if (capped < 8000 || !activeTeam().length) return null;
  const enc = generateEncounter(S().farmFloor);
  // sample fights for win rate AND average run duration, then estimate runs over the idle window
  let wins = 0, totalMs = 0;
  for (let i = 0; i < 5; i++) { const r = resolveEncounter(enc); if (r.win) wins++; totalMs += fightWallMs(r.simTime); }
  const rate = wins / 5; if (rate < 0.2) return null;
  const avgMs = Math.max(700, totalMs / 5);
  const eff = Math.floor((capped / avgMs) * rate);
  if (eff < 1) return null;
  const r = rollFloorRewards(S().farmFloor, enc.isBoss);
  const stones = r.stones * eff;
  const ess = Math.round(eff * farmEssenceEV(S().farmFloor, enc.isBoss));
  S().stones += stones; S().essence += ess;
  // (no cultivation XP — breakthroughs are now stone purchases made manually, not auto-leveled)
  return { eff, stones, ess, hours: (elapsed / 3600000).toFixed(1) };
}

// ---------- lifecycle ----------
function startIdle() { if (S() && S().settings.idle && !battleBusy && !idleTimer) idleTimer = setTimeout(runBattle, 0); }
function stopIdle() { if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; } } // an in-flight run finishes, then won't reschedule

// Legacy saves predate the attribute system: auto-allocate a balanced pool so existing teams keep
// their power (they can't reclaim it — no respec — but they won't be crippled). New characters carry
// an explicit zero `attrs` object, so this only fires for pre-attribute saves.
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
  autoChallenge = false; autoChallengeHighest = 0; challengeRequested = false; UI.setAutoChallenge(false);
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
  UI.showModal(`<h3>While you cultivated away…</h3>
    <div class="body">Over ~<b>${off.hours}h</b> your team auto-farmed Floor ${S().farmFloor}:<br>
    • Won <b style="color:var(--jade)">${off.eff}</b> encounters<br>
    • Gathered <b style="color:var(--stone)">${off.stones.toLocaleString()} primeval stones</b> and <b style="color:var(--jade)">${off.ess.toLocaleString()} ✦</b><br>
    • Advanced cultivation.</div>
    <div class="right"><button class="primary" onclick="G.closeModal()">Continue</button></div>`);
  UI.refreshTop();
}

function renderTitle() {
  const host = document.getElementById('slots'); host.innerHTML = '';
  listSaves().forEach((sv, i) => {
    const div = document.createElement('div'); div.className = 'slot';
    if (sv) {
      div.innerHTML = `<div><div class="nm">Save ${i + 1} — Frontier Floor ${sv.frontier}</div>
        <div class="meta">${sv.roster.length} cultivators · ${Math.floor(sv.stones).toLocaleString()} 石 · ${Math.floor(sv.essence)} ✦ · ${Object.keys(sv.uniqueClaimed || {}).length} unique Gu</div>
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
  autoChallenge = false; autoChallengeHighest = 0; challengeRequested = false; UI.setAutoChallenge(false);
  save();
  document.getElementById('game').classList.add('hidden');
  document.getElementById('title').classList.remove('hidden');
  renderTitle();
}

// ---------- equip pickers (modals) ----------
function openGuPicker(charId, slotIdx) {
  const c = S().roster.find((x) => x.id === charId); if (!c) return;
  const usedElsewhere = (uid) => S().roster.some((o) => o !== c && o.gu.includes(uid));
  const avail = S().guInv.filter((g) => !c.gu.includes(g.uid) && !usedElsewhere(g.uid));
  let html = `<h3>Equip Gu — ${c.name} · Slot ${slotIdx + 1}</h3>`;
  const cur = c.gu[slotIdx] ? guOf(c.gu[slotIdx]) : null;
  if (cur) html += `<div class="pickrow gu-pick"><div class="gp-info">
      <div class="gp-head"><b style="color:var(--t${cur.tier})">T${cur.tier}</b> <span class="gp-name">Equipped: ${cur.name}</span>
        ${isUnique(cur) ? '<span class="pill unique">UNIQUE</span>' : ''}<span class="gp-path">${pathName(cur.daoPath)}</span></div>
      <div class="gu-eff">${effectText(cur)}</div>
      <div class="gu-ess">◇ ${guEssenceCost(cur)} essence / use</div></div>
    <button class="danger" onclick="G.unequipGu('${charId}',${slotIdx})">Unequip</button></div>`;
  if (!avail.length) html += '<div class="muted small">No spare Gu. Craft some in the Refinery.</div>';
  const tierOf = (g) => g.tier || GU_LIB[g.guId].tier;   // ascended immortals carry an instance tier
  avail.sort((a, b) => tierOf(b) - tierOf(a)).forEach((g) => {
    const gu = guOf(g.uid); if (!gu) return;             // resolved (instance-tier) form, w/ effects
    const t = gu.tier;
    html += `<div class="pickrow gu-pick"><div class="gp-info">
        <div class="gp-head"><b style="color:var(--t${t})">T${t}</b> <span class="gp-name">${gu.name}</span>
          ${isUnique(gu) ? '<span class="pill unique">UNIQUE</span>' : ''}<span class="gp-path">${pathName(gu.daoPath)}</span></div>
        <div class="gu-eff">${effectText(gu)}</div>
        <div class="gu-ess">◇ ${guEssenceCost(gu)} essence / use</div></div>
      <button class="primary" onclick="G.equipGu('${charId}',${slotIdx},'${g.uid}')">Equip</button></div>`;
  });
  html += `<div class="right"><button onclick="G.closeModal()">Close</button></div>`;
  UI.showModal(html);
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
  // Refinery boolean filters: "guCraftable" (craftable-now only) / "guUnlocked" (unlocked paths only).
  toggleGuFlag(key) { S().settings[key] = !S().settings[key]; UI.render(activeTab); save(); },
  clearGuFilters() { const s = S().settings; s.guTier = 'all'; s.guPath = 'all'; s.guCraftable = false; s.guUnlocked = false; UI.render(activeTab); save(); },
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
  clearAlmanacFilters() { S().settings.almRarity = 'all'; S().settings.almPath = 'all'; UI.render(activeTab); save(); },
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
  toggleIdle() { if (autoChallenge) return; S().settings.idle = !S().settings.idle; if (S().settings.idle) startIdle(); else stopIdle(); UI.renderBattleControls(); save(); },
  attemptAdvance,
  toggleAutoChallenge,
  setFarm(f) {
    // only cleared/beaten floors (1 .. frontier-1) are farmable; floor 1 is the bootstrap target
    f = Math.max(1, Math.min(Math.max(1, S().frontier - 1), f));
    if (f === S().farmFloor) return;
    S().farmFloor = f;
    UI.renderBattleControls();                                    // update controls without clobbering an in-flight animation
    if (!battleBusy && activeTab === 'battle') UI.renderArena();  // refresh the static enemy preview when idle
    UI.toast('Now farming Floor ' + f); save();
  },
  pull(n) { const r = pull(n); if (!r.ok) return UI.toast(r.msg); UI.render('recruit'); UI.renderPulls(r.got); save(); },
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
  buyBoon(key) {
    const r = buyBoon(key);
    if (!r.ok) return UI.toast(r.msg);
    UI.toast(`${key} boon → Lv ${r.level}.`); UI.render('dao');
  },
  reincarnatePrompt() {
    UI.showModal(`<h3>Reincarnate?</h3>
      <p class="muted">This severs your current life — floors, roster, Gu, resources and Dao Marks are all reset. In return you claim about <b>${soulsAward()}</b> Sovereign Souls and keep every permanent boon.</p>
      <div class="row gap" style="margin-top:14px">
        <button class="primary" onclick="G.reincarnateConfirm()">Sever this life</button>
        <button onclick="G.closeModal()">Keep cultivating</button>
      </div>`);
  },
  reincarnateConfirm() {
    const r = reincarnate();
    UI.closeModal();
    if (!r.ok) return UI.toast(r.msg);
    UI.toast(`Reincarnated — +${r.award} Sovereign Souls (${r.souls} total).`);
    G.setTab('battle'); UI.refreshTop(); save();
  },
  craft(guId) { const r = craft(guId); UI.toast(r.ok ? `Refined ${r.gu.name}.` : r.msg); UI.render('gu'); save(); },
  // Ascend an OWNED immortal Gu one rank (consumes stones + that rank's resources; resolveOwned then
  // surfaces the stronger form). Re-renders the active view (usually the character sheet) + top bar.
  upgradeGu(uid) {
    const r = upgrade(uid);
    UI.toast(r.ok ? `Ascended ${r.gu.name} to Tier ${r.tier}.` : r.msg);
    UI.render(activeTab); UI.refreshTop(); save();
  },
  buyResource(id) { const r = buyResource(id, 1); UI.toast(r.ok ? 'Purchased.' : r.msg); if (r.ok) UI.render('shop'); UI.refreshTop(); save(); },
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
    UI.toast(r.msg); if (activeTab === 'battle') UI.logLine(r.msg, r.ascended ? 'win' : 'lose');
    UI.render(activeTab === 'battle' ? 'dao' : activeTab); save();
  },
  // Spend 石 on a fallible mortal breakthrough. Success → realm up (new attribute points); failure →
  // stones spent + a short temporary injury (see systems/cultivation.js attemptBreakthrough).
  attemptBreakthrough(id) {
    const r = attemptBreakthrough(id);
    if (!r.ok) return UI.toast(r.msg);
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
    UI.toast(r.msg); if (activeTab === 'battle') UI.logLine(r.msg, r.ascended ? 'win' : 'lose');
    UI.render(activeTab === 'battle' ? 'dao' : activeTab); save();
  },
  openGuPicker,
  equipGu(charId, slot, uid) { const c = S().roster.find((x) => x.id === charId); c.gu[slot] = uid; UI.closeModal(); UI.render(activeTab === 'battle' ? 'team' : activeTab); save(); },
  unequipGu(charId, slot) { const c = S().roster.find((x) => x.id === charId); c.gu.splice(slot, 1); UI.closeModal(); UI.render(activeTab === 'battle' ? 'team' : activeTab); save(); },
  // One-time bonus for completing EVERY First-Steps tutorial goal. Idempotent — the persistent
  // onboarding.rewarded flag guards it, so re-arming the guide (or repeated renders) can't farm it.
  // Fires from UI.render (manual final steps) and the battle-win path (finishing via idle farming);
  // self-checks completion so the extra call sites are harmless. Independent of the widget's
  // `dismissed` state — dismissing the checklist never forfeits the reward.
  claimOnboardingReward() {
    const o = S() && S().onboarding;
    if (!o || !o.active || o.rewarded || !UI.onboardingComplete()) return;
    o.rewarded = true;
    const amt = 450;
    S().essence += amt;
    UI.banner(`<span class="cjk b-seal">道</span><span class="b-text"><b>First Steps complete</b><span class="b-sub">+${amt} <span class="essence">✦</span> Immortal Essence</span></span>`, 'reward');
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
  closeModal: UI.closeModal,
};
window.G = G;

// ---------- boot ----------
window.addEventListener('load', () => {
  renderTitle();
  setInterval(() => { if (S()) save(); }, 20000); // autosave heartbeat
});
