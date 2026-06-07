// UI layer. Renders tabs from state and provides the battle feed, arena, toasts and modal.
// Event handlers are invoked via the global `G` object defined in main.js (onclick="G.foo()").
import { S, activeTeam, rowOf, laneOf, frontTeam, backTeam, LANES, tileOccupant, save } from './state.js';
import { effectiveStats, guOf, breakthroughCost, breakthroughChance, breakthroughFloorReq } from './systems/cultivation.js';
import { GU_LIB, guList, effectText, isUnique, guEssenceCost, guEssenceCostFor, guUsingResource, guTags, tagLabel, nextTierOf, starterGusForPath, signatureImmortalGu, signatureGusForPath, pathStatuses } from './data/gu.js';
import { RESOURCES, resourceList, resourceName, rankRarity } from './data/resources.js';
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const rankColor = (rank) => rarityColor(rankRarity(rank)); // a rank's colour = its derived rarity's colour
import { rarityColor, RARITY_ORDER, rarityTier } from './data/rarities.js';
import { realmName, realmClass } from './data/realms.js';
import { PULL_COST, PULL_COST_10, PITY_CAP, pityCount } from './systems/gacha.js';
import { prestige, BOONS, boonCost, boonLevel, canReincarnate, soulsAward } from './systems/prestige.js';
import { canCraft, refineSpec, canUpgrade } from './systems/crafting.js';
import { resourceCost, dropEstimate, shopResources, highestRosterRank, marketUnlocked } from './systems/economy.js';
import { generateEncounter, isBossFloor, encounterSize, floorRealm, FLOORS_PER_REALM } from './data/floors.js';
import { GAUGE_MAX, PLAYBACK_MS } from './systems/battle.js';
import { PATH, pathList, pathName, pathColor, pathCjk, commOf, CATEGORY_LABELS, isPathLocked, pathFloorReq, PATH_AFFINITY } from './data/daoPaths.js';
import { apertureCap, apertureUsed, apertureFree, attainmentIn, marksIn, attainmentOf, ATTAINMENT, comprehensionLevelIn, comprehensionCap, compPointsIn, markAmp, dominantPath, injuryRemainingMs } from './systems/dao.js';
import { affinityPaths, affinityName, AFFINITY_EFFECT_MULT, AFFINITY_COMP_MULT, lineOf, LINES, lineName, lineRole, lineCjk, lineBlurb, LINE_ORDER, lineTierEffects, lineEffects, lineGuAmp, lineEffectList, auraEffectList, allyAuraSummary, enemyWaveAura } from './data/traits.js';
import { TRIBS_NEEDED, TRIB_THRESHOLD, ASCEND_COST, pending, canAscend, canBecomeVenerable, tierForRank } from './systems/tribulation.js';
import { isImmortalRealm, MORTAL_PEAK, rankOf, guSlotsOf } from './data/realms.js';
import { ATTR_KEYS, effAttr, unspentPoints, playerPool, apertureCapacity, apertureGrade, effAptitude, imprintAttrMult } from './data/attributes.js';
import { imprintCandidates, IMPRINT_CAP, duplicateGroups, imprintableDuplicateCount } from './systems/gacha.js';
import { STATUS } from './data/status.js';
import * as Audio from './systems/audio.js';

