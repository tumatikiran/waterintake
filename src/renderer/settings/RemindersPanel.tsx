import { useEffect, useState } from 'react';
import type { AppState, GeneralSettings, IntervalFields, Reminder, ReminderStatus, ReminderTypeId, TimeWindow, TimesFields, Weekday, WaterReminder } from '../../shared/types';
import { LIMITS, type SettingsPatch } from '../../shared/settings';
import { REMINDER_TYPES, WATER_ID, isTimed, sceneReminder, waterReminder } from '../../shared/reminders';
import { reminderInterval } from '../../shared/schedule';
import { Row, Section, Segmented, Select, Stepper, Toggle, ToggleRow } from './controls';

const update = (patch: SettingsPatch) => window.aquamate.updateSettings(patch);
/** The water reminder (the only type so far that this panel edits). */
const remind = (patch: Partial<Omit<WaterReminder, 'id' | 'type'>>) => window.aquamate.updateReminder(WATER_ID, patch);
const general = (patch: Partial<GeneralSettings>) => update({ general: patch });

const INTERVALS = [15, 20, 30, 45, 60, 90, 120, 180].map((m) => ({ value: m, label: m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}` }));
const SNOOZES = [5, 10, 15, 20, 30, 45, 60].map((m) => ({ value: m, label: `${m} minutes` }));
const DOZE_AFTER = [
  { value: 0, label: 'Never' },
  ...[1, 3, 5, 10].map((m) => ({ value: m, label: `After ${m} minute${m === 1 ? '' : 's'}` })),
];
const RELAX_FOR = [
  { value: 0, label: 'Until I stop' },
  ...[15, 30, 60].map((m) => ({ value: m, label: m < 60 ? `${m} minutes` : '1 hour' })),
];
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
  const r = waterReminder(state.settings.reminders);
  const g = state.settings.general;
  const spread = reminderInterval({ ...r, mode: 'goal', stopWhenGoalReached: false }, state.status.glassesToday, Date.now());
  const goalInterval = typeof spread === 'number' ? spread : r.intervalMinutes;

  return (
    <div className="panel-grid">
      <Section
        title="Reminders"
        description={state.app.mobile ? "AquaMate sends you a reminder when it's time to drink." : "AquaMate walks onto your screen when it's time to drink."}
      >
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
        <Row label="When I pick “Drink Later”" htmlFor="snooze" hint="Your companion comes back after this long.">
          <Select id="snooze" label="Snooze" value={r.snoozeMinutes} options={SNOOZES} onChange={(snoozeMinutes) => remind({ snoozeMinutes })} />
        </Row>
      </Section>

      <YourReminders state={state} />

      <Section
        title="When your companion leaves"
        description="After every reminder: happily when you drink, sadly when you don't."
      >
        <Row stacked label="Direction">
          <Segmented
            label="Direction"
            value={g.exitPath}
            onChange={(exitPath) => general({ exitPath })}
            options={[
              { value: 'across', label: 'Across the screen' },
              { value: 'back', label: 'Back the way they came' },
            ]}
          />
        </Row>
        <Row label="Pace">
          <Segmented
            label="Pace"
            value={g.exitGait}
            onChange={(exitGait) => general({ exitGait })}
            options={[
              { value: 'walk', label: 'Walk' },
              { value: 'run', label: 'Run' },
            ]}
          />
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
        <ScheduleEditor schedule={r.schedule} onSave={(schedule) => remind({ schedule })} />
      </Section>

      {state.app.mobile ? (
        <Section title="Notifications" description="Reminders arrive as Android notifications, even when the app is closed.">
          <NotificationRow state={state} />
        </Section>
      ) : (
        <Section title="Smart behaviour">
          <ToggleRow
            label="Wait while I'm away"
            hint="Holds reminders while the computer is idle for 5 minutes or locked, then reminds you when you're back."
            checked={g.pauseWhenAway}
            onChange={(pauseWhenAway) => general({ pauseWhenAway })}
          />
          <ToggleRow
            label="Also show a system notification"
            hint="Useful when a full-screen app hides the companion."
            checked={g.systemNotification}
            onChange={(systemNotification) => general({ systemNotification })}
          />
          <ToggleRow
            label="Start AquaMate when I log in"
            hint={state.app.isPackaged ? undefined : 'Available in the installed app.'}
            disabled={!state.app.isPackaged}
            checked={state.settings.openAtLogin}
            onChange={(openAtLogin) => update({ openAtLogin })}
          />
        </Section>
      )}

      <Section
        title="Relax mode"
        description={
          state.app.mobile
            ? 'Your companion sits down on the Today screen and relaxes with you. Tap them to wake them.'
            : 'Your companion sits in the middle of the screen and relaxes with you. Water reminders wait until you finish.'
        }
      >
        <Row label="Doze off" htmlFor="doze-after" hint="Relaxing this long, they nod off with a gentle “zzz”.">
          <Select
            id="doze-after"
            label="Doze off"
            value={state.settings.relax.dozeAfterMinutes}
            options={DOZE_AFTER}
            onChange={(dozeAfterMinutes) => update({ relax: { dozeAfterMinutes } })}
          />
        </Row>
        <Row label="Relax for" htmlFor="relax-for" hint="Then they stretch, get up and carry on.">
          <Select
            id="relax-for"
            label="Relax for"
            value={state.settings.relax.durationMinutes}
            options={RELAX_FOR}
            onChange={(durationMinutes) => update({ relax: { durationMinutes } })}
          />
        </Row>
      </Section>

      <Section title="About you">
        <NameField value={state.settings.userName} />
      </Section>
    </div>
  );
}

/** Android: notification permission status. */
export function NotificationRow({ state }: { state: AppState }) {
  const permission = state.app.notifications ?? 'prompt';
  return (
    <Row
      label="Reminder notifications"
      hint={
        permission === 'granted'
          ? 'On. Android may deliver a reminder a few minutes late to save battery.'
          : permission === 'denied'
            ? 'Blocked. Turn on notifications for AquaMate in Android Settings → Apps → AquaMate → Notifications.'
            : 'Allow notifications so AquaMate can remind you when the app is closed.'
      }
    >
      {permission === 'granted' ? (
        <span className="badge badge-lg">On</span>
      ) : permission === 'prompt' ? (
        <button type="button" className="btn btn-primary btn-small" onClick={() => window.aquamate.mobile?.requestNotifications()}>
          Allow
        </button>
      ) : (
        <span className="badge badge-lg badge-warn">Blocked</span>
      )}
    </Row>
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

function ScheduleEditor({ schedule, onSave: save }: { schedule: TimeWindow[]; onSave: (next: TimeWindow[]) => void }) {
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

// --------------------------------------------------------- your reminders
const REPEAT_EVERY = [5, 10, 15, 30].map((m) => ({ value: m, label: `Every ${m} minutes` }));
const REPEAT_TIMES = [1, 2, 3, 5].map((n) => ({ value: n, label: n === 1 ? 'Once' : `Up to ${n} times` }));
const BREAK_INTERVALS = [15, 20, 30, 45, 60, 90, 120].map((m) => ({ value: m, label: m < 60 ? `${m} minutes` : `${m / 60} hour${m === 60 ? '' : 's'}` }));
const EMOJIS = ['⭐', '📞', '🪴', '📚', '🧘', '🐶', '🍎', '🧹', '💼', '🎸'];
const clock = (t: number) => new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
/** The order of the "Add" menu (water is built in). */
const ADDABLE: ReminderTypeId[] = ['medicine', 'eyeRest', 'movement', 'todo', 'custom'];
const errorText = (err: unknown) => (err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'Could not add it.');

function YourReminders({ state }: { state: AppState }) {
  const list = state.settings.reminders.filter((r): r is Exclude<Reminder, WaterReminder> => r.type !== 'water');
  const [menu, setMenu] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const add = async (type: ReminderTypeId) => {
    setError(null);
    setMenu(false);
    try {
      await window.aquamate.addReminder(type);
    } catch (err) {
      setError(errorText(err));
    }
  };
  const full = state.settings.reminders.length >= LIMITS.reminders;
  return (
    <Section
      title="Your reminders"
      description="Medicine, breaks, movement, to-dos, or anything you like. Your companion brings something that shows what each one is for."
      aside={
        <button type="button" className="btn btn-ghost btn-small" aria-expanded={menu} onClick={() => setMenu((m) => !m)} disabled={full}>
          + Add reminder
        </button>
      }
    >
      {menu && (
        <div className="add-menu" role="group" aria-label="Kind of reminder">
          {ADDABLE.map((type) => {
            const def = REMINDER_TYPES[type];
            const taken = def.singleton && state.settings.reminders.some((r) => r.type === type);
            return (
              <button key={type} type="button" className="add-option" onClick={() => add(type)} disabled={taken} title={taken ? `You already have a ${def.label.toLowerCase()} reminder.` : undefined}>
                <span className="add-icon" aria-hidden>
                  {def.icon}
                </span>
                <span>
                  <strong>{def.label}</strong>
                  <span className="hint">{taken ? 'Already added' : def.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      )}
      {list.length === 0 && !menu && <p className="muted empty-note">No other reminders yet.</p>}
      {error && <p className="hint warn">{error}</p>}
      <div className="med-list">
        {list.map((r) => (
          <ReminderEditor key={r.id} r={r} status={state.status.reminders[r.id]} reminderActive={state.status.reminderActive} />
        ))}
      </div>
    </Section>
  );
}

/** A text field that saves when you leave it (or press Enter). */
function TextField({ id, label, value, placeholder, maxLength, onSave, className }: { id: string; label: string; value: string; placeholder?: string; maxLength: number; onSave: (v: string) => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <input
      id={id}
      aria-label={label}
      className={`text-input${className ? ` ${className}` : ''}`}
      value={draft}
      maxLength={maxLength}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft.trim() !== value && onSave(draft.trim())}
      onKeyDown={(e) => e.key === 'Enter' && (e.currentTarget as HTMLInputElement).blur()}
    />
  );
}

const dayWord = (t: number) => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (new Date(t).toDateString() === new Date().toDateString()) return 'today';
  if (new Date(t).toDateString() === tomorrow.toDateString()) return 'tomorrow';
  return new Date(t).toLocaleDateString([], { weekday: 'long' });
};

/** "Taken today at 12:04 · next reminder tomorrow at 12:00", "2 today · next reminder today at 15:30"… */
function statusLine(r: Reminder, s: ReminderStatus | undefined): string {
  if (!r.enabled) return 'Off';
  const next = s?.nextAt ? `next reminder ${dayWord(s.nextAt)} at ${clock(s.nextAt)}` : 'nothing scheduled';
  if (!isTimed(r)) return `${s?.done ? `${s.done} done today` : 'None done yet today'} · ${next}`;
  const verb = r.type === 'medicine' ? 'Taken' : 'Done';
  const done = s?.times.length ? `${verb} today at ${s.times.map(clock).join(', ')}` : `Not ${verb.toLowerCase()} yet today`;
  return `${done} · ${next}`;
}

/** Times and days (medicine, to-dos, your own at set times), with "remind again until done". */
function TimesRows({ r, set }: { r: Reminder & TimesFields; set: (patch: Partial<TimesFields>) => void }) {
  const f = (name: string) => `rem-${r.id}-${name}`;
  const toggleDay = (day: Weekday) => set({ days: r.days.includes(day) ? r.days.filter((d) => d !== day) : [...r.days, day] });
  const medicine = r.type === 'medicine';
  return (
    <>
      <Row label="Times" hint={r.times.length > 1 ? (medicine ? 'Each time is a dose.' : 'Reminded at each time.') : undefined}>
        <div className="med-times">
          {r.times.map((t, i) => (
            <span className="med-time" key={`${t}-${i}`}>
              <input type="time" aria-label={`${medicine ? 'Dose time' : 'Time'} ${i + 1}`} className="time-input" value={t} onChange={(e) => e.target.value && set({ times: r.times.map((x, j) => (j === i ? e.target.value : x)) })} />
              {r.times.length > 1 && (
                <button type="button" className="icon-btn" aria-label={`Remove ${t}`} title="Remove" onClick={() => set({ times: r.times.filter((_, j) => j !== i) })}>
                  ×
                </button>
              )}
            </span>
          ))}
          {r.times.length < LIMITS.doseTimes && (
            <button type="button" className="btn btn-ghost btn-small" onClick={() => set({ times: [...r.times, r.times.includes('20:00') ? '08:00' : '20:00'] })}>
              + Time
            </button>
          )}
        </div>
      </Row>
      <Row label="Days" hint={r.days.length === 0 ? <span className="warn">Pick at least one day.</span> : undefined}>
        <div className="days" role="group" aria-label={`Days for ${r.name}`}>
          {DAYS.map((d) => (
            <button key={d.value} type="button" className={`day${r.days.includes(d.value) ? ' is-on' : ''}`} aria-pressed={r.days.includes(d.value)} aria-label={d.long} title={d.long} onClick={() => toggleDay(d.value)}>
              {d.short}
            </button>
          ))}
        </div>
      </Row>
      <Row label={medicine ? 'Remind again until taken' : 'Remind again until done'} hint="If you don't answer, your companion comes back.">
        <Toggle label={medicine ? 'Remind again until taken' : 'Remind again until done'} checked={r.repeatTimes > 0} onChange={(on) => set({ repeatTimes: on ? 3 : 0 })} />
      </Row>
      {r.repeatTimes > 0 && (
        <Row label="How often">
          <div className="med-repeat">
            <Select id={f('every')} label="Remind again every" value={r.repeatEveryMinutes} options={REPEAT_EVERY} onChange={(repeatEveryMinutes) => set({ repeatEveryMinutes })} />
            <Select id={f('times')} label="Remind again up to" value={r.repeatTimes} options={REPEAT_TIMES} onChange={(repeatTimes) => set({ repeatTimes })} />
          </div>
        </Row>
      )}
    </>
  );
}

/** Every N minutes inside active hours (eye rest, movement, your own). */
function IntervalRows({ r, set }: { r: Reminder & IntervalFields; set: (patch: Partial<IntervalFields>) => void }) {
  const options = BREAK_INTERVALS.some((o) => o.value === r.intervalMinutes) ? BREAK_INTERVALS : [...BREAK_INTERVALS, { value: r.intervalMinutes, label: `${r.intervalMinutes} minutes` }];
  return (
    <>
      <Row label="Every" htmlFor={`rem-${r.id}-interval`}>
        <Select id={`rem-${r.id}-interval`} label="Every" value={r.intervalMinutes} options={options} onChange={(intervalMinutes) => set({ intervalMinutes })} />
      </Row>
      <Row label="Active hours" stacked>
        <ScheduleEditor schedule={r.schedule} onSave={(schedule) => set({ schedule })} />
      </Row>
    </>
  );
}

function ReminderEditor({ r, status, reminderActive }: { r: Exclude<Reminder, WaterReminder>; status?: ReminderStatus; reminderActive: boolean }) {
  const set = (patch: Record<string, unknown>) => window.aquamate.updateReminder(r.id, patch);
  const remove = async () => {
    if (!window.confirm(`Delete the “${r.name}” reminder?`)) return;
    await window.aquamate.removeReminder(r.id);
  };
  const f = (name: string) => `rem-${r.id}-${name}`;
  const def = REMINDER_TYPES[r.type];
  const nameLabel = r.type === 'medicine' ? 'Medicine name' : 'Reminder name';

  return (
    <div className="med" data-testid={r.type === 'medicine' ? 'medicine' : 'reminder'} data-type={r.type} data-id={r.id}>
      <div className="med-head">
        <span className="med-icon" aria-hidden>
          {sceneReminder(r).emoji}
        </span>
        <TextField id={f('name')} label={nameLabel} value={r.name} maxLength={LIMITS.name} onSave={(name) => name && set({ name })} />
        <Toggle label={`${r.name} reminders`} checked={r.enabled} onChange={(enabled) => set({ enabled })} />
      </div>
      <p className="hint med-status" data-testid="reminder-status">
        <span className="type-tag">{def.label}</span> {statusLine(r, status)}
      </p>
      {r.type === 'medicine' && (
        <Row label="Dose" htmlFor={f('dose')}>
          <TextField id={f('dose')} label="Dose" value={r.dose} placeholder="1 tablet" maxLength={LIMITS.dose} onSave={(dose) => set({ dose })} />
        </Row>
      )}
      {r.type === 'custom' && (
        <>
          <Row label="Emoji" hint="Shown on the sign your companion carries.">
            <div className="emoji-pick" role="group" aria-label="Emoji">
              {EMOJIS.map((e) => (
                <button key={e} type="button" className={`emoji${r.emoji === e ? ' is-on' : ''}`} aria-pressed={r.emoji === e} aria-label={`Emoji ${e}`} onClick={() => set({ emoji: e })}>
                  {e}
                </button>
              ))}
              <TextField id={f('emoji')} label="Your own emoji" className="emoji-input" value={EMOJIS.includes(r.emoji) ? '' : r.emoji} placeholder="Other" maxLength={LIMITS.emoji} onSave={(emoji) => emoji && set({ emoji })} />
            </div>
          </Row>
          <Row label="When">
            <Segmented
              label="When"
              value={r.scheduleKind}
              onChange={(scheduleKind) => set({ scheduleKind })}
              options={[
                { value: 'interval', label: 'Every…' },
                { value: 'times', label: 'At set times' },
              ]}
            />
          </Row>
        </>
      )}
      {/* A custom reminder has both kinds of fields; its scheduleKind picks one. */}
      {isTimed(r) ? <TimesRows r={r as Reminder & TimesFields} set={set} /> : <IntervalRows r={r as unknown as Reminder & IntervalFields} set={set} />}
      {(r.type === 'medicine' || r.type === 'todo') && (
        <Row label="Notes" htmlFor={f('notes')}>
          <TextField id={f('notes')} label="Notes" value={r.notes} placeholder={r.type === 'medicine' ? 'With food' : 'Optional'} maxLength={LIMITS.notes} onSave={(notes) => set({ notes })} />
        </Row>
      )}
      <Row label={`When I pick “${def.labels.later}”`} htmlFor={f('snooze')}>
        <Select id={f('snooze')} label="Snooze" value={r.snoozeMinutes} options={SNOOZES} onChange={(snoozeMinutes) => set({ snoozeMinutes })} />
      </Row>
      <div className="med-actions">
        <button type="button" className="btn btn-ghost btn-small" onClick={() => window.aquamate.testReminder(r.id)} disabled={reminderActive}>
          Try it now
        </button>
        <button type="button" className="btn btn-danger btn-small" onClick={remove}>
          Delete
        </button>
      </div>
    </div>
  );
}
