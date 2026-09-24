import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {buildMediaWiki} from '../scripts/build-mediawiki.mjs';

const script = await readFile(new URL('../mediawiki/cgss-mediawiki.js', import.meta.url), 'utf8');
const minifiedScript = await readFile(new URL('../mediawiki/cgss-mediawiki.min.js', import.meta.url), 'utf8');

test('MediaWiki script matches current canonical player sources',async()=>{
  assert.equal(await buildMediaWiki(true),false);
});

test('minified MediaWiki script preserves notices and points to readable source',()=>{
  assert.match(minifiedScript,/Minified distribution\. Read cgss-mediawiki\.js/);
  assert.match(minifiedScript,/Copyright \(c\) 2026 KinomotoKazari/);
  assert.match(minifiedScript,/Spine Runtimes Software License/);
  assert.doesNotMatch(minifiedScript,/\bfunction createPlayer\b|\bfunction mountAll\b|\bconst BUILD\b/);
  assert.ok(minifiedScript.length < script.length);
});

function wikiContext(fetch, source = script) {
  class Element { constructor() { this.dataset={}; this.style={}; } append(child) { this.child = child; } }
  class Canvas extends Element { remove() { this.removed = true; } }
  const head=new Element();
  const context = {HTMLElement:Element, HTMLCanvasElement:Canvas, fetch, URL, TextDecoder, AbortController,
    location:{href:'https://wiki.example.test/card'},
    document:{head,readyState:'loading',addEventListener:()=>{},
      createElement:type => type==='canvas' ? new Canvas() : new Element()}};
  context.window = context;
  vm.runInNewContext(source, context, {filename:'cgss-mediawiki.js'});
  return {context, Canvas, Element, head};
}

test('minified MediaWiki script exposes the same browser entry point',()=>{
  const {context}=wikiContext(async()=>{ throw new Error('unexpected fetch'); },minifiedScript);
  assert.equal(typeof context.CGSSMediaWiki.createPlayer,'function');
  assert.equal(typeof context.CGSSMediaWiki.mountAll,'function');
});

test('MediaWiki script is self-contained and fetches no card before load',()=>{
  let requests = 0;
  const {context,Canvas} = wikiContext(async()=>{ requests++; throw new Error('unexpected fetch'); });
  assert.equal(typeof context.CGSSMediaWiki.createPlayer,'function');
  const player = context.CGSSMediaWiki.createPlayer(new Canvas());
  assert.equal(requests,0);
  player.dispose();
});

test('MediaWiki container keeps native render coordinates and bundles its clipping style',()=>{
  const {context,Element,head}=wikiContext(async()=>{ throw new Error('unexpected fetch'); });
  const target=new Element();
  const player=context.CGSSMediaWiki.createPlayer(target);
  assert.equal(player.canvas.width,1400);
  assert.equal(player.canvas.height,1400);
  assert.match(head.child.textContent,/overflow:hidden/);
  assert.match(head.child.textContent,/aspect-ratio:3\/2/);
  assert.match(head.child.textContent,/LOADING\.\.\./);
  player.dispose();
});

test('MediaWiki URL load fetches only the selected bundle on demand',async()=>{
  const urls=[];
  const {context,Canvas} = wikiContext(async url=>{
    urls.push(String(url));
    return {ok:true,headers:{get:()=>null},body:null,arrayBuffer:async()=>new Uint8Array([1]).buffer};
  });
  const player=context.CGSSMediaWiki.createPlayer(new Canvas());
  await assert.rejects(player.load({bundleUrl:'https://wiki.example.test/card.unity3d'}),/Truncated data/);
  assert.deepEqual(urls,['https://wiki.example.test/card.unity3d']);
  player.dispose();
});

test('MediaWiki File title resolves through MediaWiki before fetching its bundle',async()=>{
  const urls=[];
  const {context,Canvas} = wikiContext(async url=>{
    urls.push(String(url));
    if (urls.length===1) return {ok:true,json:async()=>({query:{pages:{1:{imageinfo:[{url:'https://wiki.example.test/upload/card.unity3d'}]}}}})};
    return {ok:true,headers:{get:()=>null},body:null,arrayBuffer:async()=>new Uint8Array([1]).buffer};
  });
  const player=context.CGSSMediaWiki.createPlayer(new Canvas());
  await assert.rejects(player.load({fileTitle:'card.unity3d',apiUrl:'https://wiki.example.test/api.php'}),/Truncated data/);
  assert.match(urls[0],/titles=File%3Acard.unity3d/);
  assert.equal(urls[1],'https://wiki.example.test/upload/card.unity3d');
  player.dispose();
});

test('MediaWiki manifest resolves and combines uploaded TIFF-named card parts',async()=>{
  const urls=[];
  const apiResponse=file=>({ok:true,json:async()=>({query:{pages:{1:{imageinfo:[{url:'https://wiki.example.test/upload/'+file}]}}}})});
  const bytes=value=>({ok:true,headers:{get:()=>null},body:null,arrayBuffer:async()=>new Uint8Array(value).buffer});
  const {context,Canvas}=wikiContext(async url=>{
    urls.push(String(url));
    if(urls.length===1) return apiResponse('cgss-card-bundles.json.tiff');
    if(urls.length===2) return {ok:true,text:async()=>JSON.stringify({version:1,cards:{301337:{
      split:true,partCount:2,parts:['card_cartoon_301337.unity3d.part001.tiff','card_cartoon_301337.unity3d.part002.tiff'],bytes:4
    }}})};
    if(urls.length===3) return apiResponse('part-1');
    if(urls.length===4) return bytes([1,2]);
    if(urls.length===5) return apiResponse('part-2');
    return bytes([3,4]);
  });
  const player=context.CGSSMediaWiki.createPlayer(new Canvas());
  await assert.rejects(player.load({cardId:'301337',apiUrl:'https://wiki.example.test/api.php'}),/Truncated data/);
  assert.match(urls[0],/titles=File%3Acgss-card-bundles.json.tiff/);
  assert.match(urls[2],/card_cartoon_301337.unity3d.part001.tiff/);
  assert.match(urls[4],/card_cartoon_301337.unity3d.part002.tiff/);
  assert.equal(urls[3],'https://wiki.example.test/upload/part-1');
  assert.equal(urls[5],'https://wiki.example.test/upload/part-2');
  player.dispose();
});
