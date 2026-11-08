import * as THREE from 'three';
import { EXPRESSION_CHANNELS, EXPRESSION_EASE, EXPRESSIONS, type Expression, type ExpressionChannel } from './registry';

interface Binding {
  mesh: THREE.Mesh;
  index: number;
  channel: ExpressionChannel;
}

const CHANNELS = Object.keys(EXPRESSION_CHANNELS) as ExpressionChannel[];

/**
 * Blends facial expressions through morph targets, plus natural blinking.
 * Works with AquaMate's own faces and common blendshape naming schemes.
 */
export class ExpressionController {
  readonly channels: ExpressionChannel[] = [];
  private readonly bindings: Binding[] = [];
  private readonly value: Record<ExpressionChannel, number> = { happy: 0, sad: 0, blink: 0 };
  private target: Partial<Record<ExpressionChannel, number>> = {};
  private name: Expression = 'neutral';
  private rate = 12;
  private blinkIn = 2 + Math.random() * 3;
  private blinkT = -1;

  constructor(root: THREE.Object3D) {
    const meshes: THREE.Mesh[] = [];
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && m.morphTargetDictionary && m.morphTargetInfluences) meshes.push(m);
    });
    const lookup = (mesh: THREE.Mesh, name: string) => {
      const dict = mesh.morphTargetDictionary!;
      const key = Object.keys(dict).find((k) => k.toLowerCase() === name.toLowerCase());
      return key === undefined ? undefined : dict[key];
    };
    for (const channel of CHANNELS) {
      for (const group of EXPRESSION_CHANNELS[channel]) {
        const hits = meshes.flatMap((mesh) => group.map((n) => ({ mesh, index: lookup(mesh, n) })));
        const complete = group.every((n) => meshes.some((m) => lookup(m, n) !== undefined));
        if (!complete) continue;
        for (const h of hits) if (h.index !== undefined) this.bindings.push({ mesh: h.mesh, index: h.index, channel });
        this.channels.push(channel);
        break;
      }
    }
  }

  get supported(): boolean {
    return this.channels.length > 0;
  }

  get expression(): Expression {
    return this.name;
  }

  set(expression: Expression): void {
    // Slow expressions also fade out slowly (eyes open gently after relaxing).
    this.rate = EXPRESSION_EASE[expression] ?? EXPRESSION_EASE[this.name] ?? 12;
    this.name = expression;
    this.target = EXPRESSIONS[expression];
  }

  /** Jump straight to the target (for thumbnails). */
  snap(): void {
    for (const c of CHANNELS) this.value[c] = this.target[c] ?? 0;
    this.apply(0);
  }

  update(dt: number): void {
    const k = 1 - Math.exp(-this.rate * dt);
    for (const c of CHANNELS) this.value[c] += ((this.target[c] ?? 0) - this.value[c]) * k;

    // Natural blinking on top, unless the eyes are already (mostly) closed.
    let blink = 0;
    this.blinkIn -= dt;
    if (this.blinkT < 0 && this.blinkIn <= 0) this.blinkT = 0;
    if (this.blinkT >= 0) {
      this.blinkT += dt;
      blink = Math.sin(Math.PI * Math.min(1, this.blinkT / 0.16));
      if (this.blinkT >= 0.16) {
        this.blinkT = -1;
        this.blinkIn = 2.5 + Math.random() * 3.5;
      }
    }
    this.apply(blink);
  }

  private apply(blink: number): void {
    for (const b of this.bindings) {
      const v = b.channel === 'blink' ? Math.max(this.value.blink, blink) : this.value[b.channel];
      b.mesh.morphTargetInfluences![b.index] = THREE.MathUtils.clamp(v, 0, 1);
    }
  }
}
