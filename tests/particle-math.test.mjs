import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sample, integral, particleScale, rotateShape, compareEmitters, stretchedBillboard} from '../web/particle-math.js';

const linear = (a,b) => ({m_Curve:[{time:0,value:a,inSlope:b-a,outSlope:b-a},{time:1,value:b,inSlope:b-a,outSlope:b-a}]});
test('emitter ordering uses layer then signed order with stable ties',()=>{
  const entries=[0,-2,-44,0].map((order,serial)=>({serial,renderer:{m_SortingLayer:0,m_SortingOrder:order}}));
  assert.deepEqual(entries.sort(compareEmitters).map(e=>e.serial),[2,1,0,3]);
  assert.ok(compareEmitters({serial:0,renderer:{m_SortingLayer:1,m_SortingOrder:-99}},{serial:1,renderer:{m_SortingLayer:0,m_SortingOrder:99}})>0);
});
test('falling velocity keeps its sign and integrates changing speed',()=>{
  const curve={minMaxState:1,scalar:1,maxCurve:linear(-0.6,-1)};
  assert.ok(Math.abs(sample(curve,0.5,0.5)+0.8)<1e-9);
  assert.ok(Math.abs(integral(curve,0.5,10,10)+8)<1e-9);
  assert.ok(Math.abs(integral(curve,0.5,5,10)+3.5)<1e-9);
});
test('constant and two-curve modes preserve their authored ranges',()=>{
  assert.equal(sample({minMaxState:3,minScalar:2,scalar:6},0.25),3);
  assert.equal(sample({minMaxState:2,scalar:2,minCurve:linear(1,1),maxCurve:linear(3,3)},0.5,0.2),4);
});
test('size scaling follows hierarchy, local and shape-only modes',()=>{
  const transforms=[100,2].map(s=>({data:{m_LocalScale:{x:s,y:s}}}));
  assert.deepEqual(particleScale(transforms,0),{x:200,y:200});
  assert.deepEqual(particleScale(transforms,1),{x:100,y:100});
  assert.deepEqual(particleScale(transforms,2),{x:1,y:1});
  const p=rotateShape({x:0,y:0,z:1},{y:90});
  assert.ok(Math.abs(p.x-1)<1e-9 && Math.abs(p.z)<1e-9);
});
test('stretch billboards use authored length, motion direction and pivot',()=>{
  const quad=stretchedBillboard({m_RenderMode:1,m_LengthScale:10,m_VelocityScale:2,m_Pivot:{x:0,y:5}},4,{x:3,y:4});
  assert.equal(quad.width,4); assert.equal(quad.height,50);
  assert.ok(Math.abs(quad.angle-(Math.atan2(4,3)+Math.PI/2))<1e-12);
  assert.deepEqual(quad.offset,{x:12,y:16});
  assert.deepEqual(stretchedBillboard({m_RenderMode:0},4,{x:3,y:4},.5),{width:4,height:4,angle:.5,offset:{x:0,y:0}});
});
test('billboard 3D size and pivot keep distinct width and height',()=>{
  const quad=stretchedBillboard({m_RenderMode:0,m_Pivot:{x:.1,y:.4}},60,{x:0,y:0},0,160);
  assert.deepEqual(quad,{width:60,height:160,angle:0,offset:{x:6,y:64}});
  const stretch=stretchedBillboard({m_RenderMode:1,m_LengthScale:.5,m_VelocityScale:0},60,{x:0,y:0},0,160);
  assert.equal(stretch.height,80);
});
