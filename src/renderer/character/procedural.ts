/**
 * Procedural AquaMate characters.
 *
 * buildCharacter(recipe) returns a real rigged model: one skinned mesh per
 * material on an 18-bone skeleton, a face mesh with happy/sad/blink morph
 * targets, and baked animation clips (Idle, Walk, Wave, Drink, Happy, Sad,
 * SadWalk, Run, and SitDown, Relax and StandUp for Relax mode). The same code produces the bundled default GLB
 * (scripts/generate-placeholder-model.mjs) and characters made in the
 * creator, which are exported to GLB and stored like any uploaded model.
 *
 * Clips are baked frame by frame with forward kinematics plus three
 * constraints: feet stay on the ground, the bottle stays upright in the right
 * hand, and while drinking a two-bone IK solve brings the bottle's cap to
 * the mouth.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { BodyType, CharacterRecipe, HairStyle } from '../../shared/types';
import { BOTTLE } from './bottleSpec';

type Vec3 = [number, number, number];

export const BONE_NAMES = [
  'Root',
  'Hips',
  'Spine',
  'Chest',
  'Neck',
  'Head',
  'UpperArm_L',
  'LowerArm_L',
  'Hand_L',
  'UpperArm_R',
  'LowerArm_R',
  'Hand_R',
  'UpperLeg_L',
  'LowerLeg_L',
  'Foot_L',
  'UpperLeg_R',
  'LowerLeg_R',
  'Foot_R',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

// Rest-pose joint positions (metres, Y up, the character faces +Z).
const JOINTS: Record<BoneName, Vec3> = {
  Root: [0, 0, 0],
  Hips: [0, 0.95, 0],
  Spine: [0, 1.06, 0],
  Chest: [0, 1.24, 0],
  Neck: [0, 1.5, 0],
  Head: [0, 1.57, 0],
  UpperArm_L: [0.26, 1.44, 0],
  LowerArm_L: [0.26, 1.17, 0],
  Hand_L: [0.26, 0.93, 0],
  UpperArm_R: [-0.26, 1.44, 0],
  LowerArm_R: [-0.26, 1.17, 0],
  Hand_R: [-0.26, 0.93, 0],
  UpperLeg_L: [0.1, 0.9, 0],
  LowerLeg_L: [0.1, 0.5, 0],
  Foot_L: [0.1, 0.09, 0],
  UpperLeg_R: [-0.1, 0.9, 0],
  LowerLeg_R: [-0.1, 0.5, 0],
  Foot_R: [-0.1, 0.09, 0],
};
const PARENT: Partial<Record<BoneName, BoneName>> = {
  Hips: 'Root',
  Spine: 'Hips',
  Chest: 'Spine',
  Neck: 'Chest',
  Head: 'Neck',
  UpperArm_L: 'Chest',
  LowerArm_L: 'UpperArm_L',
  Hand_L: 'LowerArm_L',
  UpperArm_R: 'Chest',
  LowerArm_R: 'UpperArm_R',
  Hand_R: 'LowerArm_R',
  UpperLeg_L: 'Hips',
  LowerLeg_L: 'UpperLeg_L',
  Foot_L: 'LowerLeg_L',
  UpperLeg_R: 'Hips',
  LowerLeg_R: 'UpperLeg_R',
  Foot_R: 'LowerLeg_R',
};

/** Body height used to normalize the rig (top of a short haircut); hairstyles don't change body size. */
export const RIG_HEIGHT = 1.98;
const LEG = 0.81; // hip joint to ankle
const UPPER_ARM = 0.27;
const FOREARM = 0.24;
const ANKLE_Y = JOINTS.Foot_L[1];
const WALK = { amplitude: 0.45, cycle: 1 };
const SAD_WALK = { amplitude: 0.34, cycle: 1.05 };
const RUN = { amplitude: 0.62, cycle: 0.64 };
/**
 * Ground speed that matches each locomotion clip at timeScale 1 (rig units per
 * second): each step moves the body 2·leg·sin(amplitude), two steps per cycle.
 */
export const LOCOMOTION = {
  Walk: (4 * LEG * Math.sin(WALK.amplitude)) / WALK.cycle,
  SadWalk: (4 * LEG * Math.sin(SAD_WALK.amplitude)) / SAD_WALK.cycle,
  Run: (4 * LEG * Math.sin(RUN.amplitude)) / RUN.cycle,
};
/** Drink clip timing (seconds): lift, drink (the bottle empties), lower, "ahh". */
export const DRINK = { duration: 4.4, liftEnd: 0.8, drinkEnd: 3.1, lowerEnd: 3.9 };
/**
 * Relax mode: sitting down (bend the knees into a squat, then lower onto the
 * floor and cross the legs), the seated breathing loop, and standing up.
 * One breath every `breath` seconds: slow and calm.
 */
export const SIT = { down: 2.6, downCrouch: 1.0, up: 2.2, upCrouch: 1.15, breath: 5.5 };
const SEAT = { hipsY: 0.16, handAboveKnee: 0.15 };

/** Metadata stored on the model (glTF extras), read by the runtime rig. */
export interface AquaMateMeta {
  version: 1;
  generator: 'aquamate-procedural';
  recipe: CharacterRecipe;
  height: number;
  locomotion: { Walk: number; SadWalk: number; Run?: number }; // Run: models made before it existed lack it
  drink: { start: number; end: number }; // fraction of the Drink clip while the bottle empties
  props: { bottle: { bone: string; position: Vec3; quaternion: [number, number, number, number] } };
}

// ------------------------------------------------------------------ geometry
function skin(g: THREE.BufferGeometry, bone: number): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const idx = new Uint16Array(n * 4);
  const w = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    idx[i * 4] = bone;
    w[i * 4] = 1;
  }
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(w, 4));
  return g;
}

interface Place {
  pos?: Vec3;
  rot?: Vec3;
  quat?: THREE.Quaternion;
  scale?: Vec3;
}

type Slot = 'skin' | 'hair' | 'shirt' | 'accent' | 'pants' | 'shoes' | 'sole' | 'frame' | 'blush';

class Parts {
  readonly slots = new Map<Slot, THREE.BufferGeometry[]>();

