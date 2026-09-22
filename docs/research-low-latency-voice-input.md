# Low-Latency Voice Input: Local And API Paths

Status: research decision and implementation contract
Reviewed: 2026-09-18
Scope: capture-to-final speech input for the laptop shell and Pi/CM5 shell;
local ASR remains the default, while remote ASR is an explicit named option.

This note answers a narrow question: why do some voice-input products feel
fast, what can Jiko reuse from current open implementations, and how should a
Doubao/Volcengine route coexist with local inference? It does not claim that a
provider, model, latency target, or hardware board has passed a Jiko benchmark.

The larger model and compute decision remains in
[Edge Speech, Compute, And Hardware Co-Design](research-edge-speech-optimization.md),
and the current recommended paths remain visible in
[the edge speech route map](edge-speech-routes-v1.svg).

## Decision

1. Perceived speed is a pipeline property, not just a model property. Jiko now
   captures and transports ordered browser PCM while the button is held, but
   the integrated STT still starts after release. The next latency step is to
   begin provider work on that same stream, expose honest progress, and then
   finalize after release; swapping the batch provider alone would not create a
   genuinely realtime product.
2. Use one ordered PCM ingress and one scheduler for local and remote
   candidates. A remote service is an adapter, not a second product pipeline.
3. Keep local/self-hosted ASR as the default and keep the remote-provider adapter
   class first-class. Deepgram is the only implemented remote boundary, but a
   live paid-provider run is not currently authorized. Provider selection,
   process opt-in, and per-request consent are enforcement gates, not policy
   approval. Deepgram, Doubao/Volcengine, or another remote route requires the
   written [Remote Audio Policy](remote-audio-policy.md) decision before use.
4. Evaluate Doubao/Volcengine as the first Chinese-focused streaming API
   challenger. The current Deepgram adapter is a strict **batch** trust-boundary
   reference, not proof of streaming performance and not the only API option.
5. A partial transcript may drive an observer preview only. Only a finalized,
   current-attempt result with complete audio coverage can enter Jiko's content
   reading.
6. Never silently discard audio, turn the latest partial into a final, change
   providers, or upload audio after a local failure. Every degradation is a
   state transition and a receipt.
7. Copy architecture and tests from compatible open-source references; do not
   transplant desktop-specific capture code or vendor demo code wholesale.

The observation that a friend's Doubao-based controller feels fast is useful
product evidence, but the cause is still a hypothesis. Likely contributors are
streaming during speech, preconnection, provider-side capacity, endpointing,
and a short post-release path. The benchmark must isolate those factors before
crediting the model brand.

## Product Meaning Stays Intact

Jiko's public product language remains **content / emotion / context**. This
research does not rename or erase those three questions.

The current engineering evidence is deliberately narrower:

| Product language | Current measurable implementation evidence | Boundary |
| --- | --- | --- |
| content | adapter-extracted transcript plus a separately versioned semantic view | exact raw-provider text and a machine-readable transform diff are still P0 work; ASR confidence, punctuation, or a rewrite is not user intent |
| emotion | delivery/voice observations such as calibrated energy, pitch, pauses, clipping, and availability | no claim to infer an inner emotional state |
| context | interaction/timing observations such as press, first speech, gaps, continuation, and release | no claim to know unconstrained life or screen context |

"Emotion" and "context" therefore remain product hypotheses to test with
people. They are not deleted, and they are not made scientifically stronger by
calling delivery and timing models emotion/context detectors.

## Evidence Inspected

The following repositories were read at exact revisions on 2026-09-18. A
commit pin means the observations below are reproducible; it does not mean the
project or its published performance is endorsed.

