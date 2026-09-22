# Runtime Paths

## Runtime Phases

The runtime paths are defined for **Jiko Zero** (the hackathon laptop + Raspberry
Pi 5 kiosk prototype). **Jiko One** (a device-local Linux-class compute module
on a custom carrier) will reuse the same shared core and event protocol, but its
runtime adapters will be defined when that compute stack is chosen. Custom
silicon remains deferred. See [Hardware Phases](hardware-phases.md) for the
phase definitions and physical dimensions.

## Purpose

The project needs two execution paths without becoming two products. The laptop path should carry the hackathon compute and audio loop. The Raspberry Pi path should preserve the physical object by acting as a thin display shell first.

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
- `packages/readings`: content/emotion/context reading contracts and first heuristics.

The shared core should not know whether audio came from a browser, a Python process, or a Raspberry Pi microphone.

## Runtime A: Laptop App (Jiko Zero)

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
- Audio capture: browser `AudioWorklet` ordered PCM by default when supported;
  explicit `MediaRecorder` mode remains the batch compatibility/control path.
- STT: persistent sherpa-onnx SenseVoice is the integrated batch baseline;
  benchmark streaming Zipformer, Moonshine Mandarin, FunASR two-pass, and
  quantized whisper.cpp controls on the same corpus before choosing.
- TTS: Piper or pre-generated local audio clips first; browser speech synthesis only as emergency fallback.

Why:

Laptop audio is easier to debug, and a clean laptop demo can already show the entire product ritual.

## Runtime B: Raspberry Pi 5 Projector Shell (Jiko Zero)

Goal:

Make the hardware object visible without moving the audio/model stack onto the Pi.

Responsibilities:

- Boot into Chromium kiosk.
- Display the same four-window UI on the MPI3508.
- Open the laptop-hosted web app at `http://<laptop-ip>:5173/?mode=device`
  only after the operator explicitly enables the controlled-LAN server profile
  documented in `docs/demo-runbook.md`.
- Optionally read a side button through GPIO, USB HID, or serial and post events to the laptop server.
- Keep the experimental Pi-local ALSA/JPCM edge optional; it is not required
  for the hackathon and has no target-hardware proof yet.

For the hackathon bring-up, the Pi is a tiny projector/display object. Do not make Pi-local microphone capture, STT, TTS, or server hosting part of the first success condition.

Suggested stack:

- Raspberry Pi OS.
- Chromium kiosk opening the laptop-hosted web app.
- `apps/device`: Python adapters for optional GPIO button input and an
  experimental bounded `arecord` -> ordered-JPCM capture edge.
- GPIO: `gpiozero` first for button input.
- Future Pi STT fallback: Vosk for Pi-compatible offline recognition.
- Future Pi TTS fallback: Piper or pre-generated local clips.

The HTTP kiosk origin is currently a display/observer path. It is not a secure
browser microphone origin, and changing `HOST` to `0.0.0.0` does not provide
authentication. Device-local browser capture requires an explicit HTTPS/WSS
deployment plus scoped enrollment/capability work; Pi-native capture remains a
separate host-tested adapter and is not yet integrated with the button or
systemd device runtime.

Why:

The Pi path should be thin. It should show the same UI and adapt optional hardware events into the protocol the laptop app already understands.

First device adapter shape:

- Chromium kiosk opens the laptop web app with `/?mode=device`.
- A small Python daemon in `apps/device` reads the side button through `gpiozero`, USB HID, or serial input.
- The first GPIO daemon posts `input.recording.started` and `input.recording.stopped` demo events to `apps/server`, using `source: "device"`.
- The server treats those device events as normal session/input events.
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

- STT: persistent sherpa-onnx SenseVoice is the integrated batch baseline, not
  a selected winner. Run the frozen corpus against streaming Zipformer,
  Moonshine Mandarin, FunASR two-pass, and a quantized whisper.cpp control
  before selecting a release route.
- TTS: Piper or pre-generated result lines.

Laptop fallback:

- STT: an installed local adapter or the clearly labelled manual-transcript
  rehearsal path. Do not silently switch providers after a failure.
- TTS: browser speech synthesis or local system voice.

Pi default for hackathon:

- Open the laptop-hosted device UI in Chromium kiosk.
- Let the laptop handle microphone capture, STT, audio features, TTS, and receipts.
- Use the Pi button adapter only if it is quicker than a laptop/browser record control.

Pi future fallback:

- STT: no default yet; Vosk is a lightweight control, while Zipformer,
  Moonshine Mandarin, SenseVoice, and whisper.cpp must earn selection on the
  physical target.
- TTS: Piper or pre-generated audio clips.

## Decision Rule

Do not let hardware-specific code enter the UI or core reading logic.

If a future screen, mic, GPIO pin, or speaker changes, only the runtime adapter should change.
