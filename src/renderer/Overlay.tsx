import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import type { ReminderContext, ReminderResponse, ResponseResult } from '../shared/types';
import { DESKTOP_STAGE, Mascot, stageStyle, type StageLayout } from './Mascot';
import { ReminderCard } from './ReminderCard';
import { sourceKey, type CharacterSource } from './character/assets';
import { Director, type Actor } from './behavior/Director';
import type { InteractionName } from './behavior/interactions';
import { renderMessage, type CardMessage, type MessageKey } from './behavior/messages';

/** If nobody answers, the companion leaves on its own after this long. */
const ANSWER_TIMEOUT_MS = 3 * 60_000;

type Phase = 'hidden' | InteractionName | 'waiting';

/** Android: the character stops in the middle, above the gesture area. */
export const MOBILE_STAGE: StageLayout = { stop: 'center', groundPx: 150, zoom: 150 };

interface OverlayProps {
  /** desktop: transparent always-on-top strip; mobile: full-screen scene in the Android app. */
  layout?: 'desktop' | 'mobile';
  /** Android keeps the scene mounted but stops rendering while it's hidden. */
  active?: boolean;
}

/** The reminder stage: the character, the card, and the reminder flow. */
export function Overlay({ layout = 'desktop', active = true }: OverlayProps) {
  const stageLayout = layout === 'mobile' ? MOBILE_STAGE : DESKTOP_STAGE;
  const [phase, setPhase] = useState<Phase>('hidden');
  const [source, setSource] = useState<CharacterSource>({ kind: 'stored', id: 'default', revision: 1 });
  const [card, setCard] = useState<{ message: CardMessage | null; actions: boolean }>({ message: null, actions: false });
  const [actor, setActor] = useState<Actor | null>(null);
  const [sceneFailed, setSceneFailed] = useState(false);
  const ctx = useRef<ReminderContext | null>(null);
  const result = useRef<ResponseResult | null>(null);
  const pendingStart = useRef(false);
  const answered = useRef(false);
  const timeout = useRef<number>(undefined);

  const say = useCallback((key: MessageKey | null, actions: boolean) => {
    if (!key || !ctx.current) return setCard({ message: null, actions: false });
    setCard({ message: renderMessage(key, { reminder: ctx.current, result: result.current }), actions });
  }, []);

  const director = useMemo(() => (actor ? new Director(actor, { say }) : null), [actor, say]);

  const finish = useCallback(() => {
    setCard({ message: null, actions: false });
    setPhase('hidden');
    // Let one empty frame paint before hiding so the next show starts clean.
    requestAnimationFrame(() => requestAnimationFrame(() => window.aquamate.mascotDone()));
  }, []);

  const answer = useCallback(
    async (kind: ReminderResponse) => {
      if (answered.current) return;
      answered.current = true;
      window.clearTimeout(timeout.current);
      setCard((c) => ({ ...c, actions: false }));
      try {
        result.current = await window.aquamate.respond(kind);
      } catch {
        result.current = null;
      }
      // "Drink Later" and unanswered reminders: across the screen (default) or back the way he came.
      const back = (result.current?.laterExit ?? ctx.current?.laterExit) === 'back';
      const script: InteractionName = back && kind === 'later' ? 'laterBack' : back && kind === 'timeout' ? 'timeoutBack' : kind;
      setPhase(script);
      if (!director) return finish();
      if (await director.run(script)) finish();
    },
    [director, finish],
  );

  // Starts the arrival once the right character is loaded and staged.
  const tryStart = useCallback(async () => {
    const c = ctx.current;
    if (!pendingStart.current || !c) return;
    const wanted = sourceKey({ kind: 'stored', id: c.character.id, revision: c.character.revision });
    if (sceneFailed) {
      pendingStart.current = false;
      window.aquamate.mascotReady();
      setPhase('waiting');
      say('reminder', true);
      return;
    }
    if (!director || actor?.key !== wanted) return;
    pendingStart.current = false;
    actor.stage();
    window.aquamate.mascotReady();
    setPhase('arrive');
    if (await director.run('arrive')) {
      // Already answered with a notification button (Android): play that answer now.
      if (c.answer) return answer(c.answer);
      setPhase('waiting');
      timeout.current = window.setTimeout(() => answer('timeout'), ANSWER_TIMEOUT_MS);
    }
  }, [actor, director, sceneFailed, say, answer]);

  useEffect(
    () =>
      window.aquamate.onReminderStart((c) => {
        ctx.current = c;
        result.current = null;
        answered.current = false;
        pendingStart.current = true;
        setSource((s) =>
          s.kind === 'stored' && s.id === c.character.id && s.revision === c.character.revision
            ? s
            : { kind: 'stored', id: c.character.id, revision: c.character.revision },
        );
        void tryStart();
      }),
    [tryStart],
  );
  useEffect(() => {
    void tryStart();
  }, [tryStart]);

  // Card-only fallback when 3D is unavailable: no walking, so leave right away.
  useEffect(() => {
    if (sceneFailed && phase !== 'hidden' && phase !== 'waiting') finish();
  }, [sceneFailed, phase, finish]);

  // Click-through everywhere except over the card: tell main where the card is.
  const cardRef = useRef<HTMLDivElement>(null);
  const [pointerOverCard, setPointerOverCard] = useState(false);
  useEffect(() => window.aquamate.onPointer(setPointerOverCard), []);
  const cardVisible = card.message !== null;
  useEffect(() => {
    const el = cardRef.current;
    if (!cardVisible || !el) {
      window.aquamate.setHitRegion(null);
      return;
    }
    // offset* ignore the pop-in transform, so this is the card's resting box.
    const report = () =>
      window.aquamate.setHitRegion({ x: el.offsetLeft, y: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
    report();
    const observer = new ResizeObserver(report);
    observer.observe(el);
    window.addEventListener('resize', report);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', report);
    };
  }, [cardVisible]);

  useEffect(() => () => window.clearTimeout(timeout.current), []);

  return (
    <div
      className={`stage${layout === 'mobile' ? ' is-mobile' : ''}`}
      style={stageStyle(stageLayout)}
      data-phase={phase}
      data-pointer={pointerOverCard ? 'card' : undefined}
      data-testid="stage"
    >
      <SceneBoundary onError={() => setSceneFailed(true)}>
        <Canvas
          className="stage-canvas"
          orthographic
          camera={{ zoom: stageLayout.zoom, position: [0, 1.6, 10], rotation: [0, 0, 0], near: 0.1, far: 50 }}
          dpr={[1, 1.75]}
          frameloop={active ? 'always' : 'never'}
          gl={{ alpha: true, antialias: true, powerPreference: 'low-power', premultipliedAlpha: true }}
        >
          <hemisphereLight args={['#ffffff', '#b8c7dc', 1.6]} />
          <directionalLight position={[2.5, 4, 5]} intensity={2.2} />
          <directionalLight position={[-3, 2, -2]} intensity={0.6} color="#cfe3ff" />
          <Suspense fallback={null}>
            <Mascot source={source} onActor={setActor} layout={stageLayout} />
          </Suspense>
        </Canvas>
      </SceneBoundary>
      <ReminderCard
        ref={cardRef}
        message={card.message}
        actions={card.actions}
        onDrank={() => answer('drank')}
        onLater={() => answer('later')}
        onSkip={() => answer('skip')}
      />
    </div>
  );
}

class SceneBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.warn('[AquaMate] 3D scene unavailable, showing the reminder card only:', error);
    this.props.onError();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
