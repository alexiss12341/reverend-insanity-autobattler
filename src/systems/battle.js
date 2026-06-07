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
import { effectiveStats } from './cultivation.js';
import { STATUS } from '../data/status.js';
import { lineAura, affinityPaths, allyAuraSummary, enemyWaveAura } from '../data/traits.js';
import { rarityTier } from '../data/rarities.js';
import { resolveOwned, effectText } from '../data/gu.js';

// An ally's equipped Gu as { name, eff } for the arena traits panel (resolves each uid via guInv).
const guInfoFor = (ch) => ((ch && ch.gu) || []).map((uid) => {
  const owned = S().guInv.find((o) => o.uid === uid);
  const g = owned && resolveOwned(owned);
  return g ? { name: g.name, eff: effectText(g) } : null;
}).filter(Boolean);

const THRESHOLD = 1000; // movement gauge cap
// Essence (aperture) economy — GATES combat. Each action a combatant pays its loadout channel cost
// (essCost = Σ Gu tier costs); if its aperture (essencePool, scaled by aptitude's capacity %) can't
// cover that cost, the Gu under-channel — the channel factor drops toward ESS_BROKE_FLOOR. CRUCIALLY
// that factor scaps only the GU-ADDED attack, NOT the unaided base swing (see effAtk + atkBase), so a
// starved loadout merely under-delivers its bonus — equipping Gu can NEVER make a unit hit softer than
// fighting bare-handed. Essence regenerates at essRegen × this scale per unit of gauge-time; since it
// starts full and refills, the steady channel factor ≈ min(1, essencePool / essCost) — i.e. APERTURE
// CAPACITY (aptitude) is the binding constraint on how much EXTRA a heavy Gu loadout actually delivers.
const ESS_REGEN_SCALE = 0.16;
const ESS_BROKE_FLOOR = 0.4; // floor on the channel factor applied to the GU-ADDED attack (base is never gated)
const FRONT = 3;        // fallback enemy front-row size if a unit lacks an explicit row
const BASE_HIT = 0.85;  // every attack starts from an 85% chance to land before Hit/Evasion adjust it
// Every contested roll-chance (Hit, Crit) is clamped to [1%, 99%] — a max build floors the opposing
// chance at 1% (near-immunity, never literal 0/100); Lucky Hit is the one roll left unclamped.
const clampP = (p) => Math.max(0.01, Math.min(0.99, p));

function allyCombatant(ch, pos) {
  const s = effectiveStats(ch);
  // `ch` + `actions` let the caller bank per-action Comprehension after the encounter.
  // `side`/`idx` give the UI a stable handle; `row`/`lane` place the unit on the 2×5 board.
  return { ch, name: ch.name, ally: true, side: 'ally', idx: pos, row: rowOf(ch), lane: laneOf(ch), gauge: 0, hp: s.maxHp, max: s.maxHp, atk: s.atk, atkBase: s.atkBase != null ? s.atkBase : s.atk, def: s.def, spd: Math.max(1, s.spd), fx: s, actions: 0,
    ess: s.essencePool, essMax: s.essencePool, essRegen: s.essenceRegen, essCost: s.essenceCost || 0 };
}
function enemyCombatant(u, pos) {
  // Defaults for any field the enemy's effect bundle doesn't supply; enemyUnit now derives the full
  // combat block from attributes (crit, dodge=evasion, hitChance, critDamage, critResist, armorPen,
  // luckyHit) so allies and foes resolve through the identical pipeline.
  const base = { lifesteal: 0, crit: 0, dodge: 0, thorns: 0, burn: 0, regen: 0, extra_turn: 0,
    hitChance: 0, critDamage: 1.5, critResist: 0, armorPen: 0, luckyHit: 0, potency: 0, statusResist: 0,
    essDrain: 0, dotSpread: 0, inflicts: [] };
  return {
    name: u.name, ally: false, side: 'foe', idx: pos, isBoss: u.isBoss,
    row: u.row || (pos < FRONT ? 'front' : 'back'), lane: u.lane != null ? u.lane : pos % FRONT,
    gauge: 0, hp: u.hp, max: u.maxHp, atk: u.atk, atkBase: u.atkBase != null ? u.atkBase : u.atk, def: u.def, spd: Math.max(1, u.spd),
    ess: u.essencePool || 60, essMax: u.essencePool || 60, essRegen: u.essenceRegen || 3, essCost: u.essenceCost || 0,
    fx: { ...base, ...(u.effects || {}) },
  };
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
  for (const u of allies) {
    if (atk) { u.atk = Math.round(u.atk * (1 + atk)); u.atkBase = Math.round((u.atkBase != null ? u.atkBase : u.atk) * (1 + atk)); }
    if (def) u.def = Math.round(u.def * (1 + def));
    if (spd) u.spd = Math.max(1, Math.round(u.spd * (1 + spd)));
    if (thorns) u.fx = { ...u.fx, thorns: (u.fx.thorns || 0) + thorns };
  }
  return allies;
}

