// Daily Quests: a small rotating board of day-bound goals that pay out Immortal Essence (✦) on claim.
// The board RESETS at local midnight (a real-world calendar-day boundary) — progress, claims and the
// all-clear bonus all clear over. Progress is tracked by per-quest COUNTERS bumped from main.js at the
// matching action (a battle win, a refine, a recruit pull, …); the UI (ui.js viewQuests) reads the
// derived helpers below and the player CLAIMS each completed quest manually. Battle stays a pure
// consumer — this module owns the daily state shape and mutates state.daily via these functions only.
import { S } from '../state.js';

// Local calendar-day key (YYYY-MM-DD) — the daily reset boundary. Uses the player's local date so the
// board turns over at their midnight (there is no server; "daily" is client-local by design).
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// The daily quest roster. Each: id (also the counter key bumped via bumpQuest), label, goal (count to
// reach), reward (✦ on claim), hint. Goals are chosen to be reachable in a normal play session.
export const DAILY_QUESTS = [
  { id: 'wins',         goal: 10, reward: 30, label: 'Win 10 battles',
    hint: 'Idle-farm any cleared floor or press ⚔ Attempt Floor.' },
  { id: 'craft',        goal: 2,  reward: 30, label: 'Refine 2 Gu',
    hint: 'Craft Gu in the Gu Refinery.' },
  { id: 'recruit',      goal: 1,  reward: 30, label: 'Recruit a cultivator',
    hint: 'Spend ✦ on a pull in the Recruit tab.' },
  { id: 'breakthrough', goal: 1,  reward: 30, label: 'Attempt a breakthrough',
    hint: 'Buy a breakthrough on a Character sheet (success or failure both count).' },
  { id: 'market',       goal: 3,  reward: 30, label: 'Buy 3 resources from the Market',
    hint: 'Purchase resources with 石 Primeval Stones in the Market.' },
];
// Bonus ✦ for completing (and claiming) every quest on the board the same day.
// (5 × 30 + 50 = 200 ✦ total per day.)
export const COMPLETE_ALL_BONUS = 50;

const questDef = (id) => DAILY_QUESTS.find((q) => q.id === id);

// Reset the board if the local calendar day rolled over (or the daily state is missing). Idempotent;
// safe to call from any getter. Returns true when a reset actually happened.
export function ensureDaily() {
  const s = S(); if (!s) return false;
  if (!s.daily || typeof s.daily !== 'object') { s.daily = { date: today(), progress: {}, claimed: {}, bonusClaimed: false }; return true; }
  if (s.daily.date !== today()) {
    s.daily.date = today();
    s.daily.progress = {};
    s.daily.claimed = {};
    s.daily.bonusClaimed = false;
    return true;
  }
  return false;
}

const rawProgress = (id) => (S().daily.progress[id] || 0);
export const questGoal = (id) => { const q = questDef(id); return q ? q.goal : 0; };
// Progress clamped to the goal — what the UI shows ("7 / 10").
export const questProgress = (id) => { ensureDaily(); return Math.min(questGoal(id), rawProgress(id)); };
export const questComplete = (id) => { ensureDaily(); return rawProgress(id) >= questGoal(id); };
export const questClaimed = (id) => { ensureDaily(); return !!S().daily.claimed[id]; };
export const questClaimable = (id) => questComplete(id) && !questClaimed(id);

// Advance a quest's counter by `n`. Called from main.js at the matching game action. No-op once the
// quest is claimed or already at goal, so over-counting never wastes progress or double-pays.
export function bumpQuest(id, n = 1) {
  const s = S(); if (!s) return;
  ensureDaily();
  const q = questDef(id); if (!q) return;
  if (s.daily.claimed[id] || rawProgress(id) >= q.goal) return;
  s.daily.progress[id] = Math.min(q.goal, rawProgress(id) + n);
}

// Claim a completed quest → grant its ✦ once. Returns { ok, reward }.
export function claimQuest(id) {
  if (!S() || !questClaimable(id)) return { ok: false };
  const q = questDef(id);
  S().daily.claimed[id] = true;
  S().essence += q.reward;
  return { ok: true, reward: q.reward };
}

export const allClaimed = () => { ensureDaily(); return DAILY_QUESTS.every((q) => S().daily.claimed[q.id]); };
export const bonusClaimable = () => allClaimed() && !S().daily.bonusClaimed;
// Claim the all-clear bonus (only once every quest is claimed). Returns { ok, reward }.
export function claimBonus() {
  if (!S() || !bonusClaimable()) return { ok: false };
  S().daily.bonusClaimed = true;
  S().essence += COMPLETE_ALL_BONUS;
  return { ok: true, reward: COMPLETE_ALL_BONUS };
}

// Total ✦ available to claim right now (every completed-unclaimed quest's reward + the all-clear bonus).
export function pendingReward() {
  ensureDaily();
  let r = 0;
  for (const q of DAILY_QUESTS) if (questClaimable(q.id)) r += q.reward;
  if (bonusClaimable()) r += COMPLETE_ALL_BONUS;
  return r;
}
// How many rewards are ready to collect (drives the nav badge): one per claimable quest + the bonus.
export function claimableCount() {
  if (!S() || !S().daily) return 0;
  ensureDaily();
  let n = DAILY_QUESTS.filter((q) => questClaimable(q.id)).length;
  if (bonusClaimable()) n += 1;
  return n;
}

// Milliseconds until the next local-midnight reset — for the "resets in …" countdown label.
export function msToReset() {
  const d = new Date();
  const next = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0);
  return next - d;
}
