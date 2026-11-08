import { useEffect, useState, type ReactNode } from 'react';
import { App as CapApp } from '@capacitor/app';
import type { AppState } from '../../shared/types';
import { Overlay } from '../Overlay';
import { RemindersPanel } from '../settings/RemindersPanel';
import { CharacterPanel } from '../settings/CharacterPanel';
import { AboutPanel, ProgressRing, TodayMedicine, scheduleLine, useNow } from '../settings/today';
import { HomeStage } from './HomeStage';
import { waterReminder } from '../../shared/reminders';

type Tab = 'today' | 'reminders' | 'character' | 'about';

const ICONS: Record<Tab, ReactNode> = {
  today: <path d="M12 2.5S5.5 10 5.5 14.5a6.5 6.5 0 0 0 13 0C18.5 10 12 2.5 12 2.5Z" />,
  reminders: (
    <path d="M12 3a5.5 5.5 0 0 0-5.5 5.5v3.2L5 14.5v1.5h14v-1.5l-1.5-2.8V8.5A5.5 5.5 0 0 0 12 3Zm-2.2 14.5a2.2 2.2 0 0 0 4.4 0Z" />
  ),
  character: <path d="M12 3.5a4 4 0 1 1 0 8 4 4 0 0 1 0-8Zm0 9.5c4.2 0 7.5 2.2 7.5 5v2.5h-15V18c0-2.8 3.3-5 7.5-5Z" />,
  about: <path d="M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18Zm-1.1 7.5v6h2.2v-6Zm1.1-3.6a1.3 1.3 0 1 0 0 2.6 1.3 1.3 0 0 0 0-2.6Z" />,
};
const TABS: { id: Tab; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'character', label: 'Character' },
  { id: 'about', label: 'About' },
];

