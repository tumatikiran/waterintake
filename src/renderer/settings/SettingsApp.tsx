import { useEffect, useState } from 'react';
import type { AppState } from '../../shared/types';
import { RemindersPanel } from './RemindersPanel';
import { CharacterPanel } from './CharacterPanel';

type Tab = 'reminders' | 'character' | 'about';
const TABS: { id: Tab; label: string }[] = [
  { id: 'reminders', label: 'Reminders' },
  { id: 'character', label: 'Character' },
  { id: 'about', label: 'About' },
];

const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
function when(t: number, now: number): string {
  const mins = Math.round((t - now) / 60_000);
  const sameDay = new Date(t).toDateString() === new Date(now).toDateString();
  if (!sameDay) return `${new Date(t).toLocaleDateString([], { weekday: 'long' })} at ${clock(t)}`;
  if (mins <= 0) return 'any moment now';
  if (mins < 60) return `in ${mins} min · ${clock(t)}`;
  return `at ${clock(t)}`;
}

/** Re-renders every 30 s so "in 12 min" stays current. */
function useNow(): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);
  return now;
}

function Today({ state }: { state: AppState }) {
  const now = useNow();
  const { glassesToday: done, nextReminderAt, pausedUntil, reminderActive } = state.status;
  const { enabled, dailyGoal: goal } = state.settings.reminders;
  const pct = Math.min(1, done / goal);
  const r = 26;
  const c = 2 * Math.PI * r;

  const schedule = !enabled
    ? 'Reminders are off'
    : pausedUntil
      ? `Paused until ${when(pausedUntil, now).replace(/^at /, '')}`
      : nextReminderAt
        ? `Next reminder ${when(nextReminderAt, now)}`
        : 'No reminder scheduled';

  return (
    <div className="today" data-testid="today">
      <svg className="ring" viewBox="0 0 64 64" aria-hidden>
        <circle cx="32" cy="32" r={r} className="ring-track" />
        <circle cx="32" cy="32" r={r} className="ring-fill" strokeDasharray={c} strokeDashoffset={c * (1 - pct)} />
      </svg>
      <div className="today-text">
        <p className="today-count">
          <strong data-testid="glasses-today">{done}</strong> of {goal} glasses today
        </p>
        <p className="muted" data-testid="next-reminder">
          {schedule}
        </p>
      </div>
      <div className="today-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={() => window.aquamate.logGlass()} title="Log a glass you drank without a reminder">
          + 1 glass
        </button>
        {enabled &&
          (pausedUntil ? (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => window.aquamate.resume()}>
              Resume
            </button>
          ) : (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => window.aquamate.pause(60)}>
              Pause 1 h
            </button>
          ))}
        <button type="button" className="btn btn-primary" onClick={() => window.aquamate.testReminder()} disabled={reminderActive}>
          Test reminder
        </button>
      </div>
    </div>
  );
}

function About({ state }: { state: AppState }) {
  return (
    <div className="about">
      <section className="section">
        <h2>AquaMate {state.app.version}</h2>
        <p>A 3D desktop companion that reminds you to drink water.</p>
        <ul className="plain-list">
          <li>Close this window and AquaMate keeps reminding you from the {state.app.platform === 'darwin' ? 'menu bar' : 'system tray'}.</li>
          <li>
            Your settings, today's count and custom characters stay on this computer, in <code className="path">{state.app.dataPath}</code>.
          </li>
          <li>Upload any rigged .glb character. Animations named Idle, Walk, Wave, Drink, Happy, Sad and SadWalk are used directly; others get stand-ins.</li>
        </ul>
        <p className="muted">MIT licensed. Desktop-window techniques adapted from sharada-dev/hydrate-buddy (MIT).</p>
      </section>
    </div>
  );
}

export function SettingsApp() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>('reminders');

  useEffect(() => {
    void window.aquamate.getState().then(setState);
    return window.aquamate.onState(setState);
  }, []);

  if (!state) return <div className="app-loading" aria-busy="true" />;

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-logo" aria-hidden>
            💧
          </span>
          <div>
            <h1>AquaMate</h1>
            <p className="muted">Your desktop hydration buddy</p>
          </div>
        </div>
        <Today state={state} />
      </header>
      <nav className="tabs" role="tablist" aria-label="Settings sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="tab-panel" role="tabpanel">
        {tab === 'reminders' && <RemindersPanel state={state} />}
        {tab === 'character' && <CharacterPanel state={state} />}
        {tab === 'about' && <About state={state} />}
      </main>
    </div>
  );
}