  add(slot: Slot, bone: BoneName, geo: THREE.BufferGeometry, { pos = [0, 0, 0], rot = [0, 0, 0], quat, scale = [1, 1, 1] }: Place = {}) {
    const g = geo.index ? geo.clone() : geo.toNonIndexed();
    const q = quat ?? new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot));
    g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(...pos), q, new THREE.Vector3(...scale)));
    skin(g, BONE_NAMES.indexOf(bone));
    const list = this.slots.get(slot) ?? [];
    list.push(g);
    this.slots.set(slot, list);
  }

  /** Capsule spanning two points. */
  limb(slot: Slot, bone: BoneName, a: Vec3, b: Vec3, r: number) {
    const A = new THREE.Vector3(...a);
    const B = new THREE.Vector3(...b);
    const geo = new THREE.CapsuleGeometry(r, Math.max(0.01, A.distanceTo(B) - 2 * r), 6, 14);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
    this.add(slot, bone, geo, { pos: A.add(B).multiplyScalar(0.5).toArray(), quat });
  }
}

/** z of the face surface (head ellipsoid) at x, y, so features sit on the skin. */
function faceZ(x: number, y: number): number {
  const u = 1 - (x / 0.2) ** 2 - ((y - 1.77) / 0.216) ** 2;
  return 0.2 * Math.sqrt(Math.max(0, u));
}

/**
 * Body proportions (radii in metres). Both shapes share the skeleton, so the
 * same baked animations and the drinking IK fit either one.
 */
interface BodyShape {
  neck: [number, number];
  chest: [number, number]; // tee: shoulders, bottom of the ribcage
  stripe: [number, number];
  waist: [number, number]; // tee: waist, hem
  hips: [number, number];
  nose: number;
  blush: boolean; // rosy cheeks
  shoulder: number;
  sleeve: [number, number];
  arm: [number, number]; // upper, lower
  hand: number;
  leg: [number, number]; // upper, lower
  shoe: number;
}
const BODY: Record<BodyType, BodyShape> = {
  male: {
    neck: [0.06, 0.065],
    chest: [0.22, 0.19],
    stripe: [0.217, 0.21],
    waist: [0.19, 0.18],
    hips: [0.182, 0.17],
    nose: 0.03,
    blush: false,
    shoulder: 0.09,
    sleeve: [0.088, 0.08],
    arm: [0.06, 0.055],
    hand: 0.068,
    leg: [0.1, 0.085],
    shoe: 0.07,
  },
  // Narrower shoulders and waist, fuller hips, slimmer limbs.
  female: {
    neck: [0.052, 0.058],
    chest: [0.19, 0.142],
    stripe: [0.181, 0.168],
    waist: [0.142, 0.205],
    hips: [0.21, 0.19],
    nose: 0.024,
    blush: true,
    shoulder: 0.08,
    sleeve: [0.079, 0.072],
    arm: [0.051, 0.047],
    hand: 0.06,
    leg: [0.097, 0.078],
    shoe: 0.064,
  },
};

function buildBody(p: Parts, recipe: CharacterRecipe) {
  const S = THREE.SphereGeometry;
  const B = BODY[recipe.body];
  // Head, ears, nose, neck
  p.add('skin', 'Head', new S(0.2, 28, 20), { pos: [0, 1.77, 0], scale: [1, 1.08, 1] });
  p.add('skin', 'Head', new S(0.045, 10, 8), { pos: [0.2, 1.76, -0.01] });
  p.add('skin', 'Head', new S(0.045, 10, 8), { pos: [-0.2, 1.76, -0.01] });
  p.add('skin', 'Head', new S(B.nose, 10, 8), { pos: [0, 1.738, 0.2] });
  if (B.blush) {
    for (const side of [1, -1]) {
      const x = 0.112 * side;
      const y = 1.742;
      p.add('blush', 'Head', new S(1, 16, 10), { pos: [x, y, faceZ(x, y) - 0.004], rot: [0, 0.5 * side, 0], scale: [0.034, 0.02, 0.012] });
    }
  }
  p.add('skin', 'Neck', new THREE.CylinderGeometry(B.neck[0], B.neck[1], 0.14, 14), { pos: [0, 1.53, 0] });
  // Torso: tee with a chest stripe, collar and hem in the accent color
  p.add('shirt', 'Chest', new THREE.CylinderGeometry(B.chest[0], B.chest[1], 0.34, 22), { pos: [0, 1.33, 0], scale: [1, 1, 0.72] });
  p.add('shirt', 'Chest', new S(B.chest[0], 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), { pos: [0, 1.495, 0], scale: [1, 0.25, 0.72] });
  p.add('accent', 'Chest', new THREE.CylinderGeometry(B.stripe[0], B.stripe[1], 0.06, 22, 1, true), { pos: [0, 1.3, 0], scale: [1.02, 1, 0.74] });
  p.add('accent', 'Chest', new THREE.TorusGeometry(0.08, 0.022, 8, 20), { pos: [0, 1.5, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.85, 1] });
  p.add('shirt', 'Spine', new THREE.CylinderGeometry(B.waist[0], B.waist[1], 0.24, 22), { pos: [0, 1.08, 0], scale: [1, 1, 0.74] });
  p.add('accent', 'Spine', new THREE.CylinderGeometry(B.waist[1] + 0.005, B.waist[1] + 0.005, 0.03, 22, 1, true), { pos: [0, 0.975, 0], scale: [1.02, 1, 0.76] });
  p.add('pants', 'Hips', new THREE.CylinderGeometry(B.hips[0], B.hips[1], 0.16, 22), { pos: [0, 0.91, 0], scale: [1, 1, 0.76] });
  for (const side of ['L', 'R'] as const) {
    const x = side === 'L' ? 0.26 : -0.26;
    // Short sleeves, accent cuffs, bare arms
    p.add('shirt', `UpperArm_${side}`, new S(B.shoulder, 16, 12), { pos: [x, 1.44, 0] });
    p.add('shirt', `UpperArm_${side}`, new THREE.CylinderGeometry(B.sleeve[0], B.sleeve[1], 0.16, 16), { pos: [x, 1.36, 0] });
    p.add('accent', `UpperArm_${side}`, new THREE.CylinderGeometry(B.sleeve[1] + 0.003, B.sleeve[1] + 0.003, 0.03, 16, 1, true), { pos: [x, 1.28, 0] });
    p.limb('skin', `UpperArm_${side}`, [x, 1.4, 0], [x, 1.17, 0], B.arm[0]);
    p.limb('skin', `LowerArm_${side}`, [x, 1.17, 0], [x, 0.95, 0], B.arm[1]);
    p.add('skin', `Hand_${side}`, new S(B.hand, 14, 10), { pos: [x, 0.89, 0.005], scale: [0.85, 1.1, 1] });
    // Legs and sneakers
    const lx = side === 'L' ? 0.1 : -0.1;
    p.limb('pants', `UpperLeg_${side}`, [lx, 0.93, 0], [lx, 0.5, 0], B.leg[0]);
    p.limb('pants', `LowerLeg_${side}`, [lx, 0.52, 0], [lx, 0.12, 0], B.leg[1]);
    p.add('shoes', `Foot_${side}`, new THREE.CapsuleGeometry(B.shoe, 0.14, 4, 12), { pos: [lx, 0.07, 0.05], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.85] });
    p.add('sole', `Foot_${side}`, new THREE.BoxGeometry(0.14, 0.03, 0.28), { pos: [lx, 0.015, 0.05] });
    p.add('shirt', `Foot_${side}`, new THREE.BoxGeometry(0.142, 0.022, 0.12), { pos: [lx, 0.085, 0.02] });
  }
  buildHair(p, recipe.hairStyle);
  if (recipe.beard) {
    p.add('hair', 'Head', new S(1, 20, 14), { pos: [0, 1.632, 0.1], scale: [0.165, 0.075, 0.125] });
  }
  if (recipe.glasses) {
    for (const side of [1, -1]) {
      const x = 0.075 * side;
      const z = faceZ(x, 1.792) + 0.03;
      p.add('frame', 'Head', new THREE.TorusGeometry(0.04, 0.0065, 8, 24), { pos: [x, 1.792, z] });
      p.add('frame', 'Head', new THREE.BoxGeometry(0.007, 0.007, 0.215), { pos: [0.155 * side, 1.797, 0.105], rot: [0, -0.38 * side, 0] });
    }
    p.add('frame', 'Head', new THREE.CylinderGeometry(0.005, 0.005, 0.07, 8), { pos: [0, 1.8, faceZ(0, 1.8) + 0.03], rot: [0, 0, Math.PI / 2] });
  }
}

