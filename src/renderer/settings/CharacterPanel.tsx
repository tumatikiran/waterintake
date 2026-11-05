import { useEffect, useState } from 'react';
import type { AppState, CharacterInfo, CharacterRecipe } from '../../shared/types';
import { DEFAULT_RECIPE, HAIR_COLORS, HAIR_STYLES, OUTFIT_COLORS, SKIN_TONES } from '../../shared/recipe';
import { buildCharacter } from '../character/procedural';
import { loadCharacterAsset, type CharacterSource } from '../character/assets';
import { createRig } from '../character/rig';
import { exportGlb, renderThumbnail } from '../character/snapshot';
import { ROLE_ORDER } from '../character/registry';
import { CharacterPreview } from './CharacterPreview';
import { Notice, Row, Segmented, Swatches, Toggle } from './controls';

const stored = (c: CharacterInfo): CharacterSource => ({ kind: 'stored', id: c.id, revision: c.revision });
const KIND_LABEL = { builtin: 'Built-in', created: 'Created', uploaded: 'Uploaded' } as const;

// The built-in thumbnail is rendered once per session (it isn't stored).
let builtinThumb: Promise<string> | null = null;

function Thumbnail({ character }: { character: CharacterInfo }) {
  const [src, setSrc] = useState(character.thumbnail);
  useEffect(() => {
    if (character.thumbnail) return setSrc(character.thumbnail);
    if (character.kind !== 'builtin') return;
    builtinThumb ??= renderThumbnail(stored(character));
    let alive = true;
    builtinThumb.then((url) => alive && setSrc(url)).catch(() => {});
    return () => {
      alive = false;
    };
  }, [character]);
  return src ? <img src={src} alt="" className="thumb" draggable={false} /> : <div className="thumb thumb-empty" aria-hidden>💧</div>;
}

type Mode = { kind: 'view' } | { kind: 'create'; editing?: CharacterInfo };
type Status = { kind: 'success' | 'error' | 'info'; text: string } | null;