| Reference | Revision | License observed | Why it matters |
| --- | --- | --- | --- |
| [TypeFree](https://github.com/Charlo-O/typefree/tree/09ee0607824fa6aed56c15d6fb42336d867188d2) | `09ee0607824fa6aed56c15d6fb42336d867188d2` | MIT | working Electron/Tauri Doubao stream with partial/final events and full-audio fallback |
| [VoicePi](https://github.com/pi-dal/VoicePi/tree/7533860c439c4d3787a7eab333f8daf41ff26f38) | `7533860c439c4d3787a7eab333f8daf41ff26f38` | MIT | provider-neutral streaming interface, explicit state machine, bounded queues, protocol and latency tests |
| [Volcengine AI App Lab](https://github.com/volcengine/ai-app-lab/tree/88c983d70a098110fc839f8cd05e29fa7715e6ce) | `88c983d70a098110fc839f8cd05e29fa7715e6ce` | mixed; `arkitect` is Apache-2.0, `demohouse` has a separate self-use license | official protocol/example evidence, not a code-copy source for a product |

Primary vendor references:

- [Volcengine's current large-model streaming ASR API](https://docs.volcengine.com/docs/DoubaoVoice/LargemodelstreamingautomaticspeechrecognitionAPI?lang=zh)
  was rechecked on 2026-09-18; the page reports a 2026-08-06 update. It now
  recommends the optimized bidirectional endpoint
  `wss://openspeech.bytedance.com/api/v3/sauc/bigmodel_async`, which returns
  only when recognition changes rather than forcing one response per input
  packet. The provider recommends roughly 100--200 ms packets at the same
  cadence and currently specifies 16 kHz, 16-bit PCM for raw PCM input. These
  are provider-adapter constraints, not Jiko's canonical capture cadence: an
  adapter may aggregate two 80 ms Jiko chunks for this route without changing
  the source stream seen by local candidates.
- [Volcengine speech-recognition product updates](https://www.volcengine.com/docs/6561/162929?lang=en)
  distinguish streaming-input and bidirectional streaming modes and publish
  endpoint changes. This page is mutable, so a Jiko receipt must pin the actual
  endpoint, resource identifier, model/version, and date.
- [Volcengine RTC ASR configuration](https://www.volcengine.com/docs/6348/1807452?lang=zh)
  exposes streaming (`StreamMode: 0`), one-shot (`1`), and bidirectional
  streaming with a second refinement pass (`2`), plus hotwords, context,
  silence duration, and optional semantic endpointing. These controls are
  candidates to measure, not recommended defaults.
- [Volcengine's pinned live voice call example](https://github.com/volcengine/ai-app-lab/blob/88c983d70a098110fc839f8cd05e29fa7715e6ce/demohouse/live_voice_call/README.md)
  documents its binary WebSocket envelope and state/event vocabulary. Its
  `demohouse` license must be reviewed before copying implementation code.

Vendor accuracy or latency claims are discovery signals only. None are Jiko
results.

The same current API page exposes several controls that must be frozen in a
benchmark tuple rather than accepted as hidden defaults:

- `enable_nonstream` adds a second, non-streaming refinement pass after VAD
  segmentation. Its default endpoint window is 800 ms and the documented
  lower bound is 200 ms; `force_to_speech_time` can prevent very short early
  endpoints. This is a latency/accuracy route, not a free accuracy toggle.
- `enable_accelerate_text` explicitly trades first-character accuracy for
  earlier output. Jiko should benchmark it as a separate challenger and never
  mix its results into the unaccelerated denominator.
- punctuation and ITN default on, while semantic smoothing is off. The adapter
  must retain the exact provider final plus the configured transform tuple;
  smoothing cannot silently erase repetitions, corrections, negation, or
  modality before the content line sees them.
- bidirectional hotword input is limited to a much smaller context than the
  non-streaming route, while dialogue context has its own turn/token bound.
  Jiko therefore sends a bounded, hashed allowlist and selected product
  context, never an unbounded screen or conversation dump.
- `result_type=single` changes the response from cumulative to incremental.
  The adapter must normalize either shape into the same replaceable-partial /
  exactly-once-final contract before the scheduler sees it.

## What The Reference Implementations Actually Do

### TypeFree: fast path with useful warnings

The inspected path starts a Tauri-hosted Volcengine WebSocket session, captures
browser audio, resamples to mono 16 kHz PCM16, sends roughly 200 ms chunks, and
publishes session-bound partial/final transcript events. Audio produced while
the WebSocket handshake is in progress can wait in a Rust channel, so recording
does not wait for the network connection.

Useful patterns to adopt or adapt:

- start the ASR session at button-down, not after button-up;
- bind every partial and final to a session identity;
- serialize chunk sends and send an explicit finish marker;
- keep partial text visually separate from final text;
- measure audio duration and stop-to-result time;
- retain an independent complete source only when an explicitly authorized
  fallback needs it.

Important reasons not to copy the path as-is:

- `createScriptProcessor(4096)` is deprecated and runs callbacks on the browser
  main thread; Jiko should use `AudioWorklet` or native/device PCM capture;
- its linear interpolation downsampler has no explicit anti-alias filter;
- a 512-entry queue at 200 ms per chunk can represent about 102 seconds of
  pending audio, which hides a failed consumer instead of applying a product
  deadline;
- `allChunks` retains the full PCM attempt without a product-range bound;
- an optimistic latest partial can become the result after stream failure;
- complete-audio fallback is automatic in the dictation flow;
- credential/UI storage and transcript logging choices do not meet Jiko's
  server-side secret and no-content-log policy;
- punctuation, ITN, generic hotwords, and optional generative cleanup optimize
  dictation fluency, while Jiko must first preserve literal negation, modality,
  repetition, and correction.

Relevant pinned files include
[`audioManager.js`](https://github.com/Charlo-O/typefree/blob/09ee0607824fa6aed56c15d6fb42336d867188d2/src/helpers/audioManager.js),
[`transcription.rs`](https://github.com/Charlo-O/typefree/blob/09ee0607824fa6aed56c15d6fb42336d867188d2/src-tauri/src/commands/transcription.rs),
and
[`doubaoapi.md`](https://github.com/Charlo-O/typefree/blob/09ee0607824fa6aed56c15d6fb42336d867188d2/doubaoapi.md).

### VoicePi: the stronger systems reference

VoicePi provides a useful provider-neutral contract:

```text
connect -> send PCM frames* -> finish input -> await final -> close
```

Its event type distinguishes partial, final, timeout, server close, and protocol
failure. The coordinator uses explicit connecting, buffer-draining, streaming,
batch-fallback, finalizing, completed, failed, and cancelled states. Capture can
begin while connection proceeds; a bounded frame pump reports overflow; the
Volcengine adapter uses sequence numbers, a final negative sequence, exact
binary framing, and test seams for a mock WebSocket. It also records monotonic
milestones for recording start, first partial, stop, transcript resolution,
refinement, and insertion.

Patterns to adopt:

- provider-neutral streaming lifecycle and typed events;
- one actor/owner for stream state and cancellation;
- bounded preconnect and send queues;
- connection and finalization deadlines;
- explicit partial/final transcript composition;
- protocol parser tests, sequence tests, timeout tests, cancellation tests, and
  overflow tests;
- monotonic stage timestamps rather than one undifferentiated "latency";
- a separately retained source for controlled fallback.

Patterns to adapt or reject:

- its 160,000-byte preconnect buffer removes oldest frames when full without
  emitting a gap. At 16 kHz mono PCM16 this is roughly five seconds; Jiko must
  emit overflow/gap and refuse a falsely complete result, or switch to an
  explicitly authorized complete source;
- array `removeFirst` and repeated `Data` slicing/copying are poor templates for
  a Pi hot path; use a fixed-capacity ring or indexed deque;
- conversion and copying inside the audio callback must be profiled and moved
  off the real-time thread when it exceeds the capture budget;
- automatic batch fallback is a dictation convenience, not Jiko's policy;
- a full temporary recording needs an explicit retention and ownership rule;
- a median-oriented history is insufficient; Jiko needs p95/max and error
  slices;
- endpoint normalization accepts more schemes/hosts than Jiko should; the
  remote adapter must require WSS, a configured allowlist, exact region, and no
  redirect.

Relevant pinned files include
[`RemoteASRStreamingClient.swift`](https://github.com/pi-dal/VoicePi/blob/7533860c439c4d3787a7eab333f8daf41ff26f38/Sources/VoicePi/Adapters/ASR/RemoteASRStreamingClient.swift),
[`RealtimeASRSessionCoordinator.swift`](https://github.com/pi-dal/VoicePi/blob/7533860c439c4d3787a7eab333f8daf41ff26f38/Sources/VoicePi/Adapters/ASR/RealtimeASRSessionCoordinator.swift),
[`RealtimeAudioFramePump.swift`](https://github.com/pi-dal/VoicePi/blob/7533860c439c4d3787a7eab333f8daf41ff26f38/Sources/VoicePi/Adapters/ASR/RealtimeAudioFramePump.swift),
[`RealtimeASRPreconnectBuffer.swift`](https://github.com/pi-dal/VoicePi/blob/7533860c439c4d3787a7eab333f8daf41ff26f38/Sources/VoicePi/Core/Processing/RealtimeASRPreconnectBuffer.swift),
[`VolcengineRealtimeProtocol.swift`](https://github.com/pi-dal/VoicePi/blob/7533860c439c4d3787a7eab333f8daf41ff26f38/Sources/VoicePi/Adapters/ASR/VolcengineRealtimeProtocol.swift),
and the corresponding files under
[`Tests/VoicePiTests`](https://github.com/pi-dal/VoicePi/tree/7533860c439c4d3787a7eab333f8daf41ff26f38/Tests/VoicePiTests).

## Jiko Reference Architecture

The same source stream feeds local evidence and, only when authorized, a remote
challenger:

```text
button down
  -> immediate device acknowledgement
  -> start attempt + capture profile
  -> fixed-format PCM source ring
       |-> VAD + delivery features
       |-> local ASR (default class; batch today, streaming challenger planned)
       `-> named remote streaming ASR (explicit option)
button up
  -> close source with final sequence
  -> provider final inside remaining session deadline
  -> adapter transcript -> semantic view -> content reading
  -> waveform/VAD evidence ----------------> delivery reading
  -> source-monotonic interaction events ---> timing reading
  -> coverage policy composes the three separately computed readings
  -> one authoritative session.result commit in the current process
```

### Source and transport contract

The shared `ordered_pcm_v1` protocol represents three canonical messages. The
browser shell now transports them end to end; the Pi/CM5 shell does not yet:

| Message | Required identity/evidence |
| --- | --- |
| `audio.start` | session id, attempt id, source id, audio-profile hash, source-monotonic origin, expected format |
| `audio.chunk` | all start identity, monotonically increasing sequence, source timestamp, frame count, PCM bytes, capture/drop counters |
| `audio.stop` | final sequence, source release timestamp, captured frames/bytes, gap/overflow summary, source hash when available |

Rules:

- Begin with 20 ms capture frames and test transport aggregation around
  80–100 ms. These are experiment values, not frozen constants. The benchmark
  must include a 200 ms arm because TypeFree shows that it can still feel fast
  over a good network.
- Normalize once into the chosen PCM profile. A provider that requires another
  format owns that conversion at its adapter boundary.
- Keep a fixed-capacity ring. Do not release source ownership on socket enqueue.
  The current browser retains its bounded turn archive until the server returns
  `finalized`; per-chunk `spooled` means ordered writes completed and remain
  readable by the current process, not `fsync`, restart durability, or ownership
  transfer. A future Pi/offline path must add a restart-recoverable WAL before it
  may advance on a `host_wal_durable` acknowledgement.
- Any missing sequence, overwritten frame, overflow, or truncated first/last
  speech region makes coverage incomplete. No "best effort" transcript may be
  labeled faithful without that flag.
- Bound queues by bytes and time and report high-water marks. Never encode the
  product deadline as hundreds of queued chunks.
- Partial hypotheses are replaceable. A final transcript is accepted exactly
  once and only for the current attempt.
- Reset/cancel invalidates all late partials and finals before UI, readings, and
  playback.

### Capture implementation by shell

| Shell | Capture edge | Shared behavior |
| --- | --- | --- |
| laptop/browser | implemented `AudioWorklet`: 20 ms mono `s16le` frames at an explicit 16/44.1/48 kHz profile, roughly 80 ms chunks, bounded archive/in-flight flow, cumulative ACKs and source hash | same ordered schema and post-stop canonical pipeline today; stop drain/send and final-ACK budgets are separate, and a lost final ACK is reconciled by session/attempt readback; an optional provider-neutral streaming seam is wired to this ingress, but no real adapter is configured; Chromium fake-mic is covered, physical/Safari/mobile evidence is not |
| Pi/CM5 | experimental Python `arecord` stdout edge emits the same mono s16le profile and binary JPCM start/chunk/stop contract | fake-process tests cover bounded queue loss, xrun evidence, timeout/cancel/escalation, hash/counters, and TypeScript decoding; physical ALSA/WebSocket/HIL and button ownership remain unproved |

`MediaRecorder.start(timeslice)` is not sufficient evidence of this contract.
It may emit codec containers at irregular boundaries and still lacks the
application-level ordered sequence/gap accounting and acknowledgements used by
the current PCM path. Restart durability remains separate future
`host_wal_durable` work.

### Provider and scheduler contract

The server now enforces this provider-neutral shape:

```text
open(identity, audio_profile, deadline)
push(sequence, pcm)
finish(final_sequence)
observer: replaceable partial(identity, revision, coverage_sequence)
return: exactly one final(identity, final_sequence, transcript)
cancel(reason)
```

This is an experimental integration seam, not a configured model. A fake
conformance harness proves bounded PCM/output queues, attempt identity, ordered
drain before stop flush, deadline, cancellation, duplicate-final rejection,
and suppression of late partial/final events. Partials have only a transient
observer callback and are absent from the session event store. Only the final
returned by `finish()` can be injected into transcript enhancement and
readings. Without an injected adapter, the existing batch path is unchanged.

Provider-specific endpointing, hotwords, context, punctuation, and ITN are
configuration recorded in the receipt. They are not hidden inside a generic
`transcribe()` call.

The scheduler owns the attempt deadline. A provider timeout cannot extend it.
It also owns final acceptance, so two providers cannot race two product results
into the UI. Benchmark shadow mode may run a second candidate only on consented
or synthetic/licensed audio; it writes comparison artifacts but never a second
`session.result`.

### LAN trust boundary target

The source server and production unit bind loopback by default. Exact Origin
and WebSocket subprotocol checks reduce browser misuse but do not authenticate a
device; a non-loopback `HOST` is therefore not a release profile.

The smallest two-shell-compatible LAN design is an installation bootstrap plus
an opaque, attempt-scoped capability:

- issue at least 256 random bits from authenticated `POST /sessions`, store only
  its hash, and bind it to principal, source, session, attempt, scopes, expiry,
  and terminal state;
- send it as `Authorization: Bearer` for HTTP mutation and as a second
  credential subprotocol for browser WebSocket upgrade; validate before reading
  a large body, claiming input, allocating an actor, or opening a spool;
- never put it in a URL, shared audio message, `VITE_*`, local storage, event,
  receipt, error, or log; the server selects only `jiko.ordered-pcm.v1` as the
  returned WebSocket protocol;
- use a device enrollment secret for the Pi shell and a secure, HTTP-only,
  same-site pairing cookie for the browser shell; operator/manual scopes remain
  separate even though their actions enter the same canonical event protocol;
- protect transcript/receipt/session/SSE reads separately and disable unscoped
  SSE outside loopback;
- require HTTPS/WSS, exact origins, bootstrap identity, and authentication when
  a future explicit LAN profile is enabled; startup must fail closed when any
  prerequisite is absent.

This belongs at the server gateway and two transport edges, not in the shared
product core. Restart invalidation is acceptable until session state itself is
restart-recoverable; the client must end the old turn explicitly rather than
silently rebinding it.

## Local And API Route Policy

| Route | Product status | Authorization | Allowed fallback |
| --- | --- | --- | --- |
| persistent local SenseVoice batch | integrated baseline, not selected winner | default local policy | explicit incomplete result; no upload |
| local streaming Zipformer/Moonshine challenger | next implementation/benchmark path | default local policy | named local fallback only if session profile permits it |
| Deepgram pre-recorded batch | implemented strict remote-boundary reference | all three gates: `STT_PROVIDER=deepgram`, `JIKO_ALLOW_REMOTE_AUDIO=1`, and explicit per-upload `deepgram` consent | none |
| Doubao/Volcengine bidirectional stream | next Chinese remote challenger; not implemented or currently authorized for audio egress | explicit project-policy decision first; only then server enable flag, pinned WSS host/region/resource/model, and per-session consent | none unless a later policy explicitly authorizes that named route for the session |

The browser never receives provider secrets. Remote enablement alone is not
consent. A configured key alone is not enablement. See
[Data Handling](data-handling.md) for the currently implemented Deepgram gate.

For Doubao/Volcengine, the first spike must record:

- endpoint origin and region;
- resource id, requested/resolved model and version where exposed;
- stream mode and endpoint/VAD settings;
- hotword/context list hash, never unbounded screen context;
- PCM profile, chunk cadence, bytes and sequences;
- connect, first-send, first-partial, stable-segment, release, final, and total
  timestamps;
- reconnect/retry count, status/error class, provider request id, and cost unit;
- consent/policy identity and retention/training controls that were actually
  requested.

Do not put decision-bearing terms such as `辞职`, `留下`, `quit`, or `stay` in a
hotword list. That could bias the evidence before Jiko's content line runs.

## Fallback Semantics

Fallback is a product policy, not an exception handler.

| Failure | Default behavior | Why |
| --- | --- | --- |
| remote not authorized | do not instantiate or contact it | trust boundary is closed |
| connect misses its budget before speech | continue the already-running local route; mark remote unavailable | capture must not wait for WAN |
| stream queue overflows or sequence gaps | mark that route coverage-incomplete and stop accepting its final | first words/negation may be missing |
| provider fails before release | keep other already-authorized route; otherwise produce explicit partial/unavailable | no surprise route switch |
| provider final misses remaining deadline | cancel it and commit measured partial/unavailable product state | no indefinite spinner or late mutation |
| reset/new attempt | cancel all old provider work and reject late messages by attempt id | exactly one current result |
| nonzero audio yields an empty/filler-only semantic transcript | mark content unavailable; retain independently measured delivery/timing | an empty content line is not a neutral vote |
| normalized PCM is exactly all zero | invalidate all three evidence lines for that spoken attempt, retain raw event/provider diagnostics, emit insufficient/no TTS | zero speech duration must not become three measured `static` votes |

A complete retained source may be used for a batch retry only when the active
session policy named that retry before capture, storage duration is bounded,
and the receipt shows why it ran. The newest partial is never silently promoted
to a final.

## Benchmark That Can Decide The Route

Local and remote candidates must consume the same ordered source audio. Batch
and streaming results remain separate because their latency boundaries differ.

### Required measurements

- button/click to visible acknowledgement;
- capture start to first process-spooled acknowledgement today, and first `host_wal_durable` acknowledgement after the future WAL exists;
- connect/prewarm time and whether it overlaps speech;
- speech-segment end to first partial and first stable segment;
- release to provider final;
- release to authoritative current-process `session.result` commit;
- partial revision count, false-final count, first/last-phoneme loss, sequence
  gaps, queue high-water and dropped bytes;
- CER, WER, mixed-token error, keyword/negation/modality preservation, silence
  false positive, and abstention;
- cold/warm CPU, RSS, storage, temperature, throttling, and energy for local;
- WAN RTT/loss, bytes, reconnect, 429/5xx, region, and price unit for remote;
- exact model/runtime/config/corpus/audio-profile hashes.

Do not collapse transcript lag and end-of-turn lag. Deepgram's current
[measurement guide](https://developers.deepgram.com/docs/measuring-streaming-latency)
uses the difference between the client audio cursor and the interim transcript
cursor for live transcript lag, and measures speech-end to endpoint event
separately. It also warns that provider transcript timestamps are not
millisecond-precision timing clocks and that final messages include endpoint
waiting. Jiko should apply those boundaries to every local and remote provider,
using its own source-monotonic capture/VAD clock as ground truth.

### Network and endpoint arms

Run every remote candidate under controlled low/median/high RTT, loss, short
disconnect, DNS failure, TLS failure, 429, 5xx, and post-upload disconnect.
Compare client endpointing, provider endpointing, and manual button release.
Compare provider punctuation/ITN on and off against the same faithful reference.

### Human-facing hypotheses

These inherit the alpha budgets in
[Human Experience And Interface Audit](human-experience-audit.md); they are not
measured achievements:

| Boundary | Provisional target |
| --- | ---: |
| input to acknowledgement | p95 <= 100 ms, hard <= 200 ms |
| release to received/processing state | p95 <= 150 ms |
| release to first stable measured signal | p95 <= 700 ms |
| release to complete warmed visual result | p50 <= 1.2 s, p95 <= 2.5 s |
| hard product deadline | 4 s; then explicit partial/unavailable/retry |

The comparison report must explain whether a route feels faster because it
streamed during the utterance, finalized faster, produced earlier partials, or
shortened later product work. A single total number cannot answer that.

## Adopt, Adapt, Reject

| Decision | Item |
| --- | --- |
| adopt | provider-neutral lifecycle; explicit state machine; partial/final distinction; monotonic stage timings; protocol mocks; bounded queues; cancellation tests |
| adapt | preconnect buffering into an acknowledged source ring; complete-audio fallback into preauthorized policy; 100/200 ms reference chunks into a measured 20 ms capture plus 80–100 ms transport experiment |
| reject | deprecated main-thread capture; unfiltered linear resampling; unbounded/full-attempt in-memory retention; silent drop-oldest; partial-as-final; automatic local-to-cloud failover; secrets in UI; transcript body logs |
| defer | custom neural operators, accelerator-specific graphs, and semantic endpointing until a profile/corpus proves a bottleneck or quality need |

## Implementation Order

P0 contracts and correctness:

1. **Browser slice implemented; Pi edge host-tested.** The versioned
   `audio.start/chunk/stop` contract now crosses browser `AudioWorklet`, bounded
   WebSocket transport, server actor, canonical pipeline, and receipt. Add the
   native adapter to one supervised Pi button/capture owner, then prove it with
   the selected ALSA device under target kiosk/load/xrun tests.
2. **Process-lifetime spool implemented; restart durability pending.** Browser
   overflow/gaps hard-fail and the server completes ordered, process-readable
   writes before `spooled`, but it does not `fsync` and its unlinked files
   intentionally cannot recover after process death. Process-wide incremental
   spool/WAL byte admission now happens before each write and is released on
   success, error, disconnect, or timeout. Add a privacy-bounded,
   restart-recoverable Pi/host WAL plus multi-process quota before claiming
   durable ownership transfer.
3. **Browser control preserved.** Keep the explicit pre-start batch path for
   compatibility comparisons; do not add mid-turn fallback or call the current
   fake-mic E2E physical-device evidence.
4. **Provider-neutral lifecycle implemented; real adapter pending.** The
   ordered-PCM actor has a default-off injection seam, bounded queue/output,
   current-attempt checks, stop flush, exactly-once final arbitration,
   deadline/cancel handling, and a fake conformance suite. Keep it default-off
   until a pinned local Zipformer or Moonshine adapter passes the same tests;
   do not treat the fake as model evidence.
5. Extend the STT receipt with stage timings, chunk/coverage evidence, endpoint
   policy, and provider-specific configuration hashes.

P1 candidates and evidence:

6. Add a local streaming Zipformer candidate on the common stream; compare it
   with the persistent SenseVoice baseline.
7. Build only a transport-free Doubao/Volcengine protocol mock while the current
   policy is unchanged. A real bidirectional adapter or audio egress requires an
   explicit policy decision first, then an allowlisted WSS endpoint, exact
   resource/model identity, process enablement, per-session consent, and mock
   protocol tests.
8. Add the streaming benchmark receipt and network fault proxy; keep batch
   results in the existing suite.
9. Render partials only in an observer/debug surface; keep the physical reading
   pending until the accepted final or deadline state.
10. Run the same frozen, licensed/synthetic corpus on laptop and Pi/CM5, then
    choose a default only after quality, latency, memory, thermal, privacy,
    license, and failure-correctness gates all have receipts.

P2 optimization after a winner exists:

11. Profile audio copy/resampling, feature framing, encoder, decoder, and
    tokenization separately; use upstream runtimes/kernels before custom code.
12. Tune queue depth, chunk aggregation, endpointing, thread affinity,
    quantization, cache/prewarm, and retained-source duration with differential
    quality tests. Hand-write an operator only for a stable measured hotspot
    with an end-to-end win.

## Measured Local Batch Spike

The first real-model host run now narrows two design choices. A pinned
`sherpa-onnx@1.13.8` worker and sherpa-onnx's 2025-09-09 int8 conversion of the
ASLP-lab WSYue SenseVoice fine-tune ran five non-human synthetic fixtures ten
times each on the ARM64 development Mac. The package points to mutable upstream
`main` and ships no license snapshot; the source repository currently declares
Apache-2.0, but this measured conversion's license provenance remains unresolved.
The four-thread, ITN-off arm completed 50/50 calls with WAV-to-text p50
`72.466 ms`, p95 `134.634 ms`, and max `148.943 ms`. On this tiny set it reported
Chinese CER `0/300`, English WER `0/100`, code-switch error `0/110`, and keyword
preservation `120/120`.

That is not a model-selection result. Digital silence produced a short filler in
all `10/10` silence calls. ITN-on runs deleted a leading English pronoun and
reported WER `10/100`, so the faithful local default is now ITN off; ITN can
return only as a separately receipted semantic transform. Two otherwise
identical four-thread ITN-on runs also moved from p95 `248.704 ms` to
`71.443 ms`, demonstrating that uncontrolled laptop load dominates a tiny
timing sample. No thread count, model winner, or target SLO is selected from
this spike.

The immediate failure is now contained without inventing a VAD threshold:
normalized PCM16 whose samples are all exactly zero marks all three readings
unavailable, keeps the provider's completed transcript and model identity in
the receipt, produces `insufficient`, and suppresses TTS. Nonzero quiet speech
and noisy silence are deliberately not classified by this exact gate; they need
the calibrated energy/Silero comparison described in the benchmark plan.

The local receipt IDs and shortened hashes are: ITN-off
`stt-2026-09-18T05-06-02.630Z` / `34154a444293...`; repeated ITN-on
`stt-2026-09-18T05-05-07.590Z` / `557494a33c33...` and
`stt-2026-09-18T05-07-37.114Z` / `4bf424428f4e...`. They live under ignored
`artifacts/`, use a temporary corpus/config, and record `gitDirty=true`; the
repository therefore preserves the summary, not an independently reproducible
evidence bundle. Each correctly remains `not_evaluated` because the corpus is
synthetic, release thresholds are unlocked, capture/VAD/UI are outside the
timing boundary, and no Pi/CM5 was measured.

## Current Honest Boundary

Implemented today:

- persistent local SenseVoice batch baseline;
- strict same-corpus batch benchmark contract, a real synthetic host-model run,
  and honest `not_evaluated` qualification;
- exact digital-silence evidence gating plus empty-semantic content abstention,
  while general no-speech/VAD calibration remains open;
- strict shared ordered-PCM message/reducer contract plus a browser
  `AudioWorklet` -> bounded WebSocket -> server-spool -> canonical receipt path;
  gap, loss, overflow, profile, coverage, and source hash are validated;
- a default-off provider-neutral streaming scheduler is connected to ordered
  PCM with bounded queues/output, stop flush, exactly-one-final arbitration,
  deadline/cancel, stale-attempt suppression, and observer-only partials. Its
  fake conformance harness is engineering evidence only; the configured
  product still performs STT as post-stop batch work;
- explicit Deepgram batch opt-in with no browser consent by default, no redirect,
  pinned non-`latest` version, strict provenance, and no automatic fallback;
- deadlines/cancellation/final-result ownership in the current batch pipeline.

Not implemented or not yet proven:

- ordered PCM capture from Pi/CM5, browser reconnect/resume, restart-recoverable
  audio ownership, physical-microphone/Safari/mobile coverage, or a real
  incremental ASR adapter over the browser stream;
- a local streaming model in the product path;
- Doubao/Volcengine in Jiko;
- real provider latency/quality comparison;
- corpus-backed STT accuracy winner;
- Pi/CM5 latency, power, thermal, microphone, or enclosure evidence;
- human validation of the latency hypotheses or the content/emotion/context
  interpretation.
