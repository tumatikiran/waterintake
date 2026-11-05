import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './settings/settings.css';

const root = document.getElementById('root')!;

// One codebase, two apps: the Android build (vite --mode mobile) swaps in the
// Capacitor-backed API and the phone UI; the desktop build never includes them.
if (import.meta.env.VITE_TARGET === 'mobile') {
  void import('./mobile/start').then((m) => m.start(root));
} else {
  // No StrictMode: its double-mounting would dispose 3D rigs that are still in use.
  createRoot(root).render(<App />);
}
