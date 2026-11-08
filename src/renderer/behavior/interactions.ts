/**
 * What the companion does, as data. Each interaction is a list of steps run
 * in order by the Director (walks and one-shot animations are awaited).
 * To add an interaction, add an entry here and trigger it from the overlay.
 */
import type { AnimationRole, Expression } from '../character/registry';
import type { PropId } from '../character/props';
import type { CompanionScript } from '../../shared/companion';
import type { MessageKey } from './messages';

export type Mark = 'stop' | 'center' | 'exitLeft' | 'exitRight';
export type Facing = 'user' | 'front' | 'left' | 'right' | 'drink';
export type Gait = 'walk' | 'run';

/**
 * How the character leaves at the end of a script (the user's settings):
 * which edge he heads for and whether he walks or runs. A walk step whose
 * target is 'exit' uses it.
 */
export interface Leave {
  to: 'exitLeft' | 'exitRight';
  gait: Gait;
}

export type Step =
  | { do: 'stage'; at?: Mark } // place the character (default: off-screen right), empty hands, neutral face
  | { do: 'prop'; id: PropId | 'reminder' | null } // bring something out (or put it away); 'reminder': the reminder type's item
  | { do: 'walk'; to: Mark | 'exit'; style?: 'normal' | 'sad' }
  | { do: 'face'; to: Facing }
  | { do: 'play'; animation: AnimationRole } // once, waits until it finishes
  | { do: 'loop'; animation: AnimationRole; fade?: number } // fade: cross-fade seconds (0 = cut)
  | { do: 'expression'; name: Expression }
  | { do: 'say'; message: MessageKey | null; actions?: boolean }
  | { do: 'wait'; seconds: number };

export type InteractionName =
  | 'arrive'
  | 'drank'
  | 'later'
  | 'skip'
  | 'timeout'
  | 'relax'
  | 'wake'
  | 'wakeToRemind'
  | 'remindHere'
  | 'wakeFromSleep'
  | 'wakeFromSleepToRemind'
  | 'doze'
  | 'homeIdle'
  | 'homeDrink'
  | 'homePoke'
  | 'homeRelax'
  | 'homeSeated'
  | 'homeWake'
  | 'homeStandUp'
  | 'homeWakeFromSleep'
  | 'homeStretchUp';

/** Relax mode: settle down on the floor, then let the eyes close. Relaxing is prop-free. */
const SIT_DOWN: Step[] = [
  { do: 'prop', id: null },
  { do: 'face', to: 'front' },
  { do: 'wait', seconds: 0.4 },
  { do: 'expression', name: 'happy' },
  { do: 'play', animation: 'SitDown' },
  { do: 'loop', animation: 'Relax' },
  { do: 'wait', seconds: 0.6 },
  { do: 'expression', name: 'relaxed' },
];
/** Open the eyes slowly, then get up. */
const STAND_UP: Step[] = [
  { do: 'expression', name: 'neutral' },
  { do: 'wait', seconds: 1 },
  { do: 'play', animation: 'StandUp' },
  { do: 'loop', animation: 'Idle' },
];

/** Dozed off: still sitting, but deeper and slower; the host shows the "zzz". */
const DOZE: Step[] = [
  { do: 'loop', animation: 'Doze', fade: 2.5 },
  { do: 'expression', name: 'asleep' },
];
/** Waking from a nap: a big seated stretch and a yawn first. */
const STRETCH: Step[] = [
  { do: 'expression', name: 'yawn' },
  { do: 'play', animation: 'Stretch' },
  { do: 'expression', name: 'neutral' },
];
/** Up and refreshed: say so, wave, and leave the way the user chose. */
const REFRESHED_LEAVE: Step[] = [
  { do: 'expression', name: 'joyful' },
  { do: 'say', message: 'refreshed' },
  { do: 'play', animation: 'Wave' },
  { do: 'expression', name: 'happy' },
  { do: 'wait', seconds: 0.8 },
  { do: 'say', message: null },
  { do: 'walk', to: 'exit' },
];
/** Up and refreshed on the Today screen: he stays. */
const REFRESHED_STAY: Step[] = [
  { do: 'expression', name: 'joyful' },
  { do: 'say', message: 'refreshed' },
  { do: 'play', animation: 'Wave' },
  { do: 'loop', animation: 'Idle' },
  { do: 'wait', seconds: 0.8 },
  { do: 'say', message: null },
  { do: 'expression', name: 'neutral' },
];

