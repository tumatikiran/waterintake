/// <reference types="vite/client" />
import type { AquaMateApi } from '../shared/api';

declare global {
  interface Window {
    aquamate: AquaMateApi;
    __aquamateDebug?: {
      x: number;
      stopX: number;
      centerX: number;
      exitLeftX: number;
      exitRightX: number;
      walking: boolean;
      animation: string | null;
      expression: string | null;
      /** What the character holds (null: empty hands). */
      prop: string | null;
      bottleLevel: number | null;
      /** Which character is on stage, e.g. "stored:default-female:1" (null while loading). */
      character: string | null;
    };
    /** Same as __aquamateDebug, for the character on Android's Today screen. */
    __aquamateHomeDebug?: Window['__aquamateDebug'];
  }
  const __APP_VERSION__: string;
}
