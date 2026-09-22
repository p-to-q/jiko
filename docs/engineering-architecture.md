# Engineering Architecture

## Goal

Build one shared product core with two runtime shells: a laptop development /
observer shell and a Pi/CM-class instrument shell. Jiko Zero may use the laptop
for compute, but the long-range instrument must close the loop without the
observer and without rewriting product logic.

## Recommended Stack

Frontend:

- Vite + React + TypeScript.
- Canvas or PixiJS for block animation and pixel creatures.
- WebSocket or Server-Sent Events for device state updates.

Backend:

- Node/TypeScript if the team wants one language across web and server.
- Python if the team wants faster access to audio, STT, VAD, and feature extraction libraries.
- Either path should expose the same small HTTP/WebSocket protocol.

Hardware runtime:

- Raspberry Pi OS with Chromium kiosk mode.
- Jiko Zero can open the laptop-hosted web app full-screen on the MPI3508.
- A Python edge adapter owns GPIO and, in the device-local phase, capture.
- Pi 5 / CM5 local STT and fixed local speech output are candidates that must
  pass the same corpus, latency, memory, thermal, and soak gates as the laptop
  path.

## System Shape

```text
Side button / UI button
        |
        v
Recording controller
        |
        +--> audio file / audio stream
        |
        v
Audio pipeline
        |
        +--> transcription
        +--> voice features
        +--> timing features
        |
        v
Reading engine
        |
        +--> text reading
        +--> voice reading
        +--> timing reading
        |
        v
Session result
        |
        +--> four-window UI
        +--> TTS line
```

## Event Protocol

The UI should be driven by explicit events instead of scattered component state.

```json
{
  "type": "session.result",
  "sessionId": "demo-001",
  "readings": [
    {
      "channel": "text",
      "state": "maintain",
      "confidence": 0.68
    },
    {
      "channel": "voice",
      "state": "maintain",
      "confidence": 0.61
    },
    {
      "channel": "timing",
      "state": "deviate",
      "confidence": 0.58
    }
  ],
  "topWindow": {
    "status": "minority_exists",
    "lineEn": "A minority remains.",
    "lineZh": "分歧仍在。"
  },
  "tts": {
    "language": "zh",
    "text": "两项维持。一项偏离。分歧仍在。"
  }
}
```

## State Machine

Use one shared state machine for laptop and Pi:

- `idle`: waiting for button.
- `armed`: button held, microphone opening.
- `recording`: audio capture active.
- `processing`: transcription and feature extraction running.
- `reading`: three readings resolve in sequence.
- `result`: states lock and TTS plays.
- `silence`: UI holds without advice.
- `reset`: return to idle.

## Reading Engine Contract

Each reading returns the same shape:

```ts
type SignalState = "maintain" | "deviate" | "static";

type Reading = {
  channel: "text" | "voice" | "timing";
  state: SignalState;
  confidence: number;
  availability?: "measured" | "simulated" | "unavailable";
  features: Record<string, number | string | boolean>;
  privateReason?: string;
};
```

The `privateReason` can be logged for debugging, but it should not appear in the demo UI. The product should reveal disagreement, not explain the user.

## Laptop-First Path

1. Browser captures or uploads audio.
2. Backend transcribes and extracts features.
3. Backend returns three readings.
4. Browser animates the four windows.
5. Backend or browser plays TTS.

This is the fastest path for the first prototype because laptop audio and local model setup are easier to debug than Pi audio permissions.

## Raspberry Pi Path

Jiko Zero integration path:

1. Pi boots into Chromium kiosk.
2. Chromium opens `http://<laptop-ip>:5173/?mode=device`.
3. The laptop server handles audio, STT, feature extraction, readings, receipts,
   and fixed local playback.
4. A local daemon handles GPIO button events through the canonical protocol.

Jiko One device-local gate:

1. The same instrument view opens a device-local server.
2. The device adapter owns capture and source-monotonic timing.
3. STT, features, readings, receipt, and fixed local playback complete with WAN
   blocked and the observer disconnected.
4. The same UI, state machine, and reading protocol run unchanged.

The projector/display-shell path is valid evidence for Jiko Zero only. It must
not be reported as device-local audio evidence. Raspberry Pi has an official
kiosk-mode path for full-screen Chromium, but the Jiko One gate additionally
requires capture, inference, output, supervision, and recovery on the unit.

## Manual Demo Override

Keep a small operator-only route or keyboard shortcut for these cases:

- Room too noisy for STT.
- Network down.
- Local playback fails or misses its deadline.
- Judges interrupt the demo timing.

Manual override should set the same event protocol as the real pipeline. That keeps the demo path honest and prevents a separate fake UI from drifting.

## Main Risks

- Audio capture differences across browser, Node, Python, and Pi.
- Chinese STT quality under noise.
- Pi 5 thermals and power inside a closed shell.
- LAN reachability between laptop and Pi kiosk.
- UI performance if block animation uses too many DOM nodes.
- Product misunderstanding: red/green read as moral instruction.
