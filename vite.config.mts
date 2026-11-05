import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = import.meta.dirname;
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

// `vite build` → desktop renderer (dist-renderer, loaded by Electron)
// `vite build --mode mobile` → Android web app (dist-mobile, wrapped by Capacitor)
export default defineConfig(({ mode }) => ({
  root: resolve(root, 'src/renderer'),
  base: './',
  publicDir: resolve(root, 'assets'), // assets/models/human-character.glb -> ./models/human-character.glb
  plugins: [react()],
  define: {
    'import.meta.env.VITE_TARGET': JSON.stringify(mode === 'mobile' ? 'mobile' : 'desktop'),
    __APP_VERSION__: JSON.stringify(version),
  },
  build: {
    outDir: resolve(root, mode === 'mobile' ? 'dist-mobile' : 'dist-renderer'),
    emptyOutDir: true,
    target: 'chrome120',
    chunkSizeWarningLimit: 2500, // an app loads its bundle from local storage
  },
  server: { port: 5173, strictPort: false },
}));
