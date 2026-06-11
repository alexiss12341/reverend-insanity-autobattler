// Auto-battle engine.
//  - MOVEMENT GAUGE (ATB): each combatant fills a gauge at a rate equal to its SPD.
//    When the gauge reaches THRESHOLD the unit acts. Actions ALWAYS cost the full gauge:
//    on acting the gauge resets to 0 with no overflow carried, and every action costs the
//    same. SPD therefore governs how OFTEN a unit acts, not merely who moves first.
//  - BACK-ROW SAFETY: attacks must hit the front row; a back-row unit cannot be targeted until
//    every front-row ally is dead, at which point the back row is exposed. Ally rows come from each
//    character's explicit `row` field (set in the Team formation editor) and support any split —
//    e.g. 1 front / 5 back. Enemies use positional rows (first 3 of a wave = front).
//  - Player team (max 6) persists across waves; each wave's enemy team (max 6) replaces the
//    previous once wiped. The encounter is won when all waves are cleared.
//  - Models crit, dodge, lifesteal, thorns, burn (applied on the burner's turn), regen
//    (applied on the unit's own turn), and extra_turn (chance to act again immediately).
import { S, activeTeam, rowOf, laneOf } from '../state.js';
import { effectiveStats, guOf } from './cultivation.js';
import { STATUS } from '../data/status.js';
import { lineAura, affinityPaths, allyAuraSummary, enemyWaveAura } from '../data/traits.js';
import { rarityTier } from '../data/rarities.js';
import { resolveOwned, effectText, guEssenceCostFor } from '../data/gu.js';
import { rankOf } from '../data/realms.js';
import { validateKiller, assemble, KILLER_COST_MULT, KILLER_COOLDOWN, KILLER_UNLOCK_FLOOR, KILLER_MIN_RANK } from '../data/combos.js';

// An ally's equipped Gu as { name, eff } for the arena traits panel (resolves each uid via guInv).
const guInfoFor = (ch) => ((ch && ch.gu) || []).map((uid) => {
  const owned = S().guInv.find((o) => o.uid === uid);
  const g = owned && resolveOwned(owned);
  return g ? { name: g.name, eff: effectText(g) } : null;
}).filter(Boolean);

const THRESHOLD = 1000; // movement gauge cap
// Essence (aperture) economy — GATES combat, per-Gu and ALL-OR-NOTHING. Each combatant carries a
// `tiers` ladder: tiers[k] is the full stat/effect profile (atk/def/spd/maxHp/aperture/fx) for CHANNELLING
// the first k Gu of its loadout (k=0 = bare-handed, k=N = the whole kit), with a cumulative essence
// `cost`. Loadout SLOT ORDER is the priority — Gu fire down the list and stop at the first one essence
// can't afford (a clean prefix, so as essence regenerates Gu only ever switch back ON, never flicker).
// Each action `applyChannel` picks the largest affordable prefix from current essence, SWAPS the unit to
// that tier's profile, and spends that tier's cost. An un-channelled Gu contributes NOTHING — its atk,
// def, crit, status riders, HP and aperture all vanish — and costs no essence. Lowering Max HP / aperture
// keeps current HP/essence and only CLAMPS the overflow down to the new (lower) cap. The k=0 tier is the
// unaided attribute swing, so a fully-starved unit still fights bare-handed (never weaker than no Gu).
// Essence regenerates at essRegen × this scale per unit of gauge-time, refilling toward the active tier's
// aperture — so APERTURE CAPACITY (aptitude) still bounds how deep into the loadout a unit can sustain.
const ESS_REGEN_SCALE = 0.16;
const FRONT = 3;        // fallback enemy front-row size if a unit lacks an explicit row
const BASE_HIT = 0.85;  // every attack starts from an 85% chance to land before Hit/Evasion adjust it
const ARMOR_PEN_MULT = 0.5;    // armour pen is UNCAPPED now → its EFFECTIVE DEF-ignore is halved (need 200% stat to fully ignore DEF)
// Every contested roll-chance (Hit, Crit) is clamped to [1%, 99%] — a max build floors the opposing
// chance at 1% (near-immunity, never literal 0/100); Lucky Hit is the one roll left unclamped.
const clampP = (p) => Math.max(0.01, Math.min(0.99, p));

// Defaults for any fx field a unit's effect bundle doesn't supply, so every combatant reads the full set.
const EMPTY_FX = { lifesteal: 0, crit: 0, dodge: 0, thorns: 0, burn: 0, regen: 0, extra_turn: 0,
  hitChance: 0, critDamage: 1.5, critResist: 0, armorPen: 0, luckyHit: 0, potency: 0, statusResist: 0,
  essDrain: 0, dotSpread: 0, inflicts: [] };

// One rung of the CHANNEL LADDER from a stat bundle `s` (an effectiveStats result, or an enemy bundle):
// the combat profile + cumulative essence `cost` for that Gu prefix. `fx` is the whole bundle (effects
// read straight off it). Enemy bundles get EMPTY_FX-filled here; ally bundles already carry every field.
const tierOf = (s, fillFx) => ({ cost: s.essenceCost || 0, atk: s.atk, def: s.def, spd: Math.max(1, s.spd),
  max: s.maxHp, essMax: s.essencePool || 60, essRegen: s.essenceRegen || 3,
  fx: fillFx ? { ...EMPTY_FX, ...(s.fx || s) } : (s.fx || s) });

