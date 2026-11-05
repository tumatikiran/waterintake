import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import type { CharacterInfo, SaveCreatedInput } from '../shared/types';
import {
  BUILTIN_CHARACTER,
  CHARACTER_ID,
  CHARACTER_LIMITS,
  assertGlb,
  createdRecord,
  newCharacterId,
  patchRecord,
  sanitizeCharacterIndex,
  uploadedRecord,
} from '../shared/characters';
import { JsonFile } from './stores';

export { BUILTIN_CHARACTER, assertGlb };

/**
 * Custom characters live in <userData>/characters: one .glb per character and
 * an index.json with names, thumbnails and recipes. File names are always ids
 * this store generated, never paths that came from the renderer.
 */
export class CharacterStore {
  private items: CharacterInfo[];
  private readonly index: JsonFile<CharacterInfo[]>;

  constructor(private readonly dir: string) {
    this.index = new JsonFile(path.join(dir, 'index.json'), sanitizeCharacterIndex);
    this.items = this.index.read().filter((c) => fs.existsSync(this.modelPath(c.id)));
  }

  list(): CharacterInfo[] {
    return [BUILTIN_CHARACTER, ...this.items];
  }

  get(id: string): CharacterInfo | null {
    return this.list().find((c) => c.id === id) ?? null;
  }

  async importGlb(source: string): Promise<CharacterInfo> {
    const stat = await fsp.stat(source);
    if (!stat.isFile()) throw new Error('Please choose a .glb file.');
    if (stat.size > CHARACTER_LIMITS.uploadBytes) throw new Error('The model is larger than 30 MB. Please use a lighter model.');
    const data = await fsp.readFile(source);
    assertGlb(data);
    const info = uploadedRecord(newCharacterId(), path.basename(source));
    await this.writeModel(info.id, data);
    this.items.push(info);
    this.save();
    return info;
  }

  async saveCreated(input: SaveCreatedInput): Promise<CharacterInfo> {
    const glb = input.glb instanceof Uint8Array ? input.glb : new Uint8Array();
    if (glb.byteLength > CHARACTER_LIMITS.createdBytes) throw new Error('The character is too large.');
    assertGlb(glb);
    const existing = typeof input.id === 'string' ? this.items.find((c) => c.id === input.id && c.kind === 'created') : undefined;
    const info = createdRecord(existing?.id ?? newCharacterId(), input, existing);
    await this.writeModel(info.id, glb);
    this.items = existing ? this.items.map((c) => (c.id === info.id ? info : c)) : [...this.items, info];
    this.save();
    return info;
  }

  update(id: string, patch: { name?: unknown; thumbnail?: unknown; animations?: unknown }): CharacterInfo | null {
    const item = this.items.find((c) => c.id === id);
    if (!item) return null;
    const next = patchRecord(item, patch);
    this.items = this.items.map((c) => (c.id === id ? next : c));
    this.save();
    return next;
  }

  async remove(id: string): Promise<boolean> {
    const item = this.items.find((c) => c.id === id);
    if (!item) return false;
    this.items = this.items.filter((c) => c.id !== id);
    this.save();
    await fsp.rm(this.modelPath(id), { force: true });
    return true;
  }

  async readModel(id: string): Promise<Uint8Array | null> {
    if (!this.items.some((c) => c.id === id)) return null;
    try {
      return new Uint8Array(await fsp.readFile(this.modelPath(id)));
    } catch {
      return null;
    }
  }

  private modelPath(id: string): string {
    if (!CHARACTER_ID.test(id)) throw new Error('Invalid character id');
    return path.join(this.dir, `${id}.glb`);
  }

  private async writeModel(id: string, data: Uint8Array): Promise<void> {
    await fsp.mkdir(this.dir, { recursive: true });
    const target = this.modelPath(id);
    const tmp = `${target}.tmp`;
    await fsp.writeFile(tmp, data);
    await fsp.rename(tmp, target);
  }

  private save(): void {
    this.index.write(this.items);
  }
}
