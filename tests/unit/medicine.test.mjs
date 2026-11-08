import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const S = require('../../dist-electron/shared/schedule.js');
const R = require('../../dist-electron/shared/reminders.js');
const { DEFAULT_SETTINGS, withReminderAdded, withReminderRemoved, withReminderPatch, sanitizeSettings } = require('../../dist-electron/shared/settings.js');

// Monday 9 November 2026, local time.
const t = (h, m = 0, day = 9) => new Date(2026, 10, day, h, m).getTime();
const med = (patch = {}) => ({ ...R.REMINDER_TYPES.medicine.create('m1'), times: ['08:00', '20:00'], ...patch });
const next = (r, now, after, doneTimes = []) => S.nextDoseTime(r, { now, doneToday: doneTimes.length, doneTimes, after });

test('defaults: noon daily, remind again every 10 minutes up to 3 times; it wakes the companion and goes first', () => {
  const m = R.REMINDER_TYPES.medicine.create('m1');
  assert.deepEqual([m.times, m.repeatEveryMinutes, m.repeatTimes], [['12:00'], 10, 3]);
  const def = R.REMINDER_TYPES.medicine;
  assert.equal(def.duringRelax, 'wake');
  assert.ok(def.priority > R.REMINDER_TYPES.water.priority);
  assert.equal(def.prop, 'pillBottle');
  assert.equal(def.doneScript, 'tookMedicine');
  assert.equal(def.describe({ ...m, dose: '2 capsules', notes: 'with food' }), '2 capsules · with food');
});

test('the next dose, today or tomorrow', () => {
  assert.equal(next(med(), t(7), 'start'), t(8));
  assert.equal(next(med(), t(12), 'settings', [t(8, 2)]), t(20));
  assert.equal(next(med(), t(21), 'done', [t(8), t(20, 5)]), t(8, 0, 10));
});

test('missed: reminded again every 10 minutes, 3 times, then the next dose', () => {
  const r = med();
  assert.equal(next(r, t(8, 3), 'missed'), t(8, 10));
  assert.equal(next(r, t(8, 10), 'missed'), t(8, 20));
  assert.equal(next(r, t(8, 20), 'missed'), t(8, 30));
  assert.equal(next(r, t(8, 30), 'missed'), t(20), 'gives up after 3 repeats');
});

test('taken: no more repeats; taken up to an hour early counts', () => {
  assert.equal(next(med(), t(8, 4), 'done', [t(8, 4)]), t(20));
  assert.equal(next(med(), t(7, 30), 'done', [t(7, 30)]), t(20), 'the 08:00 dose was taken at 07:30');
  assert.equal(next(med(), t(8, 15), 'missed', [t(8, 12)]), t(20), 'taken from somewhere else: no repeat');
});

test('✕ skips that dose; later snoozes; repeats can be turned off', () => {
  assert.equal(next(med(), t(8, 3), 'skip'), t(20));
  assert.equal(next(med(), t(8, 3), 'later'), t(8, 13));
  assert.equal(next(med({ repeatTimes: 0 }), t(8, 3), 'missed'), t(20));
});

test('opening the app with a dose overdue (within the repeat window) nudges a minute later', () => {
  assert.equal(next(med(), t(8, 5), 'start'), t(8, 6));
  assert.equal(next(med(), t(8, 45), 'start'), t(20), 'too late: wait for the next dose');
});

test('days: only on the chosen weekdays', () => {
  const weekends = med({ times: ['09:00'], days: [0, 6] });
  assert.equal(next(weekends, t(10), 'start'), t(9, 0, 14), 'Monday → Saturday');
  assert.equal(next(med({ days: [] }), t(7), 'start'), null);
  assert.equal(next(med({ enabled: false }), t(7), 'start'), null);
});

test('planning ahead (Android) includes the repeats, then the next doses', () => {
  const r = med();
  const plan = S.planChain((input) => S.nextDoseTime(r, input), { now: t(7), doneToday: 0, doneTimes: [], after: 'start', count: 6 });
  assert.deepEqual(plan.map((p) => p.at), [t(8), t(8, 10), t(8, 20), t(8, 30), t(20), t(20, 10)]);
});

test('settings: add and remove medicine; water stays; values cleaned', () => {
  let s = withReminderAdded(DEFAULT_SETTINGS, 'medicine', 'med-1');
  assert.deepEqual(s.reminders.map((r) => [r.id, r.type]), [['water', 'water'], ['med-1', 'medicine']]);
  assert.equal(withReminderAdded(s, 'water', 'w2'), s, 'only one water reminder');
  assert.equal(withReminderAdded(s, 'medicine', 'med-1'), s, 'ids are unique');
  s = withReminderPatch(s, 'med-1', { times: ['20:00', 'nope', '08:00', '08:00'], days: [1, 9, 1], repeatTimes: 99, dose: ' 2 tablets ' });
  const m = s.reminders[1];
  assert.deepEqual(m.times, ['08:00', '20:00']);
  assert.deepEqual(m.days, [1]);
  assert.equal(m.repeatTimes, 6);
  assert.equal(m.dose, '2 tablets');
  assert.equal(withReminderRemoved(s, 'water'), s, "water can't be deleted");
  assert.deepEqual(withReminderRemoved(s, 'med-1').reminders.map((r) => r.id), ['water']);
  assert.deepEqual(sanitizeSettings({ reminders: [{ id: 'water', type: 'water' }, { id: 'x', type: 'medicine', times: [] }] }).reminders[1].times, ['12:00'], 'at least one time');
});

test("Android's notification plan: frequent water can't crowd out tomorrow's medicine", () => {
  const water = Array.from({ length: 10 }, (_, i) => ({ at: t(10) + i * 45 * 60_000, snoozed: false, id: 'w' }));
  const medicine = [t(12, 0, 10), t(12, 10, 10), t(12, 20, 10), t(12, 30, 10), t(12, 0, 11)].map((at) => ({ at, snoozed: false, id: 'm' }));
  const plan = S.mergePlans([water, medicine], 8, [2, 4]);
  assert.equal(plan.length, 8);
  assert.equal(plan.filter((p) => p.id === 'm').length, 4, "the next dose and its repeats are always in");
  assert.deepEqual(plan.map((p) => p.at), [...plan.map((p) => p.at)].sort((a, b) => a - b), 'in time order');
  assert.deepEqual(S.mergePlans([water], 8, [2]).map((p) => p.at), water.slice(0, 8).map((p) => p.at), 'one reminder: just the soonest');
});

test("Today's checklist: taken (with the time), due, missed, upcoming; and which dose 'Took it' counts for", () => {
  const r = med({ times: ['08:00', '13:00', '20:00'] });
  const doses = S.dosesToday(r, [t(8, 6)], t(13, 10));
  assert.deepEqual(doses.map((d) => [d.state, d.takenAt]), [['taken', t(8, 6)], ['due', null], ['upcoming', null]]);
  assert.equal(S.doseToTake(doses, t(13, 10)).at, t(13));
  const later = S.dosesToday(r, [t(8, 6)], t(15));
  assert.deepEqual(later.map((d) => d.state), ['taken', 'missed', 'upcoming']);
  assert.equal(S.doseToTake(later, t(15)).at, t(13), 'a missed dose can still be marked');
  assert.equal(S.doseToTake(later, t(19, 30)).at, t(20), 'the next one, from an hour before');
  assert.deepEqual(S.dosesToday(med({ enabled: false }), [], t(9)), []);
});
