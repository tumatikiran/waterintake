# Extending AquaMate

AquaMate is built so that new reminder types, animations, props,
expressions, interactions and reminder rules can be added without touching
how things fit together. This page shows where each kind of change goes.

```
main process                         renderer (overlay window)
────────────                         ─────────────────────────
ReminderScheduler ──fire──▶ WindowManager ──reminder:start(ctx)──▶ Overlay
  one slot per reminder;                                            │  companionStep() (shared/companion.ts)
  REMINDER_TYPES (shared/reminders.ts)                              │  decides what to play next
DailyLog (per reminder), settings.json                           Director ── runs ──▶ INTERACTIONS (data)
CharacterStore (.glb files)                                         │
                       ◀──reminder:respond(kind)────────────────  Actor (Mascot.tsx)
                                                                    │
                                                              CharacterRig
                                                   ┌────────────────┼────────────────┐
                                          AnimationController  ExpressionController  HandProps
                                          (roles, fallbacks,    (morph channels)     (what's in the hand:
                                           right-arm carry pose)                      water bottle, …)
```

## One UI, two platforms

The React UI only talks to `window.aquamate`, an interface defined in
`src/shared/api.ts`. Each platform implements it:

| Platform | Implementation | Reminders | Storage |
| --- | --- | --- | --- |
| Desktop | `src/main/preload.ts` (IPC to the Electron main process) | A scheduler process that checks the clock | JSON files in the app's data folder |
| Android | `src/renderer/mobile/bridge.ts` (Capacitor plugins) | The next 8 reminders scheduled as Android notifications | Preferences, plus files in private app storage |

Both use the same rules from `src/shared/`, so anything you add there, such as
a reminder rule, works on both. Features like animations, expressions and
interactions live in the shared renderer code and appear on both platforms
automatically.

## Add an animation

1. **Name the role** in `src/renderer/character/registry.ts` (`ANIMATION_ROLES`):
   - the clip names that should fill it (`aliases`)
   - what to use when a model lacks it (`fallback`)
   - whether it loops
2. **Give the built-in characters a clip.** In
   `src/renderer/character/procedural.ts`, add a `b.bake('MyRole', seconds, (t, w) => ({ rot: {...} }))` call
   to `bakeClips()`.
   - `rot` holds Euler angles per bone.
   - Feet stay on the ground automatically. Set `grounded: false` for jumps.
   - Clips are empty-handed: while the character holds a prop, the right
     arm plays the `HandCarry` pose instead (unless the role is in
     `ARMS_OWN`, like `Drink`).
   - `holding: true` keeps whatever is in the hand upright;
     `drink: { weight, tilt }` brings the bottle to the mouth.
3. **Regenerate the default model:**

   ```bash
   npm run generate:model
   ```

   Characters made in the creator get the new clip straight away: AquaMate's
   own characters always load the current clips.
4. **Use it** in an interaction: `{ do: 'play', animation: 'MyRole' }` (waits
   until it finishes) or `{ do: 'loop', animation: 'MyRole' }`.

Uploaded models that have a matching clip use it straight away.

## Add an expression

1. If it needs a new face "muscle", add a **channel** to
   `EXPRESSION_CHANNELS` in `registry.ts`, with the morph-target names that
   can drive it (AquaMate's own, ARKit, VRoid…).
2. Add the **expression** to `EXPRESSIONS` as a mix of channels, for example
   `surprised: { surprised: 1, blink: 0 }`.
3. For the built-in faces, add a shape to `FACE_SHAPES` in `procedural.ts` and
   to the morph list in `buildFace()`. The mouth, eyes and brows are rebuilt
   with the same topology, so any shape can be a morph target.
4. Use it with `{ do: 'expression', name: 'surprised' }`.

## Add an interaction

Interactions are data, in `src/renderer/behavior/interactions.ts`:

```ts
celebrateGoal: [
  { do: 'say', message: 'goalReached' },
  { do: 'expression', name: 'joyful' },
  { do: 'loop', animation: 'Happy' },
  { do: 'wait', seconds: 3 },
  { do: 'say', message: null },
  { do: 'walk', to: 'exitRight' },
],
```

1. Add any new `message` keys to `src/renderer/behavior/messages.ts`. Messages
   get the reminder context (name, time of day, glasses so far, goal), so they
   can be personal.
2. Decide when it plays in the companion's state machine
   (`src/shared/companion.ts`): add an event or a transition that names the
   script, and a unit test in `tests/unit/companion.test.mjs`. The overlay and
   Android's Today screen play whatever a transition asks for. Starting a new
   interaction cancels the one that's running.
   - `{ do: 'prop', id: 'reminder' }` puts the reminder type's item in the hand.
3. If it needs new information from the main process, add a field to
   `ReminderContext` or `ResponseResult` in `src/shared/types.ts`.

## Add a reminder type

Settings hold a list of reminders (`settings.reminders`); each has an `id`, a
`type` and that type's own fields. The water reminder (`id: 'water'`) always
exists. Everything that differs between types lives in one place:

1. Add the type's id to `ReminderTypeId` and its fields as a new member of
   `Reminder` in `src/shared/types.ts`.
2. Describe it in `REMINDER_TYPES` (`src/shared/reminders.ts`):
   - `create` and `sanitize` (defaults and validation)
   - `next` (when it fires; pure, unit-tested) and `progress` (a goal, or null)
   - `prop` (what the companion carries in) and `doneScript` (what "done" plays)
   - `duringRelax` (`wait` or `wake`), `priority` (who goes first when two are due)
   - button labels and notification text
3. Give it card wording in `WORDING` (`src/renderer/behavior/messages.ts`).
4. If it carries something new, add the prop to `PROPS`
   (`src/renderer/character/props.ts`) and to `PropName`.

The scheduler, the daily log, the overlay, the state machine and Android's
notifications are generic: they ask the type.

## Add a reminder rule

1. Put the rule in `src/shared/schedule.ts` (or the type's `next`) as a pure
   function. Write its unit test in `tests/unit/schedule.test.mjs` first.
2. Add the setting to the reminder type (`src/shared/types.ts` and its
   `sanitize` in `src/shared/reminders.ts`), or to `GeneralSettings` if it
   applies to every reminder, and a control to
   `src/renderer/settings/RemindersPanel.tsx`.
3. `ReminderScheduler` (`src/main/scheduler.ts`) keeps one slot per reminder
   and recomputes it after every event (`start`, `settings`, `done`, `skip`,
   `later`, `resume`). Conditions checked when a reminder is due (like "wait
   while away") go in `tick()`.

## Add an IPC call

1. Expose it in `src/main/preload.ts`. A sandboxed preload can only use type
   imports.
2. Handle it in `src/main/main.ts`. Check the sender with `fromSettings(e)` or
   `fromMascot(e)` and validate every argument.

## Conventions

- **Overlay coordinates** are anchored to the screen's right edge (x = 0), like
  the card. Stage marks are `stop` (−1.15), `exitRight` (+0.9) and `exitLeft`
  (the screen width plus 0.9, to the left).
- **Everything that moves advances with the frame delta** in `useFrame`,
  including waits. Animations, walking and scripts therefore stay in sync at
  any frame rate.
- **Character size and speed:** every character is scaled to 1.85 world
  units. Walking speed is `rig.speed(role) × timeScale`, so the feet don't
  slide.
