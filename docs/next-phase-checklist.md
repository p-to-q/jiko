# Next Phase Checklist

This file answers one question: is the repo ready to move from planning into implementation, then into naming and narrative?

## Current Verdict

Yes. The repo is ready for the next phase.

The important boundaries are now clear enough:

- The product is a wearable signal instrument, not an AI advisor.
- The prototype has one shared core and two runtime shells.
- The first runnable version should be laptop-first.
- The Raspberry Pi 5 path is preserved through a thin hardware adapter.
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
- Pi display: Chromium kiosk on MPI3508.
- Pi button: Python `gpiozero` adapter in `apps/device`; hardware smoke test pending.
- Pi offline STT fallback: Vosk.
- Pi offline TTS fallback: Piper.

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
10. Raspberry Pi 5 thin button adapter. Done as a GPIO event bridge; still needs hardware smoke testing on the Pi.

Do not start with the Pi. Do not start with the shell CAD. Do not start with a complex AI agent framework.

## Immediate Backend Work

The next backend step is to move from manual transcript mock loop to real local audio receipts without changing the shared event protocol.

Priority order:

1. Finish browser recording UI wiring to `POST /sessions/:id/audio`.
2. Done: server normalizes uploaded audio to mono 16 kHz WAV with an explicit `ffmpeg` error path.
3. Done: server extracts minimal real audio features: duration, RMS/energy, silence, and pause hints.
4. Done: server has local/free STT adapters behind a provider boundary, while keeping manual transcript fallback.
5. Done: receipts show media type, byte size, provider id, latency, transcript, features, readings, and result.
6. Smoke test the Raspberry Pi 5 thin adapter on hardware: confirm GPIO17 wiring, debounce timing, server reachability, and SSE/UI receipt of `input.recording.started` and `input.recording.stopped`.

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
