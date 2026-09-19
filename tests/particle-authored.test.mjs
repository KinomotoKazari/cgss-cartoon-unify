import {test} from 'node:test';
import assert from 'node:assert/strict';
import {sampleShape,motionHooks,transformPoint} from '../web/particle-motion.js';
import {ParticleSimulation,randomSequence} from '../web/particle-simulation.js';
import {sampleColor,shadePixels} from '../web/particle-color.js';

const constant = scalar=>({minMaxState:0,scalar});

test('prefab quaternion rotation preserves depth until projection',()=>{
  const result=transformPoint({x:0,y:0,z:2},{data:{m_LocalScale:{x:1,y:1,z:1},
    m_LocalRotation:{x:0,y:Math.SQRT1_2,z:0,w:Math.SQRT1_2},m_LocalPosition:{x:3,y:4,z:5}}});
  assert.ok(Math.abs(result.x-5)<1e-12);assert.equal(result.y,4);assert.ok(Math.abs(result.z-5)<1e-12);
});

test('cone births occupy the base disk, with outward unit directions',()=>{
  const random = randomSequence(7);
  const shape = {enabled:true,type:4,angle:30,radius:{value:2},arc:{value:360},radiusThickness:1,
    length:999,m_Position:{x:0,y:0,z:0},m_Rotation:{},m_Scale:{x:1,y:1,z:1}};
  let radiusSquared = 0;
  for(let i=0;i<2000;i++) {
    const {position:p,direction:d}=sampleShape(shape,random);
    assert.equal(p.z,0); assert.ok(Math.hypot(p.x,p.y)<=2);
    assert.ok(p.x*d.x+p.y*d.y>=0); assert.ok(Math.abs(Math.hypot(d.x,d.y,d.z)-1)<1e-12);
    radiusSquared+=p.x*p.x+p.y*p.y;
  }
  assert.ok(Math.abs(radiusSquared/2000-2)<.1);
});

test('box shell emits on a transformed box surface',()=>{
  const shape={enabled:true,type:10,m_Position:{x:3,y:4,z:5},m_Rotation:{},m_Scale:{x:10,y:20,z:30}};
  const sample=sampleShape(shape,()=>0);
  assert.deepEqual(sample.position,{x:-2,y:-6,z:-10});
  assert.deepEqual(sample.direction,{x:0,y:0,z:1});
});

test('sphere, circle, donut, rectangle, and empty renderer shapes have stable samples',()=>{
  const base={enabled:true,m_Position:{x:0,y:0,z:0},m_Rotation:{},m_Scale:{x:1,y:1,z:1},radius:{value:2},radiusThickness:1,arc:{value:360}};
  assert.ok(Math.hypot(...Object.values(sampleShape({...base,type:0},()=>.5).position))<=2);
  assert.ok(Math.abs(sampleShape({...base,type:12},()=>.5).position.y)<1e-12);
  assert.ok(Number.isFinite(sampleShape({...base,type:15,donutRadius:.2},()=>.5).position.x));
  assert.deepEqual(sampleShape({...base,type:16},()=>.5).position,{x:0,y:0,z:0});
  assert.deepEqual(sampleShape({...base,type:8,m_MeshRenderer:{m_PathID:'0'}},()=>.5).position,{x:0,y:0,z:0});
});

test('force integrates acceleration and speedModifier scales initial velocity too',()=>{
  const system={ShapeModule:{enabled:false},InitialModule:{startSpeed:constant(2)},
    ForceModule:{enabled:true,x:constant(2),y:constant(0),z:constant(0)},
    VelocityModule:{enabled:true,speedModifier:constant(3)}};
  const hooks=motionHooks(system),particle={seed:4,phase:0,lifetime:10};
  hooks.initialize(particle);
  for(let i=0;i<60;i++) hooks.step(particle,1/60,(i+1)/60);
  assert.ok(Math.abs(particle.motion.position.x-3)<1e-10);
  assert.ok(Math.abs(particle.motion.position.z-6)<1e-10);
});

test('per-tick random force and prewarm do not depend on display frame rate',()=>{
  const system={randomSeed:5,lengthInSec:2,looping:true,prewarm:true,simulationSpeed:1,
    ShapeModule:{enabled:false},InitialModule:{startLifetime:constant(10),startSpeed:constant(0)},
    EmissionModule:{rateOverTime:constant(2)},ForceModule:{enabled:true,randomizePerFrame:true,
      x:{minMaxState:3,minScalar:-1,scalar:1},y:constant(0),z:constant(0)}};
  const a=new ParticleSimulation(system,1,motionHooks(system)),b=new ParticleSimulation(system,1,motionHooks(system));
  a.advance(2);for(let i=0;i<120;i++) b.advance(1/60);
  assert.deepEqual(a.particles.map(p=>p.motion.position),b.particles.map(p=>p.motion.position));
  assert.ok(a.particles.some(p=>p.motion.position.x!==0));
});

test('RandomColor ignores inactive keys and fixed gradients keep their stops',()=>{
  const gray={r:.81,g:.81,b:.81,a:1},red={r:1,g:0,b:0,a:0};
  const gradient={m_Mode:1,m_NumColorKeys:2,m_NumAlphaKeys:2,key0:gray,key1:gray,key7:red,
    ctime0:0,ctime1:65535,atime0:0,atime1:65535};
  assert.deepEqual(sampleColor({minMaxState:4,maxGradient:gradient,minColor:red},.3,0),gray);
  const two={minMaxState:3,minGradient:gradient,maxGradient:{...gradient,key0:red,key1:red}};
  assert.deepEqual(sampleColor(two,1,.8),red);
});

test('Standard shader doubles and saturates RGBA before blending',()=>{
  const target=new Uint8ClampedArray(4);
  shadePixels(new Uint8ClampedArray([200,100,50,200]),target,{r:1,g:.5,b:1,a:.8},2);
  assert.deepEqual([...target],[255,100,100,255]);
});
