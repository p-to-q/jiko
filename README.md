# jiko

jiko is a hackathon prototype for a wearable signal device built around a Raspberry Pi 5, one physical display, a masked four-window hardware shell, microphone input, TTS output, and three independent readings of a spoken intention.

The current working product shape is not a productivity assistant and not a fortune-telling object. It is a small physical signal instrument: it listens to one intention, separates it into text, voice, and timing readings, then reveals whether the readings agree or diverge.

## Repository Status

This is a private, internal prototype repository. It is not an open-source project, and no license is granted by default.

Repo profile: private `micro+`. Keep the repository light: clear thesis, visible artifact, explicit limitations, short docs map, and only the checks we actually run.

## Current Direction

- Hardware illusion: one vertical screen behind a 3D-printed front mask, visually split into one narrow top strip and three large stacked signal windows.
- Hardware baseline: Raspberry Pi 5 with MPI3508 display.
- Input: side thumb button for hold-to-record, plus USB or built-in microphone depending on the prototype environment.
- Output: screen state changes plus short TTS announcement.
- Reading layers: text reading, voice reading, timing reading.
- Result language: maintain / deviate / static, instead of good / bad / correct / wrong.
- Demo priority: a complete ritual moment beats a complex but fragile AI system.

## Two Runtime Paths

The product should share one UI, one state machine, and one reading core across two runtime shells:

- Laptop app path: the fastest route for the first audio prototype. The laptop handles microphone input, local STT, audio feature extraction, local TTS, and the four-window UI.
- Raspberry Pi hardware path: the same UI and core logic run in Chromium kiosk mode, while a hardware adapter handles GPIO button input, microphone capture, and local/offline STT/TTS.

The boundary between the shared core and each runtime adapter is the most important engineering decision in the repo.

## Immediate Prototype

The immediate prototype should run on a laptop first:

1. Full-screen web UI with four windows.
2. Hold-to-record or click-to-record interaction.
3. Local STT path using desktop models or a local self-hosted service.
4. Audio feature extraction for volume, silence, speech duration, and rough pitch/energy.
5. Three reading outputs mapped to red, green, or yellow.
6. TTS announcement and a short silence afterward.

The Raspberry Pi path should stay compatible, but it should not block the first audio prototype.

## Docs

- [Product Brief](docs/product-brief.md)
- [Engineering Discipline](docs/engineering-discipline.md)
- [Engineering Architecture](docs/engineering-architecture.md)
- [Backend Architecture](docs/backend-architecture.md)
- [Runtime Paths](docs/runtime-paths.md)
- [Audio Prototype](docs/audio-prototype.md)
- [Data Handling](docs/data-handling.md)
- [Result Copy](docs/result-copy.md)
- [Form Factor](docs/form-factor.md)
- [Hardware Notes](docs/hardware-notes.md)
- [Hardware Interfaces](docs/hardware-interfaces.md)
- [Repository Map](docs/repository-map.md)
- [Next Phase Checklist](docs/next-phase-checklist.md)
- [Open Questions](docs/open-questions.md)
- [Repository Setup](docs/repository-setup.md)

## Recommended First Build

Build the laptop prototype as a local web app:

- `apps/web`: Vite + React/TypeScript + Canvas/PixiJS UI.
- `apps/server`: TypeScript service for recording upload, local transcription, local TTS, and readings.
- `apps/device`: Raspberry Pi adapter for GPIO, device audio, and kiosk boot behavior.
- `packages/protocol`: shared JSON event and reading schemas.
- `packages/core`: shared state machine and reading orchestration.

For the hackathon, keep a manual demo control path available. It should only steer the state machine when the room is too noisy or the network fails; the normal path should still run real audio and real readings.

## Current Mock Loop

Run the local backend and web UI:

```sh
pnpm dev:server
pnpm dev:web
```

Trigger the first non-audio loop:

```sh
curl -X POST http://localhost:4317/sessions \
  -H 'content-type: application/json' \
  -d '{"sessionId":"demo-001","source":"manual"}'

curl -X POST http://localhost:4317/sessions/demo-001/manual-transcript \
  -H 'content-type: application/json' \
  -d '{"transcript":"我在考虑辞职，但还想先把这件事说清楚。","language":"zh"}'
```

This emits transcript, mock feature, reading, and result events over SSE. The web app listens to `http://localhost:4317/events` by default.
