import {mountParticleInspector} from './particle-inspector.js';

function surface(texture) {
  // Convert transferred RGBA pixels into a reusable CanvasImageSource.
  const canvas = document.createElement('canvas'); canvas.width = texture.width; canvas.height = texture.height;
  const data = new Uint8ClampedArray(texture.rgba.buffer, texture.rgba.byteOffset, texture.rgba.byteLength);
  canvas.getContext('2d').putImageData(new ImageData(data, texture.width, texture.height), 0, 0);
  return canvas;
}

function fitScene(skeletons, canvas) {
  // Fit all Spine layers into the square card viewport with a small visual margin.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const {skeleton} of skeletons) {
    const offset = new spine.Vector2(), size = new spine.Vector2();
    skeleton.updateWorldTransform(); skeleton.getBounds(offset, size, []);
    if (!(size.x > 0 && size.y > 0)) continue;
    minX = Math.min(minX, offset.x); minY = Math.min(minY, offset.y);
    maxX = Math.max(maxX, offset.x + size.x); maxY = Math.max(maxY, offset.y + size.y);
  }
  if (!Number.isFinite(minX)) return {scale:1, tx:canvas.width/2, ty:canvas.height/2};
  const scale = Math.min(canvas.width/(maxX-minX), canvas.height/(maxY-minY)) * .92;
  return {scale, tx:(canvas.width-(maxX+minX)*scale)/2, ty:(canvas.height-(maxY+minY)*scale)/2};
}

export async function createViewer(card, canvas, getSpeed = () => 1) {
  // Assemble Spine layers and the particle approximation for one decoded card.
    // Images are indexed by Unity object id for Spine atlas and particle material lookup.
    const images = {};
  let composite, particles, renderer, glCanvas;
  let disposed = false, frameId, inspector = null;
  function dispose() {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frameId);
    inspector?.dispose();
    particles?.dispose();
    renderer?.dispose();
    for (const image of Object.values(images)) { image.width = 0; image.height = 0; }
    if (composite) { composite.width = 0; composite.height = 0; }
  }
  try {
    for (const texture of card.textures) images[texture.id] = surface(texture);
    const rgb = images[card.rgbId], alpha = images[card.alphaId];
    if (!rgb || !alpha || rgb.width !== alpha.width || rgb.height !== alpha.height) throw new Error('Atlas RGB and alpha dimensions must match');
    composite = document.createElement('canvas'); composite.width = rgb.width; composite.height = rgb.height;
    const compositeContext = composite.getContext('2d'); compositeContext.drawImage(rgb,0,0);
    // CGSS cards store RGB and alpha in separate atlas textures.
    compositeContext.globalCompositeOperation = 'destination-in'; compositeContext.drawImage(alpha,0,0);
    const texture = new spine.canvas.CanvasTexture(composite);
    const atlas = new spine.TextureAtlas(card.atlasText, () => texture);
    const skeletons = card.skeletons.map(entry => {
      const reader = new spine.SkeletonJson(new spine.AtlasAttachmentLoader(atlas));
      reader.scale = entry.scale;
      const bytes = entry.bytes;
      const json = bytes[0] === 123 ? JSON.parse(new TextDecoder().decode(bytes)) : CGSSSkelParser.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
      const data = reader.readSkeletonData(json), skeleton = new spine.Skeleton(data);
      skeleton.flipY = true;
      const stateData = new spine.AnimationStateData(data); stateData.defaultMix = entry.defaultMix;
      const state = new spine.AnimationState(stateData);
      if (data.animations.length) state.setAnimation(0, data.animations[0].name, true);
      return {layer:entry.layer, skeleton, state};
    });
    const fit = fitScene(skeletons, canvas);
    particles = await CGSSParticleOverlay.create({plan:card.plan, config:{particleImages:images, textureFormats:Object.fromEntries(card.textures.map(t=>[t.id,t.format]))}, canvas, fit});
    glCanvas = document.createElement('canvas'); glCanvas.width = canvas.width; glCanvas.height = canvas.height;
    renderer = new CGSSWebGLRenderer(glCanvas, {preserveDrawingBuffer:true});
    const context = canvas.getContext('2d');
    let playing = true, previous = performance.now();
    particles.start();
    const draw = now => {
      if (disposed) return;
      frameId = requestAnimationFrame(draw);
      const delta = Math.min(.05, (now-previous)/1000); previous = now;
      if (!playing) return;
      const requestedSpeed = Number(getSpeed());
      const speed = Number.isFinite(requestedSpeed) && requestedSpeed >= 0 ? requestedSpeed : 1;
      render(delta * speed);
    };
    function render(delta) {
      // Render Spine through WebGL, then draw additive particles on the output canvas.
      renderer.setTransform(fit.scale, fit.tx, fit.ty); renderer.clear(.2,.2,.2,1);
      for (const item of skeletons) { item.state.update(delta); item.state.apply(item.skeleton); item.skeleton.updateWorldTransform(); renderer.draw(item.skeleton); }
      context.setTransform(1,0,0,1,0,0); context.globalAlpha = 1; context.globalCompositeOperation = 'source-over';
      context.drawImage(glCanvas,0,0); particles.draw(delta);
    };
    frameId = requestAnimationFrame(draw);
    return {skeletons, particles, summary:card.summary, fit,
      renderOnce() { if (!disposed) render(0); },
      createParticleInspector(viewport, panel) {
        inspector?.dispose();
        inspector = mountParticleInspector({plan:card.plan, fit, images, canvas, viewport, panel});
        inspector.setVisible(false);
        return inspector;
      },
      play() { playing = true; previous = performance.now(); particles.resume(); },
      pause() { playing = false; particles.pause(); },
      dispose
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
