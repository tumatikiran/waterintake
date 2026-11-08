import * as THREE from 'three';
import { WaterBottle } from './WaterBottle';
import type { PropName, SignLabel } from '../../shared/reminders';
import type { HandPose } from '../AnimationController';

/**
 * Things the companion can hold. A reminder decides what (if anything) is in
 * the hand: a water bottle, a pill bottle, a dumbbell, or a sign with a label.
 * The companion's own clips are prop-free; holding a prop switches the right
 * arm to a hand pose (see AnimationController): carried at the hip, or, for a
 * sign, held up beside the head.
 *
 * To add a prop: build it here with its origin at the grip point, +Y up
 * (the same convention as the bottle in bottleSpec.ts).
 */
export type PropId = PropName;

export interface Prop {
  readonly id: PropId;
  readonly object: THREE.Object3D;
  dispose(): void;
}

export interface WaterBottleProp extends Prop {
  readonly id: 'waterBottle';
  readonly bottle: WaterBottle;
}

export interface SimpleProp extends Omit<Prop, 'id'> {
  /** 'tablet' is never held on its own: it appears in the left hand while taking medicine. */
  readonly id: Exclude<PropId, 'waterBottle'> | 'tablet';
}

export type AnyProp = WaterBottleProp | (SimpleProp & { id: Exclude<PropId, 'waterBottle'> });

/** Builds a small prop from simple shapes; everything it creates is disposed with it. */
function build(id: SimpleProp['id'], parts: Array<[THREE.BufferGeometry, string, Partial<THREE.MeshStandardMaterialParameters>?, [number, number, number]?]>): SimpleProp {
  const object = new THREE.Group();
  object.name = id;
  const owned: Array<{ dispose(): void }> = [];
  for (const [geo, color, extra, pos] of parts) {
    const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45, ...extra });
    const mesh = new THREE.Mesh(geo, mat);
    if (pos) mesh.position.set(...pos);
    mesh.frustumCulled = false;
    object.add(mesh);
    owned.push(geo, mat);
  }
  return { id, object, dispose: () => (object.removeFromParent(), owned.forEach((o) => o.dispose())) };
}

/** An amber pill bottle with a white cap and label (origin: where the hand grips it). */
function pillBottle(): SimpleProp {
  const r = 0.043;
  return build('pillBottle', [
    [new THREE.CylinderGeometry(r, r, 0.13, 24), '#c8741c', { transparent: true, opacity: 0.9, roughness: 0.25 }, [0, -0.005, 0]],
    [new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.065, 24, 1, true), '#ffffff', { roughness: 0.6, side: THREE.DoubleSide }, [0, -0.012, 0]],
    [new THREE.CylinderGeometry(r * 1.12, r * 1.12, 0.036, 24), '#f4f6f8', {}, [0, 0.076, 0]],
  ]);
}

/** A two-tone capsule, oversized like the bottle so it reads at companion size. */
export function tablet(): SimpleProp {
  const geo = new THREE.CapsuleGeometry(0.014, 0.024, 4, 10);
  geo.rotateZ(Math.PI / 2);
  const half = new THREE.CylinderGeometry(0.0145, 0.0145, 0.016, 12, 1, true);
  half.rotateZ(Math.PI / 2);
  return build('tablet', [
    [geo, '#ffffff', { roughness: 0.35 }],
    [half, '#ef6f6c', { roughness: 0.35, side: THREE.DoubleSide }, [0.012, 0, 0]],
  ]);
}

/** A small dumbbell, held by the bar (upright in the carrying hand). */
function dumbbell(): SimpleProp {
  const plate = () => new THREE.CylinderGeometry(0.075, 0.075, 0.05, 20);
  return build('dumbbell', [
    [new THREE.CylinderGeometry(0.02, 0.02, 0.26, 12), '#b9c3d0', { metalness: 0.4, roughness: 0.35 }],
    [plate(), '#e05a4f', { roughness: 0.5 }, [0, 0.105, 0]],
    [plate(), '#e05a4f', { roughness: 0.5 }, [0, -0.105, 0]],
  ]);
}