function buildHair(p: Parts, style: HairStyle) {
  const S = THREE.SphereGeometry;
  const topCap = (r: number, thetaLen: number, pos: Vec3, scale: Vec3 = [1, 0.95, 1]) =>
    p.add('hair', 'Head', new S(r, 28, 14, 0, Math.PI * 2, 0, thetaLen), { pos, scale });
  const backCap = (r: number, pos: Vec3) =>
    p.add('hair', 'Head', new S(r, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), { pos, rot: [-0.25, 0, 0] });

  switch (style) {
    case 'short':
      topCap(0.215, Math.PI / 2, [0, 1.79, -0.015]);
      backCap(0.215, [0, 1.785, -0.045]);
      p.add('hair', 'Head', new S(1, 20, 12), { pos: [0.03, 1.915, 0.13], rot: [0.45, 0, -0.18], scale: [0.17, 0.055, 0.09] });
      break;
    case 'spiky': {
      topCap(0.212, Math.PI / 2, [0, 1.79, -0.015]);
      backCap(0.212, [0, 1.785, -0.045]);
      const spikes: Array<[number, number]> = [
        [0, 86], [-45, 64], [45, 64], [0, 60], [-115, 58], [115, 58], [180, 62], [-155, 45], [155, 45], [-80, 45], [80, 45],
      ];
      for (const [az, el] of spikes) {
        const a = THREE.MathUtils.degToRad(az);
        const e = THREE.MathUtils.degToRad(el);
        const dir = new THREE.Vector3(Math.sin(a) * Math.cos(e), Math.sin(e), Math.cos(a) * Math.cos(e));
        const pos = new THREE.Vector3(0, 1.79, -0.015).addScaledVector(dir, 0.2);
        p.add('hair', 'Head', new THREE.ConeGeometry(0.048, 0.12, 8), {
          pos: pos.toArray() as Vec3,
          quat: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir),
        });
      }
      break;
    }
    case 'long':
      topCap(0.218, Math.PI / 2, [0, 1.79, -0.01]);
      // Back half only (phi π…2π), so the face stays clear.
      p.add('hair', 'Head', new S(0.222, 28, 16, Math.PI, Math.PI, 0, Math.PI * 0.8), { pos: [0, 1.76, -0.01], scale: [1.03, 1.32, 1] });
      // Shoulder length: locks fall from behind the ears (never across the cheeks
      // or jaw, where they'd read as a beard), and a back panel to the shoulders.
      p.limb('hair', 'Head', [0.19, 1.8, -0.06], [0.2, 1.5, -0.09], 0.05);
      p.limb('hair', 'Head', [-0.19, 1.8, -0.06], [-0.2, 1.5, -0.09], 0.05);
      p.add('hair', 'Head', new THREE.CapsuleGeometry(0.12, 0.16, 6, 16), { pos: [0, 1.56, -0.13], scale: [1.35, 1, 0.55] });
      p.add('hair', 'Head', new S(1, 20, 12), { pos: [-0.04, 1.92, 0.13], rot: [0.5, 0, 0.25], scale: [0.2, 0.06, 0.1] });
      break;
    case 'bun':
      topCap(0.214, Math.PI * 0.56, [0, 1.785, -0.01]);
      p.add('hair', 'Head', new S(0.088, 18, 14), { pos: [0, 1.985, -0.08] });
      break;
    case 'buzz':
      topCap(0.206, Math.PI * 0.52, [0, 1.785, -0.008], [1, 0.97, 1]);
      backCap(0.206, [0, 1.78, -0.03]);
      break;
  }
}

// ---------------------------------------------------------------------- face
interface FaceShape {
  smile: number; // >0 smile, <0 frown
  width: number;
  browRaise: number;
  browTilt: number; // >0 raises the inner ends (worried / sad)
  eyeOpen: number;
}
const FACE_SHAPES: Record<'neutral' | 'happy' | 'sad' | 'blink', FaceShape> = {
  neutral: { smile: 0.016, width: 0.05, browRaise: 0, browTilt: 0, eyeOpen: 1 },
  happy: { smile: 0.034, width: 0.064, browRaise: 0.014, browTilt: -0.08, eyeOpen: 1 },
  sad: { smile: -0.022, width: 0.044, browRaise: 0.006, browTilt: 0.42, eyeOpen: 1 },
  blink: { smile: 0.016, width: 0.05, browRaise: 0, browTilt: 0, eyeOpen: 0.08 },
};

class MouthCurve extends THREE.Curve<THREE.Vector3> {
  private readonly width: number;
  private readonly smile: number;
  constructor(width: number, smile: number) {
    super();
    this.width = width;
    this.smile = smile;
  }
  override getPoint(t: number, target = new THREE.Vector3()): THREE.Vector3 {
    const x = (t * 2 - 1) * this.width;
    const y = 1.712 - this.smile * (1 - (x / this.width) ** 2);
    return target.set(x, y, faceZ(x, y) + 0.004);
  }
}

