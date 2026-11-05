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

test('daily count resets at midnight', () => {
  const day1 = new Date(2026, 10, 6, 23, 50).getTime();
  const day2 = new Date(2026, 10, 7, 0, 5).getTime();
  let d = D.sanitizeDaily(null);
  d = D.withGlass(d, day1);
  d = D.withGlass(d, day1);
  d = D.withReminderShown(d, day1);
  assert.deepEqual(D.dayOf(d, day1), { date: '2026-11-06', glasses: 2, reminders: 1 });
  assert.deepEqual(D.dayOf(d, day2), { date: '2026-11-07', glasses: 0, reminders: 0 });
  assert.equal(D.withGlass(d, day2).glasses, 1);
});
