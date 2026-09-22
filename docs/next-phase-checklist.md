# Next Phase Checklist

This checklist tracks the remaining stabilization from the implemented laptop
integration slice to Jiko Zero hardware validation and Jiko One evidence gates.
Implementation is underway; target and release qualification remain open.

This checklist is written for **Jiko Zero** — the hackathon laptop + Raspberry Pi 5
kiosk prototype — and the already specified **Jiko One** device-local gates. See
[Hardware Phases](hardware-phases.md) for phase definitions and physical dimensions.

## Current Verdict

The integration slice is implemented. The repo is ready for measured browser,
model, and physical-hardware validation, not release.

The important boundaries are now clear enough:

- The product is a wearable signal instrument, not an AI advisor.
- The prototype has one shared core and two runtime shells.
- The first runnable version should be laptop-first.
- Jiko Zero may keep the laptop compute shell plus Pi kiosk while it closes the
  real-audio loop. Jiko One is an evidence-gated single-device target on Pi 5 /
  CM5-class compute; the observer laptop must not remain a hidden dependency.
- The source repo is public and intentionally light; recordings, real-person
  transcripts, credentials, and local runtime data remain private and untracked.

## Locked For Continued Implementation

These decisions remain stable while implementation and validation continue:

- Use one physical display with a four-window visual mask.
- Use three large stacked signal windows and one top status strip.
- Use a side thumb button for hold-to-record in hardware.
- Keep the UI event-driven.
- Keep audio/STT behind local provider interfaces.
- Keep the engineering evidence lines separate: text/content, voice/delivery,
  and timing/interaction. Public copy may still say content, emotion, and
  context, but the implementation must not claim to measure emotion or infer
  unconstrained context.
- Store debug receipts for every real session.
- Keep manual demo control on the same event path as real audio.

## Default Technical Path

Start here unless a quick spike proves it wrong:

- UI: Vite + React + TypeScript.
- Animation: Canvas or PixiJS.
- Core: shared TypeScript packages.
- Laptop audio capture: browser `AudioWorklet` ordered PCM is the default when
  supported; explicit `MediaRecorder` whole-blob mode remains the batch control.
  Capture/transport now stream, but STT still begins after stop, so this is not
  yet a streaming-ASR latency result.
- Local STT baseline: persistent sherpa-onnx SenseVoice int8. Benchmark a
  bilingual streaming Zipformer first, current Moonshine Mandarin Tiny Streaming
  second, and
  quantized whisper.cpp tiny/base as the portable control; keep self-hosted
  FunASR as a laptop reference.
- Audio features: start with simple duration, silence, RMS, pause, and rough pitch features.
- Pi display: Chromium kiosk on MPI3508 for Jiko Zero; the same instrument view
  must also run against a device-local server in the Jiko One integration gate.
- Pi button: optional Python `gpiozero` adapter in `apps/device`; hardware smoke test pending.
- Device-local STT: no provider is selected until the frozen corpus, latency,
  RSS, thermal, and sustained-load receipts exist on the target board.
- Enclosure: start from a Pi 5-sized object envelope, keep the front face clean,
  and route USB-C, mic, vents, and screws to edges/back until physical tests say
  otherwise.

## What To Build First

Build the smallest complete path:

1. `packages/protocol`: event and reading types. Done for the mock loop.
2. `packages/core`: state machine and result composition. Done for the mock loop.
3. `packages/readings`: transparent text, delivery, and timing heuristics. Done
   for the mock loop; these are not validated psychological measurements.
4. `apps/server`: manual transcript -> mock features -> readings -> result over SSE. Done.
5. `apps/web`: consume `session.result` from SSE and update the four-window UI. Done.
6. Browser recording and audio normalization. Batch control plus ordered
   segmented PCM capture/transport are wired; physical-browser coverage,
   reconnect/replay, and first-partial measurement are still pending.
7. Local STT provider worker. Persistent SenseVoice, whisper.cpp CLI, and
   loopback FunASR boundaries exist; same-corpus target-hardware runs are still
   pending, so no provider is the measured winner.
8. Dev debug panel for transcript, features, and readings. Server receipt
   endpoint and browser viewer are done; capture-mode/ordered-coverage and
   streaming-partial views remain.
