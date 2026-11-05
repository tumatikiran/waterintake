/**
 * The vocabulary every character speaks. To add an animation or expression,
 * add it here, then use it from behavior/interactions.ts. Models that lack a
 * clip or morph target fall back gracefully, so uploaded characters keep working.
 */

// ---------------------------------------------------------------- animations
export type AnimationRole = 'Idle' | 'Walk' | 'Wave' | 'Drink' | 'Happy' | 'Sad' | 'SadWalk';

export interface RoleSpec {
  /** Clip names that fill this role (case-insensitive; "Armature|walk" style prefixes are ignored). */
  aliases: string[];
  /** Roles to use when the model has no clip for this one, in order. */
  fallback: AnimationRole[];
  loop: boolean;
  /** For one-shots played with a looping fallback: roughly how long to keep playing it. */
  seconds?: number;
}

export const ANIMATION_ROLES: Record<AnimationRole, RoleSpec> = {
  Idle: { aliases: ['idle', 'breathing', 'breathingidle', 'stand', 'standing'], fallback: [], loop: true },
  Walk: { aliases: ['walk', 'walking', 'walkcycle'], fallback: ['Idle'], loop: true },
  Wave: { aliases: ['wave', 'waving', 'hello', 'greeting', 'greet'], fallback: ['Happy', 'Idle'], loop: false, seconds: 2 },
  Drink: { aliases: ['drink', 'drinking', 'sip', 'drinkwater'], fallback: ['Happy', 'Idle'], loop: false, seconds: 3.5 },
  Happy: {
    aliases: ['happy', 'cheer', 'cheering', 'celebrate', 'victory', 'jump', 'thumbsup', 'yes', 'dance'],
    fallback: ['Wave', 'Idle'],
    loop: true,
  },
  Sad: { aliases: ['sad', 'disappointed', 'sigh', 'defeated', 'upset', 'no'], fallback: ['Idle'], loop: false, seconds: 1.8 },
  SadWalk: { aliases: ['sadwalk', 'walksad', 'sadwalking', 'tiredwalk', 'slowwalk'], fallback: ['Walk'], loop: true },
};

export const ROLE_ORDER = Object.keys(ANIMATION_ROLES) as AnimationRole[];

// --------------------------------------------------------------- expressions
/** A face "muscle" driven by morph targets. */
export type ExpressionChannel = 'happy' | 'sad' | 'blink';

/**
 * Morph target names that can drive each channel, tried in order. A group
 * applies only when the model has every name in it. Covers AquaMate's own
 * models, ARKit-style blendshapes (Ready Player Me and others) and VRoid.
 */
export const EXPRESSION_CHANNELS: Record<ExpressionChannel, string[][]> = {
  happy: [['happy'], ['mouthSmile'], ['mouthSmileLeft', 'mouthSmileRight'], ['Fcl_ALL_Joy'], ['joy']],
  sad: [['sad'], ['mouthFrownLeft', 'mouthFrownRight', 'browInnerUp'], ['Fcl_ALL_Sorrow'], ['sorrow']],
  blink: [['blink'], ['eyesClosed'], ['eyeBlinkLeft', 'eyeBlinkRight'], ['Fcl_EYE_Close']],
};

export type Expression = 'neutral' | 'happy' | 'joyful' | 'sad' | 'drinking';

export const EXPRESSIONS: Record<Expression, Partial<Record<ExpressionChannel, number>>> = {
  neutral: {},
  happy: { happy: 1 },
  joyful: { happy: 1, blink: 0.85 }, // big smile, eyes squeezed shut
  sad: { sad: 1 },
  drinking: { blink: 0.9 }, // eyes closed while drinking
};
