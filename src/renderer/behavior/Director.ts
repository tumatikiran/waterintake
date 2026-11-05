import type { AnimationRole, Expression } from '../character/registry';
import { INTERACTIONS, type InteractionName, type Mark, type Step } from './interactions';
import type { MessageKey } from './messages';

/** What a character on stage can do. Implemented by Mascot.tsx, frame-synced with rendering. */
export interface Actor {
  readonly key: string; // which character this actor is
  stage(): void;
  walk(to: Mark, style: 'normal' | 'sad'): Promise<void>;
  face(to: 'user' | 'left' | 'right' | 'drink'): void;
  play(animation: AnimationRole): Promise<void>;
  loop(animation: AnimationRole): void;
  expression(name: Expression): void;
  wait(seconds: number): Promise<void>;
}

export interface Stage {
  say(message: MessageKey | null, actions: boolean): void;
  onStep?(name: InteractionName, step: Step): void;
}

/** Runs interaction scripts. Starting a new one interrupts the current one. */
export class Director {
  private token = 0;

  constructor(
    private readonly actor: Actor,
    private readonly stage: Stage,
  ) {}

  /** Resolves true when the script ran to the end, false when it was interrupted. */
  async run(name: InteractionName): Promise<boolean> {
    const token = ++this.token;
    for (const step of INTERACTIONS[name]) {
      if (token !== this.token) return false;
      this.stage.onStep?.(name, step);
      await this.exec(step);
    }
    return token === this.token;
  }

  cancel(): void {
    this.token++;
  }

  private exec(step: Step): Promise<void> | void {
    const a = this.actor;
    switch (step.do) {
      case 'stage':
        return a.stage();
      case 'walk':
        return a.walk(step.to, step.style ?? 'normal');
      case 'face':
        return a.face(step.to);
      case 'play':
        return a.play(step.animation);
      case 'loop':
        return a.loop(step.animation);
      case 'expression':
        return a.expression(step.name);
      case 'say':
        return this.stage.say(step.message, step.actions ?? false);
      case 'wait':
        return a.wait(step.seconds);
    }
  }
}
