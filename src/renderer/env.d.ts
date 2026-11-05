/// <reference types="vite/client" />
import type { AquaMateApi } from '../shared/api';

declare global {
  interface Window {
    aquamate: AquaMateApi;
    __aquamateDebug?: {
      x: number;
      stopX: number;
      exitLeftX: number;
      exitRightX: number;
      walking: boolean;
      animation: string | null;
      expression: string | null;
      bottleLevel: number | null;
    };
    /** Same as __aquamateDebug, for the character on Android's Today screen. */
    __aquamateHomeDebug?: Window['__aquamateDebug'];
  }
  const __APP_VERSION__: string;
}
