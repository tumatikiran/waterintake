import * as THREE from 'three';
import { ANIMATION_ROLES, ROLE_ORDER, type AnimationRole } from './character/registry';

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
  private readonly actions = new Map<AnimationRole, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentRole: AnimationRole | null = null;
  private pending: (() => void) | null = null;
  private disposed = false;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    const claimed = new Set<THREE.AnimationClip>();
    const assign = (role: AnimationRole, clip: THREE.AnimationClip | undefined) => {
      if (!clip || this.actions.has(role)) return;
      claimed.add(clip);
      this.actions.set(role, this.mixer.clipAction(clip));
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
      this.actions.set('Idle', this.mixer.clipAction(clips[0])); // something is better than a T-pose
    }
    for (const role of ROLE_ORDER) {
      if (this.actions.has(role)) continue;
      const via = ANIMATION_ROLES[role].fallback.find((r) => this.actions.has(r));
      if (via) this.fallbacks[role] = via;
    }
    const missing = ROLE_ORDER.filter((r) => !this.found.includes(r));
    if (missing.length) console.info(`[AquaMate] Using fallbacks for: ${missing.join(', ')}`);
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.current) this.settle();
    });
  }

  get playing(): AnimationRole | null {
    return this.currentRole;
  }

  /** Normalized time of the current one-shot (0–1), e.g. how far a Drink has got. */
  progress(): number {
    const a = this.current;
    if (!a || a.loop !== THREE.LoopOnce) return 0;
    return THREE.MathUtils.clamp(a.time / a.getClip().duration, 0, 1);
  }

  /** Loops a role (resolves immediately). Calling it again for the same role keeps it going smoothly. */
  loop(role: AnimationRole, { fade = 0.25, timeScale = 1 }: PlayOptions = {}): void {
    const action = this.resolve(role);
    if (!action || this.disposed) return;
    if (action === this.current && action.loop === THREE.LoopRepeat && action.repetitions === Infinity) {
      action.timeScale = timeScale;
      this.currentRole = role;
      return;
    }
    this.start(role, action, THREE.LoopRepeat, Infinity, fade, timeScale);
  }

  /** Plays a role once; resolves when it finishes or is interrupted. */
  once(role: AnimationRole, { fade = 0.25, timeScale = 1 }: PlayOptions = {}): Promise<void> {
    const action = this.resolve(role);
    if (!action || this.disposed) return Promise.resolve();
    const spec = ANIMATION_ROLES[role];
    // A looping fallback (e.g. Happy for a missing Drink) repeats for about as long as the real clip would take.
    const viaLoop = this.fallbacks[role] && ANIMATION_ROLES[this.fallbacks[role]!].loop;
    const reps = viaLoop ? Math.max(1, Math.round((spec.seconds ?? 2) / action.getClip().duration)) : 1;
    this.start(role, action, reps === 1 ? THREE.LoopOnce : THREE.LoopRepeat, reps, fade, timeScale);
    return new Promise((resolve) => {
      this.pending = resolve;
    });
  }

  update(dt: number): void {
    if (!this.disposed) this.mixer.update(dt);
  }

  /** Safe to call more than once; afterwards every method is a no-op (late callbacks can't crash the mixer). */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.settle();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }

  private resolve(role: AnimationRole): THREE.AnimationAction | undefined {
    return this.actions.get(role) ?? (this.fallbacks[role] ? this.actions.get(this.fallbacks[role]!) : undefined) ?? this.actions.get('Idle');
  }

  private start(role: AnimationRole, action: THREE.AnimationAction, loop: THREE.AnimationActionLoopStyles, reps: number, fade: number, timeScale: number) {
    this.settle(); // an interrupted one-shot counts as finished
    const previous = this.current;
    action.reset();
    action.timeScale = timeScale;
    action.setLoop(loop, reps);
    action.clampWhenFinished = loop === THREE.LoopOnce || reps !== Infinity;
    action.setEffectiveWeight(1);
    if (previous && previous !== action && fade > 0) action.crossFadeFrom(previous, fade, false);
    else if (previous && previous !== action) previous.stop();
    action.play();
    this.current = action;
    this.currentRole = role;
  }

  private settle(): void {
    const resolve = this.pending;
    this.pending = null;
    resolve?.();
  }
}