/** Eyes, mouth and brows. Every shape has identical topology, so shapes can be morph targets. */
function faceGeometry(s: FaceShape, lashes: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const side of [1, -1]) {
    const x = 0.075 * side;
    const y = 1.792;
    const eye = new THREE.SphereGeometry(0.026, 14, 10);
    eye.scale(1, s.eyeOpen, 0.7);
    eye.translate(x, y, faceZ(x, y) + 0.004);
    parts.push(eye);
    // Two lash flicks at the outer top of the eye; they follow the lid when blinking.
    for (const [along, tilt] of lashes ? [[0.45, 0.55], [0.7, 0.9], [0.92, 1.25]] : []) {
      const a = (Math.PI / 2) * along; // angle around the eye from the top
      const lx = x + side * 0.028 * Math.sin(a);
      const ly = y + 0.026 * s.eyeOpen * Math.cos(a) + 0.008 * s.eyeOpen;
      const lash = new THREE.CapsuleGeometry(0.0055, 0.018, 2, 6);
      lash.rotateZ(-side * tilt);
      lash.translate(lx, ly, faceZ(lx, ly) + 0.006);
      parts.push(lash);
    }
  }
  parts.push(new THREE.TubeGeometry(new MouthCurve(s.width, s.smile), 20, 0.0105, 6, false));
  for (const side of [1, -1]) {
    const x = 0.078 * side;
    const y = 1.865 + s.browRaise;
    const brow = new THREE.CapsuleGeometry(0.0085, 0.046, 3, 8);
    brow.rotateZ(Math.PI / 2);
    brow.rotateZ(-side * s.browTilt);
    brow.translate(x, y, faceZ(x, y) + 0.006);
    parts.push(brow);
  }
  return mergeGeometries(parts)!;
}

function buildFace(material: THREE.Material, skeleton: THREE.Skeleton, lashes: boolean): THREE.SkinnedMesh {
  const base = faceGeometry(FACE_SHAPES.neutral, lashes);
  const position: THREE.BufferAttribute[] = [];
  const normal: THREE.BufferAttribute[] = [];
  for (const name of ['happy', 'sad', 'blink'] as const) {
    const g = faceGeometry(FACE_SHAPES[name], lashes);
    if (g.attributes.position.count !== base.attributes.position.count) throw new Error('Face morph topology mismatch');
    const pos = g.attributes.position.clone() as THREE.BufferAttribute;
    const nor = g.attributes.normal.clone() as THREE.BufferAttribute;
    pos.name = name;
    nor.name = name;
    position.push(pos);
    normal.push(nor);
  }
  base.morphAttributes.position = position;
  base.morphAttributes.normal = normal;
  skin(base, BONE_NAMES.indexOf('Head'));
  const face = new THREE.SkinnedMesh(base, material);
  face.name = 'Face';
  face.bind(skeleton, new THREE.Matrix4());
  return face;
}

// ----------------------------------------------------------------- materials
function materials(r: CharacterRecipe): Record<Slot | 'face', THREE.MeshStandardMaterial> {
  const m = (name: string, color: string, roughness = 0.65) =>
    new THREE.MeshStandardMaterial({ name, color: new THREE.Color(color), roughness, metalness: 0 });
  return {
    skin: m('skin', r.skinTone, 0.7),
    hair: m('hair', r.hairColor, 0.8),
    shirt: m('shirt', r.shirtColor),
    accent: m('accent', r.accentColor),
    pants: m('pants', r.pantsColor, 0.75),
    shoes: m('shoes', r.shoeColor),
    sole: m('sole', '#9aa7b8'),
    frame: m('frame', '#2b2f38', 0.4),
    blush: m('blush', '#f08a8a', 0.8),
    face: m('face', '#1d2433', 0.35),
  };
}

// --------------------------------------------------------------- animation
type Bones = Record<BoneName, THREE.Bone>;

interface Frame {
  rot?: Partial<Record<BoneName, Vec3>>;
  hips?: Vec3; // offset from the rest position
  grounded?: boolean; // default true: the lowest foot touches the floor
  drink?: { weight: number; tilt: number }; // IK blend toward "bottle at the mouth"
  holding?: boolean; // the right hand holds something: keep it upright
}

const X = new THREE.Vector3(1, 0, 0);
const Y = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);
const MOUTH_IN_HEAD = new THREE.Vector3(0, 1.704 - JOINTS.Head[1], faceZ(0, 1.704));
const smooth = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};
const range = (t: number, a: number, b: number) => smooth((t - a) / (b - a));
const KNEE_RADIUS = 0.1;

interface Snapshot {
  quats: THREE.Quaternion[]; // per bone, in BONE_NAMES order
  hips: THREE.Vector3;
}

class Baker {
  private readonly rest: Record<BoneName, THREE.Vector3>;

  constructor(
    private readonly bones: Bones,
    private readonly root: THREE.Object3D,
  ) {
    this.rest = Object.fromEntries(BONE_NAMES.map((n) => [n, bones[n].position.clone()])) as Record<BoneName, THREE.Vector3>;
  }

  reset() {
    for (const n of BONE_NAMES) {
      this.bones[n].quaternion.identity();
      this.bones[n].position.copy(this.rest[n]);
    }
    this.root.updateMatrixWorld(true);
  }

  /** Keeps the bottle (and so the right hand) upright, turning only with the body. */
  private holdBottleUpright() {
    const hand = this.bones.Hand_R;
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(this.bones.Hips.getWorldQuaternion(new THREE.Quaternion()));
    const desired = new THREE.Quaternion()
      .setFromAxisAngle(Y, Math.atan2(fwd.x, fwd.z))
      .multiply(new THREE.Quaternion().setFromAxisAngle(X, 0.06));
    const parent = hand.parent!.getWorldQuaternion(new THREE.Quaternion());
    hand.quaternion.copy(parent.invert().multiply(desired));
    this.root.updateMatrixWorld(true);
  }

