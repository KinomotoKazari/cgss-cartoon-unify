import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {mkdirSync, readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const {chromium} = createRequire(import.meta.url)('playwright');
const root = fileURLToPath(new URL('..', import.meta.url));
const folder = process.argv[2];
if (!folder) throw new Error('Usage: node tests/browser-smoke.mjs <bundle-directory>');
const files = readdirSync(folder).filter(name => /^card_cartoon_.*\.unity3d$/.test(name));
assert.ok(files.length, 'No card bundles found');
mkdirSync(resolve(root, 'test-output'), {recursive:true});
const server = spawn(process.env.PYTHON || 'python', ['-u','run.py','--no-browser'], {cwd:root, stdio:['ignore','pipe','pipe']});
let browser;
try {
  const url = await new Promise((done, reject) => {
    const timeout = setTimeout(() => reject(new Error('Python server did not start')), 10000);
    server.on('error', error => {clearTimeout(timeout); reject(error);});
    server.stdout.on('data', chunk => { const match = chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+\//); if (match) {clearTimeout(timeout); done(match[0]);} });
  });
  browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge', headless:true});
  const page = await browser.newPage({viewport:{width:1440,height:1600}});
  const errors = [], posts = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') posts.push(request.url()); });
  await page.goto(url);
  for (const name of [...files, files[0]]) {
    await page.setInputFiles('#bundle', resolve(folder,name)); await page.click('#load');
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Loaded ') || document.querySelector('#status').textContent.startsWith('Load failed:'), null, {timeout:60000});
    const state = await page.evaluate(() => ({message:document.querySelector('#status').textContent, title:document.querySelector('#card-title').textContent}));
    assert.ok(state.message.startsWith('Loaded '), state.message);
    const cardId = name.match(/(\d+)/)[1];
    assert.equal(state.title, 'CGSS ' + cardId);
    assert.match(state.message, /Loaded 5 skeleton groups/);
    if (cardId === '201389') assert.match(state.message, /21 particle emitters/);
    if (cardId === '300599') assert.match(state.message, /0 particle emitters/);
    await page.waitForTimeout(300);
    await page.click('#pause');
    const paused = await page.locator('#cv').screenshot();
    await page.waitForTimeout(200);
    assert.deepEqual(await page.locator('#cv').screenshot(),paused,'Pause must freeze the whole canvas');
    await page.screenshot({path:resolve(root,'test-output',name+'.png')});
    await page.click('#play');
    console.log(JSON.stringify(state));
  }
  const particleCard = files.find(name => name.match(/201389/));
  if (particleCard) {
    await page.goto(new URL('emitter_debug.html', url).href);
    await page.setInputFiles('#bundle', resolve(folder, particleCard)); await page.click('#load');
    await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Loaded ') || document.querySelector('#status').textContent.startsWith('Load failed:'), null, {timeout:60000});
    assert.equal(await page.locator('.particle-inspector__overlay circle').count(),21);
    assert.equal(await page.getByText('Sorting order', {exact:true}).isVisible(), true);
    const reference = await page.locator('#cv').screenshot();
    await page.waitForTimeout(100);
    assert.deepEqual(await page.locator('#cv').screenshot(), reference, 'Inspector must keep its reference frame still');
  }
  await page.setInputFiles('#bundle', {name:'broken.unity3d', mimeType:'application/octet-stream', buffer:Buffer.from('invalid')});
  await page.click('#load');
  await page.waitForFunction(() => document.querySelector('#status').textContent.startsWith('Load failed:'));
  assert.equal(await page.locator('#load').isEnabled(),true);
  await page.goto(new URL('player.html', url).href);
  await page.setInputFiles('#bundle', resolve(folder, files[0]));
  await page.waitForFunction(() => {
    const canvas = document.querySelector('#cv');
    return canvas.getContext('2d').getImageData(0, 0, 1, 1).data.some(value => value !== 0);
  }, null, {timeout:60000});
  assert.equal(posts.length,0,'Files must stay in the browser');
  assert.deepEqual(errors,[]);
  console.log('Browser load, swap, pause, malformed-file and no-upload checks passed.');
} finally { await browser?.close(); server.kill(); }
