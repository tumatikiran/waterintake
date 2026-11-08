import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const C = require('../../dist-electron/shared/characters.js');
const D = require('../../dist-electron/shared/daily.js');

const glb = (length, { magic = 0x46546c67, version = 2, declared = length } = {}) => {
  const b = new Uint8Array(length);
  const v = new DataView(b.buffer);
  v.setUint32(0, magic, true);
  v.setUint32(4, version, true);
  v.setUint32(8, declared, true);
  return b;
};

test('assertGlb accepts complete glTF 2.0 binaries and explains everything else', () => {
  assert.doesNotThrow(() => C.assertGlb(glb(64)));
  assert.throws(() => C.assertGlb(new Uint8Array(4)), /too small/);
  assert.throws(() => C.assertGlb(glb(64, { magic: 0x12345678 })), /not a binary glTF/);
  assert.throws(() => C.assertGlb(glb(64, { version: 1 })), /glTF 2\.0/);
  assert.throws(() => C.assertGlb(glb(64, { declared: 100 })), /truncated/);
});

test('character ids are random, well-formed and validated', () => {
  const a = C.newCharacterId();
  assert.match(a, C.CHARACTER_ID);
  assert.notEqual(a, C.newCharacterId());
  assert.deepEqual(C.sanitizeCharacterIndex([{ id: '../../evil', kind: 'uploaded' }, { id: a, kind: 'builtin' }]), []);
});

test('records: upload names, created revisions, patches', () => {
  assert.equal(C.uploadedRecord(C.newCharacterId(), '/x/y/Robo Buddy.glb').name, 'Robo Buddy');
  const first = C.createdRecord('c_000000000001', { name: '  Mia ', recipe: { hairStyle: 'bun' }, thumbnail: 'nope' });
  assert.equal(first.name, 'Mia');
  assert.equal(first.revision, 1);
  assert.equal(first.thumbnail, undefined, 'only PNG data URLs are kept');
  assert.equal(first.recipe.hairStyle, 'bun');
  const second = C.createdRecord(first.id, { name: 'Mia 2', recipe: {}, thumbnail: undefined }, first);
  assert.equal(second.revision, 2);
  assert.equal(second.createdAt, first.createdAt);
  assert.equal(C.patchRecord(first, { name: '' }).name, 'Mia', 'empty names keep the old one');
});

test("today's log is per reminder and resets at midnight", () => {
  const day1 = new Date(2026, 10, 6, 23, 50).getTime();
  const day2 = new Date(2026, 10, 7, 0, 5).getTime();
  let d = D.sanitizeDaily(null);
  d = D.withDone(d, 'water', day1);
  d = D.withDone(d, 'water', day1);
  d = D.withShown(d, 'water', day1);
  d = D.withShown(d, 'vit-d', day1);
  assert.deepEqual(D.entryOf(d, 'water', day1), { done: 2, shown: 1, times: [day1, day1] });
  assert.equal(D.shownToday(d, day1), 2, 'all kinds count towards "first of the day"');
  assert.deepEqual(D.entryOf(d, 'water', day2), { done: 0, shown: 0, times: [] });
  assert.equal(D.shownToday(d, day2), 0);
  assert.equal(D.entryOf(D.withDone(d, 'water', day2), 'water', day2).done, 1);
});

test("version 1's daily file (glasses only) becomes the water reminder's entry", () => {
  const d = D.sanitizeDaily({ date: '2026-11-06', glasses: 5, reminders: 3 });
  assert.deepEqual(d, { date: '2026-11-06', entries: { water: { done: 5, shown: 3, times: [] } } });
  assert.deepEqual(D.sanitizeDaily({ date: 'x', entries: { '../bad': { done: 1 }, ok: { done: -2, shown: 'a', times: [1, 'b'] } } }).entries, {
    ok: { done: 0, shown: 0, times: [1] },
  });
});

test('body type: male or female, older recipes stay male, two built-in companions', () => {
  assert.equal(C.createdRecord('c_000000000002', { name: 'A', recipe: { body: 'female' } }).recipe.body, 'female');
  assert.equal(C.createdRecord('c_000000000003', { name: 'B', recipe: { body: 'robot' } }).recipe.body, 'male');
  assert.equal(C.createdRecord('c_000000000004', { name: 'C', recipe: { hairStyle: 'long' } }).recipe.body, 'male', 'recipes saved before the option');
  assert.deepEqual(C.BUILTIN_CHARACTERS.map((c) => [c.id, c.name]), [['default', 'Aqua'], ['default-female', 'Marina']]);
  for (const c of C.BUILTIN_CHARACTERS) assert.ok(C.BUILTIN_MODELS[c.id], `${c.name} has a bundled model`);
  assert.equal(C.BUILTIN_CHARACTER.id, 'default', 'Aqua stays the default and the fallback');
  assert.equal(C.createdRecord('c_000000000005', { name: 'D', recipe: { body: 'female', beard: true } }).recipe.beard, false, 'a female body never has a beard');
  assert.equal(C.createdRecord('c_000000000006', { name: 'E', recipe: { body: 'male', beard: true } }).recipe.beard, true);
});

test('switching the body in the creator: matching hairstyle, no beard for female', () => {
  const R = require('../../dist-electron/shared/recipe.js');
  const female = R.withBody({ ...R.DEFAULT_RECIPE, beard: true }, 'female');
  assert.equal(female.body, 'female');
  assert.equal(female.hairStyle, 'long', 'short hair becomes long');
  assert.equal(female.beard, false, 'the beard goes');
  assert.equal(R.withBody({ ...R.DEFAULT_RECIPE, hairStyle: 'bun' }, 'female').hairStyle, 'bun', 'a chosen bun stays');
  assert.equal(R.withBody(R.FEMALE_RECIPE, 'male').hairStyle, 'short', 'long hair becomes short');
  assert.equal(R.withBody({ ...R.FEMALE_RECIPE, hairStyle: 'buzz' }, 'male').hairStyle, 'buzz');
  assert.equal(R.FEMALE_RECIPE.beard, false);
});
