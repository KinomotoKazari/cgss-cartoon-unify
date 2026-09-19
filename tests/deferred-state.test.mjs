import test from 'node:test';
import assert from 'node:assert/strict';
import {createDeferredStateQueue} from '../web/deferred-state.js';

test('deferred state queue coalesces masks and preserves first-mark order', () => {
  const queue = createDeferredStateQueue();
  const first = {}, second = {};
  queue.mark(first, 1);
  queue.mark(second, 4);
  queue.mark(first, 2);
  const seen = [];
  queue.flush((target, mask) => seen.push([target, mask]));
  assert.deepEqual(seen, [[first, 3], [second, 4]]);
  assert.equal(queue.size, 0);
});

test('empty marks and clear do not create work', () => {
  const queue = createDeferredStateQueue();
  queue.mark(null);
  queue.mark({}, 0);
  queue.clear();
  assert.equal(queue.size, 0);
});