/** Walk in carrying the reminder's item (it shows what the reminder is for), wave, remind. */
const REMIND: Step[] = [
  { do: 'prop', id: 'reminder' },
  { do: 'expression', name: 'neutral' },
  { do: 'walk', to: 'stop' },
  { do: 'face', to: 'user' },
  { do: 'expression', name: 'happy' },
  { do: 'say', message: 'reminder', actions: true },
  { do: 'play', animation: 'Wave' },
  { do: 'expression', name: 'neutral' },
  { do: 'loop', animation: 'Idle' },
];

export const INTERACTIONS: Record<InteractionName, Step[]> = {
  // Walk in from the right with the bottle, wave, remind.
  arrive: [{ do: 'stage' }, ...REMIND],
  // Drink together, celebrate, leave happily.
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
    { do: 'walk', to: 'exit' },
  ],
  // Disappointed: sigh, then leave sadly.
  later: [
    { do: 'say', message: 'later' },
    { do: 'expression', name: 'sad' },
    { do: 'play', animation: 'Sad' },
    { do: 'say', message: null },
    { do: 'walk', to: 'exit', style: 'sad' },
  ],
  // ✕: no fuss, just leave.
  skip: [
    { do: 'say', message: null },
    { do: 'expression', name: 'neutral' },
    { do: 'walk', to: 'exit' },
  ],
  // Nobody answered for a while: a quiet, sad exit.
  timeout: [
    { do: 'say', message: 'missed' },
    { do: 'expression', name: 'sad' },
    { do: 'wait', seconds: 2 },
    { do: 'say', message: null },
    { do: 'walk', to: 'exit', style: 'sad' },
  ],

  // ---- Relax mode (desktop): walk to the middle of the screen, sit down,
  // close the eyes and breathe slowly until Relax mode is turned off.
  relax: [
    { do: 'stage' },
    { do: 'expression', name: 'happy' },
    { do: 'say', message: 'relax' },
    { do: 'walk', to: 'center' },
    ...SIT_DOWN,
    { do: 'wait', seconds: 2.5 },
    { do: 'say', message: null },
  ],
  // Relax mode turned off: get up refreshed, stretch, and leave.
  wake: [{ do: 'say', message: null }, ...STAND_UP, ...REFRESHED_LEAVE],
  wakeFromSleep: [{ do: 'say', message: null }, ...STRETCH, ...STAND_UP, ...REFRESHED_LEAVE],
  // Relaxing long enough: doze off (overlay and Today screen alike).
  doze: DOZE,
  // A reminder came while relaxing: get up and remind from where he was sitting.
  wakeToRemind: [{ do: 'say', message: null }, ...STAND_UP, ...REMIND],
  wakeFromSleepToRemind: [{ do: 'say', message: null }, ...STRETCH, ...STAND_UP, ...REMIND],
  // A reminder came while he was still on his way to sit down.
  remindHere: [{ do: 'say', message: null }, ...REMIND],

  // ---- Android Today screen: the character lives on the home screen.
  homeIdle: [
    { do: 'stage', at: 'stop' },
    { do: 'face', to: 'front' },
    { do: 'expression', name: 'neutral' },
    { do: 'loop', animation: 'Idle' },
  ],
  // "I drank a glass" on the Today screen: he drinks along and cheers.
  homeDrink: [
    { do: 'prop', id: 'waterBottle' },
    { do: 'wait', seconds: 0.3 },
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
    { do: 'prop', id: null }, // put it away again
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
  // Relax on the Today screen: sit down right there.
  homeRelax: [{ do: 'say', message: 'relax' }, ...SIT_DOWN, { do: 'wait', seconds: 2.5 }, { do: 'say', message: null }],
  // Opening the Today screen while relaxing: already sitting.
  homeSeated: [
    { do: 'stage', at: 'stop' },
    { do: 'face', to: 'front' },
    { do: 'loop', animation: 'Relax', fade: 0 },
    { do: 'expression', name: 'relaxed' },
  ],
  // Getting up to drink along.
  homeStandUp: [{ do: 'say', message: null }, ...STAND_UP],
  homeStretchUp: [{ do: 'say', message: null }, ...STRETCH, ...STAND_UP],
  homeWake: [{ do: 'say', message: null }, ...STAND_UP, ...REFRESHED_STAY],
  homeWakeFromSleep: [{ do: 'say', message: null }, ...STRETCH, ...STAND_UP, ...REFRESHED_STAY],
};

// Every script the state machine (shared/companion.ts) can ask for exists here.
INTERACTIONS satisfies Record<CompanionScript, Step[]>;
