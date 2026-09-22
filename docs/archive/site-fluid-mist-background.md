# Archived Fluid Mist Background

Status: **Archived — not used by the official site**
Archived: 2026-07-29

## Original intent

The experiment began as a study of the first viewport on the Kimi Ambassador
page. The useful observation was its layered atmosphere: a stable mist image
established large black-to-grey masses while a full-screen canvas kept the
surface alive. The Jiko study tried to reproduce the mechanism without copying
the source asset, illuminated boundaries, or orbit graphics.

## Source implementation found

The visual was later inspected in the live Kimi page instead of inferred from a
screenshot. The decisive layer is a `1967 × 1311` WebP:

```text
https://www.kimi.com/lp-assets/_next/static/media/hero-mist.275d41ca.webp
```

At the time of inspection, the hero atmosphere used this stack from bottom to
top:

1. the WebP in a `110%`-high wrapper, `object-fit: cover`, centered, opacity
   `0.52`;
2. a full-viewport halftone canvas (`data-halftone-frame-rate="60"`);
3. a uniform black veil at `20%`;
4. a bottom `12%` transparent-to-black fade;
5. the content, followed by the orbit SVG/canvas on a higher layer.

The image has only a `1.075s` scale-in from `1.25` to `1`; the large mist mass
does not continuously flow. Most of the paper, embossing, and black/grey
contrast visible in a still frame is baked into the WebP. This explains why a
procedural fluid-only recreation kept reading as smoke.

The intended result was a warm-black field with:

- three scales of domain-warped fluid noise;
- a stable upper-grey / lower-black exposure structure;
- very slow continuous deformation;
- fine and medium monochrome grain;
- the original Jiko gradients and diagonal warm light underneath.

## Final experimental implementation

The prototype used a full-screen transparent WebGL canvas at 30 fps with device
pixel ratio capped at `1.35`. Its fragment shader used two domain-warp vectors
and five-octave value-noise FBM. The final scale mix was:

```text
macro   0.72 × coordinates, weight 0.59
middle  1.95 × coordinates, weight 0.29
small   5.20 × coordinates, weight 0.12
```

Time advanced at `u_time × 0.022`. A rolling exposure edge combined the macro
and middle fields, then mixed near-black `vec3(0.003)` with warm grey
`vec3(0.68, 0.67, 0.63)`. Fine and medium grain were sampled near one CSS pixel.
The surface was composited over the original site at `0.68` alpha.

The essential shader sequence was:

```glsl
vec2 firstWarp = vec2(fbm(p * 0.94 + t), fbm(p * 0.94 + 4.8 - t));
vec2 secondWarp = vec2(
  fbm(p * 1.72 + firstWarp * 2.1 + t * 0.18),
  fbm(p * 1.72 + firstWarp * 1.8 - t * 0.15)
);

float macro = fbm(p * 0.72 + (firstWarp - 0.5) * 2.2);
float middle = fbm(p * 1.95 + (secondWarp - 0.5) * 1.55);
float small = fbm(p * 5.2 + firstWarp * 0.78);
float fluid = macro * 0.59 + middle * 0.29 + small * 0.12;
```

## Why it was not adopted

The continuous domain warping created a recognizable smoke or vapour reading.
Even when its opacity was reduced, the eye interpreted the moving cloud edge as
a new cinematic background rather than texture already present in Jiko's site.
Increasing visibility made the mismatch stronger; decreasing it made the change
indistinguishable from the original site.

That conflict was structural, not a matter of one more parameter adjustment:

- Kimi's reference composition depends on a large photographic mist mass.
- Jiko's first viewport depends on a restrained warm diagonal light and a clear
  industrial product silhouette.
- Continuous clouds competed with the hardware as the main subject.
- The black/grey exposure structure weakened Jiko's existing warm palette.

## Replacement direction

The official site now keeps its original background composition and adds only a
paper-stock surface: stable coarse grain plus sparse, discontinuously resampled
flecks. It has no direction, cloud boundary, or continuous deformation.

The archived fluid field may still suit a future editorial interstitial,
installation screen, or standalone visual study where atmosphere is the main
subject rather than a layer behind product hardware.