// Build an ally's per-Gu channel ladder: tiers[k] = the effectiveStats profile when only the first k
// equipped Gu are channelled (slot order = priority). k=0 is the bare-handed attribute swing; k=N the
// full kit. effectiveStats recomputes HP/aperture/resonance/every effect for each subset, so a dropped
// Gu vanishes wholesale (incl. its HP & aperture contribution).
function allyTiers(ch) {
  const equipped = (ch.gu || []).filter(Boolean); // ordered priority list (skip empty slots)
  const tiers = [];
  for (let k = 0; k <= equipped.length; k++) tiers.push(tierOf(effectiveStats(ch, new Set(equipped.slice(0, k))), false));
  return tiers;
}
// Initialise a combatant's live combat fields from its FULL (top) tier — units start the fight at full
// power with brimming HP and aperture, then settle as applyChannel gates them per action.
function initFromFull(u) {
  const t = u.tiers[u.tiers.length - 1];
  u.atk = t.atk; u.def = t.def; u.spd = Math.max(1, t.spd); u.fx = t.fx;
  u.max = t.max; u.hp = t.max; u.essMax = t.essMax; u.essRegen = t.essRegen; u.ess = t.essMax;
  u.activeGu = u.tiers.length - 1;
  u.shield = 0;        // KILLER MOVE: temporary absorb pool (drained before HP by damageUnit); starts empty
  u.killerCd = 0;      // KILLER MOVE: actions-until-next-cast cooldown (0 = ready)
  return u;
}
// KILLER MOVE: set a unit to its FULL (top) tier profile WITHOUT spending essence — used when a killer
// move fires (comboCost was already paid), so the move always lands at full power. Mirrors applyChannel's
// field set + overflow clamps, minus the essence cost.
function applyTopTier(u) {
  const t = u.tiers[u.tiers.length - 1]; if (!t) return;
  u.atk = t.atk; u.def = t.def; u.spd = Math.max(1, t.spd); u.fx = t.fx;
  u.max = t.max; u.essMax = t.essMax; u.essRegen = t.essRegen;
  if (u.hp > u.max) u.hp = u.max;
  if (u.ess > u.essMax) u.ess = u.essMax;
  u.activeGu = u.tiers.length - 1;
}
// KILLER MOVE: resolve a character's saved killer config into a combat spec + essence cost on the
// combatant. No-op (leaves u.killer undefined) when there's no valid core/archetype. `comboCost` =
// KILLER_COST_MULT × Σ the CORE Gu's rank-adjusted channel cost (the same guEssenceCostFor the engine
// already uses), so the cost self-scales with core size/tier and the wielder's rank.
function attachKiller(u, ch) {
  // PROGRESSION GATE: allies wield killer moves only on rank 3+ AND after the player has cleared Floor
  // 100 (combos.js KILLER_MIN_RANK / KILLER_UNLOCK_FLOOR). Gated units leave u.killer undefined, so a
  // move saved before unlocking simply never fires.
  if (rankOf(ch.realm) + 1 < KILLER_MIN_RANK) return;
  if (!S().clearedFloors[KILLER_UNLOCK_FLOOR]) return;
  const raw = ch && ch.killer;
  if (!raw || !raw.archetype || !raw.core || !Array.isArray(raw.support)) return;
  // Count only support Gu STILL EQUIPPED — mirrors the UI (ui.js csKiller/killerSummary), so a move the
  // player sees as valid actually fires even if an unrelated Gu was swapped out after it was configured.
  // (Without this, one stale support uid makes validateKiller reject the whole move so it never fires.)
  const cfg = { archetype: raw.archetype, core: raw.core, support: raw.support.filter((uid) => (ch.gu || []).includes(uid)) };
  if (cfg.support.length < 2) return;
  if (!validateKiller(cfg, ch.gu, guOf)) return;
  const coreGu = guOf(cfg.core);
  const supportGu = cfg.support.map(guOf).filter(Boolean);
  const spec = assemble(cfg.archetype, coreGu, supportGu);
  if (!spec) return;
  const rank = rankOf(ch.realm) + 1;
  const sum = [coreGu, ...supportGu].reduce((s, g) => s + guEssenceCostFor(g, rank), 0);
  u.killer = spec;
  u.comboCost = Math.round(KILLER_COST_MULT * sum);
}
function allyCombatant(ch, pos) {
  // `ch` + `actions` let the caller bank per-action Comprehension after the encounter.
  // `side`/`idx` give the UI a stable handle; `row`/`lane` place the unit on the 2×5 board.
  const u = initFromFull({ ch, name: ch.name, ally: true, side: 'ally', idx: pos, row: rowOf(ch), lane: laneOf(ch),
    gauge: 0, actions: 0, tiers: allyTiers(ch) });
  attachKiller(u, ch); // KILLER MOVE: resolve the saved config into u.killer + u.comboCost (if valid)
  return u;
}
function enemyCombatant(u, pos) {
  // enemyUnit now bakes a per-Gu channel ladder (`u.tiers`); fall back to a single full-loadout rung for
  // any unit that lacks one. Each rung's fx is EMPTY_FX-filled so foes resolve through the same pipeline.
  const tiers = (u.tiers && u.tiers.length ? u.tiers : [tierOf({ essenceCost: u.essenceCost, atk: u.atk, def: u.def,
    spd: u.spd, maxHp: u.maxHp, essencePool: u.essencePool, essenceRegen: u.essenceRegen, fx: u.effects }, false)])
    .map((t) => ({ ...t, fx: { ...EMPTY_FX, ...(t.fx || {}) } }));
  return initFromFull({
    name: u.name, ally: false, side: 'foe', idx: pos, isBoss: u.isBoss,
    row: u.row || (pos < FRONT ? 'front' : 'back'), lane: u.lane != null ? u.lane : pos % FRONT,
    gauge: 0, tiers,
    killer: u.killer, comboCost: u.comboCost, // KILLER MOVE: enemy spec + cost precomputed in floors.js (autoConfigure)
  });
}
// Pick the largest affordable Gu prefix from CURRENT essence, swap the unit onto that tier's profile,
// clamp any HP/essence overflow down to the new (possibly lower) caps, then spend that tier's cost.
// All-or-nothing per Gu; a fully-starved unit lands on tier 0 (bare-handed) and spends nothing.
function applyChannel(u) {
  const tiers = u.tiers; if (!tiers) return;
  let k = 0;
  for (let i = tiers.length - 1; i > 0; i--) { if (u.ess + 1e-9 >= tiers[i].cost) { k = i; break; } }
  const t = tiers[k];
  u.atk = t.atk; u.def = t.def; u.spd = Math.max(1, t.spd); u.fx = t.fx;
  u.max = t.max; u.essMax = t.essMax; u.essRegen = t.essRegen;
  if (u.hp > u.max) u.hp = u.max;        // a dropped HP-Gu lowered Max HP → keep current HP, clamp overflow
  if (u.ess > u.essMax) u.ess = u.essMax; // a dropped aperture-Gu lowered the pool → clamp overflow
  u.ess = Math.max(0, u.ess - t.cost);   // pay only the active prefix's channel cost
  u.activeGu = k;
}
// Overall combat power, used only as an aura tiebreaker (atk+def+hp, off pre-aura effectiveStats).
const auraPower = (u) => (u.atk || 0) + (u.def || 0) + (u.max || 0);
// Compare two support units for whose aura wins: rarity tier → realm → power. (>0 = `u` beats `b`.)
function auraBeats(u, b) {
  const dt = rarityTier(u.ch.rarity) - rarityTier(b.ch.rarity); if (dt) return dt;
  const dr = (u.ch.realm || 0) - (b.ch.realm || 0); if (dr) return dr;
  return auraPower(u) - auraPower(b);
}

