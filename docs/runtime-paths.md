# Runtime Paths

## Purpose

The project needs two execution paths without becoming two products. The laptop path should let the team move fast on the first prototype. The Raspberry Pi path should preserve a clean route into the physical device.

The shared product system is:

- Four-window UI.
- Session state machine.
- Reading protocol.
- Three reading engines.
- Result composition.
- Demo override protocol.

The runtime-specific system is:

- Microphone capture.
- Button input.
- Local STT provider.
- Local TTS provider.
- Audio playback.
- Kiosk/desktop launch behavior.

## Shared Core

The shared core should be platform-agnostic TypeScript if possible.

Recommended packages:

- `packages/protocol`: event types, session schema, reading schema.
- `packages/core`: state machine, result composition, reading orchestration.
- `packages/readings`: text/voice/timing reading contracts and first heuristics.

The shared core should not know whether audio came from a browser, a Python process, or a Raspberry Pi microphone.

## Runtime A: Laptop App

Goal:

Use the laptop to prove the product loop quickly and beautifully.

Responsibilities:

- Run full-screen web UI.
- Capture microphone audio through the browser or a local server.
- Use local desktop-grade STT.
- Extract voice and timing features.
- Play TTS through laptop speakers.
- Provide keyboard/operator override.

Suggested stack:

- `apps/web`: Vite + React + TypeScript + PixiJS/Canvas.
- `apps/server`: Node/TypeScript or Python service.
- Audio capture: browser `MediaRecorder` first, Python capture only if browser permissions become annoying.
- STT: FunASR local service first for Chinese/mixed speech; faster-whisper, whisper.cpp, or MLX Whisper as local desktop fallbacks.
- TTS: Piper or pre-generated local audio clips first; browser speech synthesis only as emergency fallback.

Why:

Laptop audio is easier to debug, and a clean laptop demo can already show the entire product ritual.

## Runtime B: Raspberry Pi Hardware

Goal:

Run the same UI and product core on the hardware object.

Responsibilities:

- Boot into Chromium kiosk.
- Display the same four-window UI.
- Read side button through GPIO.
- Capture audio from USB mic or attached mic.
- Play TTS through speaker/HDMI/USB audio.
- Run local/offline STT/TTS where feasible.

For the first hardware bring-up, keep the Pi thinner than this full list: display plus button event bridge is enough. Do not make Pi-local STT/TTS part of the first success condition.

Suggested stack:

- Raspberry Pi OS.
- Chromium kiosk opening the local web app.
- `apps/device`: Python adapter for GPIO/audio, or Node adapter if the team standardizes on TS.
- GPIO: `gpiozero` first for button input.
- STT fallback: Vosk for Pi-compatible offline recognition.
- TTS fallback: Piper for local neural speech.

Why:

The Pi path should be thin. It should adapt hardware events into the same protocol the laptop app already understands.

First device adapter shape:

- Chromium kiosk opens the web app with `/?mode=device`.
- A small Python daemon reads the side button through `gpiozero`, USB HID, or serial input.
- The daemon posts `pressed` and `released` events to `apps/server`.
- The server maps those device events into normal session/input events.
- If the MPI3508 touch/power header blocks useful GPIO pins, prefer USB HID or RP2040/Pico serial before forcing a GPIO layout.

## Adapter Contract

Both runtime paths should emit the same events:

```json
{
  "type": "input.recording.started",
  "source": "browser",
  "sessionId": "demo-001",
  "timestamp": 1782600000000
}
```

```json
{
  "type": "audio.transcribed",
  "sessionId": "demo-001",
  "transcript": "我在考虑辞职",
  "language": "zh",
  "provider": "local:funasr"
}
```

```json
{
  "type": "audio.features.extracted",
  "sessionId": "demo-001",
  "features": {
    "durationMs": 3810,
    "speechMs": 2490,
    "preSpeechDelayMs": 620,
    "pauseCount": 2,
    "longestPauseMs": 510,
    "rmsMean": 0.12,
    "rmsStd": 0.04,
    "pitchMeanHz": 178,
    "pitchStdHz": 21
  }
}
```

The UI should only care about session events and final reading results.

## STT/TTS Provider Strategy

Use provider interfaces instead of hard-coded tools. In this repo, `provider` means a local adapter or self-hosted endpoint by default, not a paid cloud API.

```ts
type TranscriptionProvider = {
  transcribe(input: AudioInput): Promise<TranscriptResult>;
};

type SpeechProvider = {
  speak(input: SpeechInput): Promise<SpeechResult>;
};
```

Laptop default:

- STT: FunASR local service, faster-whisper, whisper.cpp, or MLX Whisper depending on the laptop.
- TTS: Piper or pre-generated result lines.

Laptop fallback:

- STT: Vosk or browser/manual transcript for rehearsal.
- TTS: browser speech synthesis or local system voice.

Pi default for demo:

- Use local services where performance allows; otherwise keep STT on the laptop and let the Pi act as display/device shell.

Pi fallback:

- STT: Vosk.
- TTS: Piper or pre-generated audio clips.

## Decision Rule

Do not let hardware-specific code enter the UI or core reading logic.

If a future screen, mic, GPIO pin, or speaker changes, only the runtime adapter should change.