  /** Two-bone IK: right arm pose that puts the bottle's cap at the mouth, tipped up by `tilt`. */
  private drinkPose(tilt: number): Record<'UpperArm_R' | 'LowerArm_R' | 'Hand_R', THREE.Quaternion> {
    const { Head, UpperArm_R: upper } = this.bones;
    const headQ = Head.getWorldQuaternion(new THREE.Quaternion());
    const mouth = Head.localToWorld(MOUTH_IN_HEAD.clone());
    const face = new THREE.Vector3(0, 0, 1).applyQuaternion(headQ);
    const headRight = X.clone().applyQuaternion(headQ);
    // Bottle axis (bottom → cap) points into the mouth, bottom raised by `tilt`
    // and swung out towards the drinking hand, as people do; it also keeps the
    // bottle readable from the front instead of pointing straight at the viewer.
    const headUp = Y.clone().applyQuaternion(headQ);
    const axis = face.clone().negate().applyAxisAngle(headRight, -tilt).applyAxisAngle(headUp, -0.45).normalize();
    const handQ = new THREE.Quaternion().setFromUnitVectors(Y, axis);
    const capInHand = new THREE.Vector3(...BOTTLE.socket).add(new THREE.Vector3(0, BOTTLE.capTop, 0));
    const capTarget = mouth.addScaledVector(face, 0.012);
    const wrist = capTarget.sub(capInHand.applyQuaternion(handQ));

    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const toWrist = wrist.clone().sub(shoulder);
    const dist = THREE.MathUtils.clamp(toWrist.length(), Math.abs(UPPER_ARM - FOREARM) + 1e-3, UPPER_ARM + FOREARM - 1e-3);
    const dir = toWrist.normalize();
    const pole = new THREE.Vector3(-0.55, -0.7, 0.25).normalize(); // elbow out, down, a little forward
    const bend = pole.addScaledVector(dir, -pole.dot(dir)).normalize();
    const cosA = (UPPER_ARM ** 2 + dist ** 2 - FOREARM ** 2) / (2 * UPPER_ARM * dist);
    const a = Math.acos(THREE.MathUtils.clamp(cosA, -1, 1));
    const elbow = shoulder.clone().addScaledVector(dir, UPPER_ARM * Math.cos(a)).addScaledVector(bend, UPPER_ARM * Math.sin(a));
    const reached = shoulder.clone().addScaledVector(dir, dist);

    const upperW = new THREE.Quaternion().setFromUnitVectors(DOWN, elbow.clone().sub(shoulder).normalize());
    const lowerW = new THREE.Quaternion().setFromUnitVectors(DOWN, reached.sub(elbow).normalize());
    const chestW = upper.parent!.getWorldQuaternion(new THREE.Quaternion());
    return {
      UpperArm_R: chestW.invert().multiply(upperW),
      LowerArm_R: upperW.clone().invert().multiply(lowerW),
      Hand_R: lowerW.clone().invert().multiply(handQ),
    };
  }

  pose(f: Frame) {
    this.reset();
    const e = new THREE.Euler();
    for (const [name, r] of Object.entries(f.rot ?? {}) as Array<[BoneName, Vec3]>) {
      this.bones[name].quaternion.setFromEuler(e.set(r[0], r[1], r[2]));
    }
    if (f.hips) this.bones.Hips.position.add(new THREE.Vector3(...f.hips));
    this.root.updateMatrixWorld(true);
    if (f.grounded !== false) {
      const v = new THREE.Vector3();
      const lowest = Math.min(this.bones.Foot_L.getWorldPosition(v).y, this.bones.Foot_R.getWorldPosition(v).y);
      this.bones.Hips.position.y += ANKLE_Y - lowest;
      this.root.updateMatrixWorld(true);
    }
    if (f.holding) this.holdBottleUpright();
    if (f.drink && f.drink.weight > 0) {
      const target = this.drinkPose(f.drink.tilt);
      for (const name of ['UpperArm_R', 'LowerArm_R', 'Hand_R'] as const) {
        this.bones[name].quaternion.slerp(target[name], f.drink.weight);
      }
      this.root.updateMatrixWorld(true);
    }
  }

  // ---- posing helpers for poses that aren't simple joint angles (sitting)

  /** The current pose, to blend between key poses. */
  snapshot(): Snapshot {
    return { quats: BONE_NAMES.map((b) => this.bones[b].quaternion.clone()), hips: this.bones.Hips.position.clone() };
  }

  /** Poses the skeleton between two snapshots (k = 0…1), never sinking feet or knees into the floor. */
  blend(a: Snapshot, b: Snapshot, k: number) {
    BONE_NAMES.forEach((name, i) => this.bones[name].quaternion.slerpQuaternions(a.quats[i], b.quats[i], k));
    this.bones.Hips.position.lerpVectors(a.hips, b.hips, k);
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    const sink = Math.min(
      this.bones.Foot_L.getWorldPosition(v).y - ANKLE_Y,
      this.bones.Foot_R.getWorldPosition(v).y - ANKLE_Y,
      this.bones.LowerLeg_L.getWorldPosition(v).y - KNEE_RADIUS,
      this.bones.LowerLeg_R.getWorldPosition(v).y - KNEE_RADIUS,
    );
    if (sink < 0) {
      this.bones.Hips.position.y -= sink;
      this.root.updateMatrixWorld(true);
    }
  }