// Support-line TEAM AURAS. Auras DON'T STACK: only ONE aura of each TYPE (line) is active — the
// strongest support unit of that line wins, chosen by rarity tier → realm → power → random. The winning
// Commander buffs team ATK/SPD; the winning Warden hardens team DEF + adds thorns and flags TAUNT (both
// flat pre-battle buffs that persist even if the source falls); the winning Mender's `regenPct` is
// stored as `u.teamHealPct` (a TEAM HEAL fired on the Mender's OWN action via teamHeal, NOT passive
// regen). Exported so headless tests can drive it directly.
export function applyTeamAuras(allies) {
  // group support units by line, then pick the single winner per line
  const byLine = {};
  for (const u of allies) { if (lineAura(u.ch)) (byLine[u.ch.line] = byLine[u.ch.line] || []).push(u); }
  const winners = [];
  for (const id in byLine) {
    let best = byLine[id][0];
    for (let i = 1; i < byLine[id].length; i++) {
      const c = auraBeats(byLine[id][i], best);
      if (c > 0 || (c === 0 && Math.random() < 0.5)) best = byLine[id][i]; // strictly better, or coin-flip a tie
    }
    winners.push(best);
  }
  // combine the winning auras (different types still apply together)
  let atk = 0, def = 0, spd = 0, thorns = 0;
  for (const u of winners) {
    const a = lineAura(u.ch);
    atk += a.atkMul || 0; def += a.defMul || 0; spd += a.spdMul || 0; thorns += a.thorns || 0;
    if (a.taunt) u.taunt = true;
    if (a.regenPct) { // Mender: heals + may cleanse the team on ITS action (params scale with rarity)
      u.teamHealPct = a.regenPct;
      u.cleanseChance = cleanseChanceFor(u.ch.rarity);
      u.cleanseMax = cleanseMaxFor(u.ch.rarity);
    }
  }
  // Auras are flat pre-battle buffs baked into EVERY tier of each ally's channel ladder (so they survive
  // applyChannel's per-action profile swap), then the live fields are re-synced from the full tier. A
  // synthetic combatant without a ladder (unit tests) is buffed on its live fields directly.
  for (const u of allies) {
    if (u.tiers) {
      if (atk || def || spd || thorns) for (const t of u.tiers) {
        if (atk) t.atk = Math.round(t.atk * (1 + atk));
        if (def) t.def = Math.round(t.def * (1 + def));
        if (spd) t.spd = Math.max(1, Math.round(t.spd * (1 + spd)));
        if (thorns) t.fx = { ...t.fx, thorns: (t.fx.thorns || 0) + thorns };
      }
      initFromFull(u);
    } else {
      if (atk) u.atk = Math.round(u.atk * (1 + atk));
      if (def) u.def = Math.round(u.def * (1 + def));
      if (spd) u.spd = Math.max(1, Math.round(u.spd * (1 + spd)));
      if (thorns) u.fx = { ...u.fx, thorns: (u.fx.thorns || 0) + thorns };
    }
  }
  return allies;
}

// Mender TEAM HEAL: on the actor's OWN action, restore each living ally by % of their own max HP.
// Mutates ally.hp and records changed units in `touched` (so the timeline updates the HP bar); pushes
// each {unit,amt} restored into `heals` (so the timeline can float a green heal number). No-op for
// non-Menders. Exported for tests.
export function teamHeal(actor, allies, touched, heals) {
  if (!actor.teamHealPct) return;
  for (const a of allies) {
    if (a.hp <= 0) continue;
    const h = Math.min(a.max, a.hp + Math.round((a.max || 0) * actor.teamHealPct));
    if (h !== a.hp) { if (heals) heals.push({ unit: a, amt: h - a.hp }); a.hp = h; if (touched) touched.add(a); }
  }
}

// Mender CLEANSE params by rarity: chance scales with rarity (capped 25% at Immortal); max debuffs per
// proc = 1 + tiers above Rare (Common/Uncommon/Rare→1, Epic→2, Legendary→3, Immortal→4).
const CLEANSE_CHANCE = [0.05, 0.08, 0.12, 0.16, 0.20, 0.25]; // index by rarityTier 1..6
export const cleanseChanceFor = (rarity) => CLEANSE_CHANCE[rarityTier(rarity) - 1] || 0.05;
export const cleanseMaxFor = (rarity) => 1 + Math.max(0, rarityTier(rarity) - 3);

// Mender CLEANSE: on the Mender's action, roll its chance to strip up to `cleanseMax` debuffs from living
// allies (every battle status here is a debuff). One roll; removes whole status types in order. Each ally
// that loses ≥1 debuff is pushed into `cleansed` (so the timeline can float a "cleansed" tag). Exported.
export function cleanseTeam(actor, allies, cleansed) {
  if (!actor.cleanseChance || Math.random() >= actor.cleanseChance) return 0;
  let removed = 0;
  for (const a of allies) {
    if (removed >= actor.cleanseMax) break;
    if (a.hp <= 0 || !a.statuses) continue;
    let any = false;
    for (const k of Object.keys(a.statuses)) {
      if (removed >= actor.cleanseMax) break;
      if (!STATUS[k]) continue; // skip buff_*/taunt_t — cleanse only strips real debuffs
      delete a.statuses[k]; removed++; any = true;
    }
    if (any && cleansed) cleansed.push(a);
  }
  return removed;
}

export const GAUGE_MAX = THRESHOLD;
// Wall-clock ms per unit of gauge-time — shared by animated playback (ui.js) and idle-farm pacing
// (main.js), so a background farm run takes as long as the team actually needs to clear the floor.
export const PLAYBACK_MS = 30;
export const fightWallMs = (simTime) => Math.max(700, Math.min(45000, Math.round((simTime || 0) * PLAYBACK_MS)));
const alive = (arr) => arr.filter((u) => u.hp > 0);
const sideAlive = (arr) => arr.some((u) => u.hp > 0);

// Valid targets under PER-LANE protection: a front unit is always targetable; a back unit is
// targetable only when its lane has no living front unit (its protector is dead or that tile empty).
function targetList(side) {
  const living = side.filter((u) => u.hp > 0);
  const frontLane = {};
  for (const u of living) if (u.row === 'front') frontLane[u.lane] = true;
  return living.filter((u) => u.row === 'front' || !frontLane[u.lane]);
}

