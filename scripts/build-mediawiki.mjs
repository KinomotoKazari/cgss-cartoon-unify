import {readFile, writeFile, mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname, relative, resolve} from 'node:path';
import {buildMinifiedMediaWiki} from './minify-mediawiki.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = resolve(root, 'mediawiki/cgss-mediawiki.js');
// The Canvas distribution already contains Spine core, so bundling spine-core.js
// separately would duplicate the complete runtime in the single-file build.
const vendor = ['runtime/spine-canvas.js', 'runtime/spine-webgl.js',
  'runtime/cgss_skel_parser.js'];
const modules = new Map();

function moduleId(from, specifier) {
  if (!specifier.startsWith('./')) throw new Error(`Unsupported MediaWiki import: ${specifier}`);
  const path = resolve(root, dirname(from), specifier);
  const id = relative(root, path).replaceAll('\\', '/');
  if (id.startsWith('../') || !id.endsWith('.js')) throw new Error(`Invalid MediaWiki import: ${specifier}`);
  return id;
}

async function addModule(id) {
  if (modules.has(id)) return;
  let source = (await readFile(resolve(root, id), 'utf8')).replaceAll('\r\n', '\n');
  const dependencies = [];
  source = source.replace(/^import\s+\{([^}]+)\}\s+from\s+(['"])([^'"]+)\2;\s*$/gm,
    (_whole, names, _quote, specifier) => {
      const dependency = moduleId(id, specifier);
      dependencies.push(dependency);
      return `const {${names}} = __require(${JSON.stringify(dependency)});`;
    });
  source = source.replace(/\bimport\((['"])([^'"]+)\1\)/g, (_whole, _quote, specifier) => {
    const dependency = moduleId(id, specifier);
    dependencies.push(dependency);
    return `Promise.resolve(__require(${JSON.stringify(dependency)}))`;
  });
  if (/^import\s|^export\s+\{|\bimport\(/m.test(source)) throw new Error(`Untransformed import/export in ${id}`);
  const exports = [];
  source = source.replace(/^export\s+((?:async\s+)?(?:function\*?|class|const|let))\s+([A-Za-z_$][\w$]*)/gm,
    (_whole, kind, name) => { exports.push(name); return `${kind} ${name}`; });
  if (/^export\s/m.test(source)) throw new Error(`Untransformed export in ${id}`);
  modules.set(id, `${source}\n${exports.map(name => `exports.${name} = ${name};`).join('\n')}`);
  for (const dependency of dependencies) await addModule(dependency);
}

const entry = String.raw`
  const {loadCard} = __require('src/card-loader.js');
  const {MAX_BYTES} = __require('src/binary-reader.js');
  const {createViewer} = __require('web/viewer.js');
  const {selectBackgroundBounds} = __require('web/background-frame.js');
  __require('web/particle-overlay.js');

  function installStyles() {
    if (document.getElementById?.('cgss-mediawiki-player-style')) return;
    const style = document.createElement('style');
    style.id = 'cgss-mediawiki-player-style';
    style.textContent =
      '.cgss-mediawiki-card{position:relative;display:block;overflow:hidden;aspect-ratio:3/2;background:#666;color:#eee}' +
      '.cgss-mediawiki-card>canvas{position:absolute;left:0;top:50%;display:block;width:100%;height:auto;transform:translateY(-50%)}' +
      '.cgss-mediawiki-card[data-cgss-status="loading"]>canvas{visibility:hidden}' +
      '.cgss-mediawiki-card[data-cgss-status="loading"]::after{' +
      'content:"LOADING...";position:absolute;inset:0;display:grid;place-items:center;' +
      'font:600 1rem/1.2 sans-serif;letter-spacing:.08em;color:#eee;background:#666}';
    (document.head || document.documentElement)?.append(style);
  }

  installStyles();

  function attachmentBounds(slot) {
    const attachment = slot?.getAttachment();
    let vertices;
    if (attachment instanceof spine.RegionAttachment) {
      vertices = new Array(8);
      attachment.computeWorldVertices(slot.bone, vertices, 0, 2);
    } else if (attachment instanceof spine.MeshAttachment) {
      vertices = new Array(attachment.worldVerticesLength);
      attachment.computeWorldVertices(slot, 0, attachment.worldVerticesLength, vertices, 0, 2);
    } else return null;
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for (let index=0;index<vertices.length;index+=2) {
      minX=Math.min(minX,vertices[index]); maxX=Math.max(maxX,vertices[index]);
      minY=Math.min(minY,vertices[index+1]); maxY=Math.max(maxY,vertices[index+1]);
    }
    return {x:minX,y:minY,width:maxX-minX,height:maxY-minY};
  }

  function mainBackgroundBounds(skeleton) {
    return selectBackgroundBounds(skeleton.drawOrder.map(slot => ({name:slot.data.name,
      normal:slot.data.blendMode===spine.BlendMode.Normal,bounds:attachmentBounds(slot)})));
  }

  function cropToCardBackground(target, canvas, viewer) {
    const background = viewer.skeletons.find(entry => entry.slot === 'bg');
    if (!background) return;
    background.skeleton.updateWorldTransform();
    const bounds = mainBackgroundBounds(background.skeleton);
    if (!bounds || !(bounds.width > 0 && bounds.height > 0)) return;
    const x = viewer.fit.tx + bounds.x * viewer.fit.scale;
    const y = viewer.fit.ty + bounds.y * viewer.fit.scale;
    const width = bounds.width * viewer.fit.scale;
    const height = bounds.height * viewer.fit.scale;
    target.style.aspectRatio = width + '/' + height;
    canvas.style.left = (-x / width * 100) + '%';
    canvas.style.top = (-y / height * 100) + '%';
    canvas.style.width = (canvas.width / width * 100) + '%';
    canvas.style.height = (canvas.height / height * 100) + '%';
    canvas.style.transform = 'none';
  }

  async function fileUrl(fileTitle, options, signal) {
    if (!fileTitle) throw new Error('File title is required');
    const apiUrl = options.apiUrl || window.mw?.util?.wikiScript?.('api');
    if (!apiUrl) throw new Error('apiUrl is required when MediaWiki mw.util is unavailable');
    const url = new URL(apiUrl, location.href);
    const title = fileTitle.startsWith('File:') ? fileTitle : 'File:' + fileTitle;
    url.searchParams.set('action', 'query');
    url.searchParams.set('format', 'json');
    url.searchParams.set('prop', 'imageinfo');
    url.searchParams.set('iiprop', 'url');
    url.searchParams.set('titles', title);
    const response = await fetch(url, {signal, credentials:'same-origin'});
    if (!response.ok) throw new Error('MediaWiki API failed (' + response.status + ')');
    const data = await response.json();
    const page = Object.values(data.query?.pages || {})[0];
    const resolved = page?.imageinfo?.[0]?.url;
    if (!resolved) throw new Error('No uploaded file URL for ' + title);
    return resolved;
  }

  async function bundleUrl(options, signal) {
    if (options.bundleUrl) return options.bundleUrl;
    if (!options.fileTitle) throw new Error('Provide bundleUrl, fileTitle, or file');
    return fileUrl(options.fileTitle, options, signal);
  }

  async function readUrl(url, signal, label='Bundle') {
    const response = await fetch(url, {signal, credentials:'same-origin'});
    if (!response.ok) throw new Error(label + ' download failed (' + response.status + ')');
    if (Number(response.headers.get('content-length')) > MAX_BYTES) {
      await response.body?.cancel();
      throw new Error(label + ' exceeds 512 MB');
    }
    if (!response.body) {
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > MAX_BYTES) throw new Error(label + ' exceeds 512 MB');
      return bytes;
    }
    const reader = response.body.getReader(), chunks = [];
    let length = 0;
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > MAX_BYTES) throw new Error(label + ' exceeds 512 MB');
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return bytes.buffer;
  }

  const manifestCache = new Map();
  async function cardManifest(options, signal) {
    const manifestTitle = options.manifestTitle || 'cgss-card-bundles.json.tiff';
    const url = options.manifestUrl || await fileUrl(manifestTitle, options, signal);
    if (manifestCache.has(url)) return manifestCache.get(url);
    const response = await fetch(url, {signal, credentials:'same-origin'});
    if (!response.ok) throw new Error('Card manifest download failed (' + response.status + ')');
    let manifest;
    try { manifest = JSON.parse(await response.text()); }
    catch { throw new Error('Card manifest is not valid JSON'); }
    if (manifest?.version !== 1 || !manifest.cards || typeof manifest.cards !== 'object')
      throw new Error('Unsupported card manifest');
    manifestCache.set(url, manifest);
    return manifest;
  }

  async function readManifestBundle(options, signal) {
    const manifest = await cardManifest(options, signal);
    const entry = manifest.cards[String(options.cardId)];
    if (!entry) throw new Error('Card is not listed in the bundle manifest: ' + options.cardId);
    const files = entry.split ? entry.parts : [entry.file];
    if (!Array.isArray(files) || !files.length || files.some(name => typeof name !== 'string' || !name))
      throw new Error('Card manifest has no valid files for ' + options.cardId);
    if (entry.split && entry.partCount !== files.length)
      throw new Error('Card manifest part count does not match for ' + options.cardId);
    const chunks=[];
    let length=0;
    for (let index=0;index<files.length;index++) {
      options.onProgress?.('Downloading card file ' + (index+1) + '/' + files.length);
      const url = await fileUrl(files[index], options, signal);
      const bytes = await readUrl(url, signal, 'Card file');
      length += bytes.byteLength;
      if (length > MAX_BYTES) throw new Error('Combined bundle exceeds 512 MB');
      chunks.push(new Uint8Array(bytes));
    }
    if (Number.isFinite(entry.bytes) && entry.bytes !== length)
      throw new Error('Combined bundle size does not match the card manifest');
    const combined = new Uint8Array(length);
    let offset=0;
    for (const chunk of chunks) { combined.set(chunk,offset); offset+=chunk.byteLength; }
    return combined.buffer;
  }

  async function readBundle(options, signal) {
    if (options.file) {
      if (options.file.size > MAX_BYTES) throw new Error('Bundle exceeds 512 MB');
      return options.file.arrayBuffer();
    }
    if (options.cardId !== undefined && options.cardId !== null)
      return readManifestBundle(options, signal);
    return readUrl(await bundleUrl(options, signal), signal);
  }

  const autoPlayers = new WeakMap();

  function createPlayer(target, options = {}) {
    if (!(target instanceof HTMLElement)) throw new Error('Target must be an HTML element');
    const ownedCanvas = !(target instanceof HTMLCanvasElement);
    const canvas = ownedCanvas ? document.createElement('canvas') : target;
    if (ownedCanvas) {
      canvas.width = options.width || 1400;
      canvas.height = options.height || canvas.width;
      target.append(canvas);
    }
    let viewer = null, controller = null, generation = 0, disposed = false;
    return {
      canvas,
      get summary() { return viewer?.summary || null; },
      get diagnostics() { return viewer?.diagnostics || null; },
      async load(source = {}) {
        if (disposed) throw new Error('Player is disposed');
        const job = ++generation;
        controller?.abort();
        controller = new AbortController();
        viewer?.dispose();
        viewer = null;
        const signal = controller.signal;
        if (ownedCanvas) {
          target.dataset.cgssStatus = 'loading';
          delete target.dataset.cgssError;
        }
        try {
          const bytes = await readBundle(source, signal);
          if (job !== generation) return null;
          source.onProgress?.('Parsing card bundle');
          const card = loadCard(bytes, source.onProgress);
          if (job !== generation) return null;
          const next = await createViewer(card, canvas, source.getSpeed || (() => 1));
          if (job !== generation) { next.dispose(); return null; }
          viewer = next;
          if (ownedCanvas) cropToCardBackground(target, canvas, viewer);
          if (ownedCanvas) target.dataset.cgssStatus = 'loaded';
          return next;
        } catch (error) {
          if (job !== generation) return null;
          if (ownedCanvas) {
            target.dataset.cgssStatus = 'error';
            target.dataset.cgssError = error.message;
          }
          throw error;
        } finally {
          if (job === generation) controller = null;
        }
      },
      play() { viewer?.play(); },
      pause() { viewer?.pause(); },
      renderOnce() { viewer?.renderOnce(); },
      dispose() {
        if (disposed) return;
        disposed = true;
        generation++;
        controller?.abort();
        controller = null;
        viewer?.dispose();
        viewer = null;
        if (ownedCanvas) canvas.remove();
        autoPlayers.delete(target);
      }
    };
  }

  function mountAll(root = document) {
    let mounted = 0;
    for (const element of root.querySelectorAll('.cgss-mediawiki-card')) {
      if (autoPlayers.has(element)) continue;
      const bundleUrl = element.dataset.cgssBundleUrl;
      const fileTitle = element.dataset.cgssFileTitle;
      const cardId = element.dataset.cgssCard;
      if (!bundleUrl && !fileTitle && !cardId) continue;
      const player = createPlayer(element);
      autoPlayers.set(element, player);
      element.dataset.cgssStatus = 'loading';
      player.load({bundleUrl, fileTitle, cardId, apiUrl:element.dataset.cgssApiUrl,
        manifestUrl:element.dataset.cgssManifestUrl,
        manifestTitle:element.dataset.cgssManifestTitle})
        .then(viewer => {
          if (!viewer || autoPlayers.get(element) !== player) return;
          element.dataset.cgssStatus = 'loaded';
          element.dispatchEvent(new CustomEvent('cgss-card-ready', {detail:{player}}));
        })
        .catch(error => {
          if (autoPlayers.get(element) !== player) return;
          element.dataset.cgssStatus = 'error';
          element.dataset.cgssError = error.message;
          console.error('CGSS MediaWiki card failed to load:', error);
        });
      mounted++;
    }
    return mounted;
  }

  window.CGSSMediaWiki = Object.freeze({
    build: BUILD,
    createPlayer,
    mountAll,
    getPlayer: target => autoPlayers.get(target) || null,
    async loadCard(target, source, options) {
      const player = createPlayer(target, options);
      try { await player.load(source); return player; }
      catch (error) { player.dispose(); throw error; }
    }
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => mountAll(), {once:true});
  else mountAll();
`;

export async function buildMediaWiki(check = false) {
  modules.clear();
  for (const id of ['src/card-loader.js', 'src/binary-reader.js', 'web/viewer.js',
    'web/particle-overlay.js', 'web/background-frame.js']) await addModule(id);
  const notices = [];
  for (const [label, path] of [['Project license', 'LICENSE'],
    ['Spine Runtimes license and terms', 'licenses/Spine-3.6.txt'],
    ['AssetStudio shared-string license', 'licenses/AssetStudio-MIT.txt']]) {
    const contents = (await readFile(resolve(root, path), 'utf8')).replaceAll('\r\n', '\n').replaceAll('*/', '* /');
    notices.push(`${label}:\n${contents}`);
  }
  const pieces = [`/* CGSS Cartoon Unify for MediaWiki\n` +
    ` * Project author: KinomotoKazari\n` +
    ` * Source repository: https://github.com/KinomotoKazari/cgss-cartoon-unify\n` +
    ` * Project-authored code is provided under the MIT License. Embedded third-party\n` +
    ` * components retain their separate license terms below.\n` +
    ` * Generated by scripts/build-mediawiki.mjs. Edit canonical src/, web/, and runtime/ files.\n` +
    ` * One deployable script; card bundle bytes are fetched only on request.\n` +
    ` * ${notices.join('\n\n')}\n */`,
    `(function () {\n'use strict';\nconst BUILD = 'mediawiki-' + ${JSON.stringify((await readFile(resolve(root, 'package.json'), 'utf8')).match(/"version"\s*:\s*"([^"]+)"/)?.[1] || 'dev')};`];
  for (const id of vendor) {
    const source = (await readFile(resolve(root, id), 'utf8')).replaceAll('\r\n', '\n');
    pieces.push(`\n/* ${id} */\n${source.replace(/^\/\/# sourceMappingURL=.*$/gm, '')}`);
  }
  pieces.push(`\nconst __modules = {${[...modules].map(([id, body]) =>
    `${JSON.stringify(id)}: function(exports, __require) {\n${body}\n}`).join(',\n')}};`);
  pieces.push(`const __cache = Object.create(null);\nfunction __require(id) {\n` +
    `  if (!__modules[id]) throw new Error('Missing MediaWiki module: ' + id);\n` +
    `  if (!__cache[id]) { const exports = {}; __cache[id] = exports; __modules[id](exports, __require); }\n` +
    `  return __cache[id];\n}\n${entry}\n})();\n`);
  const content = pieces.join('\n');
  let existing;
  try { existing = await readFile(output, 'utf8'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const changed = existing !== content;
  if (changed && check) throw new Error('Out of sync: mediawiki/cgss-mediawiki.js. Run npm run sync:standalone.');
  if (changed) {
    await mkdir(dirname(output), {recursive:true});
    await writeFile(output, content);
  }
  const minifiedChanged = await buildMinifiedMediaWiki(check, content);
  return changed || minifiedChanged;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  await buildMediaWiki(process.argv.includes('--check'));
  console.log(process.argv.includes('--check') ? 'MediaWiki script is in sync.' : 'MediaWiki script updated.');
}
