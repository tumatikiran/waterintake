import * as THREE from 'three';
import { WaterBottle } from './WaterBottle';
import type { PropName } from '../../shared/reminders';

/**
 * Things the companion can hold. A reminder decides what (if anything) is in
 * the hand: a water bottle for water, later a pill bottle for medicine. The
 * companion's own clips are prop-free; holding a prop switches the right arm
 * to a carrying pose (see AnimationController).
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

export const PROPS: Record<PropId, () => AnyProp> = {
  waterBottle: () => {
    const bottle = new WaterBottle();
    return { id: 'waterBottle', object: bottle.object, bottle, dispose: () => bottle.dispose() };
  },
  pillBottle: pillBottle as () => SimpleProp & { id: 'pillBottle' },
};

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
    private readonly onHolding: (holding: boolean, instant: boolean) => void,
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

  /** Puts a prop in the hand (null: empty hand). Showing the one already held keeps it as it is. */
  show(id: PropId | null, instant = false): void {
    if (!this.grip || id === this.held) {
      if (instant) this.finish();
      return;
    }
    if (this.current) this.leaving.push({ prop: this.current, t: instant ? 0 : this.t });
    this.current = id ? PROPS[id]() : null;
    if (this.current) {
      this.t = instant ? 1 : 0;
      this.grip.add(this.current.object);
    }
    this.onHolding(this.current !== null, instant);
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
