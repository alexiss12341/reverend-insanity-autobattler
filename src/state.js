// Central game state: the single mutable object every system reads/writes,
// plus the new-game factory and localStorage-backed save files (3 slots).
import { NPC_TEMPLATES } from './data/rarities.js';
import { affinityFor, lineFor } from './data/traits.js';
import { RESOURCES } from './data/resources.js';
import { guSlotsOf, IMMORTAL_START } from './data/realms.js';

export const SLOT_KEYS = ['xianxia_save_1', 'xianxia_save_2', 'xianxia_save_3'];

// The live state. Reassigned on load/new game; systems import { state } and read state.current.
export const state = { current: null };
export const S = () => state.current;

let uidCounter = 0;
export const uid = (p = 'x') => `${p}_${Date.now().toString(36)}_${(uidCounter++).toString(36)}`;

export function makeCharacter(name, rarity, isPlayer = false) {
  const t = NPC_TEMPLATES[rarity] || NPC_TEMPLATES.Common;
  return {
    id: uid('c'),
    name,
    rarity,
    isPlayer,
    affinity: affinityFor(name), // canon Dao Path Affinity trait (array of path ids). See data/traits.js
    line: lineFor(name),         // canon archetype LINE trait (id, or null). See data/traits.js LINES
    realm: isPlayer ? 0 : t.startRealm, // realm index (see data/realms.js); player starts at Rank 1 Initial
    xp: 0,
    aptitude: isPlayer ? 2.6 : t.aptitude,
    imprint: 0,        // Soul Imprint (魂印) level 0..10: each duplicate sacrificed grants +5% attrs +0.1 aptitude (see systems/gacha.js imprint())
    base: { hp: t.hp, atk: t.atk, def: t.def, spd: t.spd }, // legacy (unused once attributes ship)
    attrs: { str: 0, agi: 0, con: 0, int: 0, luck: 0 },     // allocated attribute points (Phase 1+)
    bonusSlots: 0,     // extra Gu slots beyond the realm-derived base (e.g. prestige Insight). See guSlotsOf().
    gu: [],            // equipped Gu uids (<= guSlotsOf(char) — base scales with realm rank, data/realms.js)
    killer: { core: null, support: [], archetype: null }, // KILLER MOVE config: core = 1 favored-domain Gu uid; support = ≥2 same-path uids; archetype id (data/combos.js). Inert until configured.
    killerArchUnlocked: {}, // archetypeId -> true: which killer-move archetypes this char has unlocked. First is FREE; each other costs KILLER_ARCH_COST ✦ (main.js setKillerArchetype).
    equip: { weapon: null, armor: null }, // equipped equipment uids
    active: isPlayer,  // on the battle team? (max 6 active)
    row: 'front',      // formation row: 'front' | 'back'
    lane: 0,           // formation lane: 0..4 (column). (row,lane) is the unit's tile on the 2×5 board
    daoMarks: {},      // pathId -> marks (immortal-only; from tribulations; amplifies that path)
    comprehension: {}, // pathId -> accumulated comprehension points (use-driven; mortal & immortal)
    wounds: [],        // Dao Wounds: array of severities (permanent stat penalties; immortal-tier)
    injuryUntil: 0,    // temporary breakthrough injury: timestamp until healed (0 = none; see systems/dao.js)
    trib: { progress: 0, passed: 0 }, // tribulation: aperture-years accrued, apex tribulations passed at current rank
  };
}

