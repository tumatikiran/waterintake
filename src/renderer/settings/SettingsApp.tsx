import { useEffect, useState } from 'react';
import type { AppState } from '../../shared/types';
import { RemindersPanel } from './RemindersPanel';
import { waterReminder } from '../../shared/reminders';
import { CharacterPanel } from './CharacterPanel';
import { AboutPanel, ProgressRing, TodayMedicine, scheduleLine, useNow } from './today';

type Tab = 'reminders' | 'character' | 'about';
const TABS: { id: Tab; label: string }[] = [
  { id: 'reminders', label: 'Reminders' },
  { id: 'character', label: 'Character' },
  { id: 'about', label: 'About' },
];

function Today({ state }: { state: AppState }) {
  const now = useNow();
  const { glassesToday: done, pausedUntil, reminderActive, relaxing } = state.status;
  const goal = waterReminder(state.settings.reminders).dailyGoal;
  const enabled = state.settings.reminders.some((r) => r.enabled);
  const schedule = scheduleLine(state, now);

  return (
    <div className="today" data-testid="today">
      <ProgressRing done={done} goal={goal} />
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
        <button
          type="button"
          className={`btn btn-ghost btn-small${relaxing ? ' is-on' : ''}`}
          aria-pressed={relaxing}
          onClick={() => window.aquamate.setRelax(!relaxing)}
          disabled={reminderActive}
          title={relaxing ? 'Your companion gets up and leaves' : 'Your companion sits down in the middle of the screen and relaxes with you'}
        >
          {relaxing ? 'Stop relaxing' : 'Relax 🌿'}
        </button>
        <button type="button" className="btn btn-primary" onClick={() => window.aquamate.testReminder()} disabled={reminderActive}>
          Test reminder
        </button>
      </div>
    </div>
  );
}

function TodayMedicineStrip({ state }: { state: AppState }) {
  const now = useNow();
  return <TodayMedicine state={state} now={now} />;
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
      <TodayMedicineStrip state={state} />
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
        {tab === 'about' && <AboutPanel state={state} />}
      </main>
    </div>
  );
}
