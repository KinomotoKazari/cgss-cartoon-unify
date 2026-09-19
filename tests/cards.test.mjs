import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {runInNewContext} from 'node:vm';
import {loadCard} from '../src/card-loader.js';

const folder = process.env.CGSS_BUNDLE_DIR;
const pixels = JSON.parse(fs.readFileSync(new URL('./reference-pixels.json',import.meta.url),'utf8'));
for (const [id,objects,particleCount,textureCount] of [['201389',120,22,7],['300599',19,0,2]]) {
  test(`card ${id}: metadata, referenced assets and reference RGBA hashes`, {skip:!folder}, () => {
    const card = loadCard(fs.readFileSync(path.join(folder,`card_cartoon_${id}.unity3d`)));
    assert.equal(card.cardId,id); assert.equal(card.summary.files[0].objects,objects);
    assert.equal(card.skeletons.length,5); assert.equal(card.textures.length,textureCount);
    assert.equal(card.plan.effectPrefabs.reduce((n,prefab) => n+prefab.particleSystemIds.length,0),particleCount);
    for (const texture of card.textures) {
      assert.deepEqual({width:texture.width,height:texture.height,sha256:createHash('sha256').update(texture.rgba).digest('hex')},pixels[texture.name]);
    }
    const material = Object.values(card.plan.objects).find(object => object.name === `SP3S${id}_tex_Material`);
    const main = material.data.m_SavedProperties.m_TexEnvs.find(entry => entry.Key === '_MainTex');
    assert.equal(main.Value.m_Texture.m_PathID,card.rgbId);
  });
}

test('card 100369 omits unused external meshes in billboard modes', {skip:!folder}, () => {
  const card = loadCard(fs.readFileSync(path.join(folder,'card_cartoon_100369.unity3d')));
  const renderers = Object.values(card.plan.objects).filter(object => object.type === 'ParticleSystemRenderer');
  assert.ok(renderers.length > 0);
  assert.ok(renderers.every(object => object.data.m_RenderMode === 4 || !object.data.m_Mesh));
});

test('card 100448 preserves its built-in Quad mesh particles', {skip:!folder}, () => {
  const card = loadCard(fs.readFileSync(path.join(folder,'card_cartoon_100448.unity3d')));
  const renderers = Object.values(card.plan.objects).filter(object => object.type === 'ParticleSystemRenderer' && object.data.m_RenderMode === 4);
  assert.equal(renderers.length, 4);
  for (const renderer of renderers) {
    const mesh = card.plan.objects[renderer.data.m_Mesh.m_PathID]?.data.particleMesh;
    assert.deepEqual(mesh?.indices, [0,1,2,0,2,3]);
  }
});

test('card 200674 keeps UTF-8 attachment names aligned with its atlas', {skip:!folder}, () => {
  const card = loadCard(fs.readFileSync(path.join(folder,'card_cartoon_200674.unity3d')));
  const context = {TextDecoder};
  runInNewContext(fs.readFileSync(new URL('../runtime/cgss_skel_parser.js',import.meta.url),'utf8'),context);
  const background = card.skeletons.find(layer => layer.slot === 'bg');
  const json = context.CGSSSkelParser.parse(background.bytes.buffer.slice(
    background.bytes.byteOffset, background.bytes.byteOffset + background.bytes.byteLength));
  const paths = Object.values(json.skins).flatMap(skin => Object.values(skin).flatMap(slot =>
    Object.entries(slot).map(([name,attachment]) => attachment.path || name)));
  assert.ok(paths.includes('monitor_ｈl1'));
  assert.ok(card.atlasText.includes('monitor_ｈl1'));
});
