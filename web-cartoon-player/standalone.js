import {mountPlayer} from './player.js';

// Mount one player for every declarative standalone container.
for (const container of document.querySelectorAll('.cgss-cartoon-player')) {
  mountPlayer(container, {bundleUrl:container.dataset.bundleUrl, autoLoad:container.dataset.autoLoad === 'true'});
}
