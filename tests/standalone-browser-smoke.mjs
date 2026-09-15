import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {createReadStream, existsSync, readdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';

const {chromium} = createRequire(import.meta.url)('playwright');
const project = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(project, 'web-cartoon-player');
const folder = process.argv[2];
if (!folder) throw new Error('Usage: node tests/standalone-browser-smoke.mjs <bundle-directory>');
const files = readdirSync(folder).filter(name => /^card_cartoon_.*\.unity3d$/.test(name));
assert.ok(files.length, 'No card bundles found');

const mime = {'.css':'text/css', '.html':'text/html', '.js':'text/javascript'};
const server = createServer((request, response) => {
  const path = request.url === '/' ? 'index.html' : request.url.slice(1).split('?')[0];
  const target = resolve(root, path);
  if (!target.startsWith(root + sep) && target !== root || !existsSync(target)) { response.writeHead(404).end(); return; }
  response.writeHead(200, {'Content-Type':mime[extname(target)] || 'application/octet-stream'});
  createReadStream(target).pipe(response);
});
await new Promise(done => server.listen(0, '127.0.0.1', done));
const port = server.address().port;
let browser;
try {
  browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge', headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1600}});
  const errors = [], posts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await page.goto(`http://127.0.0.1:${port}/`);
  for (const name of [...files, files[0]]) {
    await page.setInputFiles('input[type=file]', resolve(folder, name));
    await page.click('button[type=submit]');
    await page.waitForFunction(() => document.querySelector('.cgss-cartoon-player__status').textContent.startsWith('Loaded ') || document.querySelector('.cgss-cartoon-player__status').textContent.startsWith('Load failed:'), null, {timeout:60000});
    const message = await page.locator('.cgss-cartoon-player__status').textContent();
    assert.ok(message.startsWith('Loaded '), message);
    assert.equal(await page.locator('h2').textContent(), `CGSS ${name.match(/(\d+)/)[1]}`);
    await page.waitForTimeout(300);
    await page.getByRole('button', {name:'Pause'}).click();
    const previewCanvas = page.locator('.cgss-cartoon-player__viewport > canvas');
    const paused = await previewCanvas.screenshot();
    await page.waitForTimeout(200);
    assert.deepEqual(await previewCanvas.screenshot(), paused, 'Pause must freeze the whole canvas');
    await page.getByRole('button', {name:'Play'}).click();
  }
  const particleCard = files.find(name => name.match(/201389/));
  if (particleCard) {
    await page.goto(`http://127.0.0.1:${port}/emitter_debug.html`);
    assert.equal(await page.locator('.standalone-shell').evaluate(node => getComputedStyle(node).paddingLeft), '40px');
    await page.setInputFiles('input[type=file]', resolve(folder, particleCard));
    await page.getByRole('button', {name:'Inspect emitters'}).click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Loaded ') || document.querySelector('#status').textContent.startsWith('Load failed:'), null, {timeout:60000});
    assert.equal(await page.locator('.particle-inspector__overlay circle').count(),21);
    assert.equal(await page.getByText('Sorting order', {exact:true}).isVisible(), true);
    const reference = await page.locator('#cv').screenshot();
    await page.waitForTimeout(100);
    assert.deepEqual(await page.locator('#cv').screenshot(), reference, 'Inspector must keep its reference frame still');
  }
  await page.goto(`http://127.0.0.1:${port}/player.html`);
  assert.equal(await page.getByLabel('Choose card bundle').isVisible(), true);
  assert.equal(await page.locator('#cv').isVisible(), false);
  await page.setInputFiles('#bundle', resolve(folder, files[0]));
  assert.equal(await page.locator('#cv').isVisible(), true);
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#cv');
    return canvas.getContext('2d').getImageData(0, 0, 1, 1).data.some(value => value !== 0);
  }, null, {timeout:60000});
  assert.equal(posts.length, 0, 'Files must stay in the browser');
  assert.deepEqual(errors, []);
  console.log('Standalone browser load, swap, pause and no-upload checks passed.');
} finally {
  await browser?.close();
  await new Promise(done => server.close(done));
}