// Mender TEAM HEAL: on the actor's OWN action, restore each living ally by % of their own max HP.
// Mutates ally.hp and records changed units in `touched` (so the timeline floats the heal). No-op for
// non-Menders. Exported for tests.
export function teamHeal(actor, allies, touched) {
  if (!actor.teamHealPct) return;
  for (const a of allies) {
    if (a.hp <= 0) continue;
    const h = Math.min(a.max, a.hp + Math.round((a.max || 0) * actor.teamHealPct));
    if (h !== a.hp) { a.hp = h; if (touched) touched.add(a); }
  }
}

// Mender CLEANSE params by rarity: chance scales with rarity (capped 25% at Immortal); max debuffs per
// proc = 1 + tiers above Rare (Common/Uncommon/Rare→1, Epic→2, Legendary→3, Immortal→4).
const CLEANSE_CHANCE = [0.05, 0.08, 0.12, 0.16, 0.20, 0.25]; // index by rarityTier 1..6
export const cleanseChanceFor = (rarity) => CLEANSE_CHANCE[rarityTier(rarity) - 1] || 0.05;
export const cleanseMaxFor = (rarity) => 1 + Math.max(0, rarityTier(rarity) - 3);

// Mender CLEANSE: on the Mender's action, roll its chance to strip up to `cleanseMax` debuffs from living
// allies (every battle status here is a debuff). One roll; removes whole status types in order. Exported.
export function cleanseTeam(actor, allies) {
  if (!actor.cleanseChance || Math.random() >= actor.cleanseChance) return 0;
  let removed = 0;
  for (const a of allies) {
    if (removed >= actor.cleanseMax) break;
    if (a.hp <= 0 || !a.statuses) continue;
    for (const k of Object.keys(a.statuses)) {
      if (removed >= actor.cleanseMax) break;
      delete a.statuses[k]; removed++;
    }
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
  // Warden TAUNT: enemies prefer a taunting ally when one is reachable/valid (respects lane protection).
  const taunters = valid.filter((u) => u.taunt);
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
const stMag = (u, type) => (u.statuses && u.statuses[type] ? u.statuses[type].mag || 0 : 0);
const effSpd = (u) => Math.max(1, u.spd * (1 - stMag(u, 'slow')));
// Essence channel only saps the GU-ADDED attack, never the unaided base — so equipping Gu can never
// make a unit hit SOFTER than fighting bare-handed (it just under-delivers the Gu's bonus when starved).
const effAtk = (u) => {
  const ch = u.channel != null ? u.channel : 1;
  const base = u.atkBase != null ? u.atkBase : u.atk;
  const channeled = base + Math.max(0, u.atk - base) * ch;
  return channeled * (1 - stMag(u, 'weaken'));
};
const effDef = (u) => u.def * (1 - stMag(u, 'sunder'));
const frailMult = (u) => 1 + stMag(u, 'frail');

// Pay essence to channel this action's Gu; returns the power factor in [ESS_BROKE_FLOOR, 1].
// Symmetric for allies & foes (both carry essCost). Spends the channel cost (down to 0).
function channelFactor(u) {
  if (!u.essCost) return 1;
  const f = Math.max(ESS_BROKE_FLOOR, Math.min(1, u.ess / u.essCost));
  u.ess = Math.max(0, u.ess - u.essCost);
  return f;
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
  if (dot > 0) { u.hp -= dot; touched.add(u); log(`${u.name} suffers ${dot} from afflictions.`); }
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
function takeAction(u, foes, log, seed) {
  if (u.ally) u.actions++; // every action (incl. extra turns) trains the wielder's Gu paths
  const touched = seed || new Set();
  if (u.fx.regen > 0) { const h = Math.min(u.max, u.hp + u.fx.regen); if (h !== u.hp) { u.hp = h; touched.add(u); } }
  const tgt = chooseTarget(u, foes);
  if (!tgt) return { target: null, dmg: 0, crit: false, lucky: false, dodged: false, touched: [...touched] };

  let dmg = 0, crit = false, dodged = false, lucky = false, applied = [];
  // (1) HIT — 85% base + attacker Hit-bonus − target Evasion, clamped to [1%,99%].
  const hitP = clampP(BASE_HIT + (u.fx.hitChance || 0) - (tgt.fx.dodge || 0));
  if (Math.random() > hitP) { dodged = true; log(`${tgt.name} evades ${u.name}.`); }
  else {
    // base damage; Armor Penetration ignores a % of the target's (Sunder-reduced) mitigated DEF.
    const def = effDef(tgt) * 0.6 * Math.max(0, 1 - (u.fx.armorPen || 0));
    dmg = Math.max(1, Math.round(effAtk(u) - def));
    // (2) LUCKY HIT — forced crit that IGNORES Crit Resistance and hits for ×1.5×CritDamage (unclamped).
    if (Math.random() < (u.fx.luckyHit || 0)) {
      lucky = crit = true;
      dmg = Math.round(dmg * 1.5 * (u.fx.critDamage || 1.5));
    } else if ((u.fx.crit || 0) > 0) {
      // (3) CRIT — CritChance − target Crit Resistance, clamped [1%,99%] → ×CritDamage.
      if (Math.random() < clampP((u.fx.crit || 0) - (tgt.fx.critResist || 0))) {
        crit = true; dmg = Math.round(dmg * (u.fx.critDamage || 1.5));
      }
    }
    if (stMag(tgt, 'frail')) dmg = Math.max(1, Math.round(dmg * frailMult(tgt))); // Frail amplifies hits
    tgt.hp -= dmg; touched.add(tgt);
    // a fire-path strike shatters Frozen (even if its Burn doesn't catch)
    if (isFirePath(u) && dispelByFire(tgt).length) log(`${tgt.name}'s ice shatters in the flames.`);
    if (u.fx.lifesteal > 0) { u.hp = Math.min(u.max, u.hp + Math.round(dmg * u.fx.lifesteal)); touched.add(u); }
    if ((u.fx.essDrain || 0) > 0 && (tgt.essMax || 0) > 0) { // Reaver: steal a slice of the target's essence on hit
      const d = Math.round(tgt.essMax * u.fx.essDrain);
      if (d > 0) { tgt.ess = Math.max(0, (tgt.ess || 0) - d); u.ess = Math.min(u.essMax || u.ess || 0, (u.ess || 0) + d); }
    }
    if (tgt.fx.thorns > 0 && tgt.hp > 0) { u.hp -= Math.round(dmg * tgt.fx.thorns); touched.add(u); }
    applied = inflictStatuses(u, tgt, log, touched); // (status) Potency vs Status Resistance per rider
    log(`${u.name} hits ${tgt.name} for ${dmg}${lucky ? ' (lucky crit!)' : crit ? ' (crit!)' : ''}.`);
    if (tgt.hp <= 0) log(`${tgt.name} is slain.`);
    if (tgt.hp <= 0 && (u.fx.dotSpread || 0) > 0 && tgt.statuses && Math.random() < u.fx.dotSpread) {
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
  }
  // legacy AoE burn aura (themed enemy effect) — applies to all living foes when present; melts Frozen.
  if (u.fx.burn > 0) for (const f of alive(foes)) { f.hp -= u.fx.burn; touched.add(f); dispelByFire(f); if (f.hp <= 0) log(`${f.name} burns away.`); }
  return { target: tgt, dmg, crit, lucky, dodged, applied, touched: [...touched] };
}

// Serialize an action into a compact, side/index-addressed event for the UI timeline.
function serializeAct(actor, ev) {
  return {
    side: actor.side, i: actor.idx,
    tgt: ev.target ? { side: ev.target.side, i: ev.target.idx } : null,
    dmg: ev.dmg, crit: ev.crit, lucky: ev.lucky, dodged: ev.dodged,
    stun: !!ev.stunned, frozen: !!ev.frozen, dot: ev.dot || 0, // self-affliction: DoT tick / skipped action
    dots: ev.dots || null, // per-type DoT breakdown ({burn,poison,bleed}) for distinct floating numbers
    applied: ev.applied && ev.applied.length ? ev.applied.slice() : null, // statuses landed on the target
    hp: ev.touched.map((u) => ({ side: u.side, i: u.idx, hp: Math.max(0, Math.round(u.hp)) })),
    ess: Math.round(actor.ess), // actor's essence after channeling this action (for the arena bar)
  };
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
  const snap = (u) => ({ name: u.name, max: u.max || u.maxHp, hp: u.hp, spd: Math.max(1, u.spd),
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
  const statusSnap = (arr) => arr.map((u) => (u.statuses && u.hp > 0
    ? Object.keys(u.statuses).map((k) => ({ t: k, n: Array.isArray(u.statuses[k]) ? u.statuses[k].length : 1 }))
    : []));

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
        const enemySide = u.ally ? foes : allies;
        // tick this unit's afflictions once per activation (DoT damage, duration −1, possible Stun/Frozen)
        const pre = new Set();
        const { dot, dots, stunned, frozen } = tickStatuses(u, log, pre);
        let ev;
        if (u.hp <= 0) { log(`${u.name} succumbs to affliction.`); ev = { target: null, dmg: 0, crit: false, lucky: false, dodged: false, dot, dots, touched: [...pre] }; }
        else if (stunned) { log(`${u.name} is ${frozen ? 'frozen' : 'stunned'} and cannot act.`); ev = { target: null, dmg: 0, crit: false, lucky: false, dodged: false, stunned: true, frozen, dot, dots, touched: [...pre] }; }
        else { u.channel = channelFactor(u); ev = takeAction(u, enemySide, log, pre); ev.dot = dot; ev.dots = dots; // pay essence → Gu channel power
          if (u.teamHealPct) { const healed = new Set(ev.touched); teamHeal(u, allies, healed); ev.touched = [...healed]; cleanseTeam(u, allies); } } // Mender: heal + cleanse on its action
        actions++;
        if (rec) step.acts.push(serializeAct(u, ev));
        if (!stunned && u.hp > 0 && Math.random() < (u.fx.extra_turn || 0) && sideAlive(enemySide)) {
          u.channel = channelFactor(u);
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
