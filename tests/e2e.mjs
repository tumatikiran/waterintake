/**
 * End-to-end test of AquaMate in the real Electron app.
 *   npm test                 (Windows/macOS)
 *   xvfb-run -a npm test     (headless Linux CI)
 *   AQUAMATE_EXECUTABLE=<packaged binary> node tests/e2e.mjs
 * Uses a throwaway data folder, so your own settings are never touched.
 * Screenshots land in test-results/.
 */
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const OUT = resolve('test-results');
mkdirSync(OUT, { recursive: true });
const userData = mkdtempSync(join(tmpdir(), 'aquamate-e2e-'));

const packaged = process.env.AQUAMATE_EXECUTABLE;
const args = packaged ? [] : ['.'];
if (process.env.AQUAMATE_SCREENSHOT_SCALE) args.push(`--force-device-scale-factor=${process.env.AQUAMATE_SCREENSHOT_SCALE}`);
// Headless Linux CI has no GPU: use Chromium's software WebGL (SwiftShader).
if (process.platform === 'linux') args.push('--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const env = { ...process.env, AQUAMATE_USER_DATA: userData };
delete env.VITE_DEV_SERVER_URL; // always test the production build
delete env.NODE_OPTIONS;

const app = await electron.launch({ executablePath: packaged || require('electron'), args, env });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (msg) => console.log(`  • ${msg}`);

try {
  const pageFor = async (view) => {
    for (let i = 0; i < 150; i++) {
      const page = app.windows().find((w) => w.url().includes(`view=${view}`));
      if (page) return page;
      await sleep(100);
    }
    throw new Error(`window ${view} not found`);
  };
  const settings = await pageFor('settings');
  const mascot = await pageFor('mascot');
  for (const page of [settings, mascot]) {
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
  }
  await settings.waitForSelector('[data-testid=today]');

  const overlayWindow = () =>
    app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('view=mascot'));
      return { visible: w.isVisible(), alwaysOnTop: w.isAlwaysOnTop(), bounds: w.getBounds(), workArea: screen.getDisplayMatching(w.getBounds()).workArea };
    });
  const waitVisible = async (want) => {
    for (let i = 0; i < 60 && (await overlayWindow()).visible !== want; i++) await sleep(50);
    return overlayWindow();
  };
  const debug = () => mascot.evaluate(() => window.__aquamateDebug);
  const waitDebug = (fn, arg, timeout = 8000) => mascot.waitForFunction(fn, arg, { timeout });
  const waitAnim = (name, timeout) => waitDebug((n) => window.__aquamateDebug?.animation === n, name, timeout);
  const phase = (p, timeout = 15000) => mascot.waitForSelector(`[data-phase=${p}]`, { timeout });
  const state = () => settings.evaluate(() => window.aquamate.getState());
  const testReminder = () => settings.getByRole('button', { name: 'Test reminder' }).click();
  const card = mascot.getByTestId('reminder-card');
  /** The right-hand part of the overlay, where the character and card are. */
  const shot = async (name) => {
    const { width, height } = await mascot.evaluate(() => ({ width: innerWidth, height: innerHeight }));
    const w = Math.min(width, 760);
    await mascot.screenshot({ path: join(OUT, name), clip: { x: width - w, y: 0, width: w, height } });
  };

  // Deterministic schedule for the test: active all day, every day.
  await settings.evaluate(() =>
    window.aquamate.updateSettings({ reminders: { schedule: [{ days: [0, 1, 2, 3, 4, 5, 6], start: '00:00', end: '00:00' }] } }),
  );

  step('starts with the overlay hidden and nothing logged');
  assert.equal((await overlayWindow()).visible, false);
  assert.equal((await state()).status.glassesToday, 0);

  // ------------------------------------------------------ "I Drank Water"
  step('Test reminder → walks in from the right carrying a full water bottle (it shows what the reminder is for)');
  await testReminder();
  await phase('arrive');
  const win = await waitVisible(true);
  assert.equal(win.visible, true);
  assert.equal(win.alwaysOnTop, true);
  assert.equal(win.bounds.width, win.workArea.width, 'overlay spans the screen width');
  assert.equal(win.bounds.y + win.bounds.height, win.workArea.y + win.workArea.height, 'anchored to the bottom');
  await waitAnim('Walk');
  const a = await debug();
  // Frame-rate independent: wait for movement rather than sampling once (software WebGL can be slow to start).
  await waitDebug((x0) => window.__aquamateDebug.x < x0 - 0.05 && window.__aquamateDebug.animation === 'Walk', a.x);
  assert.equal((await debug()).prop, 'waterBottle', 'a water reminder brings the water bottle');
  assert.equal((await debug()).bottleLevel, 1, 'bottle starts full');

  step('stops at its mark, waves, shows the card with three choices');
  await waitAnim('Wave');
  const stopped = await debug();
  assert.ok(Math.abs(stopped.x - stopped.stopX) < 1e-6, 'stops at the designated position');
  await card.getByText('Time to drink some water 💧').waitFor();
  await card.getByRole('button', { name: 'I Drank Water' }).waitFor();
  await card.getByRole('button', { name: 'Drink Later' }).waitFor();
  await card.getByRole('button', { name: 'Skip this reminder' }).waitFor();
  await phase('waiting');
  await sleep(300);
  await shot('1-reminder.png');

  step('I Drank Water → drinks from the bottle (eyes closed, water level drops)');
  await card.getByRole('button', { name: 'I Drank Water' }).click();
  await card.getByText('Cheers! 💧').waitFor();
  await waitAnim('Drink');
  assert.equal((await debug()).expression, 'drinking');
  await sleep(1800);
  await shot('2-drinking.png');
  await waitAnim('Happy', 8000);
  const after = await debug();
  assert.ok(after.bottleLevel < 0.75, `bottle emptied a bit (${after.bottleLevel})`);
  assert.equal(after.expression, 'joyful');
  await card.getByText('Great job! Stay hydrated.').waitFor();
  await card.getByText('1 of 8 glasses today').waitFor();
  assert.equal(await card.getByText(/glasses? today/).count(), 1, 'one progress line, no duplicate');
  await sleep(400);
  await shot('3-celebrating.png');
  assert.equal((await state()).status.glassesToday, 1, 'glass counted');

  step('then walks off across the screen (the default) and the overlay hides');
  await waitAnim('Walk', 6000);
  const l1 = await debug();
  await waitDebug((x0) => window.__aquamateDebug.x < x0 - 0.3, l1.x); // moves left while leaving
  assert.equal((await debug()).expression, 'happy');
  await phase('hidden', 40000);
  assert.equal((await waitVisible(false)).visible, false);
  await settings.getByTestId('glasses-today').getByText('1').waitFor();

  // ------------------------------------------------------- "Drink Later"
  step('Drink Later → sad sigh, then a sad walk across the whole screen to the left');
  await testReminder();
  await phase('waiting');
  const startedAt = Date.now();
  await card.getByRole('button', { name: 'Drink Later' }).click();
  await card.getByText("Okay… I'll remind you again in 15 minutes.").waitFor();
  await waitAnim('Sad');
  assert.equal((await debug()).expression, 'sad');
  await waitAnim('SadWalk', 6000);
  const s1 = await debug();
  await waitDebug((x0) => window.__aquamateDebug.x < x0 - 2, s1.x, 15000); // well on its way left
  assert.equal((await debug()).expression, 'sad', 'still sad while walking');
  await mascot.screenshot({ path: join(OUT, '4-sad-walk.png') });
  await waitDebug(() => window.__aquamateDebug.x <= window.__aquamateDebug.exitLeftX + 1e-6, null, 40000);
  await phase('hidden', 5000);
  assert.equal((await waitVisible(false)).visible, false);
  const snoozed = (await state()).status.nextReminderAt;
  assert.ok(snoozed - startedAt >= 14 * 60_000 && snoozed - startedAt <= 16 * 60_000, 'next reminder in about 15 minutes');
  assert.equal((await state()).status.glassesToday, 1, 'not counted as a glass');

  // ------------------------------------------------------------------ Skip
  step('✕ skips: leaves like Drink Later (across the screen by default) without counting a glass');
  await testReminder();
  await phase('waiting');
  await card.getByRole('button', { name: 'Skip this reminder' }).click();
  await phase('skip');
  await waitAnim('Walk', 6000);
  const k1 = await debug();
  await waitDebug((x0) => window.__aquamateDebug.x < x0 - 0.3, k1.x); // heading left
  await phase('hidden', 40000);
  assert.equal((await state()).status.glassesToday, 1);

  // ------------------------------------------------------------- Settings
  step('reminder settings save immediately and persist to disk');
  await settings.getByLabel('Interval').selectOption('30');
  await settings.getByRole('button', { name: 'More glasses' }).click();
  await settings.getByRole('switch', { name: 'Stop for the day when I reach my goal' }).click();
  await settings.getByRole('button', { name: '+ Add time window' }).click();
  await settings.getByLabel('Your name').fill('Sam');
  await settings.getByLabel('Your name').press('Enter');
  await sleep(300);
  const saved = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8'));
  assert.equal(saved.reminders.intervalMinutes, 30);
  assert.equal(saved.reminders.dailyGoal, 9);
  assert.equal(saved.reminders.stopWhenGoalReached, true);
  assert.equal(saved.reminders.schedule.length, 2);
  assert.equal(saved.userName, 'Sam');
  await settings.getByRole('radio', { name: 'Spread my goal' }).click();
  await settings.getByText(/About every/).waitFor();
  assert.equal(JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).reminders.mode, 'goal');
  await settings.getByRole('radio', { name: 'Fixed interval' }).click();
  await settings.evaluate(() => document.querySelector('.tab-panel').scrollTo(0, 0));
  await settings.screenshot({ path: join(OUT, '5-settings-reminders.png') });

  step('"Direction: Back the way they came": after Drink Later he walks back sadly the way he came');
  const leaving = (group, option) => settings.getByRole('radiogroup', { name: group }).getByRole('radio', { name: option });
  await leaving('Direction', 'Back the way they came').click();
  await sleep(200);
  assert.equal(JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).reminders.exitPath, 'back');
  await testReminder();
  await phase('waiting');
  await card.getByRole('button', { name: 'Drink Later' }).click();
  await card.getByText("Okay… I'll remind you again in 15 minutes.").waitFor();
  await phase('later');
  await waitAnim('SadWalk', 8000);
  const back0 = await debug();
  await waitDebug((x0) => window.__aquamateDebug.x > x0 + 0.3, back0.x, 10000); // to the right, where he came from
  assert.equal((await debug()).expression, 'sad');
  await shot('4b-sad-walk-back.png');
  await waitDebug(() => window.__aquamateDebug.x >= window.__aquamateDebug.exitRightX - 1e-6, null, 15000);
  await phase('hidden', 5000);
  assert.equal((await waitVisible(false)).visible, false);

  step('"Direction: Back the way they came" + "Pace: Run": after drinking he runs back the way he came');
  await leaving('Pace', 'Run').click();
  await sleep(200);
  const pace = JSON.parse(readFileSync(join(userData, 'settings.json'), 'utf8')).reminders;
  assert.equal(pace.exitPath, 'back');
  assert.equal(pace.exitGait, 'run');
  await testReminder();
  await phase('waiting');
  await card.getByRole('button', { name: 'I Drank Water' }).click();
  await phase('drank');
  await waitAnim('Run', 15000);
  const r0 = await debug();
  const t0 = Date.now();
  await waitDebug((x0) => window.__aquamateDebug.x > x0 + 0.6, r0.x, 10000); // running right, where he came from
  await shot('3b-run-back.png');
  await waitDebug((x0) => window.__aquamateDebug.x > x0 + 1.5, r0.x, 10000);
  const runSpeed = ((await debug()).x - r0.x) / ((Date.now() - t0) / 1000);
  assert.ok(runSpeed > 1.8, `runs faster than a walk (~1.25 units/s): ${runSpeed.toFixed(2)} units/s`);
  await waitDebug(() => window.__aquamateDebug.x >= window.__aquamateDebug.exitRightX - 1e-6, null, 10000);
  await phase('hidden', 5000);
  assert.equal((await waitVisible(false)).visible, false);

  // ----------------------------------------------------- Custom characters
  step('character creator: design, save, and it becomes the companion');
  await settings.getByRole('tab', { name: 'Character' }).click();
  await settings.getByRole('button', { name: 'Create character' }).click();
  await settings.getByLabel('Name').fill('Mia');
  assert.equal(await settings.getByRole('switch', { name: 'Beard' }).count(), 1, 'beard is offered for a male body');
  await settings.getByRole('radio', { name: 'Female' }).click();
  assert.equal(await settings.getByRole('radio', { name: 'Long' }).getAttribute('aria-checked'), 'true', 'Female switches short hair to long');
  assert.equal(await settings.getByRole('switch', { name: 'Beard' }).count(), 0, 'no beard option for a female body');
  await settings.getByRole('radio', { name: 'Bun' }).click();
  await settings.getByRole('radio', { name: 'Hair color #b54a2a' }).click();
  await settings.getByRole('radio', { name: 'Shirt color #1fa38a' }).click();
  await settings.getByRole('radio', { name: 'Skin tone #c68a5f' }).click();
  await settings.getByRole('switch', { name: 'Glasses' }).click();
  await settings.locator('.preview-loading').waitFor({ state: 'detached', timeout: 15000 });
  await sleep(800);
  await settings.screenshot({ path: join(OUT, '6-character-creator.png') });
  await settings.getByRole('button', { name: 'Save and use' }).click();
  await settings.getByText('Mia is now your companion').waitFor({ timeout: 20000 });
  let st = await state();
  const mia = st.characters.find((c) => c.name === 'Mia');
  assert.ok(mia && mia.kind === 'created' && mia.thumbnail?.startsWith('data:image/png'), 'saved with a thumbnail');
  assert.equal(mia.recipe.body, 'female');
  assert.equal(mia.recipe.beard, false);
  assert.equal(st.settings.characterId, mia.id);

  step('the created character shows up for reminders');
  await testReminder();
  await phase('waiting', 20000);
  assert.equal((await debug()).character, `stored:${mia.id}:${mia.revision}`);
  await sleep(300);
  await shot('7-custom-character.png');
  await card.getByRole('button', { name: 'Skip this reminder' }).click();
  await phase('hidden', 10000);

  step('upload a .glb: valid models are added and selected, broken files are refused');
  const goodGlb = join(userData, 'Robo Buddy.glb');
  copyFileSync(resolve('assets/models/human-character.glb'), goodGlb);
  const badGlb = join(userData, 'not-a-model.glb');
  writeFileSync(badGlb, 'definitely not a glTF file, just some text to upload');
  const pick = (file) =>
    app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [f] });
    }, file);
  await pick(badGlb);
  await settings.getByRole('button', { name: 'Upload .glb' }).click();
  await settings.getByText('This is not a binary glTF (.glb) file.').waitFor();
  await pick(goodGlb);
  await settings.getByRole('button', { name: 'Upload .glb' }).click();
  await settings.getByText('Robo Buddy is now your companion').waitFor({ timeout: 20000 });
  st = await state();
  const robo = st.characters.find((c) => c.name === 'Robo Buddy');
  assert.ok(robo && robo.kind === 'uploaded');
  assert.deepEqual(robo.animations, ['Idle', 'Walk', 'Wave', 'Drink', 'Happy', 'Sad', 'SadWalk', 'Run', 'SitDown', 'Relax', 'StandUp', 'Doze', 'Stretch']);
  assert.equal(st.settings.characterId, robo.id);
  await settings.locator('.preview-loading').waitFor({ state: 'detached', timeout: 15000 });
  await settings.getByRole('button', { name: 'Drink' }).click();
  await sleep(1500);
  await settings.screenshot({ path: join(OUT, '8-settings-character.png') });

  step('deleting the active character falls back to the default');
  settings.once('dialog', (d) => d.accept());
  await settings.getByRole('button', { name: 'Delete' }).click();
  await settings.getByText('Robo Buddy was deleted.').waitFor();
  st = await state();
  assert.equal(st.settings.characterId, 'default');
  assert.equal(st.characters.length, 3); // Aqua, Marina, Mia

  // Every interaction, for each built-in: the overlay must show the chosen character throughout.
  const everyInteraction = async (who, key) => {
    // The debug state is written each rendered frame, so allow for the first frame of a new phase.
    const onStage = async (when) => {
      await waitDebug((k) => window.__aquamateDebug.character === k, key, 1000).catch(() => {});
      assert.equal((await debug()).character, key, `${who} is on stage ${when}`);
    };
    for (const [button, script] of [
      ['I Drank Water', 'drank'],
      ['Drink Later', 'later'],
      ['Skip this reminder', 'skip'],
    ]) {
      await testReminder();
      await phase('arrive', 20000);
      await onStage('walking in');
      await phase('waiting', 20000);
      await onStage('waiting');
      await card.getByRole('button', { name: button }).click();
      await phase(script);
      await onStage(`after "${button}"`);
      if (script === 'drank') {
        await waitAnim('Drink', 10000);
        await onStage('drinking');
        await sleep(1700);
        await shot(`9-${who.toLowerCase()}-drinking.png`);
      }
      await waitDebug(() => window.__aquamateDebug.walking, null, 15000);
      await onStage('leaving');
      await phase('hidden', 40000);
    }

    // Relax mode: walk to the middle, sit down, close the eyes, breathe; then get up and leave.
    await settings.getByRole('button', { name: 'Relax 🌿' }).click();
    await phase('relax');
    assert.equal((await waitVisible(true)).visible, true, 'the overlay shows for Relax mode');
    assert.equal((await state()).status.relaxing, true);
    await onStage('walking to the middle to relax');
    await waitAnim('SitDown', 20000);
    const sat = await debug();
    assert.ok(Math.abs(sat.x - sat.centerX) < 0.01, `${who} sits in the middle of the screen`);
    await waitAnim('Relax', 6000);
    await waitDebug(() => window.__aquamateDebug.expression === 'relaxed', null, 4000);
    assert.equal((await debug()).prop, null, 'relaxing is prop-free');
    await onStage('relaxing');
    await sleep(2500);
    assert.equal((await debug()).animation, 'Relax', 'keeps relaxing until turned off');
    await shot(`10-${who.toLowerCase()}-relaxing.png`);
    await settings.getByRole('button', { name: 'Stop relaxing' }).click();
    await phase('wake');
    assert.equal((await state()).status.relaxing, false);
    await waitAnim('StandUp', 6000);
    await onStage('standing up');
    await waitDebug(() => window.__aquamateDebug.walking, null, 15000);
    await phase('hidden', 40000);
    assert.equal((await waitVisible(false)).visible, false, 'the overlay hides after leaving');
  };

  step('Marina, the built-in female companion: chosen in settings, on stage for every interaction');
  await settings.getByRole('button', { name: /Marina/ }).click();
  await settings.locator('.preview-loading').waitFor({ state: 'detached', timeout: 15000 });
  await settings.getByRole('button', { name: 'Use as companion' }).click();
  await settings.getByText('Your companion', { exact: true }).waitFor();
  assert.equal((await state()).settings.characterId, 'default-female');
  assert.equal(await settings.getByRole('button', { name: 'Delete' }).count(), 0, 'built-ins cannot be deleted');
  await sleep(600);
  await settings.screenshot({ path: join(OUT, '9-marina.png') });
  await everyInteraction('Marina', 'stored:default-female:1');

  step('back to Aqua, the built-in male companion: on stage for every interaction');
  await settings.getByRole('button', { name: /Aqua/ }).click();
  await settings.locator('.preview-loading').waitFor({ state: 'detached', timeout: 15000 });
  await settings.getByRole('button', { name: 'Use as companion' }).click();
  await settings.getByText('Your companion', { exact: true }).waitFor();
  assert.equal((await state()).settings.characterId, 'default');
  await everyInteraction('Aqua', 'stored:default:1');

  step('a reminder during Relax mode: he gets up and reminds from where he sat, and Relax mode ends');
  await settings.getByRole('button', { name: 'Relax 🌿' }).click();
  await waitAnim('Relax', 25000);
  await testReminder();
  await phase('wakeToRemind');
  assert.equal((await debug()).prop, null, 'still empty-handed while getting up');
  await waitAnim('StandUp', 6000);
  assert.equal((await state()).status.relaxing, false);
  assert.equal((await state()).status.reminderActive, true);
  await phase('waiting', 20000);
  const reminded = await debug();
  assert.equal(reminded.prop, 'waterBottle', 'brings the bottle out for the reminder');
  assert.ok(Math.abs(reminded.x - reminded.stopX) < 0.01, 'walked over to the usual spot by the card');
  await card.getByRole('button', { name: 'Skip this reminder' }).click();
  await phase('hidden', 40000);
  assert.equal(await settings.getByRole('button', { name: 'Relax 🌿' }).isEnabled(), true);

  const companion = () => mascot.evaluate(() => document.querySelector('[data-testid=stage]').dataset.companion);
  step('Relax mode dozes off: deeper breathing, head down, mouth slightly open, a floating "zzz"');
  await settings.evaluate(() => window.aquamate.updateSettings({ relax: { dozeAfterMinutes: 0.05 } })); // 3 s, for the test
  await settings.getByRole('button', { name: 'Relax 🌿' }).click();
  await waitAnim('Doze', 30000);
  await waitDebug(() => window.__aquamateDebug.expression === 'asleep', null, 4000);
  assert.equal(await companion(), 'sleeping');
  assert.equal((await debug()).prop, null);
  await mascot.waitForFunction(() => getComputedStyle(document.querySelector('[data-testid=zzz]')).opacity === '1', null, { timeout: 4000 });
  await sleep(1500);
  await mascot.screenshot({ path: join(OUT, '11-dozing.png') });

  step('a reminder wakes the sleeping companion: stretch and yawn, stand up, remind');
  await testReminder();
  await phase('wakeFromSleepToRemind');
  await waitAnim('Stretch', 6000);
  assert.equal((await debug()).expression, 'yawn');
  await waitAnim('StandUp', 8000);
  await phase('waiting', 20000);
  assert.equal(await companion(), 'reminding');
  assert.equal((await state()).status.relaxing, false);
  await card.getByRole('button', { name: 'Skip this reminder' }).click();
  await phase('hidden', 40000);

  step('turning Relax mode off while asleep: stretch, stand up, leave');
  await settings.getByRole('button', { name: 'Relax 🌿' }).click();
  await waitAnim('Doze', 30000);
  await settings.getByRole('button', { name: 'Stop relaxing' }).click();
  await phase('wakeFromSleep');
  await waitAnim('Stretch', 6000);
  await waitAnim('StandUp', 8000);
  await phase('hidden', 40000);
  assert.equal((await waitVisible(false)).visible, false);

  step('"Relax for" ends Relax mode by itself');
  await settings.evaluate(() => window.aquamate.updateSettings({ relax: { dozeAfterMinutes: 0, durationMinutes: 0.15 } })); // 9 s
  await settings.getByRole('button', { name: 'Relax 🌿' }).click();
  await waitAnim('Relax', 30000);
  await phase('wake', 15000);
  assert.equal((await state()).status.relaxing, false);
  assert.equal(await companion(), 'waking', 'never dozed: "Never" means never');
  await phase('hidden', 40000);
  await settings.evaluate(() => window.aquamate.updateSettings({ relax: { dozeAfterMinutes: 3, durationMinutes: 0 } }));

  assert.deepEqual(errors, [], 'no renderer errors');
  console.log('\n✅ AquaMate end-to-end tests passed');
} catch (e) {
  console.error('\n❌ AquaMate e2e failed:', e.message);
  if (errors.length) console.error('Renderer errors:', errors);
  process.exitCode = 1;
} finally {
  await app.close();
  rmSync(userData, { recursive: true, force: true });
}
