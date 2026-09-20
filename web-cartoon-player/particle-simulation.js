import {sample} from './particle-math.js';

const EPSILON = 1e-9;

export function randomSequence(seed) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

// Fixed simulation ticks keep birth scheduling independent of the browser frame rate.
export class ParticleSimulation {
  constructor(system, automaticSeed = 1, hooks = {}) {
    this.system = system;
    this.hooks = hooks;
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
    this.particles = this.particles.filter(p => p.birth + p.lifetime > birth + EPSILON);
    if (this.particles.length >= (initial.maxNumParticles ?? 1000)) return;
    const lifetime = sample(initial.startLifetime, this.random(), phase);
    if (!(lifetime > 0)) return;
    const particle = {birth, lifetime, phase, seed: Math.floor(this.random() * 4294967296)};
    this.hooks.initialize?.(particle);
    this.particles.push(particle);
  }

  emitBursts(start, end, duration) {
    const bursts = this.system.EmissionModule?.m_Bursts || [];
    if (!bursts.length) return;
    const relativeStart = start - this.delay, relativeEnd = end - this.delay;
    if (relativeEnd <= 0) return;
    const firstCycle = Math.max(0, Math.floor(Math.max(0, relativeStart) / duration));
    const lastCycle = Math.floor((relativeEnd - EPSILON) / duration);
    for (let cycle = firstCycle; cycle <= lastCycle; cycle++) {
      if (!this.system.looping && cycle > 0) break;
      for (const burst of bursts) {
        const initialTime = burst.time ?? 0;
        if (initialTime < 0 || initialTime >= duration) continue;
        const interval = burst.repeatInterval || 0;
        const available = interval > 0 ? Math.ceil((duration - initialTime) / interval) : 1;
        const repeats = burst.cycleCount > 0 ? Math.min(available, burst.cycleCount) : available;
        for (let repeat = 0; repeat < repeats; repeat++) {
          const withinCycle = initialTime + repeat * interval;
          const eventTime = cycle * duration + withinCycle;
          if (eventTime < relativeStart - EPSILON || eventTime >= relativeEnd - EPSILON) continue;
          const probability = burst.probability ?? 1;
          if (probability <= 0 || (probability < 1 && this.random() >= probability)) continue;
          const phase = withinCycle / duration;
          const amount = Math.max(0, sample(burst.countCurve, this.random(), phase));
          const count = Math.floor(amount) + (this.random() < amount % 1 ? 1 : 0);
          for (let i = 0; i < count; i++) this.spawn(this.delay + eventTime, phase);
        }
      }
    }
  }

  advance(delta, prewarm = false) {
    this.pending += Math.max(0,delta) * (prewarm ? 1 : (this.system.simulationSpeed ?? 1));
    const step = 1 / 60;
    const duration = Math.max(step, this.system.lengthInSec || step);
    while (this.pending + EPSILON >= step) {
      const start = this.time;
      const end = start + step;
      const activeTime = start - this.delay;
      if (this.system.EmissionModule?.enabled !== false && activeTime >= 0 && (this.system.looping || activeTime < duration)) {
        const cycle = Math.floor(activeTime / duration);
        const phase = (activeTime % duration) / duration;
        if (cycle !== this.cycle) {
          this.cycle = cycle;
          this.rateRandom = this.random();
        }
        const rate = Math.max(0, sample(this.system.EmissionModule.rateOverTime, this.rateRandom, phase));
        const previous = this.credit;
        this.credit += rate * step;
        const births = Math.floor(this.credit + EPSILON);
        for (let i = 0; i < births; i++) this.spawn(start + (1 - previous + i) / rate, phase);
        this.credit = Math.max(0, this.credit - births);
      }
      if (this.system.EmissionModule?.enabled !== false) this.emitBursts(start, end, duration);
      for (const particle of this.particles) {
        const until = Math.min(end,particle.birth+particle.lifetime);
        const delta = until-Math.max(start,particle.birth);
        if (delta > 0) this.hooks.step?.(particle,delta,until-particle.birth);
      }
      this.time = end;
      this.particles = this.particles.filter(p => p.birth + p.lifetime > this.time + EPSILON);
      this.pending -= step;
    }
  }
}

