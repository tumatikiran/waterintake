import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas } from '@react-three/fiber';
import type { AppState } from '../../shared/types';
import { Mascot, stageStyle, type StageLayout } from '../Mascot';
import { ReminderCard } from '../ReminderCard';
import type { CharacterSource } from '../character/assets';
import { Director, type Actor } from '../behavior/Director';
import { renderMessage, type CardMessage, type MessageContext } from '../behavior/messages';
import type { InteractionName } from '../behavior/interactions';

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
  const busy = useRef(false);
  const relaxing = state.status.relaxing;
  // Whether he is sitting (or sitting down).
  const seated = useRef(false);

  const character = state.characters.find((c) => c.id === state.settings.characterId) ?? state.characters[0];
  const source = useMemo<CharacterSource>(
    () => ({ kind: 'stored', id: character.id, revision: character.revision }),
    [character.id, character.revision],
  );

  const director = useMemo(
    () => (actor ? new Director(actor, { say: (key) => setBubble(key ? renderMessage(key, homeContext(latest.current)) : null) }) : null),
    [actor],
  );
  const run = async (name: InteractionName): Promise<boolean> => {
    if (!director) return false;
    busy.current = name !== 'homeIdle' && name !== 'homeSeated';
    const done = await director.run(name);
    if (done) busy.current = false;
    return done;
  };

  // A new character (or the screen opening): standing, or already sitting in Relax mode.
  useEffect(() => {
    seated.current = relaxing;
    void run(relaxing ? 'homeSeated' : 'homeIdle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [director]);

  // Relax mode turned on or off.
  useEffect(() => {
    if (!director || relaxing === seated.current) return;
    seated.current = relaxing;
    void run(relaxing ? 'homeRelax' : 'homeWake');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relaxing, director]);

  // A glass was logged: drink along. Relaxing? Get up first (that ends Relax mode).
  const seen = useRef(cheers);
  useEffect(() => {
    if (cheers === seen.current || !director) return;
    seen.current = cheers;
    if (!seated.current) return void run('homeDrink');
    seated.current = false;
    onWake();
    void run('homeStandUp').then((done) => done && run('homeDrink'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheers, director]);

  return (
    <div
      className="stage is-mobile home-stage"
      style={stageStyle(HOME_STAGE)}
      onClick={() => {
        if (seated.current) onWake();
        else if (!busy.current) void run('homePoke');
      }}
      data-testid="home-stage"
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
      <ReminderCard variant="bubble" message={bubble} actions={false} onDrank={noop} onLater={noop} onSkip={noop} />
    </div>
  );
}
