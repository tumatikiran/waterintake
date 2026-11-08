import * as THREE from 'three';
import { ANIMATION_ROLES, ARMS_OWN, ROLE_ORDER, type AnimationRole } from './character/registry';

export type { AnimationRole } from './character/registry';

const normalise = (name: string) =>
  name
    .toLowerCase()
    .split('|')
    .pop()!
    .replace(/^mixamo\.com$/, '')
    .replace(/[\s_.-]/g, '');

export interface PlayOptions {
  /** Cross-fade duration in seconds. */
  fade?: number;
  timeScale?: number;
}

/**
 * Optional right-arm layer. When the character holds a prop, the hand pose
 * (e.g. carrying something upright) drives these bones instead of the body
 * clip, so walking, idling or sitting don't need a separate "with bottle"
 * version. Roles in ARMS_OWN (drinking, cheering) keep their own arm.
 */
export interface ArmLayer {
  /** Bone (node) names of the right arm, shoulder to hand. */
  bones: readonly string[];
  /** The pose played on those bones while holding something (arm tracks only). */
  carry: THREE.AnimationClip;
}

/** A role's clip, split into the body and the right arm when there is an arm layer. */
interface Pair {
  body: THREE.AnimationAction;
  arm: THREE.AnimationAction | null;
}

/** How quickly the arm moves between its own motion and the hand pose (1/s). */
const ARM_BLEND_RATE = 10;

/**
 * Plays animation *roles* (Idle, Walk, Drink…) rather than clip names, mapping
 * them onto whatever clips a model has. Missing roles fall back (see
 * registry.ts), so any rigged model can be a companion.
 */
