import {createViewer} from './viewer.js';
import {createLoadSession} from './load-session.js';

const workerUrl = new URL('./src/loader-worker.js', import.meta.url);

function element(tag, className, text) {
  // Keep the embeddable player self-contained instead of relying on host page markup.
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}

export function mountPlayer(container, options = {}) {
  // Build the player in a supplied container and return lifecycle controls to its host.
  if (!(container instanceof Element)) throw new Error('A player container is required');
  const root = element('section', 'cgss-cartoon-player__root');
  const form = element('form', 'cgss-cartoon-player__form');
  const choose = element('label', 'cgss-cartoon-player__choose', 'Choose bundle');
  const input = element('input'); input.type = 'file'; input.accept = '.unity3d';
  choose.append(input);
  const filename = element('span', 'cgss-cartoon-player__filename', options.bundleUrl ? 'Remote bundle selected' : 'No file selected');
  const load = element('button', '', 'Load card'); load.type = 'submit';
  const cancel = element('button', '', 'Cancel'); cancel.type = 'button'; cancel.hidden = true;
  form.append(choose, filename, load, cancel);
  const status = element('p', 'cgss-cartoon-player__status', options.bundleUrl ? 'Ready to load the configured bundle.' : '');
  status.setAttribute('role', 'status');
  const preview = element('section', 'cgss-cartoon-player__preview'); preview.hidden = true;
  const header = element('header', 'cgss-cartoon-player__header');
  const title = element('h2');
  const controls = element('div', 'cgss-cartoon-player__controls');
  const play = element('button', '', 'Play'); play.type = 'button';
  const pause = element('button', '', 'Pause'); pause.type = 'button';
  const speedLabel = element('label', '', 'Speed ');
  const speed = element('input'); speed.type = 'range'; speed.min = '.1'; speed.max = '3'; speed.step = '.1'; speed.value = '1';
  speedLabel.append(speed); controls.append(play, pause, speedLabel); header.append(title, controls);
  const viewport = element('div', 'cgss-cartoon-player__viewport');
  const canvas = element('canvas'); canvas.width = 1400; canvas.height = 1400; viewport.append(canvas); preview.append(header, viewport);
  root.append(form, status, preview); container.replaceChildren(root);

  const setStatus = message => { status.textContent = message; };
  // The shared session owns parsing work and disposes a previous viewer before reload.
  const session = createLoadSession({
    workerUrl,
    createViewer: card => createViewer(card, canvas, () => Number(speed.value)),
    onProgress: setStatus,
    onBusy(busy) { load.disabled = busy; cancel.hidden = !busy; },
    onError(error) { setStatus(`Load failed: ${error.message}`); },
    onLoaded(viewer, card) {
      preview.hidden = false;
      title.textContent = `CGSS ${card.cardId}`;
      setStatus(`Loaded ${viewer.skeletons.length} Spine layers and ${viewer.particles.count} particle emitters.`);
    }
  });
  // A local upload takes priority; a configured URL supports host-page integration.
  const begin = source => {
    setStatus(source.file ? `Reading ${source.file.name}…` : 'Downloading bundle…');
    session.load(source);
  };
  input.onchange = () => { filename.textContent = input.files[0]?.name || 'No file selected'; };
  form.onsubmit = event => { event.preventDefault(); const file = input.files[0]; if (file) begin({file}); else if (options.bundleUrl) begin({url:options.bundleUrl}); };
  cancel.onclick = () => { session.cancel(); setStatus('Loading cancelled.'); };
  play.onclick = () => session.play(); pause.onclick = () => session.pause();
  const onPageHide = () => session.dispose();
  window.addEventListener('pagehide', onPageHide);
  if (options.autoLoad && options.bundleUrl) begin({url:options.bundleUrl});
  return {load: () => options.bundleUrl ? begin({url:options.bundleUrl}) : undefined, dispose: () => { window.removeEventListener('pagehide', onPageHide); session.dispose(); root.remove(); }};
}
