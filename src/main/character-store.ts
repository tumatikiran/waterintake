import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import type { CharacterInfo, SaveCreatedInput } from '../shared/types';
import { sanitizeRecipe } from '../shared/recipe';
import { JsonFile } from './stores';

/** The bundled character (assets/models/human-character.glb). */
export const BUILTIN_CHARACTER: CharacterInfo = { id: 'default', name: 'Aqua', kind: 'builtin', revision: 1, createdAt: 0 };

const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;
const MAX_CREATED_BYTES = 10 * 1024 * 1024;
const MAX_THUMBNAIL_CHARS = 600_000;
const ID = /^c_[0-9a-f]{12}$/;

const cleanName = (name: unknown, fallback: string) =>
  (typeof name === 'string' ? name : '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 40) || fallback;

const cleanThumbnail = (v: unknown) =>
  typeof v === 'string' && v.startsWith('data:image/png;base64,') && v.length <= MAX_THUMBNAIL_CHARS ? v : undefined;

/** Throws a user-readable error unless the bytes are a complete binary glTF 2.0 file. */
export function assertGlb(data: Uint8Array): void {
  if (data.byteLength < 20) throw new Error('The file is empty or too small to be a 3D model.');
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67) throw new Error('This is not a binary glTF (.glb) file.');
  if (view.getUint32(4, true) !== 2) throw new Error('Only glTF 2.0 models are supported.');
  if (view.getUint32(8, true) !== data.byteLength) throw new Error('The file looks truncated or corrupted.');
}

function sanitizeIndex(v: unknown): CharacterInfo[] {
  if (!Array.isArray(v)) return [];
  return v.flatMap((raw): CharacterInfo[] => {
    if (typeof raw !== 'object' || raw === null) return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || !ID.test(r.id) || (r.kind !== 'created' && r.kind !== 'uploaded')) return [];
    return [
      {
        id: r.id,
        name: cleanName(r.name, 'My character'),
        kind: r.kind,
        revision: typeof r.revision === 'number' && r.revision > 0 ? Math.floor(r.revision) : 1,
        thumbnail: cleanThumbnail(r.thumbnail),
        recipe: r.kind === 'created' ? sanitizeRecipe(r.recipe) : undefined,
        animations: Array.isArray(r.animations) ? r.animations.filter((a) => typeof a === 'string').slice(0, 20) : undefined,
        createdAt: typeof r.createdAt === 'number' ? r.createdAt : Date.now(),
      },
    ];
  });
}

/**
 * Custom characters live in <userData>/characters: one .glb per character and
 * an index.json with names, thumbnails and recipes. File names are always ids
 * this store generated, never paths that came from the renderer.
 */
export class CharacterStore {
  private items: CharacterInfo[];
  private readonly index: JsonFile<CharacterInfo[]>;

  constructor(private readonly dir: string) {
    this.index = new JsonFile(path.join(dir, 'index.json'), sanitizeIndex);
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
    if (stat.size > MAX_UPLOAD_BYTES) throw new Error('The model is larger than 30 MB. Please use a lighter model.');
    const data = await fsp.readFile(source);
    assertGlb(data);
    const info: CharacterInfo = {
      id: this.newId(),
      name: cleanName(path.basename(source, path.extname(source)), 'My character'),
      kind: 'uploaded',
      revision: 1,
      createdAt: Date.now(),
    };
    await this.writeModel(info.id, data);
    this.items.push(info);
    this.save();
    return info;
  }

  async saveCreated(input: SaveCreatedInput): Promise<CharacterInfo> {
    const glb = input.glb instanceof Uint8Array ? input.glb : new Uint8Array();
    if (glb.byteLength > MAX_CREATED_BYTES) throw new Error('The character is too large.');
    assertGlb(glb);
    const existing = typeof input.id === 'string' ? this.items.find((c) => c.id === input.id && c.kind === 'created') : undefined;
    const info: CharacterInfo = {
      id: existing?.id ?? this.newId(),
      name: cleanName(input.name, 'My character'),
      kind: 'created',
      revision: (existing?.revision ?? 0) + 1,
      thumbnail: cleanThumbnail(input.thumbnail),
      recipe: sanitizeRecipe(input.recipe),
      createdAt: existing?.createdAt ?? Date.now(),
    };
    await this.writeModel(info.id, glb);
    this.items = existing ? this.items.map((c) => (c.id === info.id ? info : c)) : [...this.items, info];
    this.save();
    return info;
  }

  update(id: string, patch: { name?: unknown; thumbnail?: unknown; animations?: unknown }): CharacterInfo | null {
    const item = this.items.find((c) => c.id === id);
    if (!item) return null;
    if (patch.name !== undefined) item.name = cleanName(patch.name, item.name);
    if (patch.thumbnail !== undefined) item.thumbnail = cleanThumbnail(patch.thumbnail) ?? item.thumbnail;
    if (Array.isArray(patch.animations)) item.animations = patch.animations.filter((a) => typeof a === 'string').slice(0, 20);
    this.save();
    return item;
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

  private newId(): string {
    return `c_${crypto.randomBytes(6).toString('hex')}`;
  }

  private modelPath(id: string): string {
    if (!ID.test(id)) throw new Error('Invalid character id');
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