const $ = (id) => document.getElementById(id);
const ATTR_LABEL = { str: 'STR', agi: 'AGI', con: 'CON', int: 'INT', luck: 'LCK' };
const ATTR_FULL = { str: 'Strength → ATK, Crit Dmg, Armor Pen', agi: 'Agility → Speed, Evasion, Hit', con: 'Constitution → HP, DEF, Resist, Regen', int: 'Intelligence → Potency, Essence', luck: 'Luck → Crit, Lucky Hit, drops' };
const ATTR_DESC = { str: 'ATK · Crit Dmg · Pen', agi: 'Speed · Evasion · Hit', con: 'HP · DEF · Resist · Regen', int: 'Potency · Essence', luck: 'Crit · Lucky · Drops' };
const pct = (x) => Math.round((x || 0) * 100) + '%';
const fmt = (n) => Math.floor(n).toLocaleString();
const esc = (s) => String(s).replace(/"/g, '&quot;');

// CJK glyph that represents a character: demon mark for the player, else their dominant Dao path.
function charGlyph(c) {
  if (c.isPlayer) return '魔';
  const p = dominantPath(c);
  return p ? pathCjk(p) : '蛊';
}

// Editorial page header (per tab): blood seal + eyebrow + uppercase title + italic sub.
function pagehead(cjk, eyebrow, title, sub) {
  return `<div class="pagehead">
    <div class="seal">${cjk}</div>
    <div><div class="ph-eyebrow">${eyebrow}</div><h1>${title}</h1>
      <div class="ph-sub">${sub}</div></div>
  </div>`;
}
// Section header with a CJK numeral (零壹貳參肆伍陸柒…).
const SEC_NUM = ['零', '壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖', '拾'];
function secHead(n, title, meta = '') {
  return `<div class="sec-head"><span class="sec-num">${SEC_NUM[n] || n}</span>
    <span class="sec-title">${title}</span>${meta ? `<span class="sec-meta">${meta}</span>` : ''}</div>`;
}

// ---------- top bar ----------
export function refreshTop() {
  $('t-stones').textContent = fmt(S().stones);
  $('t-essence').textContent = fmt(S().essence);
  $('t-frontier').textContent = 'Floor ' + S().frontier;
  $('t-roster').textContent = S().roster.length;
  $('t-unique').textContent = Object.keys(S().uniqueClaimed).length;
  // nav alert: how many ACTIVE fighters have unspent attribute points to distribute
  const n = activeTeam().filter((c) => unspentPoints(c) > 0).length;
  const badge = $('team-alert');
  if (badge) { badge.textContent = n ? (n > 99 ? '99+' : '' + n) : ''; badge.classList.toggle('on', n > 0); }
  // nav alert: how many duplicate sets are sitting in the roster ready to Soul Imprint
  const d = imprintableDuplicateCount();
  const dup = $('dup-alert');
  if (dup) { dup.textContent = d ? (d > 99 ? '99+' : '' + d) : ''; dup.classList.toggle('on', d > 0); }
}

// The audio settings popup (opened by the bottom-left gear FAB). Independent BGM + SFX level bars
// (0–10) plus a mute checkbox each that overrides — and disables — its bar. Reads live state from the
// audio engine; the G.* handlers update the engine + these controls in place (no full re-render).
export function settingsModal() {
  const bgm = Audio.getBgm(), sfx = Audio.getSfx(), bm = Audio.isBgmMuted(), sm = Audio.isSfxMuted();
  const row = (key, label, val, muted) => `
    <div class="set-row">
      <span class="set-label">${label}</span>
      <span class="set-slider">
        <input id="set-${key}" type="range" min="0" max="10" step="1" value="${val}" ${muted ? 'disabled' : ''}
          oninput="G.set${key === 'bgm' ? 'Bgm' : 'Sfx'}(this.value)">
        <span class="set-val" id="set-${key}-val">${muted ? '—' : val}</span>
      </span>
      <label class="set-mute"><input type="checkbox" ${muted ? 'checked' : ''}
        onchange="G.set${key === 'bgm' ? 'Bgm' : 'Sfx'}Mute(this.checked)">Mute</label>
    </div>`;
  return `<h3>⚙ Settings</h3>
    <div class="body" style="margin-bottom:6px">Audio — drag a bar (0–10), or tick <b>Mute</b> to silence that channel.</div>
    ${row('bgm', 'BGM', bgm, bm)}
    ${row('sfx', 'SFX', sfx, sm)}
    <div class="right" style="margin-top:16px"><button class="primary" onclick="G.closeModal()">Done</button></div>`;
}

// ---------- tab router ----------
let _charId = null; // character whose sheet is open (pseudo-tab 'char')
export function openCharSheet(id) { _charId = id; render('char'); }
export function currentCharId() { return _charId; } // last-viewed sheet, for the nav's Character button
let _resId = null; // resource whose detail page is open (pseudo-tab 'res')
export function openResSheet(id) { _resId = id; render('res'); }
let _lastViewKey = null;
export function render(tab) {
  refreshTop();
  Audio.setTheme(tab); // each sidebar view has its own musical mood (no-op if unchanged). See systems/audio.js THEMES
  const c = $('content');
  const views = {
    battle: viewBattle, team: viewTeam, formation: viewFormation, recruit: viewRecruit,
    gu: viewGu, shop: viewShop, inv: viewInventory, floors: viewFloors, codex: viewCodex, dao: viewDao,
    attainment: viewAttainment, almanac: viewAlmanac, res: () => viewResource(_resId),
    char: () => viewCharacter(_charId),
  };
  // Rebuilding #content's innerHTML resets its scroll. Keep the user where they were on an IN-PLACE
  // refresh (same page — e.g. distributing attribute points, equipping a Gu), but jump to the top when
  // the view genuinely changes (tab switch, opening a different character/resource).
  const key = `${tab}:${tab === 'char' ? _charId : tab === 'res' ? _resId : ''}`;
  const keepScroll = key === _lastViewKey;
  const prevScroll = c ? c.scrollTop : 0;
  c.innerHTML = (views[tab] || viewBattle)();
  if (tab === 'battle') { renderArena(); renderLog(); }
  c.scrollTop = keepScroll ? prevScroll : 0;
  _lastViewKey = key;
  maybeShowTip(tab);   // first-visit tab tip (new players only)
  renderOnboard();     // floating First-Steps widget (new players only)
  if (window.G && window.G.claimOnboardingReward) window.G.claimOnboardingReward(); // one-time tutorial-complete bonus
}

// ================= ONBOARDING: First-Steps widget + first-visit tab tips =================
// Both are gated on state.onboarding.active (true only for genuinely new games; migrateSave marks every
// pre-existing save inactive). Step completion is DERIVED LIVE from state — no per-step flags persist;
// only `dismissed` (widget closed) and `tipsSeen` (per-tab) are saved. Hooked from render() above.
const onbPlayer = () => S().roster.find((c) => c.isPlayer) || S().roster[0];
const ONBOARD_STEPS = [
  { id: 'allocate', label: 'Allocate your attribute points', go: 'G.openCharTab()',
    hint: 'Open your sheet and pour points into STR / AGI / CON / INT / LCK.',
    done: () => { const p = onbPlayer(); return !!p && ATTR_KEYS.some((k) => (p.attrs && p.attrs[k]) > 0); } },
  { id: 'equip', label: 'Equip your starter Gu', go: 'G.openCharTab()',
    hint: 'On your sheet, click an empty Gu slot and equip the Gu you chose at the start.',
    done: () => { const p = onbPlayer(); return !!p && (p.gu || []).some(Boolean); } },
  { id: 'clear1', label: 'Win your first battle (clear Floor 1)', go: "G.setTab('battle')",
    hint: 'Idle farm runs on its own — or press ⚔ Attempt Floor.',
    done: () => S().stats.wins > 0 },
  { id: 'recruit', label: 'Recruit a fellow cultivator', go: "G.setTab('recruit')",
    hint: 'Spend ✦ Immortal Essence to summon an ally.',
    done: () => S().roster.length > 1 },
  { id: 'refine', label: 'Refine your first Gu', go: "G.setTab('gu')",
    hint: 'Gather a path’s resources (floor drops / the Market), then craft in the Refinery.',
    done: () => S().stats.crafts > 0 },
  { id: 'breakthrough', label: 'Attempt your first breakthrough', go: 'G.openCharTab()',
    hint: 'Spend 石 to push to the next realm stage (a fallible roll — re-attempt if it fails).',
    done: () => { const p = onbPlayer(); return !!p && p.realm > 0; } },
];
const TAB_TIPS = {
  battle: 'Your team fights on its own. Idle-farm a cleared floor, or press ⚔ Attempt Floor to push your frontier.',
  char: 'A cultivator’s sheet: spend attribute points, equip or swap Gu in the loadout slots, and buy breakthroughs here.',
  team: 'Your roster and who’s active. A red badge on the tab means someone has unspent attribute points.',
  formation: 'Drag fighters onto the 2×5 board. A front-row unit shields the back-liner in its own lane until it falls.',
  recruit: 'Spend ✦ Immortal Essence to summon cultivators across six rarities. Pity guarantees a rare pull eventually.',
  gu: 'Craft Gu from primeval stones + that path’s resources. Higher tiers refine from spare same-path Gu one tier lower.',
  dao: 'Comprehension grows by fighting with a path’s Gu; immortals gather Dao Marks from tribulations. Ascend here.',
  attainment: 'Your standing in each Dao path — comprehension levels and the gates they unlock.',
  shop: 'The Market sells resources you’ve unlocked (by cleared floors + your roster’s rank) for primeval stones.',
  inv: 'Everything you own — your Gu and crafting resources.',
  almanac: 'A catalogue of every resource: where it drops and what it crafts.',
  floors: 'The 450-floor tower: 9 realms × 50 floors, a boss every 10th. Every enemy on a floor shares its realm band.',
  codex: 'Your full beginner’s guide — stats, realms, breakthroughs, the Market and Gu refining, all explained here.',
};
function maybeShowTip(tab) {
  const o = S() && S().onboarding;
  if (!o || !o.active) return;
  const tip = TAB_TIPS[tab];
  if (!tip || (o.tipsSeen && o.tipsSeen[tab])) return;
  (o.tipsSeen || (o.tipsSeen = {}))[tab] = true;
  toast(tip, 7000, 'tip');
  save();
}
export function renderOnboard() {
  const host = $('onboard-host'); if (!host) return;
  const o = S() && S().onboarding;
  if (!o || !o.active || o.dismissed) { host.innerHTML = ''; return; }
  const isDone = (s) => { try { return !!s.done(); } catch { return false; } };
  const doneCount = ONBOARD_STEPS.filter(isDone).length;
  if (doneCount >= ONBOARD_STEPS.length) { host.innerHTML = ''; return; } // all complete → widget retires
  const firstPending = ONBOARD_STEPS.findIndex((s) => !isDone(s));
  const rows = ONBOARD_STEPS.map((s, i) => {
    const ok = isDone(s), cur = !ok && i === firstPending;
    return `<div class="onboard-step ${ok ? 'done' : cur ? 'current' : 'pending'}">
        <span class="ob-mark">${ok ? '✓' : '○'}</span><span class="ob-label">${s.label}</span>
        ${cur ? `<button class="ob-go" onclick="${s.go}">Go →</button>` : ''}
      </div>${cur ? `<div class="ob-hint">${s.hint}</div>` : ''}`;
  }).join('');
  host.innerHTML = `<div class="onboard-widget">
    <div class="ob-head"><span class="cjk ob-seal">道</span><span class="ob-title">Path of Cultivation</span>
      <span class="ob-prog">${doneCount}/${ONBOARD_STEPS.length}</span>
      <button class="ob-x" title="Dismiss" onclick="G.dismissOnboard()">✕</button></div>
    <div class="ob-steps">${rows}</div>
    <div class="ob-foot"><button class="ob-guide" onclick="G.setTab('codex')">☰ New here? Read the full guide</button></div></div>`;
}
// True once EVERY First-Steps goal is met — drives the one-time tutorial-completion reward (main.js
// claimOnboardingReward). Independent of the widget's `dismissed` state, so dismissing it never forfeits
// the bonus. Same per-step `done()` predicates renderOnboard uses, so the two never disagree.
export function onboardingComplete() {
  const o = S() && S().onboarding;
  if (!o) return false;
  return ONBOARD_STEPS.every((s) => { try { return !!s.done(); } catch { return false; } });
}

// ================= NEW-GAME STARTER CHOICE: Dao path → first Gu =================
// Step 2 of new game (after naming): pick one common Dao path, shown as a sell-sheet (description, what it
// excels at, the affinity it grants, and the signature immortal Gu it leads to). Called by main.js.
// Short descriptor for a battle status — used in the path picker's "Inflicts" chip tooltips.
function statusBlurb(type) {
  const d = STATUS[type]; if (!d) return '';
  if (d.dot === 'casterAtk') return 'damage over time, scaling with your ATK';
  if (d.dot === 'targetMaxHp') return "bleeds a % of the victim's max HP each action";
  if (d.debuff === 'spd') return 'slows the victim (−speed)';
  if (d.debuff === 'atk') return 'weakens the victim (−attack)';
  if (d.debuff === 'def') return 'sunders armor (−defense)';
  if (d.debuff === 'taken') return 'victim takes more damage (frail)';
  if (type === 'frozen') return 'freezes — skips a turn; shattered early by fire';
  if (d.stun) return 'stuns — skips a turn';
  return '';
}
export function starterPathPicker() {
  const paths = pathList().filter((p) => !isPathLocked(p.id) && pathFloorReq(p.id) <= 50);
  const cards = paths.map((p) => {
    const col = pathColor(p.id);
    const excel = (PATH_AFFINITY[p.id] || []).map((k) => tagLabel(k)).join(' · ');
    const stats = pathStatuses(p.id);
    const inflicts = stats.length
      ? `<div class="sp-inflicts"><span class="sp-k">Inflicts</span> ${stats.map((t) =>
          `<span class="statchip" style="border-color:${col}77;color:${col}" title="${(STATUS[t] && STATUS[t].label) || t} — ${statusBlurb(t)}">${(STATUS[t] && STATUS[t].label) || t}</span>`).join('')}</div>`
      : `<div class="sp-inflicts"><span class="sp-k">Inflicts</span> <span class="muted">no status — a pure stat &amp; utility path</span></div>`;
    const arsenal = signatureGusForPath(p.id);
    const arsenalHtml = arsenal.length
      ? `<div class="sp-arsenal"><div class="sp-k">Signature & status Gu · pursue toward</div>
          <ul class="sp-gulist">${arsenal.map((g, i) =>
            `<li${i === 0 ? ' class="cap"' : ''}><b style="color:var(--t6)">${g.name}</b><span class="muted tiny">${effectText(g)}</span></li>`).join('')}</ul></div>`
      : '';
    return `<div class="starter-path" onclick="G.starterPath('${p.id}')" title="Choose ${pathName(p.id)}">
      <div class="sp-head"><span class="cjk sp-seal" style="color:${col}">${pathCjk(p.id)}</span>
        <span class="sp-name">${pathName(p.id)}</span><span class="pill">${commOf(p.id).label}</span></div>
      <div class="sp-blurb">${PATH(p.id).blurb}</div>
      <div class="sp-excel"><span class="sp-k">Excels at</span> ${excel}</div>
      ${inflicts}
      <div class="sp-grants"><span class="sp-k">Grants</span> ${affinityName(p.id)} <span class="muted tiny">+${Math.round((AFFINITY_EFFECT_MULT - 1) * 100)}% effect · +${Math.round((AFFINITY_COMP_MULT - 1) * 100)}% comprehension</span></div>
      ${arsenalHtml}
    </div>`;
  }).join('');
  return `<h3>Choose your Dao Path</h3>
    <div class="body"><div class="muted small">The foundation of your cultivation. You'll gain this path's <b>Dao Affinity</b> and begin with one of its Gu — and its resources will be the first you can craft with. Each card previews what the path excels at, the statuses its Gu inflict, and the immortal artifacts it leads toward.</div></div>
    <div class="starter-grid">${cards}</div>
    <div class="right"><button onclick="G.closeModal()">Cancel</button></div>`;
}
// Step 3: pick a rank-1 Gu of the chosen path (a curated, thematic handful — see gu.starterGusForPath).
export function starterGuPicker(pathId) {
  const col = pathColor(pathId);
  const cards = starterGusForPath(pathId).map((g) => `
    <div class="starter-gu" onclick="G.starterGu('${g.id}')" title="Begin with ${g.name}">
      <div class="sg-head"><b class="tierbadge" style="color:var(--t1);border-color:var(--t1)">T1</b><b class="sg-name">${g.name}</b></div>
      <div class="gu-eff">${effectText(g)}</div>
      <div class="gu-ess">◇ ${guEssenceCost(g)} essence / use</div>
    </div>`).join('');
  return `<h3>Choose your first Gu — <span class="cjk" style="color:${col}">${pathCjk(pathId)}</span> ${pathName(pathId)}</h3>
    <div class="body"><div class="muted small">A rank-1 Gu to begin with. You'll equip it from your Character sheet — the First-Steps guide walks you through it. You can craft and refine many more later.</div></div>
    <div class="starter-grid gu">${cards || '<div class="muted small">No starter Gu for this path.</div>'}</div>
    <div class="right"><button onclick="G.starterBack()">← Back</button></div>`;
}

// Step 4: pick an ARCHETYPE line — granted to the player at their (Epic) rarity. Each card shows the
// line's FULL rarity ladder (Common → Immortal) with the Epic tier the player will gain highlighted, so
// you can see both what you get now and how the archetype scales (recruits of the same line use these too).
const PLAYER_RARITY = 'Epic'; // mirrors state.js newGame() → makeCharacter(name, 'Epic', true)
// Thematic accent colour per line (a UI flourish so the grid isn't a wall of one hue, like the path seals).
const LINE_ACCENT = {
  vanguard: '#c96a4a', slayer: '#d8504a', assassin: '#8a6fb0', tempest: '#5aa7d8', wall: '#9aa39a',
  reaver: '#b03a45', afflictor: '#74c0a0', foundation: '#c79a45', fortune: '#d8a64a', adept: '#b07ad8',
  warden: '#5a8fb0', commander: '#c2b08a', mender: '#6fb08a',
};
export function starterArchetypePicker() {
  const cards = LINE_ORDER.map((id) => {
    const acc = LINE_ACCENT[id] || 'var(--blood)';
    const ladder = RARITY_ORDER.map((r) => {
      const effs = lineTierEffects(id, r);
      const you = r === PLAYER_RARITY;
      return `<div class="arch-row${you ? ' you' : ''}">
        <span class="arch-rar" style="color:${rarityColor(r)}">${r}</span>
        <span class="arch-eff">${effs.length ? effs.join(' · ') : '<span class="muted">—</span>'}</span>
        ${you ? '<span class="arch-you">yours</span>' : ''}</div>`;
    }).join('');
    return `<div class="starter-arch" style="--acc:${acc}" onclick="G.starterArchetype('${id}')" title="Become ${LINES[id].name}">
      <div class="sp-head"><span class="cjk sp-seal" style="color:${acc}">${lineCjk(id)}</span>
        <span class="sp-name">${LINES[id].name}</span><span class="pill">${lineRole(id)}</span></div>
      <div class="sp-blurb">${lineBlurb(id)}</div>
      <div class="arch-ladder">${ladder}</div>
    </div>`;
  }).join('');
  return `<h3>Choose your Archetype</h3>
    <div class="body"><div class="muted small">Your combat calling — a permanent trait stamped onto your cultivator. You'll gain it at <b style="color:${rarityColor(PLAYER_RARITY)}">${PLAYER_RARITY}</b> rarity (the <b>yours</b> row in each card); the rest of the ladder shows how the archetype scales with rarity. Pick the role that fits how you mean to fight.</div></div>
    <div class="starter-grid arch">${cards}</div>
    <div class="right"><button onclick="G.starterArchetypeBack()">← Back</button></div>`;
}

// ---------- battle / farm ----------
let LOG = [];
let liveArena = null; // { allies:[{name,hp,max}], foes:[{name,hp,max}] }

// Auto-challenge running state — owned by main.js's loop, mirrored here so the control bar can render
// it (the UI stays a pure reader; main.js calls setAutoChallenge() when the mode flips).
let autoChallengeOn = false;
export function setAutoChallenge(v) { autoChallengeOn = !!v; }

// Battle control bar — its own function + id so it can refresh (idle toggle, farm floor, team count)
// WITHOUT rebuilding the arena and clobbering an in-flight animation. See renderBattleControls().
function battleControls() {
  const idle = S().settings.idle;
  const auto = autoChallengeOn;
  const frontierBoss = isBossFloor(S().frontier);
  const dis = auto ? 'disabled' : '';
  return `
    <span class="tag ${idle ? 'on' : ''}">Idle Farm · ${idle ? 'Running' : 'Paused'}</span>
    <button onclick="G.toggleIdle()" ${dis}>${idle ? 'Pause' : 'Resume'} Farm</button>
    <span class="tag">Farm Floor</span>
    <button onclick="G.setFarm(${S().farmFloor - 1})" ${auto || S().farmFloor <= 1 ? 'disabled' : ''}>−</button>
    <span class="pill" style="min-width:64px;text-align:center">Floor ${S().farmFloor}${isBossFloor(S().farmFloor) ? ' ★' : ''}</span>
    <button onclick="G.setFarm(${S().farmFloor + 1})" ${auto || S().farmFloor >= Math.max(1, S().frontier - 1) ? 'disabled' : ''}>+</button>
    <span class="ctl-sep"></span>
    <button class="primary" onclick="G.attemptAdvance()" ${dis}>⚔ Attempt Floor ${S().frontier}${frontierBoss ? ' · BOSS' : ''}</button>
    <button class="${auto ? 'danger' : 'primary'}" onclick="G.toggleAutoChallenge()">${auto ? '■ Stop Auto-Challenge' : '⚔⚔ Auto-Challenge'}</button>
    ${auto ? '<span class="tag auto">Auto · Climbing the Tower</span>' : ''}
    <span class="pill">${activeTeam().length}/6 active</span>`;
}
export function renderBattleControls() { const c = $('battle-ctl'); if (c) c.innerHTML = battleControls(); }
export function viewBattle() {
  return `${pagehead('战', 'Auto-Battler · 演武', 'The Arena',
    'Your team (max 6) fights on its own. The front row shields the back until it falls; each fighter acts when its movement gauge fills — higher SPD means more frequent turns. Idle-farm any cleared floor, assault the frontier once, or <b>Auto-Challenge</b> to climb floor after floor until you fall.')}
  <div class="ctl" id="battle-ctl">${battleControls()}</div>
  <div class="battle-stack">
    <div class="arena">
      <div class="arena-top">
        <div class="bside ally"><span class="side-lbl">Your Team</span><div class="bgrid ally" id="side-A"></div></div>
        <div class="bvs">⚔</div>
        <div class="bside foe"><span class="side-lbl">Enemies</span><div class="bgrid foe" id="side-B"></div></div>
      </div>
      <div class="arena-meta">
        <span class="arena-floor" id="arena-floor">塔 Floor 1</span>
        <span class="wave-indicator" id="wave-ind">Wave 1 of 1</span>
      </div>
      <div class="arena-panels">
        <div class="trait-panel ally" id="traits-A"></div>
        <div class="trait-panel foe" id="traits-B"></div>
      </div>
    </div>
    <div class="feedwrap">
      <div class="feed-head"><span class="side-lbl">Combat Feed</span><span class="muted tiny">newest at the top · scroll for history</span></div>
      <div class="log" id="log"></div>
    </div>
  </div>`;
}

const pctHp = (hp, max) => Math.max(0, Math.min(100, (100 * hp) / (max || 1)));
const compact = (n) => {
  n = Math.round(n);
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e4) return (n / 1e3).toFixed(0) + 'K';
  return '' + n;
};
// Grid position of a unit's tile. Player faces right (Front column toward centre), enemy faces left.
function tileStyle(side, row, lane) {
  const col = side === 'ally' ? (row === 'front' ? 2 : 1) : (row === 'front' ? 1 : 2);
  return `grid-row:${(lane | 0) + 1};grid-column:${col}`;
}
const pctEss = (u) => (u.essMax ? Math.max(0, Math.min(100, (100 * (u.ess != null ? u.ess : u.essMax)) / u.essMax)) : 0);
// Arena status palette: short badge label + colour per status (used for the on-block badges, the
// floating "inflicted" popups, and the distinct Burn/Poison/Bleed DoT numbers).
const STATUS_UI = {
  burn:   { abbr: 'BRN', color: '#ff7a3c' },
  poison: { abbr: 'PSN', color: '#7bdc5a' },
  bleed:  { abbr: 'BLD', color: '#ff5a6a' },
  slow:   { abbr: 'SLW', color: '#5aa9e6' },
  weaken: { abbr: 'WKN', color: '#b79bff' },
  sunder: { abbr: 'SND', color: '#e0a23c' },
  frail:  { abbr: 'FRL', color: '#ef82c6' },
  stun:   { abbr: 'STN', color: '#e8c777' },
  frozen: { abbr: 'FRZ', color: '#8fd9ff' },
};
// Archetype-LINE palette: a single CJK seal glyph + colour per trait line, for the on-block trait seal
// and the per-side Auras & Traits panel. Keys match data/traits.js LINES ids.
const LINE_UI = {
  wall:      { glyph: '盾', color: '#6fa8dc' }, // shield  — tank
  vanguard:  { glyph: '锋', color: '#e0a23c' }, // edge    — bruiser
  slayer:    { glyph: '杀', color: '#ff5a6a' }, // kill    — carry
  assassin:  { glyph: '刺', color: '#b79bff' }, // stab    — crit
  tempest:   { glyph: '风', color: '#5aa9e6' }, // wind    — tempo
  afflictor: { glyph: '毒', color: '#7bdc5a' }, // poison  — debuff
  reaver:    { glyph: '噬', color: '#d4506a' }, // devour  — vampire
  foundation:{ glyph: '基', color: '#c79a45' }, // base    — aperture
  fortune:   { glyph: '运', color: '#f0c84a' }, // luck    — prospector
  adept:     { glyph: '蛊', color: '#9b7bff' }, // gu      — amplifier
  warden:    { glyph: '护', color: '#5ad6c0' }, // protect — support
  commander: { glyph: '令', color: '#ffb347' }, // command — support
  mender:    { glyph: '愈', color: '#7be0a0' }, // heal    — support
};
// Tooltip text for a unit's trait(s): line (tiered name · role) + dao-path affinity name(s).
function traitTitle(line, affinity, rarity) {
  const bits = [];
  if (line && LINES[line]) bits.push(`${lineName(line, rarity)} — ${LINES[line].role}`);
  for (const p of affinity || []) { const n = affinityName(p); if (n) bits.push(n); }
  return bits.join(' · ');
}
// The small corner trait SEAL on a unit block — its archetype line's glyph, tinted. Empty when the unit
// carries no line (early/low-rarity units), so only built characters get a cue.
function traitSeal(u) {
  const ui = LINE_UI[u.line];
  if (!ui) return '';
  return `<span class="ub-trait" style="color:${ui.color};border-color:${ui.color}66" title="${esc(traitTitle(u.line, u.affinity, u.rarity))}">${ui.glyph}</span>`;
}
// Status badge chip (shown on top of a unit block). `n` = instance count (DoTs stack), shown when >1.
const statusChip = (s) => {
  const ui = STATUS_UI[s.t] || { abbr: (s.t || '?').slice(0, 3).toUpperCase(), color: 'var(--muted)' };
  const lbl = STATUS[s.t] ? STATUS[s.t].label : s.t;
  return `<span class="ust" style="color:${ui.color};border-color:${ui.color}66" title="${esc(lbl)}${s.n > 1 ? ' ×' + s.n : ''}">${ui.abbr}${s.n > 1 ? '<b>' + s.n + '</b>' : ''}</span>`;
};
// Soul-Imprint level as compact gold stars (魂印 Lv 1..10). Empty at Lv 0 so it only appears where
// relevant — reused on every character representation (roster, team slots, formation, arena, sheet).
function imprintStars(level, cls = '') {
  const n = level | 0;
  if (n <= 0) return '';
  return `<span class="imp-stars${cls ? ' ' + cls : ''}" title="Soul Imprint Lv ${n} — +${n * 5}% attributes · +${(0.1 * n).toFixed(1)} aptitude">${'★'.repeat(n)}</span>`;
}
function unitBlock(u, side, idx) {
  const row = u.row || 'front';
  const cult = u.kind === 'cultivator';
  // tooltip: rarity · trait line · Gu (so the player can read a foe's gimmick); name tinted by rarity.
  const bits = [];
  if (u.realm != null) bits.push(realmName(u.realm));
  if (u.rarity) bits.push(u.rarity);
  if (u.line && LINES[u.line]) bits.push(lineName(u.line, u.rarity));
  if (u.gu && u.gu.length) bits.push(`Gu: ${u.gu.join(', ')}`);
  const title = bits.length ? ` title="${esc(u.name)} — ${esc(bits.join(' · '))}"` : '';
  const nameStyle = u.rarity ? ` style="color:${rarityColor(u.rarity)}"` : '';
  const essVal = u.ess != null ? u.ess : u.essMax;
  const essBar = u.essMax ? `<div class="ub-bar ess val"><i style="width:${pctEss(u)}%"></i><b class="ub-num">${compact(essVal)}</b></div>` : '';
  const stBadges = (u.statuses || []).map(statusChip).join('');
  return `<div class="ublock ${side === 'foe' ? 'enemy' : ''} ${row === 'back' ? 'back' : ''}${cult ? ' ub-cult' : ''} ${u.hp <= 0 ? 'dead' : ''}" id="ub-${side}-${idx}"${title} style="${tileStyle(side, row, u.lane)}">
    ${traitSeal(u)}
    <div class="ub-status">${stBadges}</div>
    <div class="ub-name"${nameStyle}>${cult ? '◆ ' : ''}${u.name}</div>
    ${imprintStars(u.imprint, 'ub-imp')}
    <div class="ub-bar hp val"><i style="width:${pctHp(u.hp, u.max)}%"></i><b class="ub-num">${compact(Math.max(0, u.hp))}</b></div>
    ${essBar}
    <div class="ub-bar chg"><i style="width:0%"></i></div></div>`;
}
export function setArena(allies, foes) { liveArena = { allies, foes }; renderArena(); }
export function clearArena() { liveArena = null; }
// "Wave X of Y" badge in the arena meta bar (Y=1 for single-wave encounters).
function setWaveIndicator(cur, total) {
  const el = $('wave-ind'); if (!el) return;
  el.textContent = `Wave ${cur} of ${Math.max(1, total)}`;
}
// Which floor the arena is currently showing — the farm floor for the idle preview, or the floor of the
// fight being animated (set via playTimeline's ctx). Sits beside the wave badge in the meta bar.
function setArenaFloor(floor, isBoss) {
  const el = $('arena-floor'); if (!el || floor == null) return;
  el.textContent = `塔 Floor ${floor}${isBoss ? ' · BOSS' : ''}`;
  el.classList.toggle('boss', !!isBoss);
}
export function renderArena() {
  const a = $('side-A'), b = $('side-B'); if (!a || !b) return;
  if (liveArena) {
    a.innerHTML = liveArena.allies.map((u, i) => unitBlock(u, 'ally', i)).join('');
    b.innerHTML = liveArena.foes.map((u, i) => unitBlock(u, 'foe', i)).join('');
    renderTraitPanels(liveArena.allies, allyAurasFor(liveArena.allies), liveArena.foes, []);
    return;
  }
  const allyUnits = activeTeam().map((c) => { const s = effectiveStats(c); return {
    name: c.name, hp: s.maxHp, max: s.maxHp, row: rowOf(c), lane: laneOf(c), essMax: s.essencePool, ess: s.essencePool,
    rarity: c.rarity, realm: c.realm, line: c.line, affinity: affinityPaths(c), guInfo: guInfoFor(c) }; });
  a.innerHTML = allyUnits.map((u, i) => unitBlock(u, 'ally', i)).join('') || '<div class="muted">No active fighters.</div>';
  const enc = generateEncounter(S().farmFloor);
  const foeUnits = enc.waves[0].map((u) => ({
    name: u.name, hp: u.maxHp, max: u.maxHp, row: u.row, lane: u.lane, kind: u.kind, gu: u.gu, essMax: u.essencePool, ess: u.essencePool,
    rarity: u.rarity, realm: u.realm, line: u.line, affinity: u.daoPath ? [u.daoPath] : [], guInfo: u.guInfo || [] }));
  b.innerHTML = foeUnits.map((u, i) => unitBlock(u, 'foe', i)).join('');
  renderTraitPanels(allyUnits, allyAurasFor(allyUnits), foeUnits, enemyWaveAura(enc.waves[0]));
  setWaveIndicator(1, enc.waves.length); // static preview shows the first wave of the farm encounter
  setArenaFloor(S().farmFloor, isBossFloor(S().farmFloor));
}
// Active ally team auras from a list of arena units (each carries line/rarity/realm/name).
const allyAurasFor = (units) => allyAuraSummary(units || []);
// A character's equipped Gu as { name, eff } for the arena traits panel (resolves each uid via guOf).
const guInfoFor = (ch) => ((ch && ch.gu) || []).map((uid) => { const g = guOf(uid); return g ? { name: g.name, eff: effectText(g) } : null; }).filter(Boolean);

// ---- per-side "Auras & Traits" panel ----
// One aura row: seal + line name + source unit + its team-wide effects.
function auraRow(aura) {
  const ui = LINE_UI[aura.lineId] || { glyph: '✦', color: 'var(--brass)' };
  const eff = auraEffectList(aura.bag).join(' · ');
  return `<div class="tp-row tp-aura" title="${esc(aura.name + ' — from ' + aura.source)}">
    <span class="tp-seal" style="color:${ui.color};border-color:${ui.color}66">${ui.glyph}</span>
    <span class="tp-body"><b>${esc(aura.name)}</b> <span class="tp-src">· ${esc(aura.source)}</span>${eff ? `<span class="tp-eff">${esc(eff)}</span>` : ''}</span></div>`;
}
// One cultivator block: archetype-line seal + name, its TIERED line name + affinity, then the unit's
// equipped Gu each with its effect text (from guInfo).
function traitRow(u) {
  const lineNm = (u.line && LINES[u.line]) ? lineName(u.line, u.rarity) : null;
  const aff = (u.affinity || []).map((p) => affinityName(p)).filter(Boolean);
  const tags = [];
  if (lineNm) tags.push(lineNm);
  if (aff.length) tags.push(aff.join(' / '));
  const gu = u.guInfo || [];
  // Always render the cultivator (even with no line/affinity/Gu) so every team member is listed.
  let glyph = '·', color = 'var(--muted)';
  if (u.line && LINE_UI[u.line]) { glyph = LINE_UI[u.line].glyph; color = LINE_UI[u.line].color; }
  else if (u.affinity && u.affinity[0]) { glyph = pathCjk(u.affinity[0]); color = pathColor(u.affinity[0]); }
  // Archetype LINE bonuses: COMBAT lines fold a personal stat bag into the unit (show it here); SUPPORT
  // lines (Warden/Commander/Mender) instead drive a team aura (shown in the Team Auras section above).
  const lo = (u.line && LINES[u.line]) ? { line: u.line, rarity: u.rarity } : null;
  const lineEffs = lo ? lineEffectList(lineEffects(lo)) : [];
  const amp = lo ? lineGuAmp(lo) : 0;
  if (amp) lineEffs.push(`+${Math.round(amp * 100)}% all Gu effect`); // Adept (path-agnostic amplifier)
  const isSupport = !!(lo && LINES[u.line].aura);
  const lineEffHtml = lineEffs.length
    ? `<div class="tp-lineeff" style="color:${color}">${esc(lineEffs.join(' · '))}</div>`
    : (isSupport ? '<div class="tp-lineeff muted">↑ contributes a team aura (above)</div>' : '');
  const guHtml = gu.length
    ? `<ul class="tp-gu">${gu.map((g) => `<li><b>${esc(g.name)}</b><span class="tp-gueff">${esc(g.eff)}</span></li>`).join('')}</ul>`
    : '<div class="tp-nogu">No Gu equipped</div>';
  return `<div class="tp-unit">
    <div class="tp-row tp-trait">
      <span class="tp-seal" style="color:${color};border-color:${color}66">${glyph}</span>
      <span class="tp-body"><b>${esc(u.name)}</b>${(u.imprint || 0) > 0 ? ' ' + imprintStars(u.imprint) : ''}${tags.length ? `<span class="tp-eff">${esc(tags.join(' · '))}</span>` : ''}</span>
    </div>
    ${lineEffHtml}
    ${guHtml}
  </div>`;
}
// Build a side's panel HTML: active auras section (if any) + a per-cultivator section (traits + Gu).
function traitPanelHtml(units, auras) {
  const auraRows = (auras || []).map(auraRow).join('');
  const unitRows = (units || []).filter((u) => u.hp > 0 || u.hp == null).map(traitRow).join('');
  if (!auraRows && !unitRows) return '<div class="tp-empty">No active auras or traits.</div>';
  return `${auraRows ? `<div class="tp-h">Team Auras</div>${auraRows}` : ''}${unitRows ? `<div class="tp-h">Cultivators &amp; Gu</div>${unitRows}` : ''}`;
}
// Repaint both side panels. `foeAuras` is a single enemy-wave aura (object|null) or an array of them.
export function renderTraitPanels(allyUnits, allyAuras, foeUnits, foeAuras) {
  const A = $('traits-A'), B = $('traits-B');
  const foe = Array.isArray(foeAuras) ? foeAuras : (foeAuras ? [foeAuras] : []);
  if (A) A.innerHTML = traitPanelHtml(allyUnits, allyAuras);
  if (B) B.innerHTML = traitPanelHtml(foeUnits, foe.filter(Boolean));
}

