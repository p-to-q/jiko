# Backend Architecture

This document defines the non-UI system behind the first prototype.

The backend should not become an AI advisor. Its job is to turn one spoken intention into inspectable events, three bounded readings, a result phrase, and optional local speech output.

## Backend Thesis

Build a small event-driven backend first.

The first backend should be boring on purpose:

- Accept one recording or one manual transcript.
- Normalize audio into a known format.
- Call one local/self-hosted STT provider.
- Extract transparent audio and timing features.
- Run three separate readings.
- Compose a session result.
- Emit events to the UI.
- Write a local receipt for debugging.
- Trigger local TTS or a pre-generated audio clip.

Do not start with a multi-agent framework. The three readings can be independent modules without being autonomous agents.

## System Spine

```text
Browser / Pi adapter / operator control
        |
        v
Backend gateway
        |
        +--> session event stream
        |
        v
Session state machine
        |
        +--> audio ingest
        +--> transcript ingest
        +--> manual demo ingest
        |
        v
Audio pipeline
        |
        +--> audio normalization
        +--> local STT provider
        +--> voice and timing feature extraction
        |
        v
Reading engine
        |
        +--> text reading
        +--> voice reading
        +--> timing reading
        |
        v
Result composer
        |
        +--> UI events
        +--> TTS request or local clip
        +--> session receipt
```

## Recommended Backend Shape

Use TypeScript for the backend gateway and shared product logic.

Use Python only at the boundary where it materially helps audio, STT, VAD, or model integration.

Recommended packages and apps:

- `packages/protocol`: Zod schemas and TypeScript types for events, readings, receipts, and provider results.
- `packages/core`: session state machine, event reducer, reading orchestration, and result composition.
- `packages/readings`: first rule-based text, voice, and timing readings.
- `apps/server`: local HTTP server, event stream, upload handling, provider adapters, receipts, and TTS trigger.
- `apps/device`: Raspberry Pi GPIO/kiosk adapter. It should emit the same events as the laptop path.

The shared core must not know whether input came from browser `MediaRecorder`, Raspberry Pi GPIO/audio, a Python worker, or an operator shortcut.

## Server Transport

Use HTTP for commands and Server-Sent Events for UI state updates in the first build.

Why:

- Recording upload is naturally HTTP multipart.
- Operator controls are small HTTP commands.
- Pi button events can be small HTTP posts.
- The UI mostly needs backend-to-browser state updates.
- SSE keeps the first implementation simpler than WebSocket while still preserving a live event stream.

Use WebSocket only if we later need true bidirectional streaming, such as live audio chunks from a device daemon or high-frequency meter data.

Suggested first API:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Check server and provider availability. |
| `GET` | `/events` | SSE stream of session events for the UI. |
| `POST` | `/sessions` | Create a session and emit `session.created`. |
| `POST` | `/sessions/:sessionId/audio` | Upload one recording and run the full pipeline. |
| `POST` | `/sessions/:sessionId/manual-transcript` | Run the same pipeline from typed transcript when audio fails. |
| `POST` | `/sessions/:sessionId/demo-event` | Operator-only demo control through the normal event protocol. |
| `POST` | `/device/button` | Pi adapter sends `pressed` / `released` events. |
| `GET` | `/sessions/:sessionId/receipt` | Return debug receipt in dev mode. |
| `GET` | `/audio/:assetId` | Serve generated TTS or local clip when needed. |

## Event Model

Every path should emit the same event family:

- `session.created`
- `input.recording.started`
- `input.recording.stopped`
- `audio.uploaded`
- `audio.normalized`
- `audio.transcribed`
- `audio.features.extracted`
- `reading.started`
- `reading.channel.resolved`
- `session.result`
- `tts.started`
- `tts.finished`
- `session.silence`
- `session.reset`
- `session.error`

Manual controls must emit these same events. A demo shortcut may provide the transcript or selected outcome, but it should not bypass the reducer or UI state path.

## Audio Ingest

First laptop path:

1. Browser records with `MediaRecorder`.
2. Browser uploads one `webm` / `ogg` / `wav` blob.
3. Server stores the file only if dev retention is enabled.
4. Server normalizes to mono 16 kHz WAV for STT and feature extraction.
5. Server records media type, duration, byte size, and conversion latency in the receipt.

Use `ffmpeg` at the edge for format conversion. Keep normalized audio as a temporary working file unless `SAVE_RAW_AUDIO=1` or `SAVE_WORKING_AUDIO=1`.

## STT Provider Strategy

Default policy: local or self-hosted only.

Implement STT as an adapter:

