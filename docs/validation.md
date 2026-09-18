# Validation

We use automated checks to protect the browser player, parser, particle model,
and standalone distribution. These checks support maintenance. They do not claim
pixel-identical output for every card or every runtime feature.

## Focused checks

We run focused Node checks for parser bounds, particle scheduling, render-plan
order, playback lifecycle, and WebGL submissions:

```sh
node --test tests/scene-runtime.test.mjs tests/render-plan.test.mjs tests/webgl-submission.test.mjs tests/particle-simulation.test.mjs
```

The rendering checks cover initial pose application, skeleton and emitter group
order, partial skeleton sets, stable equal-order fallback, pause and resume
timing, frame errors, resource cleanup, texture switching, and blend state.
They record WebGL commands. They do not rasterize or compare final GPU pixels.

We run the complete Node suite with:

```sh
node --test tests/*.test.mjs
```

We keep standalone shared files synchronized with:

```sh
npm run sync:standalone
npm run check:standalone
```

## Browser checks

We use Playwright and a current Edge installation for optional browser smoke
checks. Supply a directory containing supported bundle files that you are
entitled to use:

```sh
npm install --no-save --package-lock=false playwright
node tests/browser-smoke.mjs /path/to/bundles
node tests/standalone-browser-smoke.mjs /path/to/bundles
```

We use `PYTHON` to select the Python executable for the desktop check. We use
`BROWSER_CHANNEL` to select another Playwright browser channel when needed.

Browser checks verify file loading, card replacement, playback controls, the
static inspector, and the bare player. They report browser errors and unexpected
POST requests. They are smoke checks. We still review card appearance manually
when changing rendering behavior.

## Limits

We do not ship game resources or test bundles. We cannot use automated checks
to prove every card, camera setting, material, or particle path. We track the
supported player behavior and open rendering limits in [Rendering model](rendering.md)
and the 2.0.0 composition change in [Release notes](releases/2.0.0.md).
