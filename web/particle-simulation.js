import {sample} from './particle-math.js';

export function randomSequence(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Fixed simulation ticks keep emission independent of browser frame rate.
export class ParticleSimulation {
  constructor(system, automaticSeed = 1) {
    this.system = system;
    this.seed = system.autoRandomSeed ? automaticSeed : system.randomSeed;
    this.reset();
  }
  reset() {
    this.random = randomSequence(this.seed ?? 1);
    this.particles = [];
    this.time = 0;
    this.pending = 0;
    this.credit = 0;
    this.cycle = -1;
    this.delay = Math.max(0,sample(this.system.startDelay,this.random()));
    if (this.system.prewarm && this.system.looping) this.advance(this.system.lengthInSec, true);
  }
  spawn(birth, phase) {
    const initial = this.system.InitialModule;
    this.particles = this.particles.filter(p => p.birth+p.lifetime > birth);
    if (this.particles.length >= (initial.maxNumParticles ?? 1000)) return;
    const lifetime = sample(initial.startLifetime,this.random(),phase);
    if (!(lifetime > 0)) return;
    this.particles.push({birth,lifetime,phase,seed:Math.floor(this.random()*4294967296)});
  }
  advance(delta, prewarm = false) {
    this.pending += Math.max(0,delta) * (prewarm ? 1 : (this.system.simulationSpeed ?? 1));
    const step = 1/60, duration = Math.max(step,this.system.lengthInSec || step);
    while (this.pending+1e-10 >= step) {
      const start = this.time, end = start+step;
      const activeTime = start-this.delay;
      if (activeTime >= 0 && (this.system.looping || activeTime < duration)) {
        const cycle = Math.floor(activeTime/duration), phase = (activeTime%duration)/duration;
        if (cycle !== this.cycle) { this.cycle=cycle; this.rateRandom=this.random(); }
        const rate = Math.max(0,sample(this.system.EmissionModule.rateOverTime,this.rateRandom,phase));
        const previous = this.credit;
        this.credit += rate*step;
        const births = Math.floor(this.credit+1e-10);
        for(let i=0;i<births;i++) this.spawn(start+(1-previous+i)/rate,phase);
        this.credit = Math.max(0,this.credit-births);
      }
      this.time=end;
      this.particles=this.particles.filter(p=>p.birth+p.lifetime>this.time);
      this.pending-=step;
    }
  }
}

// Smooth deterministic value noise. This is not Unity's native noise kernel.
function noise(x,y,z,seed) {
  const ix=Math.floor(x), iy=Math.floor(y), iz=Math.floor(z);
  const smooth=t=>t*t*t*(t*(t*6-15)+10);
  const u=smooth(x-ix),v=smooth(y-iy),w=smooth(z-iz);
  let value=0;
  for(let a=0;a<2;a++) for(let b=0;b<2;b++) for(let c=0;c<2;c++) {
    let h=Math.imul(ix+a,374761393)^Math.imul(iy+b,668265263)^Math.imul(iz+c,1274126177)^seed;
    h=Math.imul(h^(h>>>13),1274126177); h^=h>>>16;
    value+=((h>>>0)/4294967296*2-1)*(a?u:1-u)*(b?v:1-v)*(c?w:1-w);
  }
  return value;
}

export function noiseOffset(module, position, age, lifetime, seed) {
  const out={x:0,y:0,z:0};
  if (!module?.enabled) return out;
  const t=age/lifetime, random=randomSequence(seed);
  const scroll=sample(module.scrollSpeed,random(),t)*age;
  const baseFrequency=Math.max(0.0001,module.frequency || 0.0001);
  for(const [index,axis] of ['x','y','z'].entries()) {
    let amplitude=1,frequency=baseFrequency,value=0;
    for(let octave=0;octave<Math.max(1,module.octaves);octave++) {
      value+=noise(position.x*frequency+scroll,position.y*frequency,position.z*frequency,seed+index*1013+octave*7919)*amplitude;
      amplitude*=module.octaveMultiplier; frequency*=module.octaveScale;
    }
    if(module.remapEnabled) value=sample(module[axis==='x'?'remap':`remap${axis.toUpperCase()}`],random(),(value+1)/2)*2-1;
    const strength=sample(module.separateAxes && axis!=='x'?module[`strength${axis.toUpperCase()}`]:module.strength,random(),t);
    out[axis]=value*strength*sample(module.positionAmount,random(),t)/(module.damping?baseFrequency:1);
  }
  return out;
}
