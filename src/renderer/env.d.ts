/// <reference types="vite/client" />
import type { AquaMateApi } from '../main/preload';

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
  }
}
