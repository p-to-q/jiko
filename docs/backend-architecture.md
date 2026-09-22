# Backend Architecture

This document defines the non-UI system behind the first prototype.

The backend should not become an AI advisor. Its job is to turn one spoken intention into inspectable events, three bounded readings, a result phrase, and optional local speech output.

## Backend Thesis

Build a small event-driven backend first.

The first backend should be boring on purpose:

- Accept one recording or one manual transcript.
- Normalize audio into a known format.
- Call one explicitly selected STT adapter; default to local/self-hosted.
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
        +--> selected STT adapter (local/self-hosted default)
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
- `packages/readings`: first rule-based text, voice/delivery, and timing readings.
- `apps/server`: local HTTP server, event stream, upload handling, provider adapters, receipts, and TTS trigger.
- `apps/device`: Raspberry Pi GPIO/kiosk adapter. It should emit the same events as the laptop path.

The shared core must not know whether input came from browser `AudioWorklet` or
`MediaRecorder`, Raspberry Pi GPIO/audio, a Python worker, or an operator
shortcut.

## Server Transport

Use HTTP for commands and batch compatibility, Server-Sent Events for UI state
updates, and one bounded WebSocket for ordered PCM ingress.

Why:

- One compatibility recording upload is naturally a raw HTTP audio body;
  multipart is not required by the current `node:http` route.
- Operator controls are small HTTP commands.
- Pi button events can be small HTTP posts.
- The UI mostly needs backend-to-browser state updates.
- SSE keeps the state downlink replayable and separate from audio ingress.
- Ordered PCM needs bidirectional start/chunk/stop acknowledgements and strict
  attempt ownership, so it uses the fixed `jiko.ordered-pcm.v1` WebSocket.

Do not move ordinary controls or UI events onto WebSocket. The existing audio
socket is a narrow transport boundary, not a second state protocol.

