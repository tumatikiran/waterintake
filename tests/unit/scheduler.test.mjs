import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { ReminderScheduler } = require('../../dist-electron/main/scheduler.js');
const { REMINDER_TYPES } = require('../../dist-electron/shared/reminders.js');

const MIN = 60_000;
const t0 = new Date(2026, 10, 9, 10, 0).getTime(); // a Monday, inside the default 09:00–21:00 window
const allDay = [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' }];
const water = (id, minutes) => ({ ...REMINDER_TYPES.water.create(id), id, intervalMinutes: minutes, schedule: allDay });

function setup(reminders, { busy = () => false } = {}) {
  let now = t0;
  const fired = [];
  const s = new ReminderScheduler({
    reminders: () => reminders,
    doneToday: () => 0,
    pauseWhenAway: () => false,
    isUserAway: () => false,
    isBusy: busy,
    fire: (r, reason) => fired.push([r.id, reason]),
    changed: () => {},
    now: () => now,
  });
  s.sync('start');
  return { s, fired, at: (m) => (now = t0 + m * MIN) };
}

test('each reminder keeps its own next time; the soonest is the overall next', () => {
  const { s } = setup([water('a', 45), water('b', 20)]);
  assert.equal(s.nextFor('a'), t0 + 45 * MIN);
  assert.equal(s.nextFor('b'), t0 + 20 * MIN);
  assert.equal(s.nextAt, t0 + 20 * MIN);
});

test('two due at once are shown one after the other, the earlier first', () => {
  const { s, fired, at } = setup([water('a', 30), water('b', 20)]);
  at(31);
  s.tick();
  assert.deepEqual(fired, [['b', 'scheduled']]);
  s.tick();
  assert.equal(fired.length, 1, 'waits for the answer to the one on screen');
  s.reschedule('b', 'done');
  s.tick();
  assert.deepEqual(fired, [['b', 'scheduled'], ['a', 'scheduled']]);
});

test('a reminder that must wait (e.g. water during Relax mode) doesn’t hold up the others', () => {
  const { s, fired, at } = setup([water('a', 20), water('b', 30)], { busy: (r) => r.id === 'a' });
  at(31);
  s.tick();
  assert.deepEqual(fired, [['b', 'scheduled']]);
});

test('answering reschedules only that reminder; a snooze marks it as snoozed', () => {
  const { s, fired, at } = setup([water('a', 20), water('b', 60)]);
  at(21);
  s.tick();
  s.reschedule('a', 'later');
  assert.equal(s.nextFor('a'), t0 + 21 * MIN + 15 * MIN);
  assert.equal(s.nextFor('b'), t0 + 60 * MIN, 'the other one is untouched');
  at(37);
  s.tick();
  assert.deepEqual(fired.at(-1), ['a', 'snoozed']);
});

test('removed reminders are forgotten on sync', () => {
  const list = [water('a', 20), water('b', 30)];
  const { s } = setup(list);
  list.pop();
  s.sync();
  assert.equal(s.nextFor('b'), null);
  assert.equal(s.nextAt, t0 + 20 * MIN);
});
