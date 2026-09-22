# Algorithm Evaluation And Scheduling

Status: **evaluation contract; baseline implementation is partial**

Last reviewed: **2026-09-18**

## Design Intent From The Pitch

The pitch names three different lights without fixing their final scientific or
product interpretation:

- `content` — what was said;
- `emotion` — the original product label for how it was said;
- `context` — the original product label for the surrounding situation.

The current runtime implements only narrower **delivery** and **timing /
interaction** proxies. This is an engineering boundary, not a final rename of
the product idea. The current signal cannot establish a person's emotion,
honesty, personality, or intent, and `context` must not become an unconstrained
LLM opinion.

The pitch also says three aligned signals are not permission, one divergent
signal is still a signal, unsettled input should not be believed for that round,
and familiarity is not an answer. Therefore Jiko is an instrument that exposes
bounded evidence and may refuse to settle. It is not a decision authority.

## Three Algorithm Lines

### 1. Content line

This line contains two separately benchmarked components:

1. **STT:** audio to transcript;
2. **content reading:** transcript to `maintain`, `deviate`, or `static`.

The current keyword baseline is intentionally transparent but semantically
shallow. It remains the control until a learned classifier beats it on a frozen,
consented corpus. A larger generative model is not accepted merely because its
outputs appear fluent.

STT candidate order:

| Candidate | Role | Why evaluate | Main risk |
| --- | --- | --- | --- |
| sherpa-onnx SenseVoice int8 | integrated batch baseline | offline, quantized path; a pinned real model now has synthetic host receipts and the adapter keeps one loaded recognizer | 10/10 digital-silence cases emitted text; real-speech, RSS, cancellation reload cost, and Pi/CM5 proof remain missing |
| sherpa-onnx bilingual streaming Zipformer | first local streaming challenger | real streaming/endpoint contract and a shared sherpa deployment path | default endpoint parameters are not Jiko parameters; boundary loss, quality, memory, and target p95 require a same-corpus sweep |
| Moonshine Mandarin Tiny Streaming | P1 compact streaming challenger | current official 34M Mandarin streaming release is MIT and small enough to measure seriously | published panel is not Jiko evidence; runtime integration, mixed-language quality, and target footprint remain unknown |
| whisper.cpp tiny/base quantized | portable challenger | mature CPU path, ARM support, clear model-size trade-off | Mandarin/code-switch quality and warm p95 must be measured |
| self-hosted FunASR | laptop/reference challenger | strong Chinese ecosystem and explicit ONNX/server routes | service reproducibility and target-device cost |

The source-pinned accuracy/runtime analysis is maintained in
[ASR Accuracy Stack And Model Selection](research-asr-accuracy-stack.md), with
the wider compute decision in
[Edge Speech, Compute, And Hardware Co-Design](research-edge-speech-optimization.md).
Qwen3-ASR and FireRedASR2 remain teacher/reference systems, not assumed CM5
runtimes. Deepgram is the only implemented remote boundary, but no live paid
provider is currently release-approved. Deepgram, Doubao/Volcengine, or another
hosted API may become an explicit challenger only through the written
[Remote Audio Policy](remote-audio-policy.md) gate; none may be a silent local
fallback.

STT quality metrics: CER for Chinese, WER for English, mixed-token error rate for
code-switching, deletion/insertion rate, hallucinated text on silence/noise, and
keyword preservation. Provider confidence is recorded only when emitted by the
provider and is never manufactured. It remains `telemetry_only` and cannot
change a content reading until that exact provider/model/version has a frozen
Jiko calibration receipt; provider scores are not assumed comparable.

### First real SenseVoice host spike

On 2026-09-18 the benchmark runner loaded `sherpa-onnx@1.13.8` with
sherpa-onnx's 2025-09-09 int8 conversion of the ASLP-lab WSYue SenseVoice
fine-tune (model SHA-256 prefix `12ca1a2ae7ec`) and ran five locally generated,
non-human fixtures ten times each on the ARM64 development Mac. The conversion
package points to mutable Hugging Face `main`; the source repository's current
model card says Apache-2.0 at revision `4a74a91430485d7456cb786f1d0ff0aba1185ded`,
but the downloaded conversion contains no license snapshot, so artifact-license
provenance remains unresolved. This is real model execution, but only local
synthetic discovery evidence; all receipts retain
`qualification.verdict = not_evaluated`.

