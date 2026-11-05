import { useEffect, useState } from 'react';
import type { AppState, DeepPartial, ReminderSettings, Settings, TimeWindow, Weekday } from '../../shared/types';
import { LIMITS } from '../../shared/settings';
import { reminderInterval } from '../../shared/schedule';
import { Row, Section, Segmented, Select, Stepper, ToggleRow } from './controls';

const update = (patch: DeepPartial<Settings>) => window.aquamate.updateSettings(patch);
const remind = (patch: Partial<ReminderSettings>) => update({ reminders: patch });

const INTERVALS = [15, 20, 30, 45, 60, 90, 120, 180].map((m) => ({ value: m, label: m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}` }));
const SNOOZES = [5, 10, 15, 20, 30, 45, 60].map((m) => ({ value: m, label: `${m} minutes` }));
// Week starts on Monday in the UI; values follow Date#getDay (0 = Sunday).
const DAYS: { value: Weekday; short: string; long: string }[] = [
  { value: 1, short: 'M', long: 'Monday' },
  { value: 2, short: 'T', long: 'Tuesday' },
  { value: 3, short: 'W', long: 'Wednesday' },
  { value: 4, short: 'T', long: 'Thursday' },
  { value: 5, short: 'F', long: 'Friday' },
  { value: 6, short: 'S', long: 'Saturday' },
  { value: 0, short: 'S', long: 'Sunday' },
];

const duration = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);

export function RemindersPanel({ state }: { state: AppState }) {
  const r = state.settings.reminders;
  const spread = reminderInterval({ ...r, mode: 'goal', stopWhenGoalReached: false }, state.status.glassesToday, Date.now());
  const goalInterval = typeof spread === 'number' ? spread : r.intervalMinutes;

  return (
    <div className="panel-grid">
      <Section title="Reminders" description="AquaMate walks onto your screen when it's time to drink.">
        <ToggleRow label="Remind me to drink water" checked={r.enabled} onChange={(enabled) => remind({ enabled })} />
        <Row label="How often" hint={r.mode === 'goal' ? `About every ${duration(goalInterval)} right now, based on what's left of your goal.` : undefined}>
          <Segmented
            label="How often"
            value={r.mode}
            onChange={(mode) => remind({ mode })}
            options={[
              { value: 'fixed', label: 'Fixed interval' },
              { value: 'goal', label: 'Spread my goal' },
            ]}
          />
        </Row>
        {r.mode === 'fixed' && (
          <Row label="Every" htmlFor="interval">
            <Select id="interval" label="Interval" value={r.intervalMinutes} options={INTERVALS} onChange={(intervalMinutes) => remind({ intervalMinutes })} />
          </Row>
        )}
        <Row label="When I pick “Drink Later”" htmlFor="snooze" hint="The companion leaves (sadly) and comes back after this long.">
          <Select id="snooze" label="Snooze" value={r.snoozeMinutes} options={SNOOZES} onChange={(snoozeMinutes) => remind({ snoozeMinutes })} />
        </Row>
      </Section>

      <Section title="Daily goal" description="Each “I Drank Water” counts as one glass.">
        <Row label="Glasses per day">
          <Stepper label="Glasses" value={r.dailyGoal} min={LIMITS.dailyGoal[0]} max={LIMITS.dailyGoal[1]} onChange={(dailyGoal) => remind({ dailyGoal })} />
        </Row>
        <ToggleRow
          label="Stop for the day when I reach my goal"
          checked={r.stopWhenGoalReached}
          onChange={(stopWhenGoalReached) => remind({ stopWhenGoalReached })}
        />
      </Section>

      <Section title="Active hours" description="Reminders only appear inside these time windows.">
        <ScheduleEditor schedule={r.schedule} />
      </Section>

      <Section title="Smart behaviour">
        <ToggleRow
          label="Wait while I'm away"
          hint="Holds reminders while the computer is idle for 5 minutes or locked, then reminds you when you're back."
          checked={r.pauseWhenAway}
          onChange={(pauseWhenAway) => remind({ pauseWhenAway })}
        />
        <ToggleRow
          label="Also show a system notification"
          hint="Useful when a full-screen app hides the companion."
          checked={r.systemNotification}
          onChange={(systemNotification) => remind({ systemNotification })}
        />
        <ToggleRow
          label="Start AquaMate when I log in"
          hint={state.app.isPackaged ? undefined : 'Available in the installed app.'}
          disabled={!state.app.isPackaged}
          checked={state.settings.openAtLogin}
          onChange={(openAtLogin) => update({ openAtLogin })}
        />
      </Section>

      <Section title="About you">
        <NameField value={state.settings.userName} />
      </Section>
    </div>
  );
}

function NameField({ value }: { value: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const save = () => draft.trim() !== value && update({ userName: draft.trim() });
  return (
    <Row label="Your name" htmlFor="user-name" hint="Used in greetings, like “Hey Sam! Time to drink some water”.">
      <input
        id="user-name"
        className="text-input"
        value={draft}
        maxLength={LIMITS.userName}
        placeholder="Optional"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={save}
        onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
      />
    </Row>
  );
}

function ScheduleEditor({ schedule }: { schedule: TimeWindow[] }) {
  const save = (next: TimeWindow[]) => remind({ schedule: next });
  const change = (i: number, patch: Partial<TimeWindow>) => save(schedule.map((w, j) => (j === i ? { ...w, ...patch } : w)));
  const toggleDay = (i: number, day: Weekday) => {
    const days = schedule[i].days.includes(day) ? schedule[i].days.filter((d) => d !== day) : [...schedule[i].days, day];
    change(i, { days });
  };

  return (
    <div className="schedule">
      {schedule.map((w, i) => (
        <div className="window" key={i} data-testid="time-window">
          <div className="days" role="group" aria-label={`Days for time window ${i + 1}`}>
            {DAYS.map((d) => (
              <button
                key={d.value}
                type="button"
                className={`day${w.days.includes(d.value) ? ' is-on' : ''}`}
                aria-pressed={w.days.includes(d.value)}
                aria-label={d.long}
                title={d.long}
                onClick={() => toggleDay(i, d.value)}
              >
                {d.short}
              </button>
            ))}
          </div>
          <div className="times">
            <input type="time" aria-label="From" className="time-input" value={w.start} onChange={(e) => e.target.value && change(i, { start: e.target.value })} />
            <span className="muted">to</span>
            <input type="time" aria-label="Until" className="time-input" value={w.end} onChange={(e) => e.target.value && change(i, { end: e.target.value })} />
            <button
              type="button"
              className="icon-btn"
              aria-label="Remove time window"
              title={schedule.length === 1 ? 'Keep at least one time window' : 'Remove'}
              disabled={schedule.length === 1}
              onClick={() => save(schedule.filter((_, j) => j !== i))}
            >
              ×
            </button>
          </div>
          {w.days.length === 0 && <p className="hint warn">Pick at least one day, or this window never applies.</p>}
        </div>
      ))}
      <div className="schedule-foot">
        <button
          type="button"
          className="btn btn-ghost btn-small"
          disabled={schedule.length >= LIMITS.scheduleWindows}
          onClick={() => save([...schedule, { days: [0, 6], start: '10:00', end: '20:00' }])}
        >
          + Add time window
        </button>
        <p className="hint">Times past midnight work too, for example 22:00 to 06:00.</p>
      </div>
    </div>
  );
}