  /** Turns a limb bone (they all point down at rest) so it points along a world direction. */
  private aim(name: BoneName, dir: THREE.Vector3) {
    const bone = this.bones[name];
    const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parent.invert().multiply(new THREE.Quaternion().setFromUnitVectors(DOWN, dir.clone().normalize())));
    this.root.updateMatrixWorld(true);
  }

  /** Turns a foot so its toes (+Z) point along `toes` and its sole (-Y) faces `sole`. */
  private orient(name: BoneName, toes: THREE.Vector3, sole: THREE.Vector3) {
    const z = toes.clone().normalize();
    const y = sole.clone().negate().addScaledVector(z, sole.dot(z)).normalize(); // up = away from the sole, ⟂ toes
    const x = new THREE.Vector3().crossVectors(y, z);
    const world = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    const bone = this.bones[name];
    const parent = bone.parent!.getWorldQuaternion(new THREE.Quaternion());
    bone.quaternion.copy(parent.invert().multiply(world));
    this.root.updateMatrixWorld(true);
  }

  /** Two-bone IK: puts an arm's wrist at a world point, the elbow bending towards `pole`. */
  private reach(side: 'L' | 'R', wrist: THREE.Vector3, pole: THREE.Vector3) {
    const upper = this.bones[`UpperArm_${side}`];
    const shoulder = upper.getWorldPosition(new THREE.Vector3());
    const toWrist = wrist.clone().sub(shoulder);
    const dist = THREE.MathUtils.clamp(toWrist.length(), Math.abs(UPPER_ARM - FOREARM) + 1e-3, UPPER_ARM + FOREARM - 1e-3);
    const dir = toWrist.normalize();
    const bend = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    const a = Math.acos(THREE.MathUtils.clamp((UPPER_ARM ** 2 + dist ** 2 - FOREARM ** 2) / (2 * UPPER_ARM * dist), -1, 1));
    const elbow = shoulder.clone().addScaledVector(dir, UPPER_ARM * Math.cos(a)).addScaledVector(bend, UPPER_ARM * Math.sin(a));
    this.aim(`UpperArm_${side}`, elbow.clone().sub(shoulder));
    this.aim(`LowerArm_${side}`, shoulder.addScaledVector(dir, dist).sub(elbow));
  }

  /**
   * Sitting cross-legged on the floor, hands resting on the knees (relaxing
   * is prop-free). `breath` (0…1) lifts the chest and
   * shoulders; `sway` (-1…1) tilts the head a little from side to side.
   */
  seated(breath: number, sway: number) {
    this.reset();
    const e = new THREE.Euler();
    const set = (name: BoneName, r: Vec3) => this.bones[name].quaternion.setFromEuler(e.set(...r));
    this.bones.Hips.position.add(new THREE.Vector3(0, SEAT.hipsY - JOINTS.Hips[1] + 0.012 * breath, -0.02));
    set('Spine', [0.07 - 0.03 * breath, 0, 0.012 * sway]);
    set('Chest', [0.03 - 0.06 * breath, 0, 0]);
    set('Neck', [0.02 + 0.03 * breath, 0, 0]);
    // Chin slightly lowered (not so far that the hair hides the closed eyes), head resting to one side.
    set('Head', [0.03 + 0.02 * breath, 0.05 * sway, 0.08 + 0.035 * sway]);
    this.root.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    for (const [side, s] of [['L', 1], ['R', -1]] as const) {
      // Knees out to the sides, shins crossed in front (the left one on top).
      this.aim(`UpperLeg_${side}`, new THREE.Vector3(0.72 * s, 0.05, 0.69));
      const knee = this.bones[`LowerLeg_${side}`].getWorldPosition(v.clone());
      const ankle = side === 'L' ? new THREE.Vector3(-0.1, 0.1, 0.28) : new THREE.Vector3(0.11, 0.1, 0.17);
      this.aim(`LowerLeg_${side}`, ankle.sub(knee));
      // Each foot tucks under the opposite knee: toes out, the sole turned up and back.
      this.orient(`Foot_${side}`, new THREE.Vector3(-0.85 * s, 0, 0.5), new THREE.Vector3(0, 0.35, -0.94));
      // Hands rest on the knees.
      const rest = knee.clone().add(new THREE.Vector3(-0.01 * s, SEAT.handAboveKnee, -0.01));
      this.reach(side, rest, new THREE.Vector3(0.7 * s, -0.1, -0.7));
    }
  }

  bake(name: string, duration: number, frame: (t: number, w: number) => Frame, fps = 30): THREE.AnimationClip {
    return this.bakeWith(name, duration, (t, w) => this.pose(frame(t, w)), fps);
  }

  /** Bakes a clip whose frames are posed directly (poseAt leaves the skeleton in the frame's pose). */
  bakeWith(name: string, duration: number, poseAt: (t: number, w: number) => void, fps = 30): THREE.AnimationClip {
    const n = Math.round(duration * fps);
    const times: number[] = [];
    const quats = Object.fromEntries(BONE_NAMES.map((b) => [b, [] as number[]])) as Record<BoneName, number[]>;
    const hips: number[] = [];
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * duration;
      poseAt(t, (2 * Math.PI * t) / duration);
      times.push(t);
      for (const b of BONE_NAMES) quats[b].push(...this.bones[b].quaternion.toArray());
      hips.push(...this.bones.Hips.position.toArray());
    }
    const tracks: THREE.KeyframeTrack[] = BONE_NAMES.map((b) => new THREE.QuaternionKeyframeTrack(`${b}.quaternion`, times, quats[b]));
    tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hips));
    return new THREE.AnimationClip(name, duration, tracks);
  }
}

const ARM_OUT = 0.12; // keeps relaxed arms off the torso
/** Right arm carrying something (a bottle, a pill bottle) in front of the hip. */
const HOLD_R = { UpperArm_R: [-0.12, 0, -0.1] as Vec3, LowerArm_R: [-0.95, 0, 0] as Vec3 };

/**
 * The right arm's bones. Body clips move them freely; while the character
 * holds a prop, the runtime plays a hand-pose clip on just these bones instead
 * (see AnimationController), so one set of clips works with and without props.
 */
export const ARM_R_BONES = ['UpperArm_R', 'LowerArm_R', 'Hand_R'] as const;
/** Hand-pose clips (right arm only), by pose. Not animation roles: they never play on their own. */
export const HAND_POSE_CLIPS = { carry: 'HandCarry' } as const;
export type HandPose = keyof typeof HAND_POSE_CLIPS;

const idleFrame = (w: number): Frame => ({
  rot: {
    Chest: [0.025 * Math.sin(w), 0, 0],
    Head: [-0.02 * Math.sin(w), 0.12 * Math.sin(w), 0.03 * Math.sin(w)],
    UpperArm_L: [0.04 * Math.sin(w), 0, ARM_OUT + 0.02 * Math.sin(w)],
    LowerArm_L: [-0.12, 0, 0],
    UpperArm_R: [0.04 * Math.sin(w + 0.6), 0, -ARM_OUT - 0.02 * Math.sin(w + 0.6)],
    LowerArm_R: [-0.12, 0, 0],
  },
});

/** Halfway down (or up): knees deep, leaning forward for balance, the free hand reaching for the floor. */
const CROUCH: Frame = {
  rot: {
    Spine: [0.34, 0, 0],
    Chest: [0.12, 0, 0],
    Neck: [-0.12, 0, 0],
    Head: [-0.14, 0, 0],
    UpperLeg_L: [-1.2, 0, 0.14],
    UpperLeg_R: [-1.2, 0, -0.14],
    LowerLeg_L: [1.7, 0, 0],
    LowerLeg_R: [1.7, 0, 0],
    Foot_L: [-0.5, 0, 0],
    Foot_R: [-0.5, 0, 0],
    UpperArm_L: [-0.55, 0, 0.22],
    LowerArm_L: [-0.45, 0, 0],
    UpperArm_R: [-0.55, 0, -0.22],
    LowerArm_R: [-0.45, 0, 0],
  },
};

