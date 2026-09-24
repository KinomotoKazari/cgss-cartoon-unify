import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sample, integral, particleScale, rotateShape, compareEmitters, stretchedBillboard,
  clampBillboard, particleMeshExtent, trailPointSequence, trailTextureU} from '../web/particle-math.js';

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
test('stretch billboards anchor their forward edge at the simulated head',()=>{
  const quad=stretchedBillboard({m_RenderMode:1,m_LengthScale:10,m_VelocityScale:2,m_Pivot:{x:0,y:5}},4,{x:3,y:4});
  assert.equal(quad.width,50); assert.equal(quad.height,4);
  assert.ok(Math.abs(quad.angle-Math.atan2(4,3))<1e-12);
  assert.ok(Math.abs(quad.offset.x+31)<1e-12);
  assert.ok(Math.abs(quad.offset.y+8)<1e-12);
  assert.deepEqual(stretchedBillboard({m_RenderMode:0},4,{x:3,y:4},.5),{width:4,height:4,angle:.5,offset:{x:0,y:0}});
});
test('billboard 3D size and pivot keep distinct width and height',()=>{
  const quad=stretchedBillboard({m_RenderMode:0,m_Pivot:{x:.1,y:.4}},60,{x:0,y:0},0,160);
  assert.deepEqual(quad,{width:60,height:160,angle:0,offset:{x:6,y:64}});
  const stretch=stretchedBillboard({m_RenderMode:1,m_LengthScale:.5,m_VelocityScale:0},60,{x:0,y:0},0,160);
  assert.equal(stretch.width,30);
  assert.equal(stretch.height,160);
  assert.deepEqual(stretch.offset,{x:-15,y:0});
});

test('stretch billboard length is based on width and follows vertical velocity',()=>{
  const quad=stretchedBillboard({m_RenderMode:1,m_LengthScale:2,m_VelocityScale:1},200,{x:0,y:20},0,40);
  assert.equal(quad.width,420);
  assert.equal(quad.height,40);
  assert.ok(Math.abs(quad.angle-Math.PI/2)<1e-12);
  assert.ok(Math.abs(quad.offset.x)<1e-12);
  assert.ok(Math.abs(quad.offset.y+210)<1e-12);
});
test('trail texture starts at the live head and fades toward old points',()=>{
  assert.equal(trailTextureU(1),0);
  assert.equal(trailTextureU(0),1);
});
test('screen-space particle limit clamps the whole stretched billboard',()=>{
  const quad=clampBillboard({width:1800,height:180,angle:0,offset:{x:90,y:18}},1400,.5);
  assert.deepEqual(quad,{width:700,height:70,angle:0,offset:{x:35,y:7}});
  assert.equal(clampBillboard(quad,1400,10),quad);
});
test('screen-space particle limit measures authored mesh geometry before clamping',()=>{
  const mesh={vertices:[
    {x:-.005,y:-.0015,z:-.005},{x:.005,y:.0015,z:.005}
  ]};
  const geometryExtent=particleMeshExtent(mesh);
  assert.ok(Math.abs(geometryExtent-Math.hypot(.01,.003,.01))<1e-12);
  const leaf={width:25000,height:25000,angle:0,offset:{x:0,y:0}};
  assert.equal(clampBillboard(leaf,1400,.5,geometryExtent),leaf);
  const oversized={width:100000,height:100000,angle:0,offset:{x:100,y:50}};
  const clamped=clampBillboard(oversized,1400,.5,geometryExtent);
  assert.ok(Math.abs(Math.max(clamped.width,clamped.height)*geometryExtent-700)<1e-9);
  assert.ok(clamped.offset.x<100 && clamped.offset.y<50);
});
test('particle trails wait for a committed segment before attaching the live head',()=>{
  const origin={age:0,position:{x:0,y:0,z:0}};
  const head={age:.6,position:{x:11,y:0,z:0}};
  assert.deepEqual(trailPointSequence([origin],head),[]);
  const committed={age:.5,position:{x:10,y:0,z:0}};
  assert.deepEqual(trailPointSequence([origin,committed],head),[origin,committed,head]);
});
