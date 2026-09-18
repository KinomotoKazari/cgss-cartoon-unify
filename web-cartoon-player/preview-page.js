import {createViewer} from './viewer.js';
import {createLoadSession} from './load-session.js';

export function mountPreviewPage({inspect = false} = {}) {
  // Share one loading flow between the animation and emitter-inspector pages.
  const input = document.querySelector('#bundle');
  const load = document.querySelector('#load');
  const cancel = document.querySelector('#cancel');
  const speed = document.querySelector('#speed');
  const status = document.querySelector('#status');
  const session = createLoadSession({
    workerUrl: new URL('./src/loader-worker.js', import.meta.url),
    createViewer: card => createViewer(card, document.querySelector('#cv'), () => Number(speed?.value) || 1),
    onBusy(busy) { load.disabled = busy; cancel.hidden = !busy; },
    onProgress(message) { status.textContent = message; },
    onError(error) { status.textContent = `Load failed: ${error.message}`; },
    onLoaded(viewer, card) {
      // The inspector is deliberately static to make authored locations easy to compare.
      document.querySelector('#preview').hidden = false;
      document.querySelector('#card-title').textContent = `CGSS ${card.cardId}`;
      if (inspect) {
        const inspector = viewer.createParticleInspector(document.querySelector('#viewport'), document.querySelector('#particle-inspector'));
        inspector.setVisible(true);
        status.textContent = `Loaded ${inspector.count} active particle emitters.`;
        viewer.renderOnce();
        viewer.pause();
      } else {
        status.textContent = `Loaded ${viewer.skeletons.length} skeleton groups and ${viewer.particles.count} particle emitters.`;
      }
    }
  });

  input.addEventListener('change', () => {
    document.querySelector('#filename').textContent = input.files[0]?.name || 'No file selected';
  });
  document.querySelector('#load-form').addEventListener('submit', event => {
    event.preventDefault();
    const file = input.files[0];
    if (!file) return;
    status.textContent = `Reading ${file.name}…`;
    session.load({file});
  });
  cancel.addEventListener('click', () => {
    session.cancel();
    status.textContent = 'Loading cancelled.';
  });
  document.querySelector('#play')?.addEventListener('click', () => session.play());
  document.querySelector('#pause')?.addEventListener('click', () => session.pause());
  window.addEventListener('pagehide', () => session.dispose());
}
