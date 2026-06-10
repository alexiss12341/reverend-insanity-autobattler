// Bounties — the SYSTEMS layer over data/bounties.js: the shared ATTEMPTS pool (5 max, +1/hour, offline-
// aware), the day's bounty roster, the progression gate, and reward granting. data/bounties.js stays a
// pure builder (DOM/state-free); this module owns the stateful side via state.current.
import { S } from '../state.js';
import { addStones, addEssence, applyDrops } from './economy.js';
import { buildBounty, buildBountyEncounter, slotUnlockFloor, BOUNTY_SLOTS } from '../data/bounties.js';

export const BOUNTY_MAX_ATTEMPTS = 5;
export const BOUNTY_REFILL_MS = 60 * 60 * 1000; // one attempt recharges per hour

// Local calendar-day key (mirrors quests.js today()) — the daily bounty-roster boundary.
export function bountyDayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Lazily ensure the persisted attempts block exists (backfills legacy / fresh saves).
function ensureBounties() {
  const s = S();
  if (!s.bounties || typeof s.bounties !== 'object') s.bounties = { attempts: BOUNTY_MAX_ATTEMPTS, lastRefill: Date.now() };
  if (typeof s.bounties.attempts !== 'number') s.bounties.attempts = BOUNTY_MAX_ATTEMPTS;
  if (typeof s.bounties.lastRefill !== 'number') s.bounties.lastRefill = Date.now();
  return s.bounties;
}

// Recharge attempts from elapsed REAL time — works offline too, since it's driven entirely by the
// persisted `lastRefill` stamp (no ticking). Advancing lastRefill by whole refill-periods preserves the
// partial progress toward the next attempt; reaching the cap parks the timer at "now".
export function refillAttempts() {
  const b = ensureBounties();
  if (b.attempts >= BOUNTY_MAX_ATTEMPTS) return b;
  const elapsed = Date.now() - b.lastRefill;
  if (elapsed < BOUNTY_REFILL_MS) return b;
  const gained = Math.floor(elapsed / BOUNTY_REFILL_MS);
  b.attempts = Math.min(BOUNTY_MAX_ATTEMPTS, b.attempts + gained);
  b.lastRefill = b.attempts >= BOUNTY_MAX_ATTEMPTS ? Date.now() : b.lastRefill + gained * BOUNTY_REFILL_MS;
  return b;
}
export const attemptsLeft = () => refillAttempts().attempts;
// Milliseconds until the next attempt recharges (0 when already full).
export function msToNextAttempt() {
  const b = refillAttempts();
  if (b.attempts >= BOUNTY_MAX_ATTEMPTS) return 0;
  return Math.max(0, BOUNTY_REFILL_MS - (Date.now() - b.lastRefill));
}
// Spend one attempt (win OR loss consumes it). Returns false if none available. Spending from a FULL pool
// starts the refill clock from now.
export function spendAttempt() {
  const b = refillAttempts();
  if (b.attempts <= 0) return false;
  const wasFull = b.attempts >= BOUNTY_MAX_ATTEMPTS;
  b.attempts -= 1;
  if (wasFull) b.lastRefill = Date.now();
  return true;
}

// Progression gate: a slot opens once the player's frontier reaches its band start (R1 from the start;
// R2/R3/R4/R5 at frontier 51/101/151/201).
export const slotUnlocked = (i) => S().frontier >= slotUnlockFloor(i);

// The day's five bounty definitions (for display) and a battle encounter (for a fight).
export const dailyBounties = () => Array.from({ length: BOUNTY_SLOTS }, (_, i) => buildBounty(i, bountyDayKey()));
export const bountyEncounter = (i) => buildBountyEncounter(i, bountyDayKey());

// Grant a bounty's reward spec (primeval stones + Immortal Essence + the target's path resources).
export function grantBountyRewards(rewards) {
  if (!rewards) return;
  if (rewards.stones) addStones(rewards.stones);
  if (rewards.essence) addEssence(rewards.essence);
  if (rewards.drops) applyDrops(rewards.drops);
}