| Configuration | Quality observed on this tiny synthetic set | WAV-to-text latency |
| --- | --- | --- |
| 4 CPU threads, ITN off | Chinese CER `0/300`; English WER `0/100`; code-switch error `0/110`; keyword hits `120/120`; silence hallucinations `10/10` | p50 `72.466 ms`; p95 `134.634 ms`; max `148.943 ms` |
| 2 CPU threads, ITN on | English WER `10/100`; silence hallucinations `10/10`; other reported quality counts matched this set | p50 `91.216 ms`; p95 `126.421 ms`; max `148.526 ms` |
| 4 CPU threads, ITN on, first run | English WER `10/100`; silence hallucinations `10/10` | p50 `104.949 ms`; p95 `248.704 ms`; max `525.523 ms` |
| 4 CPU threads, ITN on, immediate repeat | same reported quality counts | p50 `59.928 ms`; p95 `71.443 ms`; max `90.187 ms` |

The ITN-on English fixture lost a leading pronoun while the ITN-off run
preserved it, so faithful transcription now defaults to ITN off. Both settings
transcribed digital silence as a short filler. The pipeline now treats exact
all-zero PCM as unavailable evidence while preserving the completed STT receipt
and faithful output; a calibrated general no-speech gate for quiet/noisy audio
is still mandatory before broader release. The large
latency swing between otherwise identical four-thread runs also means this
spike cannot select a thread count; decision runs need randomized order,
controlled host load, more repetitions, real speech/noise, RSS/CPU/thermal
capture, and the target device.

Local receipt IDs and SHA-256 values are recorded here because `artifacts/` is
intentionally ignored: ITN-off four-thread
`stt-2026-09-18T05-06-02.630Z` / `34154a444293...`; ITN-on two-thread
`stt-2026-09-18T05-05-39.838Z` / `142675b2c591...`; repeated ITN-on
four-thread `stt-2026-09-18T05-05-07.590Z` / `557494a33c33...` and
`stt-2026-09-18T05-07-37.114Z` / `4bf424428f4e...`. They were produced from a
dirty checkout and a temporary manifest/config, so the observed metrics and
ITN deletion are not independently reproducible from the repository. Freezing
the corpus generator, provenance, config, and a redacted durable receipt is a
P0 evidence task.

Content-reading metrics: macro F1 and per-class precision/recall, abstention
rate, calibration error when confidence exists, and stability under transcript
perturbation. Every result is sliced by language, utterance length, negation,
ambivalence, and STT corruption.

The current rule engine now treats locally negated cues symmetrically: negated
movement such as “不想辞职” contributes to maintain, while negated familiarity
such as “not stay” contributes to deviate. This is still a bounded first-pass
scope rule, not full semantic parsing; nested clauses and contrastive discourse
belong in the frozen adversarial corpus.

The v4 structural control also requires English word boundaries, inspects every
occurrence of a repeated cue instead of only the first, and abstains to `static`
whenever affirmed maintain and deviate evidence coexist, even if one side has
more keyword aliases. This prevents `exchange`/`forgo` substring false positives
and avoids turning lexical redundancy into confidence. Generic Chinese nouns
such as “问题” are not action cues; the baseline keeps only more explicit forms
such as “想问” and “问清楚”. These safeguards are conservative failure shaping,
not proof of semantic understanding.

Jiko currently keeps an adapter-extracted transcript and a separate semantic
view. The semantic view may remove bounded fillers, provider control tokens,
and whitespace noise, with transform names in the receipt. Exact untouched
provider text plus a machine-readable transform diff is still P0 work because
some adapters trim or reconstruct text before the protocol boundary. Delivery
and timing continue to use waveform and source-event evidence, not transcript
content. Repetition removal, self-correction,
punctuation rewriting, translation, or generative polishing are not silently
enabled: each needs an equivalence corpus proving that negation, modality, and
ambivalence survive.