const randOf = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Choose whom `actor` attacks among `foeSide`.
//  - COLUMN REACH: a unit can only strike foes within ±1 of its own lane; it reaches farther only
//    when that ±1 window holds no valid target (those lanes empty/dead). Applies to everyone.
//  - ALLIES then target at random among the reachable valid foes. ENEMIES use a targeting brain
//    (roll 1-100): 60% dig toward the highest-ATK reachable foe's lane (chew through the frontliner
//    shielding a backline threat; recomputed every attack), 30% secure a kill (lowest HP), 10%
//    threat-and-wound-weighted random.
function chooseTarget(actor, foeSide) {
  const all = targetList(foeSide);
  if (!all.length) return null;
  const near = all.filter((u) => Math.abs((u.lane | 0) - (actor.lane | 0)) <= 1);
  const valid = near.length ? near : all; // expand beyond ±1 only when nothing valid is in range
  if (actor.ally) return randOf(valid);
  // TAUNT: enemies prefer a taunting ally when one is reachable/valid (respects lane protection) —
  // the permanent Warden flag or a timed Sentinel killer-move taunt.
  const taunters = valid.filter(taunting);
  if (taunters.length) return randOf(taunters);
  const reach = new Set(valid.map((u) => u.lane));
  const roll = 1 + Math.floor(Math.random() * 100);
  if (roll <= 60) {
    const living = foeSide.filter((u) => u.hp > 0 && reach.has(u.lane));
    const threat = living.reduce((b, u) => (u.atk > b.atk ? u : b), living[0] || valid[0]);
    const inLane = valid.filter((u) => u.lane === threat.lane);
    return inLane.length ? randOf(inLane) : valid.reduce((b, u) => (u.atk > b.atk ? u : b), valid[0]);
  }
  if (roll <= 90) return valid.reduce((b, u) => (u.hp < b.hp ? u : b), valid[0]); // secure a kill
  const weights = valid.map((u) => u.atk * (1 + (1 - u.hp / u.max)));            // weighted random
  let r = Math.random() * weights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < valid.length; i++) if ((r -= weights[i]) <= 0) return valid[i];
  return valid[valid.length - 1];
}

// ---- statuses (Phase 3) ----
// Active debuffs are read live: Slow lowers effective SPD, Weaken lowers ATK, Sunder lowers DEF, and
// Frail raises damage taken. Burn/Poison/Bleed are DoTs ticked on the victim's own turn.
const DOT_TYPES = Object.keys(STATUS).filter((t) => STATUS[t].dot); // burn/poison/bleed — stored as instance arrays
const STAT_BUFF = { buff_atk: 'atk', buff_def: 'def', buff_spd: 'spd', buff_thorns: 'thorns', buff_evasion: 'evasion' }; // killer-move positive buffs → display stat
const debuffCount = (u) => (u.statuses ? Object.keys(u.statuses).filter((k) => STATUS[k]).length : 0); // real debuffs only (powers Anathema)
const stMag = (u, type) => (u.statuses && u.statuses[type] ? u.statuses[type].mag || 0 : 0);
// KILLER MOVE: timed POSITIVE buffs are stored as `buff_<stat>` entries in u.statuses (the positive
// mirror of slow/weaken/sunder debuffs), aged by the same tickStatuses loop. buffMag reads the magnitude.
const buffMag = (u, stat) => (u.statuses && u.statuses['buff_' + stat] ? u.statuses['buff_' + stat].mag || 0 : 0);
function applyBuff(u, stat, amount, dur) {
  u.statuses = u.statuses || {};
  const k = 'buff_' + stat, cur = u.statuses[k];
  u.statuses[k] = { turns: Math.max(cur ? cur.turns : 0, dur || 1), mag: Math.max(cur ? cur.mag : 0, amount || 0) };
}
// A unit draws aggro if it carries the permanent Warden taunt flag OR a timed Sentinel taunt (taunt_t).
const taunting = (u) => !!(u.taunt || (u.statuses && u.statuses.taunt_t));
const effSpd = (u) => Math.max(1, u.spd * (1 - stMag(u, 'slow')) * (1 + buffMag(u, 'spd')));
// u.atk already reflects the active Gu prefix (applyChannel set it for this action) — Weaken just scales
// it down, a SPD/ATK buff scales it up. A starved unit's atk is its bare-handed tier, so equipping Gu can
// never make it hit softer.
const effAtk = (u) => u.atk * (1 - stMag(u, 'weaken')) * (1 + buffMag(u, 'atk'));
const effDef = (u) => u.def * (1 - stMag(u, 'sunder')) * (1 + buffMag(u, 'def'));
const thornsOf = (u) => (u.fx.thorns || 0) + buffMag(u, 'thorns'); // reflect % incl. any Bulwark thorns buff
const frailMult = (u) => 1 + stMag(u, 'frail');
// KILLER MOVE: route ALL incoming damage through a unit's shield (temp HP) before its real HP. The
// shield is a plain pool — no duration; it stacks additively and is gone when depleted. Status riders
// are applied separately (inflictStatuses), so a fully-absorbed hit still lands its afflictions.
export function damageUnit(u, amt) {
  if (!(amt > 0)) return 0;
  let rem = amt;
  if (u.shield > 0) { const a = Math.min(u.shield, rem); u.shield -= a; rem -= a; }
  u.hp -= rem;
  return amt;
}

// Fire shatters any fire-dispellable status (Frozen). Returns the labels removed, for logging.
function dispelByFire(tgt) {
  if (!tgt.statuses) return [];
  const gone = [];
  for (const k of Object.keys(tgt.statuses)) {
    if (STATUS[k] && STATUS[k].dispelledByFire) { delete tgt.statuses[k]; gone.push(STATUS[k].label); }
  }
  return gone;
}
const isFirePath = (u) => (u.fx.inflicts || []).some((i) => i.type === 'burn'); // fire-path Gu inflict Burn

// Apply/refresh a status on `tgt`, inflicted by `caster`. Magnitudes lock at apply-time.
function applyStatus(tgt, type, caster, dur, mag) {
  const def = STATUS[type]; if (!def) return;
  tgt.statuses = tgt.statuses || {};
  if (type === 'burn') dispelByFire(tgt); // a Burn status melts Frozen
  const turns = dur || def.dur; // debuffs carry a per-Gu duration; DoTs/stun use their fixed dur
  if (def.dot) { // DoT (Burn/Poison/Bleed): push an INDEPENDENT instance — own timer + own locked
    // per-tick damage, no stack cap. Instances accumulate and each expires on its own. The base
    // magnitude (base burn/poison/bleed) is the inflicting Gu's tier-scaled value (mag), ATK/HP-scaled.
    const frac = (mag != null ? mag : def.mag);
    const per = def.dot === 'targetMaxHp'
      ? Math.max(1, Math.round(frac * tgt.max))     // off victim max HP (Bleed)
      : Math.max(1, Math.round(frac * caster.atk)); // off caster ATK (Burn/Poison)
    (tgt.statuses[type] = tgt.statuses[type] || []).push({ turns, per });
  } else { // % debuff (slow/weaken/sunder/frail) or stun/frozen — fixed magnitude
    tgt.statuses[type] = { turns, mag: def.mag || 0 };
  }
}

