/**
 * Generates assets/models/human-character.glb: a PLACEHOLDER rigged, low-poly,
 * stylized human (blue + white casual outfit) with Idle, Walk, Wave and Happy clips.
 *
 * Every body part is rigidly skinned to one bone of a real skeleton, so the file
 * behaves exactly like a production rigged GLB (SkinnedMesh + bones + clips) and
 * can be swapped for an artist-made model without code changes.
 *
 *   node scripts/generate-placeholder-model.mjs
 */
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// GLTFExporter uses the browser FileReader; give Node a tiny stand-in.
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { this.#done(blob.arrayBuffer()); }
  readAsDataURL(blob) {
    this.#done(blob.arrayBuffer().then((b) =>
      `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`));
  }
  #done(p) {
    p.then((r) => { this.result = r; this.onload?.({ target: this }); this.onloadend?.({ target: this }); });
  }
};

// ---------------------------------------------------------------- skeleton --
// Rest pose joint positions (world space, metres, Y up, character faces +Z).
const J = {
  Root: [0, 0, 0],
  Hips: [0, 0.95, 0],
  Spine: [0, 1.06, 0],
  Chest: [0, 1.24, 0],
  Neck: [0, 1.5, 0],
  Head: [0, 1.57, 0],
  'UpperArm.L': [0.26, 1.44, 0],
  'LowerArm.L': [0.26, 1.17, 0],
  'Hand.L': [0.26, 0.93, 0],
  'UpperArm.R': [-0.26, 1.44, 0],
  'LowerArm.R': [-0.26, 1.17, 0],
  'Hand.R': [-0.26, 0.93, 0],
  'UpperLeg.L': [0.1, 0.9, 0],
  'LowerLeg.L': [0.1, 0.5, 0],
  'Foot.L': [0.1, 0.09, 0],
  'UpperLeg.R': [-0.1, 0.9, 0],
  'LowerLeg.R': [-0.1, 0.5, 0],
  'Foot.R': [-0.1, 0.09, 0],
};
const PARENT = {
  Hips: 'Root', Spine: 'Hips', Chest: 'Spine', Neck: 'Chest', Head: 'Neck',
  'UpperArm.L': 'Chest', 'LowerArm.L': 'UpperArm.L', 'Hand.L': 'LowerArm.L',
  'UpperArm.R': 'Chest', 'LowerArm.R': 'UpperArm.R', 'Hand.R': 'LowerArm.R',
  'UpperLeg.L': 'Hips', 'LowerLeg.L': 'UpperLeg.L', 'Foot.L': 'LowerLeg.L',
  'UpperLeg.R': 'Hips', 'LowerLeg.R': 'UpperLeg.R', 'Foot.R': 'LowerLeg.R',
};
const boneNames = Object.keys(J);
const bones = {};
for (const name of boneNames) {
  const b = new THREE.Bone();
  b.name = name;
  bones[name] = b;
}
for (const name of boneNames) {
  const p = PARENT[name];
  const w = new THREE.Vector3(...J[name]);
  if (p) {
    bones[name].position.copy(w.sub(new THREE.Vector3(...J[p])));
    bones[p].add(bones[name]);
  } else {
    bones[name].position.copy(w);
  }
}
const REST = Object.fromEntries(boneNames.map((n) => [n, bones[n].position.clone()]));

// ------------------------------------------------------------------ meshes --
const COLORS = {
  skin: 0xf2c6a0,
  hair: 0x4a3222,
  shirt: 0x2f80ed, // blue tee
  white: 0xf7f9fc, // collar, stripe, cuffs, sneakers
  pants: 0x24467a, // navy chinos
  sole: 0x9aa7b8,
  dark: 0x1d2433, // eyes, smile
};
const parts = Object.fromEntries(Object.keys(COLORS).map((k) => [k, []]));

