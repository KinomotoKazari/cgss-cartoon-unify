import {sample, rotateShape} from './particle-math.js';
import {randomSequence} from './particle-simulation.js';

const axes = ['x','y','z'];

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
  if (shape.type === 4) {
    const inner = 1-(shape.radiusThickness ?? 1);
    const radius = Math.sqrt(inner*inner+(1-inner*inner)*random());
    const angle = random()*(shape.arc?.value ?? 360)*Math.PI/180;
    const spread = Math.tan(shape.angle*Math.PI/180)*radius;
    position = {x:Math.cos(angle)*radius*(shape.radius?.value ?? 1),y:Math.sin(angle)*radius*(shape.radius?.value ?? 1),z:0};
    const length = Math.hypot(spread,1);
    direction = {x:Math.cos(angle)*spread/length,y:Math.sin(angle)*spread/length,z:1/length};
  } else if (shape.type === 5) {
    position = {x:random()-.5,y:random()-.5,z:random()-.5};
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
