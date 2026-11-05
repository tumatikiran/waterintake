# Extending AquaMate

AquaMate is built so that new animations, expressions, interactions and
reminder rules can be added without touching how things fit together. This
page shows where each kind of change goes.

```
main process                         renderer (overlay window)
────────────                         ─────────────────────────
ReminderScheduler ──fire──▶ WindowManager ──reminder:start(ctx)──▶ Overlay
  (shared/schedule.ts)                                              │
DailyLog, settings.json                                          Director ── runs ──▶ INTERACTIONS (data)
CharacterStore (.glb files)                                         │
                       ◀──reminder:respond(kind)────────────────  Actor (Mascot.tsx)
                                                                    │
                                                              CharacterRig
                                                   ┌────────────────┼────────────────┐
                                          AnimationController  ExpressionController  WaterBottle
                                          (roles + fallbacks)   (morph channels)     (water level)
```

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
   - The bottle stays upright automatically.
   - `drink: { weight, tilt }` brings the bottle to the mouth.
3. **Regenerate the default model:**

   ```bash
   npm run generate:model
   ```

   Characters made in the creator pick up the new clip the next time they're
   saved.
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
2. Start the interaction from `Overlay.tsx` with `director.run('celebrateGoal')`.
   Starting a new interaction cancels the one that's running.
3. If it needs new information from the main process, add a field to
   `ReminderContext` or `ResponseResult` in `src/shared/types.ts`.

## Add a reminder rule

1. Put the rule in `src/shared/schedule.ts` as a pure function. Write its unit
   test in `tests/unit/schedule.test.mjs` first.
2. Add the setting to `ReminderSettings` (`src/shared/types.ts`), its default
   and validation to `src/shared/settings.ts`, and a control to
   `src/renderer/settings/RemindersPanel.tsx`.
3. `ReminderScheduler` (`src/main/scheduler.ts`) calls
   `nextReminderTime()` after every event (`start`, `settings`, `drank`,
   `skip`, `later`, `resume`). Conditions checked when a reminder is due
   (like "wait while away") go in `tick()`.

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