```ts
type TranscriptionProvider = {
  id: string;
  transcribe(input: AudioInput): Promise<TranscriptResult>;
};
```

Recommended first spike order:

1. `manual`: deterministic fallback for rehearsals and tests.
2. `funasr`: best first target for Chinese or Chinese/English mixed speech on the laptop if setup completes quickly.
3. `whisper.cpp`: strong local fallback on Mac and useful for eventual embedded experiments.
4. `faster-whisper`: good desktop fallback if Python/GPU setup is already healthy.
5. `vosk`: Pi-compatible offline fallback; lower quality, but useful for hardware autonomy.

Do not make the demo depend on cloud STT. If the team later decides to use a free remote provider for a specific rehearsal, keep it behind an explicit provider adapter and mark the session receipt as remote.

First-day STT execution plan:

- Keep `manual` available from the start.
- Run FunASR as a local Python batch worker first, not as a WebSocket service.
- Prepare `whisper.cpp` as the Mac/local fallback through a spawned CLI.
- Leave `faster-whisper` for the next round unless the Python/GPU environment is already healthy.
- Leave Vosk for Pi/offline fallback; do not make it the first Chinese/mixed-language demo path.

## Feature Extraction

Minimum first features:

- `durationMs`
- `speechMs`
- `silenceMs`
- `preSpeechDelayMs`
- `pauseCount`
- `longestPauseMs`
- `rmsMean`
- `rmsStd`
- `rmsPeak`
- `pitchMeanHz`
- `pitchStdHz`
- `speechRateCharsPerSecond`

First implementation can use transparent amplitude thresholds and simple pitch estimation.

Use Silero VAD if simple thresholds fail in the demo room. Use librosa/aubio/openSMILE only if the simple feature path is not enough; they are useful, but not necessary for the first ritual.

First-day implementation should prefer a Python worker for feature extraction. The TypeScript server should remain the gateway and receipt writer. A minimal Python stack is `numpy`, `soundfile`, `silero-vad`, and optionally `aubio` for rough pitch.

Normalize browser recordings before transcription or feature extraction:

```bash
ffmpeg -hide_banner -y -i input.webm \
  -vn -map 0:a:0 \
  -ac 1 -ar 16000 -c:a pcm_s16le \
  normalized.wav
```

If browser timestamps are unstable, add `-fflags +genpts` and `-af aresample=async=1:first_pts=0`.

## Reading Engine

Keep the first reading engine rule-based and inspectable.

Text reading input:

- Transcript.
- Language.
- Optional STT confidence.
- Keyword groups for avoid / delay / movement / rupture / attempt.

Voice reading input:

- RMS features.
- Pitch variance.
- Silence ratio.
- Clipping/noise flags.

Timing reading input:

- Button-down to speech delay.
- Pause count and longest pause.
- Recording length.
- Speech continuation after an early pause.

Each reading returns:

```ts
type SignalState = "maintain" | "deviate" | "static";

type Reading = {
  channel: "text" | "voice" | "timing";
  state: SignalState;
  confidence: number;
  features: Record<string, number | string | boolean>;
  privateReason?: string;
};
```

Keep `privateReason` out of the UI. It belongs in receipts only.

## Result Composer

The composer turns three readings into:

- Majority/minority shape.
- Top-window status.
- Two-line text candidate.
- TTS phrase or clip key.
- UI color assignment.
- Optional silence duration.

Important rule:

Consensus is not treated as permission. Disagreement is not treated as advice. The result reveals structure and then exits.

## TTS Strategy

First reliable path:

- Use pre-generated local clips for the strongest result lines.
- Use Piper only if we find an acceptable voice and latency.
- Use macOS `say` or browser speech synthesis as a dev emergency fallback, not as the product path.

The server should attach a stable `tts.clipKey` to each result so a rehearsal can
use pre-rendered clips without changing the reading/result protocol. Clip
playback is a local runtime detail; if playback is disabled or the clip is
missing, the receipt should show that clearly and the visual result should still
complete.

TTS should be short. It should not explain the user. It should announce the signal and leave silence.

## Receipts And Data

Every real session should write a local receipt in dev mode:

```json
{
  "sessionId": "demo-001",
  "startedAt": "2026-06-28T10:00:00+08:00",
  "input": {
    "source": "browser",
    "mediaType": "audio/webm",
    "durationMs": 3810
  },
  "providers": {
    "stt": { "id": "local:funasr", "latencyMs": 920 },
    "tts": { "id": "local:clip", "latencyMs": 12 }
  },
  "transcript": "我在考虑辞职",
  "features": {},
  "readings": [],
  "result": {}
}
```

