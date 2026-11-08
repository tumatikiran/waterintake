import type { BodyType, CharacterRecipe, HairStyle } from './types';

/** The original AquaMate look: blue tee with white accents, navy chinos, white sneakers. */
export const DEFAULT_RECIPE: CharacterRecipe = {
  body: 'male',
  skinTone: '#f2c6a0',
  hairStyle: 'short',
  hairColor: '#4a3222',
  shirtColor: '#2f80ed',
  accentColor: '#f7f9fc',
  pantsColor: '#24467a',
  shoeColor: '#f7f9fc',
  glasses: false,
  beard: false,
};

/** The second built-in companion: teal tee, long hair, charcoal trousers. */
export const FEMALE_RECIPE: CharacterRecipe = {
  body: 'female',
  skinTone: '#e0a97e',
  hairStyle: 'long',
  hairColor: '#3a2418',
  shirtColor: '#1fa38a',
  accentColor: '#f7f9fc',
  pantsColor: '#3b4252',
  shoeColor: '#f7f9fc',
  glasses: false,
  beard: false,
};

export const BODY_TYPES: { id: BodyType; label: string }[] = [
  { id: 'male', label: 'Male' },
  { id: 'female', label: 'Female' },
];

export const HAIR_STYLES: { id: HairStyle; label: string }[] = [
  { id: 'short', label: 'Short' },
  { id: 'spiky', label: 'Spiky' },
  { id: 'long', label: 'Long' },
  { id: 'bun', label: 'Bun' },
  { id: 'buzz', label: 'Buzz' },
];

export const SKIN_TONES = ['#f6d7b8', '#f2c6a0', '#e0a97e', '#c68a5f', '#9a6440', '#6b4428'];
export const HAIR_COLORS = ['#1f1a17', '#4a3222', '#8a5a33', '#d8b26e', '#b54a2a', '#9aa0a8', '#3a5ba0'];
export const OUTFIT_COLORS = [
  '#2f80ed',
  '#1fa38a',
  '#46a758',
  '#f5a524',
  '#e5484d',
  '#ec5d9b',
  '#8e4ec6',
  '#24467a',
  '#3b4252',
  '#f7f9fc',
];

/**
 * Switches a recipe's body type. A hairstyle typical of the other body is
 * swapped for this body's usual one (you can still pick any style after),
 * and a female body never has a beard.
 */
export function withBody(recipe: CharacterRecipe, body: BodyType): CharacterRecipe {
  const swapHair = body === 'female' ? ['short', 'spiky', 'buzz'] : ['long', 'bun'];
  return {
    ...recipe,
    body,
    hairStyle: swapHair.includes(recipe.hairStyle) ? (body === 'female' ? FEMALE_RECIPE : DEFAULT_RECIPE).hairStyle : recipe.hairStyle,
    beard: body === 'female' ? false : recipe.beard,
  };
}

const HEX = /^#[0-9a-f]{6}$/i;

/** Validates a recipe received over IPC or read from disk. */
export function sanitizeRecipe(v: unknown): CharacterRecipe {
  const r = (typeof v === 'object' && v !== null ? v : {}) as Record<string, unknown>;
  const color = (key: keyof CharacterRecipe) =>
    typeof r[key] === 'string' && HEX.test(r[key] as string) ? (r[key] as string).toLowerCase() : (DEFAULT_RECIPE[key] as string);
  const body = BODY_TYPES.some((b) => b.id === r.body) ? (r.body as BodyType) : DEFAULT_RECIPE.body; // older recipes: male
  return {
    body,
    skinTone: color('skinTone'),
    hairStyle: HAIR_STYLES.some((h) => h.id === r.hairStyle) ? (r.hairStyle as HairStyle) : DEFAULT_RECIPE.hairStyle,
    hairColor: color('hairColor'),
    shirtColor: color('shirtColor'),
    accentColor: color('accentColor'),
    pantsColor: color('pantsColor'),
    shoeColor: color('shoeColor'),
    glasses: r.glasses === true,
    beard: r.beard === true && body !== 'female',
  };
}