export class AnimationController {
  readonly mixer: THREE.AnimationMixer;
  /** Roles the model has its own clip for. */
  readonly found: AnimationRole[] = [];
  /** Roles that use a fallback, and which role they use. */
  readonly fallbacks: Partial<Record<AnimationRole, AnimationRole>> = {};
  private readonly actions = new Map<AnimationRole, Pair>();
  private current: Pair | null = null;
  private currentRole: AnimationRole | null = null;
  private pending: (() => void) | null = null;
  private disposed = false;
  private readonly carry: THREE.AnimationAction | null = null;
  private holding = false;
  private armBlend = 0; // 0 = the clip's own arm, 1 = the hand pose

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[], arm?: ArmLayer) {
    this.mixer = new THREE.AnimationMixer(root);
    const armBones = new Set((arm?.bones ?? []).map((b) => THREE.PropertyBinding.sanitizeNodeName(b)));
    const isArm = (t: THREE.KeyframeTrack) => armBones.has(THREE.PropertyBinding.parseTrackName(t.name).nodeName);
    const pairFor = (clip: THREE.AnimationClip): Pair => {
      if (!arm) return { body: this.mixer.clipAction(clip), arm: null };
      const body = new THREE.AnimationClip(clip.name, clip.duration, clip.tracks.filter((t) => !isArm(t)));
      const armOnly = new THREE.AnimationClip(`${clip.name}:arm`, clip.duration, clip.tracks.filter(isArm));
      return { body: this.mixer.clipAction(body), arm: this.mixer.clipAction(armOnly) };
    };

    const claimed = new Set<THREE.AnimationClip>();
    const assign = (role: AnimationRole, clip: THREE.AnimationClip | undefined) => {
      if (!clip || this.actions.has(role)) return;
      claimed.add(clip);
      this.actions.set(role, pairFor(clip));
      this.found.push(role);
    };
    // Exact names first, so "Walk" never grabs "SadWalk"; then partial matches.
    for (const role of ROLE_ORDER) {
      assign(role, clips.find((c) => !claimed.has(c) && ANIMATION_ROLES[role].aliases.includes(normalise(c.name))));
    }
    for (const role of [...ROLE_ORDER].reverse()) {
      assign(role, clips.find((c) => !claimed.has(c) && ANIMATION_ROLES[role].aliases.some((a) => normalise(c.name).includes(a))));
    }
    if (!this.actions.has('Idle') && clips[0]) {
      this.actions.set('Idle', pairFor(clips[0])); // something is better than a T-pose
    }
    for (const role of ROLE_ORDER) {
      if (this.actions.has(role)) continue;
      const via = ANIMATION_ROLES[role].fallback.find((r) => this.actions.has(r));
      if (via) this.fallbacks[role] = via;
    }
    const missing = ROLE_ORDER.filter((r) => !this.found.includes(r));
    if (missing.length) console.info(`[AquaMate] Using fallbacks for: ${missing.join(', ')}`);

    if (arm) {
      // Always playing; its weight is the arm blend.
      const carry = this.mixer.clipAction(new THREE.AnimationClip(arm.carry.name, arm.carry.duration, arm.carry.tracks.filter(isArm)));
      carry.setLoop(THREE.LoopRepeat, Infinity);
      carry.play();
      carry.weight = 0;
      this.carry = carry;
    }

    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.current?.body) this.settle();
    });
  }

  get playing(): AnimationRole | null {
    return this.currentRole;
  }

  /** Whether the hand pose is in use (the character holds a prop). */
  get carrying(): boolean {
    return this.holding;
  }

  /** Normalized time of the current one-shot (0–1), e.g. how far a Drink has got. */
  progress(): number {
    const a = this.current?.body;
    if (!a || a.loop !== THREE.LoopOnce) return 0;
    return THREE.MathUtils.clamp(a.time / a.getClip().duration, 0, 1);
  }

  /** The right hand holds something (true) or is free (false). Blends smoothly; `instant` jumps. */
  setHolding(holding: boolean, instant = false): void {
    this.holding = holding;
    if (instant) this.armBlend = this.armTarget();
  }

  /** Loops a role (resolves immediately). Calling it again for the same role keeps it going smoothly. */
  loop(role: AnimationRole, { fade = 0.25, timeScale = 1 }: PlayOptions = {}): void {
    const pair = this.resolve(role);
    if (!pair || this.disposed) return;
    if (pair === this.current && pair.body.loop === THREE.LoopRepeat && pair.body.repetitions === Infinity) {
      for (const a of this.each(pair)) a.timeScale = timeScale;
      this.currentRole = role;
      return;
    }
    this.start(role, pair, THREE.LoopRepeat, Infinity, fade, timeScale);
  }

  /** Plays a role once; resolves when it finishes or is interrupted. */
  once(role: AnimationRole, { fade = 0.25, timeScale = 1 }: PlayOptions = {}): Promise<void> {
    const pair = this.resolve(role);
    if (!pair || this.disposed) return Promise.resolve();
    const spec = ANIMATION_ROLES[role];
    // A looping fallback (e.g. Happy for a missing Drink) repeats for about as long as the real clip would take.
    const viaLoop = this.fallbacks[role] && ANIMATION_ROLES[this.fallbacks[role]!].loop;
    const reps = viaLoop ? Math.max(1, Math.round((spec.seconds ?? 2) / pair.body.getClip().duration)) : 1;
    this.start(role, pair, reps === 1 ? THREE.LoopOnce : THREE.LoopRepeat, reps, fade, timeScale);
    return new Promise((resolve) => {
      this.pending = resolve;
    });
  }

  update(dt: number): void {
    if (this.disposed) return;
    if (this.carry) {
      this.armBlend += (this.armTarget() - this.armBlend) * (1 - Math.exp(-ARM_BLEND_RATE * dt));
      // Base weights only: cross-fades scale them on top, so the arm's total stays 1.
      this.carry.weight = this.armBlend;
      for (const pair of this.actions.values()) if (pair.arm) pair.arm.weight = 1 - this.armBlend;
    }
    this.mixer.update(dt);
  }

  /** Safe to call more than once; afterwards every method is a no-op (late callbacks can't crash the mixer). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.settle();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }

  private armTarget(): number {
    const role = this.currentRole;
    const own = role !== null && (ARMS_OWN.includes(role) || ARMS_OWN.includes(this.fallbacks[role] ?? role));
    return this.holding && !own ? 1 : 0;
  }

  private *each(pair: Pair): Generator<THREE.AnimationAction> {
    yield pair.body;
    if (pair.arm) yield pair.arm;
  }

  private resolve(role: AnimationRole): Pair | undefined {
    return this.actions.get(role) ?? (this.fallbacks[role] ? this.actions.get(this.fallbacks[role]!) : undefined) ?? this.actions.get('Idle');
  }

  private start(role: AnimationRole, pair: Pair, loop: THREE.AnimationActionLoopStyles, reps: number, fade: number, timeScale: number) {
    this.settle(); // an interrupted one-shot counts as finished
    const previous = this.current;
    const parts: Array<[THREE.AnimationAction, THREE.AnimationAction | null | undefined]> = [[pair.body, previous?.body]];
    if (pair.arm) parts.push([pair.arm, previous?.arm]);
    for (const [action, prev] of parts) {
      const weight = action === pair.arm ? 1 - this.armBlend : 1;
      action.reset();
      action.timeScale = timeScale;
      action.setLoop(loop, reps);
      action.clampWhenFinished = loop === THREE.LoopOnce || reps !== Infinity;
      action.setEffectiveWeight(weight);
      if (prev && prev !== action && fade > 0) action.crossFadeFrom(prev, fade, false);
      else if (prev && prev !== action) prev.stop();
      action.play();
    }
    this.current = pair;
    this.currentRole = role;
  }

  private settle(): void {
    const resolve = this.pending;
    this.pending = null;
    resolve?.();
  }
}