// On a landed hit, roll the attacker's status riders vs the target's Status Resistance.
// Returns the list of status types that landed (for the UI timeline).
function inflictStatuses(u, tgt, log, touched) {
  const applied = [];
  for (const inf of (u.fx.inflicts || [])) {
    if (tgt.hp <= 0) break;
    if (Math.random() < clampP(inf.base + (u.fx.potency || 0) - (tgt.fx.statusResist || 0))) {
      applyStatus(tgt, inf.type, u, inf.dur, inf.mag); touched.add(tgt); applied.push(inf.type);
      log(`${tgt.name} is afflicted with ${STATUS[inf.type].label}.`);
    }
  }
  return applied;
}

// Start of a unit's activation: tick DoTs, decrement every status one action, report whether the unit
// is incapacitated this action (Stun or Frozen) and which (so the UI can label the skip).
function tickStatuses(u, log, touched) {
  const st = u.statuses; if (!st) return { dot: 0, dots: null, stunned: false, frozen: false };
  // DoT damage = sum of EVERY live instance of each DoT type (each tracked & expiring independently).
  // `dots` keeps the per-type breakdown so the UI can float distinct Burn/Poison/Bleed numbers.
  let dot = 0; let dots = null;
  for (const type of DOT_TYPES) {
    const arr = st[type]; if (!arr) continue;
    let d = 0; for (const inst of arr) d += inst.per;
    if (d > 0) { (dots = dots || {})[type] = d; dot += d; }
  }
  if (dot > 0) { damageUnit(u, dot); touched.add(u); log(`${u.name} suffers ${dot} from afflictions.`); } // DoTs drain the shield first
  let stunned = false;
  for (const k of Object.keys(st)) if (STATUS[k] && STATUS[k].stun) stunned = true; // Stun or Frozen skip the action
  const frozen = !!st.frozen;
  // age every status one action: DoT instances expire independently; single statuses tick their timer.
  for (const k of Object.keys(st)) {
    if (Array.isArray(st[k])) { st[k] = st[k].filter((inst) => (inst.turns -= 1) > 0); if (!st[k].length) delete st[k]; }
    else { st[k].turns -= 1; if (st[k].turns <= 0) delete st[k]; }
  }
  return { dot, dots, stunned, frozen };
}

// Performs one ATTACK and returns a description of it (for timeline playback). Status ticking/stun is
// handled once per activation by the caller; `seed` carries any HP changes (DoT) already applied so
// they ride along in this event's `touched`. `touched` lists every unit whose HP changed.
// ONE strike's damage resolution, shared by basic attacks AND killer-move `damage` ops. `mult` scales
// the base swing (1 for a basic attack); `opts.exec` adds bonus damage vs the target's missing HP;
// `opts.armorPenBonus` adds armour pen; `opts.inflict` (default true) rolls the wielder's status riders
// — killer `damage` ops pass false because the move's own `status` op handles afflictions. `foes` is the
// target's side (for Afflictor DoT-spread on a kill). Returns the hit record; HP changes go via damageUnit
// (so a target's shield soaks it). Does NOT do the legacy burn aura — that stays per-action in takeAction.
function dealHit(u, tgt, mult, opts, log, touched, foes) {
  opts = opts || {};
  if (!tgt || tgt.hp <= 0) return { tgt, dmg: 0, crit: false, lucky: false, dodged: false, applied: [] };
  let dmg = 0, crit = false, dodged = false, lucky = false, applied = [];
  // (1) HIT — 85% base + attacker Hit-bonus − target Evasion, clamped to [1%,99%].
  const hitP = clampP(BASE_HIT + (u.fx.hitChance || 0) - ((tgt.fx.dodge || 0) + buffMag(tgt, 'evasion')));
  if (Math.random() > hitP) { dodged = true; log(`${tgt.name} evades ${u.name}.`); return { tgt, dmg, crit, lucky, dodged, applied }; }
  // base damage; Armor Penetration (+ any op bonus) ignores a % of the target's (Sunder-reduced) mitigated DEF.
  const armorPen = ((u.fx.armorPen || 0) + (opts.armorPenBonus || 0)) * ARMOR_PEN_MULT; // UNCAPPED stat, halved effect
  const def = effDef(tgt) * 0.6 * Math.max(0, 1 - armorPen);                              // ≥200% stat → DEF fully ignored
  dmg = Math.max(1, Math.round(effAtk(u) * (mult || 1) - def));
  if (opts.exec) dmg = Math.round(dmg * (1 + opts.exec * Math.max(0, 1 - tgt.hp / tgt.max))); // Execution: bonus vs missing HP
  if (opts.perStatus) dmg = Math.round(dmg * (1 + opts.perStatus * debuffCount(tgt)));        // Anathema: bonus per debuff on the target
  // (2) LUCKY HIT — forced crit that IGNORES Crit Resistance and hits for ×1.5×CritDamage (unclamped).
  if (Math.random() < (u.fx.luckyHit || 0)) { lucky = crit = true; dmg = Math.round(dmg * 1.5 * (u.fx.critDamage || 1.5)); }
  else if ((u.fx.crit || 0) > 0) { // (3) CRIT — CritChance − target Crit Resistance, clamped → ×CritDamage.
    if (Math.random() < clampP((u.fx.crit || 0) - (tgt.fx.critResist || 0))) { crit = true; dmg = Math.round(dmg * (u.fx.critDamage || 1.5)); }
  }
  if (stMag(tgt, 'frail')) dmg = Math.max(1, Math.round(dmg * frailMult(tgt))); // Frail amplifies hits
  damageUnit(tgt, dmg); touched.add(tgt); // shield soaks first, then HP
  if (isFirePath(u) && dispelByFire(tgt).length) log(`${tgt.name}'s ice shatters in the flames.`);
  if (u.fx.lifesteal > 0) { u.hp = Math.min(u.max, u.hp + Math.round(dmg * u.fx.lifesteal)); touched.add(u); }
  if ((u.fx.essDrain || 0) > 0 && (tgt.essMax || 0) > 0) { // Reaver: steal a slice of the target's essence on hit
    const d = Math.round(tgt.essMax * u.fx.essDrain);
    if (d > 0) { tgt.ess = Math.max(0, (tgt.ess || 0) - d); u.ess = Math.min(u.essMax || u.ess || 0, (u.ess || 0) + d); }
  }
  const thorns = thornsOf(tgt);
  if (thorns > 0 && tgt.hp > 0) { // reflect, mitigated by the ATTACKER's DEF; plain damage (no thorns-loop)
    const rdef = effDef(u) * 0.6 * Math.max(0, 1 - (tgt.fx.armorPen || 0) * ARMOR_PEN_MULT);
    damageUnit(u, Math.max(1, Math.round(dmg * thorns - rdef))); touched.add(u);
  }
  if (opts.inflict !== false) applied = inflictStatuses(u, tgt, log, touched); // Potency vs Status Resistance per rider
  log(`${u.name} hits ${tgt.name} for ${dmg}${lucky ? ' (lucky crit!)' : crit ? ' (crit!)' : ''}.`);
  if (tgt.hp <= 0) log(`${tgt.name} is slain.`);
  if (tgt.hp <= 0 && (u.fx.dotSpread || 0) > 0 && tgt.statuses && foes && Math.random() < u.fx.dotSpread) {
    let spread = false; // Afflictor: the dying victim's DoTs leap to its surviving allies
    for (const type of DOT_TYPES) {
      const arr = tgt.statuses[type]; if (!arr || !arr.length) continue;
      for (const f of alive(foes)) { if (f === tgt) continue;
        (f.statuses = f.statuses || {})[type] = (f.statuses[type] || []).concat(arr.map((i) => ({ turns: i.turns, per: i.per })));
        touched.add(f); spread = true;
      }
    }
    if (spread) log(`${tgt.name}'s afflictions spread as it falls!`);
  }
  return { tgt, dmg, crit, lucky, dodged, applied };
}

