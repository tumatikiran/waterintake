import { Overlay } from './Overlay';
import { SettingsApp } from './settings/SettingsApp';

const view = new URLSearchParams(window.location.search).get('view') === 'mascot' ? 'mascot' : 'settings';
document.documentElement.dataset.view = view;

/** One renderer bundle, two windows: the transparent overlay and the settings window. */
export function App() {
  return view === 'mascot' ? <Overlay /> : <SettingsApp />;
}
