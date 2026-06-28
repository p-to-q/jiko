# Hardware Notes

## Assumption

The target board is Raspberry Pi 5. Keep the software lightweight enough that Pi 4-class fallback remains plausible, but design the hardware shell around Pi 5 dimensions, power, thermals, and display stack.

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
- Side: thumb button, USB-C/power exit, optional speaker holes.
- Internal: Pi mount, screen mount, cable relief, heat-set inserts.

Use M2.5 or M3 screws and heat-set inserts if possible. Avoid a snap-only case for the first prototype; iteration will be faster if the shell opens cleanly.

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
- Use laptop speakers or Bluetooth/USB speaker.

For Pi demo:

- Prefer USB microphone over analog hacks.
- Use HDMI audio, USB speaker, or small amplified speaker module.
- Pause recording while TTS plays to avoid self-feedback.

## Thermal Notes

Pi 5 can get warm in an enclosed shell and has stricter power needs. Do not make the first enclosure airtight.

Include:

- Rear or side vents.
- Internal clearance above major chips.
- Heatsink or active cooling path if available.
- Access to power cable.

## Pi Kiosk Notes

Raspberry Pi's official kiosk guide uses Chromium full-screen/kiosk launch through desktop autostart. Community references like `geerlingguy/pi-kiosk` show a minimal systemd-style kiosk service.

For this project, the Pi should run:

- Local app server.
- Chromium kiosk UI.
- GPIO/audio daemon.

The laptop prototype can use the same frontend and protocol, so Pi integration becomes packaging and device IO rather than a full rewrite.

## Open Hardware Risks

- Final software resolution and screen rotation still need confirmation.
- Pi 5 RAM variant is not confirmed.
- MPI3508 may occupy GPIO for touch/power, affecting the side button plan.
- Battery requirements are not defined.
- Speaker volume in a hackathon room may be weak.
- Cable routing may define the real enclosure thickness.
- If the screen is not touch-capable, all interaction must come from button/keyboard/dev console.

## Hardware Research Links

- Hardware interfaces: [Hardware Interfaces](hardware-interfaces.md)
- Form factor: [Form Factor](form-factor.md)
- Raspberry Pi kiosk guide: https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/
- Pi kiosk reference: https://github.com/geerlingguy/pi-kiosk
- Vosk Pi-compatible STT reference: https://github.com/alphacep/vosk-api
- sherpa-onnx offline speech reference: https://github.com/k2-fsa/sherpa-onnx
- Piper local TTS: https://github.com/OHF-Voice/piper1-gpl
