/**
 * What the companion does, as data. Each interaction is a list of steps run
 * in order by the Director (walks and one-shot animations are awaited).
 * To add an interaction, add an entry here and trigger it from the overlay.
 */
import type { AnimationRole, Expression } from '../character/registry';
import type { MessageKey } from './messages';

export type Mark = 'stop' | 'exitLeft' | 'exitRight';

export type Step =
  | { do: 'stage' } // off-screen right, full bottle, neutral face
  | { do: 'walk'; to: Mark; style?: 'normal' | 'sad' }
  | { do: 'face'; to: 'user' | 'left' | 'right' | 'drink' }
  | { do: 'play'; animation: AnimationRole } // once, waits until it finishes
  | { do: 'loop'; animation: AnimationRole }
  | { do: 'expression'; name: Expression }
  | { do: 'say'; message: MessageKey | null; actions?: boolean }
  | { do: 'wait'; seconds: number };

export type InteractionName = 'arrive' | 'drank' | 'later' | 'skip' | 'timeout';

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
};
