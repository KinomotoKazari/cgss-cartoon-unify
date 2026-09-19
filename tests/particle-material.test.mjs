import test from 'node:test';
import assert from 'node:assert/strict';
import {particleMaterialState, needsRgbAlphaMask} from '../web/particle-material.js';

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
    assert.deepEqual(particleMaterialState(shader,material),{gain,multiply,lumaAlpha:false,src,dst,colorMask:14});
  }
  const {shader,material} = fixture('CommonParticle/Standard/AddtiveMultiply',1,10);
  assert.deepEqual(particleMaterialState(shader,material),
    {gain:2,multiply:false,lumaAlpha:true,src:1,dst:10,colorMask:14});
});

test('less common Simple blend factors remain distinct', () => {
  for (const dst of [5,6,7]) {
    const {shader,material} = fixture('CommonParticle/Simple/Blend',5,dst);
    assert.equal(particleMaterialState(shader,material).dst,dst);
  }
});

test('additive ETC particles do not lose opacity to a second RGB mask', () => {
  const {shader,material} = fixture('CommonParticle/Standard/Blend',5,1);
  const state = particleMaterialState(shader,material);
  assert.equal(needsRgbAlphaMask(shader,state,34,false),false);
  assert.equal(needsRgbAlphaMask(shader,{...state,dst:10},34,false),true);
  assert.equal(needsRgbAlphaMask(shader,{...state,dst:10},34,true),false);
});

test('unverified shader states fail explicitly', () => {
  let {shader,material} = fixture('CommonParticle/Standard/Multiply',5,1);
  assert.throws(() => particleMaterialState(shader,material),/blend state/);
  ({shader,material} = fixture('CommonParticle/Unknown',5,1));
  assert.throws(() => particleMaterialState(shader,material),/Unsupported particle shader/);
});
