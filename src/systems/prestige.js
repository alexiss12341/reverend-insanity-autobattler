// Prestige / Reincarnation: the new-game-plus loop. Once a cultivator has reached deep into the
// world (or forged a Venerable), the player may REINCARNATE — wiping the current life (floors,
// roster, Gu, currencies, Dao Marks) in exchange for permanent SOVEREIGN SOULS.
// Souls buy permanent BOONS that carry across every future life:
//   • Might   — +4% ATK & Max HP to all allies per level (combat).
//   • Fortune — +8% primeval stones & Immortal Essence gains per level (economy).
//   • Insight — each level starts the next life with +1 player Gu slot and bonus stones/essence.
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
  insight: { name: 'Sovereign Insight', base: 20, max: 5, blurb: 'Begin each new life with +1 player Gu slot and bonus resources (per level, max 5).' },
};
export const boonLevel = (key) => prestige().boons[key] || 0;
export const boonMax = (key) => BOONS[key].max ?? Infinity;
export const boonAtMax = (key) => boonLevel(key) >= boonMax(key);
export const boonCost = (key) => BOONS[key].base * (boonLevel(key) + 1);

export function buyBoon(key) {
  if (!BOONS[key]) return { ok: false, msg: 'Unknown boon.' };
  const p = prestige(); S().prestige = p;
  if (boonAtMax(key)) return { ok: false, msg: `${BOONS[key].name} is at its maximum level (${boonMax(key)}).` };
  const cost = boonCost(key);
  if (p.souls < cost) return { ok: false, msg: `Need ${cost} Sovereign Souls.` };
  p.souls -= cost; p.boons[key] = (p.boons[key] || 0) + 1;
  save();
  return { ok: true, level: p.boons[key], cost };
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
export const REINCARNATION_COMP_THRESHOLD = 3;
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

// `choice` (from the reincarnation pickers, main.js) = { name, path, line }: re-name the cultivator,
// stamp a new Dao affinity + archetype line onto the reborn player. No starter Gu is granted on rebirth.
export function reincarnate(choice = null) {
  if (!canReincarnate()) return { ok: false, msg: 'Reach Floor 20 or forge a Venerable before reincarnating.' };
  const award = soulsAward();
  const p = { ...prestige() };
  p.boons = { ...p.boons };
  p.souls += award; p.reincarnations += 1;

  const slot = S().slot;
  const player0 = S().roster.find((c) => c.isPlayer) || S().roster[0];
  const playerName = (choice && choice.name) || (player0 && player0.name); // chosen (or carried) name
  const starter = choice && (choice.path || choice.line) ? { path: choice.path, line: choice.line } : null;
  const fresh = newGame(slot, playerName || 'Fang Yuan', starter);
  fresh.prestige = p;
  // Sovereign Insight: head start for the new life.
  const insight = p.boons.insight || 0;
  if (insight) {
    fresh.stones += insight * 200;
    fresh.essence += insight * 40;
    fresh.roster[0].bonusSlots = (fresh.roster[0].bonusSlots || 0) + insight;
  }
  state.current = fresh;
  save();
  return { ok: true, award, souls: p.souls, reincarnations: p.reincarnations };
}