function add(color, bone, geo, { pos = [0, 0, 0], rot = [0, 0, 0], scale = [1, 1, 1] } = {}) {
  const g = geo.index ? geo.clone() : geo.toNonIndexed();
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...scale),
  );
  g.applyMatrix4(m);
  const n = g.attributes.position.count;
  const bi = boneNames.indexOf(bone);
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? bi : 0)), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(new Array(n * 4).fill(0).map((_, i) => (i % 4 === 0 ? 1 : 0)), 4));
  parts[color].push(g);
}
/** Capsule spanning two joint positions. */
function limb(color, bone, a, b, r, extra = 0) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B) + extra;
  const geo = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 14);
  const mid = A.clone().add(B).multiplyScalar(0.5);
  add(color, bone, geo, { pos: mid.toArray() });
}

// Head
add('skin', 'Head', new THREE.SphereGeometry(0.2, 28, 20), { pos: [0, 1.77, 0], scale: [1, 1.08, 1] });
add('skin', 'Head', new THREE.SphereGeometry(0.045, 10, 8), { pos: [0.2, 1.76, -0.01] }); // ears
add('skin', 'Head', new THREE.SphereGeometry(0.045, 10, 8), { pos: [-0.2, 1.76, -0.01] });
add('skin', 'Head', new THREE.SphereGeometry(0.03, 10, 8), { pos: [0, 1.735, 0.2] }); // nose
add('hair', 'Head', new THREE.SphereGeometry(0.215, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), { pos: [0, 1.79, -0.015], scale: [1, 0.95, 1] });
add('hair', 'Head', new THREE.SphereGeometry(0.215, 28, 14, 0, Math.PI * 2, 0, Math.PI * 0.62), { pos: [0, 1.785, -0.045], rot: [-0.25, 0, 0] });
add('hair', 'Head', new THREE.SphereGeometry(1, 20, 12), { pos: [0.03, 1.915, 0.13], rot: [0.45, 0, -0.18], scale: [0.17, 0.055, 0.09] }); // fringe
add('dark', 'Head', new THREE.SphereGeometry(0.026, 12, 10), { pos: [0.075, 1.79, 0.19] });
add('dark', 'Head', new THREE.SphereGeometry(0.026, 12, 10), { pos: [-0.075, 1.79, 0.19] });
add('dark', 'Head', new THREE.TorusGeometry(0.055, 0.011, 6, 18, Math.PI), { pos: [0, 1.71, 0.19], rot: [0.25, 0, Math.PI] }); // smile
// Neck
add('skin', 'Neck', new THREE.CylinderGeometry(0.06, 0.065, 0.14, 14), { pos: [0, 1.53, 0] });
// Torso: blue tee with a white chest stripe and collar
add('shirt', 'Chest', new THREE.CylinderGeometry(0.22, 0.19, 0.34, 22), { pos: [0, 1.33, 0], scale: [1, 1, 0.72] });
add('shirt', 'Chest', new THREE.SphereGeometry(0.22, 22, 10, 0, Math.PI * 2, 0, Math.PI / 2), { pos: [0, 1.495, 0], scale: [1, 0.25, 0.72] });
add('white', 'Chest', new THREE.CylinderGeometry(0.217, 0.21, 0.06, 22, 1, true), { pos: [0, 1.3, 0], scale: [1.02, 1, 0.74] });
add('white', 'Chest', new THREE.TorusGeometry(0.08, 0.022, 8, 20), { pos: [0, 1.5, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.85, 1] });
add('shirt', 'Spine', new THREE.CylinderGeometry(0.19, 0.18, 0.24, 22), { pos: [0, 1.08, 0], scale: [1, 1, 0.74] });
add('white', 'Spine', new THREE.CylinderGeometry(0.185, 0.185, 0.03, 22, 1, true), { pos: [0, 0.975, 0], scale: [1.02, 1, 0.76] }); // hem
// Hips / pants
add('pants', 'Hips', new THREE.CylinderGeometry(0.182, 0.17, 0.16, 22), { pos: [0, 0.91, 0], scale: [1, 1, 0.76] });
// Arms: short blue sleeves with white cuffs, skin forearms
for (const s of ['L', 'R']) {
  const x = s === 'L' ? 0.26 : -0.26;
  add('shirt', `UpperArm.${s}`, new THREE.SphereGeometry(0.09, 16, 12), { pos: [x, 1.44, 0] });
  add('shirt', `UpperArm.${s}`, new THREE.CylinderGeometry(0.088, 0.08, 0.16, 16), { pos: [x, 1.36, 0] });
  add('white', `UpperArm.${s}`, new THREE.CylinderGeometry(0.083, 0.083, 0.03, 16, 1, true), { pos: [x, 1.28, 0] });
  limb('skin', `UpperArm.${s}`, [x, 1.4, 0], [x, 1.17, 0], 0.06);
  limb('skin', `LowerArm.${s}`, [x, 1.17, 0], [x, 0.95, 0], 0.055);
  add('skin', `Hand.${s}`, new THREE.SphereGeometry(0.068, 14, 10), { pos: [x, 0.89, 0.005], scale: [0.85, 1.1, 1] });
  // Legs + white sneakers
  const lx = s === 'L' ? 0.1 : -0.1;
  limb('pants', `UpperLeg.${s}`, [lx, 0.93, 0], [lx, 0.5, 0], 0.1);
  limb('pants', `LowerLeg.${s}`, [lx, 0.52, 0], [lx, 0.12, 0], 0.085);
  add('white', `Foot.${s}`, new THREE.CapsuleGeometry(0.07, 0.14, 4, 12), { pos: [lx, 0.07, 0.05], rot: [Math.PI / 2, 0, 0], scale: [1, 1, 0.85] });
  add('sole', `Foot.${s}`, new THREE.BoxGeometry(0.14, 0.03, 0.28), { pos: [lx, 0.015, 0.05] });
  add('shirt', `Foot.${s}`, new THREE.BoxGeometry(0.142, 0.022, 0.12), { pos: [lx, 0.085, 0.02] }); // blue stripe
}

