# Particle and shader analysis

This document describes the renderer that is in this repository. It distinguishes data that comes directly from a Unity bundle from browser-side behaviour that approximates Unity. The desktop preview and `web-cartoon-player/` use the same rendering model.

## Rendering path

```mermaid
flowchart LR
  A[UnityFS bundle] --> B[AssetBundle container]
  B --> C[Five Spine assets]
  B --> D[Effect prefab roots]
  C --> E[Atlas material]
  E --> F[_MainTex RGB + _AlphaTex]
  F --> G[Browser atlas canvas]
  D --> H[ParticleSystem + Renderer + Material]
  H --> I[_MainTex particle texture]
  G --> J[WebGL Spine renderer]
  I --> K[2D particle overlay]
  J --> L[Final canvas]
  K --> L
```

`src/card-loader.js` locates card entries through the `AssetBundle.m_Container` path. It requires the five named card skeleton layers and sorts them as `bg → eff2 → chara → eff1 → fg`. It also examines every card `GameObject` entry whose hierarchy contains a `ParticleSystem`. We do not use a texture filename convention. This is why a card can include extra effect textures such as bubble images without a hard-coded list, while cards without an effect prefab do not create particle emitters.

The loader records hierarchy nodes, active state, and Transform ancestry in `plan.effectPrefabs`. Referenced object data and material properties live in `plan.objects`, while decoded texture buffers are in `card.textures`. The Worker transfers that plan and decoded RGBA buffers to the page. `particle-overlay.js` resolves the same reference chain at playback time:

```text
ParticleSystemRenderer.m_Materials[0]
  → Material.m_SavedProperties.m_TexEnvs._MainTex
  → Texture2D
```

The material `_Color` is retained and multiplied into the particle alpha. A missing texture referenced by an active emitter is an explicit load error. We do not silently substitute a bubble image.

## Particle simulation

Playback treats a `ParticleSystem` as an emitter when its GameObject is active, `EmissionModule.enabled` is true, and a `ParticleSystemRenderer` is present and not explicitly disabled. The browser model reads the following serialized values:

| Unity data | Browser behaviour |
|---|---|
| `InitialModule.startLifetime` | Particle lifetime. A scalar or the scalar/min-scalar random range is selected deterministically. |
| `InitialModule.startSize` | Draw size in scene units, then transformed by the Spine scene fit. |
| `InitialModule.startColor` | Initial alpha source. The current implementation uses `maxColor` rather than a full colour-gradient evaluation. |
| `InitialModule.maxNumParticles` | Upper bound for the generated particle count. |
| `EmissionModule.rateOverTime` | Calculates a steady-state count near `rate × average lifetime`. |
| `ShapeModule.m_Position` and `m_Scale` | Uniform starting position in the module's local rectangular bounds. |
| `VelocityModule.x/y` | Integrates constant or Hermite curve velocity over particle age. |
| `ColorModule.gradient.maxGradient` | Alpha-gradient interpolation across normalized lifetime. |
| `UVModule` | Samples start frame and frame-over-time across the whole texture sheet. |
| `simulationSpeed`, `prewarm`, `lengthInSec` | Advances time, including a prewarm offset. |
| GameObject Transform chain | Applies local scale, Z rotation, position, and ancestors before conversion to canvas space. |

Particles are procedural rather than stored frame by frame. A fixed seed derived from the emitter and particle index gives stable preview motion for a load session. The current count is:

```text
lifeMin = min(startLifetime.scalar, startLifetime.minScalar)
lifeMax = max(startLifetime.scalar, startLifetime.minScalar, 0.01)
rateMax = max(rateOverTime.scalar, rateOverTime.minScalar, 0)
count   = min(maxNumParticles || Infinity,
              max(1, ceil(rateMax × (lifeMin + lifeMax) / 2)))
```

This count is a preview estimate, not a simulation of emission events. Its minimum of one means even a zero-rate eligible emitter can produce a particle. A zero particle limit is treated as unbounded. These are current approximation limits.

For every frame, age wraps by its chosen lifetime. For additive effects, the browser adds a visual fade independent of the Unity asset data:

```text
fadeIn(age)  = smoothstep(0.00, 0.18, age)
fadeOut(age) = 1 - smoothstep(0.70, 1.00, age)
opacity      = startAlpha × materialAlpha × colorGradientAlpha
             × fadeIn × fadeOut × 1.6
```

Here `age` is normalized lifetime, and final opacity is clamped to [0, 1]. Fade thresholds, highlight gain, and texture contrast are grouped in the `appearance` settings in `web/particle-overlay.js`. They are preview tuning, not values recovered from a Unity material.

Before drawing, particle images are prepared once per emitter. Additive materials transform each RGB channel as `min(255, 4 × channel² / 255)` and use Canvas 2D `lighter`. Black remains black and bright edge pixels become brighter. Materials with `_BlendDst = 10` use source-over compositing and their authored alpha without bubble contrast or extra fades. A referenced `_AlphaTex` supplies the mask from red, or from A for decoded Alpha8 textures.

The feather correction adds initial rotation, integrated rotation-over-lifetime, particle size scaling, and rotated shape bounds. Curve calculations live in `web/particle-math.js`. Weighted tangents, full 3D motion, exact emission scheduling and all Unity texture animation modes remain unsupported. See [Feather analysis](feather-analysis.md) for card 100612, the original failure, and verification results.

### Reference-card findings

The inspected particle card, 201389, contains one effect prefab with 22 `ParticleSystem` components. Its root system has emission disabled and no usable material. The 21 child emitters are the visible systems. They are active, looped, use `playOnAwake`, have no start delay, and are prewarmed. The preview therefore begins their shared clock when the card viewer is created and does not reset that clock when the Spine animation loops or playback resumes.

Its point emitters use a `2 × 2` texture sheet, while the circular emitters use individual bubble textures. The particle material fields identify `CommonParticle/Standard/Blend` with saved source-alpha/additive blending values. The exported shader text also describes a brightened particle colour, but Unity shader bytecode is not executed by this project. The Canvas `lighter` path remains an approximation of those material settings, rather than a claim of shader-equivalent output.

## Particle order and limits

All Spine layers are rendered first, then all particles are composited on the final 2D canvas. Emitters are sorted by their serialized sorting-layer index and signed sorting order, with discovery order as a stable tie-breaker. Sorting-layer IDs are not interpreted as numeric priorities. This corrects ordering between particle renderers, but does **not** establish their order relative to Spine. Render queues, depth buffers, game-side order overrides and per-particle sorting are still unsupported. An effect that should pass behind a character can therefore still appear in front.

The following Unity particle features are not implemented or are only partially represented:

- Burst emission, duration/loop stop semantics, start delay, and explicit simulation space.
- Shape geometry beyond the current rectangular position/scale sampling.
- Rotation over lifetime, size over lifetime, texture-sheet frame animation, trails, collision, sub-emitters, force fields, and custom vertex streams.
- Noise, gravity, limit velocity, inherit velocity, external forces, lights, and custom simulation jobs.
- Full `MinMaxCurve` evaluation, random colours, colour RGB gradients, and material-specific particle shader properties.
- Unity renderer sorting, soft particles, depth fading, fog, bloom, and post-processing.

These omissions are deliberate boundaries of the browser preview. A closer Unity reproduction would need a broader Shuriken simulation and a particle shader pipeline rather than further brightness constants.

## Emitter position inspector

The card preview and the position inspector are separate pages. The desktop server maps `/` to the card preview and `/emitter_debug.html` to the inspector. The standalone folder provides `index.html` and `emitter_debug.html`. The inspector is generated from the bundle currently loaded. It does not rely on a list of bubble names or precomputed coordinates for a particular card.

The inspector explicitly calls `renderOnce()` and pauses, so its background is a static reference frame. Its discovery requires an active GameObject, enabled emission, a renderer, and a texture reference. Unlike playback, it currently does not check `renderer.m_Enabled`, so disabled renderers can still appear as diagnostics.

