// Shared DAILY / WEEKLY reset boundaries — the single source of truth for when day-bound and week-bound
// content rolls over. Everything resets at LOCAL midnight (00:00 the player's local time): there is no
// separate server clock, so "daily" means the player's calendar day. Daily Quests (quests.js) and the
// Bounty roster (systems/bounties.js) derive their day key from here, and the Arena ranking rewards gate
// their claims off the same helpers — so all day-bound content turns over together at 00:00.
//
// The WEEKLY boundary is pinned to the START of the local week (Monday 00:00, ISO-8601 week start). Because
// that is itself a local-midnight instant, the weekly reset always lands on one of the daily-reset
// boundaries — keeping the weekly arena reward in lockstep with the daily reset rather than drifting on an
// epoch-anchored 7-day clock. DOM-free and state-free → safe to import anywhere (systems, ui, headless).

const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_START_DOW = 1; // 1 = Monday (JS Date.getDay(): 0 = Sunday … 6 = Saturday)

// Local calendar-day key, e.g. '2026-06-14'. The canonical daily boundary; identical in shape + value to
// the legacy quests.today() / bounties.bountyDayKey() so swapping callers over changes nothing.
export function dayKey(t = Date.now()) {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
// Whether a stored timestamp falls in the CURRENT local calendar day (the daily-claim window). A falsy
// `last` (never claimed) reads as "not today" → claimable now.
export const sameLocalDay = (last, now = Date.now()) => !!last && dayKey(last) === dayKey(now);

// Timestamp of the start of the local week (the most recent Monday at 00:00 local) containing `t`.
export function weekStartMs(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);                                 // local midnight of t's own day
  const back = (d.getDay() - WEEK_START_DOW + 7) % 7;     // days since this week's Monday
  d.setDate(d.getDate() - back);                          // step back to Monday (DST-safe via Date math)
  return d.getTime();
}
// Whether a stored timestamp falls in the CURRENT local week (Mon 00:00 → next Mon 00:00).
export const sameLocalWeek = (last, now = Date.now()) => !!last && weekStartMs(last) === weekStartMs(now);

// Milliseconds until the next reset, for "resets in …" countdown labels.
export function msToNextDay(t = Date.now()) {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime() - t;
}
export function msToNextWeek(t = Date.now()) {
  // Next week's Monday 00:00: re-derive from a point safely inside next week (avoids DST drift from +7×DAY).
  return weekStartMs(weekStartMs(t) + 7 * DAY_MS + DAY_MS) - t;
}
