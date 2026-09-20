import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {loadCard} from '../src/card-loader.js';
import {resolveParticleMaterial} from '../web/particle-material.js';

function fixture(name, src, dst) {
  return {
    shader:{name, data:{states:[{rtBlend0:{srcBlend:{name:'_BlendSrc'},destBlend:{name:'_BlendDst'},
      blendOp:{val:0},colMask:{val:14}},zWrite:{val:0},alphaToMask:{val:0},rtSeparateBlend:false}]}},
    material:{m_SavedProperties:{m_Floats:[{Key:'_BlendSrc',Value:src},{Key:'_BlendDst',Value:dst}]}}
  };
}

test('particle shader families use their authored gain and blend factors', () => {
  for (const [name,src,dst,gain,multiply] of [
    ['CommonParticle/Standard/Blend',5,10,2,false],
    ['CommonParticle/TexAlpha/Simple/Blend',5,10,1,false],
    ['CommonParticle/Simple/Blend',5,1,1,false],
    ['CommonParticle/TexAlpha/Standard/Blend',5,1,2,false],
    ['CommonParticle/Standard/Multiply',0,3,2,true]
  ]) {
    const {shader,material} = fixture(name,src,dst);
    const state=resolveParticleMaterial(shader,material,{mainFormat:4});
    assert.equal(state.gain,gain);assert.equal(state.multiply,multiply);
    assert.equal(state.lumaAlpha,false);assert.equal(state.src,src);
    assert.equal(state.dst,dst);assert.equal(state.colorMask,14);
  }
  const {shader,material} = fixture('CommonParticle/Standard/AddtiveMultiply',1,10);
  const state=resolveParticleMaterial(shader,material,{mainFormat:34});
  assert.equal(state.gain,2);assert.equal(state.multiply,false);
  assert.equal(state.lumaAlpha,true);assert.equal(state.alphaSource,'luminance-default-white');
});

test('less common Simple blend factors remain distinct', () => {
  for (const dst of [5,6,7]) {
    const {shader,material} = fixture('CommonParticle/Simple/Blend',5,dst);
    assert.equal(resolveParticleMaterial(shader,material,{mainFormat:34}).dst,dst);
  }
});

test('authored destination-color source factors remain distinct from alpha blending', () => {
  for (const [name,src,alphaSource] of [
    ['CommonParticle/Standard/Blend',3,'main-texture'],
    ['CommonParticle/Standard/Blend',4,'main-texture'],
    ['CommonParticle/TexAlpha/Simple/Blend',4,'alpha-texture-red']
  ]) {
    const {shader,material} = fixture(name,src,1);
    const state = resolveParticleMaterial(shader,material,{mainFormat:34,
      alphaFormat:34,alphaAssigned:true,hasAlphaTexture:true});
    assert.equal(state.src,src);
    assert.equal(state.dst,1);
    assert.equal(state.alphaSource,alphaSource);
    assert.equal(state.confidence,'shader-and-material');
  }
});

test('shader, blend, and texture format select one explicit alpha path', () => {
  const {shader,material} = fixture('CommonParticle/Standard/Blend',5,1);
  assert.equal(resolveParticleMaterial(shader,material,{mainFormat:34}).alphaSource,'main-texture');
  material.m_SavedProperties.m_Floats[1].Value=10;
  const approximation=resolveParticleMaterial(shader,material,{mainFormat:34});
  assert.equal(approximation.alphaSource,'rgb-mask-approximation');
  assert.equal(approximation.confidence,'approximation');
  assert.equal(resolveParticleMaterial(shader,material,{mainFormat:4}).alphaSource,'main-texture');
  const separate=fixture('CommonParticle/TexAlpha/Simple/Blend',5,10);
  assert.equal(resolveParticleMaterial(separate.shader,separate.material,
    {mainFormat:34,alphaFormat:1,alphaAssigned:true,hasAlphaTexture:true}).alphaSource,'alpha8-texture');
  assert.equal(resolveParticleMaterial(separate.shader,separate.material,
    {mainFormat:34,alphaFormat:34,alphaAssigned:true,hasAlphaTexture:true}).alphaSource,'alpha-texture-red');
  assert.equal(resolveParticleMaterial(separate.shader,separate.material,
    {mainFormat:34}).alphaSource,'shader-default-white');
});

test('unverified shader states fail explicitly', () => {
  let {shader,material} = fixture('CommonParticle/Standard/Multiply',5,1);
  assert.throws(() => resolveParticleMaterial(shader,material,{mainFormat:34}),/blend state/);
  ({shader,material} = fixture('CommonParticle/Unknown',5,1));
  assert.throws(() => resolveParticleMaterial(shader,material,{mainFormat:34}),/Unsupported particle shader/);
  ({shader,material} = fixture('CommonParticle/TexAlpha/Simple/Blend',5,10));
  assert.throws(() => resolveParticleMaterial(shader,material,{mainFormat:999}),/texture format/);
  assert.throws(() => resolveParticleMaterial(shader,material,
    {mainFormat:34,alphaAssigned:true,hasAlphaTexture:false}),/Missing particle alpha texture/);
});

test('representative bundles select their material paths without card-specific rules',
  {skip:!process.env.CGSS_BUNDLE_DIR}, () => {
    const cards=new Map();
    for (const [id,name,expected] of [
      ['100108','star_handR','main-texture'],
      ['100108','blur_handR1','luminance-default-white'],
      ['100108','leaf_front1','alpha-texture-red'],
      ['201389','eff_circle_03','main-texture'],
      ['100281','water_splash03_1','main-texture'],
      ['100398','flowerL1','alpha-texture-red'],
      ['101138','eff_circle_01','main-texture'],
      ['101287','smoke_01','alpha-texture-red'],
      ['300815','blur','main-texture'],
      ['300895','blur_1','main-texture'],
      ['301056','ray_front_03','main-texture']
    ]) {
      if(!cards.has(id)) cards.set(id,loadCard(fs.readFileSync(path.join(process.env.CGSS_BUNDLE_DIR,`card_cartoon_${id}.unity3d`))));
      const card=cards.get(id);
      const objects=card.plan.objects, node=card.plan.effectPrefabs.flatMap(prefab=>prefab.nodes).find(node=>node.name===name);
      const renderer=objects[node.componentIds.find(key=>objects[key]?.type==='ParticleSystemRenderer')].data;
      const material=objects[renderer.m_Materials[0].m_PathID].data;
      const shader=objects[material.m_Shader.m_PathID];
      const textures=Object.fromEntries(material.m_SavedProperties.m_TexEnvs.map(({Key,Value})=>[Key,Value.m_Texture.m_PathID]));
      const format=key=>card.textures.find(texture=>texture.id===textures[key])?.format;
      const state=resolveParticleMaterial(shader,material,{mainFormat:format('_MainTex'),
        alphaFormat:format('_AlphaTex'),alphaAssigned:!!textures._AlphaTex && textures._AlphaTex!=='0',
        hasAlphaTexture:format('_AlphaTex')!==undefined});
      assert.equal(state.alphaSource,expected,`${id} ${name}`);
      assert.equal(state.confidence,'shader-and-material');
    }
  });