// Performs one basic ATTACK (regen tick + single-target strike + legacy burn aura). Returns a description
// for timeline playback. Status ticking/stun is handled once per activation by the caller.
function takeAction(u, foes, log, seed) {
  if (u.ally) u.actions++; // every action (incl. extra turns) trains the wielder's Gu paths
  const touched = seed || new Set();
  if (u.fx.regen > 0) { const h = Math.min(u.max, u.hp + u.fx.regen); if (h !== u.hp) { u.hp = h; touched.add(u); } }
  const tgt = chooseTarget(u, foes);
  if (!tgt) return { target: null, dmg: 0, crit: false, lucky: false, dodged: false, touched: [...touched] };
  const r = dealHit(u, tgt, 1, { inflict: true }, log, touched, foes);
  // legacy AoE burn aura (themed enemy effect) — applies to all living foes when present; melts Frozen.
  if (u.fx.burn > 0) for (const f of alive(foes)) { damageUnit(f, u.fx.burn); touched.add(f); dispelByFire(f); if (f.hp <= 0) log(`${f.name} burns away.`); }
  return { target: tgt, dmg: r.dmg, crit: r.crit, lucky: r.lucky, dodged: r.dodged, applied: r.applied, touched: [...touched] };
}

// KILLER MOVE execution: run a spec's op list. Each op resolves its selector to a target set, then a
// small handler applies it (reusing dealHit / applyStatus / heal / buff / shield). Returns an event with
// `combo` (name/cjk) + a `hits` list (per-target damage/affliction) for the timeline; `touched` collects
// every unit whose HP/shield changed. `allies` = the actor's OWN side (for team heals/buffs).
function executeKillerMove(u, foes, allies, spec, log, seed) {
  if (u.ally) u.actions++; // a killer move trains the wielder's Gu paths like any action
  const touched = seed || new Set();
  const hits = [];
  let dmgDealt = 0;
  // Per-unit aura category for the arena glow (lowest priority index wins): hostile=red (damage/debuff/
  // essence-drain) · warcry=red-orange (ATK buff) · guard=blue (DEF/thorns/shield/taunt) · heal=green
  // (heal/cleanse/SPD-or-evasion buff/essence-refuel).
  const auras = new Map();
  const AURA_PRI = { hostile: 0, warcry: 1, guard: 2, heal: 3 };
  const mark = (t, k) => { const c = auras.get(t); if (c === undefined || AURA_PRI[k] < AURA_PRI[c]) auras.set(t, k); };
  const buffAura = (stat) => (stat === 'atk' ? 'warcry' : (stat === 'def' || stat === 'thorns') ? 'guard' : 'heal');
  log(`${u.name} unleashes ${spec.name}!`);
  for (const op of (spec.ops || [])) {
    const targets = killerTargets(op.sel, u, foes, allies);
    if (op.op === 'damage') {
      const n = op.hits || 1;
      for (const tgt of targets) { mark(tgt, 'hostile'); for (let h = 0; h < n && tgt.hp > 0; h++) {
        const r = dealHit(u, tgt, op.mult, { exec: op.exec, armorPenBonus: op.armorPen, perStatus: op.perStatus, inflict: false }, log, touched, foes);
        dmgDealt += r.dmg;
        hits.push({ tgt: { side: tgt.side, i: tgt.idx }, dmg: r.dmg, crit: r.crit, lucky: r.lucky, dodged: r.dodged, applied: r.applied });
      } }
    } else if (op.op === 'status') {
      for (const tgt of targets) { if (tgt.hp <= 0) continue; mark(tgt, 'hostile');
        const a = applyKillerStatus(u, tgt, spec.statuses, op, log, touched);
        if (a.length) hits.push({ tgt: { side: tgt.side, i: tgt.idx }, dmg: 0, crit: false, lucky: false, dodged: false, applied: a });
      }
    } else if (op.op === 'heal') {
      for (const tgt of targets) { if (tgt.hp <= 0) continue;
        const amt = op.of === 'dmg' ? Math.round((op.pct || 0) * dmgDealt) : Math.round((op.pct || 0) * tgt.max);
        if (amt > 0) { mark(tgt, 'heal'); const h = Math.min(tgt.max, tgt.hp + amt); if (h !== tgt.hp) { tgt.hp = h; touched.add(tgt); } }
      }
    } else if (op.op === 'cleanse') {
      for (const tgt of targets) { mark(tgt, 'heal'); cleanseOne(tgt, op.max || 1); }
    } else if (op.op === 'buff') {
      for (const tgt of targets) { if (tgt.hp <= 0) continue; mark(tgt, buffAura(op.stat)); applyBuff(tgt, op.stat, op.amount, op.dur); touched.add(tgt); }
    } else if (op.op === 'shield') {
      const amt = Math.round((op.pct || 0) * u.max); // % of the CASTER's max HP
      for (const tgt of targets) { if (tgt.hp <= 0) continue; mark(tgt, 'guard'); tgt.shield = (tgt.shield || 0) + amt; touched.add(tgt); }
    } else if (op.op === 'taunt') {
      for (const tgt of targets) { if (tgt.hp <= 0) continue; mark(tgt, 'guard'); (tgt.statuses = tgt.statuses || {}).taunt_t = { turns: op.dur || 3 }; }
    } else if (op.op === 'essence') {
      // signed: +pct refuels allies' channeling/killer essence (Wellspring); −pct drains foes (Enervate)
      for (const tgt of targets) { if (tgt.hp <= 0 || !(tgt.essMax > 0)) continue; mark(tgt, (op.pct || 0) >= 0 ? 'heal' : 'hostile');
        tgt.ess = Math.max(0, Math.min(tgt.essMax, (tgt.ess || 0) + (op.pct || 0) * tgt.essMax)); touched.add(tgt); }
    }
  }
  return { target: null, dmg: 0, crit: false, lucky: false, dodged: false, applied: [], combo: { name: spec.name, cjk: spec.cjk }, hits, auras: [...auras].map(([unit, kind]) => ({ unit, kind })), touched: [...touched] };
}

