import { Component, Suspense, useCallback, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { CharacterModel } from '../character/CharacterModel';
import { sourceKey, type CharacterSource } from '../character/assets';
import type { CharacterRig } from '../character/rig';
import { ANIMATION_ROLES, ROLE_ORDER, type AnimationRole, type Expression } from '../character/registry';

const EXPRESSION_BUTTONS: { id: Expression; label: string }[] = [
  { id: 'neutral', label: 'Neutral' },
  { id: 'happy', label: 'Happy' },
  { id: 'sad', label: 'Sad' },
];
const ROLE_LABELS: Record<AnimationRole, string> = {
  Idle: 'Idle',
  Walk: 'Walk',
  Wave: 'Wave',
  Drink: 'Drink',
  Happy: 'Happy',
  Sad: 'Sad',
  SadWalk: 'Sad walk',
};

function Turntable({ angle, children }: { angle: React.RefObject<number>; children: ReactNode }) {
  const group = useRef<THREE.Group>(null);
  useFrame(() => {
    if (group.current) group.current.rotation.y = angle.current;
  });
  return <group ref={group}>{children}</group>;
}

/** Live 3D preview with buttons for every animation and expression. Drag to turn. */
export function CharacterPreview({ source, onRig }: { source: CharacterSource; onRig?: (rig: CharacterRig | null) => void }) {
  const [rig, setRig] = useState<CharacterRig | null>(null);
  const [active, setActive] = useState<AnimationRole>('Idle');
  const [expression, setExpression] = useState<Expression>('neutral');
  const angle = useRef(-0.35);
  const drag = useRef<{ x: number; start: number } | null>(null);

  const handleRig = useCallback(
    (r: CharacterRig | null) => {
      setRig(r);
      setActive('Idle');
      setExpression('neutral');
      onRig?.(r);
    },
    [onRig],
  );

  const play = async (role: AnimationRole) => {
    if (!rig) return;
    setActive(role);
    if (role === 'Drink') rig.refill();
    if (ANIMATION_ROLES[role].loop) return rig.animations.loop(role);
    await rig.animations.once(role);
    if (rig.animations.playing === role) {
      rig.animations.loop('Idle');
      setActive('Idle');
    }
  };

  return (
    <div className="preview">
      <div
        className="preview-stage"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, start: angle.current };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current) angle.current = drag.current.start + (e.clientX - drag.current.x) / 120;
        }}
        onPointerUp={() => (drag.current = null)}
        title="Drag to turn"
      >
        <PreviewBoundary key={sourceKey(source)}>
          <Canvas
            camera={{ position: [0, 1.05, 5.4], fov: 28 }}
            onCreated={({ camera }) => camera.lookAt(0, 0.98, 0)} // frame the whole body, not the feet
            dpr={[1, 2]}
            gl={{ alpha: true, antialias: true }}
          >
            <hemisphereLight args={['#ffffff', '#b8c7dc', 1.6]} />
            <directionalLight position={[2.5, 4, 5]} intensity={2.2} />
            <directionalLight position={[-3, 2, -2]} intensity={0.6} color="#cfe3ff" />
            <mesh rotation-x={-Math.PI / 2} position={[0, 0.004, 0]} scale={[1, 0.6, 1]}>
              <circleGeometry args={[0.55, 40]} />
              <meshBasicMaterial color="#0b2545" transparent opacity={0.12} depthWrite={false} />
            </mesh>
            <Suspense fallback={null}>
              <Turntable angle={angle}>
                <CharacterModel key={sourceKey(source)} source={source} onRig={handleRig} />
              </Turntable>
            </Suspense>
          </Canvas>
        </PreviewBoundary>
        {!rig && <div className="preview-loading">Loading character…</div>}
      </div>
      <div className="chip-row" role="group" aria-label="Animations">
        <span className="chip-label">Animation</span>
        {ROLE_ORDER.map((role) => {
          const missing = rig && !rig.animations.found.includes(role);
          return (
            <button
              key={role}
              type="button"
              className={`chip${active === role ? ' is-active' : ''}${missing ? ' is-fallback' : ''}`}
              disabled={!rig}
              onClick={() => play(role)}
              title={missing ? `This model has no ${ROLE_LABELS[role]} animation; it uses ${rig?.animations.fallbacks[role] ?? 'Idle'} instead.` : undefined}
            >
              {ROLE_LABELS[role]}
            </button>
          );
        })}
      </div>
      <div className="chip-row" role="group" aria-label="Expressions">
        <span className="chip-label">Face</span>
        {EXPRESSION_BUTTONS.map((e) => (
          <button
            key={e.id}
            type="button"
            aria-label={`${e.label} face`}
            className={`chip chip-soft${expression === e.id ? ' is-active' : ''}`}
            disabled={!rig || !rig.expressions.supported}
            title={rig && !rig.expressions.supported ? 'This model has no facial expressions (morph targets).' : undefined}
            onClick={() => {
              rig?.expressions.set(e.id);
              setExpression(e.id);
            }}
          >
            {e.label}
          </button>
        ))}
      </div>
    </div>
  );
}

class PreviewBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  state = { error: null as string | null };
  static getDerivedStateFromError(error: unknown) {
    return { error: error instanceof Error ? error.message : 'This character could not be shown.' };
  }
  render() {
    return this.state.error ? <div className="preview-error">{this.state.error}</div> : this.props.children;
  }
}
