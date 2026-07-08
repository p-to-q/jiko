# Hardware Notes

## Hardware Phases

The repo tracks two hardware phases. See [Hardware Phases](hardware-phases.md)
for the full phase definition, USB-C scale reference, and physical dimensions.

- **Jiko Zero** — Hackathon prototype: Raspberry Pi 5 + MPI3508 display.
- **Jiko One** — Advanced prototype: custom chip, current squircle form factor,
  on-board audio path. The vent layout and dimensions are recorded there.

The notes below are oriented toward Jiko Zero construction, but the enclosure
principles (edge openings, front mask, side button) apply to Jiko One as well.

## Assumption

The current hackathon stack may use Raspberry Pi 5, but the product should be
treated as a Pi 5-sized signal instrument rather than a Raspberry Pi 5 case.
Keep the software lightweight enough that Pi-class fallback remains plausible,
and design the shell around the real product functions: display, listening,
heat, power, handheld use, and strap mounting.

Known hardware interface notes are tracked in [Hardware Interfaces](hardware-interfaces.md).
Physical form notes are tracked in [Form Factor](form-factor.md).

## Display Strategy

Use one physical screen behind a front mask.

Layout:

- One narrow top window.
- Three large stacked signal windows below it.

Why:

- One screen is much easier than driving three or four displays.
- The front mask creates the illusion of separate screens.
- The UI can be developed and tested on a laptop before Pi deployment.

The bottom windows can be circular lenses inside rounded-square recesses, or rounded-square screens with internal circular glow. Keep the traffic-signal memory without making the object a literal traffic light.

The confirmed screen is MPI3508: a 3.5-inch HDMI display with 480 x 320 physical resolution and optional resistive touch. The UI must be legible at a 320 x 480 rotated canvas.

## Button Strategy

Use one side thumb control for hold-to-record.

Why:

- A front fourth button would compete with the four-window screen layout.
- Side placement makes it feel wearable and handheld.
- Hold-to-record is robust in noisy rooms.
- Button state gives useful timing features: press time, release time, pre-speech delay.

Recommended interaction:

- Press and hold: recording starts.
- Release: recording ends and processing starts.
- Long hold with no speech: cancel or static.
- Double tap in dev mode: reset.

If the display occupies GPIO pins for touch/power, do not assume `GPIO17` is free. Use a USB HID button, USB serial microcontroller, or confirm a safe GPIO pin through the display's pin usage first.

Preferred physical shape: a long side rail or raised bar with one clear press point near the thumb.

## Enclosure Direction

The shell should feel like a compact field signal instrument, not a toy.

Recommended construction:

- Main body: black, smoke gray, or translucent dark 3D print.
- Front plate: matte black mask with four window cutouts.
- Window layer: acrylic or diffuser sheet.
- Back: shoulder-strap channel or removable clip.
- Edges/back: thumb button, USB-C/power exit, microphone aperture, and thermal
  vents.
- Internal: board mount, screen mount, cable relief, heat-set inserts, and
  enough air path for the warmest components.

Use M2.5 or M3 screws and heat-set inserts if possible. Avoid a snap-only case for the first prototype; iteration will be faster if the shell opens cleanly.

## Functional Openings

Start from the functions, not from Raspberry Pi port cutouts.

The front face should stay clean because it is the signal surface. Put utility
openings on the top, side, bottom, or back unless physical testing proves that a
front opening is required.

Preferred first-pass edge layout:

| Opening | Preferred location | Rationale |
| --- | --- | --- |
| USB-C power/data | Bottom edge, centered or slightly right-biased | Keeps cable exit predictable and visually secondary. |
| Microphone | Top edge, one small pinhole first | Reads as listening without looking like a camera or decoration. |
| Thermal vents | Left edge or rear side wall, five to seven narrow slots | Gives heat a path out without turning the face into a grille. |
| Screws/inserts | Back, two or four small points | Makes the first shell serviceable and believable. |

Do not use a speaker grille, sound slit, round-hole vent matrix, or copied Pi 5
port outline in the first visual direction. Those details make the object feel
like an electronics enclosure instead of a dedicated listening instrument.

## Backpack Strap Mount

Preferred mounting path:

- Vertical device, slightly proud of the shoulder strap.
- Back channel sized for common strap widths, with elastic/Velcro fallback.
- Device angled slightly outward so the screen faces observers.
- Side button placed where the thumb naturally lands while holding the strap.

Prototype path:

1. Print a flat backplate with strap slots.
2. Print the front mask separately.
3. Use screws or magnets to join the mask to the backplate.
4. Iterate thickness after confirming Pi, battery, and cable clearance.

## Audio Hardware

For laptop demo:

- Use laptop microphone or USB microphone.
- Do not require jiko's enclosure to provide playback hardware.

For the hackathon Pi-class prototype shell:

- Treat the Pi-class board and MPI3508 as the display object.
- Keep microphone capture, STT, audio features, and receipts on the laptop.

For a later Pi-local demo:

- Prefer USB microphone over analog hacks.
- Do not add built-in speaker hardware unless the product direction explicitly
  changes.

For the final self-contained object:

- No built-in outward speaker, speaker cavity, speaker module, speaker grille,
  or sound slit.
- Do not reserve an enclosure playback path.

## Thermal Notes

Pi 5 is only the current worst-case reference, but any self-contained object with
a screen, battery/power electronics, and compute board can get warm. Do not make
the first enclosure airtight.

Include:

- Rear or side vents, preferably narrow edge slots.
- Internal clearance above major chips.
- Heatsink or active cooling path if available.
- Access to power cable.

Validate vent placement against the actual internal stack. If the warmest
component lands near the side button or cable path, move the slots rather than
preserving the first sketch.

## Pi Kiosk Notes

Raspberry Pi's official kiosk guide uses Chromium full-screen/kiosk launch through desktop autostart. Community references like `geerlingguy/pi-kiosk` show a minimal systemd-style kiosk service.

For the hackathon, the Pi should run:

- Chromium kiosk UI.
- Optional GPIO button daemon.

The laptop should run the app server, audio pipeline, local STT providers, and receipts. The Pi opens the laptop-hosted device UI, for example `http://<laptop-ip>:5173/?mode=device`, and behaves like a small projector inside the hardware shell.

Later, the Pi can host more of the stack if performance and setup time justify it. That should be treated as an upgrade, not a first demo dependency.

## Open Hardware Risks

- Final software resolution and screen rotation still need confirmation.
- Final compute board is not locked; Pi 5 remains a prototype-compatible size
  and thermal reference.
- Pi 5 RAM variant is not confirmed.
- MPI3508 may occupy GPIO for touch/power, affecting the side button plan.
- LAN or USB-network setup between laptop and Pi still needs a smoke test.
- Battery requirements are not defined.
- Microphone module location and aperture count are not defined.
- Thermal slot placement needs a real heat check once the internal stack is
  mounted.
- Cable routing may define the real enclosure thickness.
- If the screen is not touch-capable, all interaction must come from button/keyboard/dev console.

## Hardware Research Links

- Hardware interfaces: [Hardware Interfaces](hardware-interfaces.md)
- Form factor: [Form Factor](form-factor.md)
- Raspberry Pi kiosk guide: https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/
- Pi kiosk reference: https://github.com/geerlingguy/pi-kiosk
- Raspberry Pi 5 thermal reference: https://www.raspberrypi.com/news/heating-and-cooling-raspberry-pi-5/
- Vosk Pi-compatible STT reference: https://github.com/alphacep/vosk-api
- sherpa-onnx offline speech reference: https://github.com/k2-fsa/sherpa-onnx