9. Operator shortcuts that emit normal session events.
10. Pi-class kiosk display shell. UI exists; still needs MPI3508 kiosk smoke testing.
11. Pi-class thin button adapter. Done as a GPIO event bridge; optional hardware smoke test if the display/header leaves a safe input path.
12. Enclosure opening study. First layout is bottom USB-C, top mic, side/rear
    vents, and rear screw points; validate against the actual internal board,
    mic, heat, and cable routing.

Do not pretend the Jiko Zero laptop/Pi split proves a self-contained product.
Move the audio stack to Pi/CM-class compute only through the device-local gate,
after the laptop loop and frozen benchmark are reproducible. Do not start with
a complex AI agent framework.

## Hackathon Run Order

The next step is to stabilize the laptop loop, then use the Pi-class prototype
stack and MPI3508 as the visible hardware shell.

Priority order:

1. Stabilize the secure-browser default ordered WebSocket PCM path and the
   explicit `?audioCapture=batch` control separately; both must produce events,
   readings, one result, and one receipt.
2. Confirm `ffmpeg` normalization on the demo laptop: WAVE-wrapped source PCM
   and `MediaRecorder` uploads should both become mono 16 kHz WAV.
3. Run the frozen STT harness against the integrated SenseVoice baseline and
   at least one independent challenger before selecting a device path.
4. Treat plain `http://<laptop-ip>:5173/?mode=device` as display/observer-only:
   browser microphone access and ordered PCM require a secure context. For a
   Pi-browser capture trial, terminate TLS for both the page and API/WebSocket,
   use HTTPS/WSS, add the exact HTTPS origin to both
   `JIKO_HTTP_ALLOWED_ORIGINS` and `JIKO_ORDERED_PCM_ALLOWED_ORIGINS`, and force
   `?mode=device&audioCapture=ordered-pcm`. The repository does not yet ship
   the scoped capability/authentication layer, so this remains a controlled
   experiment rather than a LAN release profile.
5. Confirm MPI3508 orientation, 320 x 480 layout, and physical mask alignment.
6. Optionally smoke test the Pi side button: confirm server reachability and SSE/UI receipt of `input.recording.started` and `input.recording.stopped`.
7. Rehearse the fallback ladder: real audio plus STT, real audio with STT unavailable, manual transcript, then operator event.

This sequence protects the demo: if local STT is slow or fails, the UI, readings, receipts, and operator fallback still exercise the same product protocol.

## Locked Technical Defaults

- Package manager: `pnpm`.
- Server language: TypeScript first.
- Python role: optional worker for audio features, local STT, GPIO, or model integration.
- STT access: backend-owned adapters. Local/self-hosted is the default. A paid
  remote challenger requires the global capability flag, a named provider and
  model, and explicit per-session consent; it is never an automatic fallback
  and no secret enters the browser.
- Recording retention: dev-only by default.
- Raw recording commits: never.

## Confirm During Kickoff

- Which streaming challenger clears the frozen same-corpus gate first:
  sherpa-onnx Zipformer or Moonshine Mandarin Tiny Streaming.
- Whether raw recordings should be kept during rehearsal, and where.
- Whether the first UI uses Canvas directly or PixiJS.

## Can Wait

- Final role names for the four windows.
- Final demo script.
- Final shell material and finish.
- Battery strategy.
- Branch protection and target-HIL release jobs; host CI is now checked in.
- Local-only Pi STT performance tuning.

## Additional Research Still Useful

Do these only if they affect the first build:

- Measure local STT latency on the demo laptop.
- Test the ordered PCM path with the intended physical microphone plus Safari/
  mobile fallbacks; keep `MediaRecorder` as the explicit compatibility control.
- Test whether PixiJS is necessary or plain Canvas is enough for the block UI.
- Confirm Pi screen resolution and orientation.
- Confirm Pi and laptop LAN setup, with USB/network sharing as fallback if Wi-Fi is unstable.
- Confirm USB mic availability and noise level in the demo room.

## Exit Criteria For Next Phase

The next phase is complete when:

- A user can press/hold or click to record.
- The app transcribes one sentence through a configured local STT provider, or records an explicit local-STT-unavailable receipt.
- The app extracts basic audio/timing features.
- Three readings resolve to signal states.
- The four-window UI animates and locks into a result.
- The debug panel shows enough receipts to explain what happened.
