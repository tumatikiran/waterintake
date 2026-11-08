/**
 * The vocabulary every character speaks. To add an animation or expression,
 * add it here, then use it from behavior/interactions.ts. Models that lack a
 * clip or morph target fall back gracefully, so uploaded characters keep working.
 */

// ---------------------------------------------------------------- animations
export type AnimationRole = 'Idle' | 'Walk' | 'Wave' | 'Drink' | 'Happy' | 'Sad' | 'SadWalk' | 'Run' | 'SitDown' | 'Relax' | 'StandUp';

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
  // Without a run clip he plays the walk faster (see Mascot.tsx).
  Run: { aliases: ['run', 'running', 'runcycle', 'jog', 'jogging', 'sprint'], fallback: ['Walk'], loop: true },
  // Relax mode: sit down, breathe calmly while seated, stand back up. Models
  // without them relax standing (Idle) with their eyes closed.
  SitDown: { aliases: ['sitdown', 'standtosit', 'sittingdown'], fallback: ['Idle'], loop: false, seconds: 1.2 },
  Relax: {
    aliases: ['relax', 'relaxing', 'sit', 'sitting', 'sittingidle', 'seated', 'meditate', 'meditating', 'meditation'],
    fallback: ['Idle'],
    loop: true,
  },
  StandUp: { aliases: ['standup', 'sittostand', 'getup', 'standingup'], fallback: ['Idle'], loop: false, seconds: 1 },
};

export const ROLE_ORDER = Object.keys(ANIMATION_ROLES) as AnimationRole[];

/**
 * Roles whose clip moves the right arm itself even while it holds a prop:
 * drinking brings the bottle to the mouth, cheering throws both arms up.
 * Every other role uses the hand pose (carrying) while holding something.
 */
export const ARMS_OWN: readonly AnimationRole[] = ['Drink', 'Happy'];

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

export type Expression = 'neutral' | 'happy' | 'joyful' | 'sad' | 'drinking' | 'relaxed';

export const EXPRESSIONS: Record<Expression, Partial<Record<ExpressionChannel, number>>> = {
  neutral: {},
  happy: { happy: 1 },
  joyful: { happy: 1, blink: 0.85 }, // big smile, eyes squeezed shut
  sad: { sad: 1 },
  drinking: { blink: 0.9 }, // eyes closed while drinking
  relaxed: { blink: 1, happy: 0.3 }, // eyes gently closed, a faint smile
};

/** Expressions that ease in (and out) slowly, in units of 1/s; the rest change at a normal pace. */
export const EXPRESSION_EASE: Partial<Record<Expression, number>> = { relaxed: 1.6 };
