import test from 'node:test';
import assert from 'node:assert/strict';
import {selectBackgroundBounds} from '../web/background-frame.js';

const bounds=(width,height)=>({x:0,y:0,width,height});

test('background crop accepts case-insensitive exact BG slots',()=>{
  const selected=selectBackgroundBounds([
    {name:'eff_toplight',normal:false,bounds:bounds(1600,900)},
    {name:'BG',normal:true,bounds:bounds(1200,780)}
  ]);
  assert.deepEqual(selected,bounds(1200,780));
});

test('background crop falls back to the largest normal card-shaped attachment',()=>{
  const selected=selectBackgroundBounds([
    {name:'eff_cyalume1_add',normal:false,bounds:bounds(1800,1000)},
    {name:'bg3',normal:true,bounds:bounds(1100,800)},
    {name:'decoration',normal:true,bounds:bounds(300,300)}
  ]);
  assert.deepEqual(selected,bounds(1100,800));
});

test('exact bg remains authoritative when other attachments are larger',()=>{
  const selected=selectBackgroundBounds([
    {name:'bg',normal:true,bounds:bounds(1000,650)},
    {name:'animated_overlay',normal:true,bounds:bounds(1400,900)}
  ]);
  assert.deepEqual(selected,bounds(1000,650));
});
