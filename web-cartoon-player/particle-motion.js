import {sample, rotateShape} from './particle-math.js';
import {randomSequence} from './particle-simulation.js';

const axes = ['x','y','z'];

const scalar = (curve, fallback = 1) => curve?.value ?? fallback;
const diskRadius = (shape, random) => {
  const inner = 1-(shape.radiusThickness ?? 1), outer = scalar(shape.radius);
  return outer*Math.sqrt(inner*inner+(1-inner*inner)*random());
};
const angle = (shape, random) => random()*(shape.arc?.value ?? 360)*Math.PI/180;
const boxShell = random => {
  const face = Math.min(5,Math.floor(random()*6)), a=random()-.5, b=random()-.5;
  if (face===0) return {x:-.5,y:a,z:b};
  if (face===1) return {x:.5,y:a,z:b};
  if (face===2) return {x:a,y:-.5,z:b};
  if (face===3) return {x:a,y:.5,z:b};
  if (face===4) return {x:a,y:b,z:-.5};
  return {x:a,y:b,z:.5};
};

// Retain depth while composing prefab transforms, even for the orthographic preview.
export function transformPoint(point, transform) {
  const d = transform.data, q = d.m_LocalRotation;
  const x=point.x*d.m_LocalScale.x, y=point.y*d.m_LocalScale.y, z=(point.z ?? 0)*d.m_LocalScale.z;
  const tx=2*(q.y*z-q.z*y), ty=2*(q.z*x-q.x*z), tz=2*(q.x*y-q.y*x);
  return {x:x+q.w*tx+q.y*tz-q.z*ty+d.m_LocalPosition.x,
    y:y+q.w*ty+q.z*tx-q.x*tz+d.m_LocalPosition.y,
    z:z+q.w*tz+q.x*ty-q.y*tx+d.m_LocalPosition.z};
}

// Cone emits from its base disk. Its length is only used by cone-volume shapes.
export function sampleShape(shape, random) {
  let position = {x:0,y:0,z:0}, direction = {x:0,y:0,z:1};
  if (!shape?.enabled) return {position,direction};
  if (shape.type === 0 || shape.type === 2) {
    const z = shape.type===2 ? random() : random()*2-1, phi=random()*Math.PI*2;
    const radial=Math.sqrt(1-z*z), inner=1-(shape.radiusThickness ?? 1);
    const radius=scalar(shape.radius)*Math.cbrt(inner**3+(1-inner**3)*random());
    position={x:Math.cos(phi)*radial*radius,y:Math.sin(phi)*radial*radius,z:z*radius};
    direction={x:Math.cos(phi)*radial,y:Math.sin(phi)*radial,z};
  } else if (shape.type === 4) {
    const radius = diskRadius(shape,random);
    const theta = angle(shape,random);
    const spread = Math.tan(shape.angle*Math.PI/180)*radius;
    position = {x:Math.cos(theta)*radius,y:Math.sin(theta)*radius,z:0};
    const length = Math.hypot(spread,1);
    direction = {x:Math.cos(theta)*spread/length,y:Math.sin(theta)*spread/length,z:1/length};
  } else if (shape.type === 5) {
    position = {x:random()-.5,y:random()-.5,z:random()-.5};
  } else if (shape.type === 10) {
    position = boxShell(random);
  } else if (shape.type === 12) {
    const theta=angle(shape,random), radius=diskRadius(shape,random);
    position={x:Math.cos(theta)*radius,y:Math.sin(theta)*radius,z:0};
  } else if (shape.type === 15) {
    const theta=random()*Math.PI*2, phi=random()*Math.PI*2;
    const major=scalar(shape.radius), minor=major*(shape.donutRadius ?? .2)*Math.sqrt(random());
    position={x:(major+minor*Math.cos(phi))*Math.cos(theta),y:(major+minor*Math.cos(phi))*Math.sin(theta),z:minor*Math.sin(phi)};
  } else if (shape.type === 16 || shape.type === 17 || shape.type === 18) {
    // The sampled bundles provide no Sprite or SpriteRenderer reference. Their
    // authored scale therefore defines the available rectangular emission area.
    position={x:random()-.5,y:random()-.5,z:0};
  } else if (shape.type === 8 && ['0',0,undefined,null].includes(shape.m_MeshRenderer?.m_PathID)) {
    // Unity falls back to the emitter origin when a MeshRenderer shape has no
    // source renderer. Every observed type-8 system uses this serialized form.
    position={x:0,y:0,z:0};
  } else {
    throw new Error(`Unsupported particle shape ${shape.type}`);
  }
  for (const axis of axes) position[axis] *= shape.m_Scale[axis];
  position = rotateShape(position,shape.m_Rotation);
  direction = rotateShape(direction,shape.m_Rotation);
  for (const axis of axes) position[axis] += shape.m_Position[axis];
  return {position,direction};
}

// Motion is integrated at simulation ticks, never at browser draw frequency.
// Local and world displacements stay separate until the hierarchy is applied.
export function motionHooks(system) {
  return {
    initialize(particle) {
      const random = randomSequence(particle.seed);
      const {position,direction} = sampleShape(system.ShapeModule,random);
      const speed = sample(system.InitialModule.startSpeed,random(),particle.phase);
      particle.motion = {position, world:{x:0,y:0,z:0}, velocity:Object.fromEntries(axes.map(a=>[a,direction[a]*speed])),
        force:{x:0,y:0,z:0}, forceWorld:{x:0,y:0,z:0}, random, weights:axes.map(()=>random()), modifier:random()};
    },
    step(particle, delta, age) {
      const state = particle.motion, force = system.ForceModule, velocity = system.VelocityModule;
      const t = (age-delta/2)/particle.lifetime;
      const modifier = velocity?.enabled && velocity.speedModifier ? sample(velocity.speedModifier,state.modifier,t) : 1;
      for (const [i,axis] of axes.entries()) {
        const acceleration = force?.enabled ? sample(force[axis],force.randomizePerFrame?state.random():state.weights[i],t) : 0;
        const accumulated = force?.inWorldSpace ? state.forceWorld : state.force;
        const extra = velocity?.enabled ? sample(velocity[axis],state.weights[i],t) : 0;
        const halfForce = acceleration*delta/2;
        accumulated[axis] += halfForce;
        state.position[axis] += (state.velocity[axis]+state.force[axis]+(velocity?.inWorldSpace?0:extra))*modifier*delta;
        state.world[axis] += (state.forceWorld[axis]+(velocity?.inWorldSpace?extra:0))*modifier*delta;
        accumulated[axis] += halfForce;
      }
    }
  };
}