// Smooth deterministic potential and gradient for a curl-like position field.
// This is not Unity's native Perlin noise kernel.
function noiseSample(x, y, z, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const smooth = t => t * t * t * (t * (t * 6 - 15) + 10);
  const slope = t => 30 * t * t * (t - 1) * (t - 1);
  const u = smooth(x - ix), v = smooth(y - iy), w = smooth(z - iz);
  const du = slope(x - ix), dv = slope(y - iy), dw = slope(z - iz);
  let value = 0, dx = 0, dy = 0, dz = 0;
  for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) for (let c = 0; c < 2; c++) {
    let hash = Math.imul(ix + a, 374761393) ^ Math.imul(iy + b, 668265263)
      ^ Math.imul(iz + c, 1274126177) ^ seed;
    hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
    hash ^= hash >>> 16;
    const corner = (hash >>> 0) / 4294967296 * 2 - 1;
    const wx = a ? u : 1 - u, wy = b ? v : 1 - v, wz = c ? w : 1 - w;
    value += corner * wx * wy * wz;
    dx += corner * (a ? du : -du) * wy * wz;
    dy += corner * wx * (b ? dv : -dv) * wz;
    dz += corner * wx * wy * (c ? dw : -dw);
  }
  return {value, dx, dy, dz};
}

export function noiseEffects(module, position, age, lifetime, seed) {
  const offset = {x:0, y:0, z:0};
  if (!module?.enabled) return {offset, sizeScale:1, angularVelocity:0};
  const t = age / lifetime;
  const random = randomSequence(seed);
  const scroll = sample(module.scrollSpeed, random(), t) * age;
  const baseFrequency = Math.max(0.0001, module.frequency || 0.0001);
  const field = {x:0, y:0, z:0};
  const curl = {x:0, y:0, z:0};
  let sizeField = 0;
  const values = {x:0, y:0, z:0};
  let amplitude = 1, frequency = baseFrequency;
  for (let octave = 0; octave < Math.max(1, module.octaves); octave++) {
    const potentials = [0, 1, 2].map(index => noiseSample(
      position.x * frequency + scroll, position.y * frequency, position.z * frequency,
      seed + index * 1013 + octave * 7919));
    for (const [index, axis] of ['x', 'y', 'z'].entries()) values[axis] += potentials[index].value * amplitude;
    // Curl is the spatial derivative of three scalar potentials. Damping
    // removes its frequency factor, rather than dividing raw noise by frequency.
    const gain = amplitude * (module.damping ? 1 : frequency);
    curl.x += (potentials[2].dy - potentials[1].dz) * gain;
    curl.y += (potentials[0].dz - potentials[2].dx) * gain;
    curl.z += (potentials[1].dx - potentials[0].dy) * gain;
    amplitude *= module.octaveMultiplier;
    frequency *= module.octaveScale;
  }
  for (const axis of ['x', 'y', 'z']) {
    let value = values[axis];
    if (module.remapEnabled) value = sample(module[axis === 'x' ? 'remap' : `remap${axis.toUpperCase()}`], random(), (value + 1) / 2) * 2 - 1;
    const strength = sample(module.separateAxes && axis !== 'x' ? module[`strength${axis.toUpperCase()}`] : module.strength, random(), t);
    const weighted = value * strength;
    field[axis] = weighted / (module.damping ? baseFrequency : 1);
    if (axis === 'x') sizeField = weighted;
    const positionAmount = sample(module.positionAmount, random(), t);
    offset[axis] = positionAmount === 0 ? 0 : curl[axis] * strength * positionAmount;
  }
  // Keep size modulation separate from the frequency-dependent displacement gain.
  // The field and channel mapping are still an approximation of Unity's native noise.
  const sizeRandom = randomSequence(seed ^ 0x537a1e)();
  const rotationRandom = randomSequence(seed ^ 0x726f7461)();
  const sizeScale = Math.max(0, 1 + sizeField * sample(module.sizeAmount, sizeRandom, t));
  const angularVelocity = field.z * sample(module.rotationAmount, rotationRandom, t) * Math.PI / 180;
  return {offset, sizeScale, angularVelocity};
}

export function noiseOffset(module, position, age, lifetime, seed) {
  return noiseEffects(module, position, age, lifetime, seed).offset;
}