// --------------------------------------------------------------- assemble --
const root = new THREE.Group();
root.name = 'AquaMate';
root.add(bones.Root);
root.updateMatrixWorld(true);
const skeleton = new THREE.Skeleton(boneNames.map((n) => bones[n]));
for (const [key, geos] of Object.entries(parts)) {
  if (!geos.length) continue;
  const geo = mergeGeometries(geos);
  geo.computeBoundingSphere();
  const mat = new THREE.MeshStandardMaterial({
    name: key,
    color: COLORS[key],
    roughness: key === 'dark' ? 0.3 : 0.65,
    metalness: 0,
  });
  const mesh = new THREE.SkinnedMesh(geo, mat);
  mesh.name = `Body_${key}`;
  root.add(mesh);
  mesh.bind(skeleton, new THREE.Matrix4());
}

// -------------------------------------------------------------- animation --
const FPS = 30;
const e2q = (x = 0, y = 0, z = 0) => new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z, 'XYZ'));
/** pose(t) returns { boneName: [rx, ry, rz] } plus optional hips offset. */
function clip(name, duration, pose) {
  const frames = Math.round(duration * FPS);
  const times = [];
  const q = Object.fromEntries(boneNames.map((n) => [n, []]));
  const hipsPos = [];
  for (let i = 0; i <= frames; i++) {
    const t = (i / frames) * duration;
    times.push(t);
    const p = pose(t, (2 * Math.PI * t) / duration);
    for (const n of boneNames) q[n].push(...e2q(...(p[n] || [0, 0, 0])).toArray());
    const off = p.hipsOffset || [0, 0, 0];
    hipsPos.push(REST.Hips.x + off[0], REST.Hips.y + off[1], REST.Hips.z + off[2]);
  }
  const tracks = boneNames.map((n) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times, q[n]));
  tracks.push(new THREE.VectorKeyframeTrack('Hips.position', times, hipsPos));
  return new THREE.AnimationClip(name, duration, tracks);
}
const ARM_OUT = 0.12; // keeps arms off the torso in relaxed poses

const idle = clip('Idle', 3, (t, w) => ({
  hipsOffset: [0, 0.006 * Math.sin(w), 0],
  Chest: [0.025 * Math.sin(w), 0, 0],
  Head: [-0.02 * Math.sin(w), 0.1 * Math.sin(w), 0.03 * Math.sin(w)],
  'UpperArm.L': [0.04 * Math.sin(w), 0, ARM_OUT + 0.02 * Math.sin(w)],
  'UpperArm.R': [0.04 * Math.sin(w), 0, -ARM_OUT - 0.02 * Math.sin(w)],
  'LowerArm.L': [-0.12, 0, 0],
  'LowerArm.R': [-0.12, 0, 0],
}));