/** Sitting down, the seated breathing loop and standing up (Relax mode). */
function bakeRelaxClips(b: Baker): THREE.AnimationClip[] {
  const key = (pose: () => void) => {
    pose();
    return b.snapshot();
  };
  const stand = key(() => b.pose(idleFrame(0)));
  const crouch = key(() => b.pose(CROUCH));
  const seated = key(() => b.seated(0, 0)); // = the first frame of Relax
  const through = (t: number, mid: number, end: number, from: Snapshot, via: Snapshot, to: Snapshot) =>
    t < mid ? b.blend(from, via, range(t, 0, mid)) : b.blend(via, to, range(t, mid, end));

  const sitDown = b.bakeWith('SitDown', SIT.down, (t) => through(t, SIT.downCrouch, SIT.down, stand, crouch, seated));
  const standUp = b.bakeWith('StandUp', SIT.up, (t) => through(t, SIT.upCrouch, SIT.up, seated, crouch, stand));
  // Two slow breaths per loop (in through the nose, a longer breath out), head swaying once.
  const relax = b.bakeWith(
    'Relax',
    2 * SIT.breath,
    (_t, w) => {
      const phase = (2 * w) % (2 * Math.PI);
      const breath = phase < 2.4 ? smooth(phase / 2.4) : 1 - smooth((phase - 2.4) / (2 * Math.PI - 2.4));
      b.seated(breath, Math.sin(w));
    },
    15,
  );
  return [sitDown, relax, standUp];
}

function bakeClips(b: Baker): THREE.AnimationClip[] {
  const idle = b.bake('Idle', 3, (_t, w) => idleFrame(w));

  const walk = b.bake('Walk', WALK.cycle, (_t, w) => {
    const c = Math.cos(w);
    const s = Math.sin(w);
    const A = WALK.amplitude;
    return {
      rot: {
        Hips: [0, 0.08 * c, 0],
        Spine: [0.05, -0.1 * c, 0],
        Head: [0, 0.04 * c, 0],
        UpperLeg_L: [-A * c, 0, 0],
        UpperLeg_R: [A * c, 0, 0],
        LowerLeg_L: [0.12 + 0.95 * Math.max(0, -s) ** 1.3, 0, 0],
        LowerLeg_R: [0.12 + 0.95 * Math.max(0, s) ** 1.3, 0, 0],
        Foot_L: [0.25 * c - 0.1, 0, 0],
        Foot_R: [-0.25 * c - 0.1, 0, 0],
        UpperArm_L: [0.4 * c, 0, ARM_OUT],
        LowerArm_L: [-0.3 - 0.15 * Math.max(0, -c), 0, 0],
        UpperArm_R: [-0.4 * c, 0, -ARM_OUT],
        LowerArm_R: [-0.3 - 0.15 * Math.max(0, c), 0, 0],
      },
    };
  });

  // Waves with the left hand: the right one holds the bottle.
  const wave = b.bake('Wave', 2.2, (t) => {
    const up = smooth(Math.min(1, t / 0.3, (2.2 - t) / 0.3));
    const wv = Math.sin(2 * Math.PI * 2.2 * t);
    return {
      rot: {
        Head: [0.03 * up, 0.15 * up, -0.08 * up],
        Chest: [0, 0.06 * up, -0.04 * up],
        UpperArm_L: [-0.25 * up, 0, ARM_OUT + 2.45 * up],
        LowerArm_L: [-0.2 * up, 0, up * (0.15 - 0.45 * wv)],
        Hand_L: [0, 0, -up * 0.2 * wv],
        UpperArm_R: [0.03, 0, -ARM_OUT],
        LowerArm_R: [-0.15, 0, 0],
      },
    };
  });

  // Lift the bottle, drink with a few gulps while tipping it up, lower it, "ahh".
  const D = DRINK;
  const drink = b.bake('Drink', D.duration, (t) => {
    const weight = range(t, 0, D.liftEnd) * (1 - range(t, D.drinkEnd, D.lowerEnd));
    const sip = range(t, D.liftEnd, D.drinkEnd);
    const drinking = t > D.liftEnd && t < D.drinkEnd ? 1 : 0;
    const gulp = drinking * 0.025 * Math.sin(2 * Math.PI * 2.2 * (t - D.liftEnd));
    const ahh = t > D.lowerEnd ? Math.sin((Math.PI * (t - D.lowerEnd)) / (D.duration - D.lowerEnd)) : 0;
    return {
      rot: {
        Chest: [-0.06 * weight - 0.08 * ahh, 0, 0],
        Neck: [-0.08 * weight, 0, 0],
        Head: [-(0.1 + 0.2 * sip) * weight + gulp - 0.12 * ahh, 0, 0],
        UpperArm_L: [0.05, 0, ARM_OUT + 0.1 * ahh],
        LowerArm_L: [-0.15, 0, 0],
        ...HOLD_R,
      },
      holding: true,
      drink: { weight, tilt: 0.3 + 0.55 * sip },
    };
  });

  const happy = b.bake('Happy', 1.1, (_t, w) => {
    const s = Math.sin(w);
    const air = Math.max(0, s);
    const crouch = Math.max(0, -s);
    const pump = Math.sin(2 * w);
    return {
      grounded: false,
      hips: [0, 0.2 * air - 0.08 * crouch, 0],
      rot: {
        Spine: [0.15 * crouch, 0, 0],
        Chest: [-0.12 * air, 0, 0],
        Head: [-0.18 * air, 0, 0],
        UpperLeg_L: [-0.55 * crouch - 0.1 * air, 0, 0.05],
        UpperLeg_R: [-0.55 * crouch - 0.1 * air, 0, -0.05],
        LowerLeg_L: [1.0 * crouch + 0.25 * air, 0, 0],
        LowerLeg_R: [1.0 * crouch + 0.25 * air, 0, 0],
        Foot_L: [-0.45 * crouch, 0, 0],
        Foot_R: [-0.45 * crouch, 0, 0],
        UpperArm_L: [-0.2, 0, 2.5 + 0.15 * pump],
        UpperArm_R: [-0.2, 0, -2.5 - 0.15 * pump],
        LowerArm_L: [0, 0, 0.35 * pump],
        LowerArm_R: [0, 0, -0.35 * pump],
      },
      holding: true, // arms up: whatever is in the hand stays upright
    };
  });

  // Disappointed sigh: breathe in, slump, shake the head.
  const sad = b.bake('Sad', 2, (t) => {
    const inhale = Math.sin(Math.PI * Math.min(1, t / 0.45));
    const slump = range(t, 0.35, 0.9);
    const shake = t > 0.8 ? Math.sin(2 * Math.PI * 1.6 * (t - 0.8)) * (1 - range(t, 1.5, 2)) : 0;
    return {
      rot: {
        Spine: [0.14 * slump, 0, 0],
        Chest: [-0.06 * inhale + 0.1 * slump, 0, 0],
        Neck: [0.08 * slump, 0, 0],
        Head: [0.2 * slump, 0.2 * shake, 0],
        UpperArm_L: [0.06 * slump, 0, ARM_OUT * (1 - 0.6 * slump)],
        LowerArm_L: [-0.12, 0, 0],
        UpperArm_R: [0.06 * slump, 0, -ARM_OUT * (1 - 0.6 * slump)],
        LowerArm_R: [-0.12, 0, 0],
      },
    };
  });

  // Slumped, slower shuffle, head down, bottle hanging low.
  const sadWalk = b.bake('SadWalk', SAD_WALK.cycle, (_t, w) => {
    const c = Math.cos(w);
    const s = Math.sin(w);
    const A = SAD_WALK.amplitude;
    return {
      rot: {
        Hips: [0, 0.05 * c, 0],
        Spine: [0.13, -0.05 * c, 0],
        Chest: [0.08, 0, 0],
        Neck: [-0.02, 0, 0],
        Head: [0.04 + 0.03 * Math.sin(2 * w), 0.05 * c, 0], // slumped body, face still visible
        UpperLeg_L: [-A * c, 0, 0],
        UpperLeg_R: [A * c, 0, 0],
        LowerLeg_L: [0.1 + 0.7 * Math.max(0, -s) ** 1.3, 0, 0],
        LowerLeg_R: [0.1 + 0.7 * Math.max(0, s) ** 1.3, 0, 0],
        Foot_L: [0.18 * c - 0.08, 0, 0],
        Foot_R: [-0.18 * c - 0.08, 0, 0],
        UpperArm_L: [0.15 * c, 0, 0.05],
        LowerArm_L: [-0.1, 0, 0],
        UpperArm_R: [-0.15 * c, 0, -0.05],
        LowerArm_R: [-0.1, 0, 0],
      },
    };
  });

  // A light jog: leaning in, longer strides, knees up, elbows bent and pumping.
  const run = b.bake('Run', RUN.cycle, (_t, w) => {
    const c = Math.cos(w);
    const s = Math.sin(w);
    const A = RUN.amplitude;
    return {
      hips: [0, 0.03 * Math.abs(Math.sin(w)), 0],
      rot: {
        Hips: [0, 0.1 * c, 0],
        Spine: [0.16, -0.14 * c, 0],
        Chest: [0.04, 0, 0],
        Head: [-0.12, 0.06 * c, 0],
        UpperLeg_L: [-A * c - 0.08, 0, 0],
        UpperLeg_R: [A * c - 0.08, 0, 0],
        LowerLeg_L: [0.3 + 1.45 * Math.max(0, -s) ** 1.2, 0, 0],
        LowerLeg_R: [0.3 + 1.45 * Math.max(0, s) ** 1.2, 0, 0],
        Foot_L: [0.3 * c - 0.15, 0, 0],
        Foot_R: [-0.3 * c - 0.15, 0, 0],
        UpperArm_L: [0.7 * c, 0, ARM_OUT + 0.05],
        LowerArm_L: [-1.25 - 0.2 * Math.max(0, -c), 0, 0],
        UpperArm_R: [-0.7 * c, 0, -ARM_OUT - 0.05],
        LowerArm_R: [-1.25 - 0.2 * Math.max(0, c), 0, 0],
      },
    };
  });

  // Hand pose: carrying something upright in front of the hip, with a little give.
  const carry = b.bake(HAND_POSE_CLIPS.carry, 3, (_t, w) => ({
    rot: { UpperArm_R: [HOLD_R.UpperArm_R[0] + 0.02 * Math.sin(w), 0, HOLD_R.UpperArm_R[2]], LowerArm_R: HOLD_R.LowerArm_R },
    holding: true,
  }));
  carry.tracks = carry.tracks.filter((t) => ARM_R_BONES.some((bone) => t.name.startsWith(`${bone}.`)));

  return [idle, walk, wave, drink, happy, sad, sadWalk, run, ...bakeRelaxClips(b), carry];
}

