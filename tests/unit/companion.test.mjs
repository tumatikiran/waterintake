import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../../dist-electron/shared/companion.js');

/** Plays a list of events from a state; returns every transition. */
function play(place, state, events) {
  const out = [];
  for (const e of events) {
    const t = M.companionStep(place, state, typeof e === 'string' ? { type: e } : e);
    out.push(t);
    state = t.state;
  }
  return out;
}
const last = (ts) => ts[ts.length - 1];

test('overlay reminder: walks in, waits, answers, leaves', () => {
  const ts = play('overlay', M.OFFSTAGE, ['remind', 'done', { type: 'answer', kind: 'drank' }, 'done']);
  assert.deepEqual(ts[0].scripts, ['arrive']);
  assert.equal(ts[1].ignored, true, 'arrived: keeps waiting for an answer');
  assert.deepEqual(ts[2].scripts, ['drank']);
  assert.equal(last(ts).finish, true);
  assert.equal(last(ts).state.mode, 'offstage');
});

test('Relax: settle, rest (doze timer), doze off, wake from sleep with a stretch, leave', () => {
  const ts = play('overlay', M.OFFSTAGE, ['relaxOn', 'seated', 'done', 'doze', 'relaxOff', 'done']);
  assert.deepEqual(ts[0].scripts, ['relax']);
  assert.equal(ts[1].state.seated, true);
  assert.deepEqual(ts[1].scripts, [], 'sitting down is part of the running script');
  assert.equal(ts[2].state.mode, 'resting');
  assert.equal(ts[2].dozeTimer, true);
  assert.deepEqual(ts[3].scripts, ['doze']);
  assert.equal(ts[3].state.mode, 'sleeping');
  assert.deepEqual(ts[4].scripts, ['wakeFromSleep']);
  assert.equal(last(ts).finish, true);
});

test('Relax off: resting gets up; before sitting down it just leaves', () => {
  assert.deepEqual(last(play('overlay', M.OFFSTAGE, ['relaxOn', 'seated', 'done', 'relaxOff'])).scripts, ['wake']);
  assert.deepEqual(last(play('overlay', M.OFFSTAGE, ['relaxOn', 'relaxOff'])).scripts, ['skip']);
});

test('a reminder during Relax: gets up (stretching first if asleep) and reminds from there', () => {
  assert.deepEqual(last(play('overlay', M.OFFSTAGE, ['relaxOn', 'remind'])).scripts, ['remindHere']);
  assert.deepEqual(last(play('overlay', M.OFFSTAGE, ['relaxOn', 'seated', 'remind'])).scripts, ['wakeToRemind']);
  assert.deepEqual(last(play('overlay', M.OFFSTAGE, ['relaxOn', 'seated', 'done', 'remind'])).scripts, ['wakeToRemind']);
  const asleep = play('overlay', M.OFFSTAGE, ['relaxOn', 'seated', 'done', 'doze', 'remind']);
  assert.deepEqual(last(asleep).scripts, ['wakeFromSleepToRemind']);
  assert.equal(last(asleep).state.mode, 'reminding');
});

test('nothing interrupts a reminder or a companion that is leaving', () => {
  for (const e of ['relaxOn', 'remind', 'doze', 'relaxOff']) {
    assert.equal(last(play('overlay', M.OFFSTAGE, ['remind', e])).ignored, true, `reminding ignores ${e}`);
  }
  const leaving = play('overlay', M.OFFSTAGE, ['relaxOn', 'seated', 'done', 'relaxOff']);
  assert.equal(M.companionStep('overlay', last(leaving).state, { type: 'remind' }).ignored, true);
  assert.equal(M.companionStep('overlay', M.OFFSTAGE, { type: 'doze' }).ignored, true, 'no dozing off-stage');
});

test('Today screen: idle, poke, drink, relax and wake', () => {
  assert.deepEqual(M.companionStep('home', M.IDLE, { type: 'enter', relaxing: false }).scripts, ['homeIdle']);
  const seatedEntry = M.companionStep('home', M.IDLE, { type: 'enter', relaxing: true });
  assert.deepEqual(seatedEntry.scripts, ['homeSeated'], 'opening Today while relaxing: already sitting');
  assert.equal(seatedEntry.state.mode, 'resting');
  assert.equal(seatedEntry.dozeTimer, true);
  assert.deepEqual(last(play('home', M.IDLE, ['poke'])).scripts, ['homePoke']);
  assert.equal(last(play('home', M.IDLE, ['poke', 'poke'])).ignored, true, 'no poke while busy');
  assert.equal(last(play('home', M.IDLE, ['poke', 'done'])).state.mode, 'idle');
  assert.deepEqual(last(play('home', M.IDLE, ['relaxOn', 'seated', 'done', 'relaxOff'])).scripts, ['homeWake']);
  assert.deepEqual(last(play('home', M.IDLE, ['relaxOn', 'seated', 'done', 'doze', 'relaxOff'])).scripts, ['homeWakeFromSleep']);
  assert.equal(last(play('home', M.IDLE, ['relaxOn', 'seated', 'done', 'relaxOff', 'done'])).state.mode, 'idle', 'stays on the Today screen');
});

test('Today screen: tapping or logging a glass while relaxing ends Relax mode', () => {
  const tap = last(play('home', M.IDLE, ['relaxOn', 'seated', 'done', 'poke']));
  assert.equal(tap.endsRelax, true);
  assert.equal(tap.ignored, true, 'the wake-up comes with Relax mode turning off');
  const drink = last(play('home', M.IDLE, ['relaxOn', 'seated', 'done', 'drink']));
  assert.deepEqual(drink.scripts, ['homeStandUp', 'homeDrink']);
  assert.equal(drink.endsRelax, true);
  const sleepyDrink = last(play('home', M.IDLE, ['relaxOn', 'seated', 'done', 'doze', 'drink']));
  assert.deepEqual(sleepyDrink.scripts, ['homeStretchUp', 'homeDrink']);
  assert.equal(M.companionStep('home', drink.state, { type: 'relaxOff' }).ignored, true, 'already up when Relax mode turns off');
});

test('isRelaxing covers settling, resting and sleeping only', () => {
  const modes = ['offstage', 'idle', 'acting', 'reminding', 'answering', 'settling', 'resting', 'sleeping', 'waking'];
  assert.deepEqual(
    modes.filter((mode) => M.isRelaxing({ mode, seated: false })),
    ['settling', 'resting', 'sleeping'],
  );
});
