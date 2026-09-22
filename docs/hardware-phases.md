# Hardware Phases

This document defines the two hardware phases and the physical dimensions that
flow from the USB-C reference.

## Phase Names

| Name | Phase | What it is |
| --- | --- | --- |
| **Jiko Zero** | Hackathon / proof-of-concept | Raspberry Pi 5 + MPI3508 3.5-inch display as a quick, visible physical shell. |
| **Jiko One** | Advanced prototype | Linux-class compute module on a custom carrier, current squircle industrial form, and on-board audio pipeline. The outer look from the showcase study moves into this phase. |

Jiko Zero is intended to prove the interaction ritual; its target integration
receipt is still pending. Jiko One is the first step toward a self-contained
signal instrument. Custom silicon is explicitly deferred; see
[`hardware-compute-decision.md`](hardware-compute-decision.md).

## Dimension Reference

The model in `apps/web/src/ui/ShowcaseStage.tsx` uses normalized units. To turn
those into millimeters, anchor on the USB-C female port opening.

Real USB-C female receptacle (metal shield outer dimensions):

- Width: **8.34 mm**
- Height: **2.56 mm**

Model USB-C mouth in `buildUsbCPort`:

- `usbW = 0.19`
- `usbH = 0.052`

Using the width as the most recognizable reference:

```text
scale = 8.34 mm / 0.19 ≈ 43.9 mm/unit  →  round to 44 mm/unit
```

Rounded scale: **1 normalized unit = 44 mm**

## Overall Body Dimensions

From `ShowcaseStage`:

```ts
const bodyW = 1.82;
const bodyH = bodyW / (2 / 3);  // 2.73
const bodyDepth = 0.15;
```

| Dimension | Model value | Physical size |
| --- | ---: | ---: |
| Body width (X) | 1.82 | **80.1 mm** |
| Body height (Y) | 2.73 | **120.1 mm** |
| Body depth (Z) | 0.15 | **6.6 mm** |

That gives an approximate overall envelope of **80 mm × 120 mm × 6.6 mm**.

## Left Side Face

The left side face is the vertical extruded wall at `x = -bodyW / 2`.

| Surface | Size |
| --- | --- |
| Overall height | 120.1 mm |
| Overall depth | 6.6 mm |
| Bevel on each edge | `0.026 × 44 ≈ 1.14 mm` |
| Flat visible surface after bevels | `6.6 - 2 × 1.14 = 4.3 mm` wide |

So the practical left-side flat surface is about **120 mm × 4.3 mm**.

## Current Left-Edge Thermal Mark

The previous vertical slot array is retired. The current Jiko One uses the six
inline `THERMAL_SHOU`, `THERMAL_WAN`, and `THERMAL_HUO` paths in
`ShowcaseStage.tsx`; `buildThermalMark()` draws them at runtime.

- The six-path runtime mark is the only intentional feature on that local edge region.
- Do not add the retired slot array, cross mark, square, or auxiliary opening.
- For a physical print, extract those exact runtime paths and reproduce their
  Canvas transform. Do not substitute an asset SVG, font, or redrawn shape.
- Final airflow must still be validated against the actual internal stack.

## Superseded Visual Reference

`docs/assets/vent-layout.svg` records the retired slot-array study. Do not use
it as the current Jiko One external reference.

## Design Notes

- The left edge keeps the `热` thermal feature; the right edge keeps the rounded
  thumb rail.
- The rear service-panel boundary is an inset score, not a protruding plate.
- The current rear uses two diagonal screws, matching `ShowcaseStage.tsx`.
- The dimensions above are proportions from the current showcase model, not a
  final CAD or manufacturing drawing.

## Code And Doc Map

| Phase | Code/doc anchor |
| --- | --- |
| Jiko Zero | `apps/device`, `docs/runtime-paths.md`, `docs/demo-runbook.md`, `docs/form-factor.md` MPI3508 sections, `docs/hardware-interfaces.md` Pi/MPI3508 notes. |
| Jiko One | `apps/web/src/ui/ShowcaseStage.tsx`, `docs/showcase-design-decisions.md`, `docs/form-factor.md` object-direction sections, this file. |
| Both | `packages/protocol`, `packages/core`, `packages/readings`, `docs/product-brief.md`, `docs/engineering-discipline.md`. |