// `starter` (set by the new-game pickers, main.js) = { path, guId, line }: the chosen Dao path grants the
// player its matching Dao Path Affinity trait, the chosen rank-1 Gu of that path is granted into the
// inventory UNEQUIPPED (the First-Steps "Equip your starter Gu" step teaches slotting it), and the chosen
// archetype LINE trait is stamped onto the player (it applies at the player's Epic rarity — see traits.js).
export function newGame(slotKey, playerName = 'Fang Yuan', starter = null) {
  const player = makeCharacter(playerName, 'Epic', true);
  const guInv = [];
  if (starter) {
    if (starter.path) player.affinity = [starter.path]; // chosen path = the player's Dao affinity
    if (starter.line) player.line = starter.line;       // chosen archetype line (granted at Epic rarity)
    if (starter.guId) guInv.push({ uid: uid('g'), guId: starter.guId }); // granted, NOT auto-equipped
  }
  return {
    slot: slotKey,
    createdAt: Date.now(),
    lastSave: Date.now(),
    stones: 15000,
    essence: 50,
    // Immortal Essence Stones (仙石): the fuel that powers IMMORTAL-rank Gu (tier 6+). They are LOCKED
    // until the roster includes a Gu Immortal (rank 6+, see immortalUnlocked) — only then do floor clears
    // grant any — and an immortal Gu goes INERT whenever this pool is empty (systems/cultivation.js
    // effectiveStats). Each clear also burns a little to keep the team's immortal Gu channelling.
    immortalStones: 0,
    frontier: 1,             // highest reachable floor (boss of frontier not yet cleared)
    farmFloor: 1,            // floor the idle loop grinds
    clearedFloors: {},       // floor -> true (drives first-clear essence)
    roster: [player],
    guInv,                   // [{ uid, guId }] — seeded with the chosen starter Gu
    uniqueClaimed: {},       // guId -> true (enforces world-uniqueness of tier 6+)
    resources: { bind_relic_r1: 4, bind_stone_r1: 4 }, // a few rank-1 universal binders to start crafting
    equipment: [],           // owned equipment items [{ uid, name, rarity, slot, stats }]
    stats: { battles: 0, wins: 0, pulls: 0, crafts: 0, floorsCleared: 0 },
    gachaPity: 0,            // pulls since last Epic+ (gacha pity)
    // mfRebalanced: born-true so a new game's Might/Fortune (bought at the current 5×-higher price) is
    // never re-priced by migrateSave's one-shot legacy recalibration. See migrateSave.
    prestige: { souls: 0, reincarnations: 0, boons: { might: 0, fortune: 0, insight: 0 }, mfRebalanced: true },
    // First-run onboarding: the floating First-Steps widget + first-visit tab tips. New games start active;
    // existing saves are marked already-onboarded in migrateSave so veterans never see either.
    // `rewarded` is the persistent one-time guard for the tutorial-completion essence bonus.
    onboarding: { active: true, dismissed: false, tipsSeen: {}, rewarded: false },
    // Daily Quests board (systems/quests.js): date = the local calendar day it belongs to; progress maps
    // questId→count; claimed marks collected quests; bonusClaimed = the all-clear bonus taken. Empty `date`
    // makes ensureDaily() initialise it on first access. Resets at local midnight.
    daily: { date: '', progress: {}, claimed: {}, bonusClaimed: false },
    settings: { idle: true, guView: 'grid', invView: 'grid', teamSort: 'power', teamFilter: 'all', teamRarity: 'all', teamPath: 'all', fmSort: 'power', fmRarity: 'all', fmPath: 'all', guTier: 'all', guPath: 'all', guOpen: {}, killerOpen: {}, shopRarity: 'all', shopPath: 'all', shopSearch: '', allocStep: 10, audio: { bgm: 7, sfx: 7, bgmMuted: false, sfxMuted: false } },
  };
}

// ---- Save files (localStorage) ----
export function save() {
  if (!S()) return;
  S().lastSave = Date.now();
  try { localStorage.setItem(S().slot, JSON.stringify(S())); } catch (e) { /* storage full / blocked */ }
}