function greeting(hour: number, name: string): string {
  const part = hour >= 5 && hour < 12 ? 'Good morning' : hour >= 12 && hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}${name ? `, ${name}` : ''}`;
}

function PermissionCard({ permission }: { permission: 'denied' | 'prompt' }) {
  return (
    <div className="m-permission" role="status" data-testid="permission-card">
      <div>
        <strong>Turn on reminders</strong>
        <p>
          {permission === 'prompt'
            ? 'Allow notifications so AquaMate can remind you to drink, even when the app is closed.'
            : 'Notifications are blocked. Turn them on in Android Settings → Apps → AquaMate → Notifications.'}
        </p>
      </div>
      {permission === 'prompt' && (
        <button type="button" className="btn btn-primary btn-small" onClick={() => window.aquamate.mobile?.requestNotifications()}>
          Allow
        </button>
      )}
    </div>
  );
}

function TodayScreen({ state, paused }: { state: AppState; paused: boolean }) {
  const now = useNow();
  const [cheers, setCheers] = useState(0);
  const { glassesToday: done, pausedUntil, reminderActive, relaxing } = state.status;
  const goal = waterReminder(state.settings.reminders).dailyGoal;
  const enabled = state.settings.reminders.some((r) => r.enabled);
  const permission = state.app.notifications ?? 'prompt';

  return (
    <div className="today-screen">
      <header className="m-top">
        <div className="brand">
          <span className="brand-logo" aria-hidden>
            💧
          </span>
          <div>
            <h1>AquaMate</h1>
            <p className="muted">{greeting(new Date(now).getHours(), state.settings.userName)}</p>
          </div>
        </div>
      </header>
      {permission !== 'granted' && <PermissionCard permission={permission} />}
      {permission === 'granted' && state.app.exactAlarms !== 'granted' && state.settings.reminders.some((r) => r.type === 'medicine' && r.enabled) && (
        <div className="m-permission" role="status" data-testid="exact-alarms-card">
          <div>
            <strong>Medicine on time</strong>
            <p>Android may deliver reminders a few minutes late. Allow alarms &amp; reminders so medicine arrives exactly on time.</p>
          </div>
          <button type="button" className="btn btn-primary btn-small" onClick={() => window.aquamate.mobile?.requestExactAlarms()}>
            Allow
          </button>
        </div>
      )}
      <HomeStage state={state} paused={paused} cheers={cheers} onWake={() => window.aquamate.setRelax(false)} />
      <section className="m-summary" data-testid="today">
        <ProgressRing done={done} goal={goal} />
        <div className="today-text">
          <p className="today-count">
            <strong data-testid="glasses-today">{done}</strong> of {goal} glasses today
          </p>
          <p className="muted" data-testid="next-reminder">
            {scheduleLine(state, now)}
          </p>
        </div>
      </section>
      <TodayMedicine state={state} now={now} />
      <div className="m-actions">
        <button
          type="button"
          className="btn btn-primary btn-big"
          onClick={async () => {
            await window.aquamate.logGlass();
            setCheers((c) => c + 1);
          }}
        >
          I drank a glass 💧
        </button>
        <div className="m-actions-row">
          <button type="button" className="btn btn-ghost" onClick={() => window.aquamate.testReminder()} disabled={reminderActive}>
            Remind me now
          </button>
          <button
            type="button"
            className={`btn btn-ghost${relaxing ? ' is-on' : ''}`}
            aria-pressed={relaxing}
            onClick={() => window.aquamate.setRelax(!relaxing)}
          >
            {relaxing ? 'Wake up' : 'Relax 🌿'}
          </button>
          {enabled &&
            (pausedUntil ? (
              <button type="button" className="btn btn-ghost" onClick={() => window.aquamate.resume()}>
                Resume
              </button>
            ) : (
              <button type="button" className="btn btn-ghost" onClick={() => window.aquamate.pause(60)}>
                Pause 1 h
              </button>
            ))}
        </div>
      </div>
    </div>
  );
}

function Page({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="m-page">
      <h1 className="m-page-title">{title}</h1>
      {children}
    </div>
  );
}

/** The Android app: Today, Reminders, Character and About tabs, plus the full-screen reminder scene. */
export function MobileApp() {
  const [state, setState] = useState<AppState | null>(null);
  const [tab, setTab] = useState<Tab>('today');
  const [reminder, setReminder] = useState(false);

  useEffect(() => {
    void window.aquamate.getState().then(setState);
    return window.aquamate.onState(setState);
  }, []);
  useEffect(() => window.aquamate.mobile?.onReminderVisible(setReminder), []);

  // Android back button: leave sub-tabs first, then send the app to the background.
  useEffect(() => {
    const handle = CapApp.addListener('backButton', () => {
      if (reminder) return; // answer with the card's buttons
      if (tab !== 'today') setTab('today');
      else void CapApp.minimizeApp().catch(() => {});
    });
    return () => {
      void handle.then((h) => h.remove());
    };
  }, [tab, reminder]);

  if (!state) return <div className="app-loading" aria-busy="true" />;

  return (
    <div className="m-app">
      <main className="m-main" data-tab={tab}>
        {tab === 'today' && <TodayScreen state={state} paused={reminder} />}
        {tab === 'reminders' && (
          <Page title="Reminders">
            <RemindersPanel state={state} />
          </Page>
        )}
        {tab === 'character' && (
          <Page title="Character">
            <CharacterPanel state={state} />
          </Page>
        )}
        {tab === 'about' && (
          <Page title="About">
            <AboutPanel state={state} />
          </Page>
        )}
      </main>
      <nav className="m-tabs" role="tablist" aria-label="Sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`m-tab${tab === t.id ? ' is-active' : ''}`} onClick={() => setTab(t.id)}>
            <svg viewBox="0 0 24 24" aria-hidden>
              {ICONS[t.id]}
            </svg>
            {t.label}
          </button>
        ))}
      </nav>
      <div className={`m-reminder${reminder ? ' is-open' : ''}`} aria-hidden={!reminder} data-testid="reminder-scene">
        <Overlay layout="mobile" active={reminder} />
      </div>
    </div>
  );
}
