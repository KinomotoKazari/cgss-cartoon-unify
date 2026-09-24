import {sample, rotateShape} from './particle-math.js';
import {randomSequence, noiseEffects} from './particle-simulation.js';

const axes = ['x','y','z'];
const orbitalKeys = ['orbitalX','orbitalY','orbitalZ','orbitalOffsetX','orbitalOffsetY','orbitalOffsetZ','radial'];

const curveActive = curve => {
  if (!curve) return false;
  if (curve.minMaxState === 0) return !!curve.scalar;
  if (curve.minMaxState === 3) return !!curve.scalar || !!curve.minScalar;
  return !!curve.scalar && [curve.maxCurve,curve.minCurve]
    .some(part => part?.m_Curve?.some(key => !!key.value));
};

// Orbital speed is tangential to the radius from the authored offset.
// The integration below is a deterministic approximation of Unity's native
// particle update, not a claim of an identical random sequence or integrator.
export function orbitalVelocity(position, center, angular, radialSpeed = 0) {
  const x=position.x-center.x, y=position.y-center.y, z=position.z-center.z;
  const length=Math.hypot(x,y,z), radial=length>1e-9 ? radialSpeed/length : 0;
  return {x:angular.y*z-angular.z*y+radial*x,
    y:angular.z*x-angular.x*z+radial*y,
    z:angular.x*y-angular.y*x+radial*z};
}

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
const boxEdge = random => {
  const edge = Math.min(11,Math.floor(random()*12)), along=random()-.5;
  if (edge<4) return {x:along,y:edge&1 ? .5 : -.5,z:edge&2 ? .5 : -.5};
  if (edge<8) return {x:edge&1 ? .5 : -.5,y:along,z:edge&2 ? .5 : -.5};
  return {x:edge&1 ? .5 : -.5,y:edge&2 ? .5 : -.5,z:along};
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

// Transform a direction through the same hierarchy as a particle position,
// without applying translation.
export function transformVector(vector, transform) {
  const d = transform.data, q = d.m_LocalRotation;
  const x=vector.x*d.m_LocalScale.x, y=vector.y*d.m_LocalScale.y, z=(vector.z ?? 0)*d.m_LocalScale.z;
  const tx=2*(q.y*z-q.z*y), ty=2*(q.z*x-q.x*z), tz=2*(q.x*y-q.y*x);
  return {x:x+q.w*tx+q.y*tz-q.z*ty,
    y:y+q.w*ty+q.z*tx-q.x*tz,
    z:z+q.w*tz+q.x*ty-q.y*tx};
}

// Return the instantaneous velocity used by rendering. VelocityModule and its
// speed modifier must affect Stretch Billboard orientation as well as motion.
export function effectiveVelocity(system, particle, age) {
  const state=particle.motion, velocity=system.VelocityModule;
  const t=Math.max(0,Math.min(1,age/particle.lifetime));
  const modifier=velocity?.enabled && velocity.speedModifier
    ? sample(velocity.speedModifier,state.modifier,t) : 1;
  const local={}, world={};
  for(const [i,axis] of axes.entries()) {
    const extra=velocity?.enabled ? sample(velocity[axis],state.weights[i],t) : 0;
    local[axis]=(state.velocity[axis]+state.force[axis]+(velocity?.inWorldSpace?0:extra))*modifier
      +(state.orbital?.[axis] || 0);
    world[axis]=(state.forceWorld[axis]+(velocity?.inWorldSpace?extra:0))*modifier;
  }
  return {local,world};
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
  } else if (shape.type === 8) {
    // ConeVolume, not MeshRenderer. Sample the frustum volume so particles
    // begin throughout its authored length instead of on one narrow path.
    const baseRadius = Math.max(0,scalar(shape.radius));
    const height = Math.max(0,shape.length || 0);
    const slope = Math.tan(shape.angle*Math.PI/180);
    const endRadius = Math.max(0,baseRadius+slope*height);
    const sampledRadius = Math.cbrt(baseRadius**3+(endRadius**3-baseRadius**3)*random());
    const z = Math.abs(slope)>1e-8 ? (sampledRadius-baseRadius)/slope : height*random();
    const theta = angle(shape,random), radial = sampledRadius*Math.sqrt(random());
    position = {x:Math.cos(theta)*radial,y:Math.sin(theta)*radial,z};
    const spread = sampledRadius>1e-8 ? slope*radial/sampledRadius : 0;
    const norm = Math.hypot(spread,1);
    direction = {x:Math.cos(theta)*spread/norm,y:Math.sin(theta)*spread/norm,z:1/norm};
  } else if (shape.type === 5) {
    position = {x:random()-.5,y:random()-.5,z:random()-.5};
  } else if (shape.type === 10) {
    const theta=angle(shape,random), radius=diskRadius(shape,random);
    position={x:Math.cos(theta)*radius,y:Math.sin(theta)*radius,z:0};
    direction={x:Math.cos(theta),y:Math.sin(theta),z:0};
  } else if (shape.type === 11) {
    const theta=angle(shape,random), radius=scalar(shape.radius);
    position={x:Math.cos(theta)*radius,y:Math.sin(theta)*radius,z:0};
    direction={x:Math.cos(theta),y:Math.sin(theta),z:0};
  } else if (shape.type === 12) {
    position={x:random()-.5,y:0,z:0};
  } else if (shape.type === 15) {
    position = boxShell(random);
  } else if (shape.type === 16) {
    position = boxEdge(random);
  } else if (shape.type === 17) {
    const theta=random()*Math.PI*2, phi=random()*Math.PI*2;
    const major=scalar(shape.radius), minor=major*(shape.donutRadius ?? .2)*Math.sqrt(random());
    position={x:(major+minor*Math.cos(phi))*Math.cos(theta),y:(major+minor*Math.cos(phi))*Math.sin(theta),z:minor*Math.sin(phi)};
  } else if (shape.type === 18) {
    // The sampled bundles provide no Sprite or SpriteRenderer reference. Their
    // authored scale therefore defines the available rectangular emission area.
    position={x:random()-.5,y:random()-.5,z:0};
  } else {
    throw new Error(`Unsupported particle shape ${shape.type}`);
  }
  for (const axis of axes) {
    position[axis] *= shape.m_Scale[axis];
    // A mirrored Shape axis also mirrors its emission direction. In
    // particular, a negative Z scale reverses a cone's forward direction.
    if (shape.m_Scale[axis] < 0) direction[axis] *= -1;
  }
  position = rotateShape(position,shape.m_Rotation);
  direction = rotateShape(direction,shape.m_Rotation);
  for (const axis of axes) position[axis] += shape.m_Position[axis];
  return {position,direction};
}