// ---- animated timeline playback ----
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Sleep that bails out within ~100ms once abortTimeline() is raised — used for the long gauge-fill wait
// so an interrupting attempt/auto-challenge cancels the animation near-instantly even on slow fights.
async function _sleepAbort(ms) {
  let waited = 0;
  while (waited < ms && !_timelineAbort) { const chunk = Math.min(100, ms - waited); await _sleep(chunk); waited += chunk; }
}
function dmgPopup(host, text, cls, dy) {
  if (!host) return;
  const d = document.createElement('div'); d.className = 'dmgpop ' + (cls || ''); d.textContent = text;
  if (dy) d.style.marginTop = dy + 'px';
  host.appendChild(d); setTimeout(() => d.remove(), 760);
}
// Pixel transform that carries the attacker block `ae` across the board so it bumps into its target
// `te` (edge-to-edge, with a slight overlap) rather than just nudging in place. Reads live layout, so
// it follows the actual on-screen tiles regardless of lane/row.
function lungeVector(ae, te) {
  const ar = ae.getBoundingClientRect(), tr = te.getBoundingClientRect();
  const dx = (tr.left + tr.width / 2) - (ar.left + ar.width / 2);
  const dy = (tr.top + tr.height / 2) - (ar.top + ar.height / 2);
  const gap = Math.max(0, (ar.width + tr.width) / 2 - 16); // stop short by ~half each block (slight overlap)
  const tx = dx - Math.sign(dx || 1) * Math.min(Math.abs(dx), gap);
  return `translate(${Math.round(tx)}px,${Math.round(dy)}px)`;
}
// Set true to make an in-flight playTimeline stop ASAP (used when a new floor attempt / auto-challenge
// interrupts the current fight). Reset at the start of every playback.
let _timelineAbort = false;
export function abortTimeline() { _timelineAbort = true; }
// Plays a battle timeline produced by resolveEncounter(..., { record:true }): charge bars fill,
// actors lunge toward their target, HP bars drop with floating damage numbers. Resolves when done
// (or early if abortTimeline() was called mid-fight).
export async function playTimeline(tl, ctx = {}) {
  const a = $('side-A'), b = $('side-B'); if (!a || !b || !tl) return;
  _timelineAbort = false;
  const allies = tl.allies.map((u) => ({ ...u, ess: u.essMax }));
  let wave = 0, foes = (tl.waves[0] || []).map((u) => ({ ...u, ess: u.essMax }));
  a.innerHTML = allies.map((u, i) => unitBlock(u, 'ally', i)).join('');
  b.innerHTML = foes.map((u, i) => unitBlock(u, 'foe', i)).join('');
  setWaveIndicator(1, tl.waves.length);
  setArenaFloor(ctx.floor, ctx.isBoss); // which floor this fight is on (frontier attempt or farm run)
  // per-side Auras & Traits panel: ally auras are fixed for the fight; foe auras swap with each wave.
  renderTraitPanels(allies, tl.allyAuras || [], foes, (tl.waveAuras || [])[0]);

  const el = (side, i) => $(`ub-${side}-${i}`);
  const unit = (side, i) => (side === 'ally' ? allies[i] : foes[i]);
  const drawHp = (side, i) => { const u = unit(side, i), e = el(side, i); if (!u || !e) return;
    e.querySelector('.hp>i').style.width = pctHp(u.hp, u.max) + '%';
    const num = e.querySelector('.hp .ub-num'); if (num) num.textContent = compact(Math.max(0, u.hp));
    e.classList.toggle('dead', u.hp <= 0); };
  const drawChg = (side, i, g, ms) => { const e = el(side, i); if (!e) return;
    const bar = e.querySelector('.chg>i'); if (ms != null) bar.style.transitionDuration = ms + 'ms';
    const pct = Math.max(0, Math.min(100, (100 * g) / GAUGE_MAX));
    bar.style.width = pct + '%'; e.classList.toggle('full', pct >= 99.9); };
  const drawEss = (side, i, val, ms) => { const u = unit(side, i), e = el(side, i); if (!u || !e || !u.essMax) return;
    const bar = e.querySelector('.ess>i'); if (!bar) return; if (ms != null) bar.style.transitionDuration = ms + 'ms';
    u.ess = val; bar.style.width = Math.max(0, Math.min(100, (100 * val) / u.essMax)) + '%';
    const num = e.querySelector('.ess .ub-num'); if (num) num.textContent = compact(val); };
  // refresh the active-status badge row on a block from a timeline snapshot ([{t,n}])
  const drawStatuses = (side, i, list) => { const e = el(side, i); if (!e) return;
    const host = e.querySelector('.ub-status'); if (host) host.innerHTML = (list || []).map(statusChip).join(''); };

  // Speed-driven, real-time playback: each step plays for a wall-clock span proportional to the
  // engine's `dt` (the gauge-time that actually elapsed), so a unit with twice the SPD visibly acts
  // twice as often. No fixed total budget — the fight runs at its own cadence. TIME_SCALE is ms per
  // unit of gauge-dt; STEP_MIN/MAX keep any single step sane; ACT_MS is the clash/damage flourish.
  const TIME_SCALE = PLAYBACK_MS, STEP_MIN = 40, STEP_MAX = 2600, ACT_MS = 150;
  // Attack-animation phases (a targeted strike). The board is frozen for their whole span.
  const LUNGE_OUT = 130, IMPACT_MS = 110, LUNGE_BACK = 110;

  for (const step of tl.steps) {
    if (_timelineAbort) return; // a new attempt/auto-challenge interrupted this fight — bail immediately
    if (step.gauges && step.wave !== wave) {
      wave = step.wave; foes = (tl.waves[wave] || []).map((u) => ({ ...u, ess: u.essMax }));
      b.innerHTML = foes.map((u, i) => unitBlock(u, 'foe', i)).join('');
      renderTraitPanels(allies, tl.allyAuras || [], foes, (tl.waveAuras || [])[wave]); // new wave → its foe panel
      setWaveIndicator(wave + 1, tl.waves.length);
    }
    if (step.heal) { step.heal.forEach((hp, i) => { if (allies[i]) { allies[i].hp = hp; drawHp('ally', i); } }); await _sleep(ACT_MS * 2); continue; }
    if (step.gauges) {
      const dur = Math.max(STEP_MIN, Math.min(STEP_MAX, Math.round((step.dt || 0) * TIME_SCALE)));
      step.gauges.ally.forEach((g, i) => drawChg('ally', i, g, dur));
      step.gauges.foe.forEach((g, i) => drawChg('foe', i, g, dur));
      if (step.essence) {
        step.essence.ally.forEach((v, i) => drawEss('ally', i, v, dur));
        step.essence.foe.forEach((v, i) => drawEss('foe', i, v, dur));
      }
      await _sleepAbort(dur);
      if (_timelineAbort) return; // interrupted during the gauge-fill wait
    }
    for (const act of step.acts || []) {
      const ae = el(act.side, act.i);
      drawChg(act.side, act.i, 0, 90); // spent its gauge — snap the charge bar back down
      if (act.ess != null) drawEss(act.side, act.i, act.ess, 110); // essence dips as the unit channels its Gu
      // self-afflictions on the acting unit: a DoT tick number and/or a skip marker (Stun/Frozen)
      if (ae && act.dots) { let off = 0; for (const t of ['burn', 'poison', 'bleed']) if (act.dots[t]) { dmgPopup(ae, compact(act.dots[t]), 'dot dot-' + t, off); off += 15; } }
      else if (ae && act.dot > 0) dmgPopup(ae, compact(act.dot), 'dot');
      if (ae && act.stun) dmgPopup(ae, act.frozen ? 'FROZEN' : 'STUN', act.frozen ? 'stun frozen' : 'stun', act.dot > 0 ? 18 : 0);
      const te = act.tgt ? el(act.tgt.side, act.tgt.i) : null;
      const bs = ae ? ae.closest('.bside') : null;
      // 1) LUNGE OUT — the actor travels across the board and bumps into its target (or a small in-place
      //    nudge if it has none). Playback is fully serialized: we await each phase and fire no other
      //    drawChg/animation meanwhile, so the rest of the board — charge bars included — stays frozen.
      if (ae) {
        ae.classList.add('lunging'); if (bs) bs.classList.add('lunge-active');
        if (te) { ae.style.transition = `transform ${LUNGE_OUT}ms cubic-bezier(.5,0,.85,.5)`; ae.style.transform = lungeVector(ae, te); }
        else ae.classList.add(act.side === 'ally' ? 'atk-a' : 'atk-f');
      }
      await _sleep(te ? LUNGE_OUT : ACT_MS);
      // 2) IMPACT — the strike lands ON CONTACT: target flash, floating damage, applied statuses, HP drop.
      if (te) {
        if (act.dodged) { dmgPopup(te, 'miss', 'miss'); Audio.miss(); }
        else { te.classList.add('hit'); dmgPopup(te, compact(act.dmg) + (act.lucky ? '‼' : act.crit ? '!' : ''), act.lucky ? 'crit lucky' : act.crit ? 'crit' : ''); (act.lucky || act.crit) ? Audio.crit() : Audio.hit(); }
        // every status that landed on the target this hit floats up as its own coloured label
        if (act.applied) { let off = 18; for (const t of act.applied) if (STATUS[t]) { dmgPopup(te, STATUS[t].label, 'status status-' + t, off); off += 15; } }
      }
      (act.hp || []).forEach((h) => { const u = unit(h.side, h.i); if (u) { if (u.hp > 0 && h.hp <= 0) Audio.death(); u.hp = h.hp; drawHp(h.side, h.i); } });
      if (te) await _sleep(IMPACT_MS);
      // 3) RECOVER — the actor slides home, then the board resumes.
      if (ae && te) { ae.style.transition = `transform ${LUNGE_BACK}ms ease`; ae.style.transform = ''; }
      if (te) await _sleep(LUNGE_BACK);
      if (te) te.classList.remove('hit');
      if (ae) { ae.classList.remove('lunging', 'atk-a', 'atk-f'); ae.style.transition = ''; }
      if (bs) bs.classList.remove('lunge-active');
    }
    // refresh on-block status badges from the end-of-instant snapshot
    if (step.statuses) {
      step.statuses.ally.forEach((list, i) => drawStatuses('ally', i, list));
      step.statuses.foe.forEach((list, i) => drawStatuses('foe', i, list));
    }
  }
}
// Wall-clock stamp (HH:MM:SS, local) captured when a feed line is logged.
const fmtClock = (d) => d.toLocaleTimeString([], { hour12: false });
// A feed entry: message on the left, timestamp aligned right.
function makeLogEl(l) {
  const d = document.createElement('div'); d.className = 'l ' + l.cls;
  const m = document.createElement('span'); m.className = 'l-msg'; m.textContent = l.text;
  const t = document.createElement('span'); t.className = 'l-time'; t.textContent = l.t || '';
  d.appendChild(m); d.appendChild(t); return d;
}
export function logLine(text, cls = '') {
  const entry = { text, cls, t: fmtClock(new Date()) };
  LOG.push(entry);                                   // LOG kept oldest→newest
  const el = $('log'); if (!el) return;
  el.insertBefore(makeLogEl(entry), el.firstChild);  // newest on top
  if (LOG.length > 160) { LOG.shift(); if (el.lastChild) el.removeChild(el.lastChild); } // drop the oldest (last)
  el.scrollTop = 0;                                  // keep the newest line in view
}
export function clearLog() { LOG = []; const el = $('log'); if (el) el.innerHTML = ''; }
function renderLog() { const el = $('log'); if (!el) return; el.innerHTML = '';
  for (let i = LOG.length - 1; i >= 0; i--) el.appendChild(makeLogEl(LOG[i])); // newest first
  el.scrollTop = 0;
}