// Resolve a killer-move op selector → the list of target units. foes = enemy side, allies = own side.
// SINGLE-target selectors (`target`/`lane`) honour formation (per-lane protection + column reach via
// chooseTarget). AREA selectors do NOT: an AoE splashes the whole area, and "a front unit shields the
// back unit in its lane" is a single-target targeting rule, not a wall that blocks area damage. So:
//   reach   = the caster's ±1-lane column (front AND back, protected or not; expands to the whole board
//             only if that window is empty)
//   allFoes = the ENTIRE enemy board (every living foe) — board-wide moves like Annihilation/Contagion
//             must hit protected back-row units too.
export function killerTargets(sel, u, foes, allies) {
  if (sel === 'self') return [u];
  if (sel === 'team') return alive(allies);
  if (sel === 'lowestAlly') { const a = alive(allies); return a.length ? [a.reduce((b, x) => (x.hp / x.max < b.hp / b.max ? x : b), a[0])] : []; }
  if (sel === 'target' || sel === 'lane') { const t = chooseTarget(u, foes); return t ? [t] : []; }
  const living = alive(foes); // AoE ignores per-lane protection — hit everything in the area
  if (sel === 'reach') { const near = living.filter((x) => Math.abs((x.lane | 0) - (u.lane | 0)) <= 1); return near.length ? near : living; }
  return living; // allFoes (board-wide)
}

// Apply the core's status riders to a target (killer `status` op). `forced` skips the chance roll; for
// DoTs an `op.stacks` applies multiple independent instances. Returns the applied status types.
function applyKillerStatus(u, tgt, statuses, op, log, touched) {
  const applied = [];
  for (const st of (statuses || [])) {
    const def = STATUS[st.type]; if (!def) continue;
    const reps = (op.stacks && def.dot) ? op.stacks : 1;
    for (let r = 0; r < reps; r++) applyStatus(tgt, st.type, u, st.dur, st.mag);
    touched.add(tgt); applied.push(st.type);
    log(`${tgt.name} is afflicted with ${def.label}.`);
  }
  return applied;
}

// Strip up to `max` real debuffs from a unit (killer `cleanse` op). Only STATUS-registry entries are
// debuffs; buff_* / taunt_t entries are skipped so a cleanse never removes a friendly buff.
function cleanseOne(tgt, max) {
  if (!tgt.statuses) return 0;
  let removed = 0;
  for (const k of Object.keys(tgt.statuses)) { if (removed >= max) break; if (!STATUS[k]) continue; delete tgt.statuses[k]; removed++; }
  return removed;
}

// Serialize an action into a compact, side/index-addressed event for the UI timeline.
function serializeAct(actor, ev) {
  const a = {
    side: actor.side, i: actor.idx,
    tgt: ev.target ? { side: ev.target.side, i: ev.target.idx } : null,
    dmg: ev.dmg, crit: ev.crit, lucky: ev.lucky, dodged: ev.dodged,
    stun: !!ev.stunned, frozen: !!ev.frozen, dot: ev.dot || 0, // self-affliction: DoT tick / skipped action
    dots: ev.dots || null, // per-type DoT breakdown ({burn,poison,bleed}) for distinct floating numbers
    applied: ev.applied && ev.applied.length ? ev.applied.slice() : null, // statuses landed on the target
    // every touched unit's HP + shield after this action (shield = killer-move temp HP overlay)
    hp: ev.touched.map((u) => ({ side: u.side, i: u.idx, hp: Math.max(0, Math.round(u.hp)), shield: Math.round(u.shield || 0) })),
    ess: Math.round(actor.ess), // actor's essence after channeling this action (for the arena bar)
  };
  if (ev.combo) { // KILLER MOVE: name banner + per-target hit list (multi-target / heal events)
    a.combo = ev.combo;
    a.hits = (ev.hits || []).map((h) => ({ tgt: h.tgt, dmg: h.dmg, crit: h.crit, lucky: h.lucky, dodged: h.dodged,
      applied: h.applied && h.applied.length ? h.applied.slice() : null }));
    if (ev.auras && ev.auras.length) a.auras = ev.auras.map((x) => ({ side: x.unit.side, i: x.unit.idx, kind: x.kind }));
  }
  // Mender aura: per-ally heal numbers + cleansed tags (side/index-addressed) for the arena to float
  if (ev.heals && ev.heals.length) a.heals = ev.heals.map((h) => ({ side: h.unit.side, i: h.unit.idx, amt: h.amt }));
  if (ev.cleansed && ev.cleansed.length) a.cleansed = ev.cleansed.map((u) => ({ side: u.side, i: u.idx }));
  return a;
}

