import * as THREE from 'three';

export type MascotAnimation = 'Idle' | 'Walk' | 'Wave' | 'Happy';

/**
 * Clip-name aliases so a replacement GLB (Mixamo, Quaternius, ReadyPlayerMe, ...)
 * works without code changes. Matching is case-insensitive and ignores
 * prefixes such as "Armature|" or "mixamo.com|".
 */
const ALIASES: Record<MascotAnimation, string[]> = {
  Idle: ['idle', 'breathing', 'stand', 'standing'],
  Walk: ['walk', 'walking', 'walkcycle', 'walk_cycle'],
  Wave: ['wave', 'waving', 'hello', 'greeting', 'greet'],
  Happy: ['happy', 'cheer', 'cheering', 'celebrate', 'victory', 'jump', 'thumbsup', 'thumbs_up', 'yes', 'dance'],
};

function normalise(name: string): string {
  return name.toLowerCase().split('|').pop()!.replace(/[\s-]/g, '');
}

function findClip(clips: THREE.AnimationClip[], anim: MascotAnimation): THREE.AnimationClip | undefined {
  const aliases = ALIASES[anim].map((a) => a.replace(/[\s-]/g, ''));
  return (
    clips.find((c) => aliases.includes(normalise(c.name))) ??
    clips.find((c) => aliases.some((a) => normalise(c.name).includes(a)))
  );
}

export interface PlayOptions {
  /** Cross-fade duration in seconds. */
  fade?: number;
  /** Play once and resolve when finished (otherwise loop and resolve immediately). */
  once?: boolean;
  timeScale?: number;
}

/** Thin, promise-friendly wrapper around THREE.AnimationMixer. */
export class AnimationController {
  readonly mixer: THREE.AnimationMixer;
  readonly missing: MascotAnimation[] = [];
  private readonly actions = new Map<MascotAnimation, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private currentName: MascotAnimation | null = null;
  private pending: (() => void) | null = null;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const anim of ['Idle', 'Walk', 'Wave', 'Happy'] as MascotAnimation[]) {
      const clip = findClip(clips, anim);
      if (clip) this.actions.set(anim, this.mixer.clipAction(clip));
      else this.missing.push(anim);
    }
    if (this.missing.length) {
      console.warn(`[AquaMate] Model is missing animation clips: ${this.missing.join(', ')} (falling back to Idle).`);
    }
    this.mixer.addEventListener('finished', (e) => {
      if (e.action === this.current) this.settle();
    });
  }

  get playing(): MascotAnimation | null {
    return this.currentName;
  }

  play(name: MascotAnimation, { fade = 0.25, once = false, timeScale = 1 }: PlayOptions = {}): Promise<void> {
    const action = this.actions.get(name) ?? this.actions.get('Idle');
    if (!action) return Promise.resolve();

    // Already looping this clip: just keep going (no restart = no visible pop).
    if (!once && action === this.current && action.loop === THREE.LoopRepeat) {
      action.timeScale = timeScale;
      this.currentName = name;
      return Promise.resolve();
    }

    this.settle(); // an interrupted one-shot counts as finished
    action.reset();
    action.timeScale = timeScale;
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    action.clampWhenFinished = once;
    action.setEffectiveWeight(1);
    if (this.current && this.current !== action && fade > 0) {
      action.crossFadeFrom(this.current, fade, false);
    } else if (this.current && this.current !== action) {
      this.current.stop();
    }
    action.play();
    this.current = action;
    this.currentName = name;

    if (!once) return Promise.resolve();
    return new Promise((resolve) => {
      this.pending = resolve;
    });
  }

  update(dt: number): void {
    this.mixer.update(dt);
  }

  dispose(): void {
    this.settle();
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.mixer.getRoot());
  }

  private settle(): void {
    const resolve = this.pending;
    this.pending = null;
    resolve?.();
  }
}
