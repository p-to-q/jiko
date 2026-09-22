# Benchmark Plan

## Purpose

Jiko needs four different answers. Combining them into one “benchmark score”
would hide the engineering decision:

1. **Recognition quality** — did local STT preserve what was spoken?
2. **Product contract quality** — did the deterministic readings and state
   machine behave as declared?
3. **Runtime performance** — how long and how much compute did the full loop use?
4. **Device reliability** — can the integrated instrument repeat the loop and
   recover from failure?

The checked-in `benchmarks/cases.json` suite answers question 2 and records a
narrow warmed shared-core microbenchmark for regression detection. That timing
does not answer the full-loop part of question 3. Its receipt must continue to
say **structural contract proxy**, not model or device quality.

## Repository Shape

Keep the benchmark in this repository while event, corpus, hardware-profile,
and receipt contracts are changing. Extract a benchmark subrepository only
after two consumers need the same stable suite. Premature extraction would turn
ordinary core changes into cross-repository protocol drift.

Generated runs belong under ignored `artifacts/benchmarks/`. Curated fixture
manifests and synthetic/licensed text may be committed. Raw recordings and real
people’s transcripts may not be committed.

The current measured STT runner is documented in
[`benchmarks/stt/README.md`](../benchmarks/stt/README.md). It executes the three
existing local adapters on one verified corpus and emits transcript-free
receipts. It measures normalized WAV-to-transcript only; capture, VAD/features,
comparable cold-start phases, memory/CPU/thermal/power, orchestration, TTS, and
UI latency remain separate evidence obligations.

## Reproducibility Receipt

Every run must record:

- benchmark schema and suite version;
- source commit and whether the tree was dirty;
- lockfile, fixture-manifest, model, and configuration hashes;
- model/runtime/provider names and versions;
- hardware profile, OS image, architecture, thread count, and power mode;
- DUT serial/hardware revision, fixture and calibration version, ambient
  conditions, and every independently flashed firmware/DSP hash;
- cold or warm run, input duration, and pipeline scope;
- per-case success/error and latency;
- aggregate quality, p50/p95 latency, RTF, peak RSS, CPU, temperature/throttling,
  and energy when available;
- generated artifact paths and hashes.

Never compare two runs that changed corpus, decoding parameters, timing scope,
or hardware without showing the difference in the receipt.

## Evaluation Corpus

Build a local, access-controlled corpus with a committed metadata manifest and
hashes. Use synthetic or properly licensed speech for CI. Use explicitly
consented recordings for internal acoustic evaluation and keep them outside Git.

Required slices:

| Slice | Minimum coverage |
| --- | --- |
| Language | Mandarin, English, Mandarin/English code-switching |
| Delivery | quick start, long pre-speech delay, hesitation, repeated phrase, short/empty speech |
| Capture wake | soft initial phoneme, Mandarin short words, plosive onset, far-field quiet onset, deliberate false wake |
| Level | quiet, normal, loud without clipping, clipped |
| Environment | quiet near-field, room noise, speech-like background, handling noise |
| Speaker/device | multiple voices and at least the laptop mic, candidate USB mic, final mic assembly |
| Failure | missing model, corrupt audio, unsupported media, no speech, device disconnect |

Ground truth should preserve words without identifying the speaker. Report
results per slice; an overall average can hide failure on code-switching or
quiet voices.

## Candidate Matrix

Run identical inputs through these candidates before selecting a default:

| Candidate | Intended role | Why it is in the matrix | Decision risk |
| --- | --- | --- | --- |
| sherpa-onnx SenseVoice int8 | ARM64/device baseline | existing adapter, multilingual offline ONNX path, published int8 model | target Pi 5 cold-start and accuracy are unmeasured |
| whisper.cpp quantized tiny/base | portable challenger | CPU-only, quantized, Raspberry Pi support, built-in benchmark tooling | Chinese/code-switch accuracy and latency vary by model |
| FunASR self-hosted | laptop reference | strong Chinese tooling and existing HTTP adapter | published Xeon figures do not transfer to Pi 5 |
| current fixed local clips | product TTS baseline | bounded phrases, deterministic, near-zero synthesis risk | playback hardware and asset provenance still need proof |
| sherpa-onnx/Piper Chinese TTS | optional dynamic TTS | local ARM64-capable candidates | latency, voice quality, engine/voice licenses and cold-start |

