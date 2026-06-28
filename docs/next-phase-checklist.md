# Next Phase Checklist

This file answers one question: is the repo ready to move from planning into implementation, then into naming and narrative?

## Current Verdict

Yes. The repo is ready for the next phase.

The important boundaries are now clear enough:

- The product is a wearable signal instrument, not an AI advisor.
- The prototype has one shared core and two runtime shells.
- The first runnable version should be laptop-first.
- The Raspberry Pi 5 path is preserved as a thin kiosk display shell with optional button events.
- The repo is private and intentionally light.

## Locked For Implementation

These decisions are stable enough to start coding:

- Use one physical display with a four-window visual mask.
- Use three large stacked signal windows and one top status strip.
- Use a side thumb button for hold-to-record in hardware.
- Keep the UI event-driven.
- Keep audio/STT/TTS behind local provider interfaces.
- Keep text, voice, and timing readings separate.
- Store debug receipts for every real session.
- Keep manual demo control on the same event path as real audio.

## Default Technical Path

Start here unless a quick spike proves it wrong:

- UI: Vite + React + TypeScript.
- Animation: Canvas or PixiJS.
- Core: shared TypeScript packages.
- Laptop audio capture: browser `MediaRecorder`.
- Laptop STT: FunASR local service first; faster-whisper, whisper.cpp, or MLX Whisper as local fallbacks.
- Laptop TTS: pre-generated local audio clips first; Piper remains the dynamic fallback.
- Audio features: start with simple duration, silence, RMS, pause, and rough pitch features.
- Pi display: Chromium kiosk on MPI3508, opening the laptop-hosted device UI.
- Pi button: optional Python `gpiozero` adapter in `apps/device`; hardware smoke test pending.
- Pi offline STT fallback: future Vosk path, not a hackathon dependency.
- Pi offline TTS fallback: future Piper or local clips path, not a hackathon dependency.

## What To Build First

Build the smallest complete path:

1. `packages/protocol`: event and reading types. Done for the mock loop.
2. `packages/core`: state machine and result composition. Done for the mock loop.
3. `packages/readings`: transparent text, voice, and timing heuristics. Done for the mock loop.
4. `apps/server`: manual transcript -> mock features -> readings -> result over SSE. Done.
5. `apps/web`: consume `session.result` from SSE and update the four-window UI. Done.
6. Browser recording upload and audio normalization. Server upload and normalization are done; browser UI wiring is in progress.
7. Local STT provider worker. Provider boundary is done for FunASR HTTP and whisper.cpp CLI; model setup/benchmarking is still pending.
8. Dev debug panel for transcript, features, and readings. Server receipt endpoint is done; browser viewer is in progress.
9. Operator shortcuts that emit normal session events.
10. Raspberry Pi 5 kiosk display shell. UI exists; still needs MPI3508 kiosk smoke testing.
11. Raspberry Pi 5 thin button adapter. Done as a GPIO event bridge; optional hardware smoke test if the display/header leaves a safe input path.

Do not move the audio stack onto the Pi for the hackathon. Do not start with shell CAD before the device UI and laptop loop are stable. Do not start with a complex AI agent framework.

## Hackathon Run Order

The next step is to stabilize the laptop loop, then use the Pi 5 and MPI3508 as the visible hardware shell.

Priority order:

1. Stabilize laptop server and web recording: `POST /sessions/:id/audio` should produce events, readings, result, and receipt.
2. Confirm `ffmpeg` normalization on the demo laptop: uploaded browser audio should become mono 16 kHz WAV.
3. Pick and benchmark one local STT path: FunASR local HTTP or whisper.cpp CLI first.
4. Generate local TTS clips and test playback with `TTS_PROVIDER=clip`.
5. Launch the web UI on the LAN and open `http://<laptop-ip>:5173/?mode=device` from the Pi 5 Chromium kiosk.
6. Confirm MPI3508 orientation, 320 x 480 layout, and physical mask alignment.
7. Optionally smoke test the Pi side button: confirm server reachability and SSE/UI receipt of `input.recording.started` and `input.recording.stopped`.
8. Rehearse the fallback ladder: real audio plus STT, real audio with STT unavailable, manual transcript, then operator event.

This sequence protects the demo: if local STT is slow or fails, the UI, readings, receipts, and operator fallback still exercise the same product protocol.

## Locked Technical Defaults

- Package manager: `pnpm`.
- Server language: TypeScript first.
- Python role: optional worker for audio features, local STT/TTS, GPIO, or model integration.
- STT/TTS access: backend-owned local adapters, not browser-held secrets or paid APIs.
- Recording retention: dev-only by default.
- Raw recording commits: never.

## Confirm During Kickoff

- Which local STT path to benchmark first on the demo laptop: FunASR local HTTP or whisper.cpp CLI.
- Whether Piper has an acceptable Chinese voice for the demo fallback.
- Which pre-generated local clips are needed for the canonical result lines.
- Whether raw recordings should be kept during rehearsal, and where.
- Whether the first UI uses Canvas directly or PixiJS.

## Can Wait

- Final role names for the four windows.
- Final demo script.
- Final shell material and finish.
- Battery strategy.
- CI and branch protection.
- Local-only Pi STT/TTS performance tuning.

## Additional Research Still Useful

Do these only if they affect the first build:

- Measure local STT latency on the demo laptop.
- Test local clips and Piper fallback for result-line playback.
- Test browser `MediaRecorder` output format compatibility with the server `ffmpeg` path.
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
- TTS speaks one concise result line.
- The debug panel shows enough receipts to explain what happened.
