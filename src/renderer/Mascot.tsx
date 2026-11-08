import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { CharacterModel } from './character/CharacterModel';
import { sourceKey, type CharacterSource } from './character/assets';
import type { CharacterRig } from './character/rig';
import type { Actor } from './behavior/Director';
import type { Mark } from './behavior/interactions';

// Facing angles (model faces +Z = towards the user). Three-quarter turns keep
// walks readable as 3D, and the sad walk turns further so the face shows.
const FACE = {
  left: -Math.PI / 2 + 0.45,
  leftSad: -Math.PI / 2 + 0.85,
  right: Math.PI / 2 - 0.45,
  rightSad: Math.PI / 2 - 0.85,
  user: -0.25, // slightly towards the card on the left
  front: 0,
  drink: 0.05, // nearly face-on: the bottle comes in diagonally from the drinking hand
};
const WALK_TIME_SCALE = 0.9;
/** Characters without a run clip "run" with their walk played this much faster. */
const RUN_FALLBACK_TIME_SCALE = 1.9;

interface Motion {
  x: number;
  facing: number;
  target: number;
  walk: { to: Mark; speed: number; resolve: () => void } | null;
  waits: Array<{ left: number; resolve: () => void }>;
}

// Stage coordinates are anchored to the screen's right edge (x = 0), like the
// card, so the stop position doesn't depend on how wide the screen is.
const STOP_X = -1.15;
const EXIT_RIGHT_X = 0.9;

/** Where the character stands and where the ground is. */
export interface StageLayout {
  /** 'right': near the right edge (desktop overlay); 'center': middle of the screen (Android). */
  stop: 'right' | 'center';
  /** Distance of the ground from the bottom of the canvas, in CSS pixels. */
  groundPx: number;
  /** Pixels per world unit (the character is 1.85 units tall). */
  zoom: number;
}
export const DESKTOP_STAGE: StageLayout = { stop: 'right', groundPx: 12, zoom: 130 };

/** CSS variables that place the card relative to the character. */
export function stageStyle(layout: StageLayout): React.CSSProperties {
  return {
    '--ground': `${layout.groundPx}px`,
    '--card-bottom': `${Math.round(layout.groundPx + 2.08 * layout.zoom)}px`, // just above the head
  } as React.CSSProperties;
}

interface MascotProps {
  source: CharacterSource;
  onActor: (actor: Actor | null) => void;
  layout?: StageLayout;
  /** Global the debug state is written to (tests read it). */
  debugName?: '__aquamateDebug' | '__aquamateHomeDebug';
}

/**
 * The character on the overlay stage. Movement, waits and turning advance in
 * the render loop with the frame delta, so walking stays in step with the
 * animation at any frame rate.
 */
