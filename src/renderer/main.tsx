import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './settings/settings.css';

// No StrictMode: its double-mounting would dispose 3D rigs that are still in use.
createRoot(document.getElementById('root')!).render(<App />);