export function CharacterPanel({ state }: { state: AppState }) {
  const activeId = state.settings.characterId;
  const [focusId, setFocusId] = useState(activeId);
  const [mode, setMode] = useState<Mode>({ kind: 'view' });
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const focus = state.characters.find((c) => c.id === focusId) ?? state.characters[0];

  const upload = async () => {
    setStatus(null);
    const res = await window.aquamate.characters.import();
    if (!res.ok) {
      if ('error' in res) setStatus({ kind: 'error', text: res.error });
      return;
    }
    const c = res.character;
    setBusy(true);
    try {
      // Make sure three.js can actually load it before keeping it.
      const rig = createRig(await loadCharacterAsset(stored(c)));
      const found = rig.animations.found;
      const hasFace = rig.expressions.supported;
      const hasBottle = rig.bottle !== null;
      rig.dispose();
      const thumbnail = await renderThumbnail(stored(c));
      await window.aquamate.characters.update(c.id, { thumbnail, animations: found });
      await window.aquamate.characters.select(c.id);
      setFocusId(c.id);
      const missing = ROLE_ORDER.filter((r) => !found.includes(r));
      const notes = [
        missing.length ? `No ${missing.join(', ')} animation${missing.length > 1 ? 's' : ''}, so similar ones stand in.` : 'All animations found.',
        hasFace ? '' : 'No facial expressions.',
        hasBottle ? '' : 'No right-hand bone found, so there is no bottle.',
      ].filter(Boolean);
      setStatus({ kind: 'success', text: `${c.name} is now your companion. ${notes.join(' ')}` });
    } catch (err) {
      await window.aquamate.characters.remove(c.id);
      const reason = err instanceof Error ? err.message : String(err);
      setStatus({ kind: 'error', text: `That model couldn't be loaded (${reason}). Use an uncompressed .glb with a skinned mesh.` });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: CharacterInfo) => {
    if (!window.confirm(`Delete “${c.name}”? This can't be undone.`)) return;
    await window.aquamate.characters.remove(c.id);
    setFocusId(activeId === c.id ? 'default' : activeId);
    setStatus({ kind: 'info', text: `${c.name} was deleted.` });
  };

  if (mode.kind === 'create') {
    return (
      <CharacterCreator
        editing={mode.editing}
        onCancel={() => setMode({ kind: 'view' })}
        onSaved={(c) => {
          setMode({ kind: 'view' });
          setFocusId(c.id);
          const how = state.app.mobile ? 'Tap “Remind me now” on the Today tab' : 'Click “Test reminder”';
          setStatus({ kind: 'success', text: `${c.name} is now your companion. ${how} to see them.` });
        }}
      />
    );
  }

  return (
    <div className="character-layout">
      <div className="gallery-col">
        <div className="gallery-actions">
          <button type="button" className="btn btn-primary" onClick={() => setMode({ kind: 'create' })}>
            Create character
          </button>
          <button type="button" className="btn btn-ghost" onClick={upload} disabled={busy}>
            {busy ? 'Checking model…' : 'Upload .glb'}
          </button>
        </div>
        {status && (
          <Notice kind={status.kind} onClose={() => setStatus(null)}>
            {status.text}
          </Notice>
        )}
        <ul className="gallery" aria-label="Characters">
          {state.characters.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className={`gallery-card${c.id === focus.id ? ' is-focused' : ''}`}
                aria-pressed={c.id === focus.id}
                onClick={() => setFocusId(c.id)}
                data-testid={`character-${c.kind}`}
              >
                <Thumbnail character={c} />
                <span className="gallery-name">{c.name}</span>
                <span className="gallery-meta">
                  {KIND_LABEL[c.kind]}
                  {c.id === activeId && <span className="badge">Active</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      <div className="preview-col">
        <div className="preview-head">
          <div>
            <h2>{focus.name}</h2>
            <p className="muted">
              {focus.kind === 'uploaded'
                ? 'Uploaded model. Animations it lacks use stand-ins (shown dimmed).'
                : focus.kind === 'created'
                  ? 'Made in the character creator.'
                  : 'The default AquaMate companion.'}
            </p>
          </div>
          <div className="preview-actions">
            {focus.kind === 'created' && (
              <button type="button" className="btn btn-ghost btn-small" onClick={() => setMode({ kind: 'create', editing: focus })}>
                Edit
              </button>
            )}
            {focus.kind !== 'builtin' && (
              <button type="button" className="btn btn-danger btn-small" onClick={() => remove(focus)}>
                Delete
              </button>
            )}
            {focus.id === activeId ? (
              <span className="badge badge-lg">Your companion</span>
            ) : (
              <button type="button" className="btn btn-primary btn-small" onClick={() => window.aquamate.characters.select(focus.id)}>
                Use as companion
              </button>
            )}
          </div>
        </div>
        <CharacterPreview source={stored(focus)} />
      </div>
    </div>
  );
}

// ----------------------------------------------------------------- creator
function CharacterCreator({ editing, onCancel, onSaved }: { editing?: CharacterInfo; onCancel: () => void; onSaved: (c: CharacterInfo) => void }) {
  const [recipe, setRecipe] = useState<CharacterRecipe>(editing?.recipe ?? DEFAULT_RECIPE);
  const [name, setName] = useState(editing?.name ?? 'My buddy');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = <K extends keyof CharacterRecipe>(key: K, value: CharacterRecipe[K]) => setRecipe((r) => ({ ...r, [key]: value }));

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const { root, clips } = buildCharacter(recipe);
      const glb = await exportGlb(root, clips);
      const thumbnail = await renderThumbnail({ kind: 'recipe', recipe });
      const info = await window.aquamate.characters.saveCreated({ id: editing?.id, name, recipe, glb, thumbnail });
      await window.aquamate.characters.select(info.id);
      onSaved(info);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving failed.');
      setSaving(false);
    }
  };

  return (
    <div className="character-layout creator">
      <div className="creator-form">
        <div className="creator-head">
          <h2>{editing ? `Edit ${editing.name}` : 'Create your companion'}</h2>
          <p className="muted">Changes show up live in the preview.</p>
        </div>
        <Row label="Name" htmlFor="char-name">
          <input id="char-name" className="text-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        </Row>
        <Row label="Skin tone">
          <Swatches label="Skin tone" value={recipe.skinTone} colors={SKIN_TONES} onChange={(v) => set('skinTone', v)} />
        </Row>
        <Row label="Hair">
          <Segmented label="Hair style" value={recipe.hairStyle} options={HAIR_STYLES.map((h) => ({ value: h.id, label: h.label }))} onChange={(v) => set('hairStyle', v)} />
        </Row>
        <Row label="Hair color">
          <Swatches label="Hair color" value={recipe.hairColor} colors={HAIR_COLORS} onChange={(v) => set('hairColor', v)} />
        </Row>
        <Row label="Shirt">
          <Swatches label="Shirt color" value={recipe.shirtColor} colors={OUTFIT_COLORS} onChange={(v) => set('shirtColor', v)} />
        </Row>
        <Row label="Stripe and collar">
          <Swatches label="Accent color" value={recipe.accentColor} colors={OUTFIT_COLORS} onChange={(v) => set('accentColor', v)} />
        </Row>
        <Row label="Trousers">
          <Swatches label="Trouser color" value={recipe.pantsColor} colors={OUTFIT_COLORS} onChange={(v) => set('pantsColor', v)} />
        </Row>
        <Row label="Sneakers">
          <Swatches label="Sneaker color" value={recipe.shoeColor} colors={OUTFIT_COLORS} onChange={(v) => set('shoeColor', v)} />
        </Row>
        <Row label="Glasses">
          <Toggle label="Glasses" checked={recipe.glasses} onChange={(v) => set('glasses', v)} />
        </Row>
        <Row label="Beard">
          <Toggle label="Beard" checked={recipe.beard} onChange={(v) => set('beard', v)} />
        </Row>
        {error && <Notice kind="error">{error}</Notice>}
        <div className="creator-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={saving || !name.trim()}>
            {saving ? 'Saving…' : editing ? 'Save changes' : 'Save and use'}
          </button>
        </div>
      </div>
      <div className="preview-col">
        <CharacterPreview source={{ kind: 'recipe', recipe }} />
      </div>
    </div>
  );
}