Candidate status means “benchmark,” not “approved.” The default is selected
from Jiko’s measurements, not repository popularity.

## Metrics

### STT quality

- Chinese character error rate (CER).
- English word error rate (WER).
- code-switch token error rate plus language-boundary failures.
- empty/hallucinated transcript rate for silence and noise.
- intent-keyword preservation rate, reported separately from CER/WER.

Do not use an invented confidence value as a quality metric. If a provider does
not expose calibrated confidence, the receipt omits it.

### Runtime

- normalization, VAD/features, model initialization, decoding, readings, and
  total release-to-result latency measured separately;
- p50, p95, and maximum over repeated cold and warmed runs;
- real-time factor (processing seconds / audio seconds);
- peak RSS, CPU time, model bytes, disk bytes, temperature/throttle flags, and
  energy per session where the hardware exposes them.

### Capture, codec, and ownership integrity

- compare per-channel raw PCM, the selected downmix, and codec-decoded audio
  for onset/offset, pitch, energy, pause, clipping, and STT deltas;
- record wake-to-first-valid-frame, initial-phoneme loss rate, false wakes per
  hour, and whole-device current in quiet, capture, transfer, inference, and
  playback states;
- distinguish link connected, consumer subscribed, transport enqueue, host
  receive, host WAL `fsync`, and source-ring advance timestamps;
- inject connected-but-unsubscribed, send failure, half-open socket, host crash
  immediately after send, ring overflow, and replay after restart;
- require `session_id`, `attempt_id`, monotonic source time, sequence, and audio
  profile hash on every replayable segment.

### Product correctness

- protocol parse/reject fixtures;
- deterministic replay of a complete event receipt;
- zero fabricated or unlabeled fallback fields;
- explicit provider/version mismatch and dependency-unavailable states;
- identical manual/device event semantics.

### Reliability

- event loss, duplicate result, stuck-session, and recovery counts;
- xrun/underrun/gap count under concurrent kiosk, STT, TTS, receipt, storage,
  network, and observer load; every fault maps to a turn and resource trace;
- process-kill, browser-kill, model-missing, mic-disconnect, full-storage, and
  power-loss recovery;
- memory/storage growth and latency drift over a scripted session soak;
- boot-to-ready success with network absent.
- explicit rejection of incompatible image, kernel/driver, MCU/DSP firmware,
  topology/channel map, calibration, codec/PCB, app/protocol, and model tuples.

### Hardware HIL and production evidence

