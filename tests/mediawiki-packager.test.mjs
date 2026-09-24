import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {packageMediaWikiBundles} from '../scripts/package-mediawiki-bundles.mjs';

test('MediaWiki packager keeps small cards whole and splits large cards losslessly',async()=>{
  const root=await mkdtemp(join(tmpdir(),'cgss-mediawiki-pack-'));
  const input=join(root,'input'),output=join(root,'output');
  await mkdir(input);
  const small=Buffer.from([1,2,3,4]);
  const large=Buffer.from([5,6,7,8,9,10,11,12,13,14,15]);
  await writeFile(join(input,'card_cartoon_100001.unity3d'),small);
  await writeFile(join(input,'card_cartoon_100002.unity3d'),large);
  const {manifest}=await packageMediaWikiBundles(input,output,{chunkBytes:5});
  assert.deepEqual(Buffer.from(await readFile(join(output,manifest.cards['100001'].file))),small);
  assert.equal(manifest.cards['100001'].split,false);
  assert.equal(manifest.cards['100002'].split,true);
  assert.equal(manifest.cards['100002'].partCount,3);
  const rebuilt=Buffer.concat(await Promise.all(manifest.cards['100002'].parts.map(name=>readFile(join(output,name)))));
  assert.deepEqual(rebuilt,large);
  assert.equal(JSON.parse(await readFile(join(output,'cgss-card-bundles.json.tiff'),'utf8')).version,1);
});

test('MediaWiki packager rejects chunks at or above the wiki limit',async()=>{
  await assert.rejects(packageMediaWikiBundles('.',join(tmpdir(),'unused-cgss-mediawiki'),{chunkBytes:8_000_000}),/below 8000000/);
});
