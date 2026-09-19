// Coalesce state changes until the frame reaches its presentation boundary.
// The queue is deliberately renderer-neutral: it models state invalidation,
// not a particular graphics API's object layout.
export function createDeferredStateQueue() {
  const pending = new Map();

  return {
    mark(target, mask = 1) {
      if (!target || !mask) return;
      pending.set(target, (pending.get(target) || 0) | mask);
    },
    flush(consume) {
      for (const [target, mask] of pending) consume(target, mask);
      pending.clear();
    },
    clear() { pending.clear(); },
    get size() { return pending.size; }
  };
}
