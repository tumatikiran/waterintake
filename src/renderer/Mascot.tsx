import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useLoader, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { AnimationController } from './AnimationController';

export const MODEL_URL = './models/human-character.glb';

export type Phase = 'hidden' | 'entering' | 'reminding' | 'celebrating' | 'leaving';

/** Character height in world units; any model is rescaled to this. */
const TARGET_HEIGHT = 1.85;
/**
 * Ground speed that matches the Walk clip's stride (world units per second at
 * timeScale 1). Movement is driven from this x timeScale, so feet don't slide.
 * Re-tune when replacing the model.
 */
const WALK_STRIDE_SPEED = 1.4;
const WALK_TIME_SCALE = 0.85;
const WALK_SPEED = WALK_STRIDE_SPEED * WALK_TIME_SCALE;

// Facing angles (model faces +Z = towards the user). A three-quarter turn
// keeps the walk readable as 3D instead of a flat profile.
const FACE_LEFT = -Math.PI / 2 + 0.45;
const FACE_RIGHT = Math.PI / 2 - 0.45;
const FACE_USER = -0.25; // slightly towards the card on the left

interface MascotProps {
  phase: Phase;
  onArrived: () => void;
  onLeft: () => void;
}

export function Mascot({ phase, onArrived, onLeft }: MascotProps) {
  const gltf = useLoader(GLTFLoader, MODEL_URL);
  const viewportWidth = useThree((s) => s.viewport.width);
  const group = useRef<THREE.Group>(null);
  const shadow = useRef<THREE.Mesh>(null);

  // Normalise any model: feet on y = 0, centred on x/z, TARGET_HEIGHT tall.
  const model = useMemo(() => {
    const scene = gltf.scene;
    scene.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) o.frustumCulled = false; // skinned bounds lag behind animation
    });
    const box = new THREE.Box3().setFromObject(scene);
    const size = box.getSize(new THREE.Vector3());
    const scale = size.y > 0 ? TARGET_HEIGHT / size.y : 1;
    scene.scale.setScalar(scale);
    scene.position.set(-((box.min.x + box.max.x) / 2) * scale, -box.min.y * scale, -((box.min.z + box.max.z) / 2) * scale);
    return scene;
  }, [gltf]);

  const controller = useMemo(() => new AnimationController(model, gltf.animations), [model, gltf.animations]);
  useEffect(() => () => controller.dispose(), [controller]);

  // Stage geometry derived from the window size (orthographic camera at x = 0).
  const half = viewportWidth / 2;
  const startX = half + 0.8; // fully off-stage, just past the screen's right edge
  const stopX = half - 1.15;

  const motion = useRef({ x: startX, facing: FACE_LEFT, done: true });

  useEffect(() => {
    const m = motion.current;
    switch (phase) {
      case 'hidden':
        m.x = startX;
        m.facing = FACE_LEFT;
        m.done = true;
        controller.play('Idle', { fade: 0 });
        break;
      case 'entering':
        m.x = startX;
        m.facing = FACE_LEFT;
        m.done = false;
        if (group.current) {
          group.current.position.x = m.x;
          group.current.rotation.y = m.facing;
        }
        controller.play('Walk', { fade: 0, timeScale: WALK_TIME_SCALE });
        break;
      case 'reminding':
        controller.play('Wave', { once: true, fade: 0.3 }).then(() => {
          if (controller.playing === 'Wave') controller.play('Idle', { fade: 0.4 });
        });
        break;
      case 'celebrating':
        controller.play('Happy', { fade: 0.2 });
        break;
      case 'leaving':
        m.done = false;
        controller.play('Walk', { fade: 0.3, timeScale: WALK_TIME_SCALE });
        break;
    }
  }, [phase, controller, startX]);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 1 / 20); // a stalled frame must not teleport the character
    const m = motion.current;

    if (phase === 'entering' && !m.done) {
      m.x = Math.max(stopX, m.x - WALK_SPEED * dt);
      if (m.x <= stopX) {
        m.done = true;
        onArrived();
      }
    } else if (phase === 'leaving' && !m.done) {
      m.x = Math.min(startX, m.x + WALK_SPEED * dt);
      if (m.x >= startX) {
        m.done = true;
        onLeft();
      }
    }

    const targetFacing =
      phase === 'entering' ? FACE_LEFT : phase === 'leaving' ? FACE_RIGHT : phase === 'hidden' ? FACE_LEFT : FACE_USER;
    m.facing += (targetFacing - m.facing) * (1 - Math.exp(-9 * dt));

    if (group.current) {
      group.current.position.x = m.x;
      group.current.rotation.y = m.facing;
    }
    if (shadow.current) shadow.current.position.x = m.x;
    controller.update(dt);

    window.__aquamateDebug = { x: m.x, stopX, startX, animation: controller.playing, phase };
  });

  return (
    <>
      <mesh ref={shadow} rotation-x={-Math.PI / 2} position={[startX, 0.005, 0]} scale={[1, 0.45, 1]}>
        <circleGeometry args={[0.42, 32]} />
        <meshBasicMaterial color="#0b2545" transparent opacity={0.18} depthWrite={false} />
      </mesh>
      <group ref={group} position={[startX, 0, 0]} rotation-y={FACE_LEFT}>
        <primitive object={model} />
      </group>
    </>
  );
}