### 2. Delivery line

The product baseline is deterministic DSP: VAD/speech duration, silence and
pauses, RMS dynamics, clipping/noise, and pitch variation. Output copy describes
observable delivery only.

Candidate order:

1. current transparent 16 kHz feature path as the control;
2. Silero VAD for calibrated speech-boundary comparison;
3. a small quantized ONNX delivery classifier only after a consented labeled
   corpus and slice audit exist;
4. ESP-SR AFE as a hardware-front-end experiment, not as a replacement for the
   reading contract.

openSMILE/eGeMAPS is useful as a research oracle, but the open distribution's
research-only/non-commercial terms make it unsuitable as an assumed product
dependency. Any use needs a separate licensing decision.

Metrics: onset/offset error against annotated VAD, voiced-frame coverage,
clipping/noise detection precision and recall, feature repeatability across gain
and microphone distance, runtime, and peak memory. No “emotion accuracy” is
reported without a valid task definition and consented labels.

### 3. Timing line

The default is handwritten deterministic logic over monotonic timestamps:
button-down, first speech, pauses, last speech, button-up, continuation, and
total duration. A neural model is not the default because the signal is small,
structured, inspectable, and device-specific.

Network arrival time is never substituted for user timing. Each shell measures
locally and transmits offsets in the shared event/receipt protocol.

Metrics: event loss/duplication, timestamp ordering, VAD-boundary error,
cross-device drift, bounce/long-hold behavior, reset/cancel correctness, and
decision stability under declared timing tolerances.

## Implementation Dossier

### Borrow, enhance, own

The ecosystem leverage is architectural, not just a model download:

| Layer | Borrow | Enhance for Jiko | Keep product-owned |
| --- | --- | --- | --- |
| local dictation loop | Handy/Wisper/Murmur patterns for push-to-talk, local VAD/STT, model download, and offline shell behavior | use the same loop inside a bounded instrument rather than injecting text into arbitrary apps | ritual state machine, four-window UI, silence and reset behavior |
| ASR runtime | sherpa-onnx, whisper.cpp, FunASR and their model ecosystems | warm worker, candidate routing, hotword/personal dictionary experiment, dual faithful/semantic transcript, receipt and deadline | provider-neutral transcript contract, privacy and fallback |
| “Typeless” product layer | filler cleanup, corrections, context and personalization patterns from Typeless/Wispr Flow | retain the faithful transcript and create a separately receipted semantic view; later add local opt-in dictionary/correction memory | which transformations are allowed for a decision instrument and what evidence may never be erased |
| acoustic front end | Silero VAD, ESP-SR AFE, ONNX Runtime | calibrate on final microphone/enclosure and expose boundaries/features to both timing and delivery; keep TEN VAD research-only pending license review | observable feature definitions and unusable-input policy |
| compact classifiers | fastText, multilingual-e5-small, ONNX Runtime quantization | train/calibrate only on the Jiko task; distill or quantize only after equivalence measurement | label ontology, slice gates, abstention, explanation and selection |
| hardware/runtime | Raspberry Pi/CM5 ecosystem, Linux supervision, optional ESP32 AFE/control | custom carrier, device image, thermal/power profiles, bounded observer protocol | recovery contract, update/rollback, physical interaction and release evidence |

Typeless and Wispr Flow illustrate the correct leverage point: raw STT is a
primitive, while correction, filler handling, context, formatting, dictionaries,
and interaction make it a product. Jiko uses the same principle but a different
objective. A dictation tool can optimize for polished final prose; Jiko must
also preserve hesitation, repetition, negation, and timing as evidence. That is
why enhancement produces a second view instead of rewriting the only transcript.

Open-source dictation apps are useful engineering references rather than direct
dependencies. Handy demonstrates a local push-to-talk + Silero + selectable ASR
shape; Wisper shows Rust/Tauri capture, whisper.cpp, dictionary replacement and
local injection; Murmur shows the explicit `capture -> local Whisper -> polish`
split. Jiko should reuse proven deployment and audio patterns while retaining
its TypeScript protocol/core and device observer architecture.

