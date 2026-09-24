// Optional browser check: node tests/mediawiki-browser-smoke.mjs <card.unity3d>
import {createRequire} from 'node:module';
import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const bundlePath = process.argv[2];
if (!bundlePath) throw new Error('Pass one card_cartoon_*.unity3d path');
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.MEDIAWIKI_PLAYWRIGHT || 'playwright');
const build = process.env.MEDIAWIKI_BUILD === 'min' ? 'cgss-mediawiki.min.js' : 'cgss-mediawiki.js';
const script = await readFile(new URL(`../mediawiki/${build}`, import.meta.url));
const bundle = await readFile(bundlePath);
const server = createServer((request, response) => {
  if (request.url === '/cgss-mediawiki.js') {
    response.writeHead(200, {'content-type':'text/javascript'});
    response.end(script);
  } else if (request.url === '/card.unity3d') {
    response.writeHead(200, {'content-type':'application/octet-stream'});
    response.end(bundle);
  } else {
    response.writeHead(200, {'content-type':'text/html'});
    response.end('<div id="card" class="cgss-mediawiki-card" data-cgss-bundle-url="/card.unity3d"></div><script src="/cgss-mediawiki.js"></script>');
  }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge',headless:true});
  const page = await browser.newPage();
  const errors=[], requests=[];
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>requests.push(new URL(request.url()).pathname));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(()=>['loaded','error'].includes(document.querySelector('#card').dataset.cgssStatus));
  const result = await page.evaluate(()=>{
    try {
      const element=document.querySelector('#card');
      if (element.dataset.cgssStatus==='error') throw new Error(element.dataset.cgssError);
      const player=CGSSMediaWiki.getPlayer(element);
      const result={summary:player.summary,diagnostics:player.diagnostics,width:player.canvas.width,height:player.canvas.height};
      player.dispose();
      return result;
    } catch(error) { return {error:error.stack || error.message}; }
  });
  if (errors.length || result.error) throw new Error(JSON.stringify({errors,result}));
  assert.equal(requests.filter(path=>path.endsWith('.js')).length,1);
  assert.equal(requests.filter(path=>path==='/card.unity3d').length,1);
  console.log(JSON.stringify(result));
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