/** Draws a sign's face: an emoji and a short text, wrapped onto two lines at most. */
function signTexture(label: SignLabel): THREE.CanvasTexture | null {
  if (typeof document === 'undefined') return null; // no canvas (generating models in Node)
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 340;
  const g = canvas.getContext('2d');
  if (!g) return null;
  g.fillStyle = '#ffffff';
  g.beginPath();
  g.roundRect(8, 8, 496, 324, 36);
  g.fill();
  g.lineWidth = 12;
  g.strokeStyle = '#2f80ed';
  g.stroke();
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = '118px system-ui, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
  g.fillText(label.emoji, 256, 104);
  g.fillStyle = '#13233a';
  g.font = '700 66px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
  const words = label.text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  for (const w of words) {
    const last = lines[lines.length - 1];
    if (last !== undefined && g.measureText(`${last} ${w}`).width <= 440) lines[lines.length - 1] = `${last} ${w}`;
    else lines.push(w);
  }
  if (lines.length > 2) lines.splice(2, lines.length, `${lines[1]}…`);
  lines.forEach((line, i) => {
    let l = line;
    while (g.measureText(l).width > 450 && l.length > 1) l = `${l.slice(0, -2)}…`;
    g.fillText(l, 256, (lines.length === 1 ? 252 : 216) + i * 70);
  });
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Where the sign's board sits relative to the hand: up, and out to the side so it doesn't cover the face. */
const BOARD = { w: 0.72, h: 0.48, x: -0.3, y: 0.36 };

/** A sign on a stick, its face towards whoever the character faces; held up beside the head. */
function sign(label: SignLabel = { emoji: '⭐', text: '' }): SimpleProp {
  const prop = build('sign', [
    [new THREE.CylinderGeometry(0.014, 0.014, 0.3, 10), '#b48a5a', { roughness: 0.7 }, [0, 0.1, 0]],
    // A crossbar from the stick to the board's middle, behind it.
    [new THREE.BoxGeometry(Math.abs(BOARD.x) + 0.03, 0.03, 0.03), '#b48a5a', { roughness: 0.7 }, [BOARD.x / 2, BOARD.y - BOARD.h / 2 + 0.03, -0.02]],
    [new THREE.BoxGeometry(BOARD.w, BOARD.h, 0.014), '#e8edf3', { roughness: 0.6 }, [BOARD.x, BOARD.y, -0.006]],
  ]);
  const tex = signTexture(label);
  if (tex) {
    const faceGeo = new THREE.PlaneGeometry(BOARD.w - 0.01, BOARD.h - 0.01);
    // Unlit, like paper in daylight: the label reads clearly whatever the light.
    const faceMat = new THREE.MeshBasicMaterial({ map: tex });
    const face = new THREE.Mesh(faceGeo, faceMat);
    face.position.set(BOARD.x, BOARD.y, 0.002);
    face.frustumCulled = false;
    prop.object.add(face);
    const dispose = prop.dispose;
    return { ...prop, dispose: () => (dispose(), faceGeo.dispose(), faceMat.dispose(), tex.dispose()) };
  }
  return prop;
}

type NotBottle = SimpleProp & { id: Exclude<PropId, 'waterBottle'> };
export const PROPS: Record<PropId, (label?: SignLabel) => AnyProp> = {
  waterBottle: () => {
    const bottle = new WaterBottle();
    return { id: 'waterBottle', object: bottle.object, bottle, dispose: () => bottle.dispose() };
  },
  pillBottle: pillBottle as () => NotBottle,
  dumbbell: dumbbell as () => NotBottle,
  sign: sign as (label?: SignLabel) => NotBottle,
};

/** How each prop is held. */
export const PROP_POSE: Record<PropId, HandPose> = { waterBottle: 'carry', pillBottle: 'carry', dumbbell: 'carry', sign: 'present' };

/** How long a prop takes to appear or be put away (seconds). */
const SHOW_SECONDS = 0.28;

/**
 * The right hand's grip: shows one prop at a time, scaling it in and out so
 * nothing pops. `grip` is placed on the hand bone (exact for AquaMate's own
 * rigs, a best guess for uploaded ones).
 */
export class HandProps {
  private current: AnyProp | null = null;
  private leaving: Array<{ prop: AnyProp; t: number }> = [];
  private t = 1; // appear progress of `current`

  constructor(
    private readonly grip: THREE.Object3D | null,
    private readonly onHolding: (pose: HandPose | null, instant: boolean) => void,
  ) {}

  /** False when the model has no hand bone to hold things with. */
  get supported(): boolean {
    return this.grip !== null;
  }

  get held(): PropId | null {
    return this.current?.id ?? null;
  }

  get prop(): AnyProp | null {
    return this.current;
  }

  /** What the sign in hand says, if any. */
  get label(): SignLabel | null {
    return this.held === 'sign' ? this.signLabel : null;
  }
  private signLabel: SignLabel | null = null;

  /**
   * Puts a prop in the hand (null: empty hand); a sign shows `label`. Showing
   * what's already held (the same sign) keeps it as it is.
   */
  show(id: PropId | null, instant = false, label?: SignLabel): void {
    const same = id === this.held && (id !== 'sign' || JSON.stringify(label ?? null) === JSON.stringify(this.signLabel));
    if (!this.grip || same) {
      if (instant) this.finish();
      return;
    }
    if (this.current) this.leaving.push({ prop: this.current, t: instant ? 0 : this.t });
    this.current = id ? PROPS[id](label) : null;
    this.signLabel = id === 'sign' ? (label ?? null) : null;
    if (this.current) {
      this.t = instant ? 1 : 0;
      this.grip.add(this.current.object);
    }
    this.onHolding(this.current ? PROP_POSE[this.current.id] : null, instant);
    if (instant) this.finish();
    this.apply();
  }

  update(dt: number): void {
    const step = dt / SHOW_SECONDS;
    this.t = Math.min(1, this.t + step);
    for (const l of this.leaving) l.t -= step;
    this.finish();
    this.apply();
  }

  dispose(): void {
    this.current?.dispose();
    this.current = null;
    for (const l of this.leaving) l.prop.dispose();
    this.leaving = [];
  }

  private finish(): void {
    for (const l of this.leaving.filter((x) => x.t <= 0)) l.prop.dispose();
    this.leaving = this.leaving.filter((x) => x.t > 0);
  }

  private apply(): void {
    const ease = (x: number) => THREE.MathUtils.smoothstep(x, 0, 1);
    if (this.current) this.current.object.scale.setScalar(Math.max(1e-4, ease(this.t)));
    for (const l of this.leaving) l.prop.object.scale.setScalar(Math.max(1e-4, ease(l.t)));
  }
}
