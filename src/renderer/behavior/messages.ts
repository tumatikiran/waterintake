import type { Progress, ReminderContext, ReminderTypeId, ResponseResult } from '../../shared/types';

export type MessageKey = 'reminder' | 'cheers' | 'greatJob' | 'later' | 'missed' | 'hello' | 'relax' | 'refreshed';

export interface CardMessage {
  text: string;
  progress?: Progress;
}

export interface MessageContext {
  reminder: ReminderContext;
  result: ResponseResult | null;
}

/** What each reminder type says. Water's goal is glasses; types without a goal show no progress. */
interface Wording {
  /** "Time to …" (the ask, without the greeting). */
  ask: (r: ReminderContext) => string;
  cheers: string;
  done: (goalReached: boolean) => string;
}
const WORDING: Record<ReminderTypeId, Wording> = {
  water: {
    ask: () => 'Time to drink some water 💧',
    cheers: 'Cheers! 💧',
    done: (goalReached) => (goalReached ? 'Daily goal reached! Amazing 🎉' : 'Great job! Stay hydrated.'),
  },
};

/** Personal, context-aware wording for the reminder card. */
export function renderMessage(key: MessageKey, { reminder: r, result }: MessageContext): CardMessage {
  const name = r.userName.trim();
  const words = WORDING[r.reminder.type];
  const p = result ? result.progress : r.progress;
  const progress = p ?? undefined;
  switch (key) {
    case 'reminder':
      if (r.reason === 'snoozed') return { text: `Ready now${name ? `, ${name}` : ''}? ${words.ask(r)}`, progress };
      if (r.firstOfDay && r.hour >= 4 && r.hour < 12) return { text: `Good morning${name ? `, ${name}` : ''}! ${words.ask(r)}`, progress };
      return { text: `Hey${name ? ` ${name}` : ''}! ${words.ask(r)}`, progress };
    case 'cheers':
      return { text: words.cheers };
    case 'hello':
      return { text: `Hi${name ? ` ${name}` : ''}! Let's stay hydrated 💧`, progress };
    case 'greatJob':
      return { text: words.done(!!result?.goalReached && !!p && p.done === p.goal), progress };
    case 'relax':
      return { text: `Time to unwind${name ? `, ${name}` : ''}. Breathe in… and out 🌿` };
    case 'refreshed':
      return { text: 'All refreshed! A sip of water would be nice now 💧' };
    case 'later': {
      const m = result?.snoozeMinutes ?? r.snoozeMinutes;
      return { text: `Okay… I'll remind you again in ${m} minutes.` };
    }
    case 'missed': {
      const m = result?.snoozeMinutes ?? r.snoozeMinutes;
      return { text: `I'll check on you again in ${m} minutes.` };
    }
  }
}
