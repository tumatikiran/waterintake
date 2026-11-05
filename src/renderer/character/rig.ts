import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimationController } from '../AnimationController';
import { ExpressionController } from './ExpressionController';
import { WaterBottle } from './WaterBottle';
import { SIP_AMOUNT } from './bottleSpec';
import { RIG_HEIGHT, type AquaMateMeta } from './procedural';

/** Every character is scaled to this height (world units). */
export const TARGET_HEIGHT = 1.85;
/** Bottle size for models without AquaMate metadata, matching the procedural rig. */
const BOTTLE_SCALE = TARGET_HEIGHT / RIG_HEIGHT;
/** Walking speeds for models without metadata (world units per second at normal speed). */
const DEFAULT_SPEEDS = { Walk: 1.35, SadWalk: 0.95 };
const RIGHT_HAND = [/^hand_?r$/i, /^(mixamorig\d*:?)?righthand$/i, /right_?hand$/i, /hand[_.\s-]?r(ight)?$/i, /(^|[_.\s-])r(ight)?[_.\s-]?hand/i];

export interface CharacterAssetData {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

export interface CharacterRig {
  readonly root: THREE.Group;
  readonly animations: AnimationController;
  readonly expressions: ExpressionController;
  readonly bottle: WaterBottle | null;
  /** Ground speed (world units/s at timeScale 1) that matches a locomotion role, so feet don't slide. */
  speed(role: 'Walk' | 'SadWalk'): number;
  /** Fill the bottle again (each reminder starts with a full bottle). */
  refill(): void;
  update(dt: number): void;
  dispose(): void;
}

function findMeta(model: THREE.Object3D): AquaMateMeta | null {
  let meta: AquaMateMeta | null = null;
  model.traverse((o) => {
    const m = o.userData?.aquamate as AquaMateMeta | undefined;
    if (!meta && m && m.version === 1) meta = m;
  });
  return meta;
}

function findBone(model: THREE.Object3D, name: string): THREE.Object3D | undefined {
  return model.getObjectByName(name) ?? model.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
}

function findRightHand(model: THREE.Object3D): THREE.Object3D | undefined {
  const bones: THREE.Object3D[] = [];
  model.traverse((o) => {
    if ((o as THREE.Bone).isBone || o.type === 'Object3D') bones.push(o);
  });
  for (const re of RIGHT_HAND) {
    const hit = bones.find((b) => re.test(b.name));
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Turns a loaded character (bundled, created or uploaded) into something the
 * scene can drive: normalized size, animation roles, expressions and a water
 * bottle in the right hand.
 */
export function createRig(asset: CharacterAssetData): CharacterRig {
  const model = cloneSkinned(asset.scene);
  model.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) o.frustumCulled = false; // skinned bounds lag behind animation
  });
  const meta = findMeta(model);

  // Normalize: feet on the ground, centred, TARGET_HEIGHT tall.
  const root = new THREE.Group();
  root.name = 'CharacterRig';
  root.add(model);
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const height = meta?.height ?? Math.max(1e-6, box.max.y - box.min.y);
  const scale = TARGET_HEIGHT / height;
  if (!meta) {
    model.position.x -= (box.min.x + box.max.x) / 2;
    model.position.z -= (box.min.z + box.max.z) / 2;
  }
  model.position.y -= box.min.y;
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);

  const animations = new AnimationController(model, asset.animations);
  const expressions = new ExpressionController(model);
  animations.loop('Idle', { fade: 0 });
  animations.update(0);
  root.updateMatrixWorld(true);

  // The bottle: exact socket from metadata, or a best guess for other rigs.
  let bottle: WaterBottle | null = new WaterBottle();
  const socket = meta ? findBone(model, meta.props.bottle.bone) : findRightHand(model);
  if (socket && meta) {
    bottle.object.position.fromArray(meta.props.bottle.position);
    bottle.object.quaternion.fromArray(meta.props.bottle.quaternion);
    socket.add(bottle.object);
  } else if (socket) {
    // Upright in the idle pose, a little in front of and below the hand.
    const handQ = socket.getWorldQuaternion(new THREE.Quaternion());
    const handScale = socket.getWorldScale(new THREE.Vector3()).x || 1;
    const inv = handQ.clone().invert();
    const offset = new THREE.Vector3(0.022, -0.058, 0.028).multiplyScalar(BOTTLE_SCALE).applyQuaternion(inv).divideScalar(handScale);
    bottle.object.position.copy(offset);
    bottle.object.quaternion.copy(inv);
    bottle.object.scale.setScalar(BOTTLE_SCALE / handScale);
    socket.add(bottle.object);
  } else {
    bottle.dispose();
    bottle = null;
  }

  const drinkWindow = meta?.drink ?? { start: 0.2, end: 0.7 };
  let drinkFrom: number | null = null;

  return {
    root,
    animations,
    expressions,
    bottle,
    speed(role) {
      if (!animations.found.includes(role) && role === 'SadWalk' && animations.fallbacks.SadWalk === 'Walk') return this.speed('Walk');
      return meta ? meta.locomotion[role] * scale : DEFAULT_SPEEDS[role];
    },
    refill() {
      bottle?.setLevel(1);
      drinkFrom = null;
    },
    update(dt) {
      animations.update(dt);
      expressions.update(dt);
      if (!bottle) return;
      // The water goes down while the Drink clip tips the bottle up.
      if (animations.playing === 'Drink') {
        drinkFrom ??= bottle.waterLevel;
        if (animations.found.includes('Drink')) {
          const p = animations.progress();
          const sip = THREE.MathUtils.smoothstep(p, drinkWindow.start, drinkWindow.end);
          bottle.setLevel(drinkFrom - SIP_AMOUNT * sip);
        }
      } else if (drinkFrom !== null) {
        bottle.setLevel(drinkFrom - SIP_AMOUNT);
        drinkFrom = null;
      }
    },
    dispose() {
      animations.dispose();
      bottle?.dispose();
      root.removeFromParent();
    },
  };
}