| Surface | Baseline framework/runtime | Open challenger | What Jiko must own |
| --- | --- | --- | --- |
| capture/normalization | browser AudioWorklet ordered PCM now, explicit MediaRecorder batch control; ALSA/PipeWire planned on device; ffmpeg to mono PCM16 16 kHz | libav/libswresample or direct fixed-format capture if process/copy cost is measured hot | device selection, restart-safe ring ownership, clipping/dropout receipts, one canonical audio buffer |
| VAD | current deterministic frame energy and pause extraction | Silero VAD through sherpa-onnx | per-mic threshold/min-speech/min-silence calibration, boundary fixtures, unusable-audio policy; TEN VAD stays out of production while its additional competitive-use restriction conflicts with the deployment path |
| STT | provider boundary with persistent sherpa SenseVoice, one-shot whisper.cpp, and self-hosted FunASR adapters | SenseVoice int8 integrated batch baseline/device candidate; whisper.cpp tiny/base quantized challenger; FunASR laptop reference | real artifact/session receipts, Chinese/English/code-switch corpus, target measurements and provider selection |
| content reading | TypeScript lexicon, local negation scope, margin and abstention | fastText supervised/quantized classifier first; multilingual-e5-small plus a tiny calibrated head only if data supports it | label definition, annotation protocol, negation/modality cases, calibration, explainable evidence and abstention |
| delivery features | TypeScript RMS/pause/clipping/pitch path | Silero VAD boundaries; small ONNX classifier only after consented labels | gain/noise normalization, mic calibration, DSP equivalence fixtures, language that never claims mental state |
| timing | shared event protocol plus local monotonic source time and VAD offsets | no learned model by default | button/capture/speech offset contract, bounce/cancel/late-event handling, per-device tolerance |
| result composition | `@jiko/core` deterministic coverage policy | none until the three independent lines are proved | missing-line semantics, stable copy, no directional TTS for partial/insufficient evidence |
| inference runtime | persistent single-flight sherpa-onnx Python worker; one-shot whisper.cpp CLI; external FunASR service | native/C++ sherpa worker only if target measurements justify it; ONNX Runtime for small challengers | external supervision, target queue policy, per-session artifact receipt, rollout and rollback |

fastText is attractive as the first learned content challenger because it is a
small supervised classifier with n-gram features and a documented quantization
path, not because it is inherently more correct. `multilingual-e5-small`
supports many languages and has an MIT model card, but at roughly 118M
parameters it is a research challenger rather than the assumed device default.
Any ONNX export is tested both before and after quantization; ONNX Runtime notes
that quantization can regress accuracy or even performance depending on model
and hardware.

The current integration baseline creates a possible reuse path: one persistent
sherpa-onnx runtime could host a selected ASR candidate plus Silero VAD. It
becomes a preferred device stack only if both components independently pass the
same-corpus and target-device gates. The reuse would share model loading, thread
configuration, and deployment machinery without making the reading engine
adopt sherpa-specific types; the worker would still return the existing
transcript and speech-region contracts.

### System One / Jev: borrow the interface, not the dependency

System One contributes a useful content-classifier shape: give the model a
closed answer domain, require the full probability vector, keep composition in
code, and record the exact question, option order, model, and version. Those
ideas fit Jiko's bounded `maintain` / `deviate` / `static` content line and make
abstention and calibration measurable.

The first implementation spike remains local: compare the lexicon control with
fastText, then SetFit only if the frozen corpus justifies its larger runtime.
Jev-like and OpenJev-style projects are research references for dynamic-option
heads and probability plumbing, not presumed production dependencies.

Hosted Jev is not a fourth signal and is not a live fallback. It accepts text,
so it shares evidence with the content line and cannot replace delivery DSP or
monotonic timing. Public material does not provide weights, an edge runtime, or
Pi/CM5 measurements, and the service cannot pass the current offline gate. If
the team later authorizes an internal comparison, it runs only at P5 on
synthetic or properly licensed text, after written legal/privacy/benchmark
approval, with a pinned version and no effect on product state or local model
selection. Jev output is not used as a label, oracle, distillation target, or
prompt-tuning source.

