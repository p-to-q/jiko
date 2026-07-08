# Hardware Phases

This document defines the two hardware phases and the physical dimensions that
flow from the USB-C reference.

## Phase Names

| Name | Phase | What it is |
| --- | --- | --- |
| **Jiko Zero** | Hackathon / proof-of-concept | Raspberry Pi 5 + MPI3508 3.5-inch display as a quick, visible physical shell. |
| **Jiko One** | Advanced prototype | Custom compute chip, current squircle industrial form, and on-board audio pipeline. The outer look from the showcase study moves into this phase. |

Jiko Zero proves the interaction ritual. Jiko One is the first step toward a
self-contained signal instrument.

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

## Thermal Vent Layout (Left Edge)

The design intent is a vertical array of five openings on the left side. The
recorded parameters are:

| Parameter | Model value | Physical size |
| --- | ---: | ---: |
| Single slot width (`slotW`) | 0.010 | **0.44 mm** |
| Single slot height (`slotH`) | 0.200 | **8.8 mm** |
| Slot-to-slot gap | 0.022 | **0.97 mm** |
| Bottom square size | 0.035 | **1.54 mm** |
| Total array height (4 slots + composite) | 1.088 | **47.8 mm** |

Layout, top to bottom:

1. Long slot 1 — 0.44 × 8.8 mm
2. Long slot 2 — 0.44 × 8.8 mm
3. Long slot 3 — 0.44 × 8.8 mm
4. Long slot 4 — 0.44 × 8.8 mm
5. Bottom composite — short slot (0.44 × 8.8 mm) + squircle square (~1.5 mm)

The array occupies about **40% of the left-side height**.

## Visual Reference

A schematic of the overall hardware, left side face, and vent layout is saved at
`docs/assets/vent-layout.svg`.

## Design Notes

- The 0.44 mm slot width is a narrow slit. For tooling or visibility it may be
  opened to 0.7–0.9 mm (model `0.015–0.020`) in the final Jiko One shell.
- The vent placement is on the left edge so the right edge can keep the side
  thumb rail. Heat placement should still be validated against the real internal
  stack once that stack is known.
- The dimensions above are proportions from the current showcase model, not a
  final CAD or manufacturing drawing.

## Code And Doc Map

| Phase | Code/doc anchor |
| --- | --- |
| Jiko Zero | `apps/device`, `docs/runtime-paths.md`, `docs/demo-runbook.md`, `docs/form-factor.md` MPI3508 sections, `docs/hardware-interfaces.md` Pi/MPI3508 notes. |
| Jiko One | `apps/web/src/ui/ShowcaseStage.tsx`, `docs/showcase-design-decisions.md`, `docs/form-factor.md` object-direction sections, this file. |
| Both | `packages/protocol`, `packages/core`, `packages/readings`, `docs/product-brief.md`, `docs/engineering-discipline.md`. |
