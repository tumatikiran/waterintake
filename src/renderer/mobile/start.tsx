import { createRoot } from 'react-dom/client';
import { createMobileBridge } from './bridge';
import { MobileApp } from './MobileApp';
import './mobile.css';

/** Android entry point: install the Capacitor-backed API, then render the phone UI. */
export async function start(el: HTMLElement): Promise<void> {
  document.documentElement.dataset.view = 'settings'; // shared design tokens
  document.documentElement.dataset.platform = 'mobile';
  window.aquamate = await createMobileBridge();
  createRoot(el).render(<MobileApp />);
}
