/* ParticleSystem preview. */
window.CGSSParticleOverlay = (function () {
  const object = (plan, id) => plan.objects[String(id)];
  const pairs = (items) => Object.fromEntries((items || []).map((entry) => [entry.Key, entry.Value]));
  function seeded(value) { let n = value >>> 0; return () => ((n = (n * 1664525 + 1013904223) >>> 0) / 4294967296); }
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
    const shader = object(plan,material.m_Shader.m_PathID);
    const blend = shader?.data?.states?.[0]?.rtBlend0;
    const binding = field => field?.name in floats ? floats[field.name] : field?.val;
    const src = binding(blend?.srcBlend), dst = binding(blend?.destBlend);
    const supportedBlend = (src === 5 && [1,10].includes(dst)) || (src === 1 && dst === 10);
    if (!supportedBlend || binding(blend?.blendOp) !== 0)
      throw new Error(`Unsupported particle blend state in ${node.name}: ${src}/${dst}`);
    const gain = shader.name.startsWith('CommonParticle/Standard/') ? 2 : 1;
    if (!['CommonParticle/Standard/Blend', 'CommonParticle/TexAlpha/Simple/Blend', 'CommonParticle/Standard/AddtiveMultiply'].includes(shader.name))
      throw new Error(`Unsupported particle shader: ${shader.name}`);
    const alphaTexture = config.particleImages[alphaId], textureFormat = config.textureFormats?.[textureId];
    // Standard ETC RGB materials without a companion alpha texture encode coverage in RGB.
    const maskAlpha = !alphaTexture && textureFormat === 34 && shader.name.startsWith('CommonParticle/Standard/');
    return {id:particleId, gain, serial, name: node.name, system, renderer, materialColor, texture, transforms,
      alphaTexture, alphaFormat: config.textureFormats?.[alphaId], additive: dst === 1, maskAlpha};
  }
  async function create({plan, config}) {
    const {sample, integral, particleScale} = await import('./particle-math.js');
    const {ParticleSimulation, noiseOffset} = await import('./particle-simulation.js');
    const {motionHooks, transformPoint} = await import('./particle-motion.js');
    const place = (emitter,point) => emitter.transforms.reduce((p,t)=>transformPoint(p,t),point);
    const {sampleColor, multiplyColors} = await import('./particle-color.js');
    // Automatic seeds are fresh per load; authored seeds remain owned by the simulation.
    const nodes = plan.effectPrefabs.flatMap((prefab) => prefab.nodes);
    const emitters = nodes.flatMap((node, serial) => node.componentIds.filter((id) => object(plan, id).type === 'ParticleSystem').map((id) => makeEmitter(plan, config, node, id, serial))).filter(Boolean);
    // Preserve discovery order here. Cross-object ordering belongs to the render plan.
    for (const emitter of emitters) emitter.simulation = new ParticleSimulation(emitter.system, crypto.getRandomValues(new Uint32Array(1))[0], motionHooks(emitter.system));
    // The bundle stores a multiplier, not Physics.gravity. Callers may override it.
    const gravity = config.gravity || {x:0,y:-9.81};
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
      imageByTexture.set(emitter, source);
    }
    let started = false, paused = false;
    function advance(delta) {
      if (!started || paused) return;
      for (const emitter of emitters) emitter.simulation.advance(delta);
    }
    function draw(backend, emitter) {
      // Evaluate one renderer group without advancing simulation or persistent RNG.
      if (!started) return;
      {
        const ps = emitter.system, initial = ps.InitialModule, uv = ps.UVModule;
        const image = imageByTexture.get(emitter);
        const scale = particleScale(emitter.transforms, ps.scalingMode);
        for (const particle of emitter.simulation.particles) {
          const seed = seeded(particle.seed);
          const lifetime = particle.lifetime, age = emitter.simulation.time-particle.birth;
          const local = {...particle.motion.position};
          const perturbation=noiseOffset(ps.NoiseModule,local,age,lifetime,particle.seed);
          local.x+=perturbation.x; local.y+=perturbation.y; local.z+=perturbation.z;
          const point = place(emitter, local), size = sample(initial.startSize, seed(), particle.phase);
          point.x+=particle.motion.world.x; point.y+=particle.motion.world.y;
          const gravityDisplacement=integral(initial.gravityModifier,seed(),age,lifetime,true);
          point.x+=gravity.x*gravityDisplacement; point.y+=gravity.y*gravityDisplacement;
          const normalizedAge = age / lifetime;
          const color = multiplyColors(sampleColor(initial.startColor,seed(),particle.phase), emitter.materialColor,
            ps.ColorModule.enabled ? sampleColor(ps.ColorModule.gradient,seed(),normalizedAge) : null);
          const sizeRandom=seed(), sizeModule=ps.SizeModule;
          const sx=sizeModule.enabled?sample(sizeModule.curve,sizeRandom,normalizedAge):1;
          const sy=sizeModule.enabled && sizeModule.separateAxes?sample(sizeModule.y,sizeRandom,normalizedAge):sx;
          const width = Math.max(0,size*sx*scale.x), height=Math.max(0,size*sy*scale.y);
          let angle=sample(initial.startRotation,seed(),particle.phase);
          if(ps.RotationModule.enabled) angle+=integral(ps.RotationModule.curve || ps.RotationModule.z,seed(),age,lifetime);
          let region = {u:0, v:0, width:1, height:1};
          if (uv.enabled) {
            const columns=uv.tilesX, rows=uv.tilesY, total=columns*rows;
            const progress=sample(uv.startFrame,seed())+sample(uv.frameOverTime,seed(),(normalizedAge*(uv.cycles||1))%1);
            const cell=((Math.floor(progress*total)%total)+total)%total;
            region = {u:(cell%columns)/columns, v:Math.floor(cell/columns)/rows, width:1/columns, height:1/rows};
          }
          backend.drawParticle(image, {x:point.x, y:-point.y, width, height, angle:-angle,
            region, color, gain:emitter.gain, additive:emitter.additive, maskAlpha:emitter.maskAlpha});
        }
      }
    }
    // Construction already initializes and prewarms each simulation once.
    return {count: emitters.length, emitters, advance, draw, start() { started = true; paused = false; }, pause() { paused = true; }, resume() { paused = false; }, dispose() { started = false; for(const emitter of emitters) emitter.simulation.particles.length=0; for (const image of imageByTexture.values()) { image.width = 0; image.height = 0; } imageByTexture.clear(); }};
  }
  return {create};
})();
