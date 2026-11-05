// Dev runner: compiles the main process, starts Vite, launches Electron.
import { spawn, execSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'vite';

const require = createRequire(import.meta.url);
const electron = require('electron');

execSync('npx tsc -p tsconfig.main.json', { stdio: 'inherit' });
const server = await createServer({ configFile: 'vite.config.mts' });
await server.listen();
const url = server.resolvedUrls.local[0];
console.log(`[aquamate] renderer dev server: ${url}`);

const args = ['.', ...process.argv.slice(2)];
const child = spawn(electron, args, { stdio: 'inherit', env: { ...process.env, VITE_DEV_SERVER_URL: url } });
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
