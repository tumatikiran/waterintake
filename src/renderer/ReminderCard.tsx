import type { Ref } from 'react';
import type { CardMessage } from './behavior/messages';

interface ReminderCardProps {
  ref?: Ref<HTMLDivElement>;
  /** 'bubble' = a speech bubble without buttons (Android's Today screen). */
  variant?: 'dialog' | 'bubble';
  message: CardMessage | null;
  actions: boolean;
  onDrank: () => void;
  onLater: () => void;
  onSkip: () => void;
}

const MAX_DROPS = 12;

function Drop({ filled }: { filled: boolean }) {
  return (
    <svg className={`drop${filled ? ' is-filled' : ''}`} viewBox="0 0 12 16" aria-hidden>
      <path d="M6 0.8C6 0.8 1 6.6 1 10.2a5 5 0 0 0 10 0C11 6.6 6 0.8 6 0.8Z" />
    </svg>
  );
}

/** Today's progress: one line of text, with a drop per glass when the goal is small enough to show them. */
function Progress({ done, goal }: { done: number; goal: number }) {
  return (
    <div className="card-progress">
      {goal <= MAX_DROPS && (
        <div className="card-drops" aria-hidden>
          {Array.from({ length: goal }, (_, i) => (
            <Drop key={i} filled={i < done} />
          ))}
        </div>
      )}
      <p className="card-progress-text">
        {done} of {goal} {goal === 1 ? 'glass' : 'glasses'} today
      </p>
    </div>
  );
}

export function ReminderCard({ ref, variant = 'dialog', message, actions, onDrank, onLater, onSkip }: ReminderCardProps) {
  const visible = message !== null;
  return (
    <div
      ref={ref}
      className={`reminder-card${visible ? ' is-visible' : ''}${variant === 'bubble' ? ' is-bubble' : ''}`}
      role={variant === 'bubble' ? 'status' : 'alertdialog'}
      aria-live="polite"
      aria-hidden={!visible}
      data-testid={variant === 'bubble' ? 'home-bubble' : 'reminder-card'}
    >
      {message && (
        <>
          {actions && (
            <button type="button" className="card-close" aria-label="Skip this reminder" title="Skip this reminder" onClick={onSkip}>
              ×
            </button>
          )}
          <p className="reminder-text" key={message.text}>
            {message.text}
          </p>
          {message.progress && <Progress {...message.progress} />}
          {actions && (
            <div className="reminder-actions">
              <button type="button" className="btn btn-primary" onClick={onDrank}>
                I Drank Water
              </button>
              <button type="button" className="btn btn-ghost" onClick={onLater}>
                Drink Later
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