// ---------- team ----------
const TEAM_SORTS = {
  power:  { label: 'Power',  cmp: (a, b) => effectiveStats(b).atk - effectiveStats(a).atk },
  realm:  { label: 'Realm',  cmp: (a, b) => b.realm - a.realm },
  rarity: { label: 'Rarity', cmp: (a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity) },
  name:   { label: 'Name',   cmp: (a, b) => a.name.localeCompare(b.name) },
};
// Distinct Dao paths the roster currently wields (via equipped Gu), for the team path filter.
function rosterPaths() {
  const set = new Set();
  for (const c of S().roster) for (const uid of c.gu) { const g = guOf(uid); if (g) set.add(g.daoPath); }
  return [...set].sort((a, b) => pathName(a).localeCompare(pathName(b)));
}
function teamControls(sort, filter, rar, pathF, searchV) {
  const sb = (k) => `<button class="${sort === k ? 'primary' : ''}" onclick="G.setView('teamSort','${k}')">${TEAM_SORTS[k].label}</button>`;
  const fb = (k, label) => `<button class="${filter === k ? 'primary' : ''}" onclick="G.setView('teamFilter','${k}')">${label}</button>`;
  const rarOpts = ['all', ...RARITY_ORDER].map((r) => `<option value="${r}" ${rar === r ? 'selected' : ''}>${r === 'all' ? 'All rarities' : r}</option>`).join('');
  const pathOpts = ['all', ...rosterPaths()].map((p) => `<option value="${p}" ${pathF === p ? 'selected' : ''}>${p === 'all' ? 'All paths' : pathName(p)}</option>`).join('');
  const filtered = filter !== 'all' || rar !== 'all' || pathF !== 'all' || !!(searchV && searchV.trim());
  return `<div class="teamctl">
    <span class="muted small">Sort</span><div class="viewtoggle">${Object.keys(TEAM_SORTS).map(sb).join('')}</div>
    <span class="muted small">Show</span><div class="viewtoggle">${fb('all', 'All')}${fb('active', 'Active')}${fb('reserve', 'Reserve')}</div>
    <span class="muted small">Rarity</span><select onchange="G.setView('teamRarity',this.value)">${rarOpts}</select>
    <span class="muted small">Path</span><select onchange="G.setView('teamPath',this.value)">${pathOpts}</select>
    <input class="searchbox" type="text" placeholder="Search cultivators…" value="${esc(searchV || '')}" oninput="G.teamSearch(this.value)">
    ${filtered ? '<button class="danger" onclick="G.clearTeamFilters()">✕ Clear</button>' : ''}
    <span class="muted small" style="margin-left:auto">${activeTeam().length}/6 active · ${S().roster.length} total</span>
  </div>`;
}
// Character ordering used by the sheet's ←/→ nav AND the Team page's active panel:
// active fighters first (front row, then back, by lane), then reserves by rarity (highest → lowest).
export function charNavOrder() {
  const roster = S().roster.slice();
  const active = roster.filter((c) => c.active).sort((a, b) =>
    ((rowOf(a) === 'back') - (rowOf(b) === 'back')) || (laneOf(a) - laneOf(b)));
  const reserve = roster.filter((c) => !c.active).sort((a, b) =>
    (RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity)) || a.name.localeCompare(b.name));
  return [...active, ...reserve];
}
// The 6 active slots, each holding the current active fighter (with inline Gu equip/unequip).
function activeSlotCard(c) {
  const s = effectiveStats(c);
  const rc = rarityColor(c.rarity);
  const unspent = unspentPoints(c);
  const guChips = Array.from({ length: guSlotsOf(c) }).map((_, i) => {
    const gu = c.gu[i] ? guOf(c.gu[i]) : null;
    return gu
      ? `<div class="slot filled" style="border-color:var(--t${gu.tier})" title="Click to change/unequip" onclick="G.openGuPicker('${c.id}',${i})"><b style="color:var(--t${gu.tier})">T${gu.tier}</b> ${gu.name}</div>`
      : `<div class="slot" onclick="G.openGuPicker('${c.id}',${i})">+ Gu slot</div>`;
  }).join('');
  return `<div class="card teamslot${unspent > 0 ? ' has-alloc' : ''}">
    <div class="row start">
      <span class="uname big" style="cursor:pointer" onclick="G.openChar('${c.id}')"><span class="cjk" style="color:${rc};margin-right:6px">${charGlyph(c)}</span>${c.name}</span>
      <span class="rar" style="color:var(--jade);white-space:nowrap">● ${rowOf(c) === 'back' ? 'BACK' : 'FRONT'} L${laneOf(c) + 1}</span>
    </div>
    <div class="cult">${realmName(c.realm)} · ${c.rarity}${(c.imprint || 0) > 0 ? ` · ${imprintStars(c.imprint)}` : ''}</div>
    <div class="statline"><span>HP <b>${compact(s.maxHp)}</b></span><span>ATK <b>${compact(s.atk)}</b></span><span>DEF <b>${compact(s.def)}</b></span><span>SPD <b>${s.spd}</b></span></div>
    ${unspent > 0 ? `<div class="alloc-note" title="Open ${esc(c.name)}'s sheet to allocate" onclick="G.openChar('${c.id}')">▲ ${compact(unspent)} attribute point${unspent === 1 ? '' : 's'} to allocate</div>` : ''}
    <div class="side-lbl" style="margin-top:12px">Gu Loadout — click a slot to equip/unequip</div>
    <div class="slot-row">${guChips}</div>
    <div class="row" style="margin-top:12px">
      <button onclick="G.openChar('${c.id}')">View Sheet ▸</button>
      <button onclick="G.toggleActive('${c.id}')">Bench</button>
    </div>
  </div>`;
}
function emptySlotCard(n) {
  return `<div class="card teamslot empty"><div>
    <div class="big" style="color:var(--muted)">Empty Slot ${n}</div>
    <div class="tiny muted" style="margin-top:7px">Activate a reserve from the roster below</div></div></div>`;
}
function activeTeamPanel() {
  const active = charNavOrder().filter((c) => c.active);
  const cells = [];
  for (let i = 0; i < 6; i++) cells.push(active[i] ? activeSlotCard(active[i]) : emptySlotCard(i + 1));
  return `<div class="grid cards teamslots">${cells.join('')}</div>`;
}
// Team-tab banner listing every duplicate set in the roster. Each set gets a redirect chip (opens the
// copy you'd keep/imprint INTO) plus a single Auto-Imprint action that consolidates them all at once.
function dupBanner() {
  const groups = duplicateGroups();
  if (!groups.length) return '';
  const chips = groups.map((g) => {
    const keeper = g.slice().sort((a, b) => (b.realm - a.realm) || (((b.imprint || 0) - (a.imprint || 0))))[0];
    const lvl = keeper.imprint || 0;
    const rc = rarityColor(keeper.rarity);
    return `<button class="dup-chip" onclick="G.openChar('${keeper.id}')" title="Open ${esc(keeper.name)}'s sheet to Soul Imprint">
      <span class="cjk" style="color:${rc}">${charGlyph(keeper) || '魂'}</span>
      <span>${esc(keeper.name)} <b>×${g.length}</b></span>
      <span class="muted tiny">${realmName(keeper.realm)}</span>${lvl ? ' ' + imprintStars(lvl) : ''}
    </button>`;
  }).join('');
  const sets = groups.length;
  return `<div class="card dup-banner">
    <div class="row start" style="justify-content:space-between;gap:14px;flex-wrap:wrap">
      <div>
        <div class="big"><span class="cjk" style="color:var(--brass)">魂印</span> Duplicates ready to imprint</div>
        <div class="muted small" style="margin-top:4px">${sets} cultivator${sets === 1 ? '' : 's'} ${sets === 1 ? 'has' : 'have'} spare copies. Sacrifice a duplicate to permanently raise the kept copy's attributes &amp; aptitude — open one below, or consolidate them all at once.</div>
      </div>
      <button class="primary" onclick="G.autoImprint()">Auto-Imprint All · keep highest realm</button>
    </div>
    <div class="dup-chips">${chips}</div>
  </div>`;
}
// The filtered + sorted roster cards (sort / show / rarity / path / name-search applied). Split out so
// the search box can repaint just the results (preserving input focus), like the Market.
function rosterCardsHtml() {
  const st = S().settings;
  const sort = TEAM_SORTS[st.teamSort] ? st.teamSort : 'power';
  const filter = st.teamFilter || 'all';
  const rar = st.teamRarity || 'all';
  const pathF = st.teamPath || 'all';
  const q = (st.teamSearch || '').trim().toLowerCase();
  let list = S().roster.slice();
  if (filter === 'active') list = list.filter((c) => c.active);
  else if (filter === 'reserve') list = list.filter((c) => !c.active);
  if (rar !== 'all') list = list.filter((c) => c.rarity === rar);
  if (pathF !== 'all') list = list.filter((c) => c.gu.some((uid) => { const g = guOf(uid); return g && g.daoPath === pathF; }));
  if (q) list = list.filter((c) => c.name.toLowerCase().includes(q)
    || realmName(c.realm).toLowerCase().includes(q) || (c.rarity || '').toLowerCase().includes(q));
  const cmp = TEAM_SORTS[sort].cmp;
  list.sort((a, b) =>
    (!!b.isPlayer - !!a.isPlayer) || (!!b.active - !!a.active) || cmp(a, b)); // you, then active, then sort
  return list.map(memberCard).join('') || '<div class="muted">No cultivators match these filters.</div>';
}
export function renderRosterResults() { const h = $('rosterResults'); if (h) h.innerHTML = rosterCardsHtml(); }
export function viewTeam() {
  const st = S().settings;
  const sort = TEAM_SORTS[st.teamSort] ? st.teamSort : 'power';
  const filter = st.teamFilter || 'all';
  const rar = st.teamRarity || 'all';
  const pathF = st.teamPath || 'all';
  return `${pagehead('人', 'Roster · 名册', 'Team & Cultivation',
    'Your <b>active team</b> (up to 6) fights for you — equip their Gu right here. Click any cultivator to open their full design sheet. Arrange battle positions in the <b>阵 Formation</b> tab.')}
  ${secHead(1, 'Active Team', `${activeTeam().length}/6 deployed`)}
  ${activeTeamPanel()}
  ${secHead(2, 'The Roster', `${S().roster.length} cultivators`)}
  ${dupBanner()}
  ${teamControls(sort, filter, rar, pathF, st.teamSearch || '')}
  <div class="grid cards" id="rosterResults">${rosterCardsHtml()}</div>`;
}
function fmUnit(c) {
  const s = effectiveStats(c);
  const rc = rarityColor(c.rarity);
  return `<div class="fmunit" draggable="true" ondragstart="G.dragStart(event,'${c.id}')" title="${esc(c.name)} — ${c.rarity} · ${realmName(c.realm)} · HP ${s.maxHp} · ATK ${s.atk} · DEF ${s.def} · SPD ${s.spd}">
    <span class="uname" style="color:${rc}">${c.name}</span>
    <span class="fmrealm">${realmName(c.realm)}${(c.imprint || 0) > 0 ? ' ' + imprintStars(c.imprint) : ''}</span>
    <span class="muted tiny">A ${compact(s.atk)} · H ${compact(s.maxHp)} · S ${s.spd}</span>
    ${c.isPlayer ? '' : `<button class="fmx" title="Bench" onclick="G.benchChar('${c.id}')">×</button>`}
  </div>`;
}
// Reserve filter bar for the Formation page (sort + rarity + path), mirroring the Team controls.
function formationControls(sort, rar, pathF, count) {
  const sb = (k) => `<button class="${sort === k ? 'primary' : ''}" onclick="G.setView('fmSort','${k}')">${TEAM_SORTS[k].label}</button>`;
  const rarOpts = ['all', ...RARITY_ORDER].map((r) => `<option value="${r}" ${rar === r ? 'selected' : ''}>${r === 'all' ? 'All rarities' : r}</option>`).join('');
  const pathOpts = ['all', ...rosterPaths()].map((p) => `<option value="${p}" ${pathF === p ? 'selected' : ''}>${p === 'all' ? 'All paths' : pathName(p)}</option>`).join('');
  return `<div class="teamctl">
    <span class="muted small">Sort</span><div class="viewtoggle">${Object.keys(TEAM_SORTS).map(sb).join('')}</div>
    <span class="muted small">Rarity</span><select onchange="G.setView('fmRarity',this.value)">${rarOpts}</select>
    <span class="muted small">Path</span><select onchange="G.setView('fmPath',this.value)">${pathOpts}</select>
    <span class="muted small" style="margin-left:auto">${count} reserve${count === 1 ? '' : 's'}</span>
  </div>`;
}
function renderFormation() {
  const lanes = [...Array(LANES).keys()];
  const rowHtml = (row) => lanes.map((lane) => {
    const occ = tileOccupant(row, lane);
    return `<div class="fmtile${occ ? ' on' : ''}" ondragover="G.dragOver(event)" ondragleave="G.dragLeave(event)" ondrop="G.dropTile(event,'${row}',${lane})">${occ ? fmUnit(occ) : `<span class="muted tiny">L${lane + 1}</span>`}</div>`;
  }).join('');
  const st = S().settings;
  const sort = TEAM_SORTS[st.fmSort] ? st.fmSort : 'power';
  const rar = st.fmRarity || 'all';
  const pathF = st.fmPath || 'all';
  let bench = S().roster.filter((c) => !c.active);
  if (rar !== 'all') bench = bench.filter((c) => c.rarity === rar);
  if (pathF !== 'all') bench = bench.filter((c) => c.gu.some((uid) => { const g = guOf(uid); return g && g.daoPath === pathF; }));
  bench.sort(TEAM_SORTS[sort].cmp);
  const anyReserve = S().roster.some((c) => !c.active);
  const benchHtml = bench.length
    ? bench.map(fmUnit).join('')
    : `<span class="muted small">${anyReserve ? 'No reserves match these filters.' : 'No reserves — recruit more in 召 Recruit.'}</span>`;
  return `<div class="card formation">
    <div class="fmboard">
      <div class="fmrowlbl">Front</div><div class="fmrow">${rowHtml('front')}</div>
      <div class="fmrowlbl">Back</div><div class="fmrow">${rowHtml('back')}</div>
    </div>
    <div class="fmbench">
      <div class="side-lbl">Reserves — drag onto the board to deploy</div>
      ${formationControls(sort, rar, pathF, bench.length)}
      <div class="fmbenchrow">${benchHtml}</div>
    </div>
  </div>`;
}
// Dedicated Formation page — the drag-and-drop 2×5 battle board, kept off the (often crowded) Team tab.
export function viewFormation() {
  return `${pagehead('阵', 'Battle Array · 布阵', 'Formation',
    'Arrange your active fighters on the 2×5 board. A <b>front</b> unit shields the <b>back</b> unit in its lane until it falls; units strike only within <b>±1 of their own lane</b>, reaching farther only when those are clear. Max 6 fighters, ≤5 per row. Turn order is by SPD, not position.')}
  ${renderFormation()}`;
}
// Short "Xm" / "Xh Ym" label for a remaining-time span (breakthrough injuries are minute-scale).
const fmtMins = (ms) => { const m = Math.max(1, Math.ceil(ms / 60000)); return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`; };
// Mortal breakthrough readiness line for a roster card: cost + odds, or an injured badge. Empty for
// immortals and at the Rank 5 Peak ceiling (where Ascension takes over).
function breakthroughChip(c) {
  if (isImmortalRealm(c.realm) || c.realm >= MORTAL_PEAK) return '';
  const rem = injuryRemainingMs(c);
  if (rem > 0) return `<div class="muted small" style="color:var(--blood-bright)">⚕ Injured · ${fmtMins(rem)} left</div>`;
  const cost = breakthroughCost(c.realm), chance = Math.round(breakthroughChance(c) * 100);
  return `<div class="muted small"${S().stones >= cost ? '' : ' style="opacity:.65"'}>▲ ${realmName(c.realm + 1)} · ${compact(cost)}石 · ${chance}%</div>`;
}
// Compact, clickable roster card → opens the full character sheet.
function memberCard(c) {
  const s = effectiveStats(c);
  const rc = rarityColor(c.rarity);
  const unspent = unspentPoints(c);
  return `<div class="card member clickable${unspent > 0 ? ' has-alloc' : ''}" onclick="G.openChar('${c.id}')" title="Open ${esc(c.name)}'s sheet">
    ${c.active ? `<span class="active-mark">● ${rowOf(c) === 'back' ? 'BACK' : 'FRONT'} · L${laneOf(c) + 1}</span>` : ''}
    <div class="row start"><span class="uname big">${charGlyph(c) ? `<span class="cjk" style="color:${rc};margin-right:8px">${charGlyph(c)}</span>` : ''}${c.name}</span>
      <span class="rar" style="color:${rc}">${c.rarity}</span></div>
    <div class="cult">${realmName(c.realm)}</div>
    <div class="muted small">${realmClass(c.realm)} · ${apertureGrade(apertureCapacity(effAptitude(c))).grade}-grade aperture${(c.imprint || 0) > 0 ? ` · ${imprintStars(c.imprint)}` : ''}</div>
    ${breakthroughChip(c)}
    <div class="statline"><span>HP <b>${compact(s.maxHp)}</b></span><span>ATK <b>${compact(s.atk)}</b></span><span>DEF <b>${compact(s.def)}</b></span><span>SPD <b>${s.spd}</b></span></div>
    ${unspent > 0 ? `<div class="alloc-note" onclick="event.stopPropagation();G.openChar('${c.id}')">▲ ${compact(unspent)} attribute point${unspent === 1 ? '' : 's'} to allocate</div>` : ''}
    ${compSummary(c)}
    <div class="row" style="margin-top:12px">
      <span class="muted tiny">View sheet ▸</span>
      <span class="gap" style="display:flex">
        <button onclick="event.stopPropagation();G.toggleActive('${c.id}')">${c.active ? 'Bench' : 'Activate'}</button>
        ${(!c.isPlayer && !c.active) ? `<button class="danger" onclick="event.stopPropagation();G.dismissPrompt('${c.id}')">Dismiss</button>` : ''}
      </span>
    </div>
  </div>`;
}

// ---------- character sheet (hero view) ----------
// Shared per-click step selector (1/10/100/1k/Max) — sets how much each ＋/－ stages on the board.
function allocStepBtns() {
  const step = S().settings.allocStep || 10;
  const STEP_LBL = { 1: '+1', 10: '+10', 100: '+100', 1000: '+1k', max: 'Max' };
  return [1, 10, 100, 1000, 'max'].map((sp) =>
    `<button class="mini${step === sp ? ' primary' : ''}" onclick="G.setAllocStep('${sp}')">${STEP_LBL[sp]}</button>`).join('');
}
function csAttrBoard(c) {
  const unspent = unspentPoints(c);
  // Pending (uncommitted) distribution lives on state, keyed to this character. Each ＋/－ stages the
  // current per-click step; "Confirm" commits the whole batch at once (see G.allocStage/allocCommit).
  const draft = (S().allocDraft && S().allocDraft.id === c.id) ? S().allocDraft : null;
  const staged = (k) => (draft && (draft[k] | 0)) || 0;
  const totalStaged = ATTR_KEYS.reduce((s, k) => s + staged(k), 0);
  const remaining = unspent - totalStaged;
  const cells = ATTR_KEYS.map((k) => {
    const al = (c.attrs && c.attrs[k]) || 0;
    const st = staged(k);
    return `<div class="cs-attr${st > 0 ? ' staged' : ''}" title="${ATTR_FULL[k]}">
      <div class="an">${ATTR_LABEL[k]}</div>
      <div class="av">${compact(effAttr(c, k) + st)}${st > 0 ? `<span class="stg">+${compact(st)}</span>` : ''}</div>
      <div class="apts">${compact(al)} allocated</div>
      <div class="ad">${ATTR_DESC[k]}</div>
      <div class="cs-step">
        <button class="mini step" ${st <= 0 ? 'disabled' : ''} onclick="G.allocStage('${c.id}','${k}',-1)">－</button>
        <span class="step-amt">${compact(st)}</span>
        <button class="mini step" ${remaining <= 0 ? 'disabled' : ''} onclick="G.allocStage('${c.id}','${k}',1)">＋</button>
      </div>
    </div>`;
  }).join('');
  return `<div class="cs-alloc">
      <span class="pill${unspent > 0 ? ' glow' : ''}">${compact(unspent)} unspent points</span>
      <span class="muted small">Per click</span><div class="viewtoggle">${allocStepBtns()}</div>
      ${totalStaged > 0 ? `<span class="pill staged-pill">${compact(totalStaged)} staged · ${compact(remaining)} left</span>` : ''}
      <button class="mini primary" ${totalStaged <= 0 ? 'disabled' : ''} onclick="G.allocCommit('${c.id}')">✓ Confirm distribution</button>
      <button class="mini" ${totalStaged <= 0 ? 'disabled' : ''} onclick="G.allocClear('${c.id}')">Reset</button>
      <span class="muted small">Attributes are permanent; every realm grants more points. There is no respec.</span>
    </div>
    <div class="cs-attrs">${cells}</div>`;
}
function csStatGrid(s) {
  const cell = (k, v) => `<div class="cs-stat"><span class="sk">${k}</span><span class="sv">${v}</span></div>`;
  const hit = 0.85 + s.hitChance;   // 85% base + bonus, UNCAPPED (was min'd at 99%); Hit% − their Evasion% = real landing chance
  return `<div class="cs-statgrid">
    ${cell('Crit Chance', pct(s.crit))}
    ${cell('Crit Damage', '×' + s.critDamage.toFixed(2))}
    ${cell('Evasion', pct(s.dodge))}
    ${cell('Hit Chance', pct(hit))}
    ${cell('Armor Pen', pct(s.armorPen))}
    ${cell('Potency', pct(s.potency))}
    ${cell('Status Resist', pct(s.statusResist))}
    ${cell('Lucky Hit', pct(s.luckyHit))}
    ${cell('Lifesteal', pct(s.lifesteal))}
    ${cell('Thorns', pct(s.thorns))}
    ${cell('Regen / act', compact(s.regen))}
    ${cell('Essence', s.essencePool + ' (+' + s.essenceRegen.toFixed(1) + ')')}
  </div>`;
}
// Gu loadout as cards (filled slots + empty slots), each opening the equip picker. Slot order is the
// battle CHANNEL PRIORITY: each action lights Gu top-down until essence runs out, so we mark each Gu's
// priority + whether the full aperture sustains it, and offer ▲▼ to reprioritise (G.moveGu).
function csGuLoadout(c) {
  const rank = rankOf(c.realm) + 1;
  const pool = effectiveStats(c).essencePool;            // full-aperture essence pool (all Gu lit)
  // equipped slots in order = priority; running cumulative cost vs the pool = the sustained prefix
  const filled = [];
  for (let i = 0; i < guSlotsOf(c); i++) if (c.gu[i]) filled.push(i);
  const meta = {}; let cum = 0;
  filled.forEach((slot, idx) => {
    const g = guOf(c.gu[slot]);
    cum += g ? guEssenceCostFor(g, rank) : 0;
    meta[slot] = { priority: idx + 1, sustained: cum <= pool + 1e-9, cumCost: Math.round(cum) };
  });
  const sustainedCount = filled.filter((s) => meta[s].sustained).length;
  const lastSlot = filled.length ? filled[filled.length - 1] : -1;

  const cards = Array.from({ length: guSlotsOf(c) }).map((_, i) => {
    const gu = c.gu[i] ? guOf(c.gu[i]) : null;
    if (!gu) return `<div class="gu-card empty" onclick="G.openGuPicker('${c.id}',${i})">＋ Empty Gu Slot ${i + 1}</div>`;
    const col = pathColor(gu.daoPath);
    const baseEss = guEssenceCost(gu), effEss = Math.round(guEssenceCostFor(gu, rank));
    const essCol = effEss < baseEss ? '#6fcf97' : effEss > baseEss ? '#e06c6c' : ''; // green = discount, red = surcharge
    const essArrow = effEss < baseEss ? ' ▼' : effEss > baseEss ? ' ▲' : '';
    const m = meta[i];
    const prio = `<span class="gu-prio${m.sustained ? '' : ' starved'}" title="${m.sustained
      ? `Channel priority ${m.priority} — lit at full aperture (needs ◇${m.cumCost} of ◇${pool})`
      : `Channel priority ${m.priority} — STARVED: needs ◇${m.cumCost} but your aperture holds only ◇${pool}`}">P${m.priority}</span>`;
    const upBtn = m.priority > 1
      ? `<button class="gu-move" title="Raise channel priority" onclick="event.stopPropagation();G.moveGu('${c.id}',${i},-1)">▲</button>`
      : '<span class="gu-move disabled">▲</span>';
    const dnBtn = i !== lastSlot
      ? `<button class="gu-move" title="Lower channel priority" onclick="event.stopPropagation();G.moveGu('${c.id}',${i},1)">▼</button>`
      : '<span class="gu-move disabled">▼</span>';
    // Ascension control: only immortal artifacts (byTier) below peak rank ascend; feeds the NEXT rank's
    // resources via crafting.upgrade. Sits inside the clickable card → stopPropagation so it never opens
    // the equip picker. (Disabled state is a span, since a disabled <button> would let the click bubble.)
    const ouid = c.gu[i], up = gu.byTier ? canUpgrade(ouid) : null;
    let ascBtn = '';
    if (up && up.next) {
      const cost = up.recipe ? `${fmt(up.recipe.stones)}石 · ${Object.entries(up.recipe.resources).map(([id, q]) => `${q}× ${resourceName(id)}`).join(' · ')}` : '';
      ascBtn = up.ok
        ? `<button class="gu-ascend" style="margin-top:8px;width:100%;font-size:11px;border-color:${col};color:${col}" title="${esc(`Ascend to Tier ${up.next} — ${cost}`)}" onclick="event.stopPropagation();G.upgradeGu('${ouid}')">✦ Ascend → T${up.next}</button>`
        : `<div class="gu-ascend disabled" style="margin-top:8px;text-align:center;font-size:10px;padding:4px;border:1px solid var(--line);border-radius:4px;opacity:.55" title="${esc(up.reasons.join(' '))}" onclick="event.stopPropagation()">✦ Ascend → T${up.next} (need materials)</div>`;
    }
    const starvedTag = m.sustained ? ''
      : '<div class="gu-starved" title="Beyond your aperture\'s reach at full essence — raise its priority (▲), drop pricier Gu above it, or grow your aperture (INT / rank / aptitude)">✕ starved · stays dark when essence is tight</div>';
    return `<div class="gu-card${m.sustained ? '' : ' starved'}" style="cursor:pointer" onclick="G.openGuPicker('${c.id}',${i})">
      <div class="gu-top"><span>${prio} <b class="tierbadge" style="color:var(--t${gu.tier});border-color:var(--t${gu.tier})">T${gu.tier}</b>${isUnique(gu) ? ' <span class="pill unique">UNIQUE</span>' : ''}</span>
        <span class="gu-reorder">${upBtn}${dnBtn}</span></div>
      <div class="gu-glyph" style="color:${col}">${pathCjk(gu.daoPath)}</div>
      <div class="gu-name">${gu.name}</div>
      <div class="gu-eff">${effectText(gu)}</div>
      <div class="gu-ess"${essCol ? ` style="color:${essCol}"` : ''} title="base ${baseEss}/use · rank ${rank} wielder vs T${gu.tier} Gu">◇ Essence · ${effEss}/use${essArrow}</div>
      ${starvedTag}
      ${ascBtn}
      <div class="gu-foot" style="color:${col}">${pathCjk(gu.daoPath)} · ${pathName(gu.daoPath)} Path</div>
    </div>`;
  }).join('');
  const note = filled.length
    ? `<div class="gu-aperture-note">Gu channel in <b>priority order</b> (P1 first). At full aperture (◇${pool}) you sustain <b>${sustainedCount}/${filled.length}</b> — any <span class="starved-ink">starved</span> Gu stays dark in battle until essence regenerates. Use <b>▲▼</b> to reprioritise.</div>`
    : '';
  return `${note}<div class="gu-cardgrid">${cards}</div>`;
}
// Dao comprehension + marks for every path the character touches.
function csDao(c) {
  const immortal = isImmortalRealm(c.realm);
  const pathSet = new Set(Object.keys(c.daoMarks || {}));
  for (const uid of c.gu) { const gu = guOf(uid); if (gu) pathSet.add(gu.daoPath); }
  for (const p in (c.comprehension || {})) pathSet.add(p);
  const paths = [...pathSet];
  if (!paths.length) return '<div class="muted small">No Dao paths yet — equip Gu and fight to comprehend their paths.</div>';
  const cap = comprehensionCap(c.realm);
  const affSet = new Set(affinityPaths(c));
  return `<div class="markwrap">${paths.map((p) => {
    const comp = comprehensionLevelIn(c, p), mk = marksIn(c, p);
    const col = pathColor(p);
    const markTxt = immortal
      ? ` · <span class="muted">${mk.toLocaleString()} marks (${attainmentIn(c, p).tier}) · ×${markAmp(mk).toFixed(2)}</span>`
      : '';
    const affBadge = affSet.has(p)
      ? ` <span class="tag" style="border-color:${col}aa;color:${col};font-size:10px;padding:1px 6px" title="Dao Path Affinity — +${Math.round((AFFINITY_EFFECT_MULT - 1) * 100)}% effectiveness · +${Math.round((AFFINITY_COMP_MULT - 1) * 100)}% comprehension XP">✦ Affinity</span>`
      : '';
    return `<div class="markrow">
      <span><b class="cjk" style="color:${col};font-size:18px;margin-right:8px">${pathCjk(p)}</b><b style="color:${col}">${pathName(p)}</b>${affBadge}
        <span class="muted small"> · Comprehension ${comp}/${cap}${markTxt}</span></span>
      <span class="compbar"><i style="width:${Math.min(100, (100 * comp) / cap)}%"></i></span>
    </div>`;
  }).join('')}</div>`;
}
// Cultivation + ascension/tribulation block (spec rows + action).
function csCultivation(c) {
  const immortal = isImmortalRealm(c.realm);
  const wounds = (c.wounds || []).length;
  const posText = c.active ? `${rowOf(c) === 'back' ? 'Back' : 'Front'} row · Lane ${laneOf(c) + 1}` : 'Reserve';
  const ap = apertureGrade(apertureCapacity(effAptitude(c)));
  const impLvl = c.imprint || 0;
  const aptNote = impLvl > 0
    ? `(aptitude ${effAptitude(c).toFixed(1)} · ${c.aptitude.toFixed(1)} +${(0.1 * impLvl).toFixed(1)} 魂印)`
    : `(aptitude ${c.aptitude.toFixed(1)})`;
  let rows = `<div class="spec-row"><dt>Realm</dt><dd>${realmName(c.realm)} <span class="cjk">${realmClass(c.realm)}</span></dd></div>
    <div class="spec-row"><dt>Aperture</dt><dd><b>${ap.grade}</b> grade · <span class="mono">${ap.pct}%</span> capacity <span class="muted small">${aptNote}</span></dd></div>`;

  if (!immortal) {
    if (c.realm >= MORTAL_PEAK) {
      rows += `<div class="spec-row"><dt>Breakthrough</dt><dd>Rank 5 Peak — the mortal ceiling. Ascension awaits.</dd></div>`;
    } else {
      const cost = breakthroughCost(c.realm), chance = Math.round(breakthroughChance(c) * 100);
      const gate = breakthroughFloorReq(c.realm), gated = gate && S().frontier <= gate;
      rows += `<div class="spec-row"><dt>Breakthrough</dt><dd>Next: <b>${realmName(c.realm + 1)}</b> · <span class="mono">${fmt(cost)}石</span> · <span class="mono">${chance}%</span> success${
        gate ? `<div style="margin-top:6px;color:${gated ? 'var(--blood-bright)' : '#6fcf97'}">${gated ? `🔒 Big-realm gate — clear Floor ${gate} first` : `✓ Big-realm gate (Floor ${gate}) cleared`}</div>` : ''}</dd></div>`;
    }
  } else {
    const cap = apertureCap(c.realm), used = apertureUsed(c), apPct = cap ? Math.min(100, (100 * used) / cap) : 0;
    rows += `<div class="spec-row"><dt>Aperture</dt><dd><span class="mono">${used.toLocaleString()} / ${cap.toLocaleString()} marks</span>
      <div class="xpbar" style="margin-top:7px"><i style="width:${apPct}%;background:linear-gradient(90deg,var(--blood-deep),var(--brass))"></i></div></dd></div>`;
  }
  rows += `<div class="spec-row"><dt>Dao Wounds</dt><dd>${wounds ? `<span style="color:var(--blood-bright)">${wounds} permanent</span>` : 'None'}</dd></div>
    <div class="spec-row"><dt>Formation</dt><dd>${posText}</dd></div>`;

  // action: breakthrough (mortal) / ascension / tribulation / venerable
  let action = '';
  if (!immortal && canAscend(c)) {
    action = `<div style="margin-top:14px"><button class="primary" onclick="G.ascend('${c.id}')">Attempt Ascension · ${ASCEND_COST} ✦</button>
      <div class="muted small" style="margin-top:6px">A solo trial to become a Gu Immortal. Failure costs the essence but is not fatal.</div></div>`;
  } else if (!immortal) {
    const cost = breakthroughCost(c.realm), chance = Math.round(breakthroughChance(c) * 100);
    const gate = breakthroughFloorReq(c.realm), gated = gate && S().frontier <= gate;
    const afford = S().stones >= cost, disabled = gated || !afford;
    const note = gated ? `Locked — clear Floor ${gate} to cross into ${realmName(c.realm + 1)}.`
      : !afford ? `Need ${fmt(cost)}石 (you have ${fmt(S().stones)}石).`
      : `Advance to ${realmName(c.realm + 1)}. ${chance}% success (70% aptitude + 30% comprehension). On failure the stones are spent, but the cultivator is unharmed — attempt again freely.`;
    action = `<div style="margin-top:14px"><button class="primary"${disabled ? ' disabled' : ''} onclick="G.attemptBreakthrough('${c.id}')">Attempt Breakthrough · ${fmt(cost)}石 · ${chance}%</button>
      <div class="muted small" style="margin-top:6px">${note}</div></div>`;
  } else if (immortal && c.realm >= 22) {
    const chk = canBecomeVenerable(c);
    action = chk.ok
      ? `<div style="margin-top:14px"><button class="primary" onclick="G.becomeVenerable('${c.id}')">⚡ Face the Chaos Tribulation → Venerable</button></div>`
      : `<div class="muted small" style="margin-top:14px">Path to Venerable:<br>${chk.reasons.map((r) => '• ' + r).join('<br>')}</div>`;
  } else if (immortal) {
    const t = c.trib || { progress: 0, passed: 0 };
    const tier = pending(c);
    const tp = Math.min(100, (100 * t.progress) / TRIB_THRESHOLD);
    action = `<div style="margin-top:14px"><div class="muted small">Tribulations passed this rank: ${t.passed}/${TRIBS_NEEDED}</div>
      <div class="xpbar" style="margin-top:6px"><i style="width:${tp}%"></i></div>
      ${tier
        ? `<button class="primary" style="margin-top:10px" onclick="G.faceTribulation('${c.id}')">⚡ Face the ${tier.name}${tier.lethal ? ' (lethal!)' : ''}</button>`
        : `<div class="muted tiny" style="margin-top:6px">Win battles to build toward the next ${tierForRank(rankOf(c.realm) + 1).name}.</div>`}</div>`;
  }
  return `<dl class="spec">${rows}</dl>${action}`;
}
// Soul Imprint (魂印) block: level, current bonuses, and the Imprint action (sacrifice a duplicate copy).
function csImprint(c) {
  const lvl = c.imprint || 0;
  const pct = Math.round((imprintAttrMult(c) - 1) * 100);
  const cands = imprintCandidates(c.id);
  const atMax = lvl >= IMPRINT_CAP;
  const can = !atMax && cands.length > 0;
  const note = atMax ? 'Maximum Soul Imprint reached.'
    : cands.length === 0 ? 'No benched duplicate available — recruit (or bench) another copy of this cultivator to imprint.'
    : `${cands.length} benched duplicate${cands.length === 1 ? '' : 's'} ready to sacrifice.`;
  const rows = `<div class="spec-row"><dt>Imprint</dt><dd><b>Lv ${lvl}</b> / ${IMPRINT_CAP} <span class="cjk">魂印</span></dd></div>
    <div class="spec-row"><dt>Bonus</dt><dd>+${pct}% to all attributes · +${(0.1 * lvl).toFixed(1)} aptitude</dd></div>
    <div class="spec-row"><dt>Next level</dt><dd>${atMax ? '—' : '+5% attributes · +0.1 aptitude (sacrifice one duplicate)'}</dd></div>`;
  const action = `<div style="margin-top:14px"><button class="${can ? 'primary' : ''}"${can ? '' : ' disabled'} onclick="G.imprintPrompt('${c.id}')">Imprint · Sacrifice a Duplicate</button>
    <div class="muted small" style="margin-top:6px">${note}</div></div>`;
  return `<dl class="spec">${rows}</dl>${action}`;
}