// Resolve one encounter. `onLog` optional callback(message). `opts.record` builds a step-by-step
// timeline for animated playback (skip it for the silent idle loop).
// Returns { win, rounds, allies, timeline } where `allies` (in active-team order) carry final HP,
// and `timeline` (when recording) = { allies:[snap], waves:[[snap]], steps:[...] }. Each step is
// one simulation instant: { wave, gauges:{ally:[],foe:[]}, acts:[serializeAct] } or { wave, heal }.
export function resolveEncounter(encounter, onLog, opts = {}) {
  const log = onLog || (() => {});
  const rec = !!opts.record;
  const allies = activeTeam().map((c, i) => allyCombatant(c, i));
  if (!allies.length) return { win: false, rounds: 0, allies, timeline: null, simTime: 0 };
  applyTeamAuras(allies); // support-line team auras (Commander ATK/SPD · Warden DEF/thorns+taunt · Mender regen)

  // line/affinity/rarity ride along so the arena can show each unit's trait seal + the per-side panel.
  // Allies expose them via their source character (u.ch); enemy snapshot units carry them directly.
  const snap = (u) => ({ name: u.name, max: u.max || u.maxHp, hp: u.hp, spd: Math.max(1, u.spd), shield: u.shield || 0,
    row: u.row || 'front', lane: (u.lane | 0), kind: u.kind, gu: u.gu,
    guInfo: u.ch ? guInfoFor(u.ch) : (u.guInfo || []), // equipped Gu (name + effect) for the traits panel
    essMax: u.essMax != null ? u.essMax : (u.essencePool || 0),
    rarity: u.ch ? u.ch.rarity : u.rarity, line: u.ch ? u.ch.line : u.line,
    realm: u.ch ? u.ch.realm : u.realm, imprint: u.ch ? (u.ch.imprint || 0) : (u.imprint || 0),
    affinity: u.ch ? affinityPaths(u.ch) : (u.daoPath ? [u.daoPath] : []) });
  const timeline = rec ? {
    allies: allies.map(snap),
    waves: encounter.waves.map((w) => w.map(snap)),
    // active team auras + their sources, for the arena's per-side panel (computed off the same data the
    // engine buffed from: allies' source chars, each enemy wave's baked `aura` tag).
    allyAuras: allyAuraSummary(allies.map((u) => ({ line: u.ch.line, rarity: u.ch.rarity, realm: u.ch.realm, name: u.ch.name }))),
    waveAuras: encounter.waves.map(enemyWaveAura),
    steps: [],
  } : null;
  const gaugeSnap = (arr) => arr.map((u) => (u.hp > 0 ? Math.round(u.gauge) : 0));
  const essSnap = (arr) => arr.map((u) => (u.hp > 0 ? Math.round(u.ess) : 0));
  // active statuses on each living unit, for the arena badges: [{ t:type, n:instances (DoTs) }]
  // per-living-unit active-effect snapshot: debuffs (STATUS keys, n=instance count) + positive killer-move
  // buffs (buff_*/taunt_t) tagged `b:1` with magnitude — so the arena badges + trait panel show buffs too.
  const statusSnap = (arr) => arr.map((u) => {
    if (!u.statuses || u.hp <= 0) return [];
    const out = [];
    for (const k of Object.keys(u.statuses)) {
      if (STATUS[k]) out.push({ t: k, n: Array.isArray(u.statuses[k]) ? u.statuses[k].length : 1 });
      else if (STAT_BUFF[k]) out.push({ t: STAT_BUFF[k], b: 1, mag: u.statuses[k].mag || 0 });
      else if (k === 'taunt_t') out.push({ t: 'taunt', b: 1 });
    }
    return out;
  });

  let actions = 0, simTime = 0; // simTime = total gauge-time the fight consumes

  for (let w = 0; w < encounter.waves.length; w++) {
    const foes = encounter.waves[w].map((u, i) => enemyCombatant(u, i));
    if (encounter.waves.length > 1) log(`— Wave ${w + 1} of ${encounter.waves.length} —`);
    [...allies, ...foes].forEach((u) => { u.gauge = 0; });

    while (sideAlive(allies) && sideAlive(foes) && actions < 3000) {
      const pool = [...alive(allies), ...alive(foes)];
      // advance time to the next unit whose gauge fills (Slow lowers a unit's effective fill rate)
      let dt = Infinity;
      for (const u of pool) { const t = (THRESHOLD - u.gauge) / effSpd(u); if (t < dt) dt = t; }
      for (const u of pool) u.gauge += dt * effSpd(u);
      simTime += dt;
      for (const u of pool) u.ess = Math.min(u.essMax, u.ess + u.essRegen * dt * ESS_REGEN_SCALE); // essence regenerates (gates Gu channeling)
      // everyone who topped out acts this instant, fastest first
      const actors = pool.filter((u) => u.gauge >= THRESHOLD - 1e-6).sort((a, b) => effSpd(b) - effSpd(a));
      // `dt` is the gauge-time advanced before this instant — the UI plays it back in real time so
      // higher-SPD units visibly act more often (speed = gauge points accrued per unit time).
      const step = rec ? { wave: w, dt, gauges: { ally: gaugeSnap(allies), foe: gaugeSnap(foes) }, essence: { ally: essSnap(allies), foe: essSnap(foes) }, acts: [] } : null;
      for (const u of actors) {
        if (u.hp <= 0) continue;
        u.gauge = 0; // actions always cost the full gauge (no overflow)
        if (u.killerCd > 0) u.killerCd--; // KILLER MOVE: tick the per-unit cooldown each of its own actions
        const enemySide = u.ally ? foes : allies;
        const allySide = u.ally ? allies : foes;
        // tick this unit's afflictions once per activation (DoT damage, duration −1, possible Stun/Frozen)
        const pre = new Set();
        const { dot, dots, stunned, frozen } = tickStatuses(u, log, pre);
        let ev;
        if (u.hp <= 0) { log(`${u.name} succumbs to affliction.`); ev = { target: null, dmg: 0, crit: false, lucky: false, dodged: false, dot, dots, touched: [...pre] }; }
        else if (stunned) { log(`${u.name} is ${frozen ? 'frozen' : 'stunned'} and cannot act.`); ev = { target: null, dmg: 0, crit: false, lucky: false, dodged: false, stunned: true, frozen, dot, dots, touched: [...pre] }; }
        else if (u.killer && u.ess + 1e-9 >= u.comboCost && u.killerCd <= 0) {
          // KILLER MOVE: enough banked essence + off cooldown → spend comboCost, fire at full power (no channel spend)
          u.ess = Math.max(0, u.ess - u.comboCost); u.killerCd = KILLER_COOLDOWN; applyTopTier(u);
          ev = executeKillerMove(u, enemySide, allySide, u.killer, log, pre); ev.dot = dot; ev.dots = dots;
        }
        else { applyChannel(u); ev = takeAction(u, enemySide, log, pre); ev.dot = dot; ev.dots = dots; // gate Gu by essence → this action's active prefix
          if (u.teamHealPct) { const healed = new Set(ev.touched); ev.heals = []; ev.cleansed = []; // Mender: heal + cleanse on its action
            teamHeal(u, allies, healed, ev.heals); cleanseTeam(u, allies, ev.cleansed); ev.touched = [...healed]; } }
        actions++;
        if (rec) step.acts.push(serializeAct(u, ev));
        if (!stunned && u.hp > 0 && Math.random() < (u.fx.extra_turn || 0) && sideAlive(enemySide)) {
          applyChannel(u);
          const ev2 = takeAction(u, enemySide, log); actions++;
          if (rec) step.acts.push(serializeAct(u, ev2));
        }
        if (!sideAlive(allies) || !sideAlive(foes)) break;
      }
      if (rec) { step.statuses = { ally: statusSnap(allies), foe: statusSnap(foes) }; timeline.steps.push(step); }
    }

    if (!sideAlive(allies)) return { win: false, rounds: actions, allies, timeline, simTime };
    // breather heal between waves (10% of max) — survivable but tense
    if (w < encounter.waves.length - 1) {
      for (const a of allies) if (a.hp > 0) a.hp = Math.min(a.max, a.hp + Math.round(a.max * 0.1));
      if (rec) timeline.steps.push({ wave: w, heal: allies.map((u) => Math.max(0, Math.round(u.hp))) });
    }
  }

  return { win: true, rounds: actions, allies, timeline, simTime };
}
