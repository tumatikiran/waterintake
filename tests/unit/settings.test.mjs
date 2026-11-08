import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeSettings, mergeSettings, DEFAULT_SETTINGS } = require('../../dist-electron/shared/settings.js');

test('garbage in, defaults out', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings({ reminders: 'nope' }), DEFAULT_SETTINGS);
});

test('values are clamped and cleaned', () => {
  const s = sanitizeSettings({
    userName: '   Kiran   ',
    reminders: {
      intervalMinutes: 10_000,
      dailyGoal: -3,
      snoozeMinutes: 7.6,
      mode: 'sometimes',
      schedule: [
        { days: [5, 1, 1, 9, 'x'], start: '08:00', end: '18:30' },
        { days: [0], start: '25:00', end: '10:00' },
      ],
    },
    characterId: '../../etc/passwd',
  });
  assert.equal(s.userName, 'Kiran');
  assert.equal(s.reminders.intervalMinutes, 240);
  assert.equal(s.reminders.dailyGoal, 1);
  assert.equal(s.reminders.snoozeMinutes, 8);
  assert.equal(s.reminders.mode, 'fixed');
  assert.deepEqual(s.reminders.schedule, [{ days: [1, 5], start: '08:00', end: '18:30' }]);
  assert.equal(s.characterId, 'default');
});

test('an empty schedule falls back to the default window', () => {
  assert.deepEqual(sanitizeSettings({ reminders: { schedule: [] } }).reminders.schedule, DEFAULT_SETTINGS.reminders.schedule);
});

test('mergeSettings applies a partial update', () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, { reminders: { dailyGoal: 10 }, userName: 'Sam' });
  assert.equal(merged.reminders.dailyGoal, 10);
  assert.equal(merged.reminders.intervalMinutes, DEFAULT_SETTINGS.reminders.intervalMinutes);
  assert.equal(merged.userName, 'Sam');
});

test('"When your companion leaves": one path for every exit, and walk or run', () => {
  const d = DEFAULT_SETTINGS.reminders;
  assert.deepEqual([d.exitPath, d.exitGait], ['across', 'walk']);
  const set = sanitizeSettings({ reminders: { exitPath: 'back', exitGait: 'run' } }).reminders;
  assert.deepEqual([set.exitPath, set.exitGait], ['back', 'run']);
  const bad = sanitizeSettings({ reminders: { exitPath: 'sideways', exitGait: 'fly' } }).reminders;
  assert.deepEqual([bad.exitPath, bad.exitGait], ['across', 'walk']);
  const empty = sanitizeSettings({ reminders: {} }).reminders;
  assert.deepEqual([empty.exitPath, empty.exitGait], ['across', 'walk'], 'older settings files get the defaults');
  assert.equal(sanitizeSettings({ reminders: { laterExit: 'back' } }).reminders.exitPath, 'back', 'the old Drink Later choice carries over');
  assert.equal('laterExit' in sanitizeSettings({ reminders: { laterExit: 'back' } }).reminders, false, 'and the old key is dropped');
});
