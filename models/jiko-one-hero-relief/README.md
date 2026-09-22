# Jiko One enhanced screen-relief print

This variant preserves the standard model's X/Y geometry and all hardware
details, but makes the front-screen geometry easier to retain in slicing and
physical printing.

Generate it with:

```sh
. .venv-model/bin/activate
python tools/jiko-model/generate_jiko_model.py --relief-print
```

Enhanced Z relief:

- Screen glass: 0.50 mm, overlapping the body by 0.08 mm.
- Top text: 0.65 mm.
- Weekday dot diameter: 0.70 mm.
- Month/date dot diameter: 0.64 mm.
- Status dots: 0.75 mm.
- Battery outline/cells: 0.60/0.70 mm.
- Window bases: 0.40 mm.
- Lit sprite dots: 0.80 mm.
- Dim sprite dots: 0.40 mm.
- Screen details overlap the glass by 0.08 mm to avoid zero-thickness contact.

The weekday and date retain their original center spacing, but their physical
dots are deliberately wider than a 0.4 mm nozzle. Adjacent lit dots may merge
slightly into durable dot-matrix strokes instead of being removed by slicing.

The standard model remains in `models/jiko-one-hero` and is not overwritten.

## Bambu Studio: rear-side-down print file

Use `jiko-one-hero-back-flat.stl` when printing the device with its rear face
on the build plate. The regular hero model retains the two visible rear screws;
their heads extend 0.43 mm beyond the shell and make the broad rear face float
above the plate when Bambu Studio runs **Place on Face**. The back-flat file
removes only those rear visual screw parts, so the rear shell itself is one
continuous, coplanar first layer.

For this orientation, keep 100% scale, select the rear face with **Place on
Face**, and add a 5–8 mm external brim. The separate original
`jiko-one-hero.stl` remains available for visual inspection or a different
print orientation.