The full claim audit, terms constraints, adapter mapping, and staged experiment
plan live in [System One Models / Jev Research](research-system-one-jev.md).

### Work we should not outsource to a model

- the observable definition of each line and the abstention boundary;
- corpus consent, slice design, and annotation disagreements;
- capture timing, event ordering, cancellation, deadlines, and fallback;
- microphone gain/noise calibration and target-enclosure acoustic tests;
- result coverage, stable copy, privacy, receipts, update, and recovery;
- the final per-device selection after quality, latency, memory, power, thermal,
  license, and installation evidence are considered together.

## Scheduler

```text
P0  input acknowledge / stop / reset / cancel
P1  capture ring, VAD, level, clipping guard
P2  normalize -> [features || selected warm STT]
P3  three readings -> coverage policy -> result
P4  playback, receipt persistence, observer update
P5  benchmark harness, cache maintenance, model download/update
```

Rules:

- P0 and P1 cannot wait behind model inference or observer work.
- Normalized mono 16 kHz audio is produced once and shared.
- Feature extraction and STT run concurrently after normalization.
- Each stage emits status, provider, and monotonic elapsed time.
- The session deadline belongs to the scheduler, not to a provider.
- Cancellation/reset wins over late model output.
- A warm alternate may run only inside the remaining deadline.
- Observer/benchmark harness work yields to live sessions.
- TTS failure cannot rewrite the visual result.

The current implementation records successful, unavailable, timed-out, and
failed pipeline stages. A monotonic attempt deadline starts at the first stop
(or direct-upload acceptance), gives STT an earlier soft cutoff, and seals late
or cancellation-ignorant completion. Reset/error cancellation reaches local
processes and the persistent SenseVoice worker; that worker declares readiness
only after model load and artifact hashing, uses bounded admission, and restarts
after an aborted active request. Fake workers prove those contracts, not real
recognition or target performance. Slow request bodies are only logically
sealed, synchronous DSP can still block timely feedback, external service
supervision is absent, and only the SenseVoice path currently supplies strict
per-session runtime/config/model/token identity; whisper.cpp and FunASR do not
yet prove equivalent artifact provenance. The 15-second adapter ceiling and
4-second attempt default are prototype safety/fallback policies; target budgets
still require measured p95 data.

## Fallback Matrix

| Failure | Required behavior | Forbidden behavior |
| --- | --- | --- |
| STT unavailable/timeout | mark content unavailable; compose from remaining measured lines under coverage policy | turn empty transcript into a normal `static` content vote |
| exact all-zero PCM attempt but ASR emitted text | preserve the adapter transcript/provider receipt only as diagnostics; mark content, delivery, and timing unavailable because no spoken attempt entered the evidence path; emit insufficient/no TTS | let a filler become content or turn zero speech duration into three `static` votes |
| nonzero audio yields an empty semantic transcript | mark content unavailable; preserve independently measured delivery/timing and compose under coverage policy | convert empty content into a measured `static` vote |
| acoustic input unusable | mark delivery unavailable; preserve content/timing if measured | infer emotion from text |
| local timing incomplete | mark timing unavailable and retain raw event-order diagnostic | use server/network arrival latency as user context |
| one provider crashes | capture failed stage; supervise/restart out of band; offer retry/partial result | hang processing indefinitely |
| TTS fails | keep visible result and record playback failure | invalidate or silently change the result |
| manual transcript used | mark simulated voice/timing and exclude from quality benchmark | present it as a real audio run |

Two agreeing measured lines with one missing produce a visible partial result,
not “three-line consensus.” Two disagreeing lines or fewer than two available
lines produce insufficient evidence and no directional TTS.

## Cache And Operator Policy

- Keep selected model sessions, tokenizer/lexicon data, and fixed TTS assets warm
  under a supervised process.
- Key model caches by artifact hash, runtime version, thread count, execution
  provider, quantization, and feature-schema version.
