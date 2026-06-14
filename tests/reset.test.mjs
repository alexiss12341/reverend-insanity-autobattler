// Shared daily/weekly reset boundaries (systems/reset.js) — the single source of truth that keeps the
// arena ranking rewards turning over together with daily quests + bounties.
import { ok, section } from './assert.mjs';
import { dayKey, sameLocalDay, sameLocalWeek, weekStartMs, msToNextDay, msToNextWeek, WEEK_START_DOW } from '../src/systems/reset.js';
import { bountyDayKey } from '../src/systems/bounties.js';

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

section('reset: daily boundary (local calendar day)');
ok(/^\d{4}-\d{2}-\d{2}$/.test(dayKey(now)), 'dayKey is a YYYY-MM-DD local-day key');
ok(dayKey() === bountyDayKey(), 'the bounty roster + arena claims share the SAME day key (synced)');
ok(sameLocalDay(now, now), 'a timestamp is in its own day');
ok(!sameLocalDay(0), 'a never-claimed (falsy) stamp is NOT "today" → claimable');
ok(!sameLocalDay(now - 2 * DAY, now), 'two days ago is a different local day');
ok(msToNextDay(now) > 0 && msToNextDay(now) <= DAY, 'ms-to-next-day is within (0, 24h]');

section('reset: weekly boundary (local week, Mon 00:00)');
const ws = weekStartMs(now);
ok(new Date(ws).getDay() === WEEK_START_DOW, 'the week starts on Monday (getDay === 1)');
ok(new Date(ws).getHours() === 0 && new Date(ws).getMinutes() === 0 && new Date(ws).getSeconds() === 0,
  'the week start is a local-MIDNIGHT instant → it IS a daily-reset boundary (no drift)');
ok(sameLocalWeek(ws + 3 * DAY, ws), 'a day mid-week is the same week as its Monday');
ok(!sameLocalWeek(ws - 1, ws), 'one ms before Monday 00:00 belongs to the PREVIOUS week');
ok(!sameLocalWeek(0), 'a never-claimed (falsy) stamp is NOT "this week" → claimable');
ok(msToNextWeek(now) > 0 && msToNextWeek(now) <= 7 * DAY, 'ms-to-next-week is within (0, 7d]');
// the weekly reset instant is exactly a daily reset instant (lockstep with quests/bounties)
const nextWeek = weekStartMs(ws + 8 * DAY);
ok(dayKey(nextWeek) === dayKey(nextWeek) && new Date(nextWeek).getHours() === 0, 'next week also begins at a local 00:00 day boundary');
