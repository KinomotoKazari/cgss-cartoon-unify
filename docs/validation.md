# Validation

We use automated checks to protect the browser player, parser, particle model,
and standalone distribution. These checks support maintenance. They do not claim
pixel-identical output for every card or every runtime feature.

## Focused checks

We run focused Node checks for parser bounds, particle scheduling, render-plan
order, playback lifecycle, and WebGL submissions:

```sh
node --test tests/scene-runtime.test.mjs tests/render-plan.test.mjs tests/webgl-submission.test.mjs tests/particle-material.test.mjs tests/particle-simulation.test.mjs
```

The rendering checks cover initial pose application, skeleton and emitter group
order, partial skeleton sets, stable equal-order fallback, pause and resume
timing, frame errors, resource cleanup, texture switching, and blend state.
They record WebGL commands. They do not rasterize or compare final GPU pixels.

We run the complete Node suite with:

```sh
node --test tests/*.test.mjs
```

We keep standalone shared files and both generated MediaWiki scripts synchronized with:

```sh
npm run sync:standalone
npm run check:standalone
```

We also execute the minified MediaWiki build in the Node test context and check
that its full license header and readable-source pointer remain present.

We test the MediaWiki deployment packager with the complete Node suite. The test
recombines generated parts byte for byte and checks the manifest contract. We
can prepare real uploads separately with:

```sh
npm run package:mediawiki-bundles -- /path/to/bundles /path/to/output
```

## Browser checks

We use Playwright and a current Edge installation for optional browser smoke
checks. Supply a directory containing supported bundle files that you are
entitled to use:

```sh
npm install --no-save --package-lock=false playwright
node tests/browser-smoke.mjs /path/to/bundles
node tests/standalone-browser-smoke.mjs /path/to/bundles
node tests/mediawiki-browser-smoke.mjs /path/to/one/card_cartoon_301202.unity3d
```

We use `PYTHON` to select the Python executable for the desktop check. We use
`BROWSER_CHANNEL` to select another Playwright browser channel when needed.

Browser checks verify file loading, card replacement, playback controls, the
static inspector, the bare player, and one-card MediaWiki loading. They report browser errors and unexpected
POST requests. They are smoke checks. We still review card appearance manually
when changing rendering behavior.

## Limits

We do not ship game resources or test bundles. We cannot use automated checks
to prove every card, camera setting, material, or particle path. We track the
supported player behavior and open rendering limits in [Rendering model](rendering.md)
and the 2.0.0 composition change in [Release notes](releases/2.0.0.md).
