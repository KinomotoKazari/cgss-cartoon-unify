import test from 'node:test';
import assert from 'node:assert/strict';
import {createSceneRuntime} from '../web/scene-runtime.js';

function fixture() {
  let now = 1000, nextId = 0, speed = 1;
  const scheduled = new Map(), events = [];
  const clock = {
    now:() => now,
    request(callback) { const id = nextId++; scheduled.set(id, callback); return id; },
    cancel(id) { scheduled.delete(id); }
  };
  const emitters = [-44, -2, 0].map(order => ({id:String(order), renderer:{m_SortingOrder:order}}));
  const skeletons = ['eff1', 'fg', 'chara', 'bg', 'eff2'].map(layer => ({layer,
    state:{update(delta) { events.push(['update', layer, delta]); }, apply() { events.push(['apply', layer]); }},
    skeleton:{layer, updateWorldTransform() { events.push(['world', layer]); }}
  }));
  const particles = {emitters,
    start() { events.push(['start']); },
    advance(delta) { events.push(['advance', delta]); },
    draw(backend, emitter) { events.push(['particle', emitter.id]); },
    pause() { events.push(['pause']); }, resume() { events.push(['resume']); },
    dispose() { events.push(['dispose-particles']); }
  };
  const renderer = {setTransform() {}, clear() { events.push(['clear']); },
    draw(skeleton) { events.push(['spine', skeleton.layer]); }, dispose() { events.push(['dispose-renderer']); }};
  const options = {skeletons, particles, renderer, clock, getSpeed:() => speed,
    context:{setTransform() {}, drawImage() { events.push(['present']); }},
    glCanvas:{}, fit:{scale:1, tx:0, ty:0}};
  return {options, scheduled, events, setSpeed(value) { speed = value; },
    elapse(ms) { now += ms; },
    step(ms) {
      now += ms;
      const entry = scheduled.entries().next().value;
      assert.ok(entry, 'A running runtime has a pending frame');
      scheduled.delete(entry[0]); // RAF callbacks are one-shot.
      entry[1](now);
    }};
}

test('first frame applies animation and interleaves emitters before presenting once', t => {
  const f = fixture(), runtime = createSceneRuntime(f.options);
  t.after(() => runtime.dispose());
  const draws = f.events.filter(e => ['spine','particle','present'].includes(e[0]));
  assert.deepEqual(draws, [['spine','bg'], ['spine','eff2'], ['particle','-44'],
    ['spine','chara'], ['spine','fg'], ['spine','eff1'], ['particle','-2'], ['particle','0'], ['present']]);
  assert.equal(f.events.filter(e => e[0] === 'apply').length, 5);
  assert.ok(f.events.findLastIndex(e => e[0] === 'world') < f.events.findIndex(e => e[0] === 'clear'));
  assert.equal(f.events.some(e => e[0] === 'advance'), false);
  f.events.length = 0;
  runtime.renderOnce();
  assert.deepEqual(f.events.filter(e => ['spine','particle','present'].includes(e[0])), draws);
  assert.equal(f.events.some(e => ['update','apply','advance'].includes(e[0])), false);
});

test('pause cancels frames, redraw stays static, resume excludes paused time, disposal is final', t => {
  const f = fixture(), runtime = createSceneRuntime(f.options);
  t.after(() => runtime.dispose());
  runtime.pause(); // Also checks cancellation of a valid frame ID of zero.
  runtime.pause();
  assert.equal(f.scheduled.size, 0);
  f.events.length = 0;
  runtime.renderOnce();
  assert.equal(f.events.some(e => e[0] === 'advance'), false);
  f.elapse(5000);
  runtime.play(); runtime.play();
  assert.equal(f.scheduled.size, 1);
  f.step(20);
  assert.deepEqual(f.events.filter(e => e[0] === 'advance'), [['advance', .02]]);
  f.events.length = 0;
  runtime.dispose(); runtime.dispose(); runtime.play(); runtime.pause(); runtime.renderOnce();
  assert.equal(f.scheduled.size, 0);
  assert.deepEqual(f.events, [['dispose-particles'], ['dispose-renderer']]);
});

test('one clock applies speed and clamps stalls for both skeletons and particles', t => {
  const f = fixture(), runtime = createSceneRuntime(f.options);
  t.after(() => runtime.dispose());
  for (const [speed, ms, expected] of [[2,20,.04], [1,1000,.05], [0,20,0], [NaN,20,.02], [-1,20,.02]]) {
    f.events.length = 0; f.setSpeed(speed); f.step(ms);
    assert.ok(f.events.filter(e => e[0] === 'update').every(e => e[2] === expected));
    assert.deepEqual(f.events.filter(e => e[0] === 'advance'), expected ? [['advance',expected]] : []);
    assert.equal(f.scheduled.size, 1);
  }
});

test('construction errors surface synchronously without scheduling a frame', () => {
  const f = fixture();
  f.options.renderer.draw = () => { throw new Error('upload failed'); };
  assert.throws(() => createSceneRuntime(f.options), /upload failed/);
  assert.equal(f.scheduled.size, 0);
});

test('failed frames can resume and renderer disposal survives particle cleanup errors', () => {
  const f = fixture(), runtime = createSceneRuntime(f.options);
  const draw = f.options.renderer.draw;
  f.options.renderer.draw = () => { throw new Error('frame failed'); };
  assert.throws(() => f.step(20), /frame failed/);
  assert.equal(f.scheduled.size, 0);
  f.options.renderer.draw = draw;
  runtime.play(); f.step(20);
  assert.equal(f.scheduled.size, 1);
  f.options.particles.dispose = () => { throw new Error('cleanup failed'); };
  assert.throws(() => runtime.dispose(), /cleanup failed/);
  assert.equal(f.scheduled.size, 0);
  assert.equal(f.events.filter(e => e[0] === 'dispose-renderer').length, 1);
  runtime.dispose();
});
