import {mountParticleInspector} from './particle-inspector.js';
import {createSceneRuntime} from './scene-runtime.js';

function surface(texture) {
  // Convert transferred RGBA pixels into a reusable CanvasImageSource.
  const canvas = document.createElement('canvas'); canvas.width = texture.width; canvas.height = texture.height;
  const data = new Uint8ClampedArray(texture.rgba.buffer, texture.rgba.byteOffset, texture.rgba.byteLength);
  canvas.getContext('2d').putImageData(new ImageData(data, texture.width, texture.height), 0, 0);
  return canvas;
}

function fitScene(skeletons, canvas) {
  // Preview fit policy: fit skeleton bounds with a small visual margin.
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
  // Images are indexed by Unity object id for atlas and material lookup.
  const images = {};
  let composite, particles, renderer, glCanvas, runtime;
  let disposed = false, inspector = null;
  function dispose() {
    if (disposed) return;
    disposed = true;
    try {
      try { inspector?.dispose(); }
      finally {
        if (runtime) runtime.dispose();
        else {
          try { particles?.dispose(); }
          finally { renderer?.dispose(); }
        }
      }
    } finally {
      for (const image of Object.values(images)) { image.width = 0; image.height = 0; }
      if (composite) { composite.width = 0; composite.height = 0; }
      if (glCanvas) { glCanvas.width = 0; glCanvas.height = 0; }
    }
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
      return {layer:entry.layer, slot:entry.slot, name:entry.name, skeleton, state};
    });
    const fit = fitScene(skeletons, canvas);
    particles = await CGSSParticleOverlay.create({plan:card.plan, config:{particleImages:images,
      textureFormats:Object.fromEntries(card.textures.map(t=>[t.id,t.format])),
      viewportWorld:Math.min(canvas.width,canvas.height)/fit.scale}});
    glCanvas = document.createElement('canvas'); glCanvas.width = canvas.width; glCanvas.height = canvas.height;
    renderer = new CGSSWebGLRenderer(glCanvas, {preserveDrawingBuffer:true});
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D is unavailable');
    runtime = createSceneRuntime({skeletons, particles, renderer, context, glCanvas, fit, getSpeed});
    return {skeletons, particles, summary:card.summary, fit, diagnostics:runtime.diagnostics,
      renderOnce() { if (!disposed) runtime.renderOnce(); },
      createParticleInspector(viewport, panel) {
        if (disposed) throw new Error('Viewer is disposed');
        inspector?.dispose();
        inspector = mountParticleInspector({plan:card.plan, fit, images, canvas, viewport, panel});
        inspector.setVisible(false);
        return inspector;
      },
      play() { runtime.play(); },
      pause() { runtime.pause(); },
      dispose
    };
  } catch (error) {
    try { dispose(); }
    catch (cleanupError) { throw new AggregateError([error, cleanupError], 'Viewer creation and cleanup failed'); }
    throw error;
  }
}
