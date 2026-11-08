import { useEffect, useState } from 'react';
import type { AppState, MedicineReminder } from '../../shared/types';
import { doseToTake, dosesToday, type DoseStatus } from '../../shared/schedule';

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "in 12 min · 10:45", "at 3:30 PM", "Tuesday at 9:00 AM". */
export function when(t: number, now: number): string {
  const mins = Math.round((t - now) / 60_000);
  const sameDay = new Date(t).toDateString() === new Date(now).toDateString();
  if (!sameDay) return `${new Date(t).toLocaleDateString([], { weekday: 'long' })} at ${clock(t)}`;
  if (mins <= 0) return 'any moment now';
  if (mins < 60) return `in ${mins} min · ${clock(t)}`;
  return `at ${clock(t)}`;
}

/** One line describing what happens next. */
export function scheduleLine(state: AppState, now: number): string {
  const { nextReminderAt, pausedUntil } = state.status;
  if (!state.settings.reminders.some((r) => r.enabled)) return 'Reminders are off';
  if (pausedUntil) return `Paused until ${when(pausedUntil, now).replace(/^at /, '')}`;
  if (nextReminderAt) return `Next reminder ${when(nextReminderAt, now)}`;
  return 'No reminder scheduled';
}

/** Re-renders every 30 s so "in 12 min" stays current. */
export function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

/** Today's progress as a ring. */
export function ProgressRing({ done, goal }: { done: number; goal: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const pct = Math.min(1, done / Math.max(1, goal));
  return (
    <svg className="ring" viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r={r} className="ring-track" />
      <circle cx="32" cy="32" r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
    </svg>
  );
}

export function AboutPanel({ state }: { state: AppState }) {
  const { mobile, platform } = state.app;
  return (
    <div className="about">
      <section className="section">
        <h2>AquaMate {state.app.version}</h2>
        <p>A 3D companion that reminds you to drink water.</p>
        <ul className="plain-list">
          {mobile ? (
            <li>Reminders arrive as notifications even when the app is closed. Tap one, or its buttons, to see your companion.</li>
          ) : (
            <li>Close this window and AquaMate keeps reminding you from the {platform === 'darwin' ? 'menu bar' : 'system tray'}.</li>
          )}
          <li>
            Your settings, today's count and custom characters stay on this {mobile ? 'phone' : 'computer'}, in{' '}
            <code className="path">{state.app.dataPath}</code>.
          </li>
          <li>Upload any rigged .glb character. Animations named Idle, Walk, Wave, Drink, Happy, Sad, SadWalk, Run, SitDown, Relax and StandUp are used directly; others get stand-ins.</li>
        </ul>
        <p className="muted">MIT licensed. Desktop-window techniques adapted from sharada-dev/hydrate-buddy (MIT).</p>
      </section>
    </div>
  );
}

/**
 * Today's medicine: each dose with what happened to it (taken at 12:04, due,
 * missed, later), and "Took it" for the dose that's due now. Nothing when
 * there are no medicine reminders today.
 */
export function TodayMedicine({ state, now }: { state: AppState; now: number }) {
  const meds = state.settings.reminders
    .filter((r): r is MedicineReminder => r.type === 'medicine' && r.enabled)
    .map((m) => {
      const doses = dosesToday(m, state.status.reminders[m.id]?.times ?? [], now);
      return { m, doses, take: doseToTake(doses, now) };
    })
    .filter((x) => x.doses.length > 0);
  if (!meds.length) return null;
  const label: Record<DoseStatus['state'], (d: DoseStatus) => string> = {
    taken: (d) => `taken ${clock(d.takenAt!)}`,
    due: () => 'due now',
    missed: () => 'missed',
    upcoming: () => 'later',
  };
  return (
    <section className="today-meds" aria-label="Today's medicine" data-testid="today-medicine">
      {meds.map(({ m, doses, take }) => (
        <div className="today-med" key={m.id} data-testid="today-med">
          <span className="today-med-name">
            <span aria-hidden>💊</span> {m.name}
            {m.dose && <span className="muted"> · {m.dose}</span>}
          </span>
          <ul className="doses">
            {doses.map((d) => (
              <li key={d.at} className={`dose is-${d.state}`} data-state={d.state}>
                <span className="dose-time">{clock(d.at)}</span> <span className="dose-state">{d.state === 'taken' ? '✓ ' : ''}{label[d.state](d)}</span>
              </li>
            ))}
          </ul>
          {take && (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => window.aquamate.logDone(m.id)} title={`Log the ${clock(take.at)} dose as taken`}>
              Took it
            </button>
          )}
        </div>
      ))}
    </section>
  );
}
