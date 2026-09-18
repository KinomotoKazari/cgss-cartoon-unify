# Playback architecture

The player retains its existing browser pages, controls, loading flow, and
embedding entry point. Internally, it separates loading, state progression,
ordered rendering, and presentation so that card content can be composed as
available through an ordered render plan.

## Stable public boundary

The page layer retains the file selector, Load/Cancel flow, Play, Pause, Speed,
card replacement, error recovery, bare player, and emitter inspector.
`createViewer(card, canvas, getSpeed)` remains the compatibility facade.
`load-session.js` owns Worker cancellation and discards stale asynchronous
viewer construction.

## Runtime flow

```text
Worker-decoded card
  -> resources and scene descriptions
  -> CardCartoon runtime
       -> playback clock
       -> Spine state updates
       -> particle simulation updates
       -> ordered render groups
       -> shared WebGL target
       -> visible canvas copy
```

`web/scene-runtime.js` owns the clock boundary. It updates every available
Spine skeleton and particle system before rendering. `renderOnce()` only draws
the current state: it does not advance time, emit particles, or consume
persistent random state. This keeps the inspector frame and future captures
stable.

We apply the initial animation pose and present a complete frame before
scheduling playback. This sends first-frame failures through the viewer's
loading cleanup path. We prewarm each particle simulation once during
construction. Starting or resuming playback does not repeat it. We pause the
runtime after a failed animation callback so a later Play action can schedule it again.

We use `web/render-plan.js` to build an ordered list of render groups. Known
skeleton slots use the reference game's native playback offsets. We place each
particle renderer after the shared particle base offset. We retain discovery
order for equal keys and report `stable-preview-order` diagnostics. We do not
present this fallback as an exact game ordering rule.

## Rendering model

Spine and particle geometry share one WebGL target. The runtime clears it,
submits each render group in plan order, then copies the completed target once
to the visible Canvas 2D surface. This keeps UI integration unchanged while
allowing effects to be placed between skeleton groups.

Each submission keeps its source identity, texture, material behavior, and
blend state. Consecutive compatible Spine geometry may batch within a skeleton's
attachment order. Batching never moves geometry across a render-group boundary.
We submit particles in each emitter's local particle sequence. We do not yet
implement camera-distance sorting inside an emitter.

## Resource ownership

The viewer owns temporary image surfaces. After successful construction, the
runtime owns particle and WebGL resources. Disposal is idempotent. If viewer
construction fails first, the viewer releases already-created particle and
renderer resources before rethrowing the original failure.

We generate standalone copies with `npm run sync:standalone`. We use
`npm run check:standalone` to report drift.

## Current limits

The browser model is a focused implementation guided by the reference game's
native playback pipeline, not a complete engine replacement. Camera-bone
binding, runtime scale compensation, exact startup simulation policy, clip
timing, render-queue/distance ties, and local particle depth ordering remain
open. These limits are surfaced in render-plan diagnostics where applicable.

This structure keeps each remaining approximation local to the renderer or
simulation, without changing the page controls or asset-loading contract.
