/**
 * The companion's states and how events move between them. Pure (no timers,
 * no rendering), so every transition is unit-tested; the desktop overlay and
 * Android's Today screen both drive their character through it.
 *
 *   offstage ─remind─▶ reminding ─answer─▶ answering ─done─▶ offstage
 *      │                    ▲
 *      └─relaxOn─▶ settling ─done─▶ resting ─doze─▶ sleeping
 *                     │  relaxOff / remind │            │
 *                     └────────────────────┴─▶ waking ◀─┘ (or straight into reminding)
 *
 * Each transition names the scripts to play (behavior/interactions.ts), in
 * order. The host plays them, then reports `done`.
 */

import type { AnswerScript } from './reminders';

/** Where the character lives: the desktop overlay (walks on and off) or Android's Today screen (always there). */
export type CompanionPlace = 'overlay' | 'home';

export type CompanionMode =
  | 'offstage' // overlay: not on screen
  | 'idle' // Today screen: standing around
  | 'acting' // Today screen: drinking along, waving
  | 'reminding' // walking in with the card, then waiting for an answer
  | 'answering' // playing the answer, then leaving
  | 'settling' // Relax mode: walking to the middle and sitting down
  | 'resting' // sitting, eyes closed, breathing slowly
  | 'sleeping' // dozed off: deeper breathing, "zzz"
  | 'waking'; // Relax mode over: getting up (and leaving, on the overlay)

export interface CompanionState {
  mode: CompanionMode;
  /** Settling: has the sit-down begun? (Before that there's nothing to get up from.) */
  seated: boolean;
}

export type CompanionEvent =
  | { type: 'enter'; relaxing: boolean } // Today screen shown, or a new character on it
  | { type: 'remind' }
  | { type: 'answer'; kind: AnswerScript } // the reminder type's "done" script, or later / skip / timeout
  | { type: 'relaxOn' }
  | { type: 'relaxOff' }
  | { type: 'seated' } // the sit-down began
  | { type: 'doze' } // rested long enough (the host's timer)
  | { type: 'drink' } // Today screen: a glass was logged
  | { type: 'poke' } // Today screen: the character was tapped
  | { type: 'done' }; // the scripts of the last transition finished

/** Script names; each must exist in behavior/interactions.ts (checked there by the type system). */
export type CompanionScript =
  | 'arrive'
  | 'drank'
  | 'tookMedicine'
  | 'later'
  | 'skip'
  | 'timeout'
  | 'relax'
  | 'wake'
  | 'wakeFromSleep'
  | 'wakeToRemind'
  | 'wakeFromSleepToRemind'
  | 'remindHere'
  | 'doze'
  | 'homeIdle'
  | 'homeDrink'
  | 'homePoke'
  | 'homeRelax'
  | 'homeSeated'
  | 'homeWake'
  | 'homeWakeFromSleep'
  | 'homeStandUp'
  | 'homeStretchUp';

export interface Transition {
  state: CompanionState;
  /** Played in order; empty means keep doing what it's doing. */
  scripts: CompanionScript[];
  /** Start the doze timer (any other transition cancels it). */
  dozeTimer?: boolean;
  /** Overlay: the character is gone, hide the window. */
  finish?: boolean;
  /** The character got up by itself (e.g. to drink along): turn Relax mode off. */
  endsRelax?: boolean;
  /** The event doesn't apply now: nothing changes. */
  ignored?: boolean;
}

export const OFFSTAGE: CompanionState = { mode: 'offstage', seated: false };
export const IDLE: CompanionState = { mode: 'idle', seated: false };

const RELAXING: CompanionMode[] = ['settling', 'resting', 'sleeping'];
/** Relax mode is on (the character is heading to sit, sitting or asleep). */
export const isRelaxing = (s: CompanionState) => RELAXING.includes(s.mode);

const to = (mode: CompanionMode, scripts: CompanionScript[] = [], extra: Partial<Transition> = {}): Transition => ({
  state: { mode, seated: mode === 'resting' || mode === 'sleeping' },
  scripts,
  ...extra,
});

export function companionStep(place: CompanionPlace, s: CompanionState, e: CompanionEvent): Transition {
  const home = place === 'home';
  const same: Transition = { state: s, scripts: [], ignored: true };

  // The Today screen (re)appears: start fresh, standing or already sitting.
  if (e.type === 'enter') return home ? (e.relaxing ? to('resting', ['homeSeated'], { dozeTimer: true }) : to('idle', ['homeIdle'])) : same;

  switch (s.mode) {
    case 'offstage':
      if (e.type === 'remind') return to('reminding', ['arrive']);
      if (e.type === 'relaxOn') return to('settling', ['relax']);
      return same;

    case 'idle':
      if (e.type === 'relaxOn') return to('settling', ['homeRelax']);
      if (e.type === 'drink') return to('acting', ['homeDrink']);
      if (e.type === 'poke') return to('acting', ['homePoke']);
      return same;

    case 'acting':
      if (e.type === 'done') return to('idle');
      if (e.type === 'drink') return to('acting', ['homeDrink']);
      if (e.type === 'relaxOn') return to('settling', ['homeRelax']);
      return same;

    case 'reminding':
      if (e.type === 'answer') return to('answering', [e.kind]);
      return same; // 'done' = arrived and waiting for an answer

    case 'answering':
      if (e.type === 'done') return home ? to('idle') : { ...to('offstage'), finish: true };
      return same;

    case 'settling':
      if (e.type === 'seated') return { state: { mode: 'settling', seated: true }, scripts: [] };
      if (e.type === 'done') return to('resting', [], { dozeTimer: true });
      if (e.type === 'relaxOff') {
        if (s.seated) return to('waking', [home ? 'homeWake' : 'wake']);
        return home ? to('idle', ['homeIdle']) : to('waking', ['skip']); // never sat: just carry on
      }
      if (e.type === 'remind' && !home) return to('reminding', [s.seated ? 'wakeToRemind' : 'remindHere']);
      if (e.type === 'drink' && home) return to('acting', s.seated ? ['homeStandUp', 'homeDrink'] : ['homeDrink'], { endsRelax: true });
      if (e.type === 'poke' && home) return { ...same, endsRelax: true };
      return same;

    case 'resting':
      if (e.type === 'doze') return to('sleeping', ['doze']);
      if (e.type === 'relaxOff') return to('waking', [home ? 'homeWake' : 'wake']);
      if (e.type === 'remind' && !home) return to('reminding', ['wakeToRemind']);
      if (e.type === 'drink' && home) return to('acting', ['homeStandUp', 'homeDrink'], { endsRelax: true });
      if (e.type === 'poke' && home) return { ...same, endsRelax: true };
      return same;

    case 'sleeping':
      // Waking from sleep starts with a stretch and a yawn.
      if (e.type === 'relaxOff') return to('waking', [home ? 'homeWakeFromSleep' : 'wakeFromSleep']);
      if (e.type === 'remind' && !home) return to('reminding', ['wakeFromSleepToRemind']);
      if (e.type === 'drink' && home) return to('acting', ['homeStretchUp', 'homeDrink'], { endsRelax: true });
      if (e.type === 'poke' && home) return { ...same, endsRelax: true };
      return same;

    case 'waking':
      if (e.type === 'done') return home ? to('idle') : { ...to('offstage'), finish: true };
      if (home && e.type === 'relaxOn') return to('settling', ['homeRelax']);
      if (home && e.type === 'drink') return to('acting', ['homeDrink']);
      return same;
  }
}
