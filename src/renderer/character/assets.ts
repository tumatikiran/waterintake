import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { CharacterRecipe } from '../../shared/types';
import { buildCharacter } from './procedural';
import type { CharacterAssetData } from './rig';

export const DEFAULT_MODEL_URL = './models/human-character.glb';

/** Where a character comes from: a stored model ('default' = bundled) or a live recipe in the creator. */
export type CharacterSource = { kind: 'stored'; id: string; revision: number } | { kind: 'recipe'; recipe: CharacterRecipe };

export function sourceKey(s: CharacterSource): string {
  return s.kind === 'stored' ? `stored:${s.id}:${s.revision}` : `recipe:${JSON.stringify(s.recipe)}`;
}

const cache = new Map<string, Promise<CharacterAssetData>>();
const MAX_CACHED = 8;

/** Loads (once) and caches a character. The same promise is returned for the same source, as React's use() needs. */
export function loadCharacterAsset(source: CharacterSource): Promise<CharacterAssetData> {
  const key = sourceKey(source);
  let promise = cache.get(key);
  if (!promise) {
    promise = load(source);
    cache.set(key, promise);
    promise.catch(() => cache.delete(key)); // a later attempt can retry
    while (cache.size > MAX_CACHED) cache.delete(cache.keys().next().value!);
  }
  return promise;
}

async function load(source: CharacterSource): Promise<CharacterAssetData> {
  if (source.kind === 'recipe') {
    const { root, clips } = buildCharacter(source.recipe);
    return { scene: root, animations: clips };
  }
  const loader = new GLTFLoader();
  if (source.id === 'default') {
    const gltf = await loader.loadAsync(DEFAULT_MODEL_URL);
    return { scene: gltf.scene, animations: gltf.animations };
  }
  const bytes = await window.aquamate.characters.load(source.id);
  if (!bytes) throw new Error('This character file is missing.');
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const gltf = await loader.parseAsync(buffer, '');
  return { scene: gltf.scene, animations: gltf.animations };
}
