# Instrument Runtime Design

## Product Shape

The target product has one runtime and two views of it:

- **Instrument view** — the 320 × 480 hardware panel. It captures one intent,
  shows only interaction-critical state, and works without the desktop view.
- **Observer view** — the computer panel. It shows connection, provider,
  latency, feature, reading, fallback, and receipt detail for development,
  rehearsal, support, and benchmarking.

The observer may inspect and send protocol commands, but it must not contain a
second reading engine or a second state machine. Disconnecting the observer must
not stop a self-contained instrument session. This is a target contract, not
current Raspberry Pi evidence: the button adapter and the host-tested native
ALSA/JPCM adapter are still separate processes, neither has run on the target,
and the loop still depends on the host server.

The shared core now owns a framework-neutral `InstrumentScene` projection over
the canonical `SessionMachineState`. The Web shell owns SSE transport and the
0/450/900 ms reveal choreography, but it no longer interprets readings through a
second device reducer. Result identity keys the complete reveal lifecycle, so
post-result TTS/silence events cannot cancel it. Invalid terminal transitions are
rejected by the core, and a detected sequence gap triggers one bounded fresh
scoped replay before the UI remains in an explicit sync error.

## Pitch Constraints

The [original Jiko pitch](https://www.ptoq.io/pitches/jiko_%5Bp%E2%86%92q%5D_hack_pitch.pdf)
defines `content`, `emotion`, and `context`, together with a refusal to turn the
instrument into another answer machine. Runtime language narrows the latter two
to observable **delivery** and **timing**: the software must not claim access to
a person's emotion, and context must not become an unconstrained model opinion.

Three aligned signals are not permission. A divergent signal remains visible.
An unsettled round may refuse to conclude. A familiar path is not presented as
the correct answer. These are result-composition invariants, not only copy.

## Three Independent Signal Lines

The three lamps are deliberately different evidence channels. They should not
be three prompts to the same model.

| Line | Input | Current baseline | Next candidate | Must not claim |
| --- | --- | --- | --- | --- |
| Text / content | local STT transcript, language, optional provider confidence | bounded lexicon and transparent thresholds | quantized local multilingual semantic classifier only if it beats the baseline on the frozen corpus | that a language model knows the right decision |
| Voice / delivery | VAD regions, energy dynamics, clipping/noise, pitch variation | deterministic RMS/pause/pitch features | calibrated Silero VAD plus normalized acoustic features; optional small ONNX classifier only with slice evidence | emotion, personality, honesty, or mental state |
| Timing / interaction | button timestamps, first-speech delay, pauses, continuation, duration | deterministic timing rules | event/VAD alignment and per-device calibration; no neural model required by default | intention from latency alone |

### Text line

STT provider selection and text interpretation are separate decisions. The STT
benchmark uses CER/WER and hallucination rate. The text-reading benchmark uses
fixture labels and intent-keyword preservation. A provider’s confidence is used
only if the provider actually emits a documented value; Jiko does not synthesize
one.

Initial candidate order:

1. sherpa-onnx SenseVoice int8 for the common ARM64/device path;
2. quantized whisper.cpp tiny/base as the portable challenger;
3. self-hosted FunASR as the laptop Chinese reference.

The winner can differ by shell, but the transcript contract and benchmark
corpus remain identical.

### Voice line

The line should describe observable delivery, not infer emotion. Before any
learned classifier, normalize features for microphone gain and background
floor, validate VAD against annotated speech boundaries, and report unusable
audio explicitly.

The current autocorrelation pitch path runs at an 8 kHz analysis rate while the
normalized source remains 16 kHz. On the 2026-09-17 ARM64 development Mac, a
10-second synthetic 220 Hz fixture improved from roughly 40–43 ms to 17–21 ms
after decimation and fundamental-peak selection, while the estimate changed
from the incorrect 73.4 Hz subharmonic to 220.0 Hz. This is a development-host
microbenchmark, not Raspberry Pi evidence.

### Timing line

Timing must be derived from monotonic device/session timestamps and VAD
boundaries. Network arrival time is diagnostic data, not user timing. The Pi
button adapter therefore measures hold duration locally and atomically appends
client-generated session creation plus start/stop operations to a bounded
SQLite outbox before background delivery. Exact response-loss retries preserve
the same event identity; restart turns an unmatched press into a typed
`device_input_interrupted` error. This protects button order, not audio. The
experimental `pi_audio_adapter.py` now adds a bounded `arecord` stdout queue,
source-monotonic PCM timestamps, sequence/hash/loss evidence, and the same JPCM
messages as the browser. It is not yet owned by the button turn, has no
first/last-speech offsets or reconnect/replay, and its server `spooled` ACK is
current-process readable rather than restart durable.

## Orchestration Contract

The runtime is a bounded stage graph, not one opaque inference call:

```text
arm -> capture -> normalize -> [VAD/features || STT]
                              -> faithful + semantic transcript views
                              -> three readings
                              -> coverage policy
                              -> result -> local playback -> silence -> reset
```

Each stage returns one of `ready`, `degraded`, `unavailable`, `timed_out`, or
`failed`, with provider/version and latency. The scheduler owns deadlines and
cancellation. Providers do not decide product state.

Rules:

1. Capture has one owner. A new `recording.started` is rejected while recording.
2. Release seals the input. Late chunks cannot mutate a completed session.
3. Normalization runs once and its mono 16 kHz output is shared by STT and
   features.
4. STT and acoustic extraction run in parallel. Text waits for STT; voice and
   timing do not.
5. Every stage must accept an abort/deadline signal. Attempt-scoped reset
   cancellation now reaches ffmpeg, local CLI STT, and self-hosted HTTP STT, and
   late cooperative or noncooperative completion cannot commit after reset. The
   implemented non-extendable release-to-result deadline also aborts a still-open
   direct HTTP body. It does not bound capture before stop, preempt synchronous
   DSP, interrupt a blocked event loop, or replace a distinct body-idle policy.
6. Result composition runs once from an immutable reading snapshot. Retries
   create a new attempt id and cannot append a second final result.
7. TTS/playback failure does not invalidate the visual result.
8. Reset is an absorbing terminal state for the attempt, cancels its registered
   pipeline/output work after the reset commits, and returns clients to the
   shared idle scene. Physical audio-device/model resource release remains a
   target-hardware proof item.

## Coverage And Fallback Policy

`static` is a legitimate reading state; it must not also mean “the algorithm did
not run.” Each reading therefore needs separate evidence availability:

- `measured` — derived from real session input;
- `simulated` — rehearsal/manual fallback;
- `unavailable` — missing provider, unusable input, timeout, or failure.

Availability is now carried through the protocol, result coverage, observer,
and lamp state. Provider-unavailable remains visible in the stage receipt and
does not receive fabricated confidence or a normal `static` vote.

Target composition policy:

| Available real lines | Behavior |
| ---: | --- |
| 3 | normal majority/minority composition |
| 2, agree | partial result, visibly mark the missing lamp; never label it three-line consensus |
| 2, disagree | unsettled/insufficient result; no directional TTS |
| 1 | insufficient evidence; show the one reading only; prompt retry |
| 0 | recoverable error; no result claim |

Manual text fallback is a rehearsal/support mode. The observer panel must say
that voice and timing are simulated; the instrument view should show a compact
fallback indicator in preview/dev builds. It must never be silently mixed into
quality benchmark results.

Fallback order:

1. primary local provider;
2. measured alternate local provider only if it is already warm/ready and the
   remaining session deadline permits it;
3. partial measured result under the coverage policy;
4. explicit retry;
5. manual transcript only after operator/user action.

Automatic fallback to a slower model may be worse than an honest partial result.
The scheduler chooses from measured deadlines, not a fixed provider list.

## UI And UX State Contract

The hardware panel and observer render the same event stream at different
detail levels.

| State | Instrument panel | Observer panel |
| --- | --- | --- |
| booting | bounded boot mark | service/dependency checklist |
| ready | clear record affordance | provider versions, device connection, last validation |
| recording | unmistakable live state and release affordance | duration, input device, level/clipping warning |
| processing | staged motion with a maximum duration | active stage, elapsed/deadline, cancellation/fallback |
| partial/degraded | missing line stays visually unresolved | exact unavailable stage and reason |
| result | three line states plus short top copy | transcript, evidence, confidence, timing, provider receipt |
| error | recoverable action, not a red “verdict” | stable error code, detail, retry/reset controls |
| offline observer | instrument continues | reconnect and replay current session snapshot |

UX requirements:

- all preview/operator targets meet WCAG 2.2 24 × 24 CSS px minimum; primary
  controls aim for 44 × 44;
- keyboard focus is visible and does not trigger product actions by focus alone;
- color is never the only indicator in the observer view;
- browser record start/stop acknowledgment is local-first and is proved with a
  fake microphone while registration is blocked; the Pi button/audio pair does
  not yet meet this requirement because session/WebSocket setup precedes
  native capture and the two adapters do not share one turn owner;
- result copy is stable for a session so reconnect/replay does not change the
  perceived answer;
- SSE reconnect must identify a session/sequence cursor instead of replaying an
  ambiguous “latest session” once multi-device operation exists.

## Performance, Cache, And Operator Plan

### Measurement scopes

Always report these separately:

- cold boot and model load;
- warmed per-session inference;
- end-to-end release-to-result;
- animation/reveal time that is intentionally product pacing;
- playback time.

### Model lifetime and caches

- The SenseVoice adapter now uses one process-wide Python worker: it hashes the
  model/token artifacts, loads the recognizer before declaring readiness, and
  reuses that recognizer across turns. Fake-worker tests prove the lifecycle and
  protocol. A pinned real-model host spike and host diagnostic also exist, but
  their corpus/config/receipts are not yet a durable reproducibility bundle and
  the checked-in supervisor contract has not been installed or proved on target.
- Cache immutable model sessions and tokenizer/lexicon data, not user audio or
  transcripts.
- Key caches by model hash, runtime/provider version, thread count, execution
  provider, and feature-schema version.
- Pre-generated TTS clips are content-addressed release assets. Validate hashes
  at readiness time; do not synthesize them during a session.
- Bound every in-memory session/event list and on-disk receipt directory.

### Operator/runtime optimization order

1. Measure the end-to-end critical path on target hardware.
2. Remove repeated initialization and duplicate decoding/copies.
3. Use quantized models only after quality is compared on the same corpus.
4. Tune thread count with the kiosk and thermal system active; maximum threads
   may increase throttling and p95 latency.
5. Optimize DSP hot loops with decimation/vectorized/native operators where
   output fixtures remain within declared tolerances.
6. Measure the persistent worker on the selected target, then decide whether the
   Python boundary is sufficient or a C++/native worker is justified. Preserve
   cancellation, bounded admission, readiness, and artifact identity either way.

### Boundary cases that must be fixtures

- zero-byte, corrupt, unsupported, very short, very long, clipped, silent, and
  noisy recordings;
- microphone permission denied/disconnected mid-session;
- duplicate press/release, bounce, long hold, reset during inference;
- missing/corrupt model and incompatible model/token files;
- provider timeout, worker crash, full disk, read-only storage;
- SSE disconnect/reconnect and observer opened halfway through a session;
- system clock change (product timings remain monotonic);
- power loss during receipt write and during update;
- no network from boot onward.

## Near-term Implementation Slices

1. Extend the implemented monotonic release-to-result deadline with a capture
   bound, request-body idle aborts, and worker-isolated synchronous DSP; add
   target-process/resource failure-injection fixtures.
2. Turn the existing temporary, ignored pinned-SenseVoice host spike into a
   durable reproducible corpus/config/receipt bundle, then benchmark cold load,
   warm turns, cancellation reload cost, RSS, and target thermals against
   whisper.cpp and self-hosted FunASR. Use the runtime/config and model/token
   identity already captured in the canonical receipt to keep every comparison
   artifact-specific.
3. Extend the existing fake-device local-first browser E2E through result,
   reset, degraded/empty input, physical mic/permission/track loss,
   manual-record contention, and stop/upload response loss.
4. Extend the bounded process-local session/SSE replay with a durable cursor,
   retention-gap snapshot, restart recovery, and multi-process receipt locking.
5. Produce a Pi 5 device profile and run the identical STT/DSP suite with the
   kiosk active.
6. Install and verify the checked-in server, worker, kiosk, and input supervision
   contract on target hardware, then run crash recovery and the first 30-minute
   stress test.