export function viewCharacter(id) {
  const c = id && S().roster.find((x) => x.id === id);
  if (!c) return `${pagehead('人', 'Roster', 'Not Found', 'That cultivator is no longer in your roster.')}
    <button onclick="G.setTab('team')">← Back to Roster</button>`;
  const s = effectiveStats(c);
  const rc = rarityColor(c.rarity);
  const glyph = charGlyph(c);
  const ap = apertureGrade(apertureCapacity(effAptitude(c))); // aperture grade for the header/aside (incl. Soul Imprint)
  const paths = []; for (const uid of c.gu) { const gu = guOf(uid); if (gu && !paths.includes(gu.daoPath)) paths.push(gu.daoPath); }
  const pathTags = paths.slice(0, 4).map((p) => `<span class="tag" style="border-color:${pathColor(p)}66;color:${pathColor(p)}"><span class="cjk">${pathCjk(p)}</span> ${pathName(p)}</span>`).join('');
  const affPct = Math.round((AFFINITY_EFFECT_MULT - 1) * 100), affComp = Math.round((AFFINITY_COMP_MULT - 1) * 100);
  const affTag = affinityPaths(c).map((ap) =>
    `<span class="tag" style="border-color:${pathColor(ap)}aa;color:${pathColor(ap)}" title="Dao Path Affinity — +${affPct}% ${pathName(ap)} Gu effectiveness · +${affComp}% ${pathName(ap)} comprehension XP">✦ <span class="cjk">${pathCjk(ap)}</span> ${affinityName(ap)}</span>`).join('');
  const lid = lineOf(c), lineDef = lid && LINES[lid];
  const lineTag = lineDef
    ? `<span class="tag" title="Archetype — ${lineDef.role}${lineDef.phase2 ? ' (support effect pending)' : ''}">⚔ ${lineName(lid, c.rarity)}</span>`
    : '';
  const statusTag = c.active
    ? `<span class="tag blood">Active · ${rowOf(c) === 'back' ? 'Back' : 'Front'} Row</span>`
    : '<span class="tag">Reserve</span>';
  const posText = c.active ? `${rowOf(c) === 'back' ? 'Back' : 'Front'} · L${laneOf(c) + 1}` : 'Reserve';
  const order = charNavOrder(), pos = order.findIndex((x) => x.id === c.id) + 1, total = order.length;

  return `<div class="sheet">
    <div class="cs-metabar">
      <span>蛊 Demon's Ascension · <span class="c">蛊月正族</span></span>
      <span>${c.rarity} · <b>${realmClass(c.realm)}</b></span>
    </div>
    <div class="cs-back">
      <button onclick="G.setTab('team')">← Back to Roster</button>
      <div class="cs-nav">
        <button onclick="G.stepChar(-1)" ${total <= 1 ? 'disabled' : ''}>← Prev</button>
        <span class="cs-nav-pos">${pos} / ${total}</span>
        <button onclick="G.stepChar(1)" ${total <= 1 ? 'disabled' : ''}>Next →</button>
      </div>
    </div>

    <header class="cs-ident">
      <div class="cs-seal">${glyph}</div>
      <div class="cs-ident-main">
        <div class="cs-name">${c.name}</div>
        <div class="cs-realm">${realmName(c.realm)}</div>
        <div class="cs-sub">${realmClass(c.realm)} · ${ap.grade}-grade aperture${c.isPlayer ? ' · the demon who would outlive the heavens' : ''}</div>
        <div class="cs-tags">
          <span class="tag" style="border-color:${rc}88;color:${rc}">${c.rarity}</span>
          ${c.isPlayer ? '<span class="tag blood">Demonic Path · 魔道</span>' : ''}
          ${lineTag}
          ${affTag}
          ${statusTag}
          ${(c.imprint || 0) > 0 ? `<span class="tag" title="Soul Imprint Lv ${c.imprint} — +${Math.round((imprintAttrMult(c) - 1) * 100)}% attributes · +${(0.1 * c.imprint).toFixed(1)} aptitude"><span class="cjk">魂印</span> ${c.imprint} ${imprintStars(c.imprint)}</span>` : ''}
          ${pathTags}
        </div>
      </div>
      <div class="cs-aside">
        <b>${lineDef ? lineName(lid, c.rarity) : (c.isPlayer ? 'Protagonist' : 'Recruit')}</b><span class="k">ROLE</span>
        <b>${c.rarity}</b><span class="k">RARITY</span>
        <b>${ap.grade}</b><span class="k">APERTURE</span>
        <b>${posText}</b><span class="k">POSITION</span>
      </div>
    </header>

    <div class="cs-glance">
      <div class="cs-portrait">
        <div class="glyph" style="color:${rc}">${glyph}</div>
        <div class="pcap"><span>${pathName(paths[0] || '') || (c.isPlayer ? 'Demonic Path' : 'Pathless')}</span><span><b>${c.rarity}</b></span></div>
      </div>
      <div class="cs-vitals">
        <div class="vital"><span class="vk">Max HP</span><span class="vv hp">${compact(s.maxHp)}</span></div>
        <div class="vital"><span class="vk">Attack</span><span class="vv atk">${compact(s.atk)}</span></div>
        <div class="vital"><span class="vk">Defense</span><span class="vv">${compact(s.def)}</span></div>
        <div class="vital"><span class="vk">Speed</span><span class="vv">${s.spd}</span></div>
      </div>
    </div>

    ${secHead(1, 'Attributes', 'STR · AGI · CON · INT · LCK')}
    ${csAttrBoard(c)}

    ${secHead(2, 'Combat Profile', 'derived from attributes + Gu')}
    ${csStatGrid(s)}

    ${secHead(3, 'Cultivation & Ascension', realmClass(c.realm))}
    ${csCultivation(c)}

    ${c.isPlayer ? '' : `${secHead(4, 'Soul Imprint', `Lv ${c.imprint || 0} / ${IMPRINT_CAP} · 魂印`)}
    ${csImprint(c)}`}

    ${secHead(c.isPlayer ? 4 : 5, 'Dao Paths', 'Comprehension · Marks')}
    ${csDao(c)}

    ${secHead(c.isPlayer ? 5 : 6, 'Gu Loadout', `${c.gu.filter(Boolean).length}/${guSlotsOf(c)} slots`)}
    ${csGuLoadout(c)}

    <div class="row" style="margin-top:30px;padding-top:20px;border-top:1px solid var(--line)">
      <button onclick="G.setTab('team')">← Back to Roster</button>
      <span class="gap" style="display:flex">
        <button class="${c.active ? '' : 'primary'}" onclick="G.toggleActive('${c.id}')">${c.active ? 'Bench Fighter' : 'Activate Fighter'}</button>
        ${(!c.isPlayer && !c.active) ? `<button class="danger" onclick="G.dismissPrompt('${c.id}')">Dismiss for Essence</button>` : ''}
      </span>
    </div>
  </div>`;
}

// ---------- recruit (gacha) ----------
export function viewRecruit() {
  const rateChips = RARITY_ORDER.map((k) => `<span class="pill" style="color:${rarityColor(k)};border-color:${rarityColor(k)}66">${k}</span>`).join(' ');
  return `${pagehead('召', 'Gacha · 召募', 'Recruit Cultivators',
    'Spend Immortal Essence to summon allies across six rarities (Common → Immortal). Rarity sets starting realm, attribute floor and aptitude; Gu slots grow with cultivation realm (3 at Rank 1 → 7 at Rank 5).')}
  <div class="card">
    <div class="row wrap gap left">
      <button class="primary" onclick="G.pull(1)">Summon ×1 · ${PULL_COST} ✦</button>
      <button class="primary" onclick="G.pull(10)">Summon ×10 · ${PULL_COST_10} ✦ <span style="color:var(--jade)">(Rare+ guaranteed)</span></button>
      <span class="pill">You hold ${fmt(S().essence)} ✦</span>
    </div>
    <div style="margin-top:14px">${rateChips}</div>
    <div class="muted small" style="margin-top:10px">Pity: ${pityCount()}/${PITY_CAP} pulls — an Epic or better is guaranteed when it fills.</div>
  </div>
  <div class="pulls" id="pulls"></div>`;
}
export function renderPulls(list) {
  const host = $('pulls'); if (!host) return; host.innerHTML = '';
  list.forEach((c, i) => {
    const d = document.createElement('div'); d.className = 'pull'; d.style.animationDelay = i * 55 + 'ms';
    d.style.borderColor = rarityColor(c.rarity);
    d.innerHTML = `<div class="pglyph cjk" style="color:${rarityColor(c.rarity)}">${charGlyph(c)}</div>
      <div class="rar" style="color:${rarityColor(c.rarity)}">${c.rarity}</div>
      <div class="uname big" style="margin-top:6px">${c.name}</div><div class="muted small">${realmName(c.realm)} · ${guSlotsOf(c)} Gu slots</div>`;
    host.appendChild(d);
  });
  refreshTop();
}

