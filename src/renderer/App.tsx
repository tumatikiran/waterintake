import { Component, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Canvas } from '@react-three/fiber';
import { Mascot, type Phase } from './Mascot';
import { ReminderCard } from './ReminderCard';

const CELEBRATE_MS = 2400;
const view = new URLSearchParams(window.location.search).get('view') === 'mascot' ? 'mascot' : 'panel';
document.documentElement.dataset.view = view;

export function App() {
  return view === 'mascot' ? <MascotOverlay /> : <ControlPanel />;
}

// ----------------------------------------------------------------- overlay --
function MascotOverlay() {
  const [phase, setPhase] = useState<Phase>('hidden');
  const [loaded, setLoaded] = useState(false);
  // If WebGL or the model is unavailable, the reminder still works (card only).
  const [sceneFailed, setSceneFailed] = useState(false);
  const celebrateTimer = useRef<number>(undefined);

  // Main asks for a reminder: stage the character off-screen, then tell main
  // it is safe to show the window (no stale frame can flash).
  useEffect(
    () =>
      window.aquamate.onReminderStart(() => {
        window.clearTimeout(celebrateTimer.current);
        setPhase('entering');
      }),
    [],
  );
  useEffect(() => {
    if (phase === 'entering' && (loaded || sceneFailed)) window.aquamate.mascotReady();
  }, [phase, loaded, sceneFailed]);


  // Click-through everywhere except over the card.
  useEffect(() => {
    let interactive = false;
    const set = (value: boolean) => {
      if (value === interactive) return;
      interactive = value;
      window.aquamate.setInteractive(value);
    };
    const onMove = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY);
      set(!!el?.closest('[data-interactive]'));
    };
    const onLeave = () => set(false);
    window.addEventListener('mousemove', onMove);
    document.addEventListener('mouseleave', onLeave);
    return () => {
      window.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseleave', onLeave);
    };
  }, []);

  const onArrived = useCallback(() => setPhase('reminding'), []);
  const onLeft = useCallback(() => {
    setPhase('hidden');
    window.aquamate.setInteractive(false);
    // Let one empty frame paint before hiding so the next show starts clean.
    requestAnimationFrame(() => requestAnimationFrame(() => window.aquamate.mascotDone()));
  }, []);

  const onDrank = useCallback(() => {
    window.aquamate.respond('drank');
    setPhase('celebrating');
    celebrateTimer.current = window.setTimeout(() => setPhase('leaving'), CELEBRATE_MS);
  }, []);
  const onDismiss = useCallback(() => {
    window.aquamate.respond('dismiss');
    setPhase('leaving');
  }, []);

  useEffect(() => () => window.clearTimeout(celebrateTimer.current), []);

  // Card-only fallback: no character to walk, so skip straight through.
  useEffect(() => {
    if (!sceneFailed) return;
    if (phase === 'entering') setPhase('reminding');
    if (phase === 'leaving') {
      const t = window.setTimeout(onLeft, 250);
      return () => window.clearTimeout(t);
    }
  }, [sceneFailed, phase, onLeft]);

  return (
    <div className="stage" data-phase={phase} data-testid="stage">
      <SceneBoundary onError={() => setSceneFailed(true)}>
        <Canvas
          className="stage-canvas"
          orthographic
          camera={{ zoom: 130, position: [0, 1.6, 10], rotation: [0, 0, 0], near: 0.1, far: 50 }}
          dpr={[1, 2]}
          gl={{ alpha: true, antialias: true, powerPreference: 'low-power', premultipliedAlpha: true }}
        >
          <hemisphereLight args={['#ffffff', '#b8c7dc', 1.6]} />
          <directionalLight position={[2.5, 4, 5]} intensity={2.2} />
          <directionalLight position={[-3, 2, -2]} intensity={0.6} color="#cfe3ff" />
          <Suspense fallback={null}>
            <Mascot phase={phase} onArrived={onArrived} onLeft={onLeft} />
            <LoadedSignal onLoaded={() => setLoaded(true)} />
          </Suspense>
        </Canvas>
      </SceneBoundary>
      <ReminderCard
        visible={phase === 'reminding' || phase === 'celebrating'}
        celebrating={phase === 'celebrating'}
        onDrank={onDrank}
        onDismiss={onDismiss}
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

/** Renders only after the model has resolved inside the same Suspense boundary. */
function LoadedSignal({ onLoaded }: { onLoaded: () => void }) {
  useEffect(onLoaded, [onLoaded]);
  return null;
}

// ----------------------------------------------------------- control panel --
const STATUS_TEXT: Record<string, string> = {
  idle: 'Ready when you are.',
  active: 'AquaMate is on your desktop…',
  drank: 'Nice! You logged a glass of water.',
  dismissed: 'Reminder dismissed.',
};

function ControlPanel() {
  const [status, setStatus] = useState('idle');
  useEffect(() => window.aquamate.onStatus(setStatus), []);

  return (
    <main className="panel">
      <header className="panel-header">
        <span className="panel-logo" aria-hidden>
          💧
        </span>
        <div>
          <h1>AquaMate</h1>
          <p className="panel-sub">Desktop hydration buddy · prototype</p>
        </div>
      </header>
      <button
        type="button"
        className="btn btn-primary btn-wide"
        onClick={() => window.aquamate.testReminder()}
        disabled={status === 'active'}
      >
        Test Reminder
      </button>
      <p className="panel-status" data-testid="panel-status" data-status={status}>
        {STATUS_TEXT[status] ?? status}
      </p>
    </main>
  );
}
