import { Component, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import type { ReminderContext, ReminderResponse, ResponseResult } from '../shared/types';
import { DESKTOP_STAGE, Mascot, stageStyle, type StageLayout } from './Mascot';
import { ReminderCard } from './ReminderCard';
import { Zzz } from './Zzz';
import { sourceKey, type CharacterSource } from './character/assets';
import { Director, type Actor } from './behavior/Director';
import type { InteractionName, Leave, Step } from './behavior/interactions';
import { REMINDER_TYPES } from '../shared/reminders';
import { companionStep, OFFSTAGE, type CompanionEvent, type CompanionMode, type CompanionScript, type CompanionState } from '../shared/companion';
import { renderMessage, type CardMessage, type MessageKey } from './behavior/messages';

/** If nobody answers, the companion leaves on its own after this long. */
const ANSWER_TIMEOUT_MS = 3 * 60_000;

type Phase = 'hidden' | CompanionScript | 'waiting';
/** What to start once the character is loaded and on stage. */
type Pending = 'remind' | 'relaxOn';

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
  const answered = useRef(false);
  const timeout = useRef<number>(undefined);
  // The companion's state (shared/companion.ts) and the doze timer it asks for.
  const machine = useRef<CompanionState>(OFFSTAGE);
  const [mode, setMode] = useState<CompanionMode>('offstage');
  const dozeTimer = useRef<number>(undefined);
  const dispatchRef = useRef<(e: CompanionEvent) => void>(() => {});

  const say = useCallback((key: MessageKey | null, actions: boolean) => {
    if (!key || !ctx.current) return setCard({ message: null, actions: false });
    setCard({ message: renderMessage(key, { reminder: ctx.current, result: result.current }), actions });
  }, []);

  const onStep = useCallback((_name: InteractionName, step: Step) => {
    if (step.do === 'play' && step.animation === 'SitDown') dispatchRef.current({ type: 'seated' });
  }, []);
  const director = useMemo(() => (actor ? new Director(actor, { say, onStep }) : null), [actor, say, onStep]);

  const finish = useCallback(() => {
    machine.current = OFFSTAGE;
    setMode('offstage');
    window.clearTimeout(dozeTimer.current);
    setCard({ message: null, actions: false });
    setPhase('hidden');
    // Let one empty frame paint before hiding so the next show starts clean.
    requestAnimationFrame(() => requestAnimationFrame(() => window.aquamate.mascotDone()));
  }, []);

  /** Arrived with a reminder: wait for an answer (or play one given on a notification). */
  const arrived = useRef<() => void>(() => {});

  // Moves the state machine and plays what it asks for; reports `done` when that finishes uninterrupted.
  const dispatch = useCallback(
    async (event: CompanionEvent) => {
      const t = companionStep('overlay', machine.current, event);
      if (t.ignored) return;
      machine.current = t.state;
      setMode(t.state.mode);
      window.clearTimeout(dozeTimer.current);
      const dozeAfter = ctx.current?.dozeAfterMinutes ?? 0;
      if (t.dozeTimer && dozeAfter > 0) dozeTimer.current = window.setTimeout(() => dispatchRef.current({ type: 'doze' }), dozeAfter * 60_000);
      if (t.finish) return finish();
      if (!t.scripts.length) return;
      if (!director) return finish();
      for (const script of t.scripts) {
        setPhase(script);
        const scene = { leave: leaveFor(result.current ?? ctx.current), prop: ctx.current ? REMINDER_TYPES[ctx.current.reminder.type].prop : null };
        if (!(await director.run(script, scene))) return; // something newer took over
      }
      if (machine.current.mode === 'reminding') arrived.current();
      else dispatchRef.current({ type: 'done' });
    },
    [director, finish],
  );
  dispatchRef.current = (e) => void dispatch(e);

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
      if (!director || sceneFailed) return finish(); // card only: nobody to walk off
      // "Done" plays the type's own script (drinking, for water).
      const type = ctx.current ? REMINDER_TYPES[ctx.current.reminder.type] : null;
      void dispatch({ type: 'answer', kind: kind === 'done' ? (type?.doneScript ?? 'skip') : kind });
    },
    [director, sceneFailed, dispatch, finish],
  );
  arrived.current = () => {
    if (ctx.current?.answer) return void answer(ctx.current.answer);
    setPhase('waiting');
    timeout.current = window.setTimeout(() => answer('timeout'), ANSWER_TIMEOUT_MS);
  };

  // Starts once the right character is loaded. From off-stage it walks in;
  // otherwise (relaxing) whoever is on stage handles it from where they are.
  const tryStart = useCallback(() => {
    const c = ctx.current;
    const what = pending.current;
    if (!what || !c) return;
    if (sceneFailed) {
      pending.current = null;
      if (what === 'relaxOn') return finish(); // nothing to show without 3D
      window.aquamate.mascotReady();
      setPhase('waiting');
      say('reminder', true);
      return;
    }
    if (!director || !actor) return;
    if (machine.current.mode === 'offstage') {
      if (actor.key !== sourceKey({ kind: 'stored', id: c.character.id, revision: c.character.revision })) return;
      actor.stage();
    }
    pending.current = null;
    window.aquamate.mascotReady();
    void dispatch({ type: what === 'remind' ? 'remind' : 'relaxOn' });
  }, [actor, director, sceneFailed, say, dispatch, finish]);

  useEffect(
    () =>
      window.aquamate.onReminderStart((c) => {
        ctx.current = c;
        result.current = null;
        answered.current = false;
        pending.current = 'remind';
        // Relaxing: the one sitting there gets up to remind (and Relax mode ends).
        if (machine.current.mode === 'offstage') setSource((s) => sourceFor(s, c));
        tryStart();
      }),
    [tryStart],
  );

  // Relax mode on (walk to the middle and sit) or off (get up and leave).
  useEffect(
    () =>
      window.aquamate.onRelax((c) => {
        if (c) {
          ctx.current = c;
          result.current = null;
          pending.current = 'relaxOn';
          setSource((s) => sourceFor(s, c));
          return tryStart();
        }
        if (pending.current === 'relaxOn') {
          pending.current = null; // turned off before he even appeared
          return finish();
        }
        dispatchRef.current({ type: 'relaxOff' });
      }),
    [tryStart, finish],
  );
  useEffect(() => {
    tryStart();
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

  useEffect(
    () => () => {
      window.clearTimeout(timeout.current);
      window.clearTimeout(dozeTimer.current);
    },
    [],
  );

  return (
    <div
      className={`stage${layout === 'mobile' ? ' is-mobile' : ''}`}
      style={stageStyle(stageLayout)}
      data-phase={phase}
      data-companion={mode}
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
      <Zzz />
      <ReminderCard
        ref={cardRef}
        message={card.message}
        actions={card.actions}
        labels={ctx.current ? REMINDER_TYPES[ctx.current.reminder.type].labels : undefined}
        onDone={() => answer('done')}
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