// ---------- gu crafting ----------
// Grid/List view toggle (persisted per tab in S().settings[key]).
function viewToggle(key, mode) {
  const b = (m, label) => `<button class="${mode === m ? 'primary' : ''}" onclick="G.setView('${key}','${m}')">${label}</button>`;
  return `<div class="viewtoggle">${b('grid', '▦ Grid')}${b('list', '☰ List')}</div>`;
}
// Refinery filter bar: Grid/List, a tier toggle (All · T1–T10), a Dao-path dropdown, and two
// status toggles — "Craftable now" (only Gu you can craft right now) and "Unlocked paths"
// (hide Gu whose Dao path is locked or below your frontier floor).
function guControls(mode, tierF, pathF, searchV) {
  const tb = (t) => `<button class="${String(tierF) === String(t) ? 'primary' : ''}" onclick="G.setView('guTier','${t}')">${t === 'all' ? 'All' : 'T' + t}</button>`;
  const tiers = ['all', 1, 2, 3, 4, 5, 6, 7, 8, 9].map(tb).join('');
  const allPaths = [...new Set(guList().map((g) => g.daoPath))].sort((a, b) => pathName(a).localeCompare(pathName(b)));
  const opts = ['all', ...allPaths].map((p) => `<option value="${p}" ${pathF === p ? 'selected' : ''}>${p === 'all' ? 'All paths' : pathName(p)}</option>`).join('');
  const st = S().settings;
  const craftableOn = !!st.guCraftable, unlockedOn = !!st.guUnlocked;
  const flag = (key, on, label) => `<button class="${on ? 'primary' : ''}" onclick="G.toggleGuFlag('${key}')">${on ? '☑' : '☐'} ${label}</button>`;
  const filtered = tierF !== 'all' || pathF !== 'all' || craftableOn || unlockedOn || !!(searchV && searchV.trim());
  return `<div class="teamctl">
    ${viewToggle('guView', mode)}
    <span class="muted small">Tier</span><div class="viewtoggle wrap">${tiers}</div>
    <span class="muted small">Path</span><select onchange="G.setView('guPath',this.value)">${opts}</select>
    <div class="viewtoggle">${flag('guCraftable', craftableOn, 'Craftable now')}${flag('guUnlocked', unlockedOn, 'Unlocked paths')}</div>
    <input class="searchbox" type="text" placeholder="Search Gu…" value="${esc(searchV || '')}" oninput="G.guSearch(this.value)">
    ${filtered ? `<button class="danger" onclick="G.clearGuFilters()">✕ Clear</button>` : ''}
  </div>`;
}

// A Gu's TAGS (what fodder must cover to refine it) rendered as small pills.
function tagPillsHtml(gu) {
  return guTags(gu).map((t) => `<span class="gu-tag">${tagLabel(t)}</span>`).join('');
}
// Recipe summary (stones + resources + tag-covering refinement fodder) — shared by list row + grid card.
function recipeText(gu) {
  const r = gu.recipe;
  const resTxt = Object.entries(r.resources || {}).map(([id, q]) => `${q}× ${RESOURCES[id] ? RESOURCES[id].name : id}`).join(', ');
  const rf = refineSpec(gu);
  const refine = rf.needed
    ? `≥${rf.min}× T${rf.tier} ${pathName(rf.path)} Gu${rf.tags.length ? ` covering ${rf.tags.map((t) => `[${t}]`).join('')}` : ''}`
    : '';
  return [`${r.stones}石`, resTxt, refine].filter(Boolean).join(' · ');
}
// Gu entry for the Refinery's LIST view — shows the recipe AND any missing ingredients inline.
function guRow(gu, owned) {
  const chk = canCraft(gu.id);
  const claimed = isUnique(gu) && S().uniqueClaimed[gu.id];
  return `<div class="gurow${chk.ok ? '' : ' locked'}">
    <div class="gurow-main">
      <div class="gurow-top"><b class="tierbadge" style="color:var(--t${gu.tier});border-color:var(--t${gu.tier})">T${gu.tier}</b>
        <b>${gu.name}</b>
        <span class="pill" style="color:${pathColor(gu.daoPath)};border-color:${pathColor(gu.daoPath)}66"><span class="cjk">${pathCjk(gu.daoPath)}</span> ${pathName(gu.daoPath)}</span>
        ${isUnique(gu) ? '<span class="pill unique">UNIQUE</span>' : ''}
        ${owned[gu.id] ? `<span class="pill">×${owned[gu.id]}</span>` : ''}
        <span class="muted small">${effectText(gu)}</span>
        <span class="gu-ess">◇ ${guEssenceCost(gu)} ess/use</span></div>
      <div class="gurow-tags">Tags · ${tagPillsHtml(gu)}</div>
      <div class="gurow-recipe">Recipe · ${recipeText(gu)}</div>
      ${chk.ok ? '' : `<div class="gurow-need">${chk.reasons.join(' ')}</div>`}
    </div>
    <button class="primary" onclick="G.craft('${gu.id}')" ${chk.ok ? '' : 'disabled'}>${claimed ? 'Exists' : 'Craft'}</button>
  </div>`;
}
function guCard(gu, owned) {
  const chk = canCraft(gu.id);
  const cost = recipeText(gu);
  const claimed = isUnique(gu) && S().uniqueClaimed[gu.id];
  const col = pathColor(gu.daoPath);
  return `<div class="gu-card" style="border-color:var(--t${gu.tier})44">
    <div class="gu-top"><span><b class="tierbadge" style="color:var(--t${gu.tier});border-color:var(--t${gu.tier})">T${gu.tier}</b>
      ${isUnique(gu) ? ' <span class="pill unique">UNIQUE</span>' : ''}
      ${owned[gu.id] ? ` <span class="pill">×${owned[gu.id]}</span>` : ''}</span>
      <span style="color:${col}">${pathName(gu.daoPath)}</span></div>
    <div class="gu-glyph" style="color:${col}">${pathCjk(gu.daoPath)}</div>
    <div class="gu-name">${gu.name}</div>
    <div class="gu-eff">${effectText(gu)}</div>
    <div class="gu-tags">${tagPillsHtml(gu)}</div>
    <div class="gu-ess">◇ Essence · ${guEssenceCost(gu)}/use</div>
    <div class="gu-eff" style="color:var(--muted);margin-top:4px">Recipe · ${cost}</div>
    ${chk.ok ? '' : `<div class="gu-eff" style="color:var(--blood-bright)">${chk.reasons.join(' ')}</div>`}
    <div class="row" style="margin-top:12px;align-items:center">
      <span class="gu-foot" style="color:${col};border:0;margin:0;padding:0">${pathCjk(gu.daoPath)} Path</span>
      <button class="primary" onclick="G.craft('${gu.id}')" ${chk.ok ? '' : 'disabled'}>${claimed ? 'Exists' : 'Craft'}</button>
    </div>
  </div>`;
}
// Refinery results: the path-section list (with bar), filtered by tier / path / flags / name-search.
// Split out so the search box repaints just this (keeping input focus). A name search auto-expands every
// matching path section so hits are visible without manual expanding.
function guResultsHtml() {
  const owned = {};
  S().guInv.forEach((g) => { owned[g.guId] = (owned[g.guId] || 0) + 1; });
  const st = S().settings;
  const tierF = st.guTier || 'all';
  const pathF = st.guPath || 'all';
  const q = (st.guSearch || '').trim().toLowerCase();
  // apply tier + path filters, then group the survivors by Dao Path.
  const openMap = st.guOpen || {};
  let lib = guList();
  if (tierF !== 'all') lib = lib.filter((gu) => gu.tier === Number(tierF));
  if (pathF !== 'all') lib = lib.filter((gu) => gu.daoPath === pathF);
  if (q) lib = lib.filter((gu) => gu.name.toLowerCase().includes(q)
    || pathName(gu.daoPath).toLowerCase().includes(q) || effectText(gu).toLowerCase().includes(q));
  // "Unlocked paths": drop Gu on locked (Supreme) paths or paths past the current frontier floor.
  const pathUnlocked = (pid) => !isPathLocked(pid) && S().frontier >= pathFloorReq(pid);
  if (st.guUnlocked) lib = lib.filter((gu) => pathUnlocked(gu.daoPath));
  // "Craftable now": keep only Gu canCraft accepts. Gate on the cheap path-unlock check first so the
  // costly canCraft (fodder set-cover) never runs for Gu whose path isn't reachable anyway.
  if (st.guCraftable) lib = lib.filter((gu) => pathUnlocked(gu.daoPath) && canCraft(gu.id).ok);
  const mode = st.guView === 'list' ? 'list' : 'grid';
  const byPath = {};
  lib.forEach((gu) => { (byPath[gu.daoPath] = byPath[gu.daoPath] || []).push(gu); });
  const commRank = { common: 0, uncommon: 1, rare: 2, esoteric: 3, supreme: 4 };
  const paths = Object.keys(byPath).sort((a, b) => {
    const d = commRank[commOf(a).key] - commRank[commOf(b).key];
    return d || pathName(a).localeCompare(pathName(b));
  });
  // The library is ~5,271 Gu (45 paths × ~117). Rendering every card at once (each runs canCraft) is
  // heavy, so path sections are COLLAPSED by default — only an open section builds its cards. A single
  // path picked via the filter, or an active name search, auto-expands the matching sections.
  const sections = paths.map((pid) => {
    const p = PATH(pid), c = commOf(pid);
    const gus = byPath[pid].sort((a, b) => a.tier - b.tier);
    const single = pathF === pid;
    const open = single || !!q || !!openMap[pid];
    const body = !open ? '' : (mode === 'list'
      ? `<div class="gulist">${gus.map((gu) => guRow(gu, owned)).join('')}</div>`
      : `<div class="gu-cardgrid">${gus.map((gu) => guCard(gu, owned)).join('')}</div>`);
    const caret = single ? '' : `<span class="gucaret">${open ? '▾' : '▸'}</span>`;
    const head = (single || q)
      ? '<div class="pathhdr">'
      : `<div class="pathhdr clickable" role="button" tabindex="0" onclick="G.toggleGuPath('${pid}')">`;
    return `<div class="pathsec">
      ${head}${caret}<span class="pglyph cjk" style="color:${c.color}">${pathCjk(pid)}</span>
        <span class="pname" style="color:${c.color}">${pathName(pid)}</span>
        <span class="pill" style="color:${c.color};border-color:${c.color}66">${c.label}</span>
        <span class="muted small">${CATEGORY_LABELS[p.category] || ''} · unlocks Floor ${c.floorReq} · ${gus.length} Gu</span></div>
      ${body}</div>`;
  }).join('') || '<div class="muted" style="margin-top:24px">No Gu match these filters.</div>';
  const anyOpen = Object.keys(openMap).length > 0;
  const bar = pathF === 'all' && paths.length
    ? `<div class="teamctl"><span class="muted small">${paths.length} paths · ${lib.length.toLocaleString()} Gu${q ? ' match' : ' — click a path to expand'}.</span>
        ${anyOpen && !q ? '<button class="danger" onclick="G.collapseGu()">✕ Collapse all</button>' : ''}</div>`
    : '';
  return `${bar}${sections}`;
}
export function renderGuResults() { const h = $('guResults'); if (h) h.innerHTML = guResultsHtml(); }
export function viewGu() {
  const st = S().settings;
  const mode = st.guView === 'list' ? 'list' : 'grid';
  return `${pagehead('蛊', 'Refinery · 炼蛊', 'Gu Refinery',
    'Gu bundle 1-4 signed effects; power scales with tier (1-9). Tiers 6-9 are immortal &amp; unique (one per world). Every Gu belongs to a <b>Dao Path</b>; rarer paths unlock only at deeper floors. Higher-tier Gu are refined from materials <b>plus lower-tier Gu of the same path</b>.')}
  ${guControls(mode, st.guTier || 'all', st.guPath || 'all', st.guSearch || '')}
  <div id="guResults">${guResultsHtml()}</div>`;
}

// ---------- shop ----------
// Market filter bar, mirroring the Refinery/Almanac: a rarity TOGGLE (colored when active), a Dao-path
// dropdown (limited to paths with unlocked resources), a name SEARCH box, and a Clear button.
function shopControls(rarityF, pathF, searchV) {
  const rb = (r) => `<button class="${rarityF === r ? 'primary' : ''}"${r !== 'all' && rarityF === r ? ` style="color:${rankColor(+r)};border-color:${rankColor(+r)}"` : ''} onclick="G.setView('shopRarity','${r}')">${r === 'all' ? 'All' : 'R' + r}</button>`;
  const rars = ['all', ...RANKS.map(String)].map(rb).join('');
  const pathsPresent = [...new Set(shopResources().filter((r) => r.daoPath).map((r) => r.daoPath))].sort((a, b) => pathName(a).localeCompare(pathName(b)));
  const pathOpts = ['all', 'universal', ...pathsPresent].map((p) => `<option value="${p}" ${pathF === p ? 'selected' : ''}>${p === 'all' ? 'All paths' : p === 'universal' ? 'Universal only' : pathName(p)}</option>`).join('');
  const filtered = rarityF !== 'all' || pathF !== 'all' || !!(searchV && searchV.trim());
  return `<div class="teamctl">
    <span class="muted small">Rank</span><div class="viewtoggle wrap">${rars}</div>
    <span class="muted small">Path</span><select onchange="G.setView('shopPath',this.value)">${pathOpts}</select>
    <input class="searchbox" type="text" placeholder="Search resources…" value="${esc(searchV || '')}" oninput="G.shopSearch(this.value)">
    ${filtered ? '<button class="danger" onclick="G.clearShopFilters()">✕ Clear</button>' : ''}
  </div>`;
}

// The grouped, FILTERED market listing (rarity / path / search applied on top of the unlock gates).
// Split out from viewShop so the search box can repaint just the results (preserving input focus).
export function shopSectionsHtml() {
  const unlocked = shopResources();
  if (!unlocked.length) return '<div class="muted" style="margin-top:14px">Nothing in stock yet — clear more floors and raise your cultivators’ realms to unlock resources.</div>';
  const st = S().settings;
  const rarityF = st.shopRarity || 'all';
  const pathF = st.shopPath || 'all';
  const q = (st.shopSearch || '').trim().toLowerCase();
  let items = unlocked;
  if (rarityF !== 'all') items = items.filter((r) => String(r.rank) === rarityF);
  if (pathF === 'universal') items = items.filter((r) => !r.daoPath);
  else if (pathF !== 'all') items = items.filter((r) => r.daoPath === pathF);
  if (q) items = items.filter((r) => r.name.toLowerCase().includes(q) || (r.daoPath && pathName(r.daoPath).toLowerCase().includes(q)));
  if (!items.length) return '<div class="muted" style="margin-top:14px">No resources match these filters.</div>';

  const owned = (r) => (S().resources[r.id] || 0);
  const byRank = {};
  items.forEach((r) => { (byRank[r.rank] = byRank[r.rank] || []).push(r); });
  const tag = (r) => r.daoPath
    ? `<span class="pill" style="color:${pathColor(r.daoPath)};border-color:${pathColor(r.daoPath)}66"><span class="cjk">${pathCjk(r.daoPath)}</span> ${pathName(r.daoPath)}</span>`
    : '<span class="muted small">universal</span>';
  const card = (r) => `<div class="card row">
    <span><b>${r.name}</b> <span class="pill" style="color:${rankColor(r.rank)};border-color:${rankColor(r.rank)}66">Rank ${r.rank}</span> ${tag(r)} <span class="muted small">· held ×${fmt(owned(r))}</span></span>
    <button class="primary" onclick="G.buyResource('${r.id}')">${fmt(resourceCost(r.id))} 石</button></div>`;
  return RANKS.filter((rk) => byRank[rk]).map((rk, i) =>
    `<div class="sec-head"><span class="sec-num" style="color:${rankColor(rk)}">${SEC_NUM[i + 1] || ''}</span>
      <span class="sec-title" style="color:${rankColor(rk)}">Rank ${rk}</span><span class="sec-meta">${byRank[rk].length} kinds · ${fmt(resourceCost(byRank[rk][0].id))} 石 each</span></div>
     <div class="grid cards">${byRank[rk].map(card).join('')}</div>`).join('');
}

// Repaint ONLY the results container (used by the live search so the input keeps focus).
export function renderShopResults() { const host = $('shopResults'); if (host) host.innerHTML = shopSectionsHtml(); }

export function viewShop() {
  const st = S().settings;
  return `${pagehead('市', 'Market · 集市', 'The Market',
    'Buy crafting resources with Primeval Essence Stones. A resource is stocked only once you have <b>beaten the floor it can drop from</b> and your <b>highest cultivator’s rank</b> reaches its tier — deeper materials stay locked until you grow into them.')}
  ${shopControls(st.shopRarity || 'all', st.shopPath || 'all', st.shopSearch || '')}
  <div class="cs-statgrid" style="grid-template-columns:repeat(3,1fr);margin-bottom:8px">
    <div class="cs-stat"><span class="sk">Primeval Stones</span><span class="sv" style="color:var(--stone)">${fmt(S().stones)} 石</span></div>
    <div class="cs-stat"><span class="sk">Cleared Floors</span><span class="sv">${Math.max(0, S().frontier - 1)}</span></div>
    <div class="cs-stat"><span class="sk">Highest Rank</span><span class="sv">${highestRosterRank()}</span></div>
  </div>
  <div id="shopResults">${shopSectionsHtml()}</div>`;
}

// ---------- inventory ----------
export function viewInventory() {
  const owned = resourceList().filter((r) => (S().resources[r.id] || 0) > 0);
  const mode = S().settings.invView === 'list' ? 'list' : 'grid';
  const byRank = {};
  owned.forEach((r) => { (byRank[r.rank] = byRank[r.rank] || []).push(r); });
  const tag = (r) => r.daoPath
    ? `<span class="pill" style="color:${pathColor(r.daoPath)};border-color:${pathColor(r.daoPath)}66"><span class="cjk">${pathCjk(r.daoPath)}</span> ${pathName(r.daoPath)}</span>`
    : '<span class="muted small">universal</span>';
  const qty = (r) => S().resources[r.id].toLocaleString();
  const sections = RANKS.filter((rk) => byRank[rk]).map((rk, i) => {
    const col = rankColor(rk);
    const arr = byRank[rk].sort((a, b) => (a.daoPath ? 1 : 0) - (b.daoPath ? 1 : 0) || a.name.localeCompare(b.name));
    const body = mode === 'list'
      ? `<div class="reslist">${arr.map((r) => `<div class="resrow" style="border-left:3px solid ${col}">
          <span><b>${r.name}</b> ${tag(r)}</span><span class="rq">×${qty(r)}</span></div>`).join('')}</div>`
      : `<div class="resgrid">${arr.map((r) => `<div class="restile" style="border-left-color:${col}">
          <div class="rn">${r.name}</div>
          <div class="rrow"><span class="rq">×${qty(r)}</span>${tag(r)}</div></div>`).join('')}</div>`;
    return `<div class="sec-head"><span class="sec-num" style="color:${col}">${SEC_NUM[i + 1] || ''}</span>
      <span class="sec-title" style="color:${col}">Rank ${rk}</span><span class="sec-meta">${arr.length} kinds</span></div>${body}`;
  }).join('');
  return `${pagehead('囊', 'Spoils · 行囊', 'Inventory',
    'Everything you have gathered. <b>Common</b> materials are universal; <b>path-tagged</b> resources drop in their path’s stretch of the tower and feed that path’s crafting.')}
  ${viewToggle('invView', mode)}
  <div class="cs-statgrid" style="grid-template-columns:repeat(4,1fr);margin-bottom:8px">
    <div class="cs-stat"><span class="sk">Primeval Stones</span><span class="sv" style="color:var(--stone)">${fmt(S().stones)} 石</span></div>
    <div class="cs-stat"><span class="sk">Immortal Essence</span><span class="sv" style="color:var(--jade)">${fmt(S().essence)} ✦</span></div>
    <div class="cs-stat"><span class="sk">Resource Kinds</span><span class="sv">${owned.length}</span></div>
    <div class="cs-stat"><span class="sk">Gu Held</span><span class="sv">${S().guInv.length}</span></div>
  </div>
  ${owned.length ? sections : '<div class="muted" style="margin-top:14px">No resources yet — farm floors to gather them.</div>'}`;
}

