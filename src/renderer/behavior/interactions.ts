/**
 * What the companion does, as data. Each interaction is a list of steps run
 * in order by the Director (walks and one-shot animations are awaited).
 * To add an interaction, add an entry here and trigger it from the overlay.
 */
import type { AnimationRole, Expression } from '../character/registry';
import type { MessageKey } from './messages';

export type Mark = 'stop' | 'exitLeft' | 'exitRight';
export type Facing = 'user' | 'front' | 'left' | 'right' | 'drink';

export type Step =
  | { do: 'stage'; at?: Mark } // place the character (default: off-screen right), full bottle, neutral face
  | { do: 'walk'; to: Mark; style?: 'normal' | 'sad' }
  | { do: 'face'; to: Facing }
  | { do: 'play'; animation: AnimationRole } // once, waits until it finishes
  | { do: 'loop'; animation: AnimationRole }
  | { do: 'expression'; name: Expression }
  | { do: 'say'; message: MessageKey | null; actions?: boolean }
  | { do: 'wait'; seconds: number };

export type InteractionName = 'arrive' | 'drank' | 'later' | 'skip' | 'timeout' | 'homeIdle' | 'homeDrink' | 'homePoke';

export const INTERACTIONS: Record<InteractionName, Step[]> = {
  // Walk in from the right with the bottle, wave, remind.
  arrive: [
    { do: 'stage' },
    { do: 'expression', name: 'neutral' },
    { do: 'walk', to: 'stop' },
    { do: 'face', to: 'user' },
    { do: 'expression', name: 'happy' },
    { do: 'say', message: 'reminder', actions: true },
    { do: 'play', animation: 'Wave' },
    { do: 'expression', name: 'neutral' },
    { do: 'loop', animation: 'Idle' },
  ],
  // Drink together, celebrate, walk back out happily.
  drank: [
    { do: 'say', message: 'cheers' },
    { do: 'face', to: 'drink' },
    { do: 'expression', name: 'drinking' },
    { do: 'play', animation: 'Drink' },
    { do: 'face', to: 'user' },
    { do: 'expression', name: 'joyful' },
    { do: 'say', message: 'greatJob' },
    { do: 'loop', animation: 'Happy' },
    { do: 'wait', seconds: 2.4 },
    { do: 'say', message: null },
    { do: 'expression', name: 'happy' },
    { do: 'walk', to: 'exitRight' },
  ],
  // Disappointed: sigh, then trudge all the way across the screen to the left.
  later: [
    { do: 'say', message: 'later' },
    { do: 'expression', name: 'sad' },
    { do: 'play', animation: 'Sad' },
    { do: 'say', message: null },
    { do: 'walk', to: 'exitLeft', style: 'sad' },
  ],
  // ✕: no fuss, just leave.
  skip: [
    { do: 'say', message: null },
    { do: 'expression', name: 'neutral' },
    { do: 'walk', to: 'exitRight' },
  ],
  // Nobody answered for a while: a quiet, sad exit.
  timeout: [
    { do: 'say', message: 'missed' },
    { do: 'expression', name: 'sad' },
    { do: 'wait', seconds: 2 },
    { do: 'say', message: null },
    { do: 'walk', to: 'exitLeft', style: 'sad' },
  ],

  // ---- Android Today screen: the character lives on the home screen.
  homeIdle: [
    { do: 'stage', at: 'stop' },
    { do: 'face', to: 'front' },
    { do: 'expression', name: 'neutral' },
    { do: 'loop', animation: 'Idle' },
  ],
  // "I drank a glass" on the Today screen: he drinks along and cheers.
  homeDrink: [
    { do: 'say', message: 'cheers' },
    { do: 'face', to: 'drink' },
    { do: 'expression', name: 'drinking' },
    { do: 'play', animation: 'Drink' },
    { do: 'face', to: 'front' },
    { do: 'expression', name: 'joyful' },
    { do: 'say', message: 'greatJob' },
    { do: 'play', animation: 'Happy' },
    { do: 'wait', seconds: 1.4 },
    { do: 'say', message: null },
    { do: 'expression', name: 'neutral' },
    { do: 'loop', animation: 'Idle' },
  ],
  // Tapping the character: a friendly wave.
  homePoke: [
    { do: 'expression', name: 'happy' },
    { do: 'say', message: 'hello' },
    { do: 'play', animation: 'Wave' },
    { do: 'say', message: null },
    { do: 'expression', name: 'neutral' },
    { do: 'loop', animation: 'Idle' },
  ],
};
