# Jiko One hero print model

This is the standalone, high-fidelity external model for the Jiko website
look. It is generated from the current Three.js showcase proportions in
`apps/web/src/ui/ShowcaseStage.tsx`, with physical millimetre dimensions from
`docs/hardware-phases.md`.

The source components are not redesigned here. Existing Three.js geometry,
screen data and the inline `THERMAL_*` paths in `ShowcaseStage.tsx` are reused; the generator only gives
them physical direction, depth, relief, and printable tolerances.

Generate it from the repository root:

```sh
. .venv-model/bin/activate
python tools/jiko-model/generate_jiko_model.py
```

Primary deliverables:

- `jiko-one-assembly.stl` — the complete hero assembly for slicing/inspection.
- `jiko-one-structural-chassis.stl` — one watertight fused body, button mount,
  and side button for single-material structural printing.
- `jiko-one-print-assembly.step` — print assembly using the fused chassis plus
  separate screen/USB-C/screw details.
- `jiko-one-assembly.step` — named CAD assembly compound.
- `jiko-one-assembly.glb` — colored, named parts for Three.js inspection.
- individual STL files — separate shell, screen relief, USB-C parts, rounded
  button, and two rear screws for multi-material or multi-part prints.

The intended body envelope is 80.08 × 120.12 × 6.60 mm. The body has one real
left-edge mark cut directly from the six runtime `THERMAL_SHOU`,
`THERMAL_WAN`, and `THERMAL_HUO` paths, a top
mic bore/countersink, a layered bottom USB-C opening, and an inset rear
service-panel score. There are no extra
cross/square edge marks. The rounded side rail, USB-C shield/mouth/tongue and
two rear screws are separate solids.

Physical tuning used by the current export:

- Runtime path mark: exact six-path set SHA-1
  `bd836fdb25fc99c414809de5b0f25241ff3e11c8`; 8.29 mm along the body
  height, 5.35 mm across the side-face depth, transformed like the Three.js
  canvas, vertically rotated 180° and then flipped left-to-right as one asset,
  with a 2.0 mm cut into the shell.
- Rear service-panel groove: the center panel remains flush with the rear body;
  only the approximately 0.35 mm-wide ring is cut 0.32 mm inward.
- Rear screws: two diagonal heads with one horizontal minus recess each.
- Side control: 7.04 × 55.26 × 5.28 mm with a 1.98 mm corner radius. The entire
  button is translated 2.586 mm left and overlaps the body directly by 0.10 mm;
  no connecting line or intermediate mounting neck is generated.
- USB-C: 0.80 mm outer recess, a real metal ring, a dark back wall 2.8 mm
  inside, and a tongue connected to that back wall.
- Corner systems remain distinct: body radius 6.60 mm with exponents 4.2/3.8;
  glass exponent 3.5; USB-C outer recess/lip exponent 3.2 with approximately
  0.99/0.74 mm radii. Only the inner Type-C mouth uses semicircular ends.
- Screen glass: 0.28 mm physical layer; lit dots 0.42 mm and dim dots 0.16 mm.

The screen reproduces the current website state as physical relief: three
status dots, `11:33`, `TUE`, `JUL 21`, battery detail, and complete king/tree/
oracle 9×9 pixel matrices. Lit and dim dots are separate named solids for
painting or multi-material printing.

This is a high-fidelity appearance print, not a production enclosure release.
No measured Jiko One PCB, battery, speaker, connector keep-out, or mounting
insert layout exists in the repository, so the internals are intentionally not
invented. Confirm wall thickness, cable fit, acoustic opening, and material
tolerance against the actual stack before printing a functional enclosure.