Do not commit receipts from real people. Do not commit raw recordings. Keep all local session output under ignored paths such as `sessions/`, `recordings/`, or `captures/`.

## Raspberry Pi Boundary

The Pi path should be an adapter, not a second product.

First Pi responsibilities:

- Start Chromium kiosk on the laptop-hosted `/?mode=device` UI.
- Read the side button through `gpiozero` only if that helps the demo.
- Send `pressed` and `released` events to `apps/server`.
- Keep microphone capture, STT, TTS, and receipts on the laptop for the hackathon.
- Optionally capture audio through USB mic later.
- Optionally play TTS through local speaker/HDMI later.

For the hackathon, keep STT and TTS on the laptop and let the Pi act as the object shell. That is architecturally valid as long as the event protocol is shared.

## Work Breakdown

### Stage 1: Protocol And Mock Loop

- Add `packages/protocol`.
- Define events, readings, features, transcript result, and session receipt schemas.
- Add `packages/core` reducer for session state.
- Add mock provider that accepts a manual transcript and fake features.
- Make UI consume `session.result` from the event stream.

Exit: one command creates a session, emits events, and drives the UI without real audio.

### Stage 2: Local Server

- Add `apps/server`.
- Use Fastify for HTTP.
- Add multipart upload endpoint.
- Add SSE `/events`.
- Add local session registry.
- Add receipt writing behind dev mode.

Exit: upload one audio blob and see events in the UI/debug log.

### Stage 3: Audio Normalization And Features

- Add `ffmpeg` normalization.
- Extract duration, RMS, silence, pause, and rough pitch features.
- Add visible provider/latency receipts.

Exit: one recording creates useful feature JSON even if STT is still manual.

### Stage 4: STT Provider Spike

- Try FunASR first for Chinese/mixed speech.
- Keep whisper.cpp or faster-whisper as local fallback.
- Keep manual transcript as demo fallback.

Exit: one spoken Chinese or mixed-language intention becomes transcript text locally.

### Stage 5: Readings And Result

- Implement text, voice, and timing heuristics.
- Compose majority/minority/consensus outcomes.
- Select top-window copy.
- Emit `session.result`.

Exit: real transcript and features produce three inspectable readings.

### Stage 6: TTS

- Start with local clips for result lines.
- Add Piper only if voice and latency are acceptable.
- Pause recording while TTS plays.

Exit: result is spoken locally and the UI holds silence.

### Stage 7: Pi Adapter

- Add `apps/device` only after laptop loop works.
- Read GPIO button.
- Send device events to server.
- Launch Chromium kiosk.

Exit: hardware button can drive the same session path.

## Key Risks

Audio format mismatch:

- Browser `MediaRecorder` may output different containers by browser. Normalize every upload.

STT setup time:

- Keep manual transcript provider as a first-class adapter for rehearsal.

Noisy room:

- Capture receipts. Allow operator transcript input through the same path.

Latency:

- Make each provider report latency. Prefer clips over dynamic TTS if TTS blocks the ritual.

Pi complexity:

- Do not move STT/TTS to Pi until the laptop path is stable.

Product drift:

- Keep readings as signals, not advice. Do not expose long explanations in the UI.

## Research Notes

Current useful primary sources:

- FunASR supports offline/streaming ASR plus VAD, punctuation, and related speech tasks: https://github.com/modelscope/FunASR
- faster-whisper uses CTranslate2 and supports CPU/GPU quantized local Whisper inference: https://github.com/SYSTRAN/faster-whisper
- whisper.cpp provides C/C++ local Whisper tooling with Apple Silicon and embedded-friendly paths: https://github.com/ggml-org/whisper.cpp
- Silero VAD supports 8 kHz and 16 kHz VAD with PyTorch/ONNX portability: https://github.com/snakers4/silero-vad
- Piper is a local neural TTS engine with CLI, web server, Python, and C/C++ paths: https://github.com/OHF-Voice/piper1-gpl
- Vosk is offline and works on lightweight devices including Raspberry Pi: https://alphacephei.com/vosk/
- sherpa-onnx is worth tracking for a future unified offline ASR/TTS path: https://k2-fsa.github.io/sherpa/onnx/index.html
- Browser recording should start from `MediaRecorder`: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
- SSE is enough for first backend-to-UI updates: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
- WebSocket remains available if true bidirectional streaming is needed: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- `ffmpeg` should handle edge audio conversion: https://ffmpeg.org/ffmpeg.html
- Pi button input should start with `gpiozero`: https://gpiozero.readthedocs.io/
- Pi kiosk mode is an official Raspberry Pi path: https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/
