/**
 * End-to-end test of the reminder flow in the real Electron app.
 *   npm test                 (Windows/macOS)
 *   xvfb-run -a npm test     (headless Linux CI)
 *   AQUAMATE_EXECUTABLE=<packaged binary> node tests/e2e.mjs
 * Screenshots land in test-results/.
 */
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const require = createRequire(import.meta.url);
const OUT = 'test-results';
mkdirSync(OUT, { recursive: true });

// Set AQUAMATE_EXECUTABLE to test a packaged build (e.g. release/linux-unpacked/aquamate).
const packaged = process.env.AQUAMATE_EXECUTABLE;
const args = packaged ? [] : ['.'];
// Headless Linux CI has no GPU: use Chromium's software WebGL (SwiftShader).
if (process.platform === 'linux') args.push('--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader');
const env = { ...process.env };
delete env.VITE_DEV_SERVER_URL; // always test the production build
delete env.NODE_OPTIONS;

const app = await electron.launch({ executablePath: packaged || require('electron'), args, env });
const errors = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const step = (msg) => console.log(`  • ${msg}`);

try {
  const pageFor = async (view) => {
    for (let i = 0; i < 100; i++) {
      const page = app.windows().find((w) => w.url().includes(`view=${view}`));
      if (page) return page;
      await sleep(100);
    }
    throw new Error(`window ${view} not found`);
  };
  const panel = await pageFor('panel');
  const mascot = await pageFor('mascot');
  for (const page of [panel, mascot]) {
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(String(e)));
  }
  await panel.waitForLoadState('domcontentloaded');
  await mascot.waitForLoadState('domcontentloaded');

  const mascotWindow = () =>
    app.evaluate(({ BrowserWindow, screen }) => {
      const w = BrowserWindow.getAllWindows().find((b) => b.webContents.getURL().includes('view=mascot'));
      const wa = screen.getDisplayMatching(w.getBounds()).workArea;
      return {
        visible: w.isVisible(),
        alwaysOnTop: w.isAlwaysOnTop(),
        bounds: w.getBounds(),
        workArea: wa,
      };
    });
  const debug = () => mascot.evaluate(() => window.__aquamateDebug);
  const waitAnim = (name) =>
    mascot.waitForFunction((n) => window.__aquamateDebug?.animation === n, name, { timeout: 3000 });
  const phase = () => mascot.locator('[data-testid=stage]').getAttribute('data-phase');

  step('mascot starts hidden');
  assert.equal((await mascotWindow()).visible, false);

  // ------------------------------------------------------- "I Drank Water"
  step('Test Reminder → character walks in from the bottom-right');
  await panel.getByRole('button', { name: 'Test Reminder' }).click();
  await mascot.waitForSelector('[data-phase=entering]');
  const waitVisible = async (want) => {
    for (let i = 0; i < 40 && (await mascotWindow()).visible !== want; i++) await sleep(50);
    return mascotWindow();
  };
  const win = await waitVisible(true);
  assert.equal(win.visible, true, 'mascot window should be visible');
  assert.equal(win.alwaysOnTop, true);
  assert.equal(win.bounds.x + win.bounds.width, win.workArea.x + win.workArea.width, 'anchored right');
  assert.equal(win.bounds.y + win.bounds.height, win.workArea.y + win.workArea.height, 'anchored bottom');
  assert.equal(await panel.getByTestId('panel-status').getAttribute('data-status'), 'active');
  assert.equal(await panel.getByRole('button', { name: 'Test Reminder' }).isDisabled(), true);

  // Movement is synchronised with the Walk clip: moving left while walking.
  const a = await debug();
  await sleep(300);
  const b = await debug();
  assert.equal(b.animation, 'Walk');
  assert.ok(b.x < a.x, `character should move left while walking (${a.x} → ${b.x})`);
  await mascot.screenshot({ path: `${OUT}/1-walking-in.png` });

  step('character stops, waves, card appears');
  await mascot.waitForSelector('[data-phase=reminding]', { timeout: 8000 });
  await waitAnim('Wave');
  const stopped = await debug();
  assert.ok(Math.abs(stopped.x - stopped.stopX) < 1e-6, 'stops at the designated position');
  await mascot.getByText('Hey! Time to drink some water 💧').waitFor();
  await sleep(400);
  await mascot.screenshot({ path: `${OUT}/2-reminder.png` });
  await mascot.waitForFunction(() => window.__aquamateDebug.animation === 'Idle', null, { timeout: 5000 });
  step('wave finished → idle');

  step('I Drank Water → Happy + message');
  await mascot.getByRole('button', { name: 'I Drank Water' }).click();
  await mascot.getByText('Great job! Stay hydrated.').waitFor();
  await waitAnim('Happy');
  await sleep(500);
  await mascot.screenshot({ path: `${OUT}/3-happy.png` });
  assert.equal(await panel.getByTestId('panel-status').getAttribute('data-status'), 'drank');

  step('waits briefly, then walks away to the right and hides');
  await sleep(1500);
  assert.equal(await phase(), 'celebrating', 'should linger briefly before leaving');
  await mascot.waitForSelector('[data-phase=leaving]', { timeout: 3000 });
  await waitAnim('Walk');
  const l1 = await debug();
  await sleep(300);
  const l2 = await debug();
  assert.equal(l2.animation, 'Walk');
  assert.ok(l2.x > l1.x, 'moves right while leaving');
  await mascot.screenshot({ path: `${OUT}/4-walking-away.png` });
  await mascot.waitForSelector('[data-phase=hidden]', { timeout: 8000 });
  assert.equal((await waitVisible(false)).visible, false, 'window hidden after exit');

  // ---------------------------------------------------------------- Dismiss
  step('second reminder → Dismiss → walks away and hides');
  await panel.getByRole('button', { name: 'Test Reminder' }).click();
  await mascot.waitForSelector('[data-phase=entering]');
  const start = await debug();
  assert.ok(start.x >= start.startX - 0.2, 'restarts from off-stage');
  await mascot.waitForSelector('[data-phase=reminding]', { timeout: 8000 });
  await mascot.getByRole('button', { name: 'Dismiss' }).click();
  await mascot.waitForSelector('[data-phase=leaving]');
  assert.equal(await panel.getByTestId('panel-status').getAttribute('data-status'), 'dismissed');
  await mascot.waitForSelector('[data-phase=hidden]', { timeout: 8000 });
  assert.equal((await waitVisible(false)).visible, false);
  await panel.screenshot({ path: `${OUT}/5-panel.png` });

  assert.deepEqual(errors, [], 'no renderer errors');
  console.log('\n✅ AquaMate reminder flow passed');
} catch (e) {
  console.error('\n❌ AquaMate e2e failed:', e.message);
  if (errors.length) console.error('Renderer errors:', errors);
  process.exitCode = 1;
} finally {
  await app.close();
}
