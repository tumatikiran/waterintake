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

export type AnyProp = WaterBottleProp;

export const PROPS: Record<PropId, () => AnyProp> = {
  waterBottle: () => {
    const bottle = new WaterBottle();
    return { id: 'waterBottle', object: bottle.object, bottle, dispose: () => bottle.dispose() };
  },
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
