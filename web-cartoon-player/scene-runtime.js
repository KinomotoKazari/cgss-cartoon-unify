// CardCartoon runtime boundary. The page UI talks to this through the viewer facade.
import {createRenderPlan} from './render-plan.js';

export function createSceneRuntime({skeletons, particles, renderer, context, glCanvas, fit, getSpeed = () => 1,
  clock = {now:() => performance.now(), request:cb => requestAnimationFrame(cb), cancel:id => cancelAnimationFrame(id)}}) {
  let frameId = null;
  let disposed = false;
  let playing = true;
  let previous = clock.now();
  const plan = createRenderPlan(skeletons, particles.emitters);

  function update(delta) {
    for (const item of skeletons) {
      item.state.update(delta);
      item.state.apply(item.skeleton);
      item.skeleton.updateWorldTransform();
    }
    if (delta > 0) particles.advance(delta);
  }

  function render() {
    if (disposed) return;
    renderer.setTransform(fit.scale, fit.tx, fit.ty);
    renderer.clear(.2, .2, .2, 1);
    for (const group of plan.groups) {
      if (group.kind === 'spine') renderer.draw(group.item.skeleton);
      else particles.draw(renderer, group.item);
    }
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalAlpha = 1;
    context.globalCompositeOperation = 'source-over';
    context.drawImage(glCanvas, 0, 0);
  }

  function tick(now) {
    frameId = null;
    if (disposed || !playing) return;
    const delta = Math.min(.05, Math.max(0, (now - previous) / 1000));
    previous = now;
    try {
      const requestedSpeed = Number(getSpeed());
      const speed = Number.isFinite(requestedSpeed) && requestedSpeed >= 0 ? requestedSpeed : 1;
      update(delta * speed);
      render();
    } catch (error) {
      // A failed frame must not leave the runtime running without a callback.
      playing = false;
      particles.pause();
      throw error;
    }
    if (!disposed && playing) frameId = clock.request(tick);
  }

  function cancelFrame() {
    if (frameId !== null) clock.cancel(frameId);
    frameId = null;
  }

  particles.start();
  // Apply the selected animation before an inspector can render the first frame.
  update(0);
  // Surface first-frame failures inside viewer construction and its cleanup boundary.
  render();
  previous = clock.now();
  frameId = clock.request(tick);

  return {
    renderOnce: render,
    diagnostics:plan.diagnostics,
    play() { if (disposed || playing) return; playing = true; previous = clock.now(); particles.resume(); frameId = clock.request(tick); },
    pause() { if (disposed || !playing) return; playing = false; cancelFrame(); particles.pause(); },
    dispose() { if (disposed) return; disposed = true; playing = false; cancelFrame(); try { particles.dispose(); } finally { renderer.dispose(); } }
  };
}