const WALK_AMP = 0.45;
const walk = clip('Walk', 1, (t, w) => {
  const c = Math.cos(w), s = Math.sin(w);
  const kneeL = 0.12 + 0.95 * Math.max(0, -s) ** 1.3;
  const kneeR = 0.12 + 0.95 * Math.max(0, s) ** 1.3;
  return {
    hipsOffset: [0, -0.025 * Math.cos(2 * w), 0],
    Hips: [0, 0.08 * c, 0],
    Spine: [0.05, -0.1 * c, 0],
    Head: [0, 0.04 * c, 0],
    'UpperLeg.L': [-WALK_AMP * c, 0, 0],
    'UpperLeg.R': [WALK_AMP * c, 0, 0],
    'LowerLeg.L': [kneeL, 0, 0],
    'LowerLeg.R': [kneeR, 0, 0],
    'Foot.L': [0.25 * c - 0.1, 0, 0],
    'Foot.R': [-0.25 * c - 0.1, 0, 0],
    'UpperArm.L': [0.4 * c, 0, ARM_OUT],
    'UpperArm.R': [-0.4 * c, 0, -ARM_OUT],
    'LowerArm.L': [-0.3 - 0.15 * Math.max(0, -c), 0, 0],
    'LowerArm.R': [-0.3 - 0.15 * Math.max(0, c), 0, 0],
  };
});

const smooth = (x) => x * x * (3 - 2 * x);
const wave = clip('Wave', 2.2, (t) => {
  const up = smooth(Math.min(1, t / 0.3, (2.2 - t) / 0.3));
  const wv = Math.sin(2 * Math.PI * 2.2 * t);
  return {
    Head: [0.03 * up, -0.15 * up, 0.08 * up],
    Chest: [0, -0.06 * up, 0.04 * up],
    'UpperArm.L': [0, 0, ARM_OUT],
    'LowerArm.L': [-0.12, 0, 0],
    'UpperArm.R': [-0.25 * up, 0, -ARM_OUT - 2.45 * up],
    'LowerArm.R': [-0.2 * up, 0, up * (-0.15 + 0.45 * wv)],
    'Hand.R': [0, 0, up * 0.2 * wv],
  };
});

const happy = clip('Happy', 1.1, (t, w) => {
  const s = Math.sin(w);
  const air = Math.max(0, s);
  const crouch = Math.max(0, -s);
  const pump = Math.sin(2 * w);
  return {
    hipsOffset: [0, 0.2 * air - 0.08 * crouch, 0],
    Spine: [0.15 * crouch, 0, 0],
    Chest: [-0.12 * air, 0, 0],
    Head: [-0.18 * air, 0, 0],
    'UpperLeg.L': [-0.55 * crouch - 0.1 * air, 0, 0.05],
    'UpperLeg.R': [-0.55 * crouch - 0.1 * air, 0, -0.05],
    'LowerLeg.L': [1.0 * crouch + 0.25 * air, 0, 0],
    'LowerLeg.R': [1.0 * crouch + 0.25 * air, 0, 0],
    'Foot.L': [-0.45 * crouch, 0, 0],
    'Foot.R': [-0.45 * crouch, 0, 0],
    'UpperArm.L': [-0.2, 0, 2.5 + 0.15 * pump],
    'UpperArm.R': [-0.2, 0, -2.5 - 0.15 * pump],
    'LowerArm.L': [0, 0, 0.35 * pump],
    'LowerArm.R': [0, 0, -0.35 * pump],
  };
});

// ----------------------------------------------------------------- export --
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../assets/models/human-character.glb');
const glb = await new GLTFExporter().parseAsync(root, { binary: true, animations: [idle, walk, wave, happy] });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, Buffer.from(glb));
console.log(`Wrote ${out} (${(glb.byteLength / 1024).toFixed(1)} KB)`);