// ---------- almanac (resource compendium) ----------
// A clickable resource tile for the path cards. Opens the per-resource detail page (G.openRes).
function resTile(r) {
  const col = rarityColor(r.rarity);
  const owned = S().resources[r.id] || 0;
  const uses = guUsingResource(r.id).length;
  const usesTxt = uses ? `${uses} recipe${uses === 1 ? '' : 's'}` : 'unused';
  return `<div class="restile clk" style="border-left-color:${col}" onclick="G.openRes('${r.id}')" title="${esc(r.name)} — Rank ${r.rank}">
    <div class="rn">${r.name}</div>
    <div class="rrow"><span class="pill" style="color:${col};border-color:${col}66">Rank ${r.rank}</span>
      <span class="muted tiny">${usesTxt}${owned ? ` · ×${owned}` : ''}</span></div>
  </div>`;
}
// Filter bar (Dao Path + rarity/rank), mirroring the Team/Formation controls. Persisted in settings.
function almanacControls(rarityF, pathF, searchV) {
  const pathsPresent = [...new Set(resourceList().filter((r) => r.daoPath).map((r) => r.daoPath))].sort((a, b) => pathName(a).localeCompare(pathName(b)));
  const pathOpts = ['all', 'universal', ...pathsPresent].map((p) => `<option value="${p}" ${pathF === p ? 'selected' : ''}>${p === 'all' ? 'All paths' : p === 'universal' ? 'Universal only' : pathName(p)}</option>`).join('');
  const rarOpts = ['all', ...RANKS.map(String)].map((r) => `<option value="${r}" ${rarityF === r ? 'selected' : ''}>${r === 'all' ? 'All ranks' : 'Rank ' + r}</option>`).join('');
  const filtered = rarityF !== 'all' || pathF !== 'all' || !!(searchV && searchV.trim());
  return `<div class="teamctl">
    <span class="muted small">Path</span><select onchange="G.setView('almPath',this.value)">${pathOpts}</select>
    <span class="muted small">Rank</span><select onchange="G.setView('almRarity',this.value)">${rarOpts}</select>
    <input class="searchbox" type="text" placeholder="Search resources…" value="${esc(searchV || '')}" oninput="G.almanacSearch(this.value)">
    ${filtered ? '<button class="danger" onclick="G.clearAlmanacFilters()">✕ Clear</button>' : ''}
    <span class="muted small" style="margin-left:auto">${resourceList().length} resources</span>
  </div>`;
}
// The Almanac's grouped resource cards (rank / path / name-search applied). Split out so the search box
// repaints just the results, preserving input focus.
function almanacCardsHtml() {
  const st = S().settings;
  const rarityF = st.almRarity || 'all';
  const pathF = st.almPath || 'all';
  const q = (st.almSearch || '').trim().toLowerCase();
  const matchR = (r) => (rarityF === 'all' || String(r.rank) === rarityF)
    && (!q || r.name.toLowerCase().includes(q) || (r.daoPath && pathName(r.daoPath).toLowerCase().includes(q)));
  const byTier = (a, b) => a.rank - b.rank || a.name.localeCompare(b.name);

  // Each group renders as a card: a path/universal header over a grid of clickable resource tiles.
  const groupCard = (glyph, color, title, sub, tiles) => `<div class="card">
    <div class="pathhdr" style="margin-bottom:12px">
      <span class="pglyph cjk" style="color:${color}">${glyph}</span>
      <span class="pname" style="color:${color}">${title}</span>
      <span class="muted small">${sub}</span></div>
    <div class="resgrid">${tiles}</div></div>`;

  let cards = '';
  // Universal materials (no daoPath), unless a specific path is selected.
  if (pathF === 'all' || pathF === 'universal') {
    const uni = resourceList().filter((r) => !r.daoPath && matchR(r)).sort(byTier);
    if (uni.length) cards += groupCard('物', 'var(--bone-dim)', 'Universal Materials',
      `${uni.length} kind${uni.length === 1 ? '' : 's'} · binders used across every path’s recipes`,
      uni.map(resTile).join(''));
  }
  // Per-path cards (skipped when "Universal only"), ordered by commonality then name like the Refinery.
  if (pathF !== 'universal') {
    const commRank = { common: 0, uncommon: 1, rare: 2, esoteric: 3, supreme: 4 };
    const byPath = {};
    resourceList().filter((r) => r.daoPath && matchR(r) && (pathF === 'all' || r.daoPath === pathF))
      .forEach((r) => { (byPath[r.daoPath] = byPath[r.daoPath] || []).push(r); });
    const paths = Object.keys(byPath).sort((a, b) => (commRank[commOf(a).key] - commRank[commOf(b).key]) || pathName(a).localeCompare(pathName(b)));
    cards += paths.map((pid) => {
      const c = commOf(pid), p = PATH(pid);
      const sub = `${CATEGORY_LABELS[p.category] || ''} · ${c.label} · craft-gate Floor ${c.floorReq}`;
      return groupCard(pathCjk(pid), c.color, pathName(pid), sub, byPath[pid].sort(byTier).map(resTile).join(''));
    }).join('');
  }
  return cards || '<div class="muted" style="margin-top:24px">No resources match these filters.</div>';
}
export function renderAlmanacResults() { const h = $('almResults'); if (h) h.innerHTML = almanacCardsHtml(); }
export function viewAlmanac() {
  const st = S().settings;
  const all = resourceList();
  const uniCount = all.filter((r) => !r.daoPath).length;
  const pathCount = new Set(all.filter((r) => r.daoPath).map((r) => r.daoPath)).size;
  return `${pagehead('谱', 'Almanac · 物谱', 'Resource Almanac',
    'Every crafting material in the world, gathered by Dao Path. <b>Universal</b> mats bind recipes across all paths; <b>path-bound</b> resources drop in their path’s stretch of the tower and feed that path’s Gu. Click any resource to see <b>where it drops</b>, its <b>drop rate</b>, and the <b>recipes</b> that use it.')}
  ${almanacControls(st.almRarity || 'all', st.almPath || 'all', st.almSearch || '')}
  <div class="cs-statgrid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">
    <div class="cs-stat"><span class="sk">Resource Kinds</span><span class="sv">${all.length}</span></div>
    <div class="cs-stat"><span class="sk">Universal Mats</span><span class="sv">${uniCount}</span></div>
    <div class="cs-stat"><span class="sk">Paths Covered</span><span class="sv">${pathCount}</span></div>
  </div>
  <div id="almResults">${almanacCardsHtml()}</div>`;
}

// Per-resource detail page (pseudo-tab 'res', opened via G.openRes → UI.openResSheet).
export function viewResource(id) {
  const r = id && RESOURCES[id];
  if (!r) return `${pagehead('谱', 'Almanac', 'Not Found', 'That resource is not in the almanac.')}
    <button onclick="G.setTab('almanac')">← Back to Almanac</button>`;
  const col = rarityColor(r.rarity);
  const glyph = r.daoPath ? pathCjk(r.daoPath) : '物';
  const owned = S().resources[r.id] || 0;
  const [s, e] = r.floors;
  const rs = floorRealm(s), re = floorRealm(e);
  const realmTxt = rs === re ? `Realm ${rs}` : `Realms ${rs}–${re}`;
  const reached = (S().frontier - 1) >= s;
  const reachTxt = reached
    ? '<span style="color:var(--jade)">✓ within your cleared floors — farmable now</span>'
    : `<span style="color:var(--blood-bright)">locked — reach Floor ${s} to start farming it</span>`;
  const shop = marketUnlocked(r) ? ' · <span style="color:var(--stone)">in stock in the Market now</span>' : '';
  const pathTag = r.daoPath
    ? `<span class="tag" style="border-color:${pathColor(r.daoPath)}88;color:${pathColor(r.daoPath)}"><span class="cjk">${pathCjk(r.daoPath)}</span> ${pathName(r.daoPath)}</span>`
    : '<span class="tag">Universal Material</span>';

  // Drop-rate over a few representative floors across the band (deduped, clamped).
  const span = e - s;
  const samples = [...new Set([s, s + Math.round(span * 0.33), s + Math.round(span * 0.66), e].map((f) => Math.max(s, Math.min(e, Math.round(f)))))];
  const rateRows = samples.map((f) => {
    const boss = isBossFloor(f);
    const est = dropEstimate(r.id, f, boss);
    let pctTxt = '—';
    if (est) { const pc = est.perClear * 100; pctTxt = `≈ ${pc < 1 ? pc.toFixed(1) : Math.round(pc)}%`; }
    return `<div class="markrow"><span>Floor ${f}${boss ? ' <span class="muted tiny">★ boss</span>' : ''}</span>
      <span class="mono">${pctTxt} <span class="muted tiny">per clear</span></span></div>`;
  }).join('');

  // Gu recipes that consume this resource.
  const uses = guUsingResource(r.id);
  const recipeRows = uses.length
    ? uses.map((u) => `<div class="markrow">
        <span><b class="tierbadge" style="color:var(--t${u.gu.tier});border-color:var(--t${u.gu.tier})">T${u.gu.tier}</b>
          <b>${u.gu.name}</b>
          <span class="pill" style="color:${pathColor(u.gu.daoPath)};border-color:${pathColor(u.gu.daoPath)}66"><span class="cjk">${pathCjk(u.gu.daoPath)}</span> ${pathName(u.gu.daoPath)}</span></span>
        <span class="mono">×${u.qty}</span></div>`).join('')
    : '<div class="muted small">No current Gu recipe uses this resource.</div>';

  return `<div class="sheet">
    <div class="cs-metabar">
      <span>蛊 Demon's Ascension · <span class="c">万物谱</span></span>
      <span>Rank ${r.rank} <span class="muted">(${r.rarity})</span> · <b>${realmTxt}</b></span>
    </div>
    <div class="cs-back"><button onclick="G.setTab('almanac')">← Back to Almanac</button></div>

    <header class="cs-ident">
      <div class="cs-seal" style="color:${col}">${glyph}</div>
      <div class="cs-ident-main">
        <div class="cs-name">${r.name}</div>
        <div class="cs-realm" style="color:${col}">${r.rarity}</div>
        <div class="cs-sub">${r.daoPath ? pathName(r.daoPath) + ' signature resource' : 'Universal crafting material'}</div>
        <div class="cs-tags">
          <span class="tag" style="border-color:${col}88;color:${col}">${r.rarity}</span>
          ${pathTag}
        </div>
      </div>
      <div class="cs-aside">
        <b>${r.rarity}</b><span class="k">RANK</span>
        <b>${realmTxt}</b><span class="k">DEPTH</span>
        <b>×${owned.toLocaleString()}</b><span class="k">HELD</span>
        <b>${uses.length}</b><span class="k">RECIPES</span>
      </div>
    </header>

    ${secHead(1, 'Where It Drops')}
    <div class="card"><div class="body">Drops on cleared floors in <b>Floors ${s}–${e}</b> (${realmTxt}).<br>${reachTxt}${shop}</div></div>

    ${secHead(2, 'Drop Rate', 'estimated · per clear')}
    <div class="card"><div class="markwrap">${rateRows}</div>
      <div class="muted tiny" style="margin-top:8px">An estimate — a floor's rate rises and falls with how many other resources share its loot pool, and <b>boss floors</b> (every 10th, ★) roll more drops.</div></div>

    ${secHead(3, 'Used in Recipes', `${uses.length} Gu`)}
    <div class="card"><div class="markwrap">${recipeRows}</div>
      ${r.daoPath ? `<div style="margin-top:12px"><button onclick="G.openRefinery('${r.daoPath}')">▸ See ${pathName(r.daoPath)} in the Gu Refinery</button></div>` : ''}</div>

    <div class="row" style="margin-top:30px;padding-top:20px;border-top:1px solid var(--line)">
      <button onclick="G.setTab('almanac')">← Back to Almanac</button>
    </div>
  </div>`;
}

// ---------- floors ----------
export function viewFloors() {
  const frontier = S().frontier;
  const beaten = frontier - 1; // cleared/beaten floors are 1 .. frontier-1
  let sections = '';
  for (let realm = 1; realm <= 9; realm++) {
    const lo = (realm - 1) * FLOORS_PER_REALM + 1, hi = realm * FLOORS_PER_REALM;
    const to = Math.min(hi, beaten);
    if (to < lo) continue; // no cleared floors in this realm band yet
    let cells = '';
    for (let f = lo; f <= to; f++) {
      const boss = isBossFloor(f), farming = f === S().farmFloor;
      cells += `<div class="floor ${boss ? 'boss' : ''} ${farming ? 'farming' : ''}" onclick="G.setFarm(${f})">
        <div class="fnum">F${f}${boss ? ' ★' : ''}</div>
        <div class="muted">${farming ? '★ farming' : 'farm'}</div></div>`;
    }
    sections += `${secHead(realm, `Realm ${realm}`, `Floors ${lo}–${hi}`)}<div class="floorgrid">${cells}</div>`;
  }
  const body = sections || '<div class="muted">No floors cleared yet — beat Floor 1 with <b>⚔ Attempt Floor</b> on the Battle tab to unlock a farming target.</div>';
  return `${pagehead('塔', 'Tower · 万妖塔', 'Tower of Floors',
    `9 realms × 50 floors (450 total); every enemy matches its realm band. Only <b>cleared</b> floors can be idle-farmed (boss every 10th, ★). Frontier: <b>Floor ${frontier}</b> (Realm ${floorRealm(frontier)})${isBossFloor(frontier) ? ' · BOSS' : ''} — clear it from the Battle tab to push deeper.`)}
  ${body}`;
}