// Motion is integrated at simulation ticks, never at browser draw frequency.
// Local and world displacements stay separate until the hierarchy is applied.
export function motionHooks(system) {
  const orbitEnabled = system.VelocityModule?.enabled &&
    ['orbitalX','orbitalY','orbitalZ','radial'].some(key => curveActive(system.VelocityModule[key]));
  const rotationNoise = system.NoiseModule?.enabled &&
    (Math.abs(system.NoiseModule.rotationAmount?.scalar || 0) > 1e-12 ||
      Math.abs(system.NoiseModule.rotationAmount?.minScalar || 0) > 1e-12);
  return {
    initialize(particle) {
      const random = randomSequence(particle.seed);
      const {position,direction} = sampleShape(system.ShapeModule,random);
      const speed = sample(system.InitialModule.startSpeed,random(),particle.phase);
      particle.motion = {position, world:{x:0,y:0,z:0}, velocity:Object.fromEntries(axes.map(a=>[a,direction[a]*speed])),
        force:{x:0,y:0,z:0}, forceWorld:{x:0,y:0,z:0}, orbital:{x:0,y:0,z:0},
        random, weights:axes.map(()=>random()), modifier:random()};
      if (orbitEnabled) particle.motion.orbitWeights=orbitalKeys.map(()=>random());
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
      if (orbitEnabled) {
        // Unity's Space selector applies to linear XYZ. Orbital and radial
        // movement use the particle system's local axes and offset center.
        const weight=key=>state.orbitWeights[orbitalKeys.indexOf(key)];
        const center=Object.fromEntries(axes.map(axis=>[axis,
          sample(velocity[`orbitalOffset${axis.toUpperCase()}`],weight(`orbitalOffset${axis.toUpperCase()}`),t)]));
        const angular=Object.fromEntries(axes.map(axis=>[axis,
          sample(velocity[`orbital${axis.toUpperCase()}`],weight(`orbital${axis.toUpperCase()}`),t)]));
        const radial=sample(velocity.radial,weight('radial'),t);
        const first=orbitalVelocity(state.position,center,angular,radial);
        const midpoint=Object.fromEntries(axes.map(axis=>[axis,state.position[axis]+first[axis]*modifier*delta/2]));
        const second=orbitalVelocity(midpoint,center,angular,radial);
        for (const axis of axes) {
          state.orbital[axis]=second[axis]*modifier;
          state.position[axis]+=state.orbital[axis]*delta;
        }
      }
      if (rotationNoise) {
        state.noiseRotation = (state.noiseRotation || 0) +
          noiseEffects(system.NoiseModule,state.position,age,particle.lifetime,particle.seed).angularVelocity*delta;
      }
      if (particle.trail?.enabled) {
        const points=particle.trail.points, candidate={age,
          position:{...state.position},world:{...state.world}};
        const previous=points.at(-1), threshold=Math.max(0,system.TrailModule.minVertexDistance || 0);
        const distance=previous ? Math.hypot(
          candidate.position.x+candidate.world.x-previous.position.x-previous.world.x,
          candidate.position.y+candidate.world.y-previous.position.y-previous.world.y,
          candidate.position.z+candidate.world.z-previous.position.z-previous.world.z) : Infinity;
        if (!previous || distance>=threshold) points.push(candidate);
        // minVertexDistance controls committed ribbon vertices. Unity still
        // moves the attached trail head every tick between those vertices.
        particle.trail.head=candidate;
      }
    },
    expiresAt(particle) {
      const death=particle.birth+particle.lifetime;
      return particle.trail?.enabled && !system.TrailModule.dieWithParticles
        ? death+particle.trail.lifetime : death;
    },
    initializeTrail(particle) {
      if (!system.TrailModule?.enabled) return;
      const random=randomSequence(particle.seed ^ 0x74726169);
      const enabled=random() < (system.TrailModule.ratio ?? 1);
      // TrailModule lifetime is a multiplier of the owning particle lifetime,
      // rather than an absolute number of seconds.
      let lifetime=Math.max(0,sample(system.TrailModule.lifetime,random(),0))*particle.lifetime;
      if(system.TrailModule.sizeAffectsLifetime) {
        const particleRandom=randomSequence(particle.seed);
        particleRandom();
        lifetime*=Math.max(0,sample(system.InitialModule.startSize,particleRandom(),particle.phase));
      }
      const origin={age:0,position:{...particle.motion.position},world:{...particle.motion.world}};
      particle.trail={enabled,lifetime,points:enabled ? [origin] : [],head:enabled ? origin : null};
    }
  };
}
