import type { ReminderContext, ResponseResult } from '../../shared/types';

export type MessageKey = 'reminder' | 'cheers' | 'greatJob' | 'later' | 'missed';

export interface CardMessage {
  text: string;
  detail?: string;
  progress?: { done: number; goal: number };
}

export interface MessageContext {
  reminder: ReminderContext;
  result: ResponseResult | null;
}

const glasses = (n: number) => `${n} ${n === 1 ? 'glass' : 'glasses'}`;

/** Personal, context-aware wording for the reminder card. */
export function renderMessage(key: MessageKey, { reminder: r, result }: MessageContext): CardMessage {
  const name = r.userName.trim();
  const done = result?.glassesToday ?? r.glassesToday;
  const goal = result?.dailyGoal ?? r.dailyGoal;
  const progress = { done, goal };
  switch (key) {
    case 'reminder':
      if (r.reason === 'snoozed') return { text: `Ready now${name ? `, ${name}` : ''}? Time to drink some water 💧`, progress };
      if (r.firstOfDay && r.hour >= 4 && r.hour < 12)
        return { text: `Good morning${name ? `, ${name}` : ''}! Time to drink some water 💧`, progress };
      return { text: `Hey${name ? ` ${name}` : ''}! Time to drink some water 💧`, progress };
    case 'cheers':
      return { text: 'Cheers! 💧' };
    case 'greatJob':
      return result?.goalReached && done === goal
        ? { text: `Daily goal reached! Amazing 🎉`, detail: `${glasses(done)} today`, progress }
        : { text: 'Great job! Stay hydrated.', detail: `${done} of ${glasses(goal)} today`, progress };
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
