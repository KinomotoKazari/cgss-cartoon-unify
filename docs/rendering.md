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

We use authored orbital X/Y/Z speeds, orbit offsets, and radial speed in the
particle's local space. We use a deterministic midpoint step for that motion.
This follows the documented behavior of those fields, but the exact Unity tick
and random sequence are not verified. We treat the resulting positions as an
approximation until they can be checked against matched playback frames.

### Material and blend matrix

We choose a particle rule from the shader name, the material's blend bindings,
and the decoded texture formats. The shader name alone does not determine the
blend mode. We read `_BlendSrc` and `_BlendDst` for each material instance.
We also preserve source-color and inverse-destination-color factors when a
material uses them. We do not replace these factors with alpha blending.

| Shader family | Fragment calculation | Alpha input | Blend handling |
|---|---|---|---|
| `CommonParticle/Standard/Blend` | Doubled and clamped texture × particle × material color | Main texture alpha | Material bindings |
| `CommonParticle/Simple/Blend` | Texture × particle × material color | Main texture alpha | Material bindings |
| `CommonParticle/TexAlpha/Standard/Blend` | Doubled and clamped texture × particle × material color | `_AlphaTex` | Material bindings |
| `CommonParticle/TexAlpha/Simple/Blend` | Texture × particle × material color | `_AlphaTex` | Material bindings |
| `CommonParticle/Standard/AddtiveMultiply` | Doubled RGB with luminance-derived alpha | `_MultiplyTex` red channel | Material bindings |
| `CommonParticle/Standard/Multiply` | Doubled and clamped input used as a multiplier | Main texture alpha | `ZERO` / `SRC_COLOR` |

We have checked these material bindings in representative bundles:

| Card effect | Shader family | `_BlendSrc` / `_BlendDst` | Main and mask format | Selected alpha path |
|---|---|---|---|---|
| 100108 stars, 201389 bubbles | `Standard/Blend` | 5 / 1 | ETC_RGB4, no mask | Main texture |
| 100108 sleeve glow | `Standard/AddtiveMultiply` | 5 / 1 | ETC_RGB4, no multiplier texture | RGB luminance with white multiplier |
| 100108 leaves | `TexAlpha/Simple/Blend` | 5 / 10 | ETC_RGB4 + ETC_RGB4 | Mask red channel |
| 100281 water splashes | `Simple/Blend` | 5 / 1 | ETC_RGB4, no mask | Main texture |
| 100398 flower effects | `TexAlpha/Standard/Blend` | 5 / 1 | ETC_RGB4 + ETC_RGB4 | Mask red channel |
| 101138 circle effects | `Standard/Blend` | 4 / 1 | ETC_RGB4, no mask | Main texture |
| 101287 smoke effects | `TexAlpha/Simple/Blend` | 4 / 1 | ETC_RGB4 + ETC_RGB4 | Mask red channel |
| 300815, 300895, 301056 effects | `Standard/Blend` | 3 / 1 | ETC_RGB4, no mask | Main texture |

We map factor 5 to `SRC_ALPHA`, 1 to `ONE`, and 10 to
`ONE_MINUS_SRC_ALPHA`. We also support shader bindings that use
destination factors 5, 6, or 7. `Standard/Multiply` requires 0 / 3, or
`ZERO` / `SRC_COLOR`. Other factors or unsupported render states fail clearly.

We support main textures in Alpha8 (1), RGB24 (3), RGBA32 (4), RGB565 (7),
and ETC_RGB4 (34). For `TexAlpha`, we read Alpha8 from its alpha channel and
other supported mask formats from their red channel. We only combine
`_AlphaTex` when the selected shader uses it. We only combine `_MultiplyTex`
for `AddtiveMultiply`. We reject unknown shader names, texture formats, blend
factors, and render states instead of silently choosing a similar rule.

We mark three cases as approximations. A non-additive Standard material with
ETC_RGB4 and no separate alpha uses an RGB-derived coverage mask. A different
non-additive material with an opaque main texture keeps that texture's decoded
alpha. A `TexAlpha` material without an assigned mask uses white. These paths
remain visible as `materialConfidence: approximation` on the emitter. We do
not apply the RGB coverage mask to additive stars or bubbles because their
black texture pixels already contribute no light.

We derived the fragment calculations from the shader programs stored in the
bundles. We read blend bindings and texture formats from each bundle's material
and texture objects. The approximation labels identify behavior that still
needs visual confirmation.

We keep separate X and Y start sizes when a particle system enables 3D size,
and we apply the renderer's Billboard pivot. We project X, Y, and Z particle
rotation for tilted Billboard effects. This restores the authored tilt in effects
such as floor light patterns while retaining the preview's orthographic camera.