export function Mascot({ source, onActor, layout = DESKTOP_STAGE, debugName = '__aquamateDebug' }: MascotProps) {
  const viewportWidth = useThree((s) => s.viewport.width);
  const viewportHeight = useThree((s) => s.viewport.height);
  const camera = useThree((s) => s.camera);
  const group = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);
  // The rig together with the key of the source it was built from: while a new
  // character loads, the old rig must not be mistaken for the new one.
  const [loaded, setLoaded] = useState<{ rig: CharacterRig; key: string } | null>(null);
  const handleRig = useCallback((r: CharacterRig | null, k: string) => {
    setLoaded((cur) => (r ? { rig: r, key: k } : cur?.key === k ? null : cur));
  }, []);
  const rig = loaded?.rig ?? null;

  // Stage marks in world units; only the far-left exit (and a centered stop) depend on the width.
  const stopX = layout.stop === 'center' ? -viewportWidth / 2 : STOP_X;
  const marks = useRef<Record<Mark, number>>({ stop: stopX, center: 0, exitRight: EXIT_RIGHT_X, exitLeft: 0 });
  marks.current = { stop: stopX, center: -viewportWidth / 2, exitRight: EXIT_RIGHT_X, exitLeft: -viewportWidth - 0.9 };
  useEffect(() => {
    camera.position.x = -viewportWidth / 2; // world x = 0 at the right edge
    camera.position.y = viewportHeight / 2 - layout.groundPx / camera.zoom; // ground at groundPx from the bottom
    camera.updateMatrixWorld();
  }, [camera, viewportWidth, viewportHeight, layout.groundPx]);

  const motion = useRef<Motion>({ x: EXIT_RIGHT_X, facing: FACE.left, target: FACE.left, walk: null, waits: [] });
  const key = sourceKey(source);

  const actor = useMemo<Actor | null>(() => {
    if (!loaded) return null;
    const { rig, key: rigKey } = loaded;
    const m = motion.current;
    return {
      key: rigKey,
      stage(at = 'exitRight') {
        m.x = marks.current[at];
        m.facing = m.target = at === 'stop' ? FACE.user : FACE.left;
        m.walk?.resolve();
        m.walk = null;
        rig.props.show(null, true); // empty-handed until a script brings something out
        rig.expressions.set('neutral');
        rig.animations.loop('Idle', { fade: 0 });
      },
      walk(to, style, gait) {
        // Running wins over the sad shuffle: a sad run keeps the sad face and the turned-out facing.
        const role = gait === 'run' ? 'Run' : style === 'sad' ? 'SadWalk' : 'Walk';
        const fallback = rig.animations.fallbacks[role];
        const timeScale =
          role === 'Run'
            ? fallback
              ? RUN_FALLBACK_TIME_SCALE
              : 1
            : role === 'SadWalk' && fallback
              ? 0.7
              : role === 'Walk'
                ? WALK_TIME_SCALE
                : 1;
        rig.animations.loop(role, { fade: 0.3, timeScale });
        const sad = style === 'sad';
        m.target = marks.current[to] < m.x ? (sad ? FACE.leftSad : FACE.left) : sad ? FACE.rightSad : FACE.right;
        m.walk?.resolve();
        return new Promise<void>((resolve) => {
          m.walk = { to, speed: rig.speed(role) * timeScale, resolve };
        });
      },
      prop(id) {
        rig.props.show(id);
      },
      face(to) {
        m.target = FACE[to];
      },
      play(animation) {
        return rig.animations.once(animation, { fade: 0.3 });
      },
      loop(animation, fade = 0.35) {
        rig.animations.loop(animation, { fade });
      },
      expression(name) {
        rig.expressions.set(name);
      },
      wait(seconds) {
        return new Promise<void>((resolve) => m.waits.push({ left: seconds, resolve }));
      },
    };
  }, [loaded]);

  useEffect(() => onActor(actor), [actor, onActor]);
  // A stage that's gone must not leave its last state behind (tests read it).
  useEffect(
    () => () => {
      delete window[debugName];
    },
    [debugName],
  );

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20); // a stalled frame must not teleport the character
    const m = motion.current;
    if (m.walk) {
      const toX = marks.current[m.walk.to]; // re-read: the screen may have been resized
      const step = m.walk.speed * dt;
      if (Math.abs(toX - m.x) <= step) {
        m.x = toX;
        const done = m.walk.resolve;
        m.walk = null;
        done();
      } else {
        m.x += Math.sign(toX - m.x) * step;
      }
    }
    if (m.waits.length) {
      for (const w of m.waits) w.left -= dt;
      const due = m.waits.filter((w) => w.left <= 0);
      m.waits = m.waits.filter((w) => w.left > 0);
      for (const w of due) w.resolve();
    }
    m.facing += (m.target - m.facing) * (1 - Math.exp(-9 * dt));
    if (group.current) {
      group.current.position.x = m.x;
      group.current.rotation.y = m.facing;
    }
    if (shadow.current) shadow.current.position.x = m.x;

    window[debugName] = {
      x: m.x,
      stopX: marks.current.stop,
      centerX: marks.current.center,
      exitLeftX: marks.current.exitLeft,
      exitRightX: marks.current.exitRight,
      walking: !!m.walk,
      animation: rig?.animations.playing ?? null,
      expression: rig?.expressions.expression ?? null,
      prop: rig?.props.held ?? null,
      bottleLevel: rig?.bottle?.waterLevel ?? null,
      character: loaded?.key ?? null,
    };
  });

  return (
    <>
      <mesh ref={shadow} rotation-x={-Math.PI / 2} position={[motion.current.x, 0.005, 0]} scale={[1, 0.45, 1]}>
        <circleGeometry args={[0.42, 32]} />
        <meshBasicMaterial color="#0b2545" transparent opacity={0.18} depthWrite={false} />
      </mesh>
      <group ref={group} position={[motion.current.x, 0, 0]} rotation-y={FACE.left}>
        <CharacterModel key={key} source={source} onRig={handleRig} />
      </group>
    </>
  );
}
