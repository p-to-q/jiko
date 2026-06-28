# Hardware Interfaces

This document captures the current Raspberry Pi and display interface assumptions.

## Current Boards

Confirmed baseline:

- Raspberry Pi 5.
- MPI3508 3.5-inch display attached to the Raspberry Pi 5.

Possible secondary hardware:

- One Pi-sized display attached to another Pi-class board, exact model not important for the current baseline.

## Practical Identification

Use the ports to identify any secondary board quickly:

| Board | Visual cues |
| --- | --- |
| Raspberry Pi 3 | One full-size HDMI port, micro-USB power, 4 USB-A ports, Ethernet, 40-pin GPIO, 3.5mm AV jack. |
| Raspberry Pi 4 | Two micro-HDMI ports, USB-C power, 2 USB 3.0 blue ports, 2 USB 2.0 ports, Ethernet, 40-pin GPIO, 3.5mm AV jack. |
| Raspberry Pi 5 | Two micro-HDMI ports, USB-C power, 2 USB 3.0 blue ports, 2 USB 2.0 ports, Ethernet, 40-pin GPIO, power button, 2 MIPI camera/display FFC ports, PCIe FFC connector. |

If a secondary board has USB-C power and two micro-HDMI ports, it is very likely Pi 4 or Pi 5.

If it also has a physical power button and the newer FFC connectors, it is Pi 5.

## Interface Summary

### Raspberry Pi 3

Likely useful interfaces:

- Full-size HDMI for display.
- 40-pin GPIO for button and simple electronics.
- USB-A for microphone, keyboard, speaker, or USB audio.
- 3.5mm AV jack for analog audio output.
- DSI display connector for compatible display panels.
- CSI camera connector.
- micro-USB power.

### Raspberry Pi 4

Likely useful interfaces:

- 2 micro-HDMI outputs.
- 40-pin GPIO for button and simple electronics.
- USB-A for microphone, keyboard, speaker, or USB audio.
- 3.5mm AV jack for analog audio output.
- DSI display connector.
- CSI camera connector.
- USB-C power.

### Raspberry Pi 5

Likely useful interfaces:

- Dual HDMI display output through 2 micro-HDMI ports.
- 40-pin GPIO for button and simple electronics.
- USB-A for microphone, keyboard, speaker, or USB audio.
- 2 MIPI camera/display FFC connectors.
- PCIe FFC connector for fast peripherals through an adapter.
- USB-C power.
- Physical power button.

Pi 5 is the hardware baseline. It has stricter power and thermal needs than Pi 4-class boards. Plan for active cooling or a ventilated shell if it is enclosed.

## MPI3508 Display

The confirmed display is MPI3508, matching the LCDwiki `3.5inch HDMI Display-B` family.

Important details:

- SKU: `MPI3508`.
- Size: 3.5 inch.
- Physical resolution: 480 x 320.
- Adjustable software resolution: 480 x 320 up to 1920 x 1080.
- Touch: resistive touch.
- Display signal: HDMI input.
- Power: 5V, can be powered through USB for ordinary display use.
- When used as a Raspberry Pi monitor, the 26-pin base area is used for power and touch return.
- It supports Raspberry Pi OS driver setup through the `goodtft/LCD-show` scripts, including `MPI3508-show`.

## What This Means For Us

Preferred demo path:

- Treat all screens as one physical display running Chromium kiosk.
- Render the four-window UI in software.
- Let the front mask create the multi-screen illusion.

For MPI3508:

- Use HDMI for video.
- Expect 480 x 320 physical resolution unless software scaling is configured.
- Use landscape/portrait rotation through the display driver or OS display settings.
- Treat touch as optional.
- Be careful using GPIO for the side button if the display already occupies the GPIO header for touch/power.

## Side Button Strategy

If the screen occupies GPIO pins:

1. Prefer a USB HID button, small keyboard board, or macro pad for the first hardware demo.
2. Use an external microcontroller over USB serial if a physical button must be custom.
3. Use GPIO only after confirming which pins the display uses and whether there is safe access through a breakout or stacking header.

If the display only uses HDMI and USB power:

- Use GPIO for the side button.
- Default pin remains `GPIO17`, but confirm conflicts before soldering.

## Open Checks

Before building the shell:

- Confirm whether the MPI3508 is using HDMI only, HDMI plus USB power, or HDMI plus GPIO touch/power.
- Confirm whether the side button can use GPIO or should be USB/serial.
- Confirm screen orientation and final UI resolution.
- Confirm power supply: Pi 5 should use a strong 5V/5A USB-C supply if possible.

## Sources

- Raspberry Pi 4 specifications: https://www.raspberrypi.com/products/raspberry-pi-4-model-b/specifications/
- Raspberry Pi 5 specifications: https://www.raspberrypi.com/products/raspberry-pi-5/
- MPI3508 / 3.5inch HDMI Display-B: https://www.lcdwiki.com/3.5inch_HDMI_Display-B
