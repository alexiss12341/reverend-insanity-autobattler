// UI layer. Renders tabs from state and provides the battle feed, arena, toasts and modal.
// Event handlers are invoked via the global `G` object defined in main.js (onclick="G.foo()").
import { S, activeTeam, rowOf, laneOf, frontTeam, backTeam, LANES, tileOccupant, save, immortalUnlocked } from './state.js';
import { effectiveStats, guOf, breakthroughCost, breakthroughChance, breakthroughFloorReq, respecCost, RESPEC_ESSENCE_COST } from './systems/cultivation.js';
import { GU_LIB, guList, effectText, isUnique, guEssenceCost, guEssenceCostFor, guUsingResource, guTags, tagLabel, nextTierOf, starterGusForPath, signatureImmortalGu, signatureGusForPath, pathStatuses } from './data/gu.js';
import { RESOURCES, resourceList, resourceName, rankRarity } from './data/resources.js';
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
const rankColor = (rank) => rarityColor(rankRarity(rank)); // a rank's colour = its derived rarity's colour
import { rarityColor, RARITY_ORDER, rarityTier } from './data/rarities.js';
import { realmName, realmClass } from './data/realms.js';
import { PULL_COST, PULL_COST_10, PITY_CAP, pityCount } from './systems/gacha.js';
import { prestige, BOONS, boonCost, boonLevel, boonAtMax, canReincarnate, soulsAward, reincarnationPathChoices } from './systems/prestige.js';
import { DAILY_QUESTS, COMPLETE_ALL_BONUS, ensureDaily, questProgress, questGoal, questComplete, questClaimed, questClaimable, allClaimed, bonusClaimable, pendingReward, claimableCount, msToReset } from './systems/quests.js';
import { dailyBounties, attemptsLeft, msToNextAttempt, slotUnlocked, respawnRemaining, BOUNTY_MAX_ATTEMPTS } from './systems/bounties.js';
import { ensureArenaMeta, arenaAttemptsLeft, arenaMsToNextAttempt, ARENA_MAX_ATTEMPTS, arenaUnlocked, ARENA_UNLOCK_FLOOR } from './systems/arenaMeta.js';
import { arenaCanChallenge, ARENA_UP, ARENA_DOWN } from './data/arena.js';
import { slotUnlockFloor } from './data/bounties.js';
import { canCraft, refineSpec, canUpgrade, planAutoCraft } from './systems/crafting.js';
import { resourceCost, dropEstimate, shopResources, highestRosterRank, marketUnlocked } from './systems/economy.js';
import { generateEncounter, isBossFloor, encounterSize, floorRealm, FLOORS_PER_REALM } from './data/floors.js';
import { GAUGE_MAX, PLAYBACK_MS, cleanseChanceFor, cleanseMaxFor } from './systems/battle.js';
import { PATH, pathList, pathName, pathColor, pathCjk, commOf, CATEGORY_LABELS, isPathLocked, pathFloorReq, PATH_AFFINITY } from './data/daoPaths.js';
import { apertureCap, apertureUsed, apertureFree, attainmentIn, marksIn, attainmentOf, ATTAINMENT, comprehensionLevelIn, comprehensionCap, compPointsIn, markAmp, dominantPath, injuryRemainingMs } from './systems/dao.js';
import { affinityPaths, affinityName, AFFINITY_EFFECT_MULT, AFFINITY_COMP_MULT, lineOf, LINES, lineName, lineRole, lineCjk, lineBlurb, LINE_ORDER, lineTierEffects, lineEffects, lineGuAmp, lineEffectList, auraEffectList, allyAuraSummary, enemyWaveAura } from './data/traits.js';
import { TRIBS_NEEDED, TRIB_THRESHOLD, ASCEND_COST, pending, canAscend, canBecomeVenerable, tierForRank } from './systems/tribulation.js';
import { isImmortalRealm, MORTAL_PEAK, rankOf, guSlotsOf } from './data/realms.js';
import { ATTR_KEYS, effAttr, unspentPoints, playerPool, spentPoints, apertureCapacity, apertureGrade, effAptitude, imprintAttrMult } from './data/attributes.js';
import { imprintCandidates, IMPRINT_CAP, duplicateGroups, imprintableDuplicateCount } from './systems/gacha.js';
import { STATUS } from './data/status.js';
import { validateKiller, assemble, nearestCore, describeOps, synergyLabel, guInDomain, archetypeDomain, archetypeBlurb, DOMAIN_INFO, ARCHETYPES, ARCHETYPE_ORDER, archetypeRole, KILLER_COST_MULT, KILLER_UNLOCK_FLOOR, KILLER_MIN_RANK, KILLER_ARCH_COST } from './data/combos.js';
import * as Audio from './systems/audio.js';

