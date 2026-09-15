import {readFile, writeFile, readdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const check = process.argv.includes('--check');
// Canonical shared modules live outside the standalone folder.
const shared = [
  'viewer.js', 'particle-overlay.js', 'particle-inspector.js',
  'load-session.js', 'preview-page.js', 'embed-player.js', 'emitter-debug.js'
];
const files = shared.map(name => ['web/' + name, name]);
for (const directory of ['src', 'runtime']) {
  for (const name of await readdir(resolve(root, directory))) {
    if (name.endsWith('.js')) files.push([directory + '/' + name, directory + '/' + name]);
  }
}

let differences = 0;
for (const [source, destination] of files) {
  // The worker path changes because the standalone folder has a different root.
  let content = (await readFile(resolve(root, source), 'utf8')).replaceAll('\r\n', '\n');
  if (source.startsWith('web/')) content = content.replaceAll("'../src/loader-worker.js'", "'./src/loader-worker.js'");
  const target = resolve(root, 'web-cartoon-player', destination);
  let existing;
  try { existing = (await readFile(target, 'utf8')).replaceAll('\r\n', '\n'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (content === existing) continue;
  differences++;
  if (check) console.error('Out of sync: web-cartoon-player/' + destination);
  else await writeFile(target, content);
}
if (check && differences) process.exitCode = 1;
else console.log(check ? 'Standalone shared files are in sync.' : 'Standalone shared files updated.');
