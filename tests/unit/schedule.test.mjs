// Unit tests for the pure scheduling logic. Run with `npm run test:unit` (after a build).
process.env.TZ = 'UTC'; // deterministic local time on every machine
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../../dist-electron/shared/schedule.js');
const { DEFAULT_SETTINGS } = require('../../dist-electron/shared/settings.js');

const MIN = 60_000;
// 2026-11-06 is a Friday, 2026-11-09 a Monday.
const t = (d, hh, mm = 0) => new Date(2026, 10, d, hh, mm).getTime();
const reminders = (patch = {}) => ({ ...structuredClone(DEFAULT_SETTINGS.reminders), ...patch });
const every = { days: [0, 1, 2, 3, 4, 5, 6], start: '09:00', end: '21:00' };
const weekdays = { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00' };
const night = { days: [0, 1, 2, 3, 4, 5, 6], start: '22:00', end: '06:00' };

test('calendar sanity', () => {
  assert.equal(new Date(t(6, 12)).getDay(), 5);
  assert.equal(new Date(t(9, 12)).getDay(), 1);
});

test('parseTime', () => {
  assert.equal(S.parseTime('09:30'), 570);
  assert.equal(S.parseTime('0:05'), 5);
  assert.equal(S.parseTime('24:00'), null);
  assert.equal(S.parseTime('12:60'), null);
  assert.equal(S.parseTime('noon'), null);
});

test('activeWindowAt: normal, overnight and all-day windows', () => {
  assert.ok(S.activeWindowAt([every], t(6, 9)));
  assert.equal(S.activeWindowAt([every], t(6, 21)), null, 'end is exclusive');
  assert.equal(S.activeWindowAt([every], t(6, 8, 59)), null);
  assert.ok(S.activeWindowAt([night], t(6, 23)), 'late evening');
  assert.ok(S.activeWindowAt([night], t(7, 5, 30)), 'early morning belongs to the window that started yesterday');
  assert.equal(S.activeWindowAt([night], t(7, 6)), null);
  assert.ok(S.activeWindowAt([{ days: [5], start: '00:00', end: '00:00' }], t(6, 23, 59)), 'equal times = all day');
});

test('nextWindowStart skips days that are not selected', () => {
  assert.equal(S.nextWindowStart([weekdays], t(6, 18)), t(9, 9), 'Friday evening → Monday 09:00');
  assert.equal(S.nextWindowStart([every], t(6, 8)), t(6, 9));
  assert.equal(S.nextWindowStart([{ days: [], start: '09:00', end: '17:00' }], t(6, 8)), null);
});

test('fixed interval inside the window', () => {
  const next = S.nextReminderTime({ settings: reminders(), now: t(6, 10), glassesToday: 0, after: 'drank' });
  assert.equal(next, t(6, 10, 45));
});

test('a reminder that would land after hours moves to the next window', () => {
  const next = S.nextReminderTime({ settings: reminders(), now: t(6, 20, 30), glassesToday: 3, after: 'skip' });
  assert.equal(next, t(7, 9));
});

test('Drink Later snoozes for snoozeMinutes', () => {
  const next = S.nextReminderTime({ settings: reminders({ snoozeMinutes: 10 }), now: t(6, 12), glassesToday: 0, after: 'later' });
  assert.equal(next, t(6, 12, 10));
});

test('disabled reminders never fire', () => {
  assert.equal(S.nextReminderTime({ settings: reminders({ enabled: false }), now: t(6, 12), glassesToday: 0, after: 'start' }), null);
});

test('goal mode spreads the remaining glasses over the remaining active time', () => {
  const settings = reminders({ mode: 'goal', dailyGoal: 8 });
  // 09:00–21:00 is 720 minutes; 8 glasses → every 90 minutes.
  assert.equal(S.nextReminderTime({ settings, now: t(6, 9), glassesToday: 0, after: 'start' }), t(6, 10, 30));
  // Behind schedule at 15:00 with 6 left: 360 / 6 = 60 minutes.
  assert.equal(S.nextReminderTime({ settings, now: t(6, 15), glassesToday: 2, after: 'drank' }), t(6, 16));
  // Never more often than every 20 minutes.
  assert.equal(S.reminderInterval(settings, 0, t(6, 20, 30)), 20);
  // Never less often than every 180 minutes.
  assert.equal(S.reminderInterval(reminders({ mode: 'goal', dailyGoal: 1 }), 0, t(6, 9)), 180);
});

test('goal reached: stop until tomorrow, or keep the fixed interval', () => {
  const stop = reminders({ mode: 'goal', dailyGoal: 4, stopWhenGoalReached: true });
  assert.equal(S.nextReminderTime({ settings: stop, now: t(6, 14), glassesToday: 4, after: 'drank' }), t(7, 9));
  const keepGoing = reminders({ mode: 'goal', dailyGoal: 4, intervalMinutes: 60 });
  assert.equal(S.nextReminderTime({ settings: keepGoing, now: t(6, 14), glassesToday: 5, after: 'drank' }), t(6, 15));
});

test('resume after a pause nudges a minute later', () => {
  assert.equal(S.nextReminderTime({ settings: reminders(), now: t(6, 11), glassesToday: 0, after: 'resume' }), t(6, 11, 1));
});

test('remainingActiveMinutesToday counts overnight windows up to midnight', () => {
  assert.equal(S.remainingActiveMinutesToday([every], t(6, 20)), 60);
  assert.equal(S.remainingActiveMinutesToday([night], t(6, 23)), 60);
  assert.equal(S.remainingActiveMinutesToday([night], t(7, 3)), 3 * 60 + 2 * 60, '03:00–06:00 plus 22:00–24:00');
  assert.equal(S.remainingActiveMinutesToday([every], t(6, 22)), 0);
  void MIN;
});

test('planReminders lists the next reminders (Android schedules them ahead)', () => {
  const plan = S.planReminders({ settings: reminders(), now: t(6, 10), glassesToday: 0, after: 'drank', count: 4 });
  assert.deepEqual(plan.map((p) => p.at), [t(6, 10, 45), t(6, 11, 30), t(6, 12, 15), t(6, 13)]);
  assert.ok(plan.every((p) => !p.snoozed));
});

test('planReminders continues into the next active window', () => {
  const plan = S.planReminders({ settings: reminders({ intervalMinutes: 60 }), now: t(6, 19, 30), glassesToday: 2, after: 'skip', count: 3 });
  assert.deepEqual(plan.map((p) => p.at), [t(6, 20, 30), t(7, 9), t(7, 10)]);
});

test('planReminders: a snooze comes first, then the normal rhythm', () => {
  const plan = S.planReminders({ settings: reminders(), now: t(6, 12), glassesToday: 1, after: 'later', count: 2 });
  assert.deepEqual(plan, [
    { at: t(6, 12, 15), snoozed: true },
    { at: t(6, 13), snoozed: false },
  ]);
});

test('planReminders: while paused, start a minute after the pause ends', () => {
  const plan = S.planReminders({ settings: reminders(), now: t(6, 12), glassesToday: 1, after: 'start', count: 1, pausedUntil: t(6, 13) });
  assert.equal(plan[0].at, t(6, 13, 1));
});

test('planReminders: goal mode resets the count on the next day', () => {
  const settings = reminders({ mode: 'goal', dailyGoal: 4, stopWhenGoalReached: true });
  const plan = S.planReminders({ settings, now: t(6, 15), glassesToday: 4, after: 'drank', count: 2 });
  assert.equal(plan[0].at, t(7, 9), 'goal met: tomorrow');
  assert.equal(plan[1].at, t(7, 12), 'tomorrow the 4 glasses are spread over 720 minutes (capped at 180)');
});
