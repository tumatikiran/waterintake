import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const R = require('../../dist-electron/shared/reminders.js');
const { DEFAULT_SETTINGS, withReminderAdded, withReminderRemoved, sanitizeSettings } = require('../../dist-electron/shared/settings.js');

const t = (h, m = 0, day = 9) => new Date(2026, 10, day, h, m).getTime(); // Monday
const input = (now, after = 'start') => ({ now, doneToday: 0, doneTimes: [], after });

test('every type is complete: defaults survive sanitizing, it schedules, it has wording, a prop and a done script', () => {
  for (const [id, def] of Object.entries(R.REMINDER_TYPES)) {
    const r = def.create(def.singleton ? id : `${id}-1`);
    assert.equal(r.type, id);
    assert.deepEqual(def.sanitize(structuredClone(r), r.id), r, `${id}: create → sanitize is stable`);
    const next = def.next(r, input(t(10)));
    assert.ok(typeof next === 'number' && next > t(10), `${id}: schedules something`);
    assert.ok(def.labels.done && def.labels.later && def.labels.notifyDone && def.labels.notifyLater, `${id}: labels`);
    assert.ok(def.notification(r, { userName: '', snoozed: false }).body, `${id}: notification text`);
    assert.ok(['wait', 'wake'].includes(def.duringRelax(r)), `${id}: relax policy`);
    assert.ok(def.blurb && def.icon && def.label, `${id}: menu text`);
    if (def.prop === 'sign') assert.ok(R.signFor(r).text, `${id}: its sign says something`);
  }
});

test('eye rest and movement come every N minutes inside active hours, and wait while relaxing', () => {
  const eyes = R.REMINDER_TYPES.eyeRest.create('eyeRest');
  assert.equal(R.nextTime(eyes, input(t(10))), t(10, 20), 'the 20-20-20 rule');
  assert.equal(R.nextTime(eyes, input(t(20, 50))), t(9, 0, 10), 'tomorrow morning, after active hours');
  const move = R.REMINDER_TYPES.movement.create('movement');
  assert.equal(R.nextTime(move, input(t(10))), t(11));
  assert.equal(R.waitsDuringRelax(eyes), true);
  assert.equal(R.waitsDuringRelax(move), true);
  assert.equal(R.REMINDER_TYPES.movement.prop, 'dumbbell');
});

test('to-dos come at their times, show their title on a sign, and wake the companion', () => {
  const todo = { ...R.REMINDER_TYPES.todo.create('t1'), name: 'Water the plants', times: ['18:30'] };
  assert.equal(R.nextTime(todo, input(t(10))), t(18, 30));
  assert.deepEqual(R.signFor(todo), { emoji: '✅', text: 'Water the plants' });
  assert.equal(R.waitsDuringRelax(todo), false);
  assert.equal(R.isTimed(todo), true);
});

test('custom: your emoji and title; every N minutes or at set times (which decides relax and the checklist)', () => {
  const every = { ...R.REMINDER_TYPES.custom.create('c1'), name: 'Call mom', emoji: '📞', intervalMinutes: 90 };
  assert.equal(R.nextTime(every, input(t(10))), t(11, 30));
  assert.equal(R.waitsDuringRelax(every), true);
  assert.equal(R.isTimed(every), false);
  const timed = { ...every, scheduleKind: 'times', times: ['19:00'] };
  assert.equal(R.nextTime(timed, input(t(10))), t(19));
  assert.equal(R.waitsDuringRelax(timed), false);
  assert.equal(R.isTimed(timed), true);
  assert.deepEqual(R.signFor(timed), { emoji: '📞', text: 'Call mom' });
  assert.equal(R.sceneReminder(timed).emoji, '📞');
  const clean = R.REMINDER_TYPES.custom.sanitize({ emoji: '   ', scheduleKind: 'never', name: '' }, 'c2');
  assert.deepEqual([clean.emoji, clean.scheduleKind, clean.name], ['⭐', 'interval', 'My reminder']);
});

test('adding: eye rest and movement at most once (with their own id); others as many as you like; water stays', () => {
  let s = withReminderAdded(DEFAULT_SETTINGS, 'eyeRest', 'whatever');
  assert.deepEqual(s.reminders.map((r) => r.id), ['water', 'eyeRest']);
  assert.equal(withReminderAdded(s, 'eyeRest', 'again'), s);
  s = withReminderAdded(withReminderAdded(s, 'todo', 'todo-1'), 'todo', 'todo-2');
  assert.deepEqual(s.reminders.map((r) => r.id), ['water', 'eyeRest', 'todo-1', 'todo-2']);
  assert.deepEqual(withReminderRemoved(s, 'eyeRest').reminders.map((r) => r.id), ['water', 'todo-1', 'todo-2'], 'singletons can be deleted');
  assert.equal(withReminderRemoved(s, 'water'), s, 'water is built in');
  const stored = sanitizeSettings(JSON.parse(JSON.stringify(s)));
  assert.deepEqual(stored.reminders, s.reminders, 'survives a save and load');
});

test('priority: medicine first, then to-dos, custom, movement, eye rest, water', () => {
  const order = Object.values(R.REMINDER_TYPES).sort((a, b) => b.priority - a.priority).map((d) => d.id);
  assert.deepEqual(order, ['medicine', 'todo', 'custom', 'movement', 'eyeRest', 'water']);
});
