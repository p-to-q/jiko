# Showcase Design Decisions

This note records the current visual decisions for `site.html` and `showcase.html`.
It is a prototype design trace, not a final CAD or manufacturing spec.

## Product Position

Jiko should read as a small signal instrument, not an assistant screen and not a cute companion. The hardware can feel alive, but the product stance stays restrained: it gives signals, then leaves the decision with the person.

The current first-view copy is:

```text
Meet Jiko
instant decision making instrument
that gives your thoughts [red/yellow/green]
And leaves free will intact.
```

## Surface Model

The repo currently has three visual surfaces:

- `/?mode=device`: the real device face for Raspberry Pi / MPI3508 kiosk use.
- `showcase.html`: a standalone hardware renderer for material, geometry, and motion study.
- `site.html`: the official-site first viewport, using the same hardware renderer inside a minimal framed composition.

The site and showcase pages are visual studies. They should not become alternate product runtimes or bypass the shared event model used by the main app.

## Site Frame

The official-site study uses a centered 1200 px frame with two quiet vertical rules, matching the reference landing-page rhythm where the rules sit at `40px` and `1240px` in a 1280 px viewport. The frame keeps compact endpoint ornaments near the viewport edge:

- Top/bottom breathing room: 32 px on desktop, reduced slightly on mobile.
- Top: outward 45-degree right-triangle marks, 36 x 36 px, attached to the top of the vertical rules. The right-angle corner stays sharp; the two non-right corners use a restrained mirrored SVG path radius.
- Bottom: hollow circles that touch the vertical rules.
- Color: solid `#7e7d7b`, visually equivalent to the earlier translucent rule on the warm-black background.
- Joint handling: endpoint ornaments and vertical rules may touch or overlap because the frame uses one solid color instead of translucent strokes.

The frame is intentionally minimal. It should not become a decorative border system with extra labels, panels, or cards.

## Typography And Color

- Main copy uses Stack Sans Headline 500 at a large display scale.
- The final human line uses Instrument Serif italic.
- The hero copy uses a broad 1080 px measure inside the frame, with a quieter 50 px display size on desktop.
- The first-view balance keeps the 1200 px frame fixed, then tunes the inner elements: text first, hardware second, project credit last. The project credit sits after the hardware stage in document flow so it does not overlay the live canvas.
- The title is four explicit rows with equal row gaps; the Jiko wordmark is treated as part of the first row, not as a separate vertical layer.
- Text color is `#eae8e0`.
- Page background is a dark warm black, currently `#1f1e1a`.
- The `free will` underline is a real button so it can trigger the hardware celebration without adding visible UI controls.

## Hardware Geometry

The body follows the Framer F1 / physical squircle direction:

- Body: asymmetric superellipse, `mx=4.2`, `ny=3.8`.
- Glass/screen edge: softer superellipse, `n=3.5`.
- This gives the chassis a more precise, slightly stranger edge while keeping the display glass gentler.

The intent is not to make every rounded object identical. The shell and glass should share a curve family; small mechanical details can use simpler geometry when that makes them feel more physical.

The shared squircle point generator lives in `apps/web/src/ui/squircleGeometry.ts`.
Three.js geometry and canvas clipping should both use it so the hardware body
and live screen texture do not drift into different corner systems.

## Screen Treatment

The screen is a live canvas texture, not a static image. Its outer clip now uses the same softer glass family (`n=3.5`) so the screen and reflective glass layer do not look like mismatched corners.

The active screen still fills almost the full front face. Internal LED windows and small indicators can keep simpler tiny radii because they are part of the pixel-screen language, not the metal/glass enclosure language.

## Left-Edge Thermal Vents (Deferred)

The left edge (opposite the side button) has a vertical array of thermal slots.
Design studied but not yet rendered — recorded here for future reference.

Layout (top to bottom):
- 4 long stadium slots (width 0.010—0.012, height 0.180—0.200, gap 0.020—0.022)
- 1 bottom composite: short stadium slot + squircle square (size ~0.035—0.040)

Positioning intent:
- Left side face, symmetric to right button, at z ≈ bodyDepth × 0.1
- Geometry must sit at or slightly outside the body surface
  (x = -(bodyW / 2 + bevel + small offset)) to avoid occlusion by the
  beveled body shell
- Dark recessed appearance with MeshBasicMaterial / MeshPhysicalMaterial

Implementation notes (from failed attempts):
- ExtrudeGeometry with rotation.y = -π/2 creates an extrusion along +X
  (into the body), but the body's bevel pushes the left surface outward,
  so the vent outer face must be at x < bodySurfaceAtZ.
- At z near bodyDepth/2 the bevel is significant (~0.020 at z=0.069).
  At z = bodyDepth × 0.1 the bevel is negligible and the body surface
  is exactly at x = ±bodyW/2.
- Flat ShapeGeometry (no depth) avoids z-fighting but lacks a recessed look.
- Opaque body + DoubleSide vent material: the vent's dark back cap
  (at x = sideX + depth) is occluded by the body surface unless the
  entire vent protrudes outside the body.
- A viable solution may need polygonOffset on the vent material, or
  placement on a flat portion of the side face where the body surface
  is well-defined (z ≈ 0 to bodyDepth × 0.15).

## Side Button Exception

The right-side button should not use the body squircle. It remains a narrow rounded hardware rail with ordinary quadratic rounded corners. This keeps it reading as a separate mechanical button attached to the side rather than as another piece of the front glass system.

## Motion

The hardware has two motion layers:

- Idle motion: lazy, irregular rotation between a few nearby angles, with occasional pauses.
- `free will` celebration: two full turns in a random direction with eased acceleration/deceleration and a small vertical bob.

Manual dragging and the celebration both operate on the same Three.js hardware group so the screen, body, and button stay synchronized.

## Current Guardrails

- Do not route this page through the product session logic.
- Do not add marketing sections until the first viewport shape is settled.
- Do not make the Pi/display mockup larger than the product intent needs.
- Do not apply the superellipse language indiscriminately to every small element.
