interface ReminderCardProps {
  visible: boolean;
  celebrating: boolean;
  onDrank: () => void;
  onDismiss: () => void;
}

export function ReminderCard({ visible, celebrating, onDrank, onDismiss }: ReminderCardProps) {
  return (
    <div
      className={`reminder-card${visible ? ' is-visible' : ''}${celebrating ? ' is-celebrating' : ''}`}
      data-interactive={visible ? '' : undefined}
      role="alertdialog"
      aria-live="polite"
      aria-hidden={!visible}
      data-testid="reminder-card"
    >
      {celebrating ? (
        <p className="reminder-text celebrate" data-testid="celebrate-text">
          Great job! Stay hydrated. <span aria-hidden>🎉</span>
        </p>
      ) : (
        <>
          <p className="reminder-text" data-testid="reminder-text">
            Hey! Time to drink some water <span aria-hidden>💧</span>
          </p>
          <div className="reminder-actions">
            <button type="button" className="btn btn-primary" onClick={onDrank} disabled={!visible}>
              I Drank Water
            </button>
            <button type="button" className="btn btn-ghost" onClick={onDismiss} disabled={!visible}>
              Dismiss
            </button>
          </div>
        </>
      )}
    </div>
  );
}
