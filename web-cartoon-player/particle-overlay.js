/* ParticleSystem preview. */
window.CGSSParticleOverlay = (function () {
  const object = (plan, id) => plan.objects[String(id)];
  const pairs = (items) => Object.fromEntries((items || []).map((entry) => [entry.Key, entry.Value]));
  const tiltedBillboard = {vertices:[
    {x:-0.5,y:0.5,z:0,u:0,v:0}, {x:0.5,y:0.5,z:0,u:1,v:0},
    {x:0.5,y:-0.5,z:0,u:1,v:1}, {x:-0.5,y:-0.5,z:0,u:0,v:1}
  ], indices:[0,1,2,0,2,3]};
  function seeded(value) { let n = value >>> 0; return () => ((n = (n * 1664525 + 1013904223) >>> 0) / 4294967296); }
  function makeEmitter(plan, config, node, particleId, serial, resolveParticleMaterial) {
    // Resolve the ParticleSystem, its material texture, and the transform chain once.
    const system = object(plan, particleId).data;
    if (!node.active || !system.EmissionModule.enabled) return null;
    const rendererId = node.componentIds.find((id) => object(plan, id).type === 'ParticleSystemRenderer');
    const renderer = object(plan, rendererId)?.data;
    if (!renderer || renderer.m_Enabled === false) return null;
    // Mesh particles need their authored mesh geometry. Treating their first
    // texture as a billboard creates a false full-frame card overlay.
    const mesh = renderer.m_RenderMode === 4 ? object(plan, renderer.m_Mesh?.m_PathID)?.data?.particleMesh : null;
    if (renderer.m_RenderMode === 4 && !mesh) return null;
    // Controller ParticleSystems can be enabled without owning a renderable
    // material. The following child systems supply their visible particles.
    const materialIds = (renderer.m_Materials || []).map(pointer => pointer.m_PathID)
      .filter(id => object(plan, id)?.type === 'Material');
    if (!materialIds.length) return null;
    const transformIds = [node.transformId, ...node.ancestorTransformIds.slice().reverse()];
    const transforms = transformIds.map((id) => object(plan, id));
    const resolveVisual = (materialId, role) => {
      const material = object(plan, materialId)?.data;
      const properties = material.m_SavedProperties, textures=pairs(properties.m_TexEnvs);
      const textureId = textures._MainTex.m_Texture.m_PathID;
      const texture = config.particleImages[textureId];
      if (!texture) throw new Error(`Missing ${role} texture ${object(plan, textureId).name}`);
      const alphaId = textures._AlphaTex?.m_Texture.m_PathID;
      const multiplyId = textures._MultiplyTex?.m_Texture.m_PathID;
      const shader = object(plan,material.m_Shader.m_PathID);
      let binding;
      try {
        binding = resolveParticleMaterial(shader, material, {
          mainFormat:config.textureFormats?.[textureId],
          alphaFormat:config.textureFormats?.[alphaId], alphaAssigned:!!alphaId && alphaId !== '0',
          hasAlphaTexture:!!config.particleImages[alphaId],
          multiplyFormat:config.textureFormats?.[multiplyId], multiplyAssigned:!!multiplyId && multiplyId !== '0',
          hasMultiplyTexture:!!config.particleImages[multiplyId]
        });
      } catch (error) {
        const label=role === 'particle' ? node.name : `${node.name} ${role}`;
        throw new Error(`Particle ${label}: ${error.message}`, {cause:error});
      }
      const {gain, multiply, lumaAlpha, src, dst, colorMask, maskAlpha} = binding;
      return {gain, materialColor:pairs(properties.m_Colors)._Color || {r:1,g:1,b:1,a:1}, texture,
        alphaTexture:binding.usesAlphaTexture ? config.particleImages[alphaId] : null,
        alphaFormat:config.textureFormats?.[alphaId],
        multiplyTexture:binding.usesMultiplyTexture ? config.particleImages[multiplyId] : null,
        alphaSource:binding.alphaSource, materialConfidence:binding.confidence,
        blendSrc:src, blendDst:dst, multiply, lumaAlpha, maskAlpha, colorMask};
    };
    const visual=resolveVisual(materialIds[0],'particle');
    const trailVisual=system.TrailModule?.enabled && materialIds[1]
      ? resolveVisual(materialIds[1],'trail') : null;
    return {id:particleId, ...visual, serial, name:node.name, system, renderer,
      transforms, trailVisual, mesh};
  }
  async function create({plan, config}) {
    const {sample, integral, particleScale, stretchedBillboard, clampBillboard, particleMeshExtent,
      trailPointSequence, trailTextureU} = await import('./particle-math.js');
    const {ParticleSimulation, noiseEffects} = await import('./particle-simulation.js');
    const {motionHooks, transformPoint, transformVector, effectiveVelocity} = await import('./particle-motion.js');
    const {resolveParticleMaterial} = await import('./particle-material.js');
    const place = (emitter,point) => emitter.transforms.reduce((p,t)=>transformPoint(p,t),point);
    const placeVector = (emitter,vector) => emitter.transforms.reduce((p,t)=>transformVector(p,t),vector);
    const {sampleColor, multiplyColors} = await import('./particle-color.js');
    // Automatic seeds are fresh per load; authored seeds remain owned by the simulation.
    const nodes = plan.effectPrefabs.flatMap((prefab) => prefab.nodes);
    const emitters = nodes.flatMap((node, serial) => node.componentIds.filter((id) => object(plan, id).type === 'ParticleSystem').map((id) => makeEmitter(plan, config, node, id, serial, resolveParticleMaterial))).filter(Boolean);
    // Preserve discovery order here. Cross-object ordering belongs to the render plan.
    for (const emitter of emitters) {
      emitter.simulation = new ParticleSimulation(emitter.system, crypto.getRandomValues(new Uint32Array(1))[0], motionHooks(emitter.system));
      emitter.meshExtent = emitter.mesh ? particleMeshExtent(emitter.mesh) : 1;
    }
    // The bundle stores a multiplier, not Physics.gravity. Callers may override it.
    const gravity = config.gravity || {x:0,y:-9.81};
    const imageByTexture = new Map();
    const prepareImage = visual => {
      // Material instances may share RGB but use different masks or blend modes.
      const source = document.createElement('canvas');
      source.width = visual.texture.width; source.height = visual.texture.height;
      const ctx = source.getContext('2d', {willReadFrequently:true});
      ctx.drawImage(visual.texture,0,0);
      if (visual.alphaTexture) {
        const mask = document.createElement('canvas'); mask.width=source.width; mask.height=source.height;
        const mc=mask.getContext('2d',{willReadFrequently:true}); mc.drawImage(visual.alphaTexture,0,0,mask.width,mask.height);
        const rgba=ctx.getImageData(0,0,source.width,source.height), alpha=mc.getImageData(0,0,mask.width,mask.height).data;
        // Alpha8 is decoded into A; RGB masks retain the shader's red channel.
        for(let i=0;i<rgba.data.length;i+=4) rgba.data[i+3]=alpha[i+(visual.alphaFormat===1?3:0)];
        ctx.putImageData(rgba,0,0);
      }
      if (visual.lumaAlpha) {
        const rgba=ctx.getImageData(0,0,source.width,source.height);
        let multiplier;
        if (visual.multiplyTexture) {
          const mask=document.createElement('canvas'); mask.width=source.width; mask.height=source.height;
          const mc=mask.getContext('2d',{willReadFrequently:true});
          mc.drawImage(visual.multiplyTexture,0,0,source.width,source.height);
          multiplier=mc.getImageData(0,0,source.width,source.height).data;
        }
        // The authored shader samples _MultiplyTex.r, whose unset default is white.
        for(let i=0;i<rgba.data.length;i+=4) rgba.data[i+3]=multiplier?multiplier[i]:255;
        ctx.putImageData(rgba,0,0);
      }
      imageByTexture.set(visual, source);
    };
    for (const emitter of emitters) {
      prepareImage(emitter);
      if(emitter.trailVisual) prepareImage(emitter.trailVisual);
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
          if (particle.trail?.enabled && emitter.trailVisual) {
            const trail=ps.TrailModule, trailRandom=seeded(particle.seed ^ 0x74726169);
            const committed=particle.trail.points.filter(point =>
              emitter.simulation.time-(particle.birth+point.age) <= particle.trail.lifetime+1e-9);
            const head=particle.trail.head;
            const liveHead=head && emitter.simulation.time-(particle.birth+head.age) <= particle.trail.lifetime+1e-9
              ? head : null;
            const points=trailPointSequence(committed,liveHead);
            if(points.length>1) {
              const trailWeights={width:trailRandom(),particleStart:trailRandom(),particleLife:trailRandom(),
                lifetime:trailRandom(),along:trailRandom()};
              const centers=points.map(history=>{
                const local={...history.position};
                const noise=noiseEffects(ps.NoiseModule,local,history.age,lifetime,particle.seed);
                local.x+=noise.offset.x; local.y+=noise.offset.y; local.z+=noise.offset.z;
                const point=place(emitter,local), gravitySeed=seeded(particle.seed);
                gravitySeed();
                const gravityDisplacement=integral(initial.gravityModifier,gravitySeed(),history.age,lifetime,true);
                point.x+=history.world.x+gravity.x*gravityDisplacement;
                point.y+=history.world.y+gravity.y*gravityDisplacement;
                return {x:point.x,y:-point.y,age:history.age,noise};
              });
              const vertices=[], indices=[];
              for(let i=0;i<centers.length;i++) {
                const point=centers[i], previous=centers[Math.max(0,i-1)], next=centers[Math.min(centers.length-1,i+1)];
                const dx=next.x-previous.x, dy=next.y-previous.y, distance=Math.hypot(dx,dy)||1;
                const along=i/(centers.length-1), trailAge=1-along;
                const sizeSeed=seeded(particle.seed), startSizeRandom=sizeSeed();
                const baseSize=sample(initial.startSize,startSizeRandom,particle.phase);
                const normalizedAge=Math.max(0,Math.min(1,point.age/lifetime));
                const sizeFactor=ps.SizeModule.enabled ? sample(ps.SizeModule.curve,sizeSeed(),normalizedAge) : 1;
                const baseWidth=trail.sizeAffectsWidth ? baseSize*sizeFactor*scale.x*point.noise.sizeScale : scale.x;
                const width=Math.max(0,baseWidth*sample(trail.widthOverTrail,trailWeights.width,trailAge));
                const particleColor=trail.inheritParticleColor ? multiplyColors(
                  sampleColor(initial.startColor,trailWeights.particleStart,particle.phase),
                  ps.ColorModule.enabled ? sampleColor(ps.ColorModule.gradient,trailWeights.particleLife,normalizedAge) : null) : null;
                const color=multiplyColors(emitter.trailVisual.materialColor,particleColor,
                  sampleColor(trail.colorOverLifetime,trailWeights.lifetime,normalizedAge),
                  sampleColor(trail.colorOverTrail,trailWeights.along,trailAge));
                const nx=-dy/distance*width/2, ny=dx/distance*width/2;
                // Particle trail textures place their bright attached head at
                // U=0 and fade toward U=1 at the oldest end of the ribbon.
                const u=trailTextureU(along);
                vertices.push({x:point.x+nx,y:point.y+ny,u,v:0,color},
                  {x:point.x-nx,y:point.y-ny,u,v:1,color});
                if(i) { const a=(i-1)*2,b=a+1,c=i*2,d=c+1; indices.push(a,b,c,b,d,c); }
              }
              backend.drawParticleTrail(imageByTexture.get(emitter.trailVisual), {vertices,indices,
                gain:emitter.trailVisual.gain,blendSrc:emitter.trailVisual.blendSrc,
                blendDst:emitter.trailVisual.blendDst,multiply:emitter.trailVisual.multiply,
                lumaAlpha:emitter.trailVisual.lumaAlpha,maskAlpha:emitter.trailVisual.maskAlpha,
                colorMask:emitter.trailVisual.colorMask});
            }
          }
          if(age>=lifetime) continue;
          const local = {...particle.motion.position};
          const noise=noiseEffects(ps.NoiseModule,local,age,lifetime,particle.seed);
          const perturbation=noise.offset;
          local.x+=perturbation.x; local.y+=perturbation.y; local.z+=perturbation.z;
          const point = place(emitter, local), startSizeRandom=seed();
          const size = sample(initial.startSize, startSizeRandom, particle.phase);
          const sizeY = initial.size3D ? sample(initial.startSizeY, startSizeRandom, particle.phase) : size;
          point.x+=particle.motion.world.x; point.y+=particle.motion.world.y;
          const gravityDisplacement=integral(initial.gravityModifier,seed(),age,lifetime,true);
          point.x+=gravity.x*gravityDisplacement; point.y+=gravity.y*gravityDisplacement;
          const normalizedAge = age / lifetime;
          const color = multiplyColors(sampleColor(initial.startColor,seed(),particle.phase), emitter.materialColor,
            ps.ColorModule.enabled ? sampleColor(ps.ColorModule.gradient,seed(),normalizedAge) : null);
          const sizeRandom=seed(), sizeModule=ps.SizeModule;
          const sx=sizeModule.enabled?sample(sizeModule.curve,sizeRandom,normalizedAge):1;
          const sy=sizeModule.enabled && sizeModule.separateAxes?sample(sizeModule.y,sizeRandom,normalizedAge):sx;
          const width = Math.max(0,size*sx*scale.x*noise.sizeScale), height=Math.max(0,sizeY*sy*scale.y*noise.sizeScale);
          const rotation = {x:0, y:0, z:sample(initial.startRotation,seed(),particle.phase)};
          rotation.z += particle.motion.noiseRotation || 0;
          if (initial.rotation3D) {
            rotation.x=sample(initial.startRotationX,seed(),particle.phase);
            rotation.y=sample(initial.startRotationY,seed(),particle.phase);
          }
          if(ps.RotationModule.enabled) {
            const module=ps.RotationModule;
            if(module.separateAxes) {
              rotation.x+=integral(module.x,seed(),age,lifetime);
              rotation.y+=integral(module.y,seed(),age,lifetime);
            }
            rotation.z+=integral(module.curve || module.z,seed(),age,lifetime);
          }
          let region = {u:0, v:0, width:1, height:1};
          if (uv.enabled) {
            const columns=uv.tilesX, rows=uv.tilesY, total=columns*rows;
            const progress=sample(uv.startFrame,seed())+sample(uv.frameOverTime,seed(),(normalizedAge*(uv.cycles||1))%1);
            const cell=((Math.floor(progress*total)%total)+total)%total;
            region = {u:(cell%columns)/columns, v:Math.floor(cell/columns)/rows, width:1/columns, height:1/rows};
          }
          const velocity=effectiveVelocity(ps,particle,age), localVelocity=placeVector(emitter,velocity.local);
          const authoredQuad=stretchedBillboard(emitter.renderer, width, {
            x:localVelocity.x+velocity.world.x,
            y:localVelocity.y+velocity.world.y
          }, rotation.z, height);
          const quad=clampBillboard(authoredQuad,config.viewportWorld,
            emitter.renderer.m_MaxParticleSize,emitter.meshExtent);
          const sprite = {x:point.x+quad.offset.x, y:-(point.y+quad.offset.y), width:quad.width, height:quad.height, angle:-quad.angle,
            region, color, flipX:emitter.renderer.m_RenderMode===1,
            gain:emitter.gain, blendSrc:emitter.blendSrc, blendDst:emitter.blendDst,
            multiply:emitter.multiply, lumaAlpha:emitter.lumaAlpha,
            maskAlpha:emitter.maskAlpha, colorMask:emitter.colorMask};
          if (emitter.mesh) backend.drawParticleMesh(image, {...sprite, mesh:emitter.mesh, rotation});
          else if (Math.abs(rotation.x) > 1e-7 || Math.abs(rotation.y) > 1e-7)
            backend.drawParticleMesh(image, {...sprite, mesh:tiltedBillboard, rotation:{...rotation,z:quad.angle}});
          else backend.drawParticle(image, sprite);
        }
      }
    }
    // Construction already initializes and prewarms each simulation once.
    return {count: emitters.length, emitters, advance, draw, start() { started = true; paused = false; }, pause() { paused = true; }, resume() { paused = false; }, dispose() { started = false; for(const emitter of emitters) emitter.simulation.particles.length=0; for (const image of imageByTexture.values()) { image.width = 0; image.height = 0; } imageByTexture.clear(); }};
  }
  return {create};
})();