function buildSkeleton(): { bones: Bones; root: THREE.Group } {
  const bones = Object.fromEntries(
    BONE_NAMES.map((name) => {
      const bone = new THREE.Bone();
      bone.name = name;
      return [name, bone];
    }),
  ) as Bones;
  for (const name of BONE_NAMES) {
    const parent = PARENT[name];
    const world = new THREE.Vector3(...JOINTS[name]);
    if (parent) {
      bones[name].position.copy(world.sub(new THREE.Vector3(...JOINTS[parent])));
      bones[parent].add(bones[name]);
    } else {
      bones[name].position.copy(world);
    }
  }
  const root = new THREE.Group();
  root.name = 'AquaMate';
  root.add(bones.Root);
  root.updateMatrixWorld(true);
  return { bones, root };
}

let sharedClips: THREE.AnimationClip[] | null = null;
/**
 * The clips every procedural character has. They depend only on the
 * skeleton, so characters saved by an older version (whose files lack newer
 * clips, like Run or the Relax ones) get them added when they load.
 */
export function proceduralClips(): THREE.AnimationClip[] {
  if (!sharedClips) {
    const { bones, root } = buildSkeleton();
    sharedClips = bakeClips(new Baker(bones, root));
  }
  return sharedClips;
}

// -------------------------------------------------------------------- build
export interface BuiltCharacter {
  root: THREE.Group;
  clips: THREE.AnimationClip[];
}

export function buildCharacter(recipe: CharacterRecipe): BuiltCharacter {
  const { bones, root } = buildSkeleton();
  const skeleton = new THREE.Skeleton(BONE_NAMES.map((n) => bones[n])); // inverses from the rest pose

  const parts = new Parts();
  buildBody(parts, recipe);
  const mats = materials(recipe);
  for (const [slot, geos] of parts.slots) {
    const mesh = new THREE.SkinnedMesh(mergeGeometries(geos)!, mats[slot]);
    mesh.name = `Body_${slot}`;
    root.add(mesh);
    mesh.bind(skeleton, new THREE.Matrix4());
  }
  root.add(buildFace(mats.face, skeleton, recipe.body === 'female'));

  const baker = new Baker(bones, root);
  const clips = bakeClips(baker);
  baker.reset(); // export in the rest pose

  const meta: AquaMateMeta = {
    version: 1,
    generator: 'aquamate-procedural',
    recipe,
    height: RIG_HEIGHT,
    locomotion: { ...LOCOMOTION },
    drink: { start: DRINK.liftEnd / DRINK.duration, end: DRINK.drinkEnd / DRINK.duration },
    props: { bottle: { bone: 'Hand_R', position: [...BOTTLE.socket], quaternion: [0, 0, 0, 1] } },
  };
  root.userData.aquamate = meta;
  return { root, clips };
}