For each discovered emitter, it displays the Transform-derived world centre, the projected ShapeModule volume, particle texture and material, lifetime, start size, emission configuration, prewarm/play-on-awake flags, UV tiles, enabled modules, `ParticleSystem` ID, and `ParticleSystemRenderer.m_SortingOrder`. The SVG overlay uses the same scene fit and one Y reflection as the rendered card.

To calculate a volume, the inspector expands all eight corners of `ShapeModule.m_Scale`, applies `ShapeModule.m_Rotation` in Unity Z-X-Y Euler order and `ShapeModule.m_Position`, then applies the emitter Transform and every ancestor Transform. It projects the resulting points to the canvas and draws their two-dimensional convex hull. A marker is the authored emitter centre, not a sampled particle position. A volume is the module's authored bounds, not its noise- or velocity-expanded path.

Circular effects are identified only for the inspector's filter colour by the current `eff_circle` GameObject naming convention. Emitter discovery itself is reference-based. `sortingOrder` is shown as evidence from the source asset and is not converted into a five-Spine-layer index, because the bundle alone does not prove the game-side parent transform or cross-renderer order override.

## Spine atlas composition

CGSS cards use a material with separate RGB and alpha Texture2D references. `viewer.js` builds an atlas canvas by drawing `_MainTex`, then applying `_AlphaTex` with Canvas 2D `destination-in`. This composes the final alpha before the image reaches WebGL and avoids the black-background artifact that appears when RGB texture data is treated as already-transparent pixels.

Texture decoding accepts Alpha8, RGB24, RGBA32, RGB565, and ETC_RGB4. Unity texture rows are flipped from bottom-to-top into browser image order. The renderer requires one atlas page and matching RGB/alpha dimensions. Multi-page Spine atlases currently fail with an explanatory error.

## Spine WebGL shader

`runtime/spine-webgl.js` contains a small WebGL 1 renderer for Spine regions and meshes. It renders each layer's attachment draw order as triangles, batches consecutive triangles with the same texture and blend mode, and uses linear filtering plus clamp-to-edge texture wrapping.

The vertex shader receives already transformed normalized-device coordinates, UVs, and Spine colour values. The fragment shader samples the composited atlas and uses premultiplied output:

```glsl
vec4 t = texture2D(uTex, vUV);
float a = t.a * vColor.a;
gl_FragColor = vec4(t.rgb * vColor.rgb * a, a);
```

The renderer multiplies skeleton, slot, and attachment colours before passing `vColor`. It maps Spine blend modes to the following WebGL blend functions:

| Spine slot blend | WebGL source / destination |
|---|---|
| Normal | `ONE`, `ONE_MINUS_SRC_ALPHA` |
| Additive | `ONE`, `ONE` |
| Multiply | `DST_COLOR`, `ONE_MINUS_SRC_ALPHA` |
| Screen | `ONE`, `ONE_MINUS_SRC_COLOR` |

The WebGL canvas is copied to the visible canvas before the 2D particle overlay draws. The dedicated shader is for Spine geometry only. Unity `Shader` references are retained as metadata, but their bodies are not decoded or traversed, so the project does not execute, translate, or inspect Unity shader bytecode. For particles, the only Unity material properties currently consumed are `_MainTex` and `_Color`. Their glow comes from the browser-side texture transform and additive Canvas compositing described above.

## Where to change the preview

| Goal | Primary file |
|---|---|
| Discover additional particle asset data | `src/card-loader.js` |
| Preserve more serialized material or renderer fields | `src/card-loader.js` |
| Change particle timing, fade, sampling, or glow | `web/particle-overlay.js` |
| Change scene fitting or atlas RGB/alpha composition | `web/viewer.js` |
| Change Spine geometry shader or slot blending | `runtime/spine-webgl.js` |
| Change loading cancellation and viewer ownership | `web/load-session.js` |
| Change static inspector setup | `web/preview-page.js` |
| Change emitter markers or diagnostic fields | `web/particle-inspector.js` |

Edit the canonical files listed above, then run `npm run sync:standalone` and `npm run check:standalone` from the repository root. The standalone copies are distribution outputs. Do not maintain them by hand. Run the relevant browser checks after rendering changes. The [README](../README.md) lists module ownership and limits. [Validation](validation.md) lists the test commands.
