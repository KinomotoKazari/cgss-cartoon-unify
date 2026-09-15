import {createViewer} from './viewer.js';
import {createLoadSession} from './load-session.js';

const input = document.querySelector('#bundle');
const canvas = document.querySelector('#cv');
const session = createLoadSession({
  workerUrl: new URL('./src/loader-worker.js', import.meta.url),
  createViewer: card => createViewer(card, canvas),
  onError: error => console.error('CGSS player failed to load:', error)
});

input.addEventListener('change', () => {
  // The embed page keeps controls minimal: choosing a file starts the preview.
  const file = input.files[0];
  if (!file) return;
  canvas.hidden = false;
  session.load({file});
});
window.addEventListener('pagehide', () => session.dispose());
