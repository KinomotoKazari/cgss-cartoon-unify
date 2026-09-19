// Unity curve tangents are derivatives with respect to normalized time.
export function curveValue(curve, time) {
  const keys = curve?.m_Curve || [];
  if (!keys.length) return 0;
  if (time <= keys[0].time) return keys[0].value;
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1], b = keys[i];
    if (time > b.time) continue;
    const dt = b.time - a.time, t = (time - a.time) / dt;
    if (!Number.isFinite(a.outSlope) || !Number.isFinite(b.inSlope)) return a.value;
    return (2*t**3-3*t*t+1)*a.value + (t**3-2*t*t+t)*dt*a.outSlope
      + (-2*t**3+3*t*t)*b.value + (t**3-t*t)*dt*b.inSlope;
  }
  return keys.at(-1).value;
}

export function sample(curve, random = 0.5, time = 0) {
  if (!curve) return 0;
  const high = curve.scalar ?? 0, low = curve.minScalar ?? high;
  switch (curve.minMaxState) {
    case 1: return high * curveValue(curve.maxCurve, time);
    case 2: return high * (curveValue(curve.minCurve, time) * (1-random) + curveValue(curve.maxCurve, time) * random);
    case 3: return low + (high-low)*random;
    default: return high;
  }
}

// Integrate in normalized lifetime. Split at key boundaries for sharp changes.
export function integral(curve, random, age, lifetime, acceleration = false) {
  const end = age / lifetime;
  const boundaries = [0, ...[curve?.maxCurve, curve?.minCurve].flatMap(c => (c?.m_Curve || []).map(k => k.time)).filter(t => t > 0 && t < end), end].sort((a,b)=>a-b);
  let total = 0;
  for (let i=1; i<boundaries.length; i++) {
    const a=boundaries[i-1], b=boundaries[i];
    const value=t=>sample(curve,random,t)*(acceleration ? age-t*lifetime : 1);
    total += (b-a)/6 * (value(a) + 4*value((a+b)/2) + value(b));
  }
  return total*lifetime;
}

export function particleScale(transforms, mode) {
  if (mode === 2) return {x:1,y:1};
  return (mode === 1 ? transforms.slice(0,1) : transforms).reduce((s,t)=>({x:s.x*Math.abs(t.data.m_LocalScale.x),y:s.y*Math.abs(t.data.m_LocalScale.y)}),{x:1,y:1});
}

// Unity render mode 1 is Stretch Billboard. Its long axis follows motion while
// the authored rotation rolls the quad around that axis.
export function stretchedBillboard(renderer, size, velocity, rotation = 0, sizeY = size) {
  if (renderer?.m_RenderMode !== 1) {
    const pivot = renderer?.m_Pivot || {}, x=(pivot.x || 0)*size, y=(pivot.y || 0)*sizeY;
    const c=Math.cos(rotation), s=Math.sin(rotation);
    return {width:size, height:sizeY, angle:rotation, offset:{x:c*x-s*y,y:s*x+c*y}};
  }
  const vx = velocity?.x || 0, vy = velocity?.y || 0, speed = Math.hypot(vx, vy);
  const length = Math.max(0, sizeY * (renderer.m_LengthScale ?? 1) + speed * (renderer.m_VelocityScale ?? 0));
  if (!(speed > 1e-8)) return {width:size, height:length, angle:rotation, offset:{x:0,y:0}};
  const pivot = renderer.m_Pivot || {}, forward = {x:vx / speed, y:vy / speed};
  // m_Pivot is expressed in particle-size units. Its Y component moves the
  // stretched quad along its direction of motion.
  return {width:size, height:length, angle:Math.atan2(vy, vx) + Math.PI / 2 + rotation,
    offset:{x:(pivot.x || 0) * size * forward.y + (pivot.y || 0) * size * forward.x,
      y:-(pivot.x || 0) * size * forward.x + (pivot.y || 0) * size * forward.y}};
}

// SortingLayerID is an identifier, not a sortable layer index.
export function compareEmitters(a, b) {
  return (a.renderer.m_SortingLayer ?? 0) - (b.renderer.m_SortingLayer ?? 0)
    || (a.renderer.m_SortingOrder ?? 0) - (b.renderer.m_SortingOrder ?? 0)
    || a.serial - b.serial;
}

// Shape Euler angles use Unity's Z-X-Y order, in degrees.
export function rotateShape(p, angles = {}) {
  let {x,y,z}=p;
  for (const axis of ['z','x','y']) {
    const a=(angles[axis] || 0)*Math.PI/180, c=Math.cos(a), s=Math.sin(a);
    if(axis==='z') [x,y]=[c*x-s*y,s*x+c*y];
    if(axis==='x') [y,z]=[c*y-s*z,s*y+c*z];
    if(axis==='y') [x,z]=[c*x+s*z,-s*x+c*z];
  }
  return {x,y,z};
}
