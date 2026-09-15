import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
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
