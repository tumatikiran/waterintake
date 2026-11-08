import type { AnimationRole, Expression } from '../character/registry';
import type { PropId } from '../character/props';
import { INTERACTIONS, type Facing, type Gait, type InteractionName, type Leave, type Mark, type Step } from './interactions';
import type { MessageKey } from './messages';

/** What a character on stage can do. Implemented by Mascot.tsx, frame-synced with rendering. */
export interface Actor {
  readonly key: string; // which character this actor is
  stage(at?: Mark): void;
  prop(id: PropId | null): void;
  walk(to: Mark, style: 'normal' | 'sad', gait: Gait): Promise<void>;
  face(to: Facing): void;
  play(animation: AnimationRole): Promise<void>;
  loop(animation: AnimationRole, fade?: number): void;
  expression(name: Expression): void;
  wait(seconds: number): Promise<void>;
}

export interface Stage {
  say(message: MessageKey | null, actions: boolean): void;
  onStep?(name: InteractionName, step: Step): void;
}

/** Walk back out to the right, where he came from. */
export const DEFAULT_LEAVE: Leave = { to: 'exitRight', gait: 'walk' };

/** What a script is played for: how the character leaves, and the reminder's item ('reminder' props). */
export interface Scene {
  leave?: Leave;
  prop?: PropId | null;
}

/** Runs interaction scripts. Starting a new one interrupts the current one. */
export class Director {
  private token = 0;

  constructor(
    private readonly actor: Actor,
    private readonly stage: Stage,
  ) {}

  /** Resolves true when the script ran to the end, false when it was interrupted. */
  async run(name: InteractionName, scene: Scene = {}): Promise<boolean> {
    const token = ++this.token;
    for (const step of INTERACTIONS[name]) {
      if (token !== this.token) return false;
      this.stage.onStep?.(name, step);
      await this.exec(step, scene);
    }
    return token === this.token;
  }

  cancel(): void {
    this.token++;
  }

  private exec(step: Step, { leave = DEFAULT_LEAVE, prop = null }: Scene): Promise<void> | void {
    const a = this.actor;
    switch (step.do) {
      case 'stage':
        return a.stage(step.at);
      case 'walk':
        return step.to === 'exit' ? a.walk(leave.to, step.style ?? 'normal', leave.gait) : a.walk(step.to, step.style ?? 'normal', 'walk');
      case 'prop':
        return a.prop(step.id === 'reminder' ? prop : step.id);
      case 'face':
        return a.face(step.to);
      case 'play':
        return a.play(step.animation);
      case 'loop':
        return a.loop(step.animation, step.fade);
      case 'expression':
        return a.expression(step.name);
      case 'say':
        return this.stage.say(step.message, step.actions ?? false);
      case 'wait':
        return a.wait(step.seconds);
    }
  }
}