- Never cache raw user audio or transcript content as an optimization.
- Bound queues and caches; record eviction and out-of-memory behavior.
- Benchmark cold load separately from warm inference.
- Tune thread count with UI and thermal load active. Maximum thread count is not
  automatically the fastest sustained configuration.
- Hand-optimize only measured hot paths with equivalence fixtures.

The first proven DSP optimization is pitch extraction: analyzing an 8 kHz
decimated view and selecting the earliest strong autocorrelation peak corrected
a 220 Hz fixture from a 73.4 Hz subharmonic to 220.0 Hz and reduced a 10-second
development-Mac run from roughly 40–43 ms to 17–21 ms. This is not target-device
evidence; it demonstrates the required measure/equivalence/optimize workflow.

## Selection Gates

A default changes only when the challenger has a reproducible receipt and:

1. beats or deliberately trades against the control on the same frozen corpus;
2. meets warmed p95 and memory gates on the target hardware with the kiosk on;
3. passes silence/noise/corrupt/short/long and provider-failure fixtures;
4. has redistributable model/runtime/voice licenses recorded;
5. can install and boot offline from a versioned artifact manifest;
6. survives repeated sessions and process restart without unbounded growth;
7. preserves the same protocol so laptop and hardware shells do not fork.

No single weighted “best model” score is used. Quality gates are mandatory;
among passing candidates, choose the smallest sustained latency/memory/power
profile with the simplest recoverable runtime.

## Required Harness Work

1. Freeze a consented, synthetic-safe manifest with hashes and slice labels.
2. Add provider adapters that run identical audio without changing fixtures.
3. Add cold/warm repetitions and capture p50/p95, RTF, RSS, temperature, and
   throttling.
4. Add output comparators for STT, VAD/features, three readings, coverage, and
   stage receipts.
5. Add failure injection for missing/corrupt models, worker crash, timeout,
   cancellation, full queue, observer disconnect, and no network.
6. Run first on the laptop, then unchanged on Pi 5/CM5. Do not translate laptop
   success into a hardware claim.

## Primary Sources

- Jiko pitch: <https://www.ptoq.io/pitches/jiko_%5Bp%E2%86%92q%5D_hack_pitch.pdf>
- sherpa-onnx SenseVoice models and ARM benchmark notes: <https://github.com/k2-fsa/sherpa/blob/master/docs/source/onnx/sense-voice/pretrained.rst>
- measured conversion release artifact: <https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2>
- measured conversion's ASLP-lab source snapshot: <https://huggingface.co/ASLP-lab/WSYue-ASR/tree/4a74a91430485d7456cb786f1d0ff0aba1185ded/sensevoice_small_yue>
- whisper.cpp: <https://github.com/ggml-org/whisper.cpp>
- FunASR: <https://github.com/modelscope/FunASR>
- Silero VAD: <https://github.com/snakers4/silero-vad>
- openSMILE licensing note: <https://audeering.github.io/opensmile/about.html>
- ESP-SR AFE: <https://docs.espressif.com/projects/esp-sr/en/latest/esp32s3/audio_front_end/README.html>
- fastText supervised classification: <https://fasttext.cc/docs/en/supervised-tutorial.html>
- multilingual-e5-small model card: <https://huggingface.co/intfloat/multilingual-e5-small>
- ONNX Runtime quantization: <https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html>
- sherpa-onnx VAD API: <https://k2-fsa.github.io/sherpa/onnx/c-api/html/vad.html>
- Typeless product behavior: <https://www.typeless.com/>
- Wispr Flow formatting/backtrack: <https://docs.wisprflow.ai/articles/5373093536-how-do-i-use-smart-formatting-and-backtrack>
- Handy local dictation reference: <https://github.com/cjpais/Handy>
- Wisper local whisper.cpp/dictionary reference: <https://github.com/hudsonbrendon/wisper>
- Murmur capture/transcribe/polish reference: <https://github.com/kurenn/murmur>
- TypeSafe System One / Jev research synthesis: [research-system-one-jev.md](research-system-one-jev.md)
