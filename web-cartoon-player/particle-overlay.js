/* ParticleSystem preview. */
window.CGSSParticleOverlay = (function () {
  const object = (plan, id) => plan.objects[String(id)];
  const pairs = (items) => Object.fromEntries((items || []).map((entry) => [entry.Key, entry.Value]));
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smoothstep = (edge0, edge1, value) => { const t = clamp((value - edge0) / (edge1 - edge0), 0, 1); return t * t * (3 - 2 * t); };
  // Visual tuning for the browser approximation, not recovered Unity shader constants.
  const appearance = Object.freeze({fadeIn: .18, fadeOut: .7, highlightGain: 1.6, contrast: 4});
  const visibility = age => smoothstep(0, appearance.fadeIn, age) * (1 - smoothstep(appearance.fadeOut, 1, age));
  function seeded(value) { let n = value >>> 0; return () => ((n = (n * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function zRotation(q) { return Math.atan2(2 * (q.w * q.z + q.x * q.y), 1 - 2 * (q.y * q.y + q.z * q.z)); }
  function transformPoint(point, transform) {
    const d = transform.data, angle = zRotation(d.m_LocalRotation), c = Math.cos(angle), s = Math.sin(angle);
    const x = point.x * d.m_LocalScale.x, y = point.y * d.m_LocalScale.y;
    return {x: x * c - y * s + d.m_LocalPosition.x, y: x * s + y * c + d.m_LocalPosition.y};
  }
  function alphaAt(gradient, t) {
    if (!gradient) return 1;
    const count = gradient.m_NumAlphaKeys || 0;
    const keys = Array.from({length: count}, (_, i) => ({t: gradient[`atime${i}`] / 65535, a: gradient[`key${i}`].a}));
    if (!keys.length) return 1;
    if (t <= keys[0].t) return keys[0].a;
    for (let i = 1; i < keys.length; i++) if (t <= keys[i].t) {
      const p = keys[i - 1], n = keys[i], ratio = (t - p.t) / (n.t - p.t || 1);
      return p.a + (n.a - p.a) * ratio;
    }
    return keys[keys.length - 1].a;
  }
  function makeEmitter(plan, config, node, particleId, serial) {
    // Resolve the ParticleSystem, its material texture, and the transform chain once.
    const system = object(plan, particleId).data;
    if (!node.active || !system.EmissionModule.enabled) return null;
    const rendererId = node.componentIds.find((id) => object(plan, id).type === 'ParticleSystemRenderer');
    const renderer = object(plan, rendererId)?.data;
    if (!renderer || renderer.m_Enabled === false) return null;
    const materialId = renderer.m_Materials[0].m_PathID;
    const material = object(plan, materialId).data;
    const textureId = pairs(material.m_SavedProperties.m_TexEnvs)._MainTex.m_Texture.m_PathID;
    const texture = config.particleImages[textureId];
    if (!texture) throw new Error(`Missing particle texture ${object(plan, textureId).name}`);
    const transformIds = [node.transformId, ...node.ancestorTransformIds.slice().reverse()];
    const transforms = transformIds.map((id) => object(plan, id));
    const materialColor = pairs(material.m_SavedProperties.m_Colors)._Color || {r: 1, g: 1, b: 1, a: 1};
    const properties = material.m_SavedProperties;
    const alphaId = pairs(properties.m_TexEnvs)._AlphaTex?.m_Texture.m_PathID;
    const floats = pairs(properties.m_Floats);
    return {serial, name: node.name, system, renderer, materialColor, texture, transforms,
      alphaTexture: config.particleImages[alphaId], alphaFormat: config.textureFormats?.[alphaId],
      additive: floats._BlendDst !== 10};
  }
  function place(emitter, local) { return emitter.transforms.reduce((value, transform) => transformPoint(value, transform), local); }
  async function create({plan, config, canvas, fit}) {
    const {sample, integral, particleScale, rotateShape, compareEmitters} = await import('./particle-math.js');
    const {ParticleSimulation, noiseOffset} = await import('./particle-simulation.js');
    // Create a deterministic browser preview from authored Unity particle data.
    const nodes = plan.effectPrefabs.flatMap((prefab) => prefab.nodes);
    const emitters = nodes.flatMap((node, serial) => node.componentIds.filter((id) => object(plan, id).type === 'ParticleSystem').map((id) => makeEmitter(plan, config, node, id, serial))).filter(Boolean);
    emitters.sort(compareEmitters);
    for (const emitter of emitters) emitter.simulation = new ParticleSimulation(emitter.system, crypto.getRandomValues(new Uint32Array(1))[0]);
    // The bundle stores a multiplier, not Physics.gravity. Callers may override it.
    const gravity = config.gravity || {x:0,y:-9.81};
    const brighten = (source) => {
      // Preview contrast adjustment; keep black pixels at zero for additive blending.
      const result = document.createElement('canvas'); result.width = source.width; result.height = source.height;
      const resultContext = result.getContext('2d', {willReadFrequently:true});
      resultContext.drawImage(source, 0, 0);
      const pixels = resultContext.getImageData(0, 0, result.width, result.height);
      for (let index = 0; index < pixels.data.length; index += 4) {
        pixels.data[index] = Math.min(255, appearance.contrast * pixels.data[index] * pixels.data[index] / 255);
        pixels.data[index + 1] = Math.min(255, appearance.contrast * pixels.data[index + 1] * pixels.data[index + 1] / 255);
        pixels.data[index + 2] = Math.min(255, appearance.contrast * pixels.data[index + 2] * pixels.data[index + 2] / 255);
      }
      resultContext.putImageData(pixels, 0, 0);
      return result;
    };
    // Brighten each source texture once before additive compositing.
    const imageByTexture = new Map();
    for (const emitter of emitters) {
      // Material instances may share RGB but use different masks or blend modes.
      const source = document.createElement('canvas');
      source.width = emitter.texture.width; source.height = emitter.texture.height;
      const ctx = source.getContext('2d', {willReadFrequently:true});
      ctx.drawImage(emitter.texture,0,0);
      if (emitter.alphaTexture) {
        const mask = document.createElement('canvas'); mask.width=source.width; mask.height=source.height;
        const mc=mask.getContext('2d',{willReadFrequently:true}); mc.drawImage(emitter.alphaTexture,0,0,mask.width,mask.height);
        const rgba=ctx.getImageData(0,0,source.width,source.height), alpha=mc.getImageData(0,0,mask.width,mask.height).data;
        // Alpha8 is decoded into A; RGB masks retain the shader's red channel.
        for(let i=0;i<rgba.data.length;i+=4) rgba.data[i+3]=alpha[i+(emitter.alphaFormat===1?3:0)];
        ctx.putImageData(rgba,0,0);
      }
      imageByTexture.set(emitter, emitter.additive ? brighten(source) : source);
    }
    const context = canvas.getContext('2d');
    let started = false, paused = false;
    function draw(delta) {
      // Advance births and deaths once, then evaluate the surviving particles.
      if (!started || paused) return;
      context.globalCompositeOperation = 'lighter';
      for (const emitter of emitters) {
        const ps = emitter.system, initial = ps.InitialModule, shape = ps.ShapeModule, uv = ps.UVModule;
        emitter.simulation.advance(delta);
        const image = imageByTexture.get(emitter);
        const scale = particleScale(emitter.transforms, ps.scalingMode);
        context.globalCompositeOperation = emitter.additive ? 'lighter' : 'source-over';
        for (const particle of emitter.simulation.particles) {
          const seed = seeded(particle.seed);
          const lifetime = particle.lifetime, age = emitter.simulation.time-particle.birth;
          const local = shape.enabled ? rotateShape({x:(seed()-.5)*shape.m_Scale.x,y:(seed()-.5)*shape.m_Scale.y,z:(seed()-.5)*shape.m_Scale.z},shape.m_Rotation) : {x:0,y:0,z:0};
          if(shape.enabled) { local.x+=shape.m_Position.x; local.y+=shape.m_Position.y; }
          const direction=rotateShape({x:0,y:0,z:1},shape.enabled?shape.m_Rotation:{});
          const speed=sample(initial.startSpeed,seed(),particle.phase);
          local.x+=direction.x*speed*age; local.y+=direction.y*speed*age;
          const velocity = ps.VelocityModule;
          const displacement={x:0,y:0};
          if(velocity.enabled) {
            const modifier=velocity.speedModifier ? sample(velocity.speedModifier,seed(),age/lifetime) : 1;
            for(const axis of ['x','y']) displacement[axis]=integral(velocity[axis],seed(),age,lifetime)*modifier;
          }
          if(!velocity.inWorldSpace) {local.x+=displacement.x;local.y+=displacement.y;}
          const perturbation=noiseOffset(ps.NoiseModule,local,age,lifetime,particle.seed);
          local.x+=perturbation.x; local.y+=perturbation.y;
          const point = place(emitter, local), size = sample(initial.startSize, seed(), particle.phase);
          if(velocity.inWorldSpace) {point.x+=displacement.x;point.y+=displacement.y;}
          const gravityDisplacement=integral(initial.gravityModifier,seed(),age,lifetime,true);
          point.x+=gravity.x*gravityDisplacement; point.y+=gravity.y*gravityDisplacement;
          const normalizedAge = age / lifetime;
          const ageAlpha = ps.ColorModule.enabled ? alphaAt(ps.ColorModule.gradient.maxGradient, normalizedAge) : 1;
          const color = initial.startColor.maxColor || {r: 1, g: 1, b: 1, a: 1};
          const alpha = clamp(color.a * emitter.materialColor.a * ageAlpha * (emitter.additive ? visibility(normalizedAge) * appearance.highlightGain : 1), 0, 1);
          const px = point.x * fit.scale + fit.tx, py = -point.y * fit.scale + fit.ty;
          const sizeRandom=seed(), sizeModule=ps.SizeModule;
          const sx=sizeModule.enabled?sample(sizeModule.curve,sizeRandom,normalizedAge):1;
          const sy=sizeModule.enabled && sizeModule.separateAxes?sample(sizeModule.y,sizeRandom,normalizedAge):sx;
          const width = Math.max(0,size*sx*scale.x*fit.scale), height=Math.max(0,size*sy*scale.y*fit.scale);
          let angle=sample(initial.startRotation,seed(),particle.phase);
          if(ps.RotationModule.enabled) angle+=integral(ps.RotationModule.curve || ps.RotationModule.z,seed(),age,lifetime);
          context.save(); context.translate(px,py); context.rotate(-angle);
          context.globalAlpha = alpha;
          if (uv.enabled) {
            const columns=uv.tilesX, rows=uv.tilesY, total=columns*rows;
            const progress=sample(uv.startFrame,seed())+sample(uv.frameOverTime,seed(),(normalizedAge*(uv.cycles||1))%1);
            const cell=((Math.floor(progress*total)%total)+total)%total, sw=image.width/columns, sh=image.height/rows;
            context.drawImage(image,cell%columns*sw,Math.floor(cell/columns)*sh,sw,sh,-width/2,-height/2,width,height);
          } else context.drawImage(image,-width/2,-height/2,width,height);
          context.restore();
        }
      }
      context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
    }
    return {count: emitters.length, draw, start() { started = true; for(const emitter of emitters) emitter.simulation.reset(); }, pause() { paused = true; }, resume() { paused = false; }, dispose() { started = false; for(const emitter of emitters) emitter.simulation.particles.length=0; for (const image of imageByTexture.values()) { image.width = 0; image.height = 0; } imageByTexture.clear(); }};
  }
  return {create};
})();