// Migrate older saves to the current schema. Currently: the `gold` currency was renamed to `stones`
// (Primeval Essence Stones) — carry the old balance over so existing saves keep their wealth.
function migrateSave(o) {
  if (!o) return o;
  if (o.gold != null && o.stones == null) { o.stones = o.gold; delete o.gold; }
  // Immortal Essence Stones (仙石) — a new currency. Pre-existing saves start with none; they unlock
  // organically once the save's roster reaches a Gu Immortal (immortalUnlocked).
  if (o.immortalStones == null) o.immortalStones = 0;
  // Yin-Yang → Qi: rename any held path-resources (resources/Gu/floors now derive from the Qi path).
  if (o.resources) for (const id of Object.keys(o.resources)) {
    if (id.startsWith('res_yinyang_')) {
      const qid = id.replace('res_yinyang_', 'res_qi_');
      o.resources[qid] = (o.resources[qid] || 0) + o.resources[id];
      delete o.resources[id];
    }
  }
  // Resource RANK migration: the old 6-rarity-tier resources were replaced by a rank 1-9 ladder, so
  // retire any held resource id that no longer exists in the world.
  if (o.resources) for (const id of Object.keys(o.resources)) if (!RESOURCES[id]) delete o.resources[id];
  // New Gu library uses `gu_*` ids; retire any pre-rework Gu (old single-effect / yin-yang) from the
  // inventory and clear loadout slots that pointed at them, so no character references a dead Gu.
  if (Array.isArray(o.guInv)) {
    const valid = new Set();
    for (const it of o.guInv) if (it && typeof it.guId === 'string' && it.guId.startsWith('gu_')) valid.add(it.uid);
    o.guInv = o.guInv.filter((it) => valid.has(it.uid));
    for (const c of (o.roster || [])) if (Array.isArray(c.gu)) c.gu = c.gu.filter((u) => valid.has(u));
  }
  // Trait system: Dao Path Affinity is now an ARRAY of path ids (multi-affinity for special heroes).
  // Normalize a legacy single string → [string]; backfill missing affinities from the canon map.
  for (const c of (o.roster || [])) {
    if (!c) continue;
    if (typeof c.affinity === 'string') c.affinity = [c.affinity];
    else if (c.affinity == null) c.affinity = affinityFor(c.name);
    if (c.line == null) c.line = lineFor(c.name); // backfill canon archetype line
    // KILLER MOVE config: new shape { core:uid, support:[uids], archetype }. Reset the old { core:[uids] }
    // shape (feature is brand-new) — keep any chosen archetype, clear core/support so the player reconfigures.
    if (c.killer == null || Array.isArray(c.killer.core) || c.killer.support == null) {
      c.killer = { core: null, support: [], archetype: (c.killer && c.killer.archetype) || null };
    }
    // Killer-archetype unlocks: first archetype is free, others cost essence. Backfill the map and
    // GRANDFATHER any already-configured archetype so existing setups aren't re-charged (counts as
    // the character's free first pick).
    if (c.killerArchUnlocked == null || typeof c.killerArchUnlocked !== 'object') c.killerArchUnlocked = {};
    if (c.killer && c.killer.archetype) c.killerArchUnlocked[c.killer.archetype] = true;
  }
  // Onboarding (First-Steps widget + tab tips) is for genuinely new players only. Any save that predates
  // it already belongs to someone who knows the game — mark it onboarded so nothing pops up for veterans.
  // Procedural audio prefs — independent BGM + SFX levels (0–10) + mutes. Backfill on pre-audio saves,
  // and migrate the first-gen {muted,volume} shape to the split BGM/SFX one.
  if (o.settings) {
    const a = o.settings.audio;
    if (a == null) o.settings.audio = { bgm: 7, sfx: 7, bgmMuted: false, sfxMuted: false };
    else if (a.bgm == null) {
      const v = typeof a.volume === 'number' ? Math.round(a.volume * 10) : 7;
      o.settings.audio = { bgm: v, sfx: v, bgmMuted: !!a.muted, sfxMuted: !!a.muted };
    }
  }
  // Sovereign Insight is now CAPPED at level 5 (and costs 4× more). A legacy save that bought past the
  // cap is rolled back to 5 and refunded the souls it spent on the excess, priced at the OLD rate
  // (base 5: level k cost 5·k). The clamp makes this idempotent on subsequent loads.
  if (o.prestige && o.prestige.boons && (o.prestige.boons.insight || 0) > 5) {
    let refund = 0;
    for (let k = 6; k <= o.prestige.boons.insight; k++) refund += 5 * k;
    o.prestige.souls = (o.prestige.souls || 0) + refund;
    o.prestige.boons.insight = 5;
  }
  // Sovereign Might & Fortune now cost 5× more per level (base 3 → 15) AND are capped at 5 levels. For a
  // legacy save, recompute the souls it actually spent at the OLD price (Σ level k = 3·k), re-derive the
  // highest level (≤ 5) those souls buy at the NEW price (Σ level k = 15·k), and refund the leftover. NOT
  // idempotent (it assumes old-price levels), so it's gated by a one-shot flag — set after running, and
  // born-true in newGame so games created at the new price are never re-priced.
  if (o.prestige && o.prestige.boons && !o.prestige.mfRebalanced) {
    const OLD_BASE = 3, NEW_BASE = 15, MF_CAP = 5;
    const cumNew = (n) => NEW_BASE * n * (n + 1) / 2;            // Σ new cost of levels 1..n
    for (const key of ['might', 'fortune']) {
      const lvl = o.prestige.boons[key] || 0;
      if (lvl <= 0) continue;
      const spent = OLD_BASE * lvl * (lvl + 1) / 2;             // souls actually paid at the old price
      let n = 0; while (n < MF_CAP && cumNew(n + 1) <= spent) n++; // highest level ≤ cap affordable now
      o.prestige.boons[key] = n;
      o.prestige.souls = (o.prestige.souls || 0) + (spent - cumNew(n));
    }
    o.prestige.mfRebalanced = true;
  }
  // Independent, idempotent guard for the Might/Fortune 5-level cap: a save already recalibrated under the
  // earlier (capless) 5×-cost release has mfRebalanced set yet may still sit above 5. Clamp it and refund
  // the over-cap levels at the current price (level k = 15·k). Clamping to 5 makes this a no-op next load.
  if (o.prestige && o.prestige.boons) {
    for (const key of ['might', 'fortune']) {
      const lvl = o.prestige.boons[key] || 0;
      if (lvl <= 5) continue;
      let refund = 0;
      for (let k = 6; k <= lvl; k++) refund += 15 * k;
      o.prestige.souls = (o.prestige.souls || 0) + refund;
      o.prestige.boons[key] = 5;
    }
  }
  // Cap the bonus Gu slots a prior reincarnation already granted (bonusSlots — whose ONLY source is the
  // Insight boon, +1/level) at the same 5, then UNEQUIP any Gu left sitting in the now-removed slots.
  // effectiveStats/battle apply EVERY equipped Gu regardless of the slot cap, so without this trim the
  // over-cap Gu would keep buffing combat while vanishing from the loadout UI (orphaned). Dropped Gu are
  // not destroyed — they stay in guInv and return to the pickable pool. Kept SEPARATE from the refund
  // block so saves already migrated once (boon clamped, but loadout stale) still get corrected on load.
  for (const c of (o.roster || [])) {
    if (!c) continue;
    if ((c.bonusSlots || 0) > 5) c.bonusSlots = 5;
    if (Array.isArray(c.gu) && c.gu.length > guSlotsOf(c)) c.gu = c.gu.slice(0, guSlotsOf(c));
  }
  // Daily Quests board — backfill on pre-quest saves (starts fresh on next access via ensureDaily).
  if (o.daily == null || typeof o.daily !== 'object') o.daily = { date: '', progress: {}, claimed: {}, bonusClaimed: false };
  if (o.onboarding == null) o.onboarding = { active: false, dismissed: true, tipsSeen: {}, rewarded: true };
  // Backfill the tutorial-completion bonus guard on pre-reward saves: veterans (onboarding already
  // inactive) are past the tutorial → mark rewarded so re-arming the guide can't pay out; a genuine
  // in-progress newcomer (still active) keeps rewarded:false so they earn it on completion.
  else if (o.onboarding.rewarded == null) o.onboarding.rewarded = !o.onboarding.active;
  return o;
}

