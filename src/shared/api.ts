/**
 * The window.aquamate API the UI talks to. Desktop implements it in the
 * Electron preload (IPC to the main process); Android implements it in
 * src/renderer/mobile/bridge.ts (Capacitor storage and notifications).
 * The React UI is the same on both.
 */
import type {
  AppState,
  CharacterInfo,
  DeepPartial,
  HitRegion,
  ImportResult,
  ReminderContext,
  ReminderResponse,
  ResponseResult,
  SaveCreatedInput,
  Settings,
} from './types';

export type Unsubscribe = () => void;
export type NotificationPermission = 'granted' | 'denied' | 'prompt';

export interface AquaMateApi {
  // ----------------------------------------------------------- settings UI
  getState(): Promise<AppState>;
  onState(cb: (state: AppState) => void): Unsubscribe;
  updateSettings(patch: DeepPartial<Settings>): Promise<Settings>;
  testReminder(): void;
  logGlass(): Promise<number>;
  pause(minutes: number | 'tomorrow'): void;
  resume(): void;
  /** Turns Relax mode on or off. A reminder also ends it (the companion gets up to remind you). */
  setRelax(on: boolean): void;
  characters: {
    import(): Promise<ImportResult>;
    saveCreated(input: SaveCreatedInput): Promise<CharacterInfo>;
    update(id: string, patch: { name?: string; thumbnail?: string; animations?: string[] }): Promise<CharacterInfo | null>;
    remove(id: string): Promise<boolean>;
    select(id: string): Promise<Settings>;
    load(id: string): Promise<Uint8Array | null>;
  };

  // --------------------------------------------------------- reminder scene
  onReminderStart(cb: (ctx: ReminderContext) => void): Unsubscribe;
  /** Desktop overlay: Relax mode starts (with who relaxes and how they'll leave) or ends (null). */
  onRelax(cb: (ctx: ReminderContext | null) => void): Unsubscribe;
  /** The scene is staged; the desktop shows its overlay window now. */
  mascotReady(): void;
  /** Desktop click-through: where the card is (window-relative CSS px), or null. */
  setHitRegion(region: HitRegion | null): void;
  onPointer(cb: (overCard: boolean) => void): Unsubscribe;
  respond(kind: ReminderResponse): Promise<ResponseResult>;
  /** The character has left; the desktop hides its overlay, Android closes the scene. */
  mascotDone(): void;

  /** Android only. */
  mobile?: {
    onReminderVisible(cb: (visible: boolean) => void): Unsubscribe;
    requestNotifications(): Promise<NotificationPermission>;
  };
}