// ---------- codex ----------
export function viewCodex() {
  const toc = [
    ['cdx-1', 'Attributes'], ['cdx-2', 'Realms'], ['cdx-3', 'Breakthroughs'], ['cdx-4', 'Aptitude'],
    ['cdx-5', 'Gu'], ['cdx-6', 'Refining'], ['cdx-7', 'Dao Paths'], ['cdx-8', 'Market'], ['cdx-9', 'Combat & Idle'],
    ['cdx-10', 'Soul Imprint'],
  ].map(([id, label]) => `<a class="cdx-tab" href="#${id}">${label}</a>`).join('');
  const o = S().onboarding || {};
  const onbActive = !!(o.active && !o.dismissed);
  const onbBar = `<div class="cdx-onboard">
    <span>${onbActive
      ? 'The <b>First-Steps</b> checklist is active — see the panel at the bottom-right.'
      : 'New to cultivation? Run the guided <b>First-Steps</b> checklist alongside this guide.'}</span>
    <button class="primary" onclick="G.startOnboarding()">${onbActive ? '↻ Restart' : '▶ Start'} First-Steps</button>
  </div>`;
  return `${pagehead('典', "Manual · 指南", 'Codex',
    "A beginner's guide to cultivation, Gu, and the laws of this world. The floating checklist walks you through your first steps — this explains how it all works.")}
  ${onbBar}
  <div class="cdx-toc">${toc}</div>

  <section id="cdx-1">${secHead(1, 'The Five Attributes', 'your raw power')}
  <div class="card"><div class="body">Every cultivator's strength comes from five attributes, raised by spending the points each breakthrough grants. Allocate them on a cultivator's <b>Character</b> sheet (the ＋ / − buttons, then <b>Confirm</b>); a red mark on the <b>Team</b> tab means someone has points waiting.
  <ul class="cdx-list">
    <li><b>STR</b> · Strength <span class="muted">— ATK, Crit Damage, Armor Penetration</span></li>
    <li><b>AGI</b> · Agility <span class="muted">— Speed, Evasion, Hit</span></li>
    <li><b>CON</b> · Constitution <span class="muted">— Max HP, DEF, Resistances, Regen</span></li>
    <li><b>INT</b> · Intelligence <span class="muted">— Potency (status power), essence pool &amp; regen</span></li>
    <li><b>LCK</b> · Luck <span class="muted">— Crit chance, Lucky hits, drop rate</span></li>
  </ul>
  There is <b>no realm multiplier</b> — all your power lives in these points, so a higher realm matters because it grants <b>more</b> of them. Raw stats (HP, ATK) grow steadily; percentage stats (crit, evasion) have diminishing returns and scale relative to your realm.</div></div></section>

  <section id="cdx-2">${secHead(2, 'Realms — Big &amp; Small', 'the cultivation ladder')}
  <div class="card"><div class="body">Cultivation climbs <b>Ranks 1–9</b> — these are the <b>big realms</b>. Each mortal rank (1–5) is split into four <b>small realms</b>: <b>Initial → Middle → Upper → Peak</b>. So the whole mortal ladder runs Rank 1 Initial … Rank 5 Peak (a "Gu Master").
  <br><br>Beyond it lie the immortal ranks <b style="color:var(--t6)">6–9</b> (a "Gu Immortal") — these have <b>no sub-stages</b> — and <b style="color:var(--t9)">Rank 9 is the Venerable</b>, the apex of all cultivation. Every step multiplies your power and grants attribute points; crossing into a new <b>big realm</b> is a far greater leap than a small-realm step.</div></div></section>

  <section id="cdx-3">${secHead(3, 'Breaking Through', 'how you advance')}
  <div class="card"><div class="body">You don't grind XP to level up. A mortal breakthrough is <b>purchased with <span style="color:var(--stone)">石 Primeval Stones</span></b> on a cultivator's <b>Character</b> sheet, and it can <b>fail</b> — but failure only spends the stones (no injury, no setback), so simply try again once you can afford it.
  <br><br><b>Success chance = 70% from your Aptitude + 30% from your highest Dao Comprehension.</b> Raise either to make breakthroughs more reliable.
  <br><br>Crossing into a new <b>big realm</b> is <b>floor-gated</b> — you must first clear a tower floor:
  <ul class="cdx-list">
    <li><b>Rank 2</b> — clear Floor 50</li>
    <li><b>Rank 3</b> — clear Floor 100</li>
    <li><b>Rank 4</b> — clear Floor 150</li>
    <li><b>Rank 5</b> — clear Floor 200</li>
  </ul>
  Small-realm steps (Initial→Middle…) have no gate. Each success grants attribute points — and high aptitude adds bonus points on top. Immortals (Rank 6+) advance differently: by surviving <b>Tribulations</b> on the <b>Dao</b> tab.</div></div></section>

  <section id="cdx-4">${secHead(4, 'Aptitude &amp; the Aperture', 'how much essence you hold')}
  <div class="card"><div class="body"><b>Aptitude does not speed up cultivation.</b> It sets your <b>aperture capacity</b> — the share of the primeval-essence pool you can actually fill, graded <b>D → C → B → A → Extreme</b>. (Fang Yuan opens with an <b>Extreme</b> aperture.)
  <br><br>Essence powers your Gu in battle: every action channels your Gu, paying each one's essence cost. Your Gu fire <b>in loadout order</b> (slot 1 first), and each action lights up as many as your essence can afford — if your aperture can't cover the whole kit, the Gu past that point simply <b>stay dark</b> for that swing (an unlit Gu adds nothing — not its attack, defence, HP, nor status). A Gu rises again the moment your essence recovers. With <b>no</b> Gu lit you still fight bare-handed, so equipping Gu can never make you weaker. Put your most important Gu in the <b>early slots</b>; aptitude (aperture) and <b>INT</b>/<b>rank</b> decide how deep into the loadout you can sustain.</div></div></section>

  <section id="cdx-5">${secHead(5, 'Gu — One Gu, One Power', 'your equipment')}
  <div class="card"><div class="body">A Gu is a living treasure that does exactly <b>one</b> thing — only its strength scales with its <b>tier (1–10)</b>. Tiers <b>1–5 are common</b> (you may own many); tiers <b style="color:var(--t6)">6–10 are unique</b> — a single copy exists in the entire world.
  <br><br>Stat Gu (ATK / DEF / HP) grant a <b>percentage</b> of your attribute base, so they stay relevant at any depth. Equip Gu in the loadout slots on a <b>Character</b> sheet — you open with <b>3 slots at Rank 1</b> and gain one per big realm, up to <b>7 at Rank 5</b>.</div></div></section>

  <section id="cdx-6">${secHead(6, 'The Refinery — Crafting &amp; Refining', 'making Gu')}
  <div class="card"><div class="body">Every Gu is built from a recipe in the <b>Gu Refinery</b>: <span style="color:var(--stone)">石 Stones</span> + that path's <b>resources</b> (no essence). Resources <b>drop from tower floors</b> and can also be bought in the <b>Market</b>.
  <br><br>Higher tiers are <b>refined</b>: besides materials, the recipe consumes <b>spare Gu of the same path exactly one tier lower</b>, whose effect <b>tags</b> cover the new Gu's tags (at least two pieces of fodder, every one on-tag). To forge a Tier 3 [ATK] Gu, you feed it Tier 2 ATK Gu of that path.
  <br><br>A path's Gu only become craftable once the tower runs deep enough — <b>common</b> paths from Floor 1, <b>uncommon</b> from 51, <b>rare</b> from 101, <b>esoteric</b> from 201.</div></div></section>

  <section id="cdx-7">${secHead(7, 'Dao Paths &amp; Comprehension', 'mastery over time')}
  <div class="card"><div class="body">Every Gu belongs to a <b>Dao Path</b>. Fighting with a path's Gu raises your <b>Comprehension</b> of it (0–10, capped by your rank), which amplifies every Gu of that path — under-comprehension weakens it, mastery rewards it, and <b>level 10</b> is a prerequisite for Venerable.
  <br><br>Your starting path is your <b>Dao Affinity</b>: it grants <b>+10% effectiveness</b> and <b>+25% comprehension gain</b> on that path. Immortals additionally earn <b>Dao Marks</b> from tribulations, which further amplify their paths.
  <br><br><b>Resonance</b> rewards focusing one path: equipping several Gu of the <b>same path</b> on a cultivator grants a set bonus to that path's effect — <b>+5%</b> with 2, then +10% · +15% · +20%, up to <b>+25% with 6</b>. It applies to <b>everyone</b> (not just immortals) and <b>stacks</b> with affinity and comprehension, so a focused single-path loadout outperforms a scattered one. Track all of this on the <b>Dao</b> and <b>Attainment</b> tabs.</div></div></section>

  <section id="cdx-8">${secHead(8, 'The Market', 'when floors are slow to drop')}
  <div class="card"><div class="body">The <b>Market</b> stocks every resource you've <b>unlocked</b>, so you can buy what the floors are slow to drop. A resource unlocks only when <b>both</b> are true: you've <b>cleared a floor it drops from</b>, and you have a cultivator whose <b>rank is at least the resource's tier</b> (a Rank-3 roster can't buy Epic / tier-4 materials yet). Prices climb steeply with tier, so deep materials are a serious <span style="color:var(--stone)">石</span> sink.</div></div></section>

  <section id="cdx-9">${secHead(9, 'Currencies, Combat &amp; Idle', 'the daily loop')}
  <div class="card"><div class="body"><b>Two currencies.</b> <b style="color:var(--stone)">石 Primeval Stones</b> buy resources and fund breakthroughs &amp; Gu crafting. <b style="color:var(--jade)">✦ Immortal Essence</b> funds recruiting (<b>Recruit</b> tab) and ascension. You earn an essence lump the <b>first</b> time you clear each floor (bosses far more), plus a small trickle from farming any cleared floor.
  <br><br><b>Combat is automatic.</b> Your team (max 6) fights on a <b>2×5 board</b> — a front-row unit shields the back-liner <i>in its own lane</i> until it falls, and each fighter acts when its movement gauge fills, so higher <b>SPD</b> means more frequent turns. Leave <b>Idle Farm</b> running on any cleared floor to gather while you're away, press <b>Attempt Floor</b> to push your frontier, or <b>Auto-Challenge</b> to climb until you fall.</div></div></section>

  <section id="cdx-10">${secHead(10, 'Soul Imprint', 'strengthen a copy with its duplicates')}
  <div class="card"><div class="body">Recruiting can hand you <b>duplicates</b> — two or more copies of the same cultivator. Instead of dismissing the spares, you can <b>imprint</b> them: sacrifice a benched duplicate into one copy to raise its <b>Soul Imprint</b> (<span class="cjk">魂印</span>), from <b>Lv 0 up to Lv 10</b>. Each level permanently grants that copy:
  <ul class="cdx-list">
    <li><b>+5% to all five attributes</b> <span class="muted">— a flat multiplier, so +50% at Lv 10</span></li>
    <li><b>+0.1 aptitude</b> <span class="muted">— up to +1.0 at Lv 10</span></li>
  </ul>
  Because aptitude does so much, that bonus ripples outward: a <b>fuller aperture</b>, <b>better breakthrough odds</b>, and even the <b>bonus attribute points</b> you'd have earned crossing past realms at the higher aptitude — all granted retroactively.
  <br><br>Open the kept copy's <b>Character</b> sheet and use <b>Imprint · Sacrifice a Duplicate</b>, then choose which spare to consume (it must be <b>benched</b>, and it's destroyed). Pour your duplicates into one carry to forge it far beyond a lone copy.</div></div></section>

  ${secHead(0, 'Your Records')}
  <div class="cs-statgrid">
    <div class="cs-stat"><span class="sk">Battles</span><span class="sv">${S().stats.battles}</span></div>
    <div class="cs-stat"><span class="sk">Wins</span><span class="sv">${S().stats.wins}</span></div>
    <div class="cs-stat"><span class="sk">Floors Cleared</span><span class="sv">${S().stats.floorsCleared}</span></div>
    <div class="cs-stat"><span class="sk">Summons</span><span class="sv">${S().stats.pulls}</span></div>
    <div class="cs-stat"><span class="sk">Gu Crafted</span><span class="sv">${S().stats.crafts}</span></div>
  </div>`;
}

// ---------- dao / aperture (immortal tier) ----------
export function viewDao() {
  const members = activeTeam();
  const cards = members.map(daoCard).join('') || '<div class="muted">No active cultivators.</div>';
  return `${pagehead('道', 'The Great Dao · 大道', 'Aperture & the Dao',
    'Every cultivator builds <b>Comprehension</b> (0–10, capped by rank) in a path by <b>using its Gu in battle</b>. At Rank 5 Peak a cultivator may <b>ascend</b> to Gu Immortal; immortals advance by surviving <b>tribulations</b>, which carve <b>Dao Marks</b> (each 1,000 marks doubles that path’s Gu). Same-path Gu also resonate. Failure leaves permanent Dao Wounds; the final tribulations can kill.')}
  ${secHead(1, 'Active Cultivators')}
  <div class="grid cards">${cards}</div>
  ${prestigePanel()}`;
}
function prestigePanel() {
  const p = prestige();
  const boons = Object.keys(BOONS).map((k) => {
    const cost = boonCost(k), afford = p.souls >= cost;
    return `<div class="markrow">
      <span><b>${BOONS[k].name}</b> <span class="pill">Lv ${boonLevel(k)}</span>
        <span class="muted small">${BOONS[k].blurb}</span></span>
      <button onclick="G.buyBoon('${k}')" ${afford ? '' : 'disabled'}>${cost} ✦souls</button>
    </div>`;
  }).join('');
  const can = canReincarnate();
  return `${secHead(2, 'Reincarnation', `${p.souls} Sovereign Souls · ${p.reincarnations} lives`)}
  <div class="card">
    <div class="psub" style="margin:0 0 10px">Sever this life to claim <b>Sovereign Souls</b> and permanent boons that carry into every future life. Souls scale with how far you reached and any Venerables forged.</div>
    <div class="markwrap">${boons}</div>
    <div style="margin-top:14px">
      ${can
        ? `<button class="primary" onclick="G.reincarnatePrompt()">↺ Reincarnate — claim ~${soulsAward()} souls</button>`
        : '<span class="muted small">Reach Floor 20 (or forge a Venerable) to unlock reincarnation.</span>'}
    </div></div>`;
}
// Comprehension chips for the paths a cultivator currently wields (shown to mortals too).
function compSummary(c) {
  const paths = new Set();
  for (const uid of c.gu) { const gu = guOf(uid); if (gu) paths.add(gu.daoPath); }
  if (!paths.size) return '';
  const cap = comprehensionCap(c.realm);
  const chips = [...paths].slice(0, 4).map((p) => `<span class="pill" style="color:${pathColor(p)};border-color:${pathColor(p)}66">${pathCjk(p)} ${comprehensionLevelIn(c, p)}/${cap}</span>`).join(' ');
  return `<div class="muted small" style="margin-top:10px">${chips}</div>`;
}
function daoCard(c) {
  const immortal = isImmortalRealm(c.realm);
  const head = `<div class="row start"><span class="uname big"><span class="cjk" style="color:${rarityColor(c.rarity)};margin-right:8px">${charGlyph(c)}</span>${c.name}</span>
    <span class="rar" style="color:${rarityColor(c.rarity)}">${realmName(c.realm)}</span></div>
    <div class="muted small">${realmClass(c.realm)}${(c.imprint || 0) > 0 ? ` · ${imprintStars(c.imprint)}` : ''}${(c.wounds || []).length ? ` · <span style="color:var(--blood-bright)">${c.wounds.length} Dao Wound(s)</span>` : ''}</div>`;

  if (!immortal) {
    if (canAscend(c)) {
      return `<div class="card member">${head}
        <div class="body" style="margin-top:10px">Rank 5 Peak reached — the mortal ceiling. Attempt ascension to become a Gu Immortal.</div>
        <div style="margin-top:12px"><button class="primary" onclick="G.ascend('${c.id}')">Attempt Ascension · ${ASCEND_COST} ✦</button></div>
        <div class="muted small" style="margin-top:6px">A solo trial. Failure costs the essence but is not fatal.</div></div>`;
    }
    const pctv = Math.min(100, (100 * c.realm) / MORTAL_PEAK);
    return `<div class="card member">${head}
      <div class="muted small" style="margin-top:10px">A mortal Gu Master. Reach Rank 5 Peak through cultivation to attempt ascension.</div>
      ${compSummary(c)}
      <div class="xpbar" style="margin-top:10px"><i style="width:${pctv}%"></i></div></div>`;
  }

  // immortal: aperture + marks + tribulation
  const cap = apertureCap(c.realm), used = apertureUsed(c), apPct = cap ? Math.min(100, (100 * used) / cap) : 0;
  const pathSet = new Set(Object.keys(c.daoMarks || {}));
  for (const uid of c.gu) { const gu = guOf(uid); if (gu) pathSet.add(gu.daoPath); }
  const paths = [...pathSet];
  const compCap = comprehensionCap(c.realm);
  const markRows = paths.length ? paths.map((p) => {
    const mk = marksIn(c, p), att = attainmentIn(c, p), comp = comprehensionLevelIn(c, p);
    return `<div class="markrow">
      <span><b class="cjk" style="color:${pathColor(p)};margin-right:6px">${pathCjk(p)}</b><b style="color:${pathColor(p)}">${pathName(p)}</b>
        <span class="muted small"> · Comp ${comp}/${compCap} · ${mk.toLocaleString()} marks (${att.tier}) · ×${markAmp(mk).toFixed(2)}</span></span>
    </div>`;
  }).join('') : '<div class="muted small">Equip Gu and fight to comprehend their paths; pass tribulations to carve Dao Marks.</div>';

  const t = c.trib || { progress: 0, passed: 0 };
  let tribHtml;
  if (c.realm >= 22) {
    const chk = canBecomeVenerable(c);
    tribHtml = chk.ok
      ? `<button class="primary" onclick="G.becomeVenerable('${c.id}')">⚡ Face the Chaos Tribulation → Venerable</button>`
      : `<div class="muted small">Path to Venerable:<br>${chk.reasons.map((r) => '• ' + r).join('<br>')}</div>`;
  } else {
    const tier = pending(c);
    const tp = Math.min(100, (100 * t.progress) / TRIB_THRESHOLD);
    tribHtml = `<div class="muted small">Tribulations passed this rank: ${t.passed}/${TRIBS_NEEDED}</div>
      <div class="xpbar" style="margin-top:6px"><i style="width:${tp}%"></i></div>
      ${tier
        ? `<button class="primary" style="margin-top:8px" onclick="G.faceTribulation('${c.id}')">⚡ Face the ${tier.name}${tier.lethal ? ' (lethal!)' : ''}</button>`
        : `<div class="muted tiny" style="margin-top:6px">Win battles to build toward the next ${tierForRank(rankOf(c.realm) + 1).name}.</div>`}`;
  }

  return `<div class="card member">${head}
    <div class="sec" style="margin:12px 0 4px">Aperture · ${used.toLocaleString()}/${cap.toLocaleString()}</div>
    <div class="xpbar"><i style="width:${apPct}%;background:linear-gradient(90deg,var(--blood-deep),var(--brass))"></i></div>
    <div class="markwrap">${markRows}</div>
    <div class="sec" style="margin:14px 0 4px">Tribulation</div>
    ${tribHtml}</div>`;
}

// ---------- attainment (dao-path comprehension overview) ----------
// Every path a character has any standing in (equipped Gu, banked comprehension, or carved marks),
// each with its comprehension level + (immortal) marks/attainment, sorted highest attainment first.
function attainmentPaths(c) {
  const pathSet = new Set(Object.keys(c.daoMarks || {}));
  for (const uid of c.gu) { const gu = guOf(uid); if (gu) pathSet.add(gu.daoPath); }
  for (const p in (c.comprehension || {})) pathSet.add(p);
  return [...pathSet].map((p) => ({
    p, comp: comprehensionLevelIn(c, p), pts: compPointsIn(c, p), mk: marksIn(c, p), att: attainmentIn(c, p),
  })).sort((a, b) => (b.comp - a.comp) || (b.mk - a.mk) || (b.pts - a.pts) || pathName(a.p).localeCompare(pathName(b.p)));
}
// One card per character: identity + each Dao path's attainment (rows pre-sorted by attainmentPaths).
function attainmentCard(c, rows) {
  const immortal = isImmortalRealm(c.realm);
  const cap = comprehensionCap(c.realm);
  const rc = rarityColor(c.rarity);
  const head = `<div class="row start">
      <span class="uname big" style="cursor:pointer" onclick="G.openChar('${c.id}')"><span class="cjk" style="color:${rc};margin-right:8px">${charGlyph(c)}</span>${c.name}</span>
      <span class="rar" style="color:${rc}">${realmName(c.realm)}</span></div>
    <div class="muted small">${realmClass(c.realm)} · Comprehension cap ${cap}${immortal ? ` · Aperture ${apertureUsed(c).toLocaleString()}/${apertureCap(c.realm).toLocaleString()}` : ''}${(c.imprint || 0) > 0 ? ` · ${imprintStars(c.imprint)}` : ''}</div>`;
  const body = rows.length
    ? `<div class="markwrap">${rows.map(({ p, comp, mk, att }) => {
        const col = pathColor(p);
        const markTxt = immortal ? ` · <span class="muted">${mk.toLocaleString()} marks (${att.tier}) · ×${markAmp(mk).toFixed(2)}</span>` : '';
        return `<div class="markrow">
          <span><b class="cjk" style="color:${col};font-size:18px;margin-right:8px">${pathCjk(p)}</b><b style="color:${col}">${pathName(p)}</b>
            <span class="muted small"> · Comprehension ${comp}/${cap}${markTxt}</span></span>
          <span class="compbar"><i style="width:${Math.min(100, (100 * comp) / cap)}%"></i></span>
        </div>`;
      }).join('')}</div>`
    : '<div class="muted small" style="margin-top:10px">No Dao paths yet — equip this cultivator\'s Gu and fight to comprehend their paths.</div>';
  return `<div class="card member">${head}${body}</div>`;
}
// Attainment tab: the whole roster's Dao-path comprehension at a glance. Cards are ordered by each
// cultivator's TOP path (comprehension, then marks, then banked points) so the page reads high→low.
export function viewAttainment() {
  const scored = S().roster.map((c) => {
    const rows = attainmentPaths(c);
    const top = rows[0] || { comp: -1, mk: -1 };
    const total = rows.reduce((s, r) => s + r.pts, 0);
    return { c, rows, topComp: top.comp, topMk: top.mk, total };
  }).sort((a, b) => (b.topComp - a.topComp) || (b.topMk - a.topMk) || (b.total - a.total) || a.c.name.localeCompare(b.c.name));
  const cards = scored.map(({ c, rows }) => attainmentCard(c, rows)).join('') || '<div class="muted">No cultivators.</div>';
  return `${pagehead('悟', 'Dao Attainment · 道悟', 'Path Attainment',
    'Every cultivator’s standing in each Dao path — <b>Comprehension</b> (0–10, capped by rank) grown by wielding that path’s Gu in battle, plus <b>Dao Marks</b> and attainment tier for immortals. Sorted from highest attainment down, cultivator and path alike.')}
  ${secHead(1, 'Cultivators by Attainment', `${S().roster.length} cultivator${S().roster.length === 1 ? '' : 's'}`)}
  <div class="grid cards">${cards}</div>`;
}

// ---------- modal & toast ----------
export function showModal(html, cls = '') {
  let o = $('overlay');
  if (!o) { o = document.createElement('div'); o.id = 'overlay'; document.body.appendChild(o);
    o.addEventListener('click', (e) => { if (e.target === o) closeModal(); }); }
  o.innerHTML = `<div class="modal${cls ? ' ' + cls : ''}">${html}</div>`;
}
export function closeModal() { const o = $('overlay'); if (o) o.remove(); }
export function toast(msg, ms = 2200, cls = '') {
  const host = $('toast-host'); if (!host) return;
  const t = document.createElement('div'); t.className = 'toast' + (cls ? ' ' + cls : ''); t.textContent = msg;
  host.appendChild(t);
  while (host.children.length > 4) host.firstChild.remove(); // cap the stack so rapid pops don't pile up
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 420); }, ms); // fade out, then remove
}
// A floating, self-fading ANNOUNCEMENT banner across the TOP of the screen — for milestone rewards
// (distinct from the bottom toast). Accepts HTML (for accent spans). Rises in, holds `ms`, fades out.
export function banner(msg, cls = '', ms = 4600) {
  const host = $('banner-host'); if (!host) return;
  const b = document.createElement('div'); b.className = 'banner' + (cls ? ' ' + cls : ''); b.innerHTML = msg;
  host.appendChild(b);
  while (host.children.length > 3) host.firstChild.remove(); // cap the stack
  setTimeout(() => { b.classList.add('out'); setTimeout(() => b.remove(), 700); }, ms); // fade up, then remove
}
