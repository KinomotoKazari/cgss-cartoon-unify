import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLoadSession} from '../web/load-session.js';

function fakeWorker(t) {
  const workers = [];
  class Worker {
    constructor() { this.terminated = false; workers.push(this); }
    postMessage() {}
    terminate() { this.terminated = true; }
    emit(data) { return this.onmessage({data}); }
  }
  const original = Object.getOwnPropertyDescriptor(globalThis, 'Worker');
  globalThis.Worker = Worker;
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'Worker', original);
    else delete globalThis.Worker;
  });
  return workers;
}

test('a cancelled viewer cannot terminate or replace a newer load', async t => {
  const workers = fakeWorker(t);
  let finish;
  let disposed = 0;
  const loaded = [];
  const session = createLoadSession({
    workerUrl: 'worker.js',
    createViewer: () => new Promise(resolve => { finish = resolve; }),
    onLoaded: viewer => loaded.push(viewer)
  });
  session.load({file: 'first'});
  const pending = workers[0].emit({type: 'loaded', card: {}});
  assert.equal(workers[0].terminated, true);
  session.load({file: 'second'});
  finish({dispose() { disposed++; }});
  await pending;
  assert.equal(disposed, 1);
  assert.equal(workers[1].terminated, false);
  assert.deepEqual(loaded, []);
  session.dispose();
  assert.equal(workers[1].terminated, true);
});

test('worker errors end loading and allow retry', async t => {
  const workers = fakeWorker(t);
  const errors = [], busy = [];
  let disposed = 0;
  const session = createLoadSession({
    workerUrl: 'worker.js',
    createViewer: async () => ({dispose() { disposed++; }}),
    onError: error => errors.push(error.message),
    onBusy: value => busy.push(value)
  });
  session.load({file: 'broken'});
  await workers[0].emit({type: 'error', message: 'Invalid bundle'});
  assert.equal(workers[0].terminated, true);
  assert.equal(busy.at(-1), false);
  assert.deepEqual(errors, ['Invalid bundle']);
  session.load({file: 'valid'});
  await workers[1].emit({type: 'loaded', card: {}});
  session.dispose();
  session.dispose();
  assert.equal(disposed, 1);
});
