/// <reference types="vite/client" />
import type { AquaMateApi } from '../main/preload';

declare global {
  interface Window {
    aquamate: AquaMateApi;
    __aquamateDebug?: { x: number; stopX: number; startX: number; animation: string | null; phase: string };
  }
}
