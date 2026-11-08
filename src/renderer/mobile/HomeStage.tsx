import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import type { AppState } from '../../shared/types';
import { Mascot, stageStyle, type StageLayout } from '../Mascot';
import { ReminderCard } from '../ReminderCard';
import type { CharacterSource } from '../character/assets';
import { Director, type Actor } from '../behavior/Director';
import { renderMessage, type CardMessage, type MessageContext } from '../behavior/messages';
import { companionStep, IDLE, isRelaxing, type CompanionEvent, type CompanionMode, type CompanionState } from '../../shared/companion';
import { Zzz } from '../Zzz';

const HOME_STAGE: StageLayout = { stop: 'center', groundPx: 16, zoom: 140 };
const noop = () => {};

function homeContext(state: AppState): MessageContext {
  const done = state.status.glassesToday;
  const { dailyGoal, snoozeMinutes, exitPath, exitGait } = state.settings.reminders;
  return {
    reminder: {
      reason: 'manual',
      userName: state.settings.userName,
      glassesToday: done,
      dailyGoal,
      snoozeMinutes,
      exitPath,
      exitGait,
      character: { id: state.settings.characterId, revision: 1 },
      firstOfDay: false,
      hour: new Date().getHours(),
    },
    result: { glassesToday: done, dailyGoal, goalReached: done >= dailyGoal, snoozeMinutes, exitPath, exitGait },
  };
}

interface HomeStageProps {
  state: AppState;
  paused: boolean;
  /** Bumped when a glass is logged: he drinks along. */
  cheers: number;
  /** Tapped while relaxing. */
  onWake: () => void;
}

/**
 * The companion living on Android's Today screen: idles, waves when tapped,
 * drinks along when you log a glass, and sits down to relax in Relax mode.
 * Same character, scripts and card as the reminder scene.
 */
export function HomeStage({ state, paused, cheers, onWake }: HomeStageProps) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [bubble, setBubble] = useState<CardMessage | null>(null);
  const latest = useRef(state);
  latest.current = state;
  const relaxing = state.status.relaxing;
  // The companion's state (shared/companion.ts) and the doze timer it asks for.
  const machine = useRef<CompanionState>(IDLE);
  const [mode, setMode] = useState<CompanionMode>('idle');
  const dozeTimer = useRef<number>(undefined);
  const dispatchRef = useRef<(e: CompanionEvent) => void>(() => {});
  const onWakeRef = useRef(onWake);
  onWakeRef.current = onWake;

  const character = state.characters.find((c) => c.id === state.settings.characterId) ?? state.characters[0];
  const source = useMemo<CharacterSource>(
    () => ({ kind: 'stored', id: character.id, revision: character.revision }),
    [character.id, character.revision],
  );

  const director = useMemo(
    () =>
      actor
        ? new Director(actor, {
            say: (key) => setBubble(key ? renderMessage(key, homeContext(latest.current)) : null),
            onStep: (_name, step) => {
              if (step.do === 'play' && step.animation === 'SitDown') dispatchRef.current({ type: 'seated' });
            },
          })
        : null,
    [actor],
  );

  // Moves the state machine and plays what it asks for; reports `done` when that finishes uninterrupted.
  const dispatch = async (event: CompanionEvent) => {
    if (!director) return;
    const t = companionStep('home', machine.current, event);
    if (t.endsRelax) onWakeRef.current();
    if (t.ignored) return;
    machine.current = t.state;
    setMode(t.state.mode);
    window.clearTimeout(dozeTimer.current);
    const dozeAfter = latest.current.settings.relax.dozeAfterMinutes;
    if (t.dozeTimer && dozeAfter > 0) dozeTimer.current = window.setTimeout(() => dispatchRef.current({ type: 'doze' }), dozeAfter * 60_000);
    if (!t.scripts.length) return;
    for (const script of t.scripts) if (!(await director.run(script))) return; // something newer took over
    dispatchRef.current({ type: 'done' });
  };
  dispatchRef.current = (e) => void dispatch(e);
  useEffect(() => () => window.clearTimeout(dozeTimer.current), []);

  // A new character (or the screen opening): standing, or already sitting in Relax mode.
  useEffect(() => {
    if (director) dispatchRef.current({ type: 'enter', relaxing });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [director]);

  // Relax mode turned on or off.
  useEffect(() => {
    if (director && relaxing !== isRelaxing(machine.current)) dispatchRef.current({ type: relaxing ? 'relaxOn' : 'relaxOff' });
  }, [relaxing, director]);

  // A glass was logged: drink along (getting up first if relaxing; that ends Relax mode).
  const seen = useRef(cheers);
  useEffect(() => {
    if (cheers === seen.current || !director) return;
    seen.current = cheers;
    dispatchRef.current({ type: 'drink' });
  }, [cheers, director]);

  return (
    <div
      className="stage is-mobile home-stage"
      style={stageStyle(HOME_STAGE)}
      onClick={() => dispatchRef.current({ type: 'poke' })} // relaxing: wakes him (Relax mode off)
      data-testid="home-stage"
      data-companion={mode}
      data-relaxing={relaxing || undefined}
      title={relaxing ? 'Tap to wake' : 'Tap to say hi'}
    >
      <Canvas
        className="stage-canvas"
        orthographic
        camera={{ zoom: HOME_STAGE.zoom, position: [0, 1.6, 10], rotation: [0, 0, 0], near: 0.1, far: 50 }}
        dpr={[1, 2]}
        frameloop={paused ? 'never' : 'always'}
        gl={{ alpha: true, antialias: true, powerPreference: 'low-power' }}
      >
        <hemisphereLight args={['#ffffff', '#b8c7dc', 1.6]} />
        <directionalLight position={[2.5, 4, 5]} intensity={2.2} />
        <directionalLight position={[-3, 2, -2]} intensity={0.6} color="#cfe3ff" />
        <Suspense fallback={null}>
          <Mascot source={source} onActor={setActor} layout={HOME_STAGE} debugName="__aquamateHomeDebug" />
        </Suspense>
      </Canvas>
      <Zzz />
      <ReminderCard variant="bubble" message={bubble} actions={false} onDrank={noop} onLater={noop} onSkip={noop} />
    </div>
  );
}
