import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { AnimationController } from '../AnimationController';
import { ExpressionController } from './ExpressionController';
import type { WaterBottle } from './WaterBottle';
import { SIP_AMOUNT } from './bottleSpec';
import { HandProps, tablet as makeTablet } from './props';
import { ARM_R_BONES, HAND_POSE_CLIPS, RIG_HEIGHT, TABLET, proceduralClips, type AquaMateMeta } from './procedural';

/** Every character is scaled to this height (world units). */
export const TARGET_HEIGHT = 1.85;
/** Bottle size for models without AquaMate metadata, matching the procedural rig. */
const BOTTLE_SCALE = TARGET_HEIGHT / RIG_HEIGHT;
/** Walking speeds for models without metadata (world units per second at normal speed). */
const DEFAULT_SPEEDS = { Walk: 1.35, SadWalk: 0.95, Run: 3 };
const RIGHT_HAND = [/^hand_?r$/i, /^(mixamorig\d*:?)?righthand$/i, /right_?hand$/i, /hand[_.\s-]?r(ight)?$/i, /(^|[_.\s-])r(ight)?[_.\s-]?hand/i];

export interface CharacterAssetData {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
}

export interface CharacterRig {
  readonly root: THREE.Group;
  readonly animations: AnimationController;
  readonly expressions: ExpressionController;
  /** What the right hand holds. Empty by default: reminders decide (see props.ts). */
  readonly props: HandProps;
  /** The water bottle, while it's the prop in hand. */
  readonly bottle: WaterBottle | null;
  /** Ground speed (world units/s at timeScale 1) that matches a locomotion role, so feet don't slide. */
  speed(role: 'Walk' | 'SadWalk' | 'Run'): number;
  /** Fill the bottle again, if one is in hand. */
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
 * scene can drive: normalized size, animation roles, expressions and a grip
 * in the right hand for props.
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

  // AquaMate's own characters (bundled or made in the creator) share one
  // skeleton, so they always use the current clips, whatever version saved
  // the file: older files had the bottle baked into every pose, or lacked
  // newer clips. Their right arm switches to a carrying pose while holding a prop.
  const procedural = meta?.generator === 'aquamate-procedural';
  const all = procedural ? proceduralClips() : asset.animations;
  const handPoses = new Set<string>(Object.values(HAND_POSE_CLIPS));
  const carry = procedural ? all.find((c) => c.name === HAND_POSE_CLIPS.carry) : undefined;
  const animations = new AnimationController(
    model,
    all.filter((c) => !handPoses.has(c.name)),
    carry ? { bones: ARM_R_BONES, carry } : undefined,
  );
  const expressions = new ExpressionController(model);
  animations.loop('Idle', { fade: 0 });
  animations.update(0);
  root.updateMatrixWorld(true);

  // The grip props go into: exact from metadata, or a best guess for other rigs.
  const socket = meta ? findBone(model, meta.props.bottle.bone) : findRightHand(model);
  let grip: THREE.Group | null = null;
  if (socket) {
    grip = new THREE.Group();
    grip.name = 'Grip_R';
    if (meta) {
      grip.position.fromArray(meta.props.bottle.position);
      grip.quaternion.fromArray(meta.props.bottle.quaternion);
    } else {
      // Upright in the idle pose, a little in front of and below the hand.
      const handQ = socket.getWorldQuaternion(new THREE.Quaternion());
      const handScale = socket.getWorldScale(new THREE.Vector3()).x || 1;
      const inv = handQ.clone().invert();
      grip.position.copy(new THREE.Vector3(0.022, -0.058, 0.028).multiplyScalar(BOTTLE_SCALE).applyQuaternion(inv).divideScalar(handScale));
      grip.quaternion.copy(inv);
      grip.scale.setScalar(BOTTLE_SCALE / handScale);
    }
    socket.add(grip);
  }
  const props = new HandProps(grip, (holding, instant) => animations.setHolding(holding, instant));
  // The tablet appears in the left palm while TakeTablet tips it out and brings it to the mouth.
  const leftHand = procedural ? findBone(model, 'Hand_L') : undefined;
  const tablet = leftHand ? makeTablet() : null;
  if (leftHand && tablet) {
    tablet.object.position.set(-0.012, -0.075, 0.045);
    tablet.object.visible = false;
    leftHand.add(tablet.object);
  }
  const bottle = () => (props.prop?.id === 'waterBottle' ? props.prop.bottle : null);

  const drinkWindow = meta?.drink ?? { start: 0.2, end: 0.7 };
  let drinkFrom: number | null = null;

  return {
    root,
    animations,
    expressions,
    props,
    get bottle() {
      return bottle();
    },
    speed(role) {
      // A role played with the walk clip moves at walking speed (the caller scales it with the playback speed).
      if (role !== 'Walk' && !animations.found.includes(role) && animations.fallbacks[role] === 'Walk') return this.speed('Walk');
      const fromMeta = meta?.locomotion[role];
      return fromMeta ? fromMeta * scale : DEFAULT_SPEEDS[role];
    },
    refill() {
      bottle()?.setLevel(1);
      drinkFrom = null;
    },
    update(dt) {
      animations.update(dt);
      expressions.update(dt);
      props.update(dt);
      if (tablet) {
        const t = animations.progress() * TABLET.duration;
        tablet.object.visible = animations.playing === 'TakeTablet' && t >= TABLET.shown[0] && t <= TABLET.shown[1];
      }
      const b = bottle();
      if (!b) return void (drinkFrom = null);
      // The water goes down while the Drink clip tips the bottle up.
      if (animations.playing === 'Drink') {
        drinkFrom ??= b.waterLevel;
        if (animations.found.includes('Drink')) {
          const p = animations.progress();
          const sip = THREE.MathUtils.smoothstep(p, drinkWindow.start, drinkWindow.end);
          b.setLevel(drinkFrom - SIP_AMOUNT * sip);
        }
      } else if (drinkFrom !== null) {
        b.setLevel(drinkFrom - SIP_AMOUNT);
        drinkFrom = null;
      }
    },
    dispose() {
      animations.dispose();
      props.dispose();
      tablet?.dispose();
      root.removeFromParent();
    },
  };
}
