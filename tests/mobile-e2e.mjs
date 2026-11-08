/**
 * End-to-end test of the Android app's UI and logic, run in a phone-sized
 * window (tests/mobile-host.cjs) with Capacitor's web fallbacks:
 * Preferences → localStorage, Filesystem → IndexedDB, notifications → HTML5.
 *   npm run test:mobile          (xvfb-run -a npm run test:mobile on headless Linux)
 * Native-only parts (notification channels, action buttons, exact alarms)
 * are exercised on a device; the notification-button path is simulated here.
 */
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const OUT = resolve('test-results');
mkdirSync(OUT, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'aquamate-mobile-'));

const args = [resolve('tests/mobile-host.cjs')];
if (process.env.AQUAMATE_SCREENSHOT_SCALE) args.push(`--force-device-scale-factor=${process.env.AQUAMATE_SCREENSHOT_SCALE}`);
if (process.platform === 'linux') args.push('--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const env = { ...process.env, AQUAMATE_USER_DATA: userData };
delete env.NODE_OPTIONS;

const app = await electron.launch({ executablePath: require('electron'), args, env });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (msg) => console.log(`  • ${msg}`);

try {
  const page = await app.firstWindow();
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(String(e)));

  const state = () => page.evaluate(() => window.aquamate.getState());
  const scene = (name, timeout = 20000) => page.waitForSelector(`[data-testid=stage][data-phase=${name}]`, { timeout });
  const homeAnim = (n, timeout = 10000) => page.waitForFunction((x) => window.__aquamateHomeDebug?.animation === x, n, { timeout });
  const sceneAnim = (n, timeout = 10000) => page.waitForFunction((x) => window.__aquamateDebug?.animation === x, n, { timeout });
  const pending = () =>
    page.evaluate(async () => {
      const { notifications } = await window.Capacitor.Plugins.LocalNotifications.getPending();
      return notifications.map((n) => ({ id: n.id, at: new Date(n.schedule.at).getTime(), body: n.body, actionTypeId: n.actionTypeId }));
    });
  const card = page.getByTestId('reminder-card');
  // The closed scene is visibility:hidden, so wait for the state, not for visibility.
  const sceneClosed = (timeout) => page.waitForSelector('[data-testid=reminder-scene]:not(.is-open)', { state: 'attached', timeout });
  const shot = (name) => page.screenshot({ path: join(OUT, name) });

  // A deterministic schedule: active all day.
  await page.waitForSelector('[data-testid=home-stage]', { timeout: 30000 });
  await page.evaluate(() => window.aquamate.updateSettings({ reminders: { schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' }] } }));

  step("Today screen: the companion idles on stage, empty-handed, with the day's progress");
  await homeAnim('Idle', 30000);
  assert.equal(await page.evaluate(() => window.__aquamateHomeDebug.prop), null, 'no bottle by default');
  let st = await state();
  assert.equal(st.app.mobile, true);
  assert.equal(st.app.notifications, 'granted');
  assert.equal(st.status.glassesToday, 0);
  await page.getByTestId('next-reminder').getByText(/Next reminder/).waitFor();
  assert.equal(await page.getByTestId('permission-card').count(), 0, 'no permission prompt when allowed');
  await sleep(500);
  await shot('m1-today.png');

  step('reminders are scheduled ahead as notifications with action buttons');
  let plan = await pending();
  assert.equal(plan.length, 8);
  assert.deepEqual(plan.map((p) => p.id), [1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007]);
  assert.equal(plan[0].at, st.status.nextReminderAt);
  assert.equal(plan[1].at - plan[0].at, 45 * 60_000, 'every 45 minutes');
  assert.equal(plan[0].actionTypeId, 'AQUAMATE_REMINDER');
  assert.equal(plan[0].body, 'Hey! Time to drink some water 💧');

  step('"I drank a glass" on the Today screen: he drinks along and cheers');
  await page.getByRole('button', { name: 'I drank a glass 💧' }).click();
  await homeAnim('Drink');
  assert.equal(await page.evaluate(() => window.__aquamateHomeDebug.prop), 'waterBottle', 'brings the bottle out to drink');
  await page.getByTestId('home-bubble').getByText('Cheers! 💧').waitFor();
  await sleep(1600);
  await shot('m2-today-drinking.png');
  await page.getByTestId('home-bubble').getByText('Great job! Stay hydrated.').waitFor({ timeout: 10000 });
  await homeAnim('Idle', 10000);
  await page.waitForFunction(() => window.__aquamateHomeDebug.prop === null, null, { timeout: 5000 }); // and puts it away
  st = await state();
  assert.equal(st.status.glassesToday, 1);
  plan = await pending();
  assert.ok(Math.abs(plan[0].at - (Date.now() + 45 * 60_000)) < 60_000, 'the next reminder moved to 45 minutes after the glass');

  step('Remind me now: the reminder scene opens, he walks in and asks');
  await page.getByRole('button', { name: 'Remind me now' }).click();
  await page.waitForSelector('[data-testid=reminder-scene].is-open');
  await scene('arrive');
  await sceneAnim('Walk');
  const a = await page.evaluate(() => window.__aquamateDebug.x);
  await page.waitForFunction((x0) => window.__aquamateDebug.x < x0 - 0.05, a);
  await scene('waiting');
  const d = await page.evaluate(() => window.__aquamateDebug);
  assert.ok(Math.abs(d.x - d.stopX) < 1e-6, 'stops in the middle');
  await card.getByText('Time to drink some water 💧').waitFor();
  await sleep(400);
  await shot('m3-reminder.png');

  step('I Drank Water: drinks from the bottle, celebrates, leaves; the scene closes');
  await card.getByRole('button', { name: 'I Drank Water' }).click();
  await sceneAnim('Drink');
  await sleep(1700);
  await shot('m4-drinking.png');
  await card.getByText('Great job! Stay hydrated.').waitFor({ timeout: 10000 });
  await card.getByText('2 of 8 glasses today').waitFor();
  assert.equal(await card.getByText(/glasses? today/).count(), 1, 'one progress line, no duplicate');
  await sceneClosed(20000);
  assert.equal((await state()).status.glassesToday, 2);

  step('Drink Later: sad sigh, sad walk off to the left, snooze rescheduled');
  await page.getByRole('button', { name: 'Remind me now' }).click();
  await scene('waiting');
  const later = Date.now();
  await card.getByRole('button', { name: 'Drink Later' }).click();
  await card.getByText("Okay… I'll remind you again in 15 minutes.").waitFor();
  await sceneAnim('SadWalk', 10000);
  assert.equal(await page.evaluate(() => window.__aquamateDebug.expression), 'sad');
  await sleep(900);
  await shot('m5-sad-walk.png');
  await page.waitForFunction(() => window.__aquamateDebug.x <= window.__aquamateDebug.exitLeftX + 1e-6, null, { timeout: 30000 });
  await sceneClosed(10000);
  plan = await pending();
  assert.ok(plan[0].at - later >= 14 * 60_000 && plan[0].at - later <= 16 * 60_000, 'snoozed for 15 minutes');
  assert.equal(plan[0].body, 'Ready now? Time to drink some water 💧');
  assert.equal((await state()).status.glassesToday, 2, 'not counted');

  step('tapping "I drank water" on a notification opens the scene and plays the drink');
  await page.evaluate(() =>
    window.Capacitor.Plugins.LocalNotifications.notifyListeners('localNotificationActionPerformed', {
      actionId: 'drank',
      notification: { id: 1000, title: 'AquaMate', body: '', extra: { kind: 'reminder', snoozed: true } },
    }),
  );
  await page.waitForSelector('[data-testid=reminder-scene].is-open');
  await sceneAnim('Drink', 20000);
  await sceneClosed(25000);
  assert.equal((await state()).status.glassesToday, 3);

  step('reminder settings save to app storage and re-plan the notifications');
  await page.getByRole('tab', { name: 'Reminders' }).click();
  await page.getByLabel('Interval').selectOption('30');
  await page.getByRole('button', { name: 'More glasses' }).click();
  await page.getByLabel('Your name').fill('Sam');
  await page.getByLabel('Your name').press('Enter');
  await sleep(300);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('CapacitorStorage.settings')));
  assert.equal(saved.reminders.intervalMinutes, 30);
  assert.equal(saved.reminders.dailyGoal, 9);
  assert.equal(saved.userName, 'Sam');
  plan = await pending();
  assert.equal(plan[1].at - plan[0].at, 30 * 60_000, 'every 30 minutes now');
  assert.equal(plan[0].body, 'Hey Sam! Time to drink some water 💧');
  await page.getByRole('heading', { name: 'Notifications' }).waitFor();
  assert.equal(await page.getByText("Wait while I'm away").count(), 0, 'desktop-only options are hidden');
  await page.evaluate(() => document.querySelector('.m-main').scrollTo(0, 0));
  await shot('m6-reminders.png');

  step('"Direction: Back the way they came" sends him back sadly the way he came after Drink Later');
  const leaving = (group, option) => page.getByRole('radiogroup', { name: group }).getByRole('radio', { name: option });
  const savedReminders = () => page.evaluate(() => JSON.parse(localStorage.getItem('CapacitorStorage.settings')).reminders);
  await leaving('Direction', 'Back the way they came').click();
  await sleep(200);
  assert.equal((await savedReminders()).exitPath, 'back');
  await page.getByRole('tab', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Remind me now' }).click();
  await scene('waiting');
  await card.getByRole('button', { name: 'Drink Later' }).click();
  await scene('later');
  await sceneAnim('SadWalk', 10000);
  const back0 = await page.evaluate(() => window.__aquamateDebug.x);
  await page.waitForFunction((x0) => window.__aquamateDebug.x > x0 + 0.3, back0, { timeout: 10000 });
  assert.equal(await page.evaluate(() => window.__aquamateDebug.expression), 'sad');
  await sceneClosed(20000);

  step('"Direction: Across the screen" + "Pace: Run": the same setting applies after drinking, and he runs');
  await page.getByRole('tab', { name: 'Reminders' }).click();
  await leaving('Direction', 'Across the screen').click();
  await leaving('Pace', 'Run').click();
  await sleep(200);
  await page.getByRole('heading', { name: 'When your companion leaves' }).scrollIntoViewIfNeeded();
  await shot('m6b-leaving.png');
  assert.equal((await savedReminders()).exitPath, 'across');
  assert.equal((await savedReminders()).exitGait, 'run');
  await page.getByRole('tab', { name: 'Today' }).click();
  await page.getByRole('button', { name: 'Remind me now' }).click();
  await scene('waiting');
  await card.getByRole('button', { name: 'I Drank Water' }).click();
  await sceneAnim('Run', 20000);
  const run0 = await page.evaluate(() => window.__aquamateDebug.x);
  await page.waitForFunction((x0) => window.__aquamateDebug.x < x0 - 0.3, run0, { timeout: 10000 });
  await sleep(300);
  await shot('m5b-run.png');
  await page.waitForFunction(() => window.__aquamateDebug.x <= window.__aquamateDebug.exitLeftX + 1e-6, null, { timeout: 15000 });
  await sceneClosed(10000);
  assert.equal((await state()).status.glassesToday, 4);

  step('character creator works on the phone and the new character moves in');
  await page.getByRole('tab', { name: 'Character' }).click();
  await page.getByRole('button', { name: 'Create character' }).click();
  await page.getByLabel('Name').fill('Mia');
  await page.getByRole('radio', { name: 'Female' }).click();
  assert.equal(await page.getByRole('switch', { name: 'Beard' }).count(), 0, 'no beard option for a female body');
  await page.getByRole('radio', { name: 'Bun' }).click();
  await page.getByRole('radio', { name: 'Hair color #b54a2a' }).click();
  await page.getByRole('radio', { name: 'Shirt color #1fa38a' }).click();
  await page.getByRole('switch', { name: 'Glasses' }).click();
  await page.locator('.preview-loading').waitFor({ state: 'detached', timeout: 20000 });
  await page.getByRole('button', { name: 'Save and use' }).click();
  await page.getByText('Mia is now your companion').waitFor({ timeout: 30000 });
  st = await state();
  const mia = st.characters.find((c) => c.name === 'Mia');
  assert.equal(mia.recipe.body, 'female');
  assert.ok(mia?.thumbnail?.startsWith('data:image/png'));
  assert.equal(st.settings.characterId, mia.id);
  await page.evaluate(() => document.querySelector('.m-main').scrollTo(0, 0));
  await sleep(600);
  await shot('m7-character.png');

  step('uploading a .glb from the phone: valid models are added, broken files refused');
  const good = join(userData, 'Robo Buddy.glb');
  copyFileSync(resolve('assets/models/human-character.glb'), good);
  const bad = join(userData, 'broken.glb');
  writeFileSync(bad, 'not a model at all, just text');
  const upload = async (file) => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Upload .glb' }).click();
    await (await chooser).setFiles(file);
  };
  await upload(bad);
  await page.getByText('This is not a binary glTF (.glb) file.').waitFor();
  await upload(good);
  await page.getByText('Robo Buddy is now your companion').waitFor({ timeout: 30000 });
  st = await state();
  assert.deepEqual(st.characters.find((c) => c.name === 'Robo Buddy')?.animations, ['Idle', 'Walk', 'Wave', 'Drink', 'Happy', 'Sad', 'SadWalk', 'Run', 'SitDown', 'Relax', 'StandUp']);

  step('the active character stars on the Today screen and in reminders');
  await page.getByRole('tab', { name: 'Today' }).click();
  await homeAnim('Idle', 30000);
  await page.getByRole('button', { name: 'Remind me now' }).click();
  await scene('waiting', 30000);
  await card.getByText('Hey Sam! Time to drink some water 💧').waitFor();
  await card.getByRole('button', { name: 'Skip this reminder' }).click();
  await sceneClosed(20000);

  // Each built-in, on the Today screen and in the reminder scene, through every answer.
  const useBuiltin = async (who, id) => {
    await page.getByRole('tab', { name: 'Character' }).click();
    await page.getByRole('button', { name: new RegExp(who) }).click();
    await page.getByRole('button', { name: 'Use as companion' }).click();
    await page.getByText('Your companion', { exact: true }).waitFor();
    assert.equal((await state()).settings.characterId, id);
    await page.getByRole('tab', { name: 'Today' }).click();
  };
  const everyInteraction = async (who, key) => {
    // The debug state is written each rendered frame, so allow for the first frame of a new phase.
    const onStage = async (debugName, when) => {
      await page.waitForFunction(([n, k]) => window[n]?.character === k, [debugName, key], { timeout: 1000 }).catch(() => {});
      assert.equal(await page.evaluate((n) => window[n]?.character, debugName), key, `${who} is on stage ${when}`);
    };
    await page.waitForFunction((k) => window.__aquamateHomeDebug?.character === k, key, { timeout: 30000 });
    await homeAnim('Idle', 30000);
    await shot(`m8-${who.toLowerCase()}-today.png`);
    await page.getByRole('button', { name: 'I drank a glass 💧' }).click();
    await homeAnim('Drink');
    await onStage('__aquamateHomeDebug', 'drinking on the Today screen');
    await homeAnim('Idle', 15000);

    // Relax mode on the Today screen: sits down right there, eyes closed, breathing.
    const homeExpression = (x, timeout = 6000) => page.waitForFunction((e) => window.__aquamateHomeDebug?.expression === e, x, { timeout });
    await page.getByRole('button', { name: 'Relax 🌿' }).click();
    await homeAnim('SitDown');
    await homeAnim('Relax', 8000);
    await homeExpression('relaxed');
    await onStage('__aquamateHomeDebug', 'relaxing on the Today screen');
    assert.equal(await page.evaluate(() => window.__aquamateHomeDebug.prop), null, 'relaxing is prop-free');
    assert.equal((await state()).status.relaxing, true);
    await sleep(1500);
    await shot(`m9-${who.toLowerCase()}-relaxing.png`);
    // Coming back to Today while relaxing: still sitting (no stand-and-sit-again).
    await page.getByRole('tab', { name: 'About' }).click();
    await page.getByRole('tab', { name: 'Today' }).click();
    await homeAnim('Relax', 30000);
    await homeExpression('relaxed');
    // Tap to wake: he stands up, refreshed.
    await page.getByTestId('home-stage').click();
    await homeAnim('StandUp');
    assert.equal((await state()).status.relaxing, false);
    await page.getByTestId('home-bubble').getByText(/All refreshed!/).waitFor({ timeout: 10000 });
    await homeAnim('Idle', 10000);
    // Logging a glass while relaxing: he gets up and drinks along, and Relax mode ends.
    await page.getByRole('button', { name: 'Relax 🌿' }).click();
    await homeAnim('Relax', 10000);
    await page.getByRole('button', { name: 'I drank a glass 💧' }).click();
    await homeAnim('StandUp');
    await homeAnim('Drink', 10000);
    assert.equal((await state()).status.relaxing, false);
    await homeAnim('Idle', 15000);
    for (const button of ['I Drank Water', 'Drink Later', 'Skip this reminder']) {
      await page.getByRole('button', { name: 'Remind me now' }).click();
      await scene('waiting', 30000);
      await onStage('__aquamateDebug', 'in the reminder');
      await card.getByRole('button', { name: button }).click();
      if (button === 'I Drank Water') {
        await sceneAnim('Drink', 10000);
        await onStage('__aquamateDebug', 'drinking in the reminder');
      }
      await page.waitForFunction(() => window.__aquamateDebug.walking, null, { timeout: 20000 });
      await onStage('__aquamateDebug', `leaving after "${button}"`);
      await sceneClosed(20000);
    }
  };
  step('Marina, the built-in female companion: Today screen and every reminder answer');
  await useBuiltin('Marina', 'default-female');
  await everyInteraction('Marina', 'stored:default-female:1');
  step('back to Aqua, the built-in male companion: Today screen and every reminder answer');
  await useBuiltin('Aqua', 'default');
  await everyInteraction('Aqua', 'stored:default:1');

  step('settings and the glass count survive a restart');
  await page.reload();
  await page.waitForSelector('[data-testid=home-stage]', { timeout: 30000 });
  st = await state();
  assert.equal(st.status.glassesToday, 10); // + two Today-screen glasses (one while relaxing) and a reminder glass each for Marina and Aqua
  assert.equal(st.settings.characterId, 'default');
  assert.equal(st.settings.userName, 'Sam');
  assert.equal(st.characters.length, 4); // Aqua, Marina, Mia, Robo Buddy
  assert.equal((await pending()).length, 8);

  assert.deepEqual(errors, [], 'no errors');
  console.log('\n✅ AquaMate Android UI tests passed');
} catch (e) {
  console.error('\n❌ AquaMate Android UI test failed:', e.message);
  const where = await app
    .firstWindow()
    .then((p) => p.evaluate(() => ({ home: window.__aquamateHomeDebug, scene: window.__aquamateDebug })))
    .catch(() => null);
  if (where) console.error('Characters at failure:', JSON.stringify(where));
  console.error(e.stack?.split('\n').filter((l) => l.includes('mobile-e2e.mjs')).join('\n'));
  if (errors.length) console.error('Errors:', errors);
  process.exitCode = 1;
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