We treat Shape type 8 as ConeVolume. We sample birth positions throughout its
authored length and angle. This gives sleeve and other volume emitters a spread
at birth rather than collapsing them to the emitter centre. The exact Unity
sampling distribution still needs a visual comparison.
We map Shape types 10, 11, 12, 15, 16, 17, and 18 to Circle, CircleEdge,
SingleSidedEdge, BoxShell, BoxEdge, Donut, and Rectangle. We sample Circle
particles from the authored radius and radius thickness, then launch them in
the radial direction. This restores the expanding ring geometry used by the
fireworks on card 201291. We use the same mapping for every card.
We also mirror the initial travel direction when a Shape axis has a negative
scale. This lets emitters with a negative forward scale send particles across
the card in the authored direction, including the leaves on card 101063.

We orient Stretch Billboards from the same effective velocity used by particle
motion. This includes VelocityModule XYZ, its speed modifier, accumulated
forces, orbital movement, and the emitter transform. We calculate the authored
base length relative to particle width. We place that length on the texture's
local X axis and keep local Y as its cross width. This keeps rising firework
tails aligned with their vertical motion instead of leaving a wide horizontal
quad. We map texture U=0 to the motion-facing end for this render mode. The
bright launch head therefore rises above the fading exhaust instead of pulling
the exhaust ahead of it. We also enforce the renderer's screen-space
`m_MaxParticleSize` limit after stretching. For Mesh particles, we measure the
authored mesh bounds before applying that limit. This prevents normalized mesh
coordinates from shrinking a second time while still limiting their final
projected size. It also prevents long launch textures from becoming full-height
lines while keeping the authored launch geometry.
We anchor the motion-facing edge of a Stretch Billboard at the simulated
particle position and extend the remaining quad backwards. This lets launch
tails emerge progressively from their authored origin, prevents the visible
head from overshooting the motion endpoint, and keeps it aligned with a burst
authored at that endpoint.

We retain TrailModule history at fixed simulation ticks. We use the authored
lifetime multiplier, minimum vertex distance, ratio, width, color, color
inheritance, and particle death policy. We multiply each trail lifetime by its
owning particle lifetime as required by the stored TrailModule value. We wait
for the particle to travel `minVertexDistance` before drawing its first ribbon
segment. After that segment exists, we keep the attached head moving every tick
between committed history vertices. We attach texture U=0 to that live head and
fade toward U=1 at the oldest retained point. We
resolve renderer material slot 1 independently and submit the trail strip
through the same ordered WebGL target as its particle head. Advanced ribbon,
world-space, lighting, and alternate texture modes remain listed by the local
coverage report.

We emit particles from the bundle's timed bursts as well as its continuous
rate. We use each burst's count, repeat interval, cycle limit, and probability.
We include bursts during prewarm and repeat them when the system loops. This
restores intermittent effects such as flying leaves on card 101063. Our fixed
step schedule is stable across browser frame rates, while the exact Unity
random sequence remains unverified.

We apply the bundle's Noise settings to particle position, size, and rotation.
We use a deterministic curl-like derivative field for position. This prevents
low-frequency damped Noise from multiplying raw position samples into very fast
motion, as seen with white particles on cards 301202 and 100468. We keep size
on its separate scalar field so position damping does not enlarge or collapse
sprites. We also keep the existing rotation path and integrate it during fixed
simulation ticks. The field and its channel mapping remain approximations, not
a claim of exact Unity output. We still need a visual check of these cards and
of the size distribution on cards that use `NoiseModule.sizeAmount`.
We retain `NoiseModule.quality` in the parsed scene data, but the substitute
field does not yet reproduce its sampling behavior. We list it separately in
the local coverage report.

We found five Unity version labels across the 1,566-card check: 2018.3.8f1
(734 cards), 2018.4.27f1 (144), 2020.3.8f1 (577), 2022.3.37f1 (29), and
2022.3.40f1 (82). We keep each bundle's version in the load plan. We do not
assume that one measured Noise sequence would apply to every version.

## Known limits

The following are outside the current browser model:

- Exact random/noise kernels, version-specific Noise behavior, and camera-specific 3D Billboard perspective.
- Mesh particle layouts other than the embedded Float32 geometry and the observed Unity default Quad. We rotate these in 3D and project them into the 2D preview. We leave other layouts out instead of presenting their texture as a billboard.
- Rate over distance, advanced trail modes, collision, sub-emitters, and external force fields.
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
