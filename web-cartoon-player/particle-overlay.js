/* ParticleSystem preview. */
window.CGSSParticleOverlay = (function () {
  const object = (plan, id) => plan.objects[String(id)];
  const pairs = (items) => Object.fromEntries((items || []).map((entry) => [entry.Key, entry.Value]));
  const range = (curve, random) => curve.minMaxState === 3 ? curve.minScalar + (curve.scalar - curve.minScalar) * random : curve.scalar;
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
    return {serial, name: node.name, system, renderer, materialColor, texture, transforms};
  }
  function place(emitter, local) { return emitter.transforms.reduce((value, transform) => transformPoint(value, transform), local); }
  async function create({plan, config, canvas, fit}) {
    // Create a deterministic browser preview from authored Unity particle data.
    const nodes = plan.effectPrefabs.flatMap((prefab) => prefab.nodes);
    const emitters = nodes.flatMap((node, serial) => node.componentIds.filter((id) => object(plan, id).type === 'ParticleSystem').map((id) => makeEmitter(plan, config, node, id, serial))).filter(Boolean);
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
      if (!imageByTexture.has(emitter.texture)) imageByTexture.set(emitter.texture, brighten(emitter.texture));
    }
    const context = canvas.getContext('2d');
    let started = false, paused = false, elapsed = 0;
    function draw(delta) {
      // Reconstruct particles from elapsed time so pause and resume remain stable.
      if (!started || paused) return;
      elapsed += delta;
      context.globalCompositeOperation = 'lighter';
      for (const emitter of emitters) {
        const ps = emitter.system, initial = ps.InitialModule, emission = ps.EmissionModule, shape = ps.ShapeModule, uv = ps.UVModule;
        const seconds = elapsed * (ps.simulationSpeed ?? 1) + (ps.prewarm ? ps.lengthInSec : 0);
        const lifeMin = Math.min(initial.startLifetime.scalar, initial.startLifetime.minScalar);
        const lifeMax = Math.max(initial.startLifetime.scalar, initial.startLifetime.minScalar, .01);
        const rateMax = Math.max(emission.rateOverTime.scalar, emission.rateOverTime.minScalar, 0);
        const count = Math.min(initial.maxNumParticles || Infinity, Math.max(1, Math.ceil(rateMax * (lifeMin + lifeMax) / 2)));
        const image = imageByTexture.get(emitter.texture);
        for (let index = 0; index < count; index++) {
          const seed = seeded((emitter.serial + 1) * 104729 + index * 1009);
          const lifetime = Math.max(.01, range(initial.startLifetime, seed()));
          const age = (seconds + seed() * lifetime) % lifetime;
          const local = {x: (seed() - .5) * shape.m_Scale.x + shape.m_Position.x, y: (seed() - .5) * shape.m_Scale.y + shape.m_Position.y};
          const velocity = ps.VelocityModule.enabled ? {x: range(ps.VelocityModule.x, seed()), y: range(ps.VelocityModule.y, seed())} : {x: 0, y: 0};
          local.x += velocity.x * age; local.y += velocity.y * age;
          const point = place(emitter, local), size = range(initial.startSize, seed());
          const normalizedAge = age / lifetime;
          const ageAlpha = ps.ColorModule.enabled ? alphaAt(ps.ColorModule.gradient.maxGradient, normalizedAge) : 1;
          const color = initial.startColor.maxColor || {r: 1, g: 1, b: 1, a: 1};
          const alpha = clamp(color.a * emitter.materialColor.a * ageAlpha * visibility(normalizedAge) * appearance.highlightGain, 0, 1);
          const px = point.x * fit.scale + fit.tx, py = -point.y * fit.scale + fit.ty, drawSize = Math.max(1, size * fit.scale);
          context.globalAlpha = alpha;
          if (uv.enabled) { const columns = uv.tilesX, rows = uv.tilesY, cell = Math.floor(seed() * columns * rows), sw = image.width / columns, sh = image.height / rows; context.drawImage(image, cell % columns * sw, Math.floor(cell / columns) * sh, sw, sh, px - drawSize / 2, py - drawSize / 2, drawSize, drawSize); }
          else context.drawImage(image, px - drawSize / 2, py - drawSize / 2, drawSize, drawSize);
        }
      }
      context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
    }
    return {count: emitters.length, draw, start() { started = true; elapsed = 0; }, pause() { paused = true; }, resume() { paused = false; }, dispose() { started = false; for (const image of imageByTexture.values()) { image.width = 0; image.height = 0; } imageByTexture.clear(); }};
  }
  return {create};
})();
