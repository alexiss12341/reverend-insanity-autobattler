// Prestige / Reincarnation: the new-game-plus loop. Once a cultivator has reached deep into the
// world (or forged a Venerable), the player may REINCARNATE — wiping the current life (floors,
// roster, Gu, currencies, Dao Marks) in exchange for permanent SOVEREIGN SOULS.
// Souls buy permanent BOONS that carry across every future life:
//   • Might   — +4% ATK & Max HP to all allies per level (combat).
//   • Fortune — +8% primeval stones & Immortal Essence gains per level (economy).
//   • Insight — +1 player Gu slot AND a stones/essence bonus per level, applied LIVE to the CURRENT life
//               the moment a level is bought (the slot also re-applies, and resources head-start, at rebirth).
import { state, S, newGame, save } from '../state.js';
import { comprehensionLevelIn } from './dao.js';

const DEFAULT = { souls: 0, reincarnations: 0, boons: { might: 0, fortune: 0, insight: 0 } };
export function prestige() {
  const p = S().prestige || DEFAULT;
  p.boons = p.boons || { might: 0, fortune: 0, insight: 0 };
  return p;
}

// Global multipliers consumed by cultivation (combat) and economy (gains).
export const prestigeCombatMult = () => 1 + (prestige().boons.might || 0) * 0.04;
export const prestigeGainMult = () => 1 + (prestige().boons.fortune || 0) * 0.08;

export const BOONS = {
  might:   { name: 'Sovereign Might',   base: 15, max: 5, blurb: '+4% ATK & Max HP to all allies (per level, max 5).' },
  fortune: { name: 'Sovereign Fortune', base: 15, max: 5, blurb: '+8% Primeval Stone & Immortal Essence gains (per level, max 5).' },
  // Insight is the strongest boon (a permanent Gu slot): CAPPED at level 5 and priced at 4× its own
  // original base (5 → 20). migrateSave refunds any legacy save that bought past the cap.
  insight: { name: 'Sovereign Insight', base: 20, max: 5, blurb: '+1 player Gu slot and bonus resources per level — applied immediately to your current life (max 5).' },
};
// Sovereign Insight's per-level RESOURCE bonus. Granted to the CURRENT life the moment a level is bought
// (buyBoon), AND as a fresh-life head-start at each reincarnation (× the boon level).
export const INSIGHT_STONES_PER_LEVEL = 200;
export const INSIGHT_ESSENCE_PER_LEVEL = 40;
export const boonLevel = (key) => prestige().boons[key] || 0;
export const boonMax = (key) => BOONS[key].max ?? Infinity;
export const boonAtMax = (key) => boonLevel(key) >= boonMax(key);
export const boonCost = (key) => BOONS[key].base * (boonLevel(key) + 1);

// Sovereign Insight's +1 Gu slot/level applies to the CURRENT life: the player's bonusSlots (whose ONLY
// source is Insight) is kept synced to the live boon level. Called after a purchase; load-time sync lives
// in state.js migrateSave.
export function syncInsightSlots() {
  const player = S().roster.find((c) => c.isPlayer) || S().roster[0];
  if (player) player.bonusSlots = prestige().boons.insight || 0;
}

export function buyBoon(key) {
  if (!BOONS[key]) return { ok: false, msg: 'Unknown boon.' };
  const p = prestige(); S().prestige = p;
  if (boonAtMax(key)) return { ok: false, msg: `${BOONS[key].name} is at its maximum level (${boonMax(key)}).` };
  const cost = boonCost(key);
  if (p.souls < cost) return { ok: false, msg: `Need ${cost} Sovereign Souls.` };
  p.souls -= cost; p.boons[key] = (p.boons[key] || 0) + 1;
  // Sovereign Insight takes effect on the CURRENT life the instant it's bought: +1 Gu slot (synced) AND
  // this level's resource bonus, granted right now (not held until the next reincarnation).
  let gained = null;
  if (key === 'insight') {
    syncInsightSlots();
    S().stones = (S().stones || 0) + INSIGHT_STONES_PER_LEVEL;
    S().essence = (S().essence || 0) + INSIGHT_ESSENCE_PER_LEVEL;
    gained = { stones: INSIGHT_STONES_PER_LEVEL, essence: INSIGHT_ESSENCE_PER_LEVEL };
  }
  save();
  return { ok: true, level: p.boons[key], cost, gained };
}

const hasVenerable = () => S().roster.some((c) => c.realm >= 23);
export function canReincarnate() {
  return hasVenerable() || S().frontier >= 20;
}
// Souls awarded for the current life's progress.
export function soulsAward() {
  const ven = S().roster.filter((c) => c.realm >= 23).length;
  const floors = S().stats.floorsCleared || 0;
  return Math.max(1, Math.floor(S().frontier / 4) + ven * 15 + Math.floor(floors / 10));
}

// Reincarnation lets the player re-pick their Dao affinity from the paths THIS life mastered: the
// previous affinity (always available) plus every path the player character reached Comprehension
// level REINCARNATION_COMP_THRESHOLD+ in. Read off the CURRENT life, so call before reincarnate() wipes it.
export const REINCARNATION_COMP_THRESHOLD = 5;
export function reincarnationPathChoices() {
  const player = S().roster.find((c) => c.isPlayer) || S().roster[0];
  if (!player) return [];
  const prev = player.affinity || [];
  const extra = [];
  for (const pid in (player.comprehension || {})) {
    if (prev.includes(pid)) continue; // previous affinity is added below regardless of its comp level
    if (comprehensionLevelIn(player, pid) >= REINCARNATION_COMP_THRESHOLD) extra.push(pid);
  }
  return [...prev, ...extra];
}

// `choice` (from the reincarnation pickers, main.js) = { name, path, guId, line }: re-name the cultivator,
// stamp a new Dao affinity + archetype line onto the reborn player, and grant the chosen rank-1 Gu of the
// new path (unequipped, like a new game). guId may be absent if the path had no curated starter Gu.
export function reincarnate(choice = null) {
  if (!canReincarnate()) return { ok: false, msg: 'Reach Floor 20 or forge a Venerable before reincarnating.' };
  const award = soulsAward();
  const p = { ...prestige() };
  p.boons = { ...p.boons };
  p.souls += award; p.reincarnations += 1;

  const slot = S().slot;
  const player0 = S().roster.find((c) => c.isPlayer) || S().roster[0];
  const playerName = (choice && choice.name) || (player0 && player0.name); // chosen (or carried) name
  const starter = choice && (choice.path || choice.line)
    ? { path: choice.path, guId: choice.guId, line: choice.line }
    : null;
  const fresh = newGame(slot, playerName || 'Fang Yuan', starter);
  fresh.prestige = p;
  // Sovereign Insight: the new life inherits the permanent +1 Gu slot/level and a fresh resource head-start.
  const insight = p.boons.insight || 0;
  if (insight) {
    fresh.stones += insight * INSIGHT_STONES_PER_LEVEL;
    fresh.essence += insight * INSIGHT_ESSENCE_PER_LEVEL;
    fresh.roster[0].bonusSlots = (fresh.roster[0].bonusSlots || 0) + insight;
  }
  state.current = fresh;
  save();
  return { ok: true, award, souls: p.souls, reincarnations: p.reincarnations };
}
