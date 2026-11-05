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
  const { dailyGoal, snoozeMinutes, laterExit } = state.settings.reminders;
  return {
    reminder: {
      reason: 'manual',
      userName: state.settings.userName,
      glassesToday: done,
      dailyGoal,
      snoozeMinutes,
      laterExit,
      character: { id: state.settings.characterId, revision: 1 },
      firstOfDay: false,
      hour: new Date().getHours(),
    },
    result: { glassesToday: done, dailyGoal, goalReached: done >= dailyGoal, snoozeMinutes, laterExit },
  };
}

/**
 * The companion living on Android's Today screen: idles, waves when tapped,
 * and drinks along when you log a glass. Same character, scripts and card as
 * the reminder scene.
 */
export function HomeStage({ state, paused, cheers }: { state: AppState; paused: boolean; cheers: number }) {
  const [actor, setActor] = useState<Actor | null>(null);
  const [bubble, setBubble] = useState<CardMessage | null>(null);
  const latest = useRef(state);
  latest.current = state;
  const busy = useRef(false);

  const character = state.characters.find((c) => c.id === state.settings.characterId) ?? state.characters[0];
  const source = useMemo<CharacterSource>(
    () => ({ kind: 'stored', id: character.id, revision: character.revision }),
    [character.id, character.revision],
  );

  const director = useMemo(
    () => (actor ? new Director(actor, { say: (key) => setBubble(key ? renderMessage(key, homeContext(latest.current)) : null) }) : null),
    [actor],
  );
  const run = async (name: InteractionName) => {
    if (!director) return;
    busy.current = name !== 'homeIdle';
    if (await director.run(name)) busy.current = false;
  };

  useEffect(() => {
    void run('homeIdle');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [director]);

  // A glass was logged: drink along.
  const seen = useRef(cheers);
  useEffect(() => {
    if (cheers === seen.current || !director) return;
    seen.current = cheers;
    void run('homeDrink');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cheers, director]);

  return (
    <div
      className="stage is-mobile home-stage"
      style={stageStyle(HOME_STAGE)}
      onClick={() => !busy.current && void run('homePoke')}
      data-testid="home-stage"
      title="Tap to say hi"
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
