import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import type { ReminderContext, ReminderResponse, ResponseResult } from '../shared/types';
import { DESKTOP_STAGE, Mascot, stageStyle, type StageLayout } from './Mascot';
import { ReminderCard } from './ReminderCard';
import { sourceKey, type CharacterSource } from './character/assets';
import { Director, type Actor } from './behavior/Director';
import type { InteractionName, Leave, Step } from './behavior/interactions';
import { renderMessage, type CardMessage, type MessageKey } from './behavior/messages';

/** If nobody answers, the companion leaves on its own after this long. */
const ANSWER_TIMEOUT_MS = 3 * 60_000;

type Phase = 'hidden' | InteractionName | 'waiting';
/** What to start once the character is loaded: a reminder from the edge, Relax mode, or a reminder that interrupts Relax mode. */
type Pending = 'arrive' | 'relax' | 'wakeToRemind' | 'remindHere';

/**
 * Where and how he leaves (the same for every answer), from the settings that
 * came with the reminder or, fresher, with the response. "Back the way he
 * came" is the right edge, where he walked in.
 */
function leaveFor(s: Pick<ResponseResult, 'exitPath' | 'exitGait'> | null): Leave {
  return { to: s?.exitPath === 'back' ? 'exitRight' : 'exitLeft', gait: s?.exitGait ?? 'walk' };
}

/** The stored character a scene context asks for (the same object if it's already that one, so nothing reloads). */
function sourceFor(current: CharacterSource, c: ReminderContext): CharacterSource {
  const { id, revision } = c.character;
  return current.kind === 'stored' && current.id === id && current.revision === revision ? current : { kind: 'stored', id, revision };
}

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
  const pending = useRef<Pending | null>(null);
  // Relax mode: on stage (walking to the middle or sitting), and whether he has sat down yet.
  const relaxing = useRef(false);
  const seated = useRef(false);
  const answered = useRef(false);
  const timeout = useRef<number>(undefined);

  const say = useCallback((key: MessageKey | null, actions: boolean) => {
    if (!key || !ctx.current) return setCard({ message: null, actions: false });
    setCard({ message: renderMessage(key, { reminder: ctx.current, result: result.current }), actions });
  }, []);

  const onStep = useCallback((_name: InteractionName, step: Step) => {
    if (step.do === 'play' && step.animation === 'SitDown') seated.current = true;
  }, []);
  const director = useMemo(() => (actor ? new Director(actor, { say, onStep }) : null), [actor, say, onStep]);

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
      setPhase(kind);
      if (!director) return finish();
      if (await director.run(kind, leaveFor(result.current ?? ctx.current))) finish();
    },
    [director, finish],
  );

  // Starts the arrival (or Relax mode) once the right character is loaded and staged.
  const tryStart = useCallback(async () => {
    const c = ctx.current;
    const what = pending.current;
    if (!what || !c) return;
    const wanted = sourceKey({ kind: 'stored', id: c.character.id, revision: c.character.revision });
    if (sceneFailed) {
      pending.current = null;
      if (what === 'relax') return finish(); // nothing to show without 3D
      window.aquamate.mascotReady();
      setPhase('waiting');
      say('reminder', true);
      return;
    }
    if (!director || !actor) return;
    // From the edge: the wanted character must be loaded. Interrupting Relax mode: whoever is sitting there.
    if (what === 'arrive' || what === 'relax') {
      if (actor.key !== wanted) return;
      actor.stage();
    }
    pending.current = null;
    window.aquamate.mascotReady();
    setPhase(what);
    if (what === 'relax') {
      relaxing.current = true;
      seated.current = false;
      void director.run('relax');
      return;
    }
    if (await director.run(what)) {
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
        // A reminder ends Relax mode: the companion gets up and reminds from where they are.
        const fromRelax = relaxing.current;
        relaxing.current = false;
        pending.current = fromRelax ? (seated.current ? 'wakeToRemind' : 'remindHere') : 'arrive';
        if (!fromRelax) setSource((s) => sourceFor(s, c));
        void tryStart();
      }),
    [tryStart],
  );

  // Relax mode on (walk to the middle and sit) or off (get up and leave).
  useEffect(
    () =>
      window.aquamate.onRelax(async (c) => {
        if (c) {
          ctx.current = c;
          result.current = null;
          pending.current = 'relax';
          setSource((s) => sourceFor(s, c));
          void tryStart();
          return;
        }
        if (pending.current === 'relax') {
          pending.current = null; // turned off before he even appeared
          return finish();
        }
        if (!relaxing.current || !director) return;
        relaxing.current = false;
        // Still on the way to sit down: just leave. Otherwise stand up first.
        const how = seated.current ? 'wake' : 'skip';
        setPhase(how);
        if (await director.run(how, leaveFor(ctx.current))) finish();
      }),
    [tryStart, director, finish],
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
