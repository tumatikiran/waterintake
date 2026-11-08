import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { sanitizeSettings, mergeSettings, withReminderPatch, DEFAULT_SETTINGS } = require('../../dist-electron/shared/settings.js');

const water = (s) => s.reminders.find((r) => r.id === 'water');

test('garbage in, defaults out', () => {
  assert.deepEqual(sanitizeSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(sanitizeSettings({ reminders: 'nope' }), DEFAULT_SETTINGS);
  assert.equal(DEFAULT_SETTINGS.version, 2);
  assert.deepEqual(DEFAULT_SETTINGS.reminders.map((r) => [r.id, r.type]), [['water', 'water']]);
});

test('a version 1 file (one water reminder object) upgrades: values clamped and cleaned', () => {
  const s = sanitizeSettings({
    version: 1,
    userName: '   Kiran   ',
    reminders: {
      enabled: false,
      intervalMinutes: 10_000,
      dailyGoal: -3,
      snoozeMinutes: 7.6,
      mode: 'sometimes',
      schedule: [
        { days: [5, 1, 1, 9, 'x'], start: '08:00', end: '18:30' },
        { days: [0], start: '25:00', end: '10:00' },
      ],
      exitPath: 'back',
      exitGait: 'run',
      pauseWhenAway: false,
      systemNotification: true,
    },
    characterId: '../../etc/passwd',
  });
  assert.equal(s.version, 2);
  assert.equal(s.userName, 'Kiran');
  assert.equal(s.reminders.length, 1);
  const w = water(s);
  assert.equal(w.type, 'water');
  assert.equal(w.enabled, false);
  assert.equal(w.intervalMinutes, 240);
  assert.equal(w.dailyGoal, 1);
  assert.equal(w.snoozeMinutes, 8);
  assert.equal(w.mode, 'fixed');
  assert.deepEqual(w.schedule, [{ days: [1, 5], start: '08:00', end: '18:30' }]);
  assert.deepEqual(s.general, { exitPath: 'back', exitGait: 'run', pauseWhenAway: false, systemNotification: true }, 'app-wide choices move to general');
  assert.equal('exitPath' in w, false);
  assert.equal(s.characterId, 'default');
});

test('an empty schedule falls back to the default window', () => {
  assert.deepEqual(water(sanitizeSettings({ reminders: { schedule: [] } })).schedule, water(DEFAULT_SETTINGS).schedule);
});

test('the reminder list: the water reminder always exists, first; unknown types and duplicate ids are dropped', () => {
  const s = sanitizeSettings({
    reminders: [
      { id: 'x1', type: 'teleport' },
      { id: 'water', type: 'water', dailyGoal: 12 },
      { id: 'water', type: 'water', dailyGoal: 3 },
      'nope',
    ],
  });
  assert.deepEqual(s.reminders.map((r) => r.id), ['water']);
  assert.equal(water(s).dailyGoal, 12);
  assert.deepEqual(sanitizeSettings({ reminders: [] }).reminders.map((r) => r.id), ['water'], 'water comes back if missing');
});

test('mergeSettings applies a partial update; withReminderPatch changes one reminder', () => {
  const merged = mergeSettings(DEFAULT_SETTINGS, { userName: 'Sam', general: { exitGait: 'run' } });
  assert.equal(merged.userName, 'Sam');
  assert.deepEqual(merged.general, { ...DEFAULT_SETTINGS.general, exitGait: 'run' });
  assert.deepEqual(merged.reminders, DEFAULT_SETTINGS.reminders);
  const patched = withReminderPatch(merged, 'water', { dailyGoal: 10, id: 'hijack', type: 'other' });
  assert.equal(water(patched).dailyGoal, 10);
  assert.equal(water(patched).intervalMinutes, water(DEFAULT_SETTINGS).intervalMinutes);
  assert.deepEqual(patched.reminders.map((r) => [r.id, r.type]), [['water', 'water']], 'id and type never change');
  assert.equal(withReminderPatch(merged, 'missing', { dailyGoal: 2 }), merged, 'unknown ids change nothing');
  assert.equal(water(withReminderPatch(merged, 'water', { dailyGoal: 999 })).dailyGoal, 30, 'and the values are clamped');
});

test('"When your companion leaves": one path for every exit, and walk or run', () => {
  const d = DEFAULT_SETTINGS.general;
  assert.deepEqual([d.exitPath, d.exitGait], ['across', 'walk']);
  const set = sanitizeSettings({ general: { exitPath: 'back', exitGait: 'run' } }).general;
  assert.deepEqual([set.exitPath, set.exitGait], ['back', 'run']);
  const bad = sanitizeSettings({ general: { exitPath: 'sideways', exitGait: 'fly' } }).general;
  assert.deepEqual([bad.exitPath, bad.exitGait], ['across', 'walk']);
  const empty = sanitizeSettings({ reminders: {} }).general;
  assert.deepEqual([empty.exitPath, empty.exitGait], ['across', 'walk'], 'older settings files get the defaults');
  assert.equal(sanitizeSettings({ reminders: { laterExit: 'back' } }).general.exitPath, 'back', 'the old Drink Later choice carries over');
  assert.equal('laterExit' in sanitizeSettings({ reminders: { laterExit: 'back' } }).general, false, 'and the old key is dropped');
});

test('Relax mode settings: defaults, limits, fractions and partial updates', () => {
  assert.deepEqual(DEFAULT_SETTINGS.relax, { dozeAfterMinutes: 3, durationMinutes: 0 });
  assert.deepEqual(sanitizeSettings({}).relax, { dozeAfterMinutes: 3, durationMinutes: 0 }, 'older files get the defaults');
  assert.deepEqual(sanitizeSettings({ relax: { dozeAfterMinutes: -4, durationMinutes: 9999 } }).relax, { dozeAfterMinutes: 0, durationMinutes: 240 });
  assert.equal(sanitizeSettings({ relax: { dozeAfterMinutes: 0.05 } }).relax.dozeAfterMinutes, 0.05);
  assert.equal(sanitizeSettings({ relax: { dozeAfterMinutes: 'soon' } }).relax.dozeAfterMinutes, 3);
  const merged = mergeSettings(DEFAULT_SETTINGS, { relax: { durationMinutes: 30 } });
  assert.deepEqual(merged.relax, { dozeAfterMinutes: 3, durationMinutes: 30 }, 'a partial update keeps the other value');
});
