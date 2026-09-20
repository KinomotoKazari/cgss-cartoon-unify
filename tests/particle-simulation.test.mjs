import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ParticleSimulation,noiseEffects,noiseOffset} from '../web/particle-simulation.js';
import {integral} from '../web/particle-math.js';
import {motionHooks} from '../web/particle-motion.js';

const constant=scalar=>({minMaxState:0,scalar,minScalar:999});
function system(rate=2) {
  return {randomSeed:127,autoRandomSeed:false,lengthInSec:2,looping:true,simulationSpeed:1,
    InitialModule:{startLifetime:constant(1),maxNumParticles:100},
    EmissionModule:{rateOverTime:constant(rate)}};
}
test('zero emission does not invent particles and constant lifetime ignores inactive minimum',()=>{
  const empty=new ParticleSimulation(system(0)); empty.advance(5); assert.equal(empty.particles.length,0);
  const sim=new ParticleSimulation(system());sim.advance(1);
  assert.equal(sim.particles.length,2);assert.equal(sim.particles[0].lifetime,1);
  const first=sim.particles[0].seed;sim.advance(1);
  assert.equal(sim.particles.length,2);assert.ok(sim.particles.every(p=>p.seed!==first));
});
test('authored seed and fixed ticks are independent of frame partitioning',()=>{
  const a=new ParticleSimulation(system(),7), b=new ParticleSimulation(system(),99);
  a.advance(3);for(let i=0;i<90;i++) b.advance(1/30);
  assert.deepEqual(a.particles,b.particles);
  const changed=system();changed.randomSeed=144;const c=new ParticleSimulation(changed);c.advance(3);
  assert.notDeepEqual(a.particles,c.particles);
});
test('prewarm performs a loop and emission respects delay and capacity',()=>{
  const data=system();data.prewarm=true;
  const sim=new ParticleSimulation(data);assert.ok(Math.abs(sim.time-2)<1e-8);assert.equal(sim.particles.length,2);
  const limited=system(20);limited.startDelay=constant(1);limited.InitialModule.maxNumParticles=1;
  const b=new ParticleSimulation(limited);b.advance(0.5);assert.equal(b.particles.length,0);
  b.advance(1);assert.equal(b.particles.length,1);
});
test('bursts use authored time, repeat interval, cycle count, and loop',()=>{
  const data=system(0);
  data.InitialModule.startLifetime=constant(20);
  data.EmissionModule.m_Bursts=[{time:0,countCurve:constant(2),cycleCount:2,
    repeatInterval:.5,probability:1}];
  const sim=new ParticleSimulation(data);
  sim.advance(2.1);
  assert.deepEqual(sim.particles.map(p=>p.birth),[0,0,.5,.5,2,2]);
  const delayed=system(0);
  delayed.startDelay=constant(1);
  delayed.looping=false;
  delayed.InitialModule.startLifetime=constant(10);
  delayed.EmissionModule.m_Bursts=[{time:.5,countCurve:constant(1),cycleCount:0,
    repeatInterval:.5,probability:1}];
  const delayedSim=new ParticleSimulation(delayed);
  delayedSim.advance(4);
  assert.deepEqual(delayedSim.particles.map(p=>p.birth),[1.5,2,2.5]);
});
test('burst probability and prewarm remain deterministic across frame partitions',()=>{
  const data=system(0);
  data.prewarm=true;
  data.InitialModule.startLifetime=constant(10);
  data.EmissionModule.m_Bursts=[{time:.25,countCurve:constant(1),cycleCount:0,
    repeatInterval:.5,probability:.5}];
  const a=new ParticleSimulation(data), b=new ParticleSimulation(data);
  a.advance(3);
  for(let i=0;i<180;i++) b.advance(1/60);
  assert.deepEqual(a.particles,b.particles);
  const disabled=system(0);
  disabled.EmissionModule.enabled=false;
  disabled.EmissionModule.m_Bursts=[{time:0,countCurve:constant(4),probability:1}];
  const c=new ParticleSimulation(disabled);
  c.advance(1);
  assert.equal(c.particles.length,0);
});
test('noise is deterministic and disabled modules contribute no offset',()=>{
  const module={enabled:true,strength:constant(.15),frequency:.84,octaves:1,octaveMultiplier:.5,octaveScale:2,scrollSpeed:constant(.1),positionAmount:constant(1)};
  const p={x:1,y:2,z:3};
  assert.deepEqual(noiseOffset(module,p,2,10,127),noiseOffset(module,p,2,10,127));
  assert.notDeepEqual(noiseOffset(module,p,2,10,127),noiseOffset(module,p,3,10,127));
  assert.deepEqual(noiseOffset({enabled:false},p,2,10,127),{x:0,y:0,z:0});
  assert.equal(integral(constant(.5),0,2,10,true),1);
});
test('noise size and rotation work without position noise and remain tick-stable',()=>{
  const module={enabled:true,strength:constant(1),frequency:.8,octaves:1,octaveMultiplier:.5,
    octaveScale:2,scrollSpeed:constant(.2),positionAmount:constant(0),sizeAmount:constant(1),
    rotationAmount:constant(90)};
  const effect=noiseEffects(module,{x:1,y:2,z:3},1,10,127);
  assert.deepEqual(effect.offset,{x:0,y:0,z:0});
  assert.notEqual(effect.sizeScale,1);
  assert.notEqual(effect.angularVelocity,0);
  assert.deepEqual(noiseEffects(module,{x:1,y:2,z:3},1,10,127),effect);
  assert.deepEqual(noiseEffects({enabled:false},{x:1,y:2,z:3},1,10,127),
    {offset:{x:0,y:0,z:0},sizeScale:1,angularVelocity:0});
  const data=system(2);
  data.InitialModule.startSpeed=constant(0);
  data.InitialModule.startLifetime=constant(10);
  data.ShapeModule={enabled:false};
  data.NoiseModule=module;
  const a=new ParticleSimulation(data,1,motionHooks(data));
  const b=new ParticleSimulation(data,1,motionHooks(data));
  a.advance(2);
  for(let i=0;i<120;i++) b.advance(1/60);
  assert.deepEqual(a.particles.map(p=>p.motion.noiseRotation),b.particles.map(p=>p.motion.noiseRotation));
  assert.ok(a.particles.some(p=>p.motion.noiseRotation!==0));
});
test('noise size is not amplified by displacement damping at low frequency',()=>{
  const module={enabled:true,strength:constant(1),frequency:.5,damping:true,octaves:1,
    octaveMultiplier:.5,octaveScale:2,scrollSpeed:constant(.5),
    positionAmount:constant(1),sizeAmount:constant(1),rotationAmount:constant(0)};
  const point={x:1,y:2,z:3};
  const damped=noiseEffects(module,point,2,10,127);
  const plain=noiseEffects({...module,damping:false},point,2,10,127);
  assert.equal(damped.sizeScale,plain.sizeScale);
  assert.notDeepEqual(damped.offset,plain.offset);
  assert.ok(Number.isFinite(damped.sizeScale));
});
