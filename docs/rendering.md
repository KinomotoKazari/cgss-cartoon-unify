# Rendering model

The desktop preview and `web-cartoon-player/` share the same loader, runtime,
particle model, and WebGL composition path. This document describes what the
browser player currently does and what it deliberately leaves open.

## Data path

```text
UnityFS bundle
  -> AssetBundle entries
  -> named Spine assets + effect-prefab hierarchies
  -> atlas and particle materials
  -> decoded browser images
  -> scene runtime
  -> ordered WebGL submissions
  -> visible canvas
```

`src/card-loader.js` discovers supported named skeleton assets when present and
independently discovers every card `GameObject` hierarchy containing a
`ParticleSystem`. We require at least one supported skeleton and do not require
a fixed set. We give the current named slots explicit ordering
offsets in `web/render-plan.js`: `bg` 0, `eff2` 10, `eff3` 20, `chara` 30, `fg` 40, and
`eff1` 50. Particle renderer order is `60 + m_SortingOrder`. The first number
is a cross-object base, not a substitute for local particle sorting.

Unknown slot names and unsupported material states fail explicitly. Equal
render-plan keys use discovery order and are exposed as preview diagnostics.
Render queues, distance/state ties, and game-side overrides are not inferred.

The Worker transfers decoded texture buffers plus a serializable scene plan.
Particle playback resolves this reference chain at runtime:

```text
ParticleSystemRenderer.m_Materials[0]
  -> Material.m_SavedProperties.m_TexEnvs._MainTex
  -> Texture2D
```

## Composition and Spine

CGSS card atlases use separate RGB and alpha textures. `viewer.js` composes
`_MainTex` with `_AlphaTex` using Canvas 2D `destination-in` before uploading
the atlas to WebGL. The renderer currently accepts one atlas page with matching
RGB/alpha dimensions.

`runtime/spine-webgl.js` draws Spine region and mesh attachment triangles in
each skeleton's attachment draw order. Consecutive geometry with the same
texture and blend mode can batch while preserving slot order. We never move
batched geometry across a render-group boundary. We multiply Spine color from skeleton, slot, and
attachment colors and emitted as premultiplied alpha.

| Spine blend | WebGL source / destination |
|---|---|
| Normal | `ONE`, `ONE_MINUS_SRC_ALPHA` |
| Additive | `ONE`, `ONE` |
| Multiply | `DST_COLOR`, `ONE_MINUS_SRC_ALPHA` |
| Screen | `ONE`, `ONE_MINUS_SRC_COLOR` |

The same renderer also draws particle quads. Particle RGB writes are enabled
while destination alpha is retained, matching the current supported particle
material behavior. New texture uploads flush existing geometry first, preventing
pending triangles from being submitted with a different texture binding.

## Particle simulation and materials

`web/particle-simulation.js` manages particle birth, lifetime, fixed updates,
prewarm, seeds, force/velocity motion, gravity, size, rotation, texture-sheet
progression, and the supported Box, cone-base, and single-sided edge shapes. `particle-overlay.js`
evaluates the current population without advancing it, then submits each sprite
to the shared renderer. Rendering a paused frame therefore does not change the
simulation state.

We support these particle material families:

- `CommonParticle/Standard/Blend` and `CommonParticle/TexAlpha/Standard/Blend` double the texture, particle, and material color before clamping it.
- `CommonParticle/Simple/Blend` and `CommonParticle/TexAlpha/Simple/Blend` use the same inputs without doubling them.
- `CommonParticle/Standard/Multiply` doubles and clamps the inputs, then turns the result into a multiplier before applying the material's `ZERO` / `SRC_COLOR` blend state.
- `CommonParticle/Standard/AddtiveMultiply` uses doubled RGB and derives alpha from its RGB luminance and `_MultiplyTex` red channel. We use the shader's white default when that texture is not assigned.

We take transparency from the texture when it is present. For `TexAlpha` materials,
we use the separate Alpha8 mask or the red channel of a color mask. We read each
material's source and destination blend factors and submit them to WebGL. We
report an error when a shader or render state has not been covered.

We keep separate X and Y start sizes when a particle system enables 3D size,
and we apply the renderer's Billboard pivot. We project X, Y, and Z particle
rotation for tilted Billboard effects. This restores the authored tilt in effects
such as floor light patterns while retaining the preview's orthographic camera.

## Known limits

The following are outside the current browser model:

- Exact random/noise kernels, noise-driven size and rotation, and camera-specific 3D Billboard perspective.
- Mesh particle layouts other than the embedded Float32 geometry and the observed Unity default Quad. We rotate these in 3D and project them into the 2D preview. We leave other layouts out instead of presenting their texture as a billboard.
- Burst emission, rate over distance, trails, collision, sub-emitters, and external force fields.
- Camera-bone binding, startup simulation policy, runtime scale compensation, clipping timing, soft particles, and post-processing.
- Distance sorting within an emitter and exact resolution of render-queue, depth, or equal-order ties.

These are implementation boundaries, not claims about the reference game's
final presentation.

## Emitter inspector

The inspector is a separate page that calls `renderOnce()` and then pauses. It
shows authored emitter centres, projected shape volumes, material and texture
references, lifetime, module settings, and renderer sorting metadata. It uses
the same scene fit and one Y reflection as the player. The marker is an emitter
centre and a volume is its authored shape bounds, not a captured particle path.

`sortingOrder` is displayed for diagnosis. The player uses the documented
cross-object base and a stable fallback for equal keys. We do not claim that
the inspector resolves every final scene-order case.

## Where to change the player

| Goal | Primary file |
|---|---|
| Discover additional scene data | `src/card-loader.js` |
| Change cross-object submission order | `web/render-plan.js` |
| Change timing, state ownership, or presentation | `web/scene-runtime.js` |
| Change particle simulation or sprite evaluation | `web/particle-simulation.js`, `web/particle-overlay.js` |
| Change particle shader and blend support | `web/particle-material.js`, `runtime/spine-webgl.js` |
| Change atlas composition or preview fit | `web/viewer.js` |
| Change Spine/particle WebGL output | `runtime/spine-webgl.js` |
| Change loading cancellation | `web/load-session.js` |
| Change static inspection | `web/particle-inspector.js` |

Edit the canonical files, then synchronize the standalone folder with
`npm run sync:standalone`. `npm run check:standalone` reports unsynchronized
shared modules.
