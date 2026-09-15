import {loadCard} from './card-loader.js';
import {MAX_BYTES} from './binary-reader.js';

async function readSource({file, url}) {
  // Read local uploads or configured URLs in the worker to keep parsing off the UI thread.
  if (file) {
    if (file.size > MAX_BYTES) throw new Error('Bundle exceeds 512 MB');
    return file.arrayBuffer();
  }
  if (typeof url !== 'string') throw new Error('No bundle was selected');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Bundle download failed (${response.status})`);
  if (Number(response.headers.get('content-length')) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error('Bundle exceeds 512 MB');
  }
  // Stream remote bundles with the same size ceiling used for uploads.
  const chunks = [];
  let length = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > MAX_BYTES) throw new Error('Bundle exceeds 512 MB');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes.buffer;
}

self.onmessage = async ({data}) => {
  // Transfer texture and skeleton buffers so the main thread does not clone large assets.
  try {
    const bytes = await readSource(data);
    const card = loadCard(bytes, message => self.postMessage({type: 'progress', message}));
    const buffers = [...card.textures.map(texture => texture.rgba.buffer), ...card.skeletons.map(skeleton => skeleton.bytes.buffer)];
    self.postMessage({type: 'loaded', card}, [...new Set(buffers)]);
  } catch (error) {
    self.postMessage({type: 'error', message: error.message});
  }
};