Use [labgrid](https://github.com/labgrid-project/labgrid/tree/b3e7b8769d0d02c27c663dc48aa7b288eaba04c3)
to orchestrate the complete Pi/CM DUT, serial/SSH, controllable power and USB,
audio fixtures, and instruments. Use
[pytest-embedded](https://github.com/espressif/pytest-embedded/tree/5177fb45918c7e768562fa67a8d229026636622c)
for pinned ESP-IDF flashing, serial/JTAG, emulation, and multi-DUT tests. They
are harnesses, not product runtime dependencies, and drive the same canonical
input/event path as physical controls.

Create a versioned `hardware_hil_v1` receipt before relying on a board test. It
records the reproducibility fields above plus rail current, sample count versus
monotonic elapsed time, clock drift, first/last phoneme clipping, xrun/gap/
reset counters, queue age, update slot/health state, and typed fault outcome.

Use staged duration gates rather than one ambiguous soak number:

- 8 hours for architecture comparison;
- 24 hours for EVT with the intended enclosure/cooling direction;
- 72 hours or a representative duty-cycle campaign for DVT.

Randomize power loss during download, erase/write, verify, slot switch, first
boot, and health marking. Report rollback-to-ready p50/p95 and reject a session
when OS/app/model/MCU/DSP/channel-map versions are incompatible. Factory runs
also report first-pass yield, retest rate, station cycle time, per-microphone
polarity/level/noise, speaker loopback, physical mute, rail current, and
calibration drift.

## Provisional Gates

These are engineering hypotheses for the alpha, not validated user
requirements. A baseline run must precede any claim that they are met.

| Gate | Alpha target |
| --- | --- |
| Structural suite | 100% expected states; deterministic replay |
| Silent/no-speech set | 0 successful transcripts containing hallucinated speech |
| Event integrity | 0 lost events and 0 duplicate final results in the scripted soak |
| Audio ownership | source advances only after an idempotent host durable-commit acknowledgment; every overflow/drop is counted and visible |
| Recovery | supervised processes return to ready after a forced crash without manual SSH |
| Update recovery | signed inactive-slot install survives injected power loss or rolls back offline; incompatible artifact sets reject readiness |
| Privacy | no raw audio remains after a normal or failed session; production receipts omit transcript content by default |
| Target-device thermal | no reported throttling during the 30-minute stress run or 8-hour session soak |
| Offline behavior | cold boot and normal sessions work with WAN and LAN absent |

Latency and CER/WER release thresholds remain **unlocked** until the first
consented corpus and target-hardware baseline exist. Recording arbitrary numbers
before that run would create a false standard.

## Test Sequence

1. Run `pnpm test` and `pnpm benchmark` on every reading/core change.
2. Freeze fixture-manifest and model hashes.
3. Run `pnpm benchmark:stt:run -- --config <config.json>` on the same laptop for
   each frozen candidate set. The current receipt reports warmed
   WAV-to-transcript latency; record model initialization separately until the
   receipt contract gains an explicit cold-start phase.
4. Run the same suite on the Pi 5/device candidate with kiosk, display, audio
   capture, and cooling active.
5. Select a default only after quality, latency, memory, licensing, install
   size, and failure behavior are reviewed together.
6. Run browser E2E and physical interaction checks around the selected stack.
7. Run recovery matrix, 30-minute stress, then the 8-hour/24-hour/72-hour HIL gates appropriate to the phase.
8. Attach receipts to the readiness ledger and release tag.

The current `stt_benchmark_v1` comparator is an evidence audit, not a selector.
It exposes same-corpus global/per-slice summaries and pairwise deltas, but keeps
the winner null because v1 does not bind a threshold policy, target resource
measurements, normalized cold-start lifecycle, or grouped paired uncertainty.
The v1 receipt now binds every case result to its verified audio SHA-256 and
rejects cross-candidate input tuples that differ in language, reference,
duration, reference units, boundary units, or keyword totals. The detached
comparison output carries the canonical receipt and execution-identity hashes.
Run `pnpm benchmark:stt:compare -- <receipt.json>` to inspect those blockers;
do not turn the smallest aggregate error rate into the default model by hand.

A 10,000-turn run with zero observed failures is an engineering discovery gate,
not a production reliability claim. Under a simple independent-trial model,
zero failures in 10,000 trials only places an approximate 95% upper bound of
three failures per 10,000 (the rule of three); correlated faults, ageing, and
environmental variation make the real bound weaker.

## Primary Sources

- sherpa-onnx SenseVoice models and int8 export:
  https://k2-fsa.github.io/sherpa/onnx/sense-voice/index.html
- whisper.cpp platform, quantization, and benchmark tooling:
  https://github.com/ggml-org/whisper.cpp
- FunASR ONNX CER/RTF benchmark and reproducibility guidance:
  https://github.com/modelscope/FunASR/blob/main/runtime/docs/benchmark_onnx.md
- Silero VAD bounded sequence validation and timing-scope example:
  https://github.com/snakers4/silero-vad/tree/master/examples/onnx_sequence
- Piper engine and per-voice license warning:
  https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/VOICES.md
- sherpa-onnx Chinese TTS target examples:
  https://k2-fsa.github.io/sherpa/onnx/tts/pretrained_models/vits.html
- labgrid whole-device HIL orchestration:
  https://labgrid.readthedocs.io/en/stable/
- Espressif pytest-embedded:
  https://docs.espressif.com/projects/pytest-embedded/en/latest/
- RAUC signed A/B integration candidate:
  https://github.com/rauc/rauc/blob/1a412fe80badb9cf91f5374ea2ef791de4db55a9/docs/integration.rst