const $ = (id) => document.getElementById(id);
const ATTR_LABEL = { str: 'STR', agi: 'AGI', con: 'CON', int: 'INT', luck: 'LCK' };
const ATTR_FULL = { str: 'Strength → ATK, Crit Dmg, Armor Pen', agi: 'Agility → Speed, Evasion, Hit', con: 'Constitution → HP, DEF, Resist, Regen', int: 'Intelligence → Potency, Essence', luck: 'Luck → Crit, Lucky Hit, drops' };
const ATTR_DESC = { str: 'ATK · Crit Dmg · Pen', agi: 'Speed · Evasion · Hit', con: 'HP · DEF · Resist · Regen', int: 'Potency · Essence', luck: 'Crit · Lucky · Drops' };
const pct = (x) => Math.round((x || 0) * 100) + '%';
const fmt = (n) => Math.floor(n).toLocaleString();
const esc = (s) => String(s).replace(/"/g, '&quot;');

// Immortal tier gate: Rank 6 (Gu Immortal) is not yet available, so the Rank-5-Peak ascension button is
// disabled in the UI for now. The ascend() handler is left intact (tests/future use) — flip this to
// false to re-enable the button once immortal cultivation is unlocked.
const ASCENSION_LOCKED = true;

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
  // Immortal Essence Stones (仙石) — hidden until a cultivator reaches immortal Rank 6, then shown live.
  const immWrap = $('t-imm-stones-wrap');
  if (immWrap) {
    const unlocked = immortalUnlocked();
    immWrap.style.display = unlocked ? '' : 'none';
    if (unlocked) $('t-imm-stones').textContent = fmt(S().immortalStones || 0);
  }
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
  // nav alert: daily quest rewards ready to claim
  const q = claimableCount();
  const qb = $('quest-alert');
  if (qb) { qb.textContent = q ? (q > 99 ? '99+' : '' + q) : ''; qb.classList.toggle('on', q > 0); }
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
    quests: viewQuests, bounties: viewBounties, pvp: viewPvp,
    attainment: viewAttainment, almanac: viewAlmanac, res: () => viewResource(_resId),
    whatsnew: viewWhatsNew,
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
  quests: 'Daily goals that pay ✦ Immortal Essence. They reset every day at midnight — clear them all for a bonus.',
  bounties: 'Hunt a rotating roster of lone raid-boss targets. You get 5 attempts that recharge +1 per hour; higher-rank bounties unlock as you climb.',
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
// How long a battle status lasts, for the path picker's "Inflicts" chip tooltips.
function statusDurText(type) {
  const d = STATUS[type]; if (!d) return '';
  if (d.durMax) return `lasts 1–${d.durMax} actions (by Gu tier)`;
  return `lasts ${d.dur} action${d.dur > 1 ? 's' : ''}`;
}
// Reused by both new-game and reincarnation (see reincarnatePathPicker). opts overrides the path set,
// the per-card onclick handler, and the title/intro/footer copy.
export function starterPathPicker(opts = {}) {
  const paths = opts.paths || pathList().filter((p) => !isPathLocked(p.id) && pathFloorReq(p.id) <= 50);
  const onPick = opts.onPick || 'G.starterPath';
  const cards = paths.map((p) => {
    const col = pathColor(p.id);
    const excel = (PATH_AFFINITY[p.id] || []).map((k) => tagLabel(k)).join(' · ');
    const stats = pathStatuses(p.id);
    const inflicts = stats.length
      ? `<div class="sp-inflicts"><span class="sp-k">Inflicts</span> ${stats.map((t) => {
          const lbl = (STATUS[t] && STATUS[t].label) || t;
          return tipTag(lbl, { head: lbl, sub: statusBlurb(t), eff: [statusDurText(t)] },
            { base: 'statchip', style: `border-color:${col}77;color:${col}` });
        }).join('')}</div>`
      : `<div class="sp-inflicts"><span class="sp-k">Inflicts</span> <span class="muted">no status — a pure stat &amp; utility path</span></div>`;
    const arsenal = signatureGusForPath(p.id);
    const arsenalHtml = arsenal.length
      ? `<div class="sp-arsenal"><div class="sp-k">Signature & status Gu · pursue toward</div>
          <ul class="sp-gulist">${arsenal.map((g, i) =>
            `<li${i === 0 ? ' class="cap"' : ''}><b style="color:var(--t6)">${g.name}</b><span class="muted tiny">${effectText(g)}</span></li>`).join('')}</ul></div>`
      : '';
    return `<div class="starter-path" onclick="${onPick}('${p.id}')" title="Choose ${pathName(p.id)}">
      <div class="sp-head"><span class="cjk sp-seal" style="color:${col}">${pathCjk(p.id)}</span>
        <span class="sp-name">${pathName(p.id)}</span><span class="pill">${commOf(p.id).label}</span></div>
      <div class="sp-blurb">${PATH(p.id).blurb}</div>
      <div class="sp-excel"><span class="sp-k">Excels at</span> ${excel}</div>
      ${inflicts}
      <div class="sp-grants"><span class="sp-k">Grants</span> ${affinityName(p.id)} <span class="muted tiny">+${Math.round((AFFINITY_EFFECT_MULT - 1) * 100)}% effect · +${Math.round((AFFINITY_COMP_MULT - 1) * 100)}% comprehension</span></div>
      ${arsenalHtml}
    </div>`;
  }).join('');
  return `<h3>${opts.title || 'Choose your Dao Path'}</h3>
    <div class="body"><div class="muted small">${opts.intro || `The foundation of your cultivation. You'll gain this path's <b>Dao Affinity</b> and begin with one of its Gu — and its resources will be the first you can craft with. Each card previews what the path excels at, the statuses its Gu inflict, and the immortal artifacts it leads toward.`}</div></div>
    <div class="starter-grid">${cards}</div>
    ${opts.footer || '<div class="right"><button onclick="G.closeModal()">Cancel</button></div>'}`;
}
// Step 3: pick a rank-1 Gu of the chosen path (a curated, thematic handful — see gu.starterGusForPath).
// Reused by reincarnation (see reincarnateGuPicker). opts overrides the per-card onclick + intro/footer.
export function starterGuPicker(pathId, opts = {}) {
  const onPick = opts.onPick || 'G.starterGu';
  const col = pathColor(pathId);
  const cards = starterGusForPath(pathId).map((g) => `
    <div class="starter-gu" onclick="${onPick}('${g.id}')" title="Begin with ${g.name}">
      <div class="sg-head"><b class="tierbadge" style="color:var(--t1);border-color:var(--t1)">T1</b><b class="sg-name">${g.name}</b></div>
      <div class="gu-eff">${effectText(g)}</div>
      <div class="gu-ess">◇ ${guEssenceCost(g)} essence / use</div>
    </div>`).join('');
  return `<h3>Choose your first Gu — <span class="cjk" style="color:${col}">${pathCjk(pathId)}</span> ${pathName(pathId)}</h3>
    <div class="body"><div class="muted small">${opts.intro || `A rank-1 Gu to begin with. You'll equip it from your Character sheet — the First-Steps guide walks you through it. You can craft and refine many more later.`}</div></div>
    <div class="starter-grid gu">${cards || '<div class="muted small">No starter Gu for this path.</div>'}</div>
    ${opts.footer || '<div class="right"><button onclick="G.starterBack()">← Back</button></div>'}`;
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
// Per-rarity effect strings for an archetype card/table row. lineTierEffects renders each line's stored
// effect bag; the Mender's CLEANSE is derived at battle time in battle.js (cleanseChanceFor/cleanseMaxFor)
// and never stored on the line, so append it here — display-only, so the Guide table + starter picker
// both surface it without duplicating the engine's source of truth.
function archEffects(id, rarity) {
  const effs = lineTierEffects(id, rarity).slice();
  if (id === 'mender') { const mx = cleanseMaxFor(rarity); effs.push(`Cleanse ${Math.round(cleanseChanceFor(rarity) * 100)}% (≤${mx} debuff${mx > 1 ? 's' : ''})`); }
  return effs;
}

// Reused by both new-game and reincarnation (see reincarnateArchetypePicker). opts overrides the
// per-card onclick handler and the title/intro/footer copy.
export function starterArchetypePicker(opts = {}) {
  const onPick = opts.onPick || 'G.starterArchetype';
  const cards = LINE_ORDER.map((id) => {
    const acc = LINE_ACCENT[id] || 'var(--blood)';
    const ladder = RARITY_ORDER.map((r) => {
      const effs = archEffects(id, r);
      const you = r === PLAYER_RARITY;
      return `<div class="arch-row${you ? ' you' : ''}">
        <span class="arch-rar" style="color:${rarityColor(r)}">${r}</span>
        <span class="arch-eff">${effs.length ? effs.join(' · ') : '<span class="muted">—</span>'}</span>
        ${you ? '<span class="arch-you">yours</span>' : ''}</div>`;
    }).join('');
    return `<div class="starter-arch" style="--acc:${acc}" onclick="${onPick}('${id}')" title="Become ${LINES[id].name}">
      <div class="sp-head"><span class="cjk sp-seal" style="color:${acc}">${lineCjk(id)}</span>
        <span class="sp-name">${LINES[id].name}</span><span class="pill">${lineRole(id)}</span></div>
      <div class="sp-blurb">${lineBlurb(id)}</div>
      <div class="arch-ladder">${ladder}</div>
    </div>`;
  }).join('');
  return `<h3>${opts.title || 'Choose your Archetype'}</h3>
    <div class="body"><div class="muted small">${opts.intro || `Your combat calling — a permanent trait stamped onto your cultivator. You'll gain it at <b style="color:${rarityColor(PLAYER_RARITY)}">${PLAYER_RARITY}</b> rarity (the <b>yours</b> row in each card); the rest of the ladder shows how the archetype scales with rarity. Pick the role that fits how you mean to fight.`}</div></div>
    <div class="starter-grid arch">${cards}</div>
    ${opts.footer || '<div class="right"><button onclick="G.starterArchetypeBack()">← Back</button></div>'}`;
}

// ===== REINCARNATION RE-PICK: new Dao affinity → starter Gu → new archetype =====
// Reuses the starter pickers with reincarnation handlers/copy. The affinity choices come from
// prestige.reincarnationPathChoices (previous affinity + every path at Comprehension level 5+).
export function reincarnatePathPicker() {
  const paths = reincarnationPathChoices().map((id) => PATH(id)).filter(Boolean);
  return starterPathPicker({
    paths,
    onPick: 'G.reincarnatePath',
    title: 'Choose your new Dao Affinity',
    intro: `Your reborn cultivator's <b>Dao Affinity</b>. The choices are the paths this life <b>mastered</b> — your previous affinity, plus every path you reached <b>Comprehension level 5+</b> in. You'll then pick a rank-1 Gu of this path to begin the next life with.`,
    footer: '<div class="right"><button onclick="G.closeModal()">Keep cultivating</button></div>',
  });
}
export function reincarnateGuPicker(pathId) {
  return starterGuPicker(pathId, {
    onPick: 'G.reincarnateGu',
    intro: `A rank-1 Gu of your new path to begin the next life with. Equip it from your Character sheet; craft and refine many more later.`,
    footer: '<div class="right"><button onclick="G.reincarnatePathBack()">← Back</button></div>',
  });
}
export function reincarnateArchetypePicker() {
  return starterArchetypePicker({
    onPick: 'G.reincarnateArchetype',
    intro: `Your reborn combat calling — a permanent trait at <b style="color:${rarityColor(PLAYER_RARITY)}">${PLAYER_RARITY}</b> rarity (the <b>yours</b> row in each card). Pick the role for your new life.`,
    footer: '<div class="right"><button onclick="G.reincarnateArchetypeBack()">← Back</button></div>',
  });
}

// ===== ONE-TIME RE-PICK: an existing player who never chose a Dao affinity/archetype picks both =====
// Reuses the starter pickers with the SAME path set the new-game picker offers (common paths, floorReq
// <= 50) and all archetypes. Stamps the CURRENT player (no new game), gated to fire once via
// state.affinityChosen (main.js repickStart/repickArchetype).
export function repickAffinityPicker() {
  // Omit `paths` so it inherits the new-game starter set (pathList, non-locked, floorReq <= 50).
  return starterPathPicker({
    onPick: 'G.repickAffinity',
    title: 'Choose your Dao Affinity',
    intro: `Your cultivator never set a <b>Dao Affinity</b>. Choose one of the foundational paths now. Affinity grants <b>+${Math.round((AFFINITY_EFFECT_MULT - 1) * 100)}% effect</b> and <b>+${Math.round((AFFINITY_COMP_MULT - 1) * 100)}% comprehension</b> for that path's Gu. This is a one-time choice.`,
    footer: '<div class="right"><span class="muted small">Pick a path to continue →</span></div>',
  });
}
export function repickArchetypePicker() {
  return starterArchetypePicker({
    onPick: 'G.repickArchetype',
    title: 'Choose your Archetype',
    intro: `Your combat calling — a permanent trait stamped on your cultivator at <b style="color:${rarityColor(PLAYER_RARITY)}">${PLAYER_RARITY}</b> rarity (the <b>yours</b> row in each card). Pick the role that fits how you fight. This is a one-time choice.`,
    footer: '<div class="right"><button onclick="G.repickAffinityBack()">← Back</button></div>',
  });
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
// HP-bar label: plain HP, plus a cyan "+shield" when the unit carries temp-HP (killer-move shield), so
// the readout shows e.g. "1715+380" instead of hiding the shield. Cyan matches the .ub-shield overlay.
const hpNumHtml = (u) => {
  const hp = compact(Math.max(0, u.hp));
  return u.shield > 0 ? `${hp}<span class="ub-sh-num">+${compact(u.shield)}</span>` : hp;
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
// Positive killer-move BUFFS (and the timed Sentinel taunt) — shown with an ▲ and a warmer palette so
// they read as gains, distinct from the debuff chips above. Keys = the stat (battle.js statusSnap maps
// buff_atk→'atk' etc.) plus 'taunt'.
const BUFF_UI = {
  atk:    { abbr: 'ATK', color: '#e0a23c' },
  def:    { abbr: 'DEF', color: '#6fa8dc' },
  spd:    { abbr: 'SPD', color: '#5aa9e6' },
  thorns: { abbr: 'THN', color: '#9ad06f' },
  evasion:{ abbr: 'EVA', color: '#7fd0a0' },
  taunt:  { abbr: 'TNT', color: '#c79a45' },
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
  if (s.b) { // positive killer-move buff (ATK/DEF/SPD/Thorns) or a timed taunt → ▲ + warm palette
    const ui = BUFF_UI[s.t] || { abbr: (s.t || '?').slice(0, 3).toUpperCase(), color: 'var(--jade)' };
    const title = s.t === 'taunt' ? 'Taunting — draws enemy aggro' : `+${Math.round((s.mag || 0) * 100)}% ${ui.abbr} (buff)`;
    return `<span class="ust ust-buff" style="color:${ui.color};border-color:${ui.color}66" title="${esc(title)}">▲${ui.abbr}</span>`;
  }
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
  // Gu CHANNEL indicator: how many equipped Gu are currently channelled vs total. Drops below total when
  // essence is too low to channel the whole loadout (any starved Gu — its effect already left combat).
  const guN = u.guN || 0, guAct = u.activeGu == null ? guN : u.activeGu;
  const guBadge = guN > 0 ? `<div class="ub-gu${guAct < guN ? ' starved' : ''}" title="Gu channelled (essence-gated): ${guAct} of ${guN}">蠱 ${guAct}/${guN}</div>` : '';
  return `<div class="ublock ${side === 'foe' ? 'enemy' : ''} ${row === 'back' ? 'back' : ''}${cult ? ' ub-cult' : ''} ${u.hp <= 0 ? 'dead' : ''}" id="ub-${side}-${idx}"${title} style="${tileStyle(side, row, u.lane)}">
    ${traitSeal(u)}
    <div class="ub-status">${stBadges}</div>
    ${guBadge}
    <div class="ub-name"${nameStyle}>${cult ? '◆ ' : ''}${u.name}</div>
    ${imprintStars(u.imprint, 'ub-imp')}
    <div class="ub-bar hp val"><i style="width:${pctHp(u.hp, u.max)}%"></i><u class="ub-shield" style="width:${u.shield && u.max ? Math.min(100, (100 * u.shield) / u.max) : 0}%"></u><b class="ub-num">${hpNumHtml(u)}</b></div>
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
  el.classList.remove('arena-vs');
}
// Ranked-PvP bout header — replaces the floor/wave readout with the opponent label during an arena fight.
function setArenaHeader(arena) {
  const f = $('arena-floor'); if (f) { f.textContent = `擂 Arena · vs ${arena.opponent}`; f.classList.remove('boss'); f.classList.add('arena-vs'); }
  const w = $('wave-ind'); if (w) w.textContent = 'Ranked Bout';
}
// Arena bout result — a VICTORY/DEFEAT stamp over the battlefield after a ranked fight (opponent + rating
// delta). Persists until the next fight starts; playTimeline clears it. Battle-tab (animated) fights only.
export function showArenaResult(won, opponent, delta, points) {
  const arena = document.querySelector('.arena'); if (!arena) return;
  clearArenaResult();
  const sign = delta >= 0 ? '+' : '';
  const el = document.createElement('div');
  el.id = 'arena-result'; el.className = 'arena-result ' + (won ? 'win' : 'lose');
  el.innerHTML = `<b class="ar-verdict">${won ? '勝' : '敗'}</b>
    <b class="ar-title">${won ? 'VICTORY' : 'DEFEAT'}</b>
    <span class="ar-opp">vs ${esc(opponent)}</span>
    <span class="ar-delta">Rating ${sign}${delta} → ${points}</span>`;
  arena.appendChild(el);
}
export function clearArenaResult() { const e = $('arena-result'); if (e) e.remove(); }
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
function traitRow(u, side, idx, hideGu) {
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
  const guHtml = hideGu
    ? '<div class="tp-nogu">蠱 Gu loadout concealed</div>'
    : gu.length
      ? `<ul class="tp-gu">${gu.map((g) => `<li><b>${esc(g.name)}</b><span class="tp-gueff">${esc(g.eff)}</span></li>`).join('')}</ul>`
      : '<div class="tp-nogu">No Gu equipped</div>';
  const idAttr = side != null ? ` id="tp-${side}-${idx}"` : '';
  return `<div class="tp-unit"${idAttr}>
    <div class="tp-row tp-trait">
      <span class="tp-seal" style="color:${color};border-color:${color}66">${glyph}</span>
      <span class="tp-body"><b>${esc(u.name)}</b>${(u.imprint || 0) > 0 ? ' ' + imprintStars(u.imprint) : ''}${tags.length ? `<span class="tp-eff">${esc(tags.join(' · '))}</span>` : ''}</span>
    </div>
    <div class="tp-buffs" style="display:none"></div>
    ${lineEffHtml}
    ${guHtml}
  </div>`;
}
// Build a side's panel HTML: active auras section (if any) + a per-cultivator section (traits + Gu).
function traitPanelHtml(units, auras, side, hideGu) {
  const auraRows = (auras || []).map(auraRow).join('');
  // keep the TRUE index (for live buff updates: tp-{side}-{i} aligns with the timeline snapshot arrays);
  // dead units render nothing but their slot index is preserved for the living ones.
  const unitRows = (units || []).map((u, i) => ((u.hp > 0 || u.hp == null) ? traitRow(u, side, i, hideGu) : '')).join('');
  if (!auraRows && !unitRows) return '<div class="tp-empty">No active auras or traits.</div>';
  return `${auraRows ? `<div class="tp-h">Team Auras</div>${auraRows}` : ''}${unitRows ? `<div class="tp-h">Cultivators &amp; Gu</div>${unitRows}` : ''}`;
}
// Repaint both side panels. `foeAuras` is a single enemy-wave aura (object|null) or an array of them.
export function renderTraitPanels(allyUnits, allyAuras, foeUnits, foeAuras, opts = {}) {
  const A = $('traits-A'), B = $('traits-B');
  const foe = Array.isArray(foeAuras) ? foeAuras : (foeAuras ? [foeAuras] : []);
  if (A) A.innerHTML = traitPanelHtml(allyUnits, allyAuras, 'ally', false);
  // opts.hideFoeGu: PvP arena — conceal the enemy's Gu loadout (auras + archetype bonuses still show).
  if (B) B.innerHTML = traitPanelHtml(foeUnits, foe.filter(Boolean), 'foe', !!opts.hideFoeGu);
}

// ---- animated timeline playback ----
const _sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Sleep that bails out within ~100ms once abortTimeline() is raised — used for the long gauge-fill wait
// so an interrupting attempt/auto-challenge cancels the animation near-instantly even on slow fights.
async function _sleepAbort(ms) {
  let waited = 0;
  while (waited < ms && !_timelineAbort) { const chunk = Math.min(100, ms - waited); await _sleep(chunk); waited += chunk; }
}
function dmgPopup(host, text, cls, dy, life) {
  if (!host) return null;
  const d = document.createElement('div'); d.className = 'dmgpop ' + (cls || ''); d.textContent = text;
  if (dy) d.style.marginTop = dy + 'px';
  host.appendChild(d); setTimeout(() => d.remove(), life || 760);
  return d;
}
// Shift a group of popups horizontally (as one) so they stay within the viewport — used for the wide
// killer-move banner, which is centred on the actor and would otherwise clip off-screen at arena edges.
function clampBannerX(els) {
  els = els.filter(Boolean); if (!els.length) return;
  const pad = 10; let minL = Infinity, maxR = -Infinity;
  for (const el of els) { const r = el.getBoundingClientRect(); if (r.left < minL) minL = r.left; if (r.right > maxR) maxR = r.right; }
  let dx = 0;
  if (minL < pad) dx = pad - minL;                          // overflow left → push right
  else if (maxR > innerWidth - pad) dx = (innerWidth - pad) - maxR; // overflow right → push left
  if (dx) for (const el of els) el.style.marginLeft = Math.round(dx) + 'px';
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
  clearArenaResult();                   // wipe any lingering result stamp from a previous bout
  if (ctx.arena) setArenaHeader(ctx.arena); // ranked PvP: label the opponent instead of a floor / wave
  else { setWaveIndicator(1, tl.waves.length); setArenaFloor(ctx.floor, ctx.isBoss); }
  // per-side Auras & Traits panel: ally auras are fixed for the fight; foe auras swap with each wave.
  renderTraitPanels(allies, tl.allyAuras || [], foes, (tl.waveAuras || [])[0], { hideFoeGu: !!ctx.arena });

  const el = (side, i) => $(`ub-${side}-${i}`);
  const unit = (side, i) => (side === 'ally' ? allies[i] : foes[i]);
  const drawHp = (side, i) => { const u = unit(side, i), e = el(side, i); if (!u || !e) return;
    e.querySelector('.hp>i').style.width = pctHp(u.hp, u.max) + '%';
    const sh = e.querySelector('.ub-shield'); if (sh) sh.style.width = (u.shield && u.max ? Math.min(100, (100 * u.shield) / u.max) : 0) + '%';
    const num = e.querySelector('.hp .ub-num'); if (num) num.innerHTML = hpNumHtml(u);
    e.classList.toggle('dead', u.hp <= 0); };
  // Gu channel indicator: reflect how many of the unit's Gu are currently channelled (essence-gated).
  const drawGu = (side, i) => { const u = unit(side, i), e = el(side, i); if (!u || !e) return;
    const g = e.querySelector('.ub-gu'); if (!g) return; const n = u.guN || 0;
    if (n <= 0) { g.style.display = 'none'; return; }
    const a = u.activeGu == null ? n : u.activeGu;
    g.textContent = `蠱 ${a}/${n}`; g.title = `Gu channelled (essence-gated): ${a} of ${n}`;
    g.classList.toggle('starved', a < n); };
  const drawChg = (side, i, g, ms) => { const e = el(side, i); if (!e) return;
    const bar = e.querySelector('.chg>i'); if (ms != null) bar.style.transitionDuration = ms + 'ms';
    const pct = Math.max(0, Math.min(100, (100 * g) / GAUGE_MAX));
    bar.style.width = pct + '%'; e.classList.toggle('full', pct >= 99.9); };
  const drawEss = (side, i, val, ms) => { const u = unit(side, i), e = el(side, i); if (!u || !e || !u.essMax) return;
    const bar = e.querySelector('.ess>i'); if (!bar) return; if (ms != null) bar.style.transitionDuration = ms + 'ms';
    u.ess = val; bar.style.width = Math.max(0, Math.min(100, (100 * val) / u.essMax)) + '%';
    const num = e.querySelector('.ess .ub-num'); if (num) num.textContent = compact(val); };
  // refresh the active-status badge row on a block from a timeline snapshot ([{t,n,b,mag}]) — debuffs + buffs
  const drawStatuses = (side, i, list) => { const e = el(side, i); if (!e) return;
    const host = e.querySelector('.ub-status'); if (host) host.innerHTML = (list || []).map(statusChip).join(''); };
  // Mender aura feedback: float a green heal number on each restored ally + a "cleansed" tag on each
  // ally that lost a debuff this action (both ride the act's own impact beat, on the actors' side).
  const floatSupport = (act) => {
    (act.heals || []).forEach((h) => { const he = el(h.side, h.i); if (he && h.amt > 0) dmgPopup(he, '+' + compact(h.amt), 'heal'); });
    (act.cleansed || []).forEach((c) => { const ce = el(c.side, c.i); if (ce) dmgPopup(ce, 'cleansed', 'cleanse', 48); });
  };
  // mirror just the BUFF chips into the side "Cultivators & Gu" panel row for this unit (tp-{side}-{i})
  const drawTraitBuffs = (side, i, list) => {
    const host = document.getElementById(`tp-${side}-${i}`); if (!host) return;
    const slot = host.querySelector('.tp-buffs'); if (!slot) return;
    const buffs = (list || []).filter((s) => s.b);
    slot.innerHTML = buffs.map(statusChip).join('');
    slot.style.display = buffs.length ? '' : 'none';
  };

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
      renderTraitPanels(allies, tl.allyAuras || [], foes, (tl.waveAuras || [])[wave], { hideFoeGu: !!ctx.arena }); // new wave → its foe panel
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
      if (ae && act.dots) { let off = 0; for (const t of ['burn', 'poison', 'bleed']) if (act.dots[t]) { dmgPopup(ae, compact(act.dots[t]), 'dot dot-' + t, off); off += 44; } }
      else if (ae && act.dot > 0) dmgPopup(ae, compact(act.dot), 'dot');
      if (ae && act.stun) dmgPopup(ae, act.frozen ? 'FROZEN' : 'STUN', act.frozen ? 'stun frozen' : 'stun', act.dot > 0 ? 48 : 0);
      // KILLER MOVE: float a name banner + backdrop glyph on the actor and flash/float damage·status on
      // EACH hit. A damaging / status-inflicting move LUNGES toward its primary target like a normal
      // attack (the actor block travels across the board); a pure heal/buff move stays in place.
      if (act.combo) {
        const cbs = ae ? ae.closest('.bside') : null;
        if (ae) { ae.classList.add('lunging', 'casting'); if (cbs) cbs.classList.add('lunge-active');
          const _g = dmgPopup(ae, act.combo.cjk || '✦', 'combo-cjk', -76, 1260); const _n = dmgPopup(ae, act.combo.name, 'combo', 0, 1260);
          clampBannerX([_g, _n]); } // keep the wide banner on-screen near arena edges
        Audio.crit();
        // coloured aura on each affected unit: red hostile (damage/debuff) · green heal/buff · blue guard · red-orange warcry
        const auraEls = (act.auras || []).map((g) => { const e = el(g.side, g.i); if (e) e.classList.add('km-aura', 'km-' + g.kind); return e; }).filter(Boolean);
        // LUNGE OUT toward the primary enemy target (first hit) for damaging/status moves
        const lt = (act.hits && act.hits.length) ? act.hits[0].tgt : null;
        const lte = lt ? el(lt.side, lt.i) : null;
        if (ae && lte) { ae.style.transition = `transform ${LUNGE_OUT}ms cubic-bezier(.5,0,.85,.5)`; ae.style.transform = lungeVector(ae, lte); }
        await _sleep(lte ? LUNGE_OUT : ACT_MS);
        for (const h of (act.hits || [])) {
          const he = el(h.tgt.side, h.tgt.i); if (!he) continue;
          if (h.dodged) { dmgPopup(he, 'miss', 'miss'); Audio.miss(); }
          else if (h.dmg > 0) { he.classList.add('hit'); dmgPopup(he, compact(h.dmg) + (h.lucky ? '‼' : h.crit ? '!' : ''), h.lucky ? 'crit lucky' : h.crit ? 'crit' : ''); Audio.hit(); }
          if (h.applied) { let off = 52; for (const t of h.applied) if (STATUS[t]) { dmgPopup(he, STATUS[t].label, 'status status-' + t, off); off += 44; } }
        }
        (act.hp || []).forEach((h) => { const u = unit(h.side, h.i); if (u) { if (u.hp > 0 && h.hp <= 0) Audio.death(); u.hp = h.hp; u.shield = h.shield || 0; if (h.max != null) u.max = h.max; if (h.essMax != null) u.essMax = h.essMax; if (h.ag != null) u.activeGu = h.ag; drawHp(h.side, h.i); drawGu(h.side, h.i); } });
        if (ae && lte) { ae.style.transition = `transform ${LUNGE_BACK}ms ease`; ae.style.transform = ''; } // RECOVER home
        await _sleep(IMPACT_MS + LUNGE_BACK + 700); // killer-move beat held +0.5s longer (aura + banner linger; next action delayed)
        for (const h of (act.hits || [])) { const he = el(h.tgt.side, h.tgt.i); if (he) he.classList.remove('hit'); }
        auraEls.forEach((e) => e.classList.remove('km-aura', 'km-hostile', 'km-heal', 'km-guard', 'km-warcry'));
        if (ae) { ae.classList.remove('lunging', 'casting'); ae.style.transition = ''; ae.style.transform = ''; if (cbs) cbs.classList.remove('lunge-active'); }
        continue;
      }
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
        if (act.applied) { let off = 52; for (const t of act.applied) if (STATUS[t]) { dmgPopup(te, STATUS[t].label, 'status status-' + t, off); off += 44; } }
      }
      (act.hp || []).forEach((h) => { const u = unit(h.side, h.i); if (u) { if (u.hp > 0 && h.hp <= 0) Audio.death(); u.hp = h.hp; u.shield = h.shield || 0; drawHp(h.side, h.i); } });
      floatSupport(act); // Mender aura: green heal numbers + "cleansed" tags on affected allies
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
      step.statuses.ally.forEach((list, i) => { drawStatuses('ally', i, list); drawTraitBuffs('ally', i, list); });
      step.statuses.foe.forEach((list, i) => { drawStatuses('foe', i, list); drawTraitBuffs('foe', i, list); });
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
  const anyBenched = S().roster.some((c) => !c.isPlayer && !c.active); // dismissable cultivators exist
  return `<div class="teamctl">
    <span class="muted small">Sort</span><div class="viewtoggle">${Object.keys(TEAM_SORTS).map(sb).join('')}</div>
    <span class="muted small">Show</span><div class="viewtoggle">${fb('all', 'All')}${fb('active', 'Active')}${fb('reserve', 'Reserve')}</div>
    <span class="muted small">Rarity</span><select onchange="G.setView('teamRarity',this.value)">${rarOpts}</select>
    <span class="muted small">Path</span><select onchange="G.setView('teamPath',this.value)">${pathOpts}</select>
    <input class="searchbox" type="text" placeholder="Search cultivators…" value="${esc(searchV || '')}" oninput="G.teamSearch(this.value)">
    ${filtered ? '<button class="danger" onclick="G.clearTeamFilters()">✕ Clear</button>' : ''}
    ${anyBenched ? '<button onclick="G.bulkDismissPrompt()" title="Select multiple benched cultivators to release for Immortal Essence">⊘ Dismiss…</button>' : ''}
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
// Rich themed-tooltip body for an equipped Gu (tier · name · path · EFFECT · essence, plus optional
// channel priority / starved). Embedded as a hidden `.tip` child of a `.tip-host` chip so the portal
// (initTooltips) floats it as a design-sheet card — the effect line is the part players actually need.
function guTipBody(gu, extra = {}) {
  const sub = [pathName(gu.daoPath)];
  if (isUnique(gu)) sub.push('Unique');
  if (extra.priority) sub.push(`P${extra.priority}${extra.ok === false ? ' · starved' : ''}`);
  const ess = extra.cost != null ? `Essence ◇${Math.round(extra.cost)}/use` : `Essence ◇${guEssenceCost(gu)}`;
  return `<b class="tip-head">T${gu.tier} ${esc(gu.name)}</b>`
    + `<span class="tip-sub">${sub.join(' · ')}</span>`
    + `<span class="tip-eff"><span>${effectText(gu)}</span><span>${ess}</span></span>`;
}

// One hero card for a deployed cultivator (Active Team panel, 3×2).
function activeSlotCard(c) {
  const s = effectiveStats(c);
  const rc = rarityColor(c.rarity);
  const pos = `${rowOf(c) === 'back' ? 'BACK' : 'FRONT'} · L${laneOf(c) + 1}`;
  const rank = rankOf(c.realm) + 1;
  // Gu chips in channel-priority order + empty slots (each opens the picker at that slot)
  const pool = s.essencePool; let cum = 0, lit = 0, equipped = 0;
  const chips = Array.from({ length: guSlotsOf(c) }).map((_, i) => {
    const gu = c.gu[i] ? guOf(c.gu[i]) : null;
    if (!gu) return `<i class="tc-chip empty" onclick="G.openGuPicker('${c.id}',${i})" title="Empty slot ${i + 1}">＋</i>`;
    equipped++; cum += guEssenceCostFor(gu, rank);
    const ok = cum <= pool + 1e-9; if (ok) lit++;
    const col = pathColor(gu.daoPath);
    return `<i class="tc-chip tip-host${ok ? '' : ' starved'}" style="color:${col};border-color:${col}55"
      onclick="G.openGuPicker('${c.id}',${i})">${pathCjk(gu.daoPath)}<span class="tip">${guTipBody(gu, { priority: i + 1, ok, cost: guEssenceCostFor(gu, rank) })}</span></i>`;
  }).join('');
  const killer = killerSummary ? killerSummary(c) : '';
  return `<div class="card h4-card" style="border-top-color:${rc}" onclick="G.openChar('${c.id}')">
    <div class="h4-head">
      <span class="tc-seal cjk" style="color:${rc};border-color:${rc}88">${charGlyph(c) || '蛊'}</span>
      <div class="h4-id">
        <b style="color:${rc}">${esc(c.name)}${c.isPlayer ? '<i class="h4-you">you</i>' : ''}</b>
        <span>${c.rarity} · ${realmName(c.realm)}${(c.imprint || 0) > 0 ? ' ' + imprintStars(c.imprint) : ''}</span>
      </div>
      <span class="h4-pos">${pos}</span>
    </div>
    <div class="h4-stats">
      <div><span>ATK</span><b>${compact(s.atk)}</b></div><div><span>HP</span><b>${compact(s.maxHp)}</b></div>
      <div><span>DEF</span><b>${compact(s.def)}</b></div><div><span>SPD</span><b>${s.spd}</b></div>
    </div>
    <div class="h4-gulbl"><span>GU · tap a slot to equip</span><i>◇ sustains ${lit}/${equipped || 0}</i></div>
    <div class="tc-chips" onclick="event.stopPropagation()">${chips}</div>
    <div class="h4-foot" onclick="event.stopPropagation()">
      ${killer ? `<span class="t1-killer">${killer}</span>` : '<span class="h4-nok">no killer move</span>'}
      <span class="h4-acts">
        <button class="mini" onclick="G.openChar('${c.id}')">Sheet</button>
        ${c.isPlayer ? '' : `<button class="mini" onclick="G.toggleActive('${c.id}')">Bench</button>`}
      </span>
    </div>
  </div>`;
}

function emptySlotCard(n) {
  return `<div class="card h4-card h4-empty"><div>
    <div class="big" style="color:var(--muted)">Empty Slot ${n}</div>
    <div class="tiny muted" style="margin-top:7px">Deploy a reserve from the roster below</div></div></div>`;
}

function activeTeamPanel() {
  const active = charNavOrder().filter((c) => c.active);
  const cells = [];
  for (let i = 0; i < 6; i++) cells.push(active[i] ? activeSlotCard(active[i]) : emptySlotCard(i + 1));
  return `<div class="h4-grid">${cells.join('')}</div>`;
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
  <div class="h4-roster" id="rosterResults">${rosterCardsHtml()}</div>`;
}
// ---------- formation ----------
let fmSelId = null; // unit shown in the inspector (module-level — survives re-renders, not persisted)
export function fmSelect(id) { fmSelId = id; const w = $('fmWrap'); if (w) w.innerHTML = renderFormation(); }
const fmSelected = () => activeTeam().find((c) => c.id === fmSelId)
  || S().roster.find((c) => c.isPlayer && c.active) || activeTeam()[0] || null;

// One occupied board tile. Draggable; click selects into the inspector.
function fmUnit(c, sel) {
  const s = effectiveStats(c);
  const rc = rarityColor(c.rarity);
  return `<div class="fmunit${sel ? ' sel' : ''}" draggable="true" ondragstart="G.dragStart(event,'${c.id}')"
    onclick="G.fmSelect('${c.id}')" title="${esc(c.name)} — ${c.rarity} · ${realmName(c.realm)}">
    ${charGlyph(c) ? `<span class="fm4-seal cjk" style="color:${rc}">${charGlyph(c)}</span>` : ''}
    <span class="uname" style="color:${rc}">${c.name}</span>
    <span class="fmrealm">${realmName(c.realm)}${(c.imprint || 0) > 0 ? ' ' + imprintStars(c.imprint) : ''}</span>
    <span class="muted tiny">A ${compact(s.atk)} · H ${compact(s.maxHp)} · S ${s.spd}</span>
    ${c.isPlayer ? '' : `<button class="fmx" title="Bench" onclick="event.stopPropagation();G.benchChar('${c.id}')">×</button>`}
  </div>`;
}

// Reserve filter bar (sort + rarity + path) — unchanged wiring, lives above the deploy list.
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

// The 2×5 board with lane headers, shield-direction row labels and the enemy-side rule.
function fmBoardHtml(sel) {
  const lanes = [...Array(LANES).keys()];
  const rowHtml = (row) => lanes.map((lane) => {
    const occ = tileOccupant(row, lane);
    return `<div class="fmtile${occ ? ' on' : ''}${occ && sel && occ.id === sel.id ? ' seltile' : ''}"
      ondragover="G.dragOver(event)" ondragleave="G.dragLeave(event)" ondrop="G.dropTile(event,'${row}',${lane})"
      ${occ ? `style="border-left:3px solid ${rarityColor(occ.rarity)}"` : ''}>${occ ? fmUnit(occ, sel && occ.id === sel.id) : `<span class="muted tiny">L${lane + 1}</span>`}</div>`;
  }).join('');
  return `<div class="card formation fm4-board">
    <div class="fm4-lanehead"><span></span>${lanes.map((l) => `<i>LANE ${l + 1}</i>`).join('')}</div>
    <div class="fmboard fm4">
      <div class="fmrowlbl">Front<i>shields</i></div><div class="fmrow">${rowHtml('front')}</div>
      <div class="fmrowlbl">Back<i>shielded</i></div><div class="fmrow">${rowHtml('back')}</div>
    </div>
    <div class="fm4-enemy">敵 — enemy side · front row meets them first</div>
  </div>`;
}

// One reserve row: identity + stats + one-click deploys (also draggable onto the board).
function fmReserveRow(c) {
  const s = effectiveStats(c);
  const rc = rarityColor(c.rarity);
  return `<div class="fm4-row" style="border-left-color:${rc}" draggable="true" ondragstart="G.dragStart(event,'${c.id}')">
    ${charGlyph(c) ? `<span class="fm4-rseal cjk" style="color:${rc}">${charGlyph(c)}</span>` : ''}
    <b style="color:${rc}">${c.name}</b>
    <span class="fm4-sub">${realmName(c.realm)}${(c.imprint || 0) > 0 ? ' ' + imprintStars(c.imprint) : ''}</span>
    <span class="fm4-stats">A ${compact(s.atk)} · H ${compact(s.maxHp)} · S ${s.spd}</span>
    <span class="fm4-acts">
      <button class="mini" onclick="G.deployTo('${c.id}','front')">→ Front</button>
      <button class="mini" onclick="G.deployTo('${c.id}','back')">→ Back</button>
    </span>
  </div>`;
}

// Sticky Unit Inspector: stats, position + lane coverage, killer move, Gu load, team summary.
function fmInspectorHtml(sel) {
  if (!sel) return '<div class="fm4-h">Unit Inspector</div><div class="muted small">Deploy a fighter to inspect them.</div>';
  const s = effectiveStats(sel);
  const rc = rarityColor(sel.rarity);
  const lane = laneOf(sel), row = rowOf(sel);
  const lo = Math.max(1, lane), hi = Math.min(LANES, lane + 2); // ±1 reach, 1-based display
  const team = activeTeam();
  const front = team.filter((c) => rowOf(c) === 'front').length;
  const guN = (sel.gu || []).filter(Boolean).length;
  return `<div class="fm4-h">Unit Inspector</div>
    <div class="fm4-id">
      ${charGlyph(sel) ? `<span class="fm4-bigseal cjk" style="color:${rc}">${charGlyph(sel)}</span>` : ''}
      <div><b class="fm4-name" style="color:${rc}">${sel.name}</b>
        <div class="fm4-isub">${sel.rarity} · ${realmName(sel.realm)}${(sel.imprint || 0) > 0 ? ` · <span class="fm4-imp">${imprintStars(sel.imprint)}</span>` : ''}</div></div>
    </div>
    <div class="fm4-statgrid">
      <div><span>HP</span><b>${fmt(s.maxHp)}</b></div><div><span>ATK</span><b>${fmt(s.atk)}</b></div>
      <div><span>DEF</span><b>${fmt(s.def)}</b></div><div><span>SPD</span><b>${s.spd}</b></div>
    </div>
    <div class="fm4-irow"><span class="fm4-h">Position</span><span class="fm4-pos">${row.toUpperCase()} · LANE ${lane + 1} <i>· strikes lanes ${lo}–${hi}</i></span></div>
    <div class="fm4-irow"><span class="fm4-h">Killer Move</span><span>${killerSummary(sel)}</span></div>
    <div class="fm4-irow"><span class="fm4-h">Gu</span><span>蠱 ${guN} equipped${guN ? '' : ' <span class="muted">— equip on the Team tab</span>'}</span></div>
    ${breakthroughChip(sel)}
    <div class="fm4-iacts">
      <button class="mini" onclick="G.openChar('${sel.id}')">Open Sheet</button>
      ${sel.isPlayer ? '' : `<button class="mini" onclick="G.benchChar('${sel.id}')">Bench</button>`}
    </div>
    <hr class="fm4-rule">
    <div class="fm4-h">Team</div>
    <div class="fm4-team">
      <div><span>Deployed</span><b>${team.length} / 6</b></div>
      <div><span>Front / Back</span><b>${front} / ${team.length - front}</b></div>
    </div>`;
}

function renderFormation() {
  const st = S().settings;
  const sort = TEAM_SORTS[st.fmSort] ? st.fmSort : 'power';
  const rar = st.fmRarity || 'all';
  const pathF = st.fmPath || 'all';
  let bench = S().roster.filter((c) => !c.active);
  if (rar !== 'all') bench = bench.filter((c) => c.rarity === rar);
  if (pathF !== 'all') bench = bench.filter((c) => c.gu.some((uid) => { const g = guOf(uid); return g && g.daoPath === pathF; }));
  bench.sort(TEAM_SORTS[sort].cmp);
  const anyReserve = S().roster.some((c) => !c.active);
  const sel = fmSelected();
  const benchHtml = bench.length
    ? bench.map(fmReserveRow).join('')
    : `<div class="muted small" style="padding:10px 2px">${anyReserve ? 'No reserves match these filters.' : 'No reserves — recruit more in 召 Recruit.'}</div>`;
  return `<div class="fm4-split">
    <div>
      ${fmBoardHtml(sel)}
      ${secHead(2, 'Reserves', 'click to deploy — drag works too')}
      ${formationControls(sort, rar, pathF, bench.length)}
      ${benchHtml}
    </div>
    <aside class="fm4-desk">${fmInspectorHtml(sel)}</aside>
  </div>`;
}

// Dedicated Formation page — board + inspector + quick-deploy reserves.
export function viewFormation() {
  return `${pagehead('阵', 'Battle Array · 布阵', 'Formation',
    'Arrange your active fighters on the 2×5 board. A <b>front</b> unit shields the <b>back</b> unit in its lane until it falls; units strike only within <b>±1 of their own lane</b>, reaching farther only when those are clear. Max 6 fighters, ≤5 per row. Turn order is by SPD, not position.')}
  <div id="fmWrap">${renderFormation()}</div>`;
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
// PROGRESSION GATE (mirrors battle.js attachKiller): killer moves are usable only on rank 3+ cultivators
// AND after the player has cleared Floor 100 (combos.js KILLER_MIN_RANK / KILLER_UNLOCK_FLOOR).
function killerUnlocked(c) {
  return rankOf(c.realm) + 1 >= KILLER_MIN_RANK && !!S().clearedFloors[KILLER_UNLOCK_FLOOR];
}
// One-line summary of a character's configured killer move (name + synergy), or a "not set"/locked note.
function killerSummary(c) {
  if (!killerUnlocked(c)) return `<span class="muted">🔒 Unlocks at Rank ${KILLER_MIN_RANK} · Floor ${KILLER_UNLOCK_FLOOR}</span>`;
  const cfg = c.killer || {};
  const equipped = (c.gu || []).filter(Boolean);
  const support = (cfg.support || []).filter((u) => equipped.includes(u));
  if (cfg.core && cfg.archetype && validateKiller({ core: cfg.core, support, archetype: cfg.archetype }, equipped, guOf)) {
    const spec = assemble(cfg.archetype, guOf(cfg.core), support.map(guOf));
    if (spec) return `<b style="color:${pathColor(guOf(cfg.core).daoPath)}">${esc(spec.name)}</b> <span class="muted">· synergy ${synergyLabel(spec.favorability)}</span>`;
  }
  return '<span class="muted">no killer move set</span>';
}
// One compact roster row (replaces the old member card grid — rosterCardsHtml/viewTeam unchanged,
// but swap their wrapper class "grid cards" → "h4-roster" so rows stack; see README step 1b).
function memberCard(c) {
  const s = effectiveStats(c);
  const rc = rarityColor(c.rarity);
  const gu = c.gu.map((uid, i) => {
    const g = uid && guOf(uid);
    return g ? `<i class="tc-chip sm tip-host" style="color:${pathColor(g.daoPath)};border-color:${pathColor(g.daoPath)}55">${pathCjk(g.daoPath)}<span class="tip">${guTipBody(g)}</span></i>` : '';
  }).join('');
  const lid = lineOf(c);
  return `<div class="h4-row${c.active ? ' act' : ''}" style="border-left-color:${rc}" onclick="G.openChar('${c.id}')">
    <span class="tc-seal cjk" style="color:${rc};border-color:${rc}88;width:26px;height:26px;font-size:14px">${charGlyph(c) || '蛊'}</span>
    <span class="h4-rid">
      <b style="color:${rc}">${esc(c.name)}${c.isPlayer ? '<i class="h4-you">you</i>' : ''}</b>
      <i>${c.rarity} · ${realmName(c.realm)}${lid ? ' · ' + lineName(lid, c.rarity) : ''}${(c.imprint || 0) > 0 ? ' · ' + imprintStars(c.imprint) : ''}</i>
    </span>
    <span class="h4-rstat">A ${compact(s.atk)} · H ${compact(s.maxHp)} · S ${s.spd}</span>
    <span class="tc-chips">${gu}</span>
    <span class="t1-pwr">${compact(s.atk + s.def + s.maxHp)}</span>
    <span onclick="event.stopPropagation()">
      ${c.active
        ? (c.isPlayer ? '<span class="muted tiny">always active</span>' : `<button class="mini" onclick="G.toggleActive('${c.id}')">Bench</button>`)
        : `<button class="mini primary" onclick="G.toggleActive('${c.id}')">Deploy</button>`}
    </span>
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
  const invested = spentPoints(c);
  const rCost = respecCost(c), rEss = RESPEC_ESSENCE_COST;
  const canAfford = S().stones >= rCost && S().essence >= rEss;
  return `<div class="cs-alloc">
      <span class="pill${unspent > 0 ? ' glow' : ''}">${compact(unspent)} unspent points</span>
      <span class="muted small">Per click</span><div class="viewtoggle">${allocStepBtns()}</div>
      ${totalStaged > 0 ? `<span class="pill staged-pill">${compact(totalStaged)} staged · ${compact(remaining)} left</span>` : ''}
      <button class="mini primary" ${totalStaged <= 0 ? 'disabled' : ''} onclick="G.allocCommit('${c.id}')">✓ Confirm distribution</button>
      <button class="mini" ${totalStaged <= 0 ? 'disabled' : ''} onclick="G.allocClear('${c.id}')">Reset</button>
      <button class="mini danger"${invested <= 0 ? ' disabled' : ''}${canAfford || invested <= 0 ? '' : ' style="opacity:.65"'} title="${invested <= 0 ? 'No allocated attributes to respec' : `Release all ${compact(invested)} allocated points for ${rCost.toLocaleString()} 石 (1,000 石 each) + ${rEss.toLocaleString()} ✦${canAfford ? '' : ' — not enough 石/✦'}`}" onclick="G.respecPrompt('${c.id}')">↺ Respec${invested > 0 ? ` · ${compact(rCost)}石 · ${rEss}✦` : ''}</button>
      <span class="muted small">Allocation is permanent unless you Respec (1,000 石 per invested point + ${rEss} ✦); every realm grants more points.</span>
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
    ${cell('Crit Resist', pct(s.critResist))}
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
    // Immortal Gu (tier 6+) are UNUSABLE without Immortal Essence Stones (仙石) — flag them inert when the pool is empty.
    const immInert = gu.tier >= 6 && (S().immortalStones || 0) <= 0;
    const immTag = immInert
      ? `<div class="gu-starved" title="An immortal Gu draws on Immortal Essence Stones (仙石) — your pool is empty, so it is inert. ${immortalUnlocked() ? 'Clear floors to gather more.' : 'Reach immortal Rank 6 to unlock the currency.'}">仙石 ✕ inert · no Immortal Essence Stones</div>`
      : '';
    return `<div class="gu-card${m.sustained ? '' : ' starved'}${immInert ? ' starved' : ''}" style="cursor:pointer" onclick="G.openGuPicker('${c.id}',${i})">
      <div class="gu-top"><span>${prio} <b class="tierbadge" style="color:var(--t${gu.tier});border-color:var(--t${gu.tier})">T${gu.tier}</b>${isUnique(gu) ? ' <span class="pill unique">UNIQUE</span>' : ''}</span>
        <span class="gu-reorder">${upBtn}${dnBtn}</span></div>
      <div class="gu-glyph" style="color:${col}">${pathCjk(gu.daoPath)}</div>
      <div class="gu-name">${gu.name}</div>
      <div class="gu-eff">${effectText(gu)}</div>
      <div class="gu-ess"${essCol ? ` style="color:${essCol}"` : ''} title="base ${baseEss}/use · rank ${rank} wielder vs T${gu.tier} Gu">◇ Essence · ${effEss}/use${essArrow}</div>
      ${immTag}
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

// KILLER MOVE config (character sheet): pick an ARCHETYPE → a CORE Gu of its favored domain → 2+ SUPPORT
// Gu of the core's Dao path. Favorability = how much of that same-path support also matches the favored
// domain. "Suggest" auto-fills; the preview shows the assembled effect, essence cost, synergy.
// Lore essence colors by Gu Master rank — drives the liquid gradient (see styles .ap-liquid.rN).
const APERTURE_SEA = {
  1: { name: 'Green Copper', cls: 'r1' }, 2: { name: 'Red Steel', cls: 'r2' },
  3: { name: 'White Silver', cls: 'r3' }, 4: { name: 'Yellow Gold', cls: 'r4' },
  5: { name: 'Purple Crystal', cls: 'r5' },
};
const seaOf = (c) => APERTURE_SEA[Math.min(5, Math.max(1, rankOf(c.realm) + 1))];

// CONCENTRIC-RING slot layout (700×720 box, centre 350/360). Slots spread across up to 3 rings —
// inner rings hold FEWER, outer rings MORE — so they never overlap as the Gu-slot count grows
// (3 at Rank 1 → 7 at Rank 5, + bonus slots). Returns { pos:[[x,y]…] in channel-priority order, radii }.
const MANDALA_CX = 350, MANDALA_CY = 360;
const MANDALA_RING_R = { 1: [210], 2: [162, 286], 3: [145, 235, 322] };
function mandalaSlotPos(n) {
  if (n <= 0) return { pos: [], radii: [] };
  let counts;
  if (n <= 5) counts = [n];                                    // single ring
  else if (n <= 10) { const inner = Math.max(2, Math.min(n - 3, Math.floor(n * 0.42))); counts = [inner, n - inner]; }
  else { const a = Math.floor(n * 0.2), b = Math.floor(n * 0.33); counts = [a, b, n - a - b]; } // three rings
  const radii = MANDALA_RING_R[counts.length];
  const pos = [];
  counts.forEach((cnt, ri) => {
    const r = radii[ri];
    const off = ri * (Math.PI / 8);                            // rotate each ring 22.5° so spokes never align
    for (let i = 0; i < cnt; i++) {
      const a = -Math.PI / 2 + off + (i * 2 * Math.PI / cnt);  // first slot near the top, clockwise
      pos.push([Math.round(MANDALA_CX + r * Math.cos(a)), Math.round(MANDALA_CY + r * Math.sin(a))]);
    }
  });
  return { pos, radii };
}

export function csApertureMandala(c) {
  const s = effectiveStats(c);
  const rank = rankOf(c.realm) + 1;
  const sea = seaOf(c);
  const pool = s.essencePool, regen = s.essenceRegen;
  const grade = apertureGrade(apertureCapacity(effAptitude(c)));
  // channel-priority walk: cumulative cost vs pool = sustained prefix (same math as old csGuLoadout)
  let cum = 0, lit = 0, upkeep = 0; const slots = [];
  for (let i = 0; i < guSlotsOf(c); i++) {
    const gu = c.gu[i] ? guOf(c.gu[i]) : null;
    if (gu) {
      const cost = guEssenceCostFor(gu, rank); cum += cost; upkeep += cost;
      const ok = cum <= pool + 1e-9; if (ok) lit++;
      slots.push({ gu, ok, cost, p: slots.filter((x) => x.gu).length + 1, i });
    } else slots.push({ gu: null, i });
  }
  const equipped = slots.filter((x) => x.gu).length;
  const net = Math.round((regen - upkeep) * 10) / 10;
  // Liquid LEVEL = aperture CAPACITY (the grade as a %). An Extreme aperture (capacity 1.0) fills the
  // whole sea; a D-grade sits low. (Essence channelling is shown separately by sustains/regen/upkeep.)
  const capFrac = apertureCapacity(effAptitude(c));
  const fillPct = Math.max(4, Math.min(99, Math.round(capFrac * 100)));
  const { pos, radii } = mandalaSlotPos(slots.length);
  const ringGuides = radii.map((r) => `<div class="ap-ring" style="width:${r * 2}px;height:${r * 2}px"></div>`).join('');
  const slotHtml = slots.map((sl, idx) => {
    const [x, y] = pos[idx] || [MANDALA_CX, MANDALA_CY];
    if (!sl.gu) return `<div class="ap-node empty" style="left:${x}px;top:${y}px" onclick="G.openGuPicker('${c.id}',${sl.i})" title="Empty slot ${sl.i + 1} — click to equip a Gu">
      <span class="ap-disc">＋</span><span class="ap-nname">slot ${sl.i + 1}</span></div>`;
    const col = pathColor(sl.gu.daoPath);
    return `<div class="ap-node tip-host${sl.ok ? '' : ' starved'}" style="left:${x}px;top:${y}px" onclick="G.openGuPicker('${c.id}',${sl.i})">
      <span class="tip">${guTipBody(sl.gu, { priority: sl.p, ok: sl.ok, cost: sl.cost })}</span>
      <span class="ap-disc" style="color:${col};border-color:${col}99"><i class="cjk">${pathCjk(sl.gu.daoPath)}</i><b class="ap-p">P${sl.p}</b></span>
      <span class="ap-nname">${esc(sl.gu.name)}</span>
      <span class="ap-nmeta">T${sl.gu.tier} · ◇${Math.round(sl.cost)}</span>
      <span class="ap-mv" onclick="event.stopPropagation()">
        <button class="ap-mvb" ${sl.p <= 1 ? 'disabled' : ''} title="Raise channel priority" onclick="G.moveGu('${c.id}',${sl.i},-1)">▲</button>
        <button class="ap-mvb" title="Lower channel priority" onclick="G.moveGu('${c.id}',${sl.i},1)">▼</button>
      </span>
    </div>`;
  }).join('');
  return `<div class="ap-mandala" id="ap-mandala">
    <div class="ap-box" id="ap-box">
      ${ringGuides}
      <div class="ap-liquid ${sea.cls}" title="Primeval sea · ${sea.name} · ${grade.grade}-grade">
        <i class="ap-wave w1" style="top:${100 - fillPct}%"></i>
        <i class="ap-wave w2" style="top:${102 - fillPct}%"></i>
      </div>
      <div class="ap-wall ${sea.cls}" aria-hidden="true"></div>
      <div class="ap-core">
        <span class="ap-glyph cjk" style="color:${rarityColor(c.rarity)}">${charGlyph(c) || '蛊'}</span>
        <b class="cjk">${esc(c.name)}</b>
        <i>气海 · ${sea.name.toUpperCase()} · ${grade.grade}-GRADE · ◇${Math.round(pool)}</i>
        <em>sustains ${lit} / ${equipped}</em>
        <em class="ap-net ${net < 0 ? 'dn' : 'up'}">regen +${regen.toFixed(1)} · upkeep −${Math.round(upkeep)} · ${net < 0 ? '▼' : '▲'}${Math.abs(net)} / turn</em>
      </div>
      ${slotHtml}
    </div>
    ${(!isImmortalRealm(c.realm) && c.realm < MORTAL_PEAK) ? csBreakDock(c) : ''}
  </div>`;
}

// Breakthrough dock — sits under the mandala circle; Attempt runs the 10s rite (main.js G.riteAttempt).
export function csBreakDock(c) {
  const pct = Math.round(breakthroughChance(c) * 100);
  const sea = seaOf(c);
  const nextSea = APERTURE_SEA[Math.min(5, rankOf(c.realm) + 2)];
  const ascends = nextSea && nextSea.cls !== sea.cls; // realm-up within a rank doesn't change the sea
  return `<div class="ap-btdock" id="ap-btdock">
    <span class="ap-btlbl">破境 · BREAKTHROUGH</span>
    <span class="ch2-bar" style="flex:1"><i style="width:${pct}%"></i></span>
    <span class="ap-btv">${pct}% · ${realmName(c.realm)} ▸ next</span>
    <button class="primary" id="ap-btbtn" onclick="G.riteAttempt('${c.id}')">⤴ Attempt</button>
    <span class="ap-btnext">${ascends ? `on ascension · sea turns <b>${nextSea.name}</b> · capacity &amp; regen grow` : 'realm-up · same essence grade, larger sea'}</span>
  </div>`;
}

// ---- the 10s breakthrough rite (called by G.riteAttempt AFTER attemptBreakthrough resolves) ----
// 0–5s alternating gold/dull suspense · 5–8s transition to verdict · 8–10s linger.
// On success the sea class + labels swap at the 8s reveal via the re-render.
let riteTimers = [];
export function riteRun(success, onReveal, onDone) {
  const box = document.getElementById('ap-box');
  const btn = document.getElementById('ap-btbtn');
  if (!box) { onReveal(); onDone(); return; } // tab changed — apply instantly
  riteTimers.forEach(clearTimeout); riteTimers = [];
  box.classList.add('g-sus');
  if (btn) { btn.disabled = true; btn.textContent = '破境中…'; }
  riteTimers = [
    setTimeout(() => { box.classList.remove('g-sus'); box.classList.add(success ? 'g-fin-gold' : 'g-fin-dull'); if (btn) btn.textContent = '…'; }, 5000),
    setTimeout(() => { onReveal(); // re-render swaps sea color/labels mid-glow; re-tag the new box
      const nb = document.getElementById('ap-box'); if (nb) nb.classList.add(success ? 'g-fin-gold' : 'g-fin-dull');
      const nbtn = document.getElementById('ap-btbtn'); if (nbtn) { nbtn.disabled = true; nbtn.textContent = success ? '成' : '败'; }
      const dock = document.getElementById('ap-btdock');
      if (dock) dock.insertAdjacentHTML('beforeend', `<span class="ap-btres ${success ? 'gold' : 'dull'}">${success ? '成 · the sea ascends' : '败 · the sea holds its grade'}</span>`);
    }, 8000),
    setTimeout(() => { const nb = document.getElementById('ap-box'); if (nb) nb.classList.remove('g-fin-gold', 'g-fin-dull'); onDone(); }, 10000),
  ];
}

// ---------- killer move editor ----------
function csKiller(c) {
  // PROGRESSION GATE: show a locked panel until the cultivator is rank 3+ AND the player has cleared
  // Floor 100. battle.js attachKiller enforces the same rule, so this is UX only.
  if (!killerUnlocked(c)) {
    const rankOk = rankOf(c.realm) + 1 >= KILLER_MIN_RANK;
    const floorOk = !!S().clearedFloors[KILLER_UNLOCK_FLOOR];
    const req = (ok, label) => `<li class="${ok ? 'km-req-ok' : 'km-req-no'}">${ok ? '✓' : '✗'} ${label}</li>`;
    return `<div class="killer-block killer-locked">
      <div class="killer-row"><b>🔒 Killer move locked</b></div>
      <div class="killer-hint">Killer moves are a mid-game art — they unlock once these are both met:</div>
      <ul class="km-reqs">
        ${req(floorOk, `Clear <b>Floor ${KILLER_UNLOCK_FLOOR}</b>`)}
        ${req(rankOk, `Reach <b>Rank ${KILLER_MIN_RANK}</b> — currently ${realmName(c.realm)}`)}
      </ul>
    </div>`;
  }
  const equipped = (c.gu || []).filter(Boolean).map((uid) => ({ uid, gu: guOf(uid) })).filter((x) => x.gu);
  const cfg = c.killer || { core: null, support: [], archetype: null };
  const guRes = (uid) => { const e = equipped.find((x) => x.uid === uid); return e ? e.gu : null; };
  const archDom = archetypeDomain(cfg.archetype);                       // favored domain of the chosen archetype
  const coreGu = cfg.core ? guRes(cfg.core) : null;
  const corePath = coreGu ? coreGu.daoPath : null;
  const support = (cfg.support || []).filter((u) => equipped.some((x) => x.uid === u));
  const valid = validateKiller({ ...cfg, support }, c.gu, guRes);

  // 1) ARCHETYPE chooser — GROUPED by favored domain (header = domain + the core-Gu kinds it accepts),
  // each archetype card showing its delivery tag + a one-line description.
  const DELIV_TAG = { single: '1 foe', lane: 'column', reach: 'AoE', all: 'all foes', self: 'self', team: 'team' };
  // Archetype unlock economy: the FIRST archetype is free, every other costs KILLER_ARCH_COST ✦.
  const unlocked = c.killerArchUnlocked || {};
  const ownedCount = Object.keys(unlocked).length;
  const chooser = ['offense', 'mystic', 'guard', 'motion', 'vigor'].map((dom) => {
    const ids = ARCHETYPE_ORDER.filter((id) => ARCHETYPES[id].domain === dom);
    if (!ids.length) return '';
    const di = DOMAIN_INFO[dom] || { label: dom, cores: '' };
    const cards = ids.map((id) => {
      const A = ARCHETYPES[id], on = cfg.archetype === id;
      const owned = !!unlocked[id], free = !owned && ownedCount === 0;
      const badge = owned ? `<span class="ka-deliv">${DELIV_TAG[A.delivery] || A.delivery}</span>`
        : free ? '<span class="ka-cost free">FREE</span>'
        : `<span class="ka-cost">🔒 ${KILLER_ARCH_COST} ✦</span>`;
      const titleTag = owned ? '' : free ? ' · free first killer move' : ` · unlock for ${KILLER_ARCH_COST} ✦`;
      return `<button class="killer-arch${on ? ' on' : ''}${owned ? '' : ' locked'}" onclick="G.setKillerArchetype('${c.id}','${id}')" title="${esc(archetypeRole(id))}${titleTag}">
        <span class="ka-top"><b>${A.name}</b>${badge}</span>
        <span class="ka-desc">${archetypeBlurb(id)}</span></button>`;
    }).join('');
    return `<div class="killer-domgroup${archDom === dom ? ' active' : ''}">
      <div class="killer-domhead">${di.label}<span class="muted small">core: ${di.cores}</span></div>
      <div class="killer-archgrid">${cards}</div></div>`;
  }).join('');

  // 2) CORE picker — equipped Gu of the archetype's favored domain (others greyed)
  let coreSection = '';
  if (cfg.archetype) {
    const cores = equipped.map(({ uid, gu }) => {
      const okDom = guInDomain(gu, archDom), on = cfg.core === uid, col = pathColor(gu.daoPath);
      return `<button class="killer-gu${on ? ' on' : ''}${okDom ? '' : ' off'}"${okDom ? '' : ' disabled'}
        style="${on ? `border-color:${col};color:${col}` : ''}" onclick="G.setKillerCore('${c.id}','${uid}')"
        title="${esc(gu.name)} — ${pathName(gu.daoPath)} · T${gu.tier}${okDom ? '' : ` (not a ${archDom} Gu)`}"><span class="cjk">${pathCjk(gu.daoPath)}</span> T${gu.tier}</button>`;
    }).join('');
    coreSection = `<div class="killer-row" style="margin-top:12px"><b>Core</b> <span class="muted small">1 <b>${archDom}</b> Gu — sets name · status · path</span></div>
      <div class="killer-gus">${cores || '<span class="muted small">No Gu equipped.</span>'}</div>`;
  }

  // 3) SUPPORT picker — equipped Gu of the core's path (★ = also favored-domain → raises synergy)
  let supSection = '';
  if (coreGu) {
    const sups = equipped.filter(({ uid }) => uid !== cfg.core).map(({ uid, gu }) => {
      const okPath = gu.daoPath === corePath, on = support.includes(uid), fav = okPath && guInDomain(gu, archDom), col = pathColor(gu.daoPath);
      return `<button class="killer-gu${on ? ' on' : ''}${okPath ? '' : ' off'}"${okPath ? '' : ' disabled'}
        style="${on ? `border-color:${col};color:${col}` : ''}" onclick="G.setKillerSupport('${c.id}','${uid}')"
        title="${esc(gu.name)} — ${pathName(gu.daoPath)} · T${gu.tier}${okPath ? (fav ? ' · favored ✓ (boosts synergy)' : ' · off-domain') : ' (different path)'}">${fav ? '★ ' : ''}<span class="cjk">${pathCjk(gu.daoPath)}</span> T${gu.tier}</button>`;
    }).join('');
    supSection = `<div class="killer-row" style="margin-top:12px"><b>Support</b> <span class="muted small">2+ <b>${pathName(corePath)}</b> Gu · ★ = ${archDom} → higher synergy</span></div>
      <div class="killer-gus">${sups || '<span class="muted small">No other Gu of this path equipped.</span>'}</div>`;
  }

  // preview (when valid) or a step-by-step hint
  let preview = '', hint = '';
  if (valid) {
    const spec = assemble(cfg.archetype, coreGu, support.map(guRes));
    if (spec) {
      const rank = rankOf(c.realm) + 1;
      const cost = Math.round(KILLER_COST_MULT * [coreGu, ...support.map(guRes)].reduce((s, g) => s + guEssenceCostFor(g, rank), 0));
      const syn = synergyLabel(spec.favorability), synCol = syn === 'High' ? '#6fcf97' : syn === 'Medium' ? '#c79a45' : '#e06c6c';
      preview = `<div class="killer-preview">
        <div class="killer-head"><span class="cjk" style="color:${pathColor(corePath)};font-size:20px;margin-right:6px">${spec.cjk}</span><b>${spec.name}</b>
          <span class="pill" title="Essence banked to cast">◇ ${fmt(cost)}</span>
          <span class="pill" style="color:${synCol};border-color:${synCol}66" title="Favorability — share of the same-path support that matches the move's favored domain (★)">Synergy: ${syn}</span></div>
        <ul class="killer-ops">${describeOps(spec).map((o) => `<li>${o}</li>`).join('')}</ul>
        <div class="muted small">Fires in battle when ◇${fmt(cost)} banks (essence surplus) and its 3-action cooldown is up.</div>
      </div>`;
    }
  } else if (!cfg.archetype) {
    const near = nearestCore(equipped);
    hint = `<div class="killer-hint">Pick an <b>archetype</b> — its domain sets which Gu can be the core.${near ? ` Closest same-path set: <b>${pathName(near.path)}</b> (${near.have}/3).` : ''}</div>`;
  } else if (!coreGu) {
    hint = `<div class="killer-hint">Choose a <b>${archDom}</b> core Gu above (off-domain Gu are greyed).</div>`;
  } else if (support.length < 2) {
    hint = `<div class="killer-hint">Add <b>${2 - support.length}</b> more <b>${pathName(corePath)}</b> support Gu (you have ${support.length}/2+). ★ same-domain support hits harder.</div>`;
  }

  return `<div class="killer-block">
    <div class="killer-row"><b>Archetype</b> <span class="muted small">the move's shape · core must match its domain · first free, others ${KILLER_ARCH_COST} ✦ each</span><button class="mini" style="margin-left:auto" onclick="G.autoKiller('${c.id}')">✦ Suggest</button></div>
    <div class="killer-chooser">${chooser}</div>
    ${coreSection}
    ${supSection}
    ${hint}${preview}
  </div>`;
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
      rows += `<div class="spec-row"><dt>Breakthrough</dt><dd>Rank 5 Peak — the mortal ceiling. ${ASCENSION_LOCKED ? 'Ascension to Rank 6 (Gu Immortal) is not yet available.' : 'Ascension awaits.'}</dd></div>`;
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
  if (!immortal && canAscend(c) && ASCENSION_LOCKED) {
    action = `<div style="margin-top:14px"><button class="primary" disabled>🔒 Ascension Locked</button>
      <div class="muted small" style="margin-top:6px">Rank 6 (Gu Immortal) is still locked — ascension is unavailable for now.</div></div>`;
  } else if (!immortal && canAscend(c)) {
    action = `<div style="margin-top:14px"><button class="primary" onclick="G.ascend('${c.id}')">Attempt Ascension · ${ASCEND_COST} ✦</button>
      <div class="muted small" style="margin-top:6px">A solo trial to become a Gu Immortal. Failure costs the essence but is not fatal.</div></div>`;
  } else if (!immortal) {
    // Mortal breakthrough now lives in the aperture mandala's breakthrough dock (csBreakDock → the
    // 10-second rite via G.riteAttempt). Cultivation section keeps the informational spec rows only.
    action = '';
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

// A THEMED hover tooltip chip — replaces the bare native title= popup with a small design-sheet card
// that floats above the chip on hover (pure CSS, see .tip-host/.tip). `tip` = { head, sub?, eff?[] };
// opts.base = the chip's base class (default 'tag'; e.g. 'statchip'); opts.style / opts.cls decorate it.
function tipTag(label, tip, opts = {}) {
  const sub = tip.sub ? `<span class="tip-sub">${tip.sub}</span>` : '';
  const eff = (tip.eff && tip.eff.length)
    ? `<span class="tip-eff">${tip.eff.map((e) => `<span>${e}</span>`).join('')}</span>` : '';
  return `<span class="${opts.base || 'tag'} tip-host${opts.cls ? ' ' + opts.cls : ''}"${opts.style ? ` style="${opts.style}"` : ''}>${label}<span class="tip"><b class="tip-head">${tip.head}</b>${sub}${eff}</span></span>`;
}

// BULLETPROOF tooltip portal. One fixed-position card (#tip-pop) appended to <body> and positioned by
// JS, so it can never be clipped by an overflow/scroll ancestor (it flips above↔below and clamps to the
// viewport). It serves BOTH: rich .tip-host chips (markup held in a hidden .tip child) AND any element
// with a native title="" — the OS popup is suppressed and re-rendered in the game's theme. So every
// hover hint in the app, present or future, gets the themed treatment with no per-call-site changes.
const escTipHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function initTooltips() {
  if (typeof document === 'undefined' || window.__tipInit) return;
  window.__tipInit = true;
  const ready = () => {
    const pop = document.createElement('div'); pop.id = 'tip-pop'; document.body.appendChild(pop);
    let cur = null, stash = null; // stash = { el, title } whose native title we temporarily removed
    const hide = () => { if (stash) { stash.el.setAttribute('title', stash.title); stash = null; } cur = null; pop.classList.remove('on'); };
    const place = () => {
      if (!cur || !document.body.contains(cur)) return hide();
      const r = cur.getBoundingClientRect(), pr = pop.getBoundingClientRect(), pad = 8, gap = 10;
      let below = false, top = r.top - pr.height - gap;
      if (top < pad) { top = r.bottom + gap; below = true; }
      if (top + pr.height > innerHeight - pad) top = Math.max(pad, innerHeight - pr.height - pad);
      const left = Math.max(pad, Math.min(r.left, innerWidth - pr.width - pad));
      pop.style.left = Math.round(left) + 'px';
      pop.style.top = Math.round(top) + 'px';
      pop.classList.toggle('below', below);
      pop.style.setProperty('--arrow-x', Math.max(12, Math.min(pr.width - 12, (r.left + r.width / 2) - left)) + 'px');
    };
    const show = (el, html) => { pop.innerHTML = html; cur = el; pop.classList.add('on'); place(); };
    document.addEventListener('mouseover', (e) => {
      const host = e.target.closest && e.target.closest('.tip-host');
      if (host) { if (host !== cur) { const d = host.querySelector(':scope > .tip'); if (d) show(host, d.innerHTML); } return; }
      const t = e.target.closest && e.target.closest('[title]');
      if (t) { const title = t.getAttribute('title'); if (title && title.trim()) { t.removeAttribute('title'); stash = { el: t, title }; show(t, `<span class="tip-line">${escTipHtml(title)}</span>`); } }
    });
    document.addEventListener('mouseout', (e) => { if (cur && !(e.relatedTarget && cur.contains(e.relatedTarget))) hide(); });
    window.addEventListener('scroll', () => { if (cur) place(); }, true);
    window.addEventListener('resize', () => { if (cur) place(); });
    document.addEventListener('mousedown', hide, true);
  };
  if (document.body) ready(); else document.addEventListener('DOMContentLoaded', ready);
}
initTooltips();

// ---- CH5 character-sheet hero panels: Marrow (attributes) · Tempered Flesh (combat) · Soul Imprint ----
// Left column of the 3-column hero layout: compact vertical attribute-allocation form (reuses the same
// stage/commit/clear/respec handlers as the old csAttrBoard).
function csMarrow(c) {
  const unspent = unspentPoints(c);
  const draft = (S().allocDraft && S().allocDraft.id === c.id) ? S().allocDraft : null;
  const staged = (k) => (draft && (draft[k] | 0)) || 0;
  const totalStaged = ATTR_KEYS.reduce((sum, k) => sum + staged(k), 0);
  const remaining = unspent - totalStaged;
  const rows = ATTR_KEYS.map((k) => {
    const st = staged(k);
    return `<div class="ch5-attr${st > 0 ? ' staged' : ''}" title="${ATTR_FULL[k]}">
      <span class="ch5-ak">${ATTR_LABEL[k]}</span>
      <span class="ch5-av">${compact(effAttr(c, k))}${st > 0 ? `<i class="ch5-stg">+${compact(st)}</i>` : ''}</span>
      <span class="ch5-astep">
        <button class="mini step" ${st <= 0 ? 'disabled' : ''} onclick="G.allocStage('${c.id}','${k}',-1)">－</button>
        <button class="mini step" ${remaining <= 0 ? 'disabled' : ''} onclick="G.allocStage('${c.id}','${k}',1)">＋</button>
      </span>
      <span class="ch5-ad">${ATTR_DESC[k]}</span>
    </div>`;
  }).join('');
  const invested = spentPoints(c);
  const rCost = respecCost(c), rEss = RESPEC_ESSENCE_COST;
  const canAfford = S().stones >= rCost && S().essence >= rEss;
  return `<div class="ch5-panel ch5-marrow">
    <div class="ch5-h">Marrow <i>· ${compact(unspent)} unspent</i></div>
    <div class="ch5-attrlist">${rows}</div>
    <div class="ch5-steprow"><span class="ch5-sublbl">Per click</span><div class="viewtoggle">${allocStepBtns()}</div></div>
    <div class="ch5-allocacts">
      <button class="mini primary" ${totalStaged <= 0 ? 'disabled' : ''} onclick="G.allocCommit('${c.id}')">✓ Confirm ${compact(totalStaged)}</button>
      <button class="mini" ${totalStaged <= 0 ? 'disabled' : ''} title="Reset staged" onclick="G.allocClear('${c.id}')">↺</button>
      <button class="mini danger"${invested <= 0 ? ' disabled' : ''}${canAfford || invested <= 0 ? '' : ' style="opacity:.65"'} title="${invested <= 0 ? 'No allocated attributes to respec' : `Release all ${compact(invested)} points for ${rCost.toLocaleString()} 石 + ${rEss} ✦${canAfford ? '' : ' — not enough 石/✦'}`}" onclick="G.respecPrompt('${c.id}')">↺ Respec</button>
    </div>
    <div class="ch5-note">${totalStaged > 0 ? `${compact(totalStaged)} staged · ${compact(remaining)} left — Confirm to commit (permanent).` : ('Allocation is permanent unless you Respec (1,000 石/pt + ' + rEss + ' ✦). Every realm grants more points.')}</div>
  </div>`;
}
// Right column top: derived combat stats in a 2-up grid (the "tempered flesh"). When `pv` (a preview
// stat block built from staged-but-uncommitted attribute points) is supplied, each changed stat gets a
// jade delta chip so the player sees the effect BEFORE confirming the allocation.
function csTemperedFlesh(s, pv) {
  const hit = 0.85 + s.hitChance;   // mirrors csStatGrid: 85% base + bonus, uncapped
  const phit = pv ? 0.85 + pv.hitChance : null;
  const pctPts = (x) => Math.round(x * 100) + '%'; // delta shown in percentage points
  // Jade delta chip: format the change in the stat's own display units; suppress when it rounds to nothing.
  const dlt = (cur, next, pf) => {
    if (next == null) return '';
    const d = next - cur, mag = pf(Math.abs(d));
    if (mag === pf(0)) return '';
    return `<i class="ch5-fd${d < 0 ? ' dn' : ''}">${d > 0 ? '+' : '−'}${mag}</i>`;
  };
  const cell = (k, v, d) => `<div class="ch5-fcell"><span class="ch5-fk">${k}</span><span class="ch5-fv">${v}${d}</span></div>`;
  const core = (k, v, d) => `<div class="ch5-ccell"><span class="ch5-fk">${k}</span><span class="ch5-cv">${v}${d}</span></div>`;
  return `<div class="ch5-panel">
    <div class="ch5-h">Tempered Flesh${pv ? ' <i class="ch5-preview">staged preview</i>' : ''}</div>
    <div class="ch5-core">
      ${core('ATK', compact(s.atk), dlt(s.atk, pv && pv.atk, compact))}${core('HP', compact(s.maxHp), dlt(s.maxHp, pv && pv.maxHp, compact))}${core('DEF', compact(s.def), dlt(s.def, pv && pv.def, compact))}${core('SPD', s.spd, dlt(s.spd, pv && pv.spd, (x) => '' + Math.round(x)))}
    </div>
    <div class="ch5-flesh">
      ${cell('Crit', pct(s.crit), dlt(s.crit, pv && pv.crit, pctPts))}${cell('Crit Dmg', '×' + s.critDamage.toFixed(2), dlt(s.critDamage, pv && pv.critDamage, (x) => x.toFixed(2)))}
      ${cell('Evasion', pct(s.dodge), dlt(s.dodge, pv && pv.dodge, pctPts))}${cell('Hit', pct(hit), dlt(hit, phit, pctPts))}
      ${cell('Pen', pct(s.armorPen), dlt(s.armorPen, pv && pv.armorPen, pctPts))}${cell('Potency', pct(s.potency), dlt(s.potency, pv && pv.potency, pctPts))}
      ${cell('Resist', pct(s.statusResist), dlt(s.statusResist, pv && pv.statusResist, pctPts))}${cell('Crit Res', pct(s.critResist), dlt(s.critResist, pv && pv.critResist, pctPts))}
      ${cell('Lucky', pct(s.luckyHit), dlt(s.luckyHit, pv && pv.luckyHit, pctPts))}${cell('Lifesteal', pct(s.lifesteal), dlt(s.lifesteal, pv && pv.lifesteal, pctPts))}
      ${cell('Thorns', pct(s.thorns), dlt(s.thorns, pv && pv.thorns, pctPts))}${cell('Regen', compact(s.regen), dlt(s.regen, pv && pv.regen, compact))}
    </div>
  </div>`;
}
// Right column bottom: Soul Imprint summary + action (shown for all; inert for the unique player).
function csSoulImprint(c) {
  const lvl = c.imprint || 0;
  const pctv = Math.round((imprintAttrMult(c) - 1) * 100);
  const cands = imprintCandidates(c.id);
  const atMax = lvl >= IMPRINT_CAP;
  const can = !atMax && cands.length > 0;
  const note = c.isPlayer ? 'The protagonist is unique — no duplicate to imprint.'
    : atMax ? 'Maximum Soul Imprint reached.'
    : cands.length === 0 ? 'No benched duplicate available — recruit or bench another copy.'
    : `${cands.length} spare cop${cands.length === 1 ? 'y' : 'ies'} ready to sacrifice.`;
  return `<div class="ch5-panel">
    <div class="ch5-h">Soul Imprint</div>
    <div class="ch5-imprint">
      <span class="cjk ch5-imp-seal">魂印</span>
      <span class="ch5-imp-stars">${lvl > 0 ? imprintStars(lvl) : '—'}</span>
      <span class="ch5-imp-pct">+${pctv}% attrs</span>
      <span class="ch5-imp-copies">${cands.length} spare cop${cands.length === 1 ? 'y' : 'ies'}</span>
    </div>
    <button class="mini ${can ? 'primary' : ''} ch5-imp-btn"${can ? '' : ' disabled'} onclick="G.imprintPrompt('${c.id}')">Imprint a Duplicate</button>
    <div class="ch5-note">${note}</div>
  </div>`;
}

export function viewCharacter(id) {
  const c = id && S().roster.find((x) => x.id === id);
  if (!c) return `${pagehead('人', 'Roster', 'Not Found', 'That cultivator is no longer in your roster.')}
    <button onclick="G.setTab('team')">← Back to Roster</button>`;
  const s = effectiveStats(c);
  // PREVIEW: if attribute points are staged on this character, derive the stats they WOULD produce so the
  // Combat Profile can show a jade delta beside each affected stat (before the player commits — see issue).
  let preview = null;
  const adraft = (S().allocDraft && S().allocDraft.id === c.id) ? S().allocDraft : null;
  if (adraft && ATTR_KEYS.some((k) => (adraft[k] | 0) > 0)) {
    const attrs = { ...(c.attrs || {}) };
    for (const k of ATTR_KEYS) attrs[k] = (attrs[k] || 0) + (adraft[k] | 0);
    preview = effectiveStats({ ...c, attrs });
  }
  const rc = rarityColor(c.rarity);
  const glyph = charGlyph(c);
  const ap = apertureGrade(apertureCapacity(effAptitude(c))); // aperture grade for the header/aside (incl. Soul Imprint)
  const paths = []; for (const uid of c.gu) { const gu = guOf(uid); if (gu && !paths.includes(gu.daoPath)) paths.push(gu.daoPath); }
  const pathTags = paths.slice(0, 4).map((p) => `<span class="tag" style="border-color:${pathColor(p)}66;color:${pathColor(p)}"><span class="cjk">${pathCjk(p)}</span> ${pathName(p)}</span>`).join('');
  const affPct = Math.round((AFFINITY_EFFECT_MULT - 1) * 100), affComp = Math.round((AFFINITY_COMP_MULT - 1) * 100);
  const affTag = affinityPaths(c).map((ap) => tipTag(
    `✦ <span class="cjk">${pathCjk(ap)}</span> ${affinityName(ap)}`,
    { head: `Dao Affinity · ${pathName(ap)}`, sub: "Mastery of this path's Gu",
      eff: [`+${affPct}% ${pathName(ap)} Gu effectiveness`, `+${affComp}% ${pathName(ap)} comprehension XP`] },
    { style: `border-color:${pathColor(ap)}aa;color:${pathColor(ap)}` })).join('');
  const lid = lineOf(c), lineDef = lid && LINES[lid];
  const lineEffs = lineDef ? archEffects(lid, c.rarity) : [];
  const lineTag = lineDef
    ? tipTag(`⚔ ${lineName(lid, c.rarity)}`, {
        head: `${LINES[lid].name} · ${lineName(lid, c.rarity)}`,
        sub: lineDef.role + (lineDef.phase2 ? ' · support effect pending' : ''),
        eff: lineEffs,
      })
    : '';
  const statusTag = c.active
    ? `<span class="tag blood">Active · ${rowOf(c) === 'back' ? 'Back' : 'Front'} Row</span>`
    : '<span class="tag">Reserve</span>';
  const posText = c.active ? `${rowOf(c) === 'back' ? 'Back' : 'Front'} · L${laneOf(c) + 1}` : 'Reserve';
  const order = charNavOrder(), pos = order.findIndex((x) => x.id === c.id) + 1, total = order.length;

  return `<div class="sheet ch5-sheet">
    ${pagehead('己', 'Cultivator File · 气海', c.name,
      'The aperture is the cultivator. Gu orbit the primeval sea in <b>channel-priority</b> order — raise or lower a Gu with ▲▼ to reprioritise; starved Gu drift dark beyond the arc.')}
    <div class="cs-back">
      <button onclick="G.setTab('team')">← Back to Roster</button>
      <div class="cs-nav">
        <button onclick="G.stepChar(-1)" ${total <= 1 ? 'disabled' : ''}>← Prev</button>
        <span class="cs-nav-pos">${pos} / ${total}</span>
        <button onclick="G.stepChar(1)" ${total <= 1 ? 'disabled' : ''}>Next →</button>
      </div>
    </div>
    <div class="cs-tags">
      <span class="tag" style="border-color:${rc}88;color:${rc}">${c.rarity}</span>
      <span class="tag" style="border-color:var(--essence)66;color:var(--essence)" title="Aperture capacity grade — sets how full the primeval sea can fill">${ap.grade}-grade aperture</span>
      ${c.isPlayer ? '<span class="tag blood">Demonic Path · 魔道</span>' : ''}
      ${lineTag}
      ${affTag}
      ${statusTag}
      ${(c.imprint || 0) > 0 ? `<span class="tag" title="Soul Imprint Lv ${c.imprint} — +${Math.round((imprintAttrMult(c) - 1) * 100)}% attributes · +${(0.1 * c.imprint).toFixed(1)} aptitude"><span class="cjk">魂印</span> ${c.imprint} ${imprintStars(c.imprint)}</span>` : ''}
      ${pathTags}
    </div>

    <div class="ch5-grid">
      <aside class="ch5-side">${csMarrow(c)}</aside>
      <div class="ch5-center">${csApertureMandala(c)}</div>
      <aside class="ch5-side">${csTemperedFlesh(s, preview)}${csSoulImprint(c)}</aside>
    </div>

    <div class="ch5-killer">
      <div class="sec-head" style="margin-top:6px"><span class="sec-num" style="color:var(--stone)">播</span><span class="sec-title">Killer Move</span><span class="sec-meta">Archetype → Core → Support · unlocked at Rank ${KILLER_MIN_RANK} / Floor ${KILLER_UNLOCK_FLOOR}</span></div>
      ${csKiller(c)}
    </div>

    ${secHead(1, 'Cultivation & Ascension', realmClass(c.realm))}
    ${csCultivation(c)}

    ${secHead(2, 'Dao Paths', 'Comprehension · Marks')}
    ${csDao(c)}

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
// ---------- gu refinery ----------
let guSelId = null; // the Gu on the refining desk (module-level — deliberately not persisted)
export function guSelect(id) { guSelId = id; renderGuResults(); }

const guPathUnlocked = (pid) => !isPathLocked(pid) && S().frontier >= pathFloorReq(pid);

// Gu of the selected path surviving tier filter + flags (rows the middle list shows).
function guVisible() {
  const st = S().settings;
  const pathF = st.guPath || 'all';
  const q = (st.guSearch || '').trim().toLowerCase();
  // Need at least one lens — a path, a search, or the craft-queue flag — else the middle shows a hint.
  if (pathF === 'all' && !q && !st.guCraftable) return [];
  // COMPOSABLE filters: path, search, tier and the two flags all AND together, so "Can be refined" (and a
  // search) NARROW the selected path + tier instead of replacing it. With "All paths" a search still
  // crosses every path; a selected path scopes the search/craftable view to that path. Cap keeps the DOM light.
  let lib = guList();
  if (pathF !== 'all') lib = lib.filter((gu) => gu.daoPath === pathF);
  if (q) lib = lib.filter((gu) => gu.name.toLowerCase().includes(q)
    || pathName(gu.daoPath).toLowerCase().includes(q) || effectText(gu).toLowerCase().includes(q));
  if (st.guTier && st.guTier !== 'all') lib = lib.filter((gu) => gu.tier === Number(st.guTier));
  if (st.guUnlocked) lib = lib.filter((gu) => guPathUnlocked(gu.daoPath));
  if (st.guCraftable) lib = lib.filter((gu) => guPathUnlocked(gu.daoPath) && canCraft(gu.id).ok);
  return lib.sort((a, b) => a.tier - b.tier || a.name.localeCompare(b.name)).slice(0, 200);
}
const guSelected = (rows) => rows.find((g) => g.id === guSelId) || rows[0] || null;

// LEFT RAIL — search, the two flags, then every path grouped by commonality.
function guRailHtml() {
  const st = S().settings;
  const pathF = st.guPath || 'all';
  const flag = (key, on, label) => `<button class="ref-flag${on ? ' on' : ''}" onclick="G.toggleGuFlag('${key}')">${on ? '☑' : '☐'} ${label}</button>`;
  const all = [...new Set(guList().map((g) => g.daoPath))];
  const buckets = {};
  all.forEach((p) => { const k = commOf(p).key || 'common'; (buckets[k] = buckets[k] || []).push(p); });
  const pBtn = (p) => {
    const locked = !guPathUnlocked(p);
    return `<button class="ref-pbtn${pathF === p ? ' on' : ''}${locked ? ' locked' : ''}" onclick="G.setView('guPath','${p}')"
      title="${esc(pathName(p) + (locked ? ` — unlocks Floor ${pathFloorReq(p)}` : ''))}">
      <span style="color:${commOf(p).color}">${pathCjk(p)}</span>${pathName(p)}<i>${locked ? 'Fl ' + pathFloorReq(p) : '×' + guList().filter((g) => g.daoPath === p).length}</i></button>`;
  };
  const groups = ['common', 'uncommon', 'rare', 'esoteric', 'supreme'].filter((k) => buckets[k]).map((k) =>
    `<div class="wk-h wk-comm" style="color:${commOf(buckets[k][0]).color}">${commOf(buckets[k][0]).label}</div>
     ${buckets[k].sort((a, b) => pathName(a).localeCompare(pathName(b))).map(pBtn).join('')}`).join('');
  return `
    <input class="searchbox wide" type="text" placeholder="Search ${guList().length.toLocaleString()} Gu…" value="${esc(st.guSearch || '')}" oninput="G.guSearch(this.value)">
    <div class="ref-flags">
      ${flag('guCraftable', !!st.guCraftable, 'Can be refined')}
      ${flag('guUnlocked', !!st.guUnlocked, 'Unlocked Dao paths')}
    </div>
    <button class="ref-pbtn${pathF === 'all' ? ' on' : ''}" onclick="G.setView('guPath','all')"><span>全</span>All paths<i>×${guList().length.toLocaleString()}</i></button>
    ${groups}`;
}

// MIDDLE — tier chips + one row per Gu. Every row carries the ⚒ (gold = craftable, gray = not).
function guListHtml() {
  const st = S().settings;
  const pathF = st.guPath || 'all';
  const q = (st.guSearch || '').trim();
  const rows = guVisible();
  const tierF = st.guTier || 'all';
  const tiers = `<div class="ref-tiers">${['all', 1, 2, 3, 4, 5, 6, 7, 8, 9].map((t) =>
    `<button class="mini${String(tierF) === String(t) ? ' primary' : ''}" onclick="G.setView('guTier','${t}')">${t === 'all' ? 'All' : 'T' + t}</button>`).join('')}</div>`;
  let head = '';
  if (q) head = `<div class="sec-head" style="margin-top:0"><span class="sec-num">索</span><span class="sec-title">Search</span><span class="sec-meta">${rows.length} match${rows.length === 1 ? '' : 'es'}${pathF !== 'all' ? ' in ' + pathName(pathF) : ''}${st.guCraftable ? ' · refinable' : ''}${rows.length === 200 ? ' (first 200)' : ''}</span></div>`;
  else if (pathF !== 'all') {
    const c = commOf(pathF), p = PATH(pathF);
    head = `<div class="sec-head" style="margin-top:0"><span class="sec-num" style="color:${c.color}">${pathCjk(pathF)}</span>
      <span class="sec-title">${pathName(pathF)}</span>
      <span class="sec-meta">${c.label} · ${CATEGORY_LABELS[p.category] || ''} · ${rows.length} shown</span></div>`;
  } else if (st.guCraftable) {
    head = `<div class="sec-head" style="margin-top:0"><span class="sec-num" style="color:var(--stone)">⚒</span><span class="sec-title" style="color:var(--stone)">Craft Queue</span><span class="sec-meta">${rows.length} refinable across unlocked paths</span></div>`;
  } else {
    return '<div class="muted" style="padding:30px 4px">Pick a Dao path on the left — or flip on <b>Can be refined</b> to see everything you can craft right now.</div>';
  }
  if (!rows.length) return tiers + head + '<div class="muted" style="margin-top:14px">No Gu match these filters.</div>';
  const sel = guSelected(rows);
  const owned = {};
  S().guInv.forEach((g) => { owned[g.guId] = (owned[g.guId] || 0) + 1; });
  const row = (gu) => {
    const ok = canCraft(gu.id).ok;
    return `<div class="ref-row${sel && gu.id === sel.id ? ' sel' : ''}" style="border-left-color:var(--t${gu.tier})" onclick="G.guSelect('${gu.id}')">
      <b class="tierbadge" style="color:var(--t${gu.tier});border-color:var(--t${gu.tier})">T${gu.tier}</b>
      <span class="ref-name">${gu.name}${isUnique(gu) ? '<span class="pill unique">UNIQUE</span>' : ''}${owned[gu.id] ? `<span class="pill">×${owned[gu.id]}</span>` : ''}</span>
      <span class="ref-eff">${effectText(gu)}</span>
      <i class="ref-can${ok ? '' : ' dim'}" title="${ok ? 'Craftable now' : 'Missing materials or fodder'}">⚒</i></div>`;
  };
  return tiers + head + rows.map(row).join('');
}

// Auto-Craft button: shown beneath ⚒ Craft when you can't craft directly but stones COULD cover buying the
// missing materials + forging the missing fodder chain. Spells out what it will do and the total stone cost.
function autoCraftHtml(gu, chk, claimed) {
  if (chk.ok || claimed || gu.tier >= 6) return '';      // already craftable / immortal / unique-taken → no auto path
  const plan = planAutoCraft(gu.id);
  if (!plan.ok) return '';                                // a hard gate (floor/path/material lock) blocks it entirely
  const bits = [];
  if (plan.subCrafts.length) bits.push(`forge ${plan.subCrafts.length} fodder`);
  const nBuys = Object.keys(plan.buys).length;
  if (nBuys) bits.push(`buy ${nBuys} material${nBuys > 1 ? 's' : ''}`);
  const note = `<div class="wk-note" style="margin:8px 0 4px">Auto-craft${bits.length ? ` will ${bits.join(' &amp; ')}` : ''} · total <span class="stone">${fmt(plan.stonesTotal)} 石</span></div>`;
  const label = plan.affordable ? `⚒ Auto-Craft · ${fmt(plan.stonesTotal)} 石` : `Need ${fmt(plan.stonesTotal)} 石`;
  return `${note}<button class="wk-wide" onclick="G.autoCraft('${gu.id}')"${plan.affordable ? '' : ' disabled'}>${label}</button>`;
}

// RIGHT — the Refining Desk: treasure card + ✓/✗ recipe checklist for the selected Gu.
function guDeskHtml() {
  const rows = guVisible();
  const gu = guSelected(rows);
  if (!gu) return '<div class="wk-h">Refining Desk</div><div class="muted">Select a Gu to inspect its recipe.</div>';
  const chk = canCraft(gu.id);
  const claimed = isUnique(gu) && S().uniqueClaimed[gu.id];
  const col = pathColor(gu.daoPath);
  const r = gu.recipe;
  const ing = (ok, label, have, need) => `<div class="ref-ing${ok ? ' ok' : ' no'}"><i>${ok ? '✓' : '✗'}</i><span>${label}</span>${ok ? '' : `<em>${fmt(have)}/${fmt(need)}</em>`}</div>`;
  let rowsHtml = ing(S().stones >= r.stones, `${fmt(r.stones)} 石`, S().stones, r.stones);
  for (const [id, q] of Object.entries(r.resources || {})) {
    const have = S().resources[id] || 0;
    rowsHtml += ing(have >= q, `${q}× ${RESOURCES[id] ? RESOURCES[id].name : id}`, have, q);
  }
  const rf = refineSpec(gu);
  if (rf.needed) {
    // count owned fodder of the right path+tier; exact tag set-cover is canCraft's job (the button),
    // so this row is an honest approximation and chk.reasons below carries the precise complaint.
    const have = S().guInv.filter((o) => { const g = GU_LIB[o.guId]; return g && g.daoPath === rf.path && g.tier === rf.tier; }).length;
    rowsHtml += ing(have >= rf.min,
      `≥${rf.min}× T${rf.tier} ${pathName(rf.path)} Gu${rf.tags.length ? ` covering ${rf.tags.map((t) => `[${t}]`).join('')}` : ''}`, have, rf.min);
  }
  return `<div class="wk-h">Refining Desk</div>
    <div class="ref-card${chk.ok ? ' can' : ''}" style="border-color:var(--t${gu.tier})55">
      <div class="ref-card-top">
        <b class="tierbadge" style="color:var(--t${gu.tier});border-color:var(--t${gu.tier})">T${gu.tier}</b>
        ${isUnique(gu) ? '<span class="pill unique">UNIQUE</span>' : ''}
        <span class="gu-ess" style="margin-left:auto">◇ ${guEssenceCost(gu)}/use</span>
      </div>
      <div class="ref-glyph"><i style="box-shadow:0 0 34px 6px var(--t${gu.tier})33;border-color:var(--t${gu.tier})44"></i><span style="color:${col}">${pathCjk(gu.daoPath)}</span></div>
      <div class="ref-cname">${gu.name}</div>
      <div class="ref-effs">${effectText(gu)}</div>
      <div class="ref-ctags">${guTags(gu).map((t) => `<i>${tagLabel(t)}</i>`).join('')}</div>
      <div class="ref-recipe">${rowsHtml}</div>
      ${chk.ok ? '' : `<div class="ref-why">${chk.reasons.join(' ')}</div>`}
      <button class="primary wk-wide" onclick="G.craft('${gu.id}')"${chk.ok ? '' : ' disabled'}>${claimed ? 'Exists' : '⚒ Craft'}</button>
      ${autoCraftHtml(gu, chk, claimed)}
    </div>
    <div class="wk-note">Click any Gu to bring it to the desk</div>`;
}

export function renderGuResults() {
  const h = $('guResults'); if (h) h.innerHTML = guListHtml();
  const d = $('guDesk'); if (d) d.innerHTML = guDeskHtml();
}
export function viewGu() {
  return `${pagehead('蛊', 'Refinery · 炼蛊', 'Gu Refinery',
    'Gu bundle 1-4 signed effects; power scales with tier (1-9). Tiers 6-9 are immortal &amp; unique (one per world). Every Gu belongs to a <b>Dao Path</b>; rarer paths unlock only at deeper floors. Higher-tier Gu are refined from materials <b>plus lower-tier Gu of the same path</b>.')}
  <div class="ref-split">
    <aside class="wk-rail" id="guRail">${guRailHtml()}</aside>
    <div class="ref-mid" id="guResults">${guListHtml()}</div>
    <aside class="ref-desk" id="guDesk">${guDeskHtml()}</aside>
  </div>`;
}


// ---------- shop ----------
let shopSelId = null; // the resource on the counter (module-level — deliberately not persisted)
export function shopSelect(id) { shopSelId = id; renderShopResults(); }

// settings.shopQty: 1 | 10 | 100 | 1000 | 'max' ('max' = as many as the purse affords, min 1)
const shopQtyOf = (cost) => {
  const q = S().settings.shopQty || 1;
  return q === 'max' ? Math.max(1, Math.floor(S().stones / Math.max(1, cost))) : q;
};
const shopOwned = (r) => (S().resources[r.id] || 0);
const shopPathTag = (r) => r.daoPath
  ? `<span class="pill" style="color:${pathColor(r.daoPath)};border-color:${pathColor(r.daoPath)}66"><span class="cjk">${pathCjk(r.daoPath)}</span> ${pathName(r.daoPath)}</span>`
  : '<span class="muted small">universal</span>';

// Resources surviving the rail filters (rank / path / search), rank-then-name order.
function shopFiltered() {
  const st = S().settings;
  const rarityF = st.shopRarity || 'all', pathF = st.shopPath || 'all';
  const q = (st.shopSearch || '').trim().toLowerCase();
  let items = shopResources();
  if (rarityF !== 'all') items = items.filter((r) => String(r.rank) === rarityF);
  if (pathF === 'universal') items = items.filter((r) => !r.daoPath);
  else if (pathF !== 'all') items = items.filter((r) => r.daoPath === pathF);
  if (q) items = items.filter((r) => r.name.toLowerCase().includes(q) || (r.daoPath && pathName(r.daoPath).toLowerCase().includes(q)));
  return items.sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}
const shopSelected = (items) => items.find((r) => r.id === shopSelId) || items[0] || null;

// LEFT RAIL — search + dao paths grouped by commonality (rank filter lives as chips above the list,
// same pattern as the Refinery's tier chips — the vertical rank stack wasted rail space).
function shopRailHtml() {
  const st = S().settings;
  const pathF = st.shopPath || 'all';
  const unlocked = shopResources();
  // stocked dao paths, bucketed by commonality (common → supreme)
  const present = [...new Set(unlocked.filter((r) => r.daoPath).map((r) => r.daoPath))];
  const buckets = {};
  present.forEach((p) => { const k = commOf(p).key || 'common'; (buckets[k] = buckets[k] || []).push(p); });
  const pBtn = (p) => `<button class="ref-pbtn${pathF === p ? ' on' : ''}" onclick="G.setView('shopPath','${p}')">
      <span style="color:${commOf(p).color}">${pathCjk(p)}</span>${pathName(p)}<i>×${unlocked.filter((r) => r.daoPath === p).length}</i></button>`;
  const groups = ['common', 'uncommon', 'rare', 'esoteric', 'supreme'].filter((k) => buckets[k]).map((k) =>
    `<div class="wk-h wk-comm" style="color:${(buckets[k][0] && commOf(buckets[k][0]).color) || 'var(--muted)'}">${commOf(buckets[k][0]).label}</div>
     ${buckets[k].sort((a, b) => pathName(a).localeCompare(pathName(b))).map(pBtn).join('')}`).join('');
  return `
    <input class="searchbox wide" type="text" placeholder="Search resources…" value="${esc(st.shopSearch || '')}" oninput="G.shopSearch(this.value)">
    <div class="wk-h">Dao Path</div>
    <button class="ref-pbtn${pathF === 'all' ? ' on' : ''}" onclick="G.setView('shopPath','all')"><span>全</span>All paths<i>×${unlocked.length}</i></button>
    <button class="ref-pbtn${pathF === 'universal' ? ' on' : ''}" onclick="G.setView('shopPath','universal')"><span style="color:var(--bone-dim)">物</span>Universal<i>×${unlocked.filter((r) => !r.daoPath).length}</i></button>
    ${groups}
    <div class="wk-note">Locked paths stock nothing yet</div>`;
}

// MIDDLE — rank chips (ALL · R1…R9, zero-stock ranks disabled) + the filtered list grouped by rank.
export function shopSectionsHtml() {
  const items = shopFiltered();
  const unlocked = shopResources();
  const rarityF = S().settings.shopRarity || 'all';
  const countRank = (rk) => unlocked.filter((r) => r.rank === rk).length;
  const chips = `<div class="ref-tiers">
    <button class="mini${rarityF === 'all' ? ' primary' : ''}" onclick="G.setView('shopRarity','all')">All</button>
    ${RANKS.map((rk) => `<button class="mini${rarityF === String(rk) ? ' primary' : ''}"${countRank(rk) ? '' : ' disabled'} style="color:${countRank(rk) ? rankColor(rk) : 'var(--muted)'}" onclick="G.setView('shopRarity','${rk}')">R${rk}</button>`).join('')}
  </div>`;
  if (!unlocked.length) return '<div class="muted" style="margin-top:14px">Nothing in stock yet — clear more floors and raise your cultivators’ realms to unlock resources.</div>';
  if (!items.length) return chips + '<div class="muted" style="margin-top:14px">No resources match these filters.</div>';
  const sel = shopSelected(items);
  const byRank = {};
  items.forEach((r) => { (byRank[r.rank] = byRank[r.rank] || []).push(r); });
  const row = (r) => {
    const cost = resourceCost(r.id);
    return `<div class="mkt-row${sel && r.id === sel.id ? ' sel' : ''}${S().stones >= cost ? '' : ' poor'}" onclick="G.shopSelect('${r.id}')">
      <span class="mkt-dot" style="background:${rankColor(r.rank)}"></span>
      <b class="mkt-name">${r.name}</b>
      ${shopPathTag(r)}
      <span class="mkt-held">×${fmt(shopOwned(r))}</span>
      <span class="mkt-cost">${fmt(cost)} 石</span></div>`;
  };
  return chips + RANKS.filter((rk) => byRank[rk]).map((rk) =>
    `<div class="sec-head" style="margin-top:0"><span class="sec-num" style="color:${rankColor(rk)}">${SEC_NUM[rk] || rk}</span>
      <span class="sec-title" style="color:${rankColor(rk)}">Rank ${rk}</span>
      <span class="sec-meta">${byRank[rk].length} kinds · ${fmt(resourceCost(byRank[rk][0].id))} 石 each</span></div>
     ${byRank[rk].map(row).join('')}`).join('');
}

// RIGHT — the purchase desk: purse, selected resource, amount, itemized bill, one Buy.
function shopDeskHtml() {
  const items = shopFiltered();
  const sel = shopSelected(items);
  const purse = `<div class="mkt-wallet"><span>Your Purse</span><b>${fmt(S().stones)} <i>石</i></b></div>`;
  if (!sel) return purse + '<div class="muted" style="margin-top:14px">Nothing stocked matches these filters.</div>';
  const cost = resourceCost(sel.id);
  const qSet = S().settings.shopQty || 1;
  const qty = shopQtyOf(cost);
  const total = cost * qty;
  const afford = S().stones >= total;
  const qBtn = (n, lbl) => `<button class="mini${qSet === n ? ' primary' : ''}" onclick="G.setShopQty('${n}')">${lbl}</button>`;
  return `${purse}
    <hr class="wk-rule">
    <div class="mkt-sel">
      <span class="mkt-sel-glyph" style="color:${sel.daoPath ? pathColor(sel.daoPath) : 'var(--bone-dim)'}">${sel.daoPath ? pathCjk(sel.daoPath) : '物'}</span>
      <div><b>${sel.name}</b>
        <div class="mkt-sel-sub"><span class="pill" style="color:${rankColor(sel.rank)};border-color:${rankColor(sel.rank)}66">Rank ${sel.rank}</span> ${shopPathTag(sel)} <span class="muted">· held ×${fmt(shopOwned(sel))}</span></div></div>
    </div>
    <div class="wk-h" style="margin-top:16px">Amount</div>
    <div class="mkt-qty">${[1, 10, 100, 1000].map((n) => qBtn(n, '×' + n)).join('')}${qBtn('max', 'MAX')}</div>
    <dl class="mkt-bill">
      <div><dt>Unit price</dt><dd>${fmt(cost)} 石</dd></div>
      <div><dt>Quantity</dt><dd>×${fmt(qty)}</dd></div>
      <div class="tot"><dt>Total</dt><dd>${fmt(total)} 石</dd></div>
      <div><dt>Purse after</dt><dd>${afford ? fmt(S().stones - total) + ' 石' : '—'}</dd></div>
    </dl>
    <button class="primary wk-wide"${afford ? '' : ' disabled'} onclick="G.buyResource('${sel.id}')">Buy ×${fmt(qty)} ${sel.name}</button>
    <div class="wk-note">Click any resource to bring it to the counter</div>
    <div class="wk-note">Stock gates · Floor ${Math.max(0, S().frontier - 1)} cleared · highest rank ${highestRosterRank()}</div>`;
}

// Repaint list + desk (live search / selection / qty keep input focus; rail repaints on setView).
export function renderShopResults() {
  const host = $('shopResults'); if (host) host.innerHTML = shopSectionsHtml();
  const desk = $('shopDesk'); if (desk) desk.innerHTML = shopDeskHtml();
}

export function viewShop() {
  return `${pagehead('市', 'Market · 集市', 'The Market',
    'Buy crafting resources with Primeval Essence Stones. A resource is stocked only once you have <b>beaten the floor it can drop from</b> and your <b>highest cultivator’s rank</b> reaches its tier — deeper materials stay locked until you grow into them.')}
  <div class="mkt-split">
    <aside class="wk-rail" id="shopRail">${shopRailHtml()}</aside>
    <div class="mkt-list" id="shopResults">${shopSectionsHtml()}</div>
    <aside class="mkt-desk" id="shopDesk">${shopDeskHtml()}</aside>
  </div>`;
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

// ---------- what's new (changelog) ----------
// Player-facing patch notes. Add the newest release to the TOP of this list; each entry is
// { date, title, items: [[heading, html], …] }. HTML is allowed in the item bodies.
const WHATS_NEW = [
  { date: 'Jun 13, 2026', title: 'Gu Refinery', items: [
    ['Auto-Craft', 'Short on materials — or the lower-tier fodder — for a Gu? The Refining Desk now has an <b>⚒ Auto-Craft</b> button: if your <b style="color:var(--stone)">石 Primeval Stones</b> can cover it, it <b>buys the missing resources from the Market</b> and <b>recursively forges the whole lower-tier fodder chain</b>, then crafts the Gu — all in <b>one click</b>. So you can leap <b>straight to a Tier 5 Gu</b> without hand-building the T1→T4 chain first. It spends what you already own first (only buying or forging the shortfall) and shows the <b>total stone cost</b> and exactly what it will do <b>before</b> you commit. Every gate still holds — locked paths, a path’s floor requirement, and the Market’s own roster-rank limit on which materials you can buy.'],
  ] },
  { date: 'Jun 13, 2026', title: 'Cultivation', items: [
    ['See stat changes as you allocate', 'While distributing attribute points on a cultivator’s <b>Character</b> sheet, the <b>Combat Profile</b> now previews the outcome <b>before you commit</b>. Each affected stat — <b>ATK · HP · DEF · SPD</b>, plus Crit, Evasion, Hit, Potency and the rest — shows a <b style="color:var(--jade)">jade ± delta</b> for the points you’ve <b>staged</b>, so you can stage, compare, and only <b>Confirm</b> once the build looks right. (Allocation stays permanent unless you Respec.)'],
  ] },
  { date: 'Jun 13, 2026', title: 'Arena', items: [
    ['Asynchronous PvP', 'A new <b>擂 Arena</b> page: register your battle team as a <b>defense</b>, then hunt down other real players’ teams. Every fight resolves <b>server-side</b> (authoritative — no cheating the result) and updates your <b>Elo rating</b>; climb the ladder by toppling stronger cultivators. The Arena opens once you <b>clear Floor 50</b>.'],
    ['Who you can challenge', 'Matchmaking is an <b>asymmetric band</b> — you may punch <b>up to +300 Elo above</b> you but only <b>150 below</b>, so climbing is encouraged — backed by a <b>nearest-8</b> fallback, so your closest rivals are <b>always</b> challengeable even on a thin early ladder.'],
    ['5 attempts, +1 every 15 min', 'You hold <b>5 challenge attempts</b> that recharge <b>+1 every 15 minutes</b> (offline too), spent win or lose.'],
    ['Saved defense loadouts', 'Three <b>named loadout slots</b> snapshot a team + formation, so you can swap your defending lineup in a single click.'],
  ] },
  { date: 'Jun 13, 2026', title: 'Accounts', items: [
    ['Sign in with Discord or Google', 'You can now <b>sign in</b> with a <b>Discord</b> or <b>Google</b> account from the title screen. Everyone starts as a <b>guest</b> automatically — signing in <b>secures your progress across devices</b> and carries your <b>guest Arena rating</b> with you into the account.'],
    ['Live online count', 'The top bar now shows how many <b>cultivators are online</b> right now.'],
  ] },
  { date: 'Jun 13, 2026', title: 'Cloud Saves', items: [
    ['Your saves live in the cloud', 'Progress is now stored <b>server-side</b>, not just in this browser — up to <b>2 cloud save slots</b> per account, <b>synced as you play</b> and continuable from <b>any device</b> you sign in on. (A local cache keeps a cached game playable if the cloud is briefly unreachable.)'],
    ['Bring your old saves over', 'On your <b>first sign-in</b>, the game offers to <b>carry your existing local saves</b> up into the cloud — nothing is left behind.'],
  ] },
  { date: 'Jun 13, 2026', title: 'Interface', items: [
    ['Redesigned pages', 'The <b>Character</b>, <b>Team</b>, <b>Market</b>, <b>Gu Refinery</b> and <b>Bounties</b> pages have all been <b>rebuilt</b> for a cleaner, more readable layout that better fits the game’s look.'],
    ['Formation gets its own page', 'Arranging your <b>2×5 battle board</b> now lives on a dedicated <b>阵 Formation</b> tab, split out of Team — so building your roster and setting your formation are two focused screens instead of one crowded one.'],
  ] },
  { date: 'Jun 13, 2026', title: 'Resource Drops', items: [
    ['Cleaner, capped floor drops', 'Clearing a floor now yields at most <b>5 resource types</b>: up to <b>4 path resources</b> plus <b>1 universal binder</b> that is <b>always</b> granted. Previously every eligible resource rolled on its own (no cap) and binders could whiff entirely — now a binder is <b>guaranteed every clear</b> and the path drops are trimmed to a tidy four. <b style="color:var(--jade)">Fortune</b> &amp; <b style="color:var(--jade)">Luck</b> still scale each drop’s chance and quantity.'],
  ] },
  { date: 'Jun 11, 2026', title: 'Interface', items: [
    ['Themed hover tooltips', 'Hovering a trait, <b>archetype</b>, <b>Dao affinity</b> or <b>status</b> chip now shows a <b>styled info card</b> in the game’s theme instead of the plain browser popup — and it spells out the trait’s <b>actual effects</b> (an archetype’s per-rarity stat bonuses, a status’s effect and duration, and so on). Every hover hint in the game uses this card now, and it never gets clipped by the edge of the screen.'],
    ['Sidebar regrouped', 'Related tabs now sit together: <b>Floors</b> moved directly under <b>Battle</b>, and <b>Market</b> + <b>Inventory</b> under <b>Gu Refinery</b>.'],
    ['Cleaner reading', 'Character-sheet identity chips and the nav labels are a touch larger and easier to read.'],
  ] },
  { date: 'Jun 11, 2026', title: 'Arena Combat', items: [
    ['Brush-stroke combat text', 'Floating arena text now renders in a <b>Chinese ink-brush calligraphy</b> typeface fitting the cultivation theme — damage stays in Arabic numerals and labels in English, both in brush strokes. Killer-move <b>names</b> ride the brush, while the large <b>background glyph</b> keeps the clean serif.'],
    ['Bigger, clearer numbers', 'Damage, crit, status and damage-over-time numbers are <b>much larger</b> and easier to read mid-fight, with wider spacing so stacked labels no longer overlap.'],
    ['Mender feedback', 'A <b>Mender</b>’s team heal now floats a green <b>+N</b> above each restored ally, and a <b>“cleansed”</b> tag appears whenever it strips a debuff — the support worked before, just silently.'],
  ] },
  { date: 'Jun 11, 2026', title: 'Sovereign Insight', items: [
    ['Affects your current life', '<b>Sovereign Insight</b> now takes effect the moment you buy a level — on your <b>current</b> cultivator, not just the next reincarnation. Each level grants <b>+1 Gu slot</b> and its <b>bonus stones &amp; essence</b> immediately. (The slot still re-applies, and resources still head-start, at each rebirth too.)'],
  ] },
  { date: 'Jun 11, 2026', title: 'Set your Dao Affinity', items: [
    ['One-time affinity & archetype pick', 'Older cultivators who never chose a <b>Dao Affinity</b> or <b>archetype</b> (their traits were canon defaults) are now asked to pick both <b>once</b> on load — from the <b>same foundational Dao paths and archetypes a new game offers</b>. The choice is stamped onto your existing character; nothing else about your save changes.'],
  ] },
  { date: 'Jun 11, 2026', title: 'Reincarnation', items: [
    ['Re-choose your path on rebirth', 'Reincarnating now lets you <b>re-found your cultivator</b>: enter a <b>new name</b>, choose a <b>new Dao Affinity</b>, a <b>rank-1 starter Gu</b> of that path, and a <b>new archetype</b> for the life to come.'],
    ['Affinity from a mastered life', 'The affinity choices are the paths <b>this life mastered</b> — your <b>previous affinity</b> (always), plus <b>every Dao path you reached Comprehension level 5+</b> in. Spread your comprehension wide and you reincarnate with more paths to choose from.'],
  ] },
  { date: 'Jun 10, 2026', title: 'Bounties', items: [
    ['Bounty board', 'A new <b>賞 Bounties</b> page: a <b>daily-rotating</b> roster of <b>lone raid-boss</b> targets, one per rank band (<b>Common → Legendary</b>). Each wanted-poster card shows the boss’s name, rank, rarity, archetype, Dao path and <b>combat stats</b> (HP · ATK · DEF · SPD).'],
    ['5 attempts, +1/hour', 'You hold <b>5 attempts</b> that recharge <b>+1 per hour</b> (offline too). Every challenge plays out <b>in the arena</b> like a real assault — no auto-resolve — and spends one attempt win or lose. Killing a bounty puts it on a <b>20-minute respawn</b> before you can hunt it again.'],
    ['Raid-boss targets', 'Each bounty is a tough <b>solo boss</b> — full Gu loadout, a killer move and a fitting <b>archetype line</b> — tuned so a rank/rarity-matched team wins <b>at most ~60%</b> of the time. Higher-rank bounties unlock as you climb the tower (F51 / 101 / 151 / 201).'],
    ['Rewards', 'A hefty <b style="color:var(--stone)">石 Primeval Stone</b> lump (<b>25×</b> the realm-gate boss clear), <b style="color:var(--jade)">10–50 ✦ Immortal Essence</b>, plus a chance at a random <b>Gu of the boss’s Dao path</b> — 30% at the bounty’s own rank, the remaining 70% sliding down to lower ranks.'],
  ] },
  { date: 'Jun 10, 2026', title: 'Market', items: [
    ['Bulk buy buttons', 'The <b>Market</b> now has <b>×1 / ×10 / ×100 / ×1000</b> buy-amount buttons — stock up on crafting resources in one click. Each <b>Buy</b> button shows the scaled total cost and greys out when you can’t afford that many.'],
  ] },
  { date: 'Jun 10, 2026', title: 'Guide', items: [
    ['Dao Paths &amp; Focus Stats', 'The in-game <b>Guide</b> gains a <b>Dao Paths &amp; Focus Stats</b> section — every Dao path grouped by category with its rarity, craft-gate floor and the <b>attribute focus</b> its affinity rewards.'],
    ['Archetype Lines', 'A companion <b>Archetype Lines</b> section lists all <b>13</b> combat &amp; support lines with their per-rarity epithet and effect (personal stat, team aura, or Gu amplifier).'],
  ] },
  { date: 'Jun 10, 2026', title: 'Cultivation', items: [
    ['Attribute Respec', 'Regret a build? A new <b>Respec</b> button on each cultivator’s <b>Character</b> sheet releases <b>all</b> of their allocated attribute points back into the unspent pool — ready to redistribute freely — for <b style="color:var(--stone)">1,000 石</b> per invested point plus a flat <b style="color:var(--jade)">100 ✦</b>.'],
  ] },
  { date: 'Jun 10, 2026', title: 'Balance', items: [
    ['Immortal Gu crafting paused', 'Crafting <b>Immortal Gu</b> (tier 6+, the unique artifacts) is <b>disabled for now</b>. They still appear in the Refinery but can’t be forged; already-owned immortal Gu are unaffected and still <b>ascend</b>.'],
    ['Sovereign Insight nerf', 'The <b>Sovereign Insight</b> prestige boon has been reined in: it is now <b>capped at 5 levels</b> (previously uncapped), and its purchase <b>cost has been increased to 4×</b>.'],
    ['Sovereign Might &amp; Fortune nerf', '<b>Sovereign Might</b> and <b>Sovereign Fortune</b> now cost <b>5× more per level</b> and are <b>capped at 5 levels</b> (matching Sovereign Insight). Existing prestige levels have been <b>recalibrated</b> to what your already-spent souls buy at the new price — and <b>clamped to the cap</b> — with any <b>leftover souls refunded</b>. Nothing is lost; your boons just sit at a level matching the new cost.'],
    ['Dismiss refund nerf', 'The <b style="color:var(--jade)">✦ Immortal Essence</b> refunded for <b>dismissing</b> a recruit has been cut to <b>a quarter</b> of its former value, across every rarity.'],
  ] },
  { date: 'Jun 9, 2026', title: 'Daily Quests', items: [
    ['Daily Quests', 'A new <b>日 Quests</b> page in the sidebar with five daily goals — win battles, refine Gu, recruit, breakthrough and shop the Market. Each pays <b style="color:var(--jade)">✦ Immortal Essence</b> on <b>claim</b>, and the board <b>resets every day at midnight</b>.'],
    ['Clean Sweep bonus', 'Claim every quest in a day for a bonus lump of ✦. A jade badge on the <b>Quests</b> nav tab shows how many rewards are ready to collect.'],
  ] },
  { date: 'Jun 9, 2026', title: 'Killer Moves', items: [
    ['Killer Moves', 'Author a devastating <b>special move</b> for each cultivator — pick a favored-domain <b>core Gu</b> plus 2+ <b>support Gu</b> of the core’s Dao path to assemble a signature strike. <b>27 archetypes</b> across five domains (offense · guard · motion · mystic · vigor); the move fires from <b>surplus essence</b> on a short cooldown for a burst of damage, status, healing, shielding or buffs.'],
    ['Unlock', 'Killer Moves open once you <b>clear Floor 100</b>, and can be equipped on <b>Rank 3+</b> cultivators. Build one from a character’s sheet — “Suggest” auto-configures a valid set.'],
  ] },
  { date: 'Jun 9, 2026', title: 'Roster Tools', items: [
    ['Bulk Dismiss', 'Release many benched cultivators at once for Immortal Essence — a new <b>Dismiss…</b> checklist on the Team roster, with rarity / Soul-Imprint / realm filters and a one-click <b>Select duplicates</b>.'],
    ['Soul Imprint duplicates', 'A brass badge on the <b>Team</b> tab flags duplicate cultivators ready to imprint, with quick-jump chips and a one-click <b>Auto-Imprint All</b> (keeps each name’s highest-realm copy). Imprint level now shows as gold <span style="color:var(--brass)">★</span> stars on every character card and in the arena.'],
    ['Search bars', 'Find things fast — search added to the <b>Almanac</b>, <b>Gu Refinery</b> and <b>roster</b>, plus a path filter + search when equipping Gu.'],
  ] },
  { date: 'Jun 8, 2026', title: 'Combat & Arena', items: [
    ['Instant challenge', '<b>Attempt Floor</b> and <b>Auto-Challenge</b> now interrupt the current fight immediately instead of waiting for the animation to finish.'],
    ['Arena readout', 'The arena now shows the <b>floor</b> you’re fighting and the <b>wave</b> count, centred just below the battlefield.'],
    ['Crit rework', '<b>Crit Chance</b> (LUCK) and <b>Crit Resist</b> (CON) now scale linearly &amp; uncapped, like Evasion/Hit — and Crit Resist is shown in the character <b>Combat Profile</b>.'],
  ] },
  { date: 'Jun 7, 2026', title: 'Guide & Polish', items: [
    ['Guide: resonance', 'The in-game <b>Guide</b> now explains same-path Gu <b>resonance</b>.'],
    ['Tutorial fix', 'Finishing <b>First-Steps</b> no longer re-opens the checklist when you later undo a completed step (e.g. unequipping your starter Gu).'],
    ['Visual polish', 'The screen vignette no longer dims UI content — it’s confined to the corners.'],
  ] },
];
// ---------- daily quests ----------
// Human-friendly "resets in …" from a ms span (Xh Ym, or Ym, or <1m).
function fmtReset(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  if (m < 1) return 'under a minute';
  const h = Math.floor(m / 60), mm = m % 60;
  return h ? `${h}h ${mm}m` : `${mm}m`;
}
// Seconds-precision clock for short countdowns (e.g. the bounty respawn): M:SS, or H:MM:SS past an hour.
function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}
export function viewQuests() {
  ensureDaily();
  const done = DAILY_QUESTS.filter((q) => questComplete(q.id)).length;
  const claimable = claimableCount();
  const ready = pendingReward();
  const sweptDone = allClaimed();

  const rows = DAILY_QUESTS.map((q) => {
    const prog = questProgress(q.id), goal = questGoal(q.id);
    const can = questClaimable(q.id), got = questClaimed(q.id), full = questComplete(q.id);
    const fillPct = Math.round((prog / goal) * 100);
    const state = got ? 'claimed' : can ? 'ready' : full ? 'full' : 'open';
    const action = got
      ? '<span class="q-claimed">✓ Claimed</span>'
      : can
        ? `<button class="primary q-claim" onclick="G.claimQuest('${q.id}')">Claim +${q.reward} ✦</button>`
        : `<span class="q-reward">+${q.reward} ✦</span>`;
    return `<div class="quest-row ${state}">
      <div class="q-mark">${got ? '✓' : full ? '★' : '○'}</div>
      <div class="q-body">
        <div class="q-label">${q.label}</div>
        <div class="q-hint">${q.hint}</div>
        <div class="q-bar"><span style="width:${fillPct}%"></span></div>
      </div>
      <div class="q-side"><div class="q-count">${prog} / ${goal}</div>${action}</div>
    </div>`;
  }).join('');

  // All-clear bonus row.
  const bonusReady = bonusClaimable();
  const bonusRow = `<div class="quest-row bonus ${S().daily.bonusClaimed ? 'claimed' : bonusReady ? 'ready' : 'open'}">
    <div class="q-mark">${S().daily.bonusClaimed ? '✓' : '✦'}</div>
    <div class="q-body">
      <div class="q-label">Clean Sweep — claim every daily quest</div>
      <div class="q-hint">A bonus for completing the full board today.</div>
      <div class="q-bar"><span style="width:${Math.round((done / DAILY_QUESTS.length) * 100)}%"></span></div>
    </div>
    <div class="q-side"><div class="q-count">${DAILY_QUESTS.filter((x) => questClaimed(x.id)).length} / ${DAILY_QUESTS.length}</div>
      ${S().daily.bonusClaimed
        ? '<span class="q-claimed">✓ Claimed</span>'
        : bonusReady
          ? `<button class="primary q-claim" onclick="G.claimDailyBonus()">Claim +${COMPLETE_ALL_BONUS} ✦</button>`
          : `<span class="q-reward">+${COMPLETE_ALL_BONUS} ✦</span>`}</div>
  </div>`;

  return `${pagehead('日', 'Daily · 每日', 'Quests',
    'Daily goals that reward <b style="color:var(--jade)">✦ Immortal Essence</b>. Progress counts as you play; <b>claim</b> each one when it’s complete. The board <b>resets at midnight</b> — clear them all for a bonus.')}
  <div class="cs-statgrid" style="grid-template-columns:repeat(4,1fr);margin-bottom:8px">
    <div class="cs-stat"><span class="sk">Immortal Essence</span><span class="sv" style="color:var(--jade)">${fmt(S().essence)} ✦</span></div>
    <div class="cs-stat"><span class="sk">Ready to Claim</span><span class="sv" style="color:var(--jade)">${ready ? '+' + ready + ' ✦' : '—'}</span></div>
    <div class="cs-stat"><span class="sk">Completed</span><span class="sv">${done} / ${DAILY_QUESTS.length}</span></div>
    <div class="cs-stat"><span class="sk">Resets In</span><span class="sv">${fmtReset(msToReset())}</span></div>
  </div>
  <div class="row gap" style="margin:0 0 14px;align-items:center">
    <button class="primary" ${claimable ? '' : 'disabled'} onclick="G.claimAllQuests()">Claim All${claimable ? ` · +${ready} ✦` : ''}</button>
    ${sweptDone ? '<span class="muted small">All done for today — come back tomorrow for a fresh board.</span>' : ''}
  </div>
  <div class="quest-list">${rows}${bonusRow}</div>`;
}

// ---------- bounties ----------
const bountyActionKey = (left, cd, open) => !open ? 'lock' : cd > 0 ? 'cd' + Math.ceil(cd / 1000) : 'rdy' + (left > 0 ? 1 : 0);
function bountyActionHTML(slot, left, cd, open) {
  const k = bountyActionKey(left, cd, open);
  if (!open) return `<button class="bc-go" id="bc-act-${slot}" data-k="${k}" disabled>🔒 Reach Floor ${slotUnlockFloor(slot)}</button>`;
  if (cd > 0) return `<button class="bc-go" id="bc-act-${slot}" data-k="${k}" disabled>⏳ Respawning · ${fmtCountdown(cd)}</button>`;
  return `<button class="primary bc-go" id="bc-act-${slot}" data-k="${k}" ${left > 0 ? '' : 'disabled'} onclick="G.attemptBounty(${slot})">${left > 0 ? '⚔ Challenge' : 'No attempts left'}</button>`;
}
// Brass attempt pips (shares .ach-* styles introduced by the Arena port).
const bountyPipsHtml = (left) =>
  [...Array(BOUNTY_MAX_ATTEMPTS)].map((_, i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('');

// Live 1-second updater — same surgical strategy as before (no full re-render: scroll, hover and
// the sticky rail survive). Now also repaints the pip meter.
export function tickBounties() {
  if (!document.querySelector('.bn2-split')) return; // not on the Bounties tab
  const left = attemptsLeft();
  const set = (id, t) => { const e = document.getElementById(id); if (e && e.textContent !== t) e.textContent = t; };
  const pips = document.getElementById('bnt-pips');
  if (pips && pips.dataset.left !== String(left)) { pips.dataset.left = String(left); pips.innerHTML = bountyPipsHtml(left); }
  set('bnt-attempts', String(left));
  set('bnt-next', left >= BOUNTY_MAX_ATTEMPTS ? 'Full' : fmtReset(msToNextAttempt()));
  set('bnt-reset', fmtReset(msToReset()));
  document.querySelectorAll('[id^="bc-act-"]').forEach((btn) => {
    const slot = +btn.id.slice(7);
    const open = slotUnlocked(slot), cd = open ? respawnRemaining(slot) : 0;
    if (btn.dataset.k !== bountyActionKey(left, cd, open)) btn.outerHTML = bountyActionHTML(slot, left, cd, open);
  });
}

export function viewBounties() {
  const list = dailyBounties();
  const left = attemptsLeft();
  const nextMs = msToNextAttempt();
  // Gu-reward chance ladder ("30% R3 · 35% R2 · 35% R1 [· miss]") — miss computed from exact chances.
  const guRewardDesc = (gr) => {
    const ranks = Object.keys(gr.chances).map(Number).sort((a, b) => b - a);
    const parts = ranks.map((r) => `${Math.round(gr.chances[r] * 100)}% R${r}`);
    const miss = 1 - ranks.reduce((s, r) => s + gr.chances[r], 0);
    if (miss > 1e-9) parts.push(`${Math.round(miss * 100)}% miss`);
    return parts.join(' · ');
  };
  const rows = list.map((b) => {
    const open = slotUnlocked(b.slot);
    const col = rarityColor(b.rarity);
    const cd = open ? respawnRemaining(b.slot) : 0;
    return `<div class="bn2-row${open ? '' : ' locked'}" style="--rc:${col}">
      <div class="bn2-seal"><span class="cjk">${lineCjk(b.line)}</span><i>R${b.rank}</i></div>
      <div class="bn2-id">
        <b>${b.name}</b>
        <span class="bn2-sub" style="color:${col}">${b.rarity} · ${lineName(b.line, b.rarity)} <span class="muted">· ${lineRole(b.line)}</span></span>
        <span class="bn2-sub dim">${pathCjk(b.path)} ${pathName(b.path)}</span>
      </div>
      <div class="bn2-stats">
        <div><span class="sk">HP</span><b>${fmt(b.unit.maxHp)}</b></div>
        <div><span class="sk">ATK</span><b>${fmt(b.unit.atk)}</b></div>
        <div><span class="sk">DEF</span><b>${fmt(b.unit.def)}</b></div>
        <div><span class="sk">SPD</span><b>${b.unit.spd}</b></div>
      </div>
      <div class="bn2-loot">
        <span class="stone">+${fmt(b.rewards.stones)} 石</span>
        <span class="jade">+${b.rewards.essence} ✦</span>
        <span class="bn2-gu" title="${pathName(b.path)} Gu drop">蠱 ${guRewardDesc(b.rewards.guReward)}</span>
      </div>
      <div class="bn2-act">${bountyActionHTML(b.slot, left, cd, open)}</div>
    </div>`;
  }).join('');
  return `${pagehead('賞', 'Hunt · 悬赏', 'Bounties',
    'Hunt a daily roster of <b>lone raid-boss</b> targets. You hold <b>5 attempts</b> that recharge <b>+1 per hour</b> — spent win or lose. Higher-rank bounties unlock as you climb the tower.')}
  <div class="bn2-split">
    <aside class="bn2-rail">
      <div class="bn2-h">Attempts</div>
      <div class="ach-row">
        <span class="ach-pips" id="bnt-pips" data-left="${left}">${bountyPipsHtml(left)}</span>
        <b class="ach-count"><span id="bnt-attempts">${left}</span><span>/${BOUNTY_MAX_ATTEMPTS}</span></b>
      </div>
      <div class="bn2-cell"><span class="bn2-h">Next Attempt</span><b id="bnt-next">${left >= BOUNTY_MAX_ATTEMPTS ? 'Full' : fmtReset(nextMs)}</b></div>
      <div class="bn2-cell"><span class="bn2-h">Roster Resets</span><b id="bnt-reset">${fmtReset(msToReset())}</b></div>
      <hr class="fm4-rule">
      <div class="bn2-note">Attempts are spent win or lose · kills respawn after 20 min</div>
    </aside>
    <div>${rows}</div>
  </div>`;
}


export function viewWhatsNew() {
  const entries = WHATS_NEW.map((e) => `<section class="wn-entry">
    <div class="wn-head"><span class="wn-tag">Update</span><span class="wn-title">${e.title}</span><span class="wn-date">${e.date}</span></div>
    <div class="card"><div class="body"><ul class="cdx-list wn-list">
      ${e.items.map(([h, t]) => `<li><b>${h}</b> — ${t}</li>`).join('')}
    </ul></div></div></section>`).join('');
  return `${pagehead('新', 'Dispatches · 新讯', "What's New",
    'Patch notes &amp; new content as the world of Gu deepens. Newest at the top.')}
  ${entries}`;
}

// ---------- codex ----------
// Reference table of every Dao Path grouped by category, with its rarity (commonality) and focus stats
// (PATH_AFFINITY — the effect-kinds the path is built around; a matching Gu line gets the ×1.10 bonus).
const CODEX_CAT_ORDER = ['five_elements', 'mainstream', 'combat', 'mental', 'utility', 'minor', 'three_supreme'];
function codexPathTable() {
  const byCat = {};
  for (const p of pathList()) (byCat[p.category] = byCat[p.category] || []).push(p);
  let html = '';
  for (const cat of CODEX_CAT_ORDER) {
    const paths = byCat[cat];
    if (!paths) continue;
    const rows = paths.map((p) => {
      const c = commOf(p.id);
      const foc = PATH_AFFINITY[p.id] || [];
      const focHtml = foc.length
        ? foc.map((k) => `<span>${k}</span>`).join(' · ')
        : '<span class="muted">— locked —</span>';
      return `<tr>
        <td class="cdx-path"><span class="cdx-seal" style="color:${pathColor(p.id)}">${p.cjk}</span>${pathName(p.id)}</td>
        <td><span class="pill" style="color:${c.color};border-color:${c.color}66">${c.label}</span></td>
        <td class="cdx-foc">${focHtml}</td>
      </tr>`;
    }).join('');
    html += `<div class="cdx-cat">${CATEGORY_LABELS[cat] || cat}</div>
      <table class="cdx-table"><tr><th>Path</th><th>Rarity</th><th>Focus stats</th></tr>${rows}</table>`;
  }
  return html;
}

// Reference of every archetype LINE — its per-rarity epithet + effect (lineTierEffects abstracts over the
// self / team-aura / Gu-amp shapes). Mirrors the new-game archetype picker's rarity ladder.
function codexArchetypes() {
  return LINE_ORDER.map((id) => {
    const rows = RARITY_ORDER.map((r) => {
      const effs = archEffects(id, r);
      return `<tr>
        <td><b style="color:${rarityColor(r)}">${r}</b></td>
        <td class="cdx-path">${lineName(id, r)}</td>
        <td class="cdx-foc">${effs.length ? effs.join(' · ') : '—'}</td>
      </tr>`;
    }).join('');
    return `<div class="cdx-arch">
      <div class="cdx-arch-head"><span class="cdx-seal" style="color:var(--stone)">${lineCjk(id)}</span><b>${LINES[id].name}</b><span class="muted small">— ${lineRole(id)}</span></div>
      <div class="cdx-arch-blurb muted small">${lineBlurb(id)}</div>
      <table class="cdx-table"><tr><th>Rarity</th><th>Epithet</th><th>Effect at this rarity</th></tr>${rows}</table>
    </div>`;
  }).join('');
}

export function viewCodex() {
  const toc = [
    ['cdx-1', 'Attributes'], ['cdx-2', 'Realms'], ['cdx-3', 'Breakthroughs'], ['cdx-4', 'Aptitude'],
    ['cdx-5', 'Gu'], ['cdx-6', 'Refining'], ['cdx-7', 'Dao Paths'], ['cdx-8', 'Market'], ['cdx-9', 'Combat & Idle'],
    ['cdx-10', 'Soul Imprint'], ['cdx-11', 'Killer Moves'], ['cdx-12', 'Path Focus Stats'], ['cdx-13', 'Archetypes'],
  ].map(([id, label]) => `<a class="cdx-tab" href="#${id}" onclick="G.cdxOpen('${id}');return false;">${label}</a>`).join('');
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
  <div class="cdx-toc">${toc}<button class="cdx-allbtn" onclick="G.cdxToggleAll(this)">⊕ Expand all</button></div>

  <details class="cdx-sec" id="cdx-1"><summary>${secHead(1, 'The Five Attributes', 'your raw power')}</summary>
  <div class="card"><div class="body">Every cultivator's strength comes from five attributes, raised by spending the points each breakthrough grants. Allocate them on a cultivator's <b>Character</b> sheet (the ＋ / − buttons, then <b>Confirm</b>); a red mark on the <b>Team</b> tab means someone has points waiting.
  <ul class="cdx-list">
    <li><b>STR</b> · Strength <span class="muted">— ATK, Crit Damage, Armor Penetration</span></li>
    <li><b>AGI</b> · Agility <span class="muted">— Speed, Evasion, Hit</span></li>
    <li><b>CON</b> · Constitution <span class="muted">— Max HP, DEF, Resistances, Regen</span></li>
    <li><b>INT</b> · Intelligence <span class="muted">— Potency (status power), essence pool &amp; regen</span></li>
    <li><b>LCK</b> · Luck <span class="muted">— Crit chance, Lucky hits, drop rate</span></li>
  </ul>
  There is <b>no realm multiplier</b> — all your power lives in these points, so a higher realm matters because it grants <b>more</b> of them. Raw stats (HP, ATK) grow steadily; percentage stats (crit, evasion) have diminishing returns and scale relative to your realm.
  <br><br>Regret a build? <b>Respec</b> on the Character sheet refunds every allocated point back into the unspent pool for <b>1,000 石 per invested point</b> plus a flat <b>100 ✦</b>, so you can redistribute freely.</div></div></details>

  <details class="cdx-sec" id="cdx-2"><summary>${secHead(2, 'Realms — Big &amp; Small', 'the cultivation ladder')}</summary>
  <div class="card"><div class="body">Cultivation climbs <b>Ranks 1–9</b> — these are the <b>big realms</b>. Each mortal rank (1–5) is split into four <b>small realms</b>: <b>Initial → Middle → Upper → Peak</b>. So the whole mortal ladder runs Rank 1 Initial … Rank 5 Peak (a "Gu Master").
  <br><br>Beyond it lie the immortal ranks <b style="color:var(--t6)">6–9</b> (a "Gu Immortal") — these have <b>no sub-stages</b> — and <b style="color:var(--t9)">Rank 9 is the Venerable</b>, the apex of all cultivation. Every step multiplies your power and grants attribute points; crossing into a new <b>big realm</b> is a far greater leap than a small-realm step.</div></div></details>

  <details class="cdx-sec" id="cdx-3"><summary>${secHead(3, 'Breaking Through', 'how you advance')}</summary>
  <div class="card"><div class="body">You don't grind XP to level up. A mortal breakthrough is <b>purchased with <span style="color:var(--stone)">石 Primeval Stones</span></b> on a cultivator's <b>Character</b> sheet, and it can <b>fail</b> — but failure only spends the stones (no injury, no setback), so simply try again once you can afford it.
  <br><br><b>Success chance = 70% from your Aptitude + 30% from your highest Dao Comprehension.</b> Raise either to make breakthroughs more reliable.
  <br><br>Crossing into a new <b>big realm</b> is <b>floor-gated</b> — you must first clear a tower floor:
  <ul class="cdx-list">
    <li><b>Rank 2</b> — clear Floor 50</li>
    <li><b>Rank 3</b> — clear Floor 100</li>
    <li><b>Rank 4</b> — clear Floor 150</li>
    <li><b>Rank 5</b> — clear Floor 200</li>
  </ul>
  Small-realm steps (Initial→Middle…) have no gate. Each success grants attribute points — and high aptitude adds bonus points on top. Immortals (Rank 6+) advance differently: by surviving <b>Tribulations</b> on the <b>Dao</b> tab.</div></div></details>

  <details class="cdx-sec" id="cdx-4"><summary>${secHead(4, 'Aptitude &amp; the Aperture', 'how much essence you hold')}</summary>
  <div class="card"><div class="body"><b>Aptitude does not speed up cultivation.</b> It sets your <b>aperture capacity</b> — the share of the primeval-essence pool you can actually fill, graded <b>D → C → B → A → Extreme</b>. (Fang Yuan opens with an <b>Extreme</b> aperture.)
  <br><br>Essence powers your Gu in battle: every action channels your Gu, paying each one's essence cost. Your Gu fire <b>in loadout order</b> (slot 1 first), and each action lights up as many as your essence can afford — if your aperture can't cover the whole kit, the Gu past that point simply <b>stay dark</b> for that swing (an unlit Gu adds nothing — not its attack, defence, HP, nor status). A Gu rises again the moment your essence recovers. With <b>no</b> Gu lit you still fight bare-handed, so equipping Gu can never make you weaker. Put your most important Gu in the <b>early slots</b>; aptitude (aperture) and <b>INT</b>/<b>rank</b> decide how deep into the loadout you can sustain.</div></div></details>

  <details class="cdx-sec" id="cdx-5"><summary>${secHead(5, 'Gu — One Gu, One Power', 'your equipment')}</summary>
  <div class="card"><div class="body">A Gu is a living treasure that does exactly <b>one</b> thing — only its strength scales with its <b>tier (1–10)</b>. Tiers <b>1–5 are common</b> (you may own many); tiers <b style="color:var(--t6)">6–10 are unique</b> — a single copy exists in the entire world.
  <br><br>Stat Gu (ATK / DEF / HP) grant a <b>percentage</b> of your attribute base, so they stay relevant at any depth. Equip Gu in the loadout slots on a <b>Character</b> sheet — you open with <b>3 slots at Rank 1</b> and gain one per big realm, up to <b>7 at Rank 5</b>.
  <br><br><b style="color:var(--immstone)">仙石 Immortal Gu need Immortal Essence Stones.</b> A <b style="color:var(--t6)">tier 6+</b> (immortal) Gu draws on a special currency — <b style="color:var(--immstone)">Immortal Essence Stones (仙石)</b> — that only unlocks once one of your cultivators reaches <b>immortal Rank 6</b>. From then on, clearing floors gathers 仙石, and each clear spends a little to keep your immortal Gu channelling. <b>While your 仙石 pool is empty, every immortal Gu is inert</b> — it adds nothing in battle until you gather more.</div></div></details>

  <details class="cdx-sec" id="cdx-6"><summary>${secHead(6, 'The Refinery — Crafting &amp; Refining', 'making Gu')}</summary>
  <div class="card"><div class="body">Every Gu is built from a recipe in the <b>Gu Refinery</b>: <span style="color:var(--stone)">石 Stones</span> + that path's <b>resources</b> (no essence). Resources <b>drop from tower floors</b> and can also be bought in the <b>Market</b>.
  <br><br>Higher tiers are <b>refined</b>: besides materials, the recipe consumes <b>spare Gu of the same path exactly one tier lower</b>, whose effect <b>tags</b> cover the new Gu's tags (at least two pieces of fodder, every one on-tag). To forge a Tier 3 [ATK] Gu, you feed it Tier 2 ATK Gu of that path.
  <br><br>A path's Gu only become craftable once the tower runs deep enough — <b>common</b> paths from Floor 1, <b>uncommon</b> from 51, <b>rare</b> from 101, <b>esoteric</b> from 201.
  <br><br><b>Auto-Craft</b>: short on materials or the lower-tier fodder? If your stones can cover it, the desk's <b>⚒ Auto-Craft</b> button <b>buys the missing resources from the Market and forges the whole lower-tier chain</b> for you in one click — so with enough <span style="color:var(--stone)">石</span> you can jump straight to a Tier 5 Gu without hand-building T1→T4 first. It still respects the Market's own gates (you can only buy materials your cleared floors + roster rank unlock).</div></div></details>

  <details class="cdx-sec" id="cdx-7"><summary>${secHead(7, 'Dao Paths &amp; Comprehension', 'mastery over time')}</summary>
  <div class="card"><div class="body">Every Gu belongs to a <b>Dao Path</b>. Fighting with a path's Gu raises your <b>Comprehension</b> of it (0–10, capped by your rank), which amplifies every Gu of that path — under-comprehension weakens it, mastery rewards it, and <b>level 10</b> is a prerequisite for Venerable.
  <br><br>Your starting path is your <b>Dao Affinity</b>: it grants <b>+10% effectiveness</b> and <b>+25% comprehension gain</b> on that path. Immortals additionally earn <b>Dao Marks</b> from tribulations, which further amplify their paths.
  <br><br><b>Resonance</b> rewards focusing one path: equipping several Gu of the <b>same path</b> on a cultivator grants a set bonus to that path's effect — <b>+5%</b> with 2, then +10% · +15% · +20%, up to <b>+25% with 6</b>. It applies to <b>everyone</b> (not just immortals) and <b>stacks</b> with affinity and comprehension, so a focused single-path loadout outperforms a scattered one. Track all of this on the <b>Dao</b> and <b>Attainment</b> tabs.</div></div></details>

  <details class="cdx-sec" id="cdx-8"><summary>${secHead(8, 'The Market', 'when floors are slow to drop')}</summary>
  <div class="card"><div class="body">The <b>Market</b> stocks every resource you've <b>unlocked</b>, so you can buy what the floors are slow to drop. A resource unlocks only when <b>both</b> are true: you've <b>cleared a floor it drops from</b>, and you have a cultivator whose <b>rank is at least the resource's tier</b> (a Rank-3 roster can't buy Epic / tier-4 materials yet). Prices climb steeply with tier, so deep materials are a serious <span style="color:var(--stone)">石</span> sink.</div></div></details>

  <details class="cdx-sec" id="cdx-9"><summary>${secHead(9, 'Currencies, Combat &amp; Idle', 'the daily loop')}</summary>
  <div class="card"><div class="body"><b>Two currencies.</b> <b style="color:var(--stone)">石 Primeval Stones</b> buy resources and fund breakthroughs &amp; Gu crafting. <b style="color:var(--jade)">✦ Immortal Essence</b> funds recruiting (<b>Recruit</b> tab) and ascension. You earn an essence lump the <b>first</b> time you clear each floor (bosses far more), plus a small trickle from farming any cleared floor.
  <br><br><b>Combat is automatic.</b> Your team (max 6) fights on a <b>2×5 board</b> — a front-row unit shields the back-liner <i>in its own lane</i> until it falls, and each fighter acts when its movement gauge fills, so higher <b>SPD</b> means more frequent turns. Leave <b>Idle Farm</b> running on any cleared floor to gather while you're away, press <b>Attempt Floor</b> to push your frontier, or <b>Auto-Challenge</b> to climb until you fall.</div></div></details>

  <details class="cdx-sec" id="cdx-10"><summary>${secHead(10, 'Soul Imprint', 'strengthen a copy with its duplicates')}</summary>
  <div class="card"><div class="body">Recruiting can hand you <b>duplicates</b> — two or more copies of the same cultivator. Instead of dismissing the spares, you can <b>imprint</b> them: sacrifice a benched duplicate into one copy to raise its <b>Soul Imprint</b> (<span class="cjk">魂印</span>), from <b>Lv 0 up to Lv 10</b>. Each level permanently grants that copy:
  <ul class="cdx-list">
    <li><b>+5% to all five attributes</b> <span class="muted">— a flat multiplier, so +50% at Lv 10</span></li>
    <li><b>+0.1 aptitude</b> <span class="muted">— up to +1.0 at Lv 10</span></li>
  </ul>
  Because aptitude does so much, that bonus ripples outward: a <b>fuller aperture</b>, <b>better breakthrough odds</b>, and even the <b>bonus attribute points</b> you'd have earned crossing past realms at the higher aptitude — all granted retroactively.
  <br><br>Open the kept copy's <b>Character</b> sheet and use <b>Imprint · Sacrifice a Duplicate</b>, then choose which spare to consume (it must be <b>benched</b>, and it's destroyed). Pour your duplicates into one carry to forge it far beyond a lone copy.</div></div></details>

  <details class="cdx-sec" id="cdx-11"><summary>${secHead(11, 'Killer Moves', 'your Gu-built ultimate')}</summary>
  <div class="card"><div class="body">A <b>killer move</b> is a special move you build on a cultivator's <b>Character</b> sheet from the Gu it already wields. Three steps: pick an <b>archetype</b> (the move's shape) → a <b>CORE</b> Gu of that archetype's <b>favored domain</b> (e.g. an ATK/lifesteal Gu for an offense move) → <b>2+ SUPPORT</b> Gu that all share the core's <b>Dao path</b>. The path sets the move's name and the status it inflicts. Hit <b>✦ Suggest</b> to auto-fill.
  <br><br><b>Unlocking.</b> Killer moves are a mid-game art: they become available only after you <b>clear Floor 100</b>, and only on cultivators of <b>Rank 3 or higher</b>. Enemies of Rank 3+ wield them too.
  <br><br><b>Effect domains</b> group Gu by role: <b>Offense</b> (atk · crit · armour-pen · lifesteal) · <b>Guard</b> (def · resist · thorns) · <b>Motion</b> (spd · evasion) · <b>Mystic</b> (potency · status · luck) · <b>Vigor</b> (HP · regen · essence pool/regen). Each archetype is gated to one domain's core.
  <br><br><b>Synergy.</b> Your support is already one path; the more of it that <b>also matches the favored domain</b> (★), the stronger the move — a fully on-domain support reads <b>High</b> synergy, an all-off-domain one sits at the floor.
  <br><br><b>Power.</b> Single-target moves hit far harder <i>per foe</i> than AoE — AoE trades raw punch for spread. A deeper set (4–5 Gu) and higher-tier Gu both scale it up.
  <br><br><b>Casting.</b> A killer move spends a chunk of <b>essence</b> on top of normal Gu channeling, so it fires only once you've <b>banked enough surplus</b> — a high aperture (INT, aptitude, the right Gu) charges it faster. After firing it has a short <b>3-turn cooldown</b>. Enemies — especially bosses — wield killer moves too, so read their loadouts.</div></div></details>

  <details class="cdx-sec" id="cdx-12"><summary>${secHead(12, 'Dao Paths &amp; Focus Stats', 'every path at a glance')}</summary>
  <div class="card"><div class="body">Every Gu belongs to a <b>Dao Path</b>, and each path emphasises a few <b>focus stats</b> — the effect-kinds it is built around. Any Gu whose effect matches one of its path's focus stats gets a flat <b>×1.10</b> boost, and these stats define each path's signature Gu. A path's <b>rarity</b> sets how deep the tower must run before its Gu can be crafted (<b>Common</b> Floor 1 · <b>Uncommon</b> 51 · <b>Rare</b> 101 · <b>Esoteric</b> 201); the three <b>Supreme</b> paths are locked.
  ${codexPathTable()}</div></div></details>

  <details class="cdx-sec" id="cdx-13"><summary>${secHead(13, 'Archetype Lines', 'effects at every rarity')}</summary>
  <div class="card"><div class="body">Every cultivator carries one <b>archetype line</b> — chosen at the start, or fixed by canon for recruits. Its bonus is <b>tier-scaled to the holder's rarity</b> (a Common holder gets the weak rung, an Immortal the strongest), and the epithet name changes per rarity too. Most lines are <b>per-unit</b> stat bonuses; <b>Warden / Commander / Mender</b> are <b>team auras</b> applied to the whole side; the <b>Adept</b> amplifies every equipped Gu. A leading <b>−</b> (e.g. the Slayer's −8% DEF) is a deliberate flaw.
  ${codexArchetypes()}</div></div></details>

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
    const atMax = boonAtMax(k), cost = boonCost(k), afford = p.souls >= cost;
    const max = BOONS[k].max;
    return `<div class="markrow">
      <span><b>${BOONS[k].name}</b> <span class="pill">Lv ${boonLevel(k)}${max ? ` / ${max}` : ''}</span>
        <span class="muted small">${BOONS[k].blurb}</span></span>
      ${atMax
        ? '<button disabled>MAX</button>'
        : `<button onclick="G.buyBoon('${k}')" ${afford ? '' : 'disabled'}>${cost} ✦souls</button>`}
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
      return ASCENSION_LOCKED
        ? `<div class="card member">${head}
          <div class="body" style="margin-top:10px">Rank 5 Peak reached — the mortal ceiling. Rank 6 (Gu Immortal) is still locked.</div>
          <div style="margin-top:12px"><button class="primary" disabled>🔒 Ascension Locked</button></div>
          <div class="muted small" style="margin-top:6px">Ascension is unavailable for now.</div></div>`
        : `<div class="card member">${head}
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
// ================= ARENA (async PvP) =================
// Split layout: a sticky "Your Standing" panel (rating, register, defense preview, 3 loadout slots,
// challenge attempts + refill timer) beside the ladder — top 3 as podium cards, the rest as rows,
// every team showing its full defense formation. Ladder data still arrives via main.js → renderArenaList.
const ARENA_CJK_NUM = ['壹', '貳', '參', '肆', '伍', '陸', '柒', '捌', '玖', '拾'];

function viewPvp() {
  ensureArenaMeta();
  // PROGRESSION GATE: the Arena opens only after the player has BEATEN floor 50 (arenaMeta.js
  // arenaUnlocked / main.js openArena enforce it too — this is the matching locked view).
  if (!arenaUnlocked()) {
    return pagehead('擂', 'Asynchronous PvP', 'Arena',
      'A proving ground for cultivators who have tempered themselves against the tower.')
      + `<div class="killer-block killer-locked" style="max-width:560px">
        <div class="killer-row"><b>🔒 Arena locked</b></div>
        <div class="killer-hint">The Arena is a mid-game proving ground — it opens once you have beaten the tower's first gate:</div>
        <ul class="km-reqs">
          <li class="km-req-no">✗ Clear <b>Floor ${ARENA_UNLOCK_FLOOR}</b> — currently at Floor ${S().frontier}</li>
        </ul>
      </div>`;
  }
  return pagehead('擂', 'Asynchronous PvP', 'Arena',
    'Register your battle team as a defense, then challenge other cultivators. Fights resolve server-side; climb the ladder by beating stronger opponents.')
    + `<div class="arena-pvp">
      <aside class="apv-side">
        <div class="apv-ghost" id="arena-myghost">擂</div>
        <div class="apv-h">Your Standing</div>
        <div class="apv-pts" id="arena-myrating">—</div>
        <div class="apv-pos" id="arena-mypos">Unranked — register your defense to enter the ladder</div>
        <div class="apv-rec" id="arena-myrecord"></div>
        <hr class="apv-rule">
        <label class="apv-name">Name <input id="arena-name" type="text" maxlength="40" placeholder="Anonymous"
          onchange="G.arenaSetName(this.value)"></label>
        <button class="primary apv-wide" onclick="G.arenaRegister(this)">Register / Update Defense</button>
        <button class="apv-wide" onclick="G.arenaRefresh()" title="Refresh the ladder">↻ Refresh Ladder</button>
        <hr class="apv-rule">
        <div class="apv-h">Your Defense</div>
        <div id="arena-mydef">${arenaFormation(arenaLocalDef())}</div>
        <hr class="apv-rule">
        <div class="apv-h">Loadouts</div>
        <div class="ald-col" id="arena-loadouts">${arenaLoadoutsHtml()}</div>
        <hr class="apv-rule">
        <div class="apv-h">Arena Challenges</div>
        <div id="arena-attempts">${arenaAttemptsHtml()}</div>
      </aside>
      <div class="apv-main" id="arena-list"><div class="muted" style="padding:20px 4px">Loading the ladder…</div></div>
    </div>`;
}

// ---- shared formation mini-grid (side preview, podium cards, ladder rows) ----
// Accepts members shaped like the server payload ({name,rarity,realm,row,lane,daoPath,line}).
const arenaSealOf = (m) => m.daoPath ? pathCjk(m.daoPath) : (m.line ? lineCjk(m.line) : '蛊');
const arenaSealColor = (m) => m.daoPath ? pathColor(m.daoPath) : 'var(--stone)';
const arenaTile = (m, title) => {
  const rc = rarityColor(m.rarity) || 'var(--stone)';
  return `<div class="afm-tile" style="border-left-color:${rc}" title="${esc(title)}">
    <span class="afm-seal" style="color:${arenaSealColor(m)}">${arenaSealOf(m)}</span>
    <span class="afm-name" style="color:${rc}">${escTipHtml(m.name)}</span>
    <span class="afm-realm">${realmName(m.realm).replace('Rank ', 'R')}</span></div>`;
};
// `conceal` (opponents): hide the Gu loadout, killer move AND front/back formation — a flat, power-sorted
// roster whose tooltip reveals only name / rarity / realm. Without it (your own team) the full positional
// grid + Gu/killer tooltip shows. Path seal + rarity stay either way (identity, not loadout).
function arenaFormation(members, opts = {}) {
  if (opts.conceal) {
    const flat = (members || []).slice().sort((a, b) => (rarityTier(b.rarity) - rarityTier(a.rarity)) || ((b.realm | 0) - (a.realm | 0)));
    return `<div class="afm-grid concealed">${flat.map((m) => arenaTile(m, `${m.name} — ${m.rarity || ''} · ${realmName(m.realm)}`)).join('')}</div>`;
  }
  const sorted = (members || []).slice().sort((a, b) => (a.lane | 0) - (b.lane | 0));
  const front = sorted.filter((m) => m.row !== 'back'), back = sorted.filter((m) => m.row === 'back');
  const rows = Math.max(front.length, back.length, 1);
  const col = (list) => `<div class="afm-col">${Array.from({ length: rows }, (_, i) => {
    const m = list[i];
    if (!m) return '<div class="afm-tile empty"></div>';
    const title = `${m.name} — ${m.rarity || ''} · ${realmName(m.realm)} · ${m.row === 'back' ? 'Back' : 'Front'} ${(m.lane | 0) + 1}`
      + `${m.gu && m.gu.length ? '\nGu: ' + m.gu.join(', ') : ''}${m.killer ? '\nKiller: ' + m.killer : ''}`;
    return arenaTile(m, title);
  }).join('')}</div>`;
  return `<div class="afm-grid">${col(back)}${col(front)}</div>`; // back column outside, front toward the ladder
}
// Local active team → the same member shape (for the side-panel defense preview).
const arenaLocalDef = () => activeTeam().map((c) => ({
  name: c.name, rarity: c.rarity, realm: c.realm, row: rowOf(c), lane: laneOf(c),
  daoPath: (affinityPaths(c) || [])[0], line: c.line, gu: [], killer: null }));

// ---- loadout slots (3 named formation snapshots; see systems/arenaMeta.js) ----
function arenaLoadoutsHtml() {
  const a = ensureArenaMeta();
  return a.loadouts.map((ld, i) => {
    if (!ld) return `<button class="ald empty" onclick="G.arenaSaveLoadout(${i})" title="Save your current team into this slot">
      <span class="ald-n">${ARENA_CJK_NUM[i]}</span>
      <span class="ald-info"><b>Slot ${i + 1}</b><i>empty — save current team</i></span><em>＋</em></button>`;
    const active = a.active === i;
    return `<button class="ald${active ? ' active' : ''}" onclick="G.arenaApplyLoadout(${i})" title="${active ? 'This loadout is active' : 'Load this formation onto your team'}">
      <span class="ald-n">${ARENA_CJK_NUM[i]}</span>
      <span class="ald-info"><b>${escTipHtml(ld.name)}<u class="ald-edit" onclick="event.stopPropagation();G.arenaRenameLoadout(${i})" title="Rename loadout">✎</u><u class="ald-edit" onclick="event.stopPropagation();G.arenaSaveLoadout(${i})" title="Overwrite with current team">⤓</u></b>
      <i>${ld.team.length} member${ld.team.length === 1 ? '' : 's'}</i></span>
      <em>${active ? 'active' : 'load'}</em></button>`;
  }).join('');
}

// ---- challenge attempts: 5 pips + live mm:ss refill timer (ticked by main.js tickArena) ----
function arenaAttemptsHtml() {
  const left = arenaAttemptsLeft(), ms = arenaMsToNextAttempt();
  const s = Math.ceil(ms / 1000), mm = String(Math.floor(s / 60)).padStart(2, '0'), ss = String(s % 60).padStart(2, '0');
  const pips = Array.from({ length: ARENA_MAX_ATTEMPTS }, (_, i) => `<i class="${i < left ? 'on' : ''}"></i>`).join('');
  return `<div class="ach-row"><span class="ach-pips">${pips}</span><b class="ach-count">${left}<span>/${ARENA_MAX_ATTEMPTS}</span></b></div>
    <div class="ach-timer${left >= ARENA_MAX_ATTEMPTS ? ' full' : ''}">${left >= ARENA_MAX_ATTEMPTS ? 'Attempts full' : `Next attempt in <b>${mm}:${ss}</b>`}</div>`;
}
// 1-second tick (wired in main.js next to the bounty tick) — updates the attempt meter + any live
// defender-cooldown countdowns on challenge buttons (swapping back to a Challenge button when one expires).
export function tickArena() {
  const el = $('arena-attempts'); if (el) el.innerHTML = arenaAttemptsHtml();
  const now = Date.now();
  document.querySelectorAll('.arena-cd[data-until]').forEach((cd) => {
    const ms = (+cd.dataset.until) - now;
    if (ms <= 0) {
      const mini = cd.classList.contains('mini'), noAtt = arenaAttemptsLeft() <= 0;
      cd.outerHTML = `<button class="${mini ? 'mini ' : ''}primary" ${noAtt ? 'disabled' : ''} onclick="G.arenaChallenge('${cd.dataset.pid}')">⚔ Challenge</button>`;
    } else {
      const s = Math.ceil(ms / 1000), b = cd.querySelector('b');
      if (b) b.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }
  });
}
// Refresh the side panel after loadout save/apply/rename (keeps the fetched ladder intact).
export function renderArenaPanel() {
  const lo = $('arena-loadouts'); if (lo) lo.innerHTML = arenaLoadoutsHtml();
  const def = $('arena-mydef'); if (def) def.innerHTML = arenaFormation(arenaLocalDef());
}

// ---- ladder: podium (top 3) + rows. Same signature as before — called by main.js arenaRefresh. ----
export function renderArenaList(teams, myId, myName, myPoints) {
  const nameEl = $('arena-name');
  if (nameEl && document.activeElement !== nameEl) nameEl.value = myName || '';
  const rEl = $('arena-myrating'); if (rEl) rEl.textContent = (myPoints == null ? '—' : myPoints);
  const myIdx = (teams || []).findIndex((t) => t.player_id === myId);
  const posEl = $('arena-mypos');
  if (posEl) posEl.textContent = myIdx >= 0 ? `Rank #${myIdx + 1} of ${teams.length} cultivators` : 'Unranked — register your defense to enter the ladder';
  const recEl = $('arena-myrecord');
  const myTeam = (teams || []).find((t) => t.player_id === myId);
  if (recEl) recEl.innerHTML = myTeam ? 'Record ' + arenaRecordHtml(myTeam.wins, myTeam.losses, true) : '';
  const gEl = $('arena-myghost');
  if (gEl) gEl.textContent = myIdx >= 0 ? (ARENA_CJK_NUM[myIdx] || String(myIdx + 1)) : '擂';
  const host = $('arena-list'); if (!host) return;
  if (!teams || !teams.length) {
    host.innerHTML = `<div class="muted" style="padding:20px 4px">No teams registered yet — be the first: register your defense team.</div>`;
    return;
  }
  const noAtt = arenaAttemptsLeft() <= 0;
  // MATCHMAKING: gate each Challenge by the asymmetric band / nearest-K (data/arena.js) — same rule the server enforces.
  const myPts = myPoints == null ? 1000 : myPoints;
  const registered = teams.some((t) => t.player_id === myId);
  const others = teams.filter((t) => t.player_id !== myId);
  const eligOf = (t) => {
    if (t.player_id === myId) return false;
    const gap = Math.abs(t.points - myPts);
    return arenaCanChallenge(myPts, t.points, others.reduce((n, o) => n + (Math.abs(o.points - myPts) < gap ? 1 : 0), 0));
  };
  const pod = teams.slice(0, 3).map((t, i) => arenaPodiumCard(t, i + 1, t.player_id === myId, noAtt, eligOf(t), registered));
  const podium = pod.length ? `<div class="apv-podium">${[pod[1] || '', pod[0] || '', pod[2] || ''].join('')}</div>` : '';
  host.innerHTML = podium + teams.slice(3).map((t, i) => arenaRow(t, i + 4, t.player_id === myId, noAtt, eligOf(t), registered)).join('');
}

const arenaMembersOf = (t) => (t.members || []).slice()
  .sort((a, b) => (a.row === b.row ? ((a.lane | 0) - (b.lane | 0)) : (a.row === 'front' ? -1 : 1)));
const arenaCdRemaining = (t) => (t.cooldownUntil ? Date.parse(t.cooldownUntil) - Date.now() : 0);
// W–L record chip — wins green, losses red; `big` adds the win-rate (for the standing panel).
const arenaRecordHtml = (w, l, big) => {
  w = w || 0; l = l || 0; const total = w + l, wr = total ? Math.round((w / total) * 100) : 0;
  return `<span class="arena-rec${big ? ' big' : ''}" title="${w} win${w === 1 ? '' : 's'} · ${l} loss${l === 1 ? '' : 'es'}${total ? ` · ${wr}% win rate` : ''}"><b class="rec-w">${w}</b><span class="rec-sep">–</span><b class="rec-l">${l}</b>${big && total ? ` <span class="rec-wr">${wr}%</span>` : ''}</span>`;
};
const arenaChallengeBtn = (t, mine, noAtt, mini, eligible, registered) => {
  if (mine) return `<span class="mine-mark">${mini ? '魂 yours' : 'registered'}</span>`;
  const cdMs = arenaCdRemaining(t);
  if (cdMs > 0) { // defender on cooldown — show a live countdown (ticked by tickArena), not a challenge button
    const s = Math.ceil(cdMs / 1000);
    return `<span class="arena-cd${mini ? ' mini' : ''}" data-until="${Date.parse(t.cooldownUntil)}" data-pid="${t.player_id}" title="Recently challenged — protected by a 2-minute cooldown">⏳ <b>${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}</b></span>`;
  }
  if (!registered) return `<span class="arena-oor${mini ? ' mini' : ''}" title="Register your defense team to enter the ladder, then you can challenge">register first</span>`;
  if (!eligible) return `<span class="arena-oor${mini ? ' mini' : ''}" title="Outside your challenge range — ${ARENA_DOWN} below to ${ARENA_UP} above your rating (or your nearest few)">out of range</span>`;
  return `<button class="${mini ? 'mini ' : ''}primary" ${noAtt ? 'disabled title="No arena attempts left — wait for the refill timer"' : ''} onclick="G.arenaChallenge('${t.player_id}')">⚔ Challenge</button>`;
};

function arenaPodiumCard(t, rank, mine, noAtt, eligible, registered) {
  const members = arenaMembersOf(t);
  return `<div class="apd apd-${rank}${mine ? ' mine' : ''}">
    <div class="apd-ghost">${ARENA_CJK_NUM[rank - 1]}</div>
    <div class="apd-rank">RANK ${rank}</div>
    <div class="apd-owner">${escTipHtml(t.name || 'Anonymous')}${mine ? ' <span class="muted">· you</span>' : ''}</div>
    <div class="apd-pts">${t.points}<span>RATING</span></div>
    <div class="apd-rec">${arenaRecordHtml(t.wins, t.losses)}</div>
    <div class="apd-fm">${arenaFormation(members, { conceal: !mine })}</div>
    <div class="apd-foot"><span class="apd-pwr">PWR ${compact(t.power)}</span>${arenaChallengeBtn(t, mine, noAtt, true, eligible, registered)}</div>
  </div>`;
}
function arenaRow(t, rank, mine, noAtt, eligible, registered) {
  const members = arenaMembersOf(t);
  // Conceal opponents' loadout intel: only YOUR OWN row spells out the Gu count + killer moves.
  const killers = mine ? members.map((m) => m.killer).filter(Boolean) : [];
  const guN = members.reduce((s, m) => s + ((m.gu || []).length), 0);
  return `<div class="apv-row${mine ? ' mine' : ''}">
    <div class="apr-rank"><span class="apr-rk-n">${rank}</span><span class="apr-rk-l">RANK</span></div>
    <div class="apr-owner">
      <b>${escTipHtml(t.name || 'Anonymous')}</b>${mine ? '<i class="apr-you">your defense</i>' : ''}
      <span class="apr-sub">${members.length} cultivator${members.length === 1 ? '' : 's'}${mine ? ` · 蠱 ${guN} Gu` : ''}</span>
      ${killers.length ? `<span class="apr-killers" title="${esc('Killer moves: ' + killers.join(', '))}">擂 ${escTipHtml(killers.join(' · '))}</span>` : ''}
    </div>
    ${arenaFormation(members, { conceal: !mine })}
    <div class="apr-stamp"><b>${t.points}</b><span>RATING</span><i>PWR ${compact(t.power)}</i><span class="apr-rec">${arenaRecordHtml(t.wins, t.losses)}</span></div>
    <div class="apr-act">${arenaChallengeBtn(t, mine, noAtt, false, eligible, registered)}</div>
  </div>`;
}

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