Current prototype API:

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/health` | Check server and provider availability. |
| `GET` | `/events?sessionId=<id>` | Scoped SSE replay/live stream for one selected session; the unscoped stream is discovery/development only. |
| `POST` | `/sessions` | Create a session and emit `session.created`; an optional safe client id is exact-retry idempotent for the same source (`201` first, `200` replay, `400` invalid, `409` source collision). |
| `POST` | `/sessions/:sessionId/input-event` | Browser/device recording start, stop, or typed capture error. Exact start/stop source + monotonic timing retries return the original event; changed duplicates are rejected. |
| `POST` | `/sessions/:sessionId/audio` | Upload one recording and run the full pipeline. |
| `WS` | `/sessions/:sessionId/audio-stream` | Ordered binary PCM ingress using subprotocol `jiko.ordered-pcm.v1`; strict Origin, sequence, coverage, hash, and spool acknowledgements. |
| `POST` | `/sessions/:sessionId/manual-transcript` | Run the same pipeline from typed transcript when audio fails. |
| `POST` | `/sessions/:sessionId/demo-event` | Operator-only demo control through the normal event protocol. |
| `GET` | `/sessions/:sessionId/receipt` | Return the canonical `session_receipt_v1` snapshot. |

`POST /device/button` and `GET /audio/:assetId` appeared in the early design but
are not implemented endpoints. The Pi adapter calls the canonical session/input
routes directly, and local playback currently stays server-side.

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

### Attempt ownership and replay contract

The current protocol gives every session event the tuple
`(sessionId, attemptId, sequence)`. The server creates the attempt id, assigns a
contiguous positive sequence, and rejects events for a different attempt or the
wrong next sequence. A `session.result` also has to carry the same session id as
its event envelope.

The server additionally enforces attempt-level ownership rules:

- the first accepted `audio` or `manual` input claims the attempt, and a
  competing path receives `409`;
- one attempt can commit only one final result, so late work cannot replace the
  visible conclusion.

Producer retries are finite rather than exactly once. Client-generated session
creation is idempotent for the same source. Recording start and stop replay only
when source and local `monotonicMs` match exactly, with the same `durationMs` for
stop. A `session.error` carrying a monotonic timestamp also replays only when
source, message, code, and recoverability match exactly; this closes the
device-outbox response-loss window without merging unrelated failures. Audio
upload still has no operation id. The device button outbox is durable, while
server SSE replay and in-memory session state remain process-local.

Clients with an active session use `/events?sessionId=<id>`. Replay and live
delivery are filtered to that session, SSE ids use `attemptId:sequence`, and a
matching `Last-Event-ID` resumes after the acknowledged sequence. The shared
reducer ignores duplicates, rejects a foreign session/attempt, and exposes a
sequence gap instead of silently merging histories. This is an at-least-once,
idempotent-consumer design, not an exactly-once transport claim.

The unscoped stream remains useful only to discover a newly created device
session before the UI has an active id. Replay is bounded by session count and
age, but remains process-local: there is no durable cursor, retention-gap
snapshot, or restart recovery yet.

## Audio Ingest

Current laptop paths:

1. Default supported browsers warm and arm an `AudioWorklet`, emit 20 ms mono
   `s16le` frames at the actual context rate, aggregate roughly 80 ms chunks,
   and retain a bounded turn archive until the server finalizes it.
2. The ordered WebSocket validates attempt/profile identity, sequence, loss,
   totals, and source hash. `spooled` means ordered writes completed and remain
   readable by the current process; it does not mean `fsync`, restart
   durability, or ownership transfer. Complete PCM is WAVE-wrapped at source
   rate and then enters the same canonical ffmpeg/pipeline path after stop.
3. Explicit batch mode starts `MediaRecorder` locally before session
   registration finishes, holds the blob in memory, then sends stop and one raw
   `webm` / `ogg` / `wav` body.
4. The server records media type, duration, byte size, conversion latency, and
   ordered coverage where applicable in the receipt.

One shared process-local admission controller covers both ingress shapes.
HTTP requests and started ordered captures first take a bounded ingress slot;
their chunks and PCM/WAL increments then reserve from the same byte budget
before the server retains or writes them. The canonical pipeline separately
leases a bounded body-byte budget and one of a configured number of work slots
before normalization/STT begins. Leases release on every terminal path; if an
adapter ignores cancellation, its pipeline lease remains held until its actual
promise settles. `/health` exposes limits, current reservations, active leases,
and cumulative rejections. This is not multi-process or distributed admission.

Use `ffmpeg` at the edge for format conversion. The current implementation puts
batch raw and normalized working files in an OS temporary directory and deletes
both after the request. Ordered PCM and its minimal WAL are unlinked immediately
after open and exist only through process-owned handles until terminal cleanup.
The browser has no restart-safe outbox and the server has no restart-recoverable
audio WAL, so process death/resume is still a product blocker.

## STT Provider Strategy

Default policy: local or self-hosted. The server also retains one gated Deepgram
pre-recorded challenger as a trust-boundary reference; it is not a default or
fallback path, and live use requires the separate written
[Remote Audio Policy](remote-audio-policy.md) approval.

Implement STT as an adapter:

```ts
type TranscriptionProvider = {
  id: string;
  transcribe(input: AudioInput): Promise<TranscriptResult>;
};
```

Current candidate order (kept aligned with the runtime and algorithm evaluation):

1. `manual`: deterministic fallback for rehearsals and tests, never an audio benchmark.
2. sherpa-onnx SenseVoice int8: common ARM64/device candidate.
3. quantized `whisper.cpp` tiny/base: portable challenger.
4. self-hosted FunASR: laptop Chinese/mixed-language reference.
5. Deepgram batch: optional third-party comparison only after written policy
   approval and when provider selection, deployment flag, and per-upload named
   consent all agree.

Do not make the demo depend on cloud STT. Deepgram is HTTPS-only, forces
`mip_opt_out=true`, has no local fallback, and is marked remote with request and
resolved model provenance in the session receipt. The built-in browser does not
opt uploads into this boundary.

Treat Deepgram as the first strict remote batch reference adapter, not as a
provider monopoly or a streaming result. Doubao/Volcengine and other remote
challengers remain unevaluated; adding one requires the same per-upload named
consent, global policy, pinned model identity, redirect refusal, diagnostics,
and receipt contract rather than a provider-specific shortcut.

The current adapters are integration boundaries, not winners. Select a default
only after the identical frozen corpus measures CER/WER, hallucination,
cold/warm latency, RSS, power/thermal behavior, and target-hardware p95.

SenseVoice now runs behind one process-wide, single-flight Python worker rather
than rebuilding the recognizer for each clip. Its readiness message is accepted
only after model load and includes runtime/configuration plus full model/token
hashes; cancellation terminates the active worker and the next request reloads
it. Fake-worker tests prove this protocol and lifecycle. They do not prove a
real SenseVoice install, recognition quality, memory use, or Pi/CM5 latency.
For each admitted SenseVoice call, the canonical receipt now carries that
loaded runtime/configuration and the model/token SHA-256 plus byte counts. A
cold-start timeout or configuration failure before loaded readiness has no
execution identity; a timeout or crash after admission keeps the loaded
identity without treating it as a successful transcript.

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

The current reference feature extractor is transparent TypeScript DSP. A future
Python/native worker is justified only if target traces show a bottleneck and it
has supervision, cancellation, version receipts, and fixture parity.

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

In the current server, the committed `session.result` is stored and published
before local speech is scheduled. The HTTP pipeline response therefore does not
wait for a reveal delay or for TTS playback. Client-side reveal pacing may stage
the already-known conclusion, but it is not computation latency and must not
change result identity.

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

The implemented output scheduler owns a single local playback slot. Newer
output supersedes older output, while a new session, new recording, reset,
error, or shutdown cancels the active clip/Piper process. This cancellation path
has unit coverage at the scheduler and process boundaries; it has not yet been
proved on the target speaker/Piper installation. Attempt-scoped reset
cancellation also reaches normalization and local/self-hosted STT, and sealed
checks reject late feature/reading commits. One monotonic attempt deadline now
starts at stop (or direct-upload acceptance), cuts STT off early enough to
compose a measured partial result, and rejects overdue commits. It is a logical
state bound: slow request bodies and synchronous DSP are not yet physically
preemptible, and external worker/service supervision is still absent.

TTS should be short. It should not explain the user. It should announce the signal and leave silence.

## Receipts And Data

Every real session should write a local receipt in dev mode:

```json
{
  "schemaVersion": "session_receipt_v1",
  "sessionId": "demo-001",
  "attemptId": "attempt-001",
  "lastSequence": 4,
  "startedAt": "2026-06-28T10:00:00+08:00",
  "updatedAt": "2026-06-28T10:00:01+08:00",
  "status": "processing",
  "source": "browser",
  "input": {
    "audio": {
      "source": "browser",
      "mediaType": "audio/webm",
      "byteSize": 48231,
      "durationMs": 3810
    },
    "normalizedAudio": {
      "mediaType": "audio/wav",
      "sampleRateHz": 16000,
      "channelCount": 1,
      "durationMs": 3810,
      "latencyMs": 118
    },
    "audioStored": false
  },
  "providers": {
    "stt": { "id": "local:funasr", "latencyMs": 920, "outcome": "completed" },
    "tts": { "id": "local:clip", "latencyMs": 12 }
  },
  "transcript": {
    "text": "我在考虑辞职",
    "semanticText": "我在考虑辞职",
    "language": "zh",
    "provider": "local:funasr",
    "latencyMs": 920
  },
  "pipeline": {
    "startedAt": "2026-06-28T10:00:00.000Z",
    "finishedAt": "2026-06-28T10:00:01.180Z",
    "totalLatencyMs": 1180,
    "stages": [
      { "stage": "normalize", "status": "ready", "latencyMs": 118 },
      { "stage": "features", "status": "ready", "latencyMs": 31 },
      { "stage": "stt", "status": "ready", "latencyMs": 920 },
      { "stage": "enhance", "status": "ready", "latencyMs": 1 },
      { "stage": "readings", "status": "ready", "latencyMs": 2 },
      { "stage": "total", "status": "ready", "latencyMs": 1180 }
    ]
  },
  "readings": [],
  "events": [],
  "errors": []
}
```

This is the strict, versioned `SessionReceiptSchema`. `ReceiptWriter` and the
live receipt endpoint use the same `buildSessionReceipt()` function, so a HIL
harness never has to guess which of two debug shapes is durable. Every snapshot
is parsed before it is exposed or written.

New receipts give `providers.stt` an explicit `outcome`: `completed`,
`not_run`, `provider_unavailable`, `timed_out`, or `failed`. The optional
`execution` object is present only when a runtime reached loaded readiness for
that call. It contains runtime version, effective language/thread/execution
provider/ITN configuration, and strict model/token identities. The fields are
optional so earlier `session_receipt_v1` files still parse; new identity-bearing
records reject malformed hashes, unknown fields, provider mismatch, and
outcomes that contradict the transcript failure.

Within one server process, snapshots for the same session are serialized before
their atomic rename. A slow or failed older write therefore cannot overwrite or
block a later reset snapshot, while different sessions still write in parallel.
This is not a multi-process lock and does not provide restart replay.

Stage elapsed times use a monotonic clock. Wall timestamps exist only to place
the receipt in time. Do not commit receipts from real people. Do not commit raw
recordings. Keep all local session output under ignored paths such as
`sessions/`, `recordings/`, or `captures/`.

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

### Stage 2: Local Server (historical plan; implemented differently)

- Add `apps/server`.
- Use the built-in Node HTTP server.
- Add a bounded raw-audio upload endpoint.
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

- Compare sherpa-onnx SenseVoice int8, quantized whisper.cpp, and self-hosted
  FunASR on the same frozen corpus and target profiles.
- Keep manual transcript as demo fallback.

Exit: one spoken Chinese or mixed-language intention becomes transcript text locally.

### Stage 5: Readings And Result

- Implement text, observable voice/delivery, and timing heuristics.
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

- Ordered capture records its exact PCM profile and normalizes once; batch
  `MediaRecorder` can still output different containers and every upload must
  be normalized.

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
- Browser PCM capture uses AudioWorklet at the edge: https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet
- `MediaRecorder` remains the explicit batch compatibility path: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
- SSE is enough for first backend-to-UI updates: https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events
- WebSocket carries only the ordered PCM ingress: https://developer.mozilla.org/en-US/docs/Web/API/WebSockets_API
- `ffmpeg` should handle edge audio conversion: https://ffmpeg.org/ffmpeg.html
- Pi button input should start with `gpiozero`: https://gpiozero.readthedocs.io/
- Pi kiosk mode is an official Raspberry Pi path: https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/
