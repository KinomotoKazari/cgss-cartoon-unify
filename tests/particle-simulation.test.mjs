import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ParticleSimulation,noiseOffset} from '../web/particle-simulation.js';
import {integral} from '../web/particle-math.js';

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
test('noise is deterministic and disabled modules contribute no offset',()=>{
  const module={enabled:true,strength:constant(.15),frequency:.84,octaves:1,octaveMultiplier:.5,octaveScale:2,scrollSpeed:constant(.1),positionAmount:constant(1)};
  const p={x:1,y:2,z:3};
  assert.deepEqual(noiseOffset(module,p,2,10,127),noiseOffset(module,p,2,10,127));
  assert.notDeepEqual(noiseOffset(module,p,2,10,127),noiseOffset(module,p,3,10,127));
  assert.deepEqual(noiseOffset({enabled:false},p,2,10,127),{x:0,y:0,z:0});
  assert.equal(integral(constant(.5),0,2,10,true),1);
});
