/**
 * Writes assets/models/human-character.glb, the bundled default companion,
 * using the same generator as the in-app character creator
 * (src/renderer/character/procedural.ts, loaded through Vite's module runner).
 *
 *   npm run generate:model
 */
import { runnerImport } from 'vite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// GLTFExporter uses the browser FileReader; give Node a tiny stand-in.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    this.#done(blob.arrayBuffer());
  }
  readAsDataURL(blob) {
    this.#done(blob.arrayBuffer().then((b) => `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`));
  }
  #done(p) {
    p.then((r) => {
      this.result = r;
      this.onload?.({ target: this });
      this.onloadend?.({ target: this });
    });
  }
};

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { module: procedural } = await runnerImport(resolve(root, 'src/renderer/character/procedural.ts'), { configFile: false, logLevel: 'error' });
const { module: recipes } = await runnerImport(resolve(root, 'src/shared/recipe.ts'), { configFile: false, logLevel: 'error' });
const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');

const { root: model, clips } = procedural.buildCharacter(recipes.DEFAULT_RECIPE);
const glb = await new GLTFExporter().parseAsync(model, { binary: true, animations: clips });
const out = resolve(root, 'assets/models/human-character.glb');
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(glb));
console.log(`Wrote ${out} (${(glb.byteLength / 1024).toFixed(1)} KB, clips: ${clips.map((c) => c.name).join(', ')})`);
