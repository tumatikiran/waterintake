import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  root: resolve(import.meta.dirname, 'src/renderer'),
  base: './',
  publicDir: resolve(import.meta.dirname, 'assets'), // assets/models/human-character.glb -> ./models/human-character.glb
  plugins: [react()],
  build: {
    outDir: resolve(import.meta.dirname, 'dist-renderer'),
    emptyOutDir: true,
    target: 'chrome120',
    chunkSizeWarningLimit: 2500, // a desktop app loads its bundle from disk
  },
  server: { port: 5173, strictPort: false },
});