export function load(slotKey) {
  try {
    const raw = localStorage.getItem(slotKey);
    return raw ? migrateSave(JSON.parse(raw)) : null;
  } catch { return null; }
}

export function deleteSave(slotKey) {
  try { localStorage.removeItem(slotKey); } catch {}
}

export function listSaves() {
  return SLOT_KEYS.map((k) => load(k));
}

export const activeTeam = () => S().roster.filter((c) => c.active);
// Immortal Essence Stones (仙石) are GATED to immortal cultivation: the currency only becomes
// accessible — the top-bar readout appears, floor clears start granting it, and immortal Gu can draw on
// it — once ANY roster cultivator has reached immortal Rank 6 (realm ≥ IMMORTAL_START).
export const immortalUnlocked = () => !!S() && S().roster.some((c) => c.realm >= IMMORTAL_START);
// Formation row/lane, tolerant of legacy saves without the fields.
export const rowOf = (ch) => (ch && ch.row === 'back' ? 'back' : 'front');
export const laneOf = (ch) => Math.max(0, Math.min(LANES - 1, (ch && ch.lane | 0) || 0));
export const frontTeam = () => activeTeam().filter((c) => rowOf(c) === 'front');
export const backTeam = () => activeTeam().filter((c) => rowOf(c) === 'back');

// ---- formation board: 2 rows (front/back) × 5 lanes (columns) ----
export const LANES = 5;
export const ROW_CAP = 5; // max active units per row
export const tileOccupant = (row, lane) => activeTeam().find((c) => rowOf(c) === row && laneOf(c) === lane);
export const rowCount = (row) => activeTeam().filter((c) => rowOf(c) === row).length;
// First free tile, preferring a row; returns { row, lane } or null if the board is full.
export function firstFreeTile(prefer) {
  const rows = prefer === 'back' ? ['back', 'front'] : ['front', 'back'];
  for (const row of rows) for (let lane = 0; lane < LANES; lane++) if (!tileOccupant(row, lane)) return { row, lane };
  return null;
}
// Ensure every active member sits on a unique tile (repairs legacy saves / collisions).
export function normalizeFormation() {
  const seen = {};
  for (const c of activeTeam()) {
    const key = `${rowOf(c)}:${laneOf(c)}`;
    if (!seen[key]) { c.row = rowOf(c); c.lane = laneOf(c); seen[key] = 1; continue; }
    const free = firstFreeTile(rowOf(c)) || firstFreeTile();
    if (free) { c.row = free.row; c.lane = free.lane; seen[`${free.row}:${free.lane}`] = 1; }
  }
}
