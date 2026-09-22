# Jiko ASR Accuracy Stack: More Accurate, Lower Latency, and Measurable

Status: research decision record; no runtime selection is approved by this note

Reviewed: 2026-09-18

Scope: local/on-device speech capture, ASR, transcript normalization, confidence,
fallback gating, acceleration, and the benchmark needed to choose a production
path.

This document asks a narrower question than “which ASR model is best?”:

> On the same Jiko audio, can a versioned stack preserve what the participant
> said, finish inside the interaction deadline, expose uncertainty honestly, and
> reproduce the result on the intended hardware?

The answer is not yet a model name. The current SenseVoice worker is the
integrated baseline. A streaming bilingual Zipformer and Moonshine Mandarin
Tiny Streaming are the two highest-value live challengers. Quantized
`whisper.cpp` remains an independent portable control. None becomes the default
until the same frozen corpus, exact artifacts, and target device produce a
receipt.

This note does not modify the shared core or either runtime shell. It refines
the evidence and implementation contract described in
[`benchmark-plan.md`](benchmark-plan.md) and
[`research-edge-speech-optimization.md`](research-edge-speech-optimization.md).

## Evidence Boundary

The research uses primary sources only: upstream source, upstream technical
documentation, model cards, license text, and papers from the model authors.
Blog posts and product claims were useful only for discovering candidates.

The following distinctions are mandatory:

- **Upstream-reported** means the authors measured it on their own corpus and
  hardware. It is not a Jiko result.
- **Integrated** means a path exists in this repository. It does not mean the
  model passed an accuracy, latency, memory, thermal, or license gate.
- **Measured** requires a Jiko receipt containing the corpus, model, runtime,
  configuration, source, and device identities.
- **Streaming architecture** means state is carried across chunks. Splitting an
  offline model into overlapping windows is not equivalent.
- **Model license** and **runtime license** are separate. A permissively
  licensed engine does not make downloaded weights permissive.

The published numbers below are deliberately not ranked across rows when their
datasets, normalizers, streaming modes, or quantization differ.

## Decision Summary

1. Keep one canonical, ordered PCM ingress. The implemented browser slice gives
   every current batch candidate the same samples, gaps, release event, and
   timing scope. Bounded pre-roll is part of the target contract, not current
   browser behavior.
2. Preserve two audio branches: an evidence branch for timing/delivery and an
   optional ASR-enhanced copy. Never overwrite the evidence branch with AEC,
   denoising, or AGC.
3. Keep button release authoritative for push-to-talk. VAD marks speech;
   endpointing decides when an automatic turn may close. They are not the same
   component.
4. Keep the persistent SenseVoice int8 path as the current batch baseline. Do
   not describe its attention truncation forks as native streaming.
5. Make a sherpa-onnx bilingual streaming Zipformer the first streaming
   challenger because it reuses the current runtime family and exposes
   endpoint, token timestamp, and context-biasing mechanisms.
6. Promote Moonshine Mandarin Tiny Streaming to a serious P1 challenger. The
   current upstream model is 34M parameters and MIT-licensed; the older
   Moonshine non-English Community-license assumption is stale. Its reported
   16.1% no-space CER is only an upstream, quantized, 400-clip
   FLEURS/WenetSpeech panel and is not Jiko evidence.
7. Keep quantized `whisper.cpp` tiny/base as an independent portable control
   and recovery path, not the presumed Chinese live winner.
8. Allow proper-noun context biasing, but prohibit decision-bearing hotwords
   such as `辞职`, `留下`, `quit`, and `stay`.
9. Preserve provider-faithful and semantic-normalized transcripts together.
   Punctuation, ITN, filler removal, and correction must be separately
   versioned transforms.
10. Treat raw decoder confidence as telemetry. Fallback is enabled only after
    provider/artifact-specific calibration on a speaker-disjoint set and an
    explicit risk/coverage gate.
11. Start Pi/CM5 with ONNX Runtime CPU EP and a measured thread sweep. Try
    XNNPACK only after graph-coverage profiling. NNAPI and Core ML belong at
    Android/Apple adapters, not in the shared core.
12. Do not hand-write an operator until a target-device profile finds a stable
    hotspot and a differential test proves both numerical fidelity and an
    end-to-end win.

## The Accuracy Stack

This is the target contract. The current browser path has ordered PCM and
post-stop batch inference. A default-off provider-neutral streaming lifecycle
and fake conformance harness are wired at the server ingress, but there is no
real streaming provider, pre-roll, VAD boundary, or restart-recoverable host
commit yet.

```text
mic / playback reference / button clock
  -> ordered PCM + gap/drop receipts + bounded pre-roll (target)
  -> evidence branch ---------------------------> voice/timing lines
  -> optional AEC -> optional NS -> bounded AGC -> ASR branch
  -> VAD labels + endpoint state
  -> streaming partial / stable prefix / final
  -> provider-faithful transcript
  -> versioned semantic transforms
  -> calibrated risk + deadline + policy gate
  -> local fallback or explicit unavailable state
```

Accuracy is an end-to-end property. A lower model CER cannot compensate for a
lost first phoneme, a false endpoint, a hotword-induced insertion, an ITN error
on a number, or a fallback that silently uploads audio.

### One ingress, two consumers

The canonical stream must carry at least:

- `session_id`, `attempt_id`, source-monotonic timestamp, sequence number, and
  audio-profile hash;
- sample rate, channel map, sample format, and measured/declared clock domain;
- discontinuity, overflow, clipping, and transport-gap counters;
- button down/up and first valid frame today; first/last VAD speech plus
  `host_wal_durable` when those target layers exist;
- a bounded target pre-roll so wake/VAD latency cannot erase the initial
  phoneme; the current browser slice does not implement it.

Each model adapter may resample or compute features, but it may not redefine
capture ownership or session timing. Offline and streaming models are evaluated
from the same ordered PCM replay.

## Model and Runtime Decisions

| Candidate | Current role | Primary evidence | Decision | License and unresolved gate |
| --- | --- | --- | --- | --- |
| SenseVoiceSmall-family int8 through sherpa-onnx | integrated, non-streaming baseline | NAR inference and ONNX paths exist; the locally measured artifact is sherpa-onnx's conversion of the ASLP-lab WSYue fine-tune, not the official base checkpoint | **Adopt integration baseline; adapt** persistent worker and exact artifact pinning; **reject** pseudo-streaming as a production claim | official SenseVoice source is MIT and official weights use separate FunASR terms; the measured WSYue conversion/distribution license remains unresolved because its package lacks a pinned license snapshot |
| sherpa-onnx bilingual streaming Zipformer/transducer | first live challenger | native stateful online recognizer, endpoint rules, timestamps, modified-beam context graph, ARM-oriented C++/ONNX runtime | **Adopt challenger; adapt** endpoints and hotword score from Jiko calibration | Apache-2.0 runtime; exact checkpoint/model-card license and hash still required |
| Moonshine Mandarin Tiny Streaming | second live challenger | current upstream ships a 34M streaming Mandarin model, cached C++/ORT state, chunked evaluation, domain-context tests, and memory tests | **Adapt** behind the same ingress; compare same-corpus streaming accuracy and Pi/CM5 resources | current streaming model and code are MIT; reported 16.1% no-space CER is an upstream 400-clip quantized panel, not a release gate |
| `whisper.cpp` tiny/base quantized | portable control and local fallback | C/C++, ARM NEON, quantization, Raspberry Pi support, fixed model hashes, grammar/prompt and VAD knobs | **Adopt control; adapt** pinned model and hallucination/silence tests; do not assume it wins live Mandarin | MIT code; verify each converted model artifact and upstream hash |
| FunASR service pipeline | laptop reference and component source | explicit ASR/VAD/punctuation/hotword composition, Chinese tooling, ITN package, CPU/GGUF work | **Adapt** as reference/teacher; **reject** as assumed CM5 default until measured | toolkit MIT; model weights separately licensed, commonly FunASR Model Open Source License v1.1 |
| offline/large teachers | error mining and accuracy ceiling only | larger current Chinese/code-switch systems can discover hard slices and propose hypotheses | **Adapt in lab**; **reject** teacher output as ground truth or hidden production ensemble | pin the exact repository, weights, license, serving stack, and hardware before adding any candidate |

### SenseVoice: retain the baseline, stop overstating it

The current upstream SenseVoice README explicitly describes the released
SenseVoiceSmall as a non-autoregressive offline model. It also says a referenced
pseudo-streaming implementation truncates attention and sacrifices accuracy.
Therefore:

- keep the persistent int8 worker for the current end-to-end baseline;
- measure initialization separately from warm decode;
- record exact converted artifact hash and its model-card terms;
- do not report chunked offline inference as equivalent to native streaming;
- do not use SenseVoice emotion/audio-event tags as Jiko evidence of a person's
  inner emotional state.

The 2026-09-18 measured local package is not the official base checkpoint. It is
sherpa-onnx's 2025-09-09 int8 conversion of ASLP-lab's WSYue SenseVoice
fine-tune. Its package README points to mutable Hugging Face `main`; the current
source snapshot is `4a74a91430485d7456cb786f1d0ff0aba1185ded` and its model
card declares Apache-2.0, but the downloaded conversion contains no license
snapshot. Keep the measured model/token hashes as byte identity while treating
conversion/distribution license provenance as unresolved.

SenseVoice/FunASR code licenses are permissive, but the official weights are
not simply “MIT because the GitHub repository is MIT.” That distinction is a
P0 receipt field.

### Zipformer through sherpa-onnx: first streaming challenger

The upstream `EndpointConfig` currently defaults to:

- 2.4 seconds of silence when no non-blank token was decoded;
- 1.2 seconds of trailing silence after non-silence;
- a 20-second maximum utterance.

Those are library defaults, not Jiko UX targets. They would visibly dominate a
short instrument turn if copied unmodified. The benchmark must sweep endpoint
thresholds and report truncation versus endpoint lag by slice.

Upstream hotwords are available only with modified beam search in the relevant
online path, with a default score of 1.5. The implementation applies context
score during hypothesis expansion. Jiko should reuse the mechanism, not the
default score: list size, phrase length, and boost must be frozen and swept.

### Moonshine: license question resolved, product question still open

The current `moonshine-ai/moonshine` repository supersedes the older
`moonshine-v2` repository for this decision. At reviewed commit
`234f60faa0eb388b01cdf7e60aca232af37aefda`:

- all streaming STT models, including Mandarin Tiny Streaming, are MIT;
- Mandarin Tiny Streaming is listed at 34M parameters;
- its disclosed 16.1% score is no-space CER on a seeded 400-clip macro from
  FLEURS and WenetSpeech using the shipped quantized model;
- the official evaluation can select a true chunked
  `moonshine_c_streaming` backend;
- the official docs disable VAD for already-segmented clips because segmentation
  adds boundary error;
- the model catalog asks non-Latin integrations to raise its
  `max_tokens_per_second` repetition guard to 13 because token density differs;
  that upstream heuristic must be pinned and swept, not hidden as a default;
- the C++ runtime keeps frontend, encoder, cross-attention, and self-attention
  state rather than re-running the whole utterance;
- upstream includes a 120-second streaming memory regression test and explicit
  retained-VAD-byte checks.

This is enough to justify a spike, not enough to select it. Jiko still needs
code-switch quality, first/last-token behavior, partial stability, release-to-
final p95, RSS, heat, and sustained performance on the intended hardware.

The Moonshine quantization note is also a valuable implementation lesson. The
authors report that per-channel weight scales improved Tiny Streaming on their
LibriSpeech setup from 7.57% to 4.83% WER for roughly 0.5% more model size, with
most of the gain in the learned frontend. This is upstream evidence that
quantization layout matters; it is not evidence that the same delta applies to
Mandarin or Jiko. Preserve float/per-channel artifacts long enough to run a
paired Jiko comparison.

Moonshine also has a useful weak-hardware scheduler: its nominal transcription
interval is a lower bound, and the next decode covers at least the previous
inference duration, capped at ten intervals; stop/force-update still flushes the
tail. Jiko should adapt that separation between capture cadence and decode
cadence, but bound coalescing by attempt deadline, oldest undecoded audio, and
thermal state. Receipts need `capture_head_ms`, `decode_coverage_end_ms`,
`partial_age_ms`, target interval, coalesce factor, queue wait, engine time,
forced-final-flush, and partial-revision count. Slower partials are acceptable;
an invisible growing lag debt is not. Sources: Moonshine's
[transcription cadence](https://github.com/moonshine-ai/moonshine/blob/234f60faa0eb388b01cdf7e60aca232af37aefda/docs/using/transcription.md#L100-L103)
and [final cache flush](https://github.com/moonshine-ai/moonshine/blob/234f60faa0eb388b01cdf7e60aca232af37aefda/docs/api/c-api.md#L633-L650).

Its model downloader is a second reusable mechanism: free-space preflight,
`.part` files, Range resume, and atomic completion. Quantized releases go to a
new version directory and split frontend graph from weights to avoid an ORT
optimization expanding stored int8 constants back toward FP32 size. Jiko should
install a whole signed/hash-pinned bundle transactionally and atomically switch
only after manifest, ABI, tokenizer/config, every file hash, free space, and a
known-good rollback are valid. It must not auto-download during first use or
capture. Sources: [model download transaction](https://github.com/moonshine-ai/moonshine/blob/234f60faa0eb388b01cdf7e60aca232af37aefda/docs/using/downloading-models.md#L10-L16)
and [versioned quantized layout](https://github.com/moonshine-ai/moonshine/blob/234f60faa0eb388b01cdf7e60aca232af37aefda/docs/models/quantization.md#L1-L15).

### FunASR two-pass: local partial/final challenger

FunASR's 2-pass protocol is worth a measured challenger beside Zipformer and
Moonshine: Paraformer online can supply replaceable partials and the offline
Paraformer/SenseVoice pass can supply the immutable final over the same ordered
PCM and attempt. Its documented `[5,10,5]` tuple means a 600 ms current chunk
with 300 ms look-back and 300 ms look-ahead. This may feel responsive on a
laptop, but two resident models plus VAD/punctuation may fail Pi/CM5 RSS,
thermal, and release-latency gates. Sources: [2-pass wire semantics](https://github.com/modelscope/FunASR/blob/904cd18681b8083de5e1039bd0ecebc4f49ede60/runtime/docs/websocket_protocol.md#L63-L92)
and [SenseVoice as offline pass](https://github.com/modelscope/FunASR/blob/904cd18681b8083de5e1039bd0ecebc4f49ede60/runtime/docs/SDK_advanced_guide_online.md#L7-L18).

Do not reuse its outer WebSocket as the product protocol: it lacks Jiko's
current attempt identity, sequence, process-spool acknowledgement, and final
ownership rules; it also does not provide the restart replay Jiko still needs.
Benchmark partial-to-final edit distance, tail negation/self-correction,
Chinese/English/Cantonese slices, peak RSS, power, heat, and the human cost of
the 600 ms/look-ahead tuple. Preserve provider partials and final separately;
never let a heuristic partial silently replace the final.

### whisper.cpp: control, fallback, and provenance reference

`whisper.cpp` exposes useful engineering controls: quantized models, ARM NEON,
initial prompts/grammar, no-speech and log-probability thresholds, and a model
download manifest with hashes. Its token/log-probability and no-speech values
are not calibrated probabilities of transcript correctness.

Its current C API also exposes an `abort_callback`. A provider capability such
as `supportsCooperativeCancel` should connect the attempt `AbortSignal` to that
callback and preserve the hot model; only adapters without cooperative abort
should kill/reload their worker and record that cost. This directly improves the
current persistent-worker path, which must terminate the whole worker on active
request cancellation. Source: [whisper.cpp abort callback](https://github.com/ggml-org/whisper.cpp/blob/d5d6e59bfa941adcdbcc7b1f3418706a95f21e39/include/whisper.h#L568-L576).

Use it to answer two questions:

1. Does an independent implementation fail on the same clips as the selected
   streaming model?
2. Can a smaller local fallback complete inside the remaining session deadline
   without changing the privacy policy?

Do not invoke the fallback merely because another engine emitted a low raw
score. The fallback gate is defined later in this note.

## Front-End Signal Processing

### Adopt/adapt/reject matrix

| Component | Mature primary implementation | Jiko action | Main constraint |
| --- | --- | --- | --- |
| AEC, NS, AGC | WebRTC Audio Processing Module (`aec3`, `ns`, `agc2`) | **Adapt** for laptop/full-duplex and later Linux device spike | AEC requires a time-aligned playback reference; thread and sample-format contract must be respected |
| ESP32-S3 AFE | Espressif ESP-SR AFE | **Adapt pattern at ESP edge only** | license grants use on Espressif products; repository also contains precompiled libraries; do not copy as a general Pi dependency |
| portable VAD | Silero VAD v6.2.2 | **Adopt challenger** behind the planned VAD boundary and current audio-feature receipt contract | no replaceable VAD adapter exists yet; stateful sequential chunks and threshold/min-speech/min-silence require corpus tuning |
| alternative VAD | TEN VAD | **Reject production dependency pending legal review** | license adds restrictions beyond Apache-2.0, including competitive-use conditions |
| denoiser | RNNoise | **Adapt as an ASR-only experiment** | operates at 48 kHz/480-sample frames; resampling cost and phoneme distortion need paired tests |
| endpointing | sherpa-onnx endpoint rules plus source button events | **Adopt mechanism; adapt thresholds** | upstream defaults are not product SLOs; VAD and endpointing must remain separate |

### AEC

AEC is justified only when Jiko listens while its own speaker is active or when
a full-duplex observer path creates acoustic echo. WebRTC APM is the strongest
portable upstream reference: it provides a standalone audio-processing API and
separate echo, noise suppression, gain control, and VAD components.

For the current push-to-talk path, pausing TTS before capture is simpler and
safer than always-on AEC. If barge-in becomes a requirement:

- feed the exact playback reference and capture clock relationship;
- measure echo-return loss, near-end deletion, ASR CER, and barge-in latency;
- include double-talk and misaligned-reference fault cases;
- fail explicitly when the reference is missing instead of pretending AEC is
  active.

Espressif's AEC documentation likewise warns that aggressive nonlinear
processing can damage near-end speech. Its implementation is useful for an
ESP32-S3 audio-edge path, but its license is not a portable general-purpose
choice for a Pi runtime.

### Noise suppression and AGC

“Sounds cleaner” is not an acceptance criterion. Every transform is an
ablation:

| Branch | Required comparison |
| --- | --- |
| raw normalized PCM | quality, clipping, level, and timing reference |
| NS only | delta CER/WER, first/last-token deletion, quiet-speech loss |
| AGC only | delta quality, clipping, noise pumping, delivery-feature drift |
| NS + bounded AGC | interaction effect rather than sum of independent gains |
| AEC + NS + AGC | only with playback reference and double-talk cases |
| RNNoise experiment | include 48 kHz resample/compute cost and phoneme deletion |

The voice/delivery line consumes the evidence branch. It must not infer loudness
or dynamics from AGC-modified audio. The ASR branch may use the best measured
transform tuple for the matching microphone profile.

### VAD, pre-roll, and endpointing

VAD answers “which frames look speech-like?” Endpointing answers “is this
utterance complete?” Push-to-talk release answers “did the participant end this
manual turn?” Conflating them creates silent truncation.

Required behavior:

- keep at least a versioned, bounded pre-roll and tail buffer;
- count and expose speech frames removed by any gate;
- never hard-delete audio before the benchmark can replay it;
- for manually held turns, release ends capture even if VAD disagrees;
- for automatic turns, use VAD state, token progress, maximum duration, and a
  deadline together;
- emit partial text as tentative, a stable prefix only after a declared policy,
  and final text exactly once;
- include first-phoneme, low-volume onset, trailing negation, and self-correction
  cases in endpoint sweeps.

One upstream edge case belongs in the conformance suite, not in a footnote.
At reviewed sherpa-onnx commit `a5b4a944...`, samples shorter than the VAD window
remain in `last_`, while `Flush()` commits the circular buffer without consuming
that tail; an example loop using strict `<` can also miss exactly one window.
Test every release remainder from 1 through 512 samples, including the exact
window, short words, trailing negation, duplicate stop, and cancel. Padding may
drive the VAD state machine, but the authoritative ordered source PCM must stay
unchanged. `segment.started` and immutable `segment.final` must each occur once,
and speech-with-empty-text must be `speech_no_text`, not success. Sources:
[VAD buffering](https://github.com/k2-fsa/sherpa-onnx/blob/a5b4a944c5186a68bcdc0ac3011e4c541781ac84/sherpa-onnx/csrc/voice-activity-detector.cc#L50-L136),
[Flush](https://github.com/k2-fsa/sherpa-onnx/blob/a5b4a944c5186a68bcdc0ac3011e4c541781ac84/sherpa-onnx/csrc/voice-activity-detector.cc#L170-L194),
and the [example remainder path](https://github.com/k2-fsa/sherpa-onnx/blob/a5b4a944c5186a68bcdc0ac3011e4c541781ac84/sherpa-onnx/csrc/sherpa-onnx-vad.cc#L84-L90).

Sherpa's circular buffer currently grows by doubling and copying, despite a
stale header comment implying exit-on-overflow. The real product risk is an
unbounded RSS and tail-latency spike under long speech/noise, so Jiko still needs
an utterance byte/duration ceiling rather than relying on upstream allocation.
[Current implementation](https://github.com/k2-fsa/sherpa-onnx/blob/a5b4a944c5186a68bcdc0ac3011e4c541781ac84/sherpa-onnx/csrc/circular-buffer.cc#L95-L115).

Espressif's VAD documentation notes a one-to-three-frame detection delay plus
minimum-speech gating and provides a `vad_cache` pattern. The portable lesson is
pre-roll, not adoption of an ESP-only binary on Linux.

## Context Biasing, Punctuation, ITN, and Two Transcript Tracks

### Context/hotword policy

Allowed candidates:

- participant-approved names and uncommon proper nouns;
- product names and abbreviations used in the scripted study;
- domain vocabulary whose desired written form is unambiguous.

Forbidden candidates:

- content-line decision labels or their close synonyms;
- words whose boosted insertion could change Jiko's result;
- inferred screen/application context not explicitly included in the session
  policy;
- unbounded history or another participant's transcript.

For every list and boost setting, report:

- hotword recall and precision;
- unrelated-word insertion rate and overall CER/WER;
- false alarms on silence/noise;
- list-size and phrase-length slice;
- critical-content preservation, especially negation and modality.

The current Moonshine domain-customization guide is a useful benchmark model:
it separately measures target-term errors, other-word errors, and false alarms,
and warns that high boosts or large lists can damage general accuracy. The
sherpa-onnx context graph is a usable implementation mechanism. Neither upstream
default should be copied without the Jiko sweep.

### Transcript contract

The target contract keeps both tracks in the receipt:

| Track | Contract | May be consumed by |
| --- | --- | --- |
| `faithful` | exact provider final string plus model/runtime/artifact identity | audit, replay, strict CER/WER, UI evidence view |
| `semantic` | deterministic output plus transform name/version and a diff from `faithful` | bounded content rules and normalized search |

The current implementation does not yet satisfy that exact contract. It stores
adapter-extracted `text`, a derived `semanticText`, and transform names, but not
the untouched provider payload or a machine-readable diff. Several adapters
trim or reconstruct text before the protocol boundary. Until task 5 lands, call
the current first track **adapter-extracted**, not provider-faithful, and do not
use its receipts as strict raw-provider replay evidence.

Allowed semantic transforms are narrow and ordered:

1. Unicode NFC;
2. full-width ASCII folding where declared;
3. removal of provider control/language/event tags;
4. bounded whitespace and zero-width-format normalization;
5. optional, separately versioned punctuation or ITN stage;
6. optional, bounded filler treatment for content only.

Never silently:

- rewrite repetitions or self-corrections;
- complete an unfinished sentence;
- change certainty or modality;
- convert dates, quantities, percentages, names, or negation without preserving
  the original and the transform diff;
- use punctuation or ITN output as ground truth.

Score both strict faithful CER/WER and semantic-normalized CER/WER. Add a
critical-content metric for names, numbers, negation, modality, and the bounded
decision vocabulary. A lower normalized score can hide a damaging rewrite.

## Calibrated Uncertainty and Fallback Gating

### Why raw confidence is insufficient

Neural-network scores are often miscalibrated. Decoder log probability,
entropy, no-speech probability, blank rate, or provider confidence can be useful
features, but none is automatically a probability that the utterance is
correct. Scores from different providers are not comparable.

Calibration is keyed by this tuple:

```text
provider + model artifact hash + quantization + runtime version
+ decoding parameters + audio profile + transcript-transform version
```

Changing any member invalidates the threshold until recalibrated.

### Labels and calibration

Use speaker-disjoint train, calibration, and test partitions. Derive labels from
alignment, not subjective provider confidence:

- utterance exact/acceptable for the product range;
- character/word correctness where an output token exists;
- critical-keyword correctness;
- deletion indicators from reference alignment, because confidence attached to
  emitted words cannot represent a missing word;
- no-speech correctness and hallucination.

Start with a simple, inspectable calibrator such as temperature scaling or
logistic calibration over a fixed feature vector. A more complex confidence
model must beat it on frozen test data, not only on training likelihood.

Report:

- reliability diagram and expected/adaptive calibration error;
- negative log likelihood and Brier score;
- NIST-style normalized cross entropy where the word-confidence contract fits;
- AUROC and AUPRC for error detection;
- risk-coverage curve and selective CER/WER;
- every metric by language, noise, accent, level, and device slice.

### Fallback gate

Fallback is a policy decision over multiple signals:

```text
audio_valid
and remaining_deadline_allows_fallback
and local_fallback_is_ready
and (
  primary_failed
  or calibrated_product_risk > threshold_for_this_artifact
  or required_critical_span_is_unavailable
)
```

Additionally:

- one session deadline bounds primary plus fallback; fallback does not reset it;
- model missing, unsupported audio, gap/overflow, empty speech, timeout, and
  circuit-open are typed outcomes;
- a failure cannot become `static` or another fabricated result;
- without a calibration receipt, confidence remains telemetry and cannot
  silently trigger a model switch;
- remote audio is never a fallback under current project policy; the implemented
  Deepgram batch experiment requires explicit provider/process/request gates,
  while Doubao/Volcengine or any other future route requires its own policy
  decision and per-session consent;
- disagreement between two models is a possible later risk feature, not a
  hidden majority vote or ground truth.

Choose the threshold on the calibration partition to meet a declared maximum
critical-error risk at an acceptable coverage. Freeze it, then report untouched
test performance. Do not tune the threshold on the release set.

## Quantization, Backends, and Hardware Boundaries

### Quantization procedure

ONNX Runtime's official guidance treats quantization as a transformation that
can reduce accuracy. Jiko should therefore keep float and quantized artifacts
long enough to perform paired comparison:

1. freeze the float graph, tokenizer, preprocessing, and decoder;
2. run the float baseline on the frozen corpus;
3. quantize with an explicit recipe and calibration manifest;
4. use activation/weight comparison tools to locate divergence;
5. test per-tensor versus per-channel weights when ranges differ materially;
6. compare global and slice CER/WER, critical deletion, confidence calibration,
   RSS, installed bytes, latency, and energy;
7. publish a new artifact ID instead of overwriting a cache entry.

ONNX Runtime currently recommends S8S8 with QDQ as the first CPU option. That
is a starting point, not a mandate. Some ARM CPUs benefit from dot-product
instructions, while unsupported operators and graph partitioning can erase the
gain.

### Execution-provider decisions

| Target | Start with | Advance only when | Keep at the edge |
| --- | --- | --- | --- |
| Pi 5 / CM5 Linux ARM64 | ONNX Runtime CPU EP, pinned affinity/thread sweep | XNNPACK covers enough expensive nodes and improves end-to-end p95/energy without quality drift | EP choice, thread count, affinity, thermal/power profile |
| Android hardware | CPU/XNNPACK baseline | NNAPI profiling shows the real accelerator rather than slow reference fallback, and supported-op coverage is high | NNAPI flags, OS/API/device allowlist |
| Apple laptop/device | CPU baseline | Core ML/ANE wins on the exact graph and deployment target | Core ML provider and device compatibility tuple |
| ESP32-S3 audio edge | fixed audio AFE/VAD functions | memory, wake, transport, and acoustic tests pass | ESP-SR integration; do not move ASR model assumptions into shared core |

For XNNPACK, avoid two competing thread pools: upstream recommends setting ORT
intra-op threads to one when XNNPACK owns the covered compute and sizing the
XNNPACK pool to physical cores. Verify with the ORT profile because uncovered
nodes fall back to CPU EP.

NNAPI may fall back to a slow reference CPU implementation, so “NNAPI enabled”
is not evidence of hardware acceleration. Core ML is Apple-specific. Neither
belongs in the provider-neutral contract.

### Hand-written operator gate

A custom NEON/kernel path is allowed only after all of these are true:

1. the target-device profile identifies the same stable hotspot across the
   representative corpus;
2. graph fusion, layout, thread, allocator, quantization, and existing EPs have
   been measured first;
3. the operator has scalar/reference differential tests over adversarial sizes,
   alignments, saturation, and random seeds;
4. model-level transcript parity or a bounded quality delta is proven;
5. end-to-end p95 latency, energy, or footprint improves materially;
6. fallback and unsupported-CPU behavior remain correct.

Kernel microseconds without session-level improvement are not a product win.

## Benchmark Design

### Two panels, one manifest contract

Use two separate panels:

1. **Public reproducibility panel** — versioned, licensed public data that an
   external engineer can obtain independently.
2. **Hardware acceptance panel** — consented scripted recordings on the final
   microphone, placement, enclosure, loudspeaker, power, and thermal setup.

Never commit raw recordings or real-person transcripts. Commit only a
privacy-reviewed manifest schema, non-identifying labels, hashes, licenses, and
aggregate receipts. Store internal audio and reference text in access-controlled
artifact storage.

Candidate public sources:

| Source | Useful slice | License/provenance caution |
| --- | --- | --- |
| AISHELL-1 / OpenSLR 33 | clean read Mandarin; accent-region speaker metadata | OpenSLR page names Apache 2.0 but also says free for academic use; snapshot and review the actual distribution terms before redistribution |
| Mozilla Common Voice Chinese | diverse community speech | dataset release is CC0; pin release/language/config and file hashes |
| WenetSpeech | Mandarin internet/meeting test conditions | repository code is Apache-2.0, but data access/license agreement is separate; capture it with the corpus receipt |
| TALCS | Mandarin-English code-switch research | paper is primary discovery evidence; verify the actual archive terms/access before adding audio |
| BAAI CS-Dialogue | conversational code-switch lab slice | model card is CC BY-NC-SA 4.0; noncommercial lab use only unless terms change |
| MUSAN / OpenSLR 17 | additive noise/music/babble | CC BY 4.0; preserve attribution and exact subset |
| MS-SNSD | deterministic noise/SNR recipe | code is MIT but component audio has mixed licenses; manifest each selected source |

Synthetic mixtures are not substitutes for real microphone/enclosure captures.
They make SNR sweeps reproducible; they do not model distance, direction,
reverberation, nonlinear gain, clipping, clock drift, or loudspeaker coupling.

### Required slices

| Dimension | Required cases |
| --- | --- |
| language | Mandarin; English names/acronyms; Mandarin-English code-switch with switch points |
| delivery | short command, long utterance, hesitation, filler, repetition, self-correction, unfinished phrase, rapid speech |
| critical content | negation, modality, names, dates, amounts, percentages, homophones, decision-bearing phrases |
| onset/offset | soft initial phoneme, plosive onset, immediate speech after press, trailing short word/negation, release during speech |
| level/distance | normal, quiet voice, loud, clipped; near/far and off-axis on the real microphone |
| environment | quiet, fan, music, babble, handling noise, keyboard, silence/non-speech |
| SNR | deterministic clean/20/10/5/0 dB discovery grid, then hardware-measured real-room conditions |
| accent | multiple Mandarin regions and non-native English; report per slice rather than one “accent” average |
| interruption | TTS bleed, barge-in/double-talk, cancel, restart, overlapping observer/device load |
| failure | missing/corrupt model, unsupported media, PCM gap, queue overflow, device disconnect, deadline, thermal throttle |

Digital attenuation alone is not a quiet-speaker test. Include real distance and
microphone self-noise. Likewise, additive noise alone is not a playback-echo
test; use the intended loudspeaker/enclosure.

### Metrics

Recognition:

- strict Chinese CER on `faithful` output;
- English WER and mixed-token/code-switch error rate;
- per-language substitution/deletion/insertion and switch-boundary deletion;
- semantic-normalized CER/WER with exact transform version;
- critical-term recall/precision and negation/number/name preservation;
- silence/noise false-transcript rate and repeated-token hallucination rate;
- first- and last-token deletion rate.

Streaming and UX:

- press-to-first-valid-frame;
- speech-onset-to-first-partial;
- first-partial-to-stable-prefix and partial revision count;
- last-speech/release-to-final p50/p95/p99;
- endpoint lag and early-cut rate;
- cancel/barge-in acknowledgement and stale-result suppression.

Runtime:

- initialization, feature extraction, decoding, post-processing, fallback, and
  total latency separately;
- cold and warmed real-time factor;
- peak RSS, CPU time/utilization, model/disk bytes, memory growth;
- energy/session, temperature, throttling, underrun/xrun, gap/drop counters;
- installed/update bytes and recovery from corrupt/missing artifacts.

Calibration and operations:

- coverage, abstention, timeout, error, and fallback rate;
- reliability/ECE, NLL/Brier/NCE, error AUROC/AUPRC, risk-coverage;
- provider/model/config/cache identities and every transformation hash;
- failure type and whether the session produced an explicit unavailable state.

### Experimental controls

- Speaker, session, and device captures must not leak across calibration and
  test. Grouped split comes before random utterance split.
- Compare candidates with paired utterances and identical normalized PCM.
- Separate whole-utterance accuracy from real chunked streaming accuracy.
- Disable VAD on pre-segmented model-only evaluation; enable and score it in the
  full live pipeline.
- Pin model, tokenizer, runtime, decoding parameters, thread count, power mode,
  microphone profile, and text normalizer.
- Bootstrap confidence intervals by speaker/utterance group and report paired
  deltas. Do not select a model from an overall mean alone.
- Run preprocess factorial ablations before locking the front-end tuple.
- Report failures and abstentions in the denominator; do not compute CER only on
  successful easy cases.
- Compare candidates lexicographically: policy/license/reproducibility, critical
  quality, latency, device resources, then operational complexity.

Repository status: `stt_benchmark_v1` now carries manifest slice labels into
new case receipts, binds each result to the verified audio hash, rejects
cross-candidate input mismatches, and can emit an identity-bearing pairwise
evidence audit. It intentionally
cannot name a winner: the receipt version has no policy artifact, grouped
bootstrap interval, device resource/thermal fields, or normalized cold-start
phase. Those omissions are machine-visible blockers, not prose-only caveats.

### What can be claimed after each gate

| Evidence | Allowed statement | Forbidden shortcut |
| --- | --- | --- |
| upstream paper/repository | “candidate supports this mechanism upstream” | “Jiko achieves the upstream WER/latency” |
| laptop frozen-corpus run | “on this laptop and manifest, candidate A had this receipt” | “works on the device” |
| target-device bench | “on this hardware/image/profile, this tuple passed” | “all Pi/CM5 units pass” |
| enclosure/acoustic/soak run | “this prototype tuple passed this duration and condition” | “production reliable” |
| calibrated held-out test | “this artifact's threshold has this test risk/coverage” | “confidence is universally 90% correct” |

## Adopt, Adapt, Reject

### Adopt now as architecture

- one provider-neutral ordered PCM ingress;
- evidence and ASR audio branches;
- persistent local runtimes and prewarmed exact artifacts;
- button-authoritative manual turns, explicit VAD and endpoint receipts;
- provider-faithful plus versioned semantic transcripts;
- target-device, same-corpus, paired receipts;
- typed failure/unavailable states and one end-to-end deadline.

### Adapt behind benchmarks

- streaming Zipformer/sherpa-onnx endpoint and context graph;
- Moonshine Mandarin streaming runtime and memory/quantization test patterns;
- WebRTC APM for justified full-duplex paths;
- Silero VAD thresholds/state; RNNoise only on the ASR branch;
- provider-specific confidence features and simple calibration;
- ORT CPU/XNNPACK thread and graph-layout choices;
- ESP-SR AFE only inside an Espressif hardware adapter.

### Reject for the current production path

- a single global “best model” selected from incompatible vendor tables;
- pseudo-streaming SenseVoice presented as native streaming;
- decision-word hotwords or hidden generative transcript rewriting;
- raw decoder score as a portable correctness probability;
- VAD hard deletion without pre-roll/tail and replay evidence;
- always-on AEC without a synchronized playback reference;
- using AGC-modified audio for delivery/loudness conclusions;
- TEN VAD as a production dependency before license resolution;
- copying ESP-SR precompiled components into a non-Espressif runtime;
- NNAPI/Core ML logic in the shared core;
- custom neural kernels before profiling and differential accuracy proof;
- silent paid-cloud fallback under the current local-first policy.

## Ten P0/P1 Implementation Tasks

Exactly these ten tasks form the recommended execution order. They are scoped
so implementation can remain small and reviewable.

1. **P0 — Freeze `asr_corpus_v1` manifest and provenance.** Define consent,
   storage, speaker/session/device grouping, license snapshots, hashes, reference
   normalization, required slices, and a synthetic public CI subset. Acceptance:
   the manifest is reproducible without committing raw personal audio or real
   transcripts.
2. **P0 — Finish `ordered_pcm_v1` across both shells.** The browser now has a
   bounded `AudioWorklet`/WebSocket path, cumulative process-lifetime spool ACK,
   explicit loss/overflow failure, source hash, and canonical receipt. Add the
   Pi ALSA/native edge, pre-roll, restart-recoverable ownership, global spool
   quota, and provider fan-out; manual controls remain on canonical events and
   never fabricate PCM. Acceptance: every model receives byte-identical ordered
   PCM for a fixture, loss is observable, and crash/replay cannot duplicate a
   final.
3. **P0 — Add the ASR front-end ablation harness.** Evaluate raw, WebRTC NS/AGC,
   justified AEC, and RNNoise branches without changing the evidence audio.
   Acceptance: paired receipts include CER/WER, first/last deletion, clipping,
   CPU, RTF, and latency for each tuple.
4. **P0 — Run the frozen baseline/challenger matrix.** Pin SenseVoice int8,
   streaming bilingual Zipformer, and `whisper.cpp` tiny/base artifacts,
   licenses, configs, and hashes. Acceptance: same-corpus laptop and Pi/CM5
   receipts expose cold/warm quality, latency, RSS, failure, and thermal fields.
5. **P0 — Implement and test the two-track transcript contract.** Preserve exact
   provider final text and produce a versioned semantic view with a machine-
   readable diff. Acceptance: regression fixtures prove numbers, names,
   negation, modality, repetitions, and code-switch spans are never silently
   changed.
6. **P0 — Calibrate uncertainty before enabling confidence fallback.** Build
   speaker-disjoint calibration/test partitions, alignment-derived labels,
   a simple calibrator, and risk-coverage receipts. Acceptance: an artifact-
   specific threshold is frozen from calibration and verified on untouched
   slices; otherwise the gate remains disabled.
7. **P1 — Spike Moonshine Mandarin Tiny Streaming.** Integrate the MIT streaming
   artifact behind the common ingress and reproduce upstream chunked mode.
   Acceptance: Jiko code-switch/quiet/noise/endpoint quality plus p95 latency,
   RSS, sustained heat, and memory-growth receipts are comparable with task 4.
8. **P1 — Sweep endpoint and context-bias parameters.** Test silence thresholds,
   maximum duration, pre-roll/tail, modified-beam paths, list size, and boost
   using only allowed proper nouns. Acceptance: report hotword recall/precision,
   unrelated insertions, early cuts, endpoint lag, and critical-content errors;
   decision words remain excluded by test.
9. **P1 — Run the quantization and execution-provider matrix.** Compare float/
   quantized artifacts, per-tensor/per-channel where supported, ORT CPU and
   XNNPACK thread/affinity settings on target hardware. Acceptance: graph
   coverage/profile, numerical/ASR delta, p95, energy, RSS, bytes, and thermal
   effects justify the selected tuple.
10. **P1 — Complete acoustic and reliability acceptance on the intended
    assembly.** Record consented scripted speech on the final mic/enclosure and
    exercise fan/noise/distance/angle/TTS bleed/barge-in, process kill, model
    corruption, long soak, and offline boot. Acceptance: every fault is typed,
    stale results are suppressed, privacy retention passes, and the selected
    tuple's release gates are attached to the readiness ledger.

## Source Ledger

The commit/tag identifies what was inspected on 2026-09-18. A moving docs URL
is paired with an immutable source link whenever practical.

### ASR models and runtimes

- **SenseVoice**, commit
  [`ea15219509625e5d4c5143c37c86970135886b5d`](https://github.com/QwenAudio/SenseVoice/tree/ea15219509625e5d4c5143c37c86970135886b5d):
  [`README.md`](https://github.com/QwenAudio/SenseVoice/blob/ea15219509625e5d4c5143c37c86970135886b5d/README.md),
  [`LICENSE`](https://github.com/QwenAudio/SenseVoice/blob/ea15219509625e5d4c5143c37c86970135886b5d/LICENSE),
  and the authors' [SenseVoice/FunAudioLLM paper](https://arxiv.org/abs/2407.04051).
  The separately measured sherpa-onnx conversion came from the
  [2025-09-09 release artifact](https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-sense-voice-zh-en-ja-ko-yue-int8-2025-09-09.tar.bz2),
  whose README points to the ASLP-lab WSYue fine-tune; the reviewed source
  snapshot is
  [`4a74a91430485d7456cb786f1d0ff0aba1185ded`](https://huggingface.co/ASLP-lab/WSYue-ASR/tree/4a74a91430485d7456cb786f1d0ff0aba1185ded/sensevoice_small_yue).
  The official SenseVoice source code is MIT and its official weights are
  separately governed through their model card/FunASR Model Open Source
  License; that statement does not resolve the measured third-party conversion.
- **FunASR**, commit
  [`904cd18681b8083de5e1039bd0ecebc4f49ede60`](https://github.com/modelscope/FunASR/tree/904cd18681b8083de5e1039bd0ecebc4f49ede60):
  [`README.md`](https://github.com/modelscope/FunASR/blob/904cd18681b8083de5e1039bd0ecebc4f49ede60/README.md),
  [`LICENSE`](https://github.com/modelscope/FunASR/blob/904cd18681b8083de5e1039bd0ecebc4f49ede60/LICENSE),
  [`MODEL_LICENSE`](https://github.com/modelscope/FunASR/blob/904cd18681b8083de5e1039bd0ecebc4f49ede60/MODEL_LICENSE),
  and [`fun_text_processing/inverse_text_normalization`](https://github.com/modelscope/FunASR/tree/904cd18681b8083de5e1039bd0ecebc4f49ede60/fun_text_processing/inverse_text_normalization).
- **sherpa-onnx**, commit
  [`a5b4a944c5186a68bcdc0ac3011e4c541781ac84`](https://github.com/k2-fsa/sherpa-onnx/tree/a5b4a944c5186a68bcdc0ac3011e4c541781ac84),
  Apache-2.0: [`endpoint.h`](https://github.com/k2-fsa/sherpa-onnx/blob/a5b4a944c5186a68bcdc0ac3011e4c541781ac84/sherpa-onnx/csrc/endpoint.h),
  [`online-recognizer.h`](https://github.com/k2-fsa/sherpa-onnx/blob/a5b4a944c5186a68bcdc0ac3011e4c541781ac84/sherpa-onnx/csrc/online-recognizer.h), and
  [`online-transducer-modified-beam-search-nemo-decoder.cc`](https://github.com/k2-fsa/sherpa-onnx/blob/a5b4a944c5186a68bcdc0ac3011e4c541781ac84/sherpa-onnx/csrc/online-transducer-modified-beam-search-nemo-decoder.cc).
  Architecture paper: [Zipformer](https://arxiv.org/abs/2310.11230).
- **Moonshine**, commit
  [`234f60faa0eb388b01cdf7e60aca232af37aefda`](https://github.com/moonshine-ai/moonshine/tree/234f60faa0eb388b01cdf7e60aca232af37aefda),
  MIT for code/current streaming models:
  [`LICENSE`](https://github.com/moonshine-ai/moonshine/blob/234f60faa0eb388b01cdf7e60aca232af37aefda/LICENSE),
  [`available-models.md`](https://github.com/moonshine-ai/moonshine/blob/234f60faa0eb388b01cdf7e60aca232af37aefda/docs/models/available-models.md),
  [`accuracy.md`](https://github.com/moonshine-ai/moonshine/blob/234f60faa0eb388b01cdf7e60aca232af37aefda/docs/models/accuracy.md),
  [`quantization.md`](https://github.com/moonshine-ai/moonshine/blob/234f60faa0eb388b01cdf7e60aca232af37aefda/docs/models/quantization.md),
  [`domain-customization.md`](https://github.com/moonshine-ai/moonshine/blob/234f60faa0eb388b01cdf7e60aca232af37aefda/docs/models/domain-customization.md),
  [`moonshine-streaming-model.cpp`](https://github.com/moonshine-ai/moonshine/blob/234f60faa0eb388b01cdf7e60aca232af37aefda/core/moonshine-streaming-model.cpp),
  [`transcriber-streaming-memory-test.cpp`](https://github.com/moonshine-ai/moonshine/blob/234f60faa0eb388b01cdf7e60aca232af37aefda/core/transcriber-streaming-memory-test.cpp), and
  [`quantize-streaming-model.sh`](https://github.com/moonshine-ai/moonshine/blob/234f60faa0eb388b01cdf7e60aca232af37aefda/scripts/quantize-streaming-model.sh).
  Papers: [Moonshine v1](https://arxiv.org/abs/2410.15608),
  [Moonshine v2](https://arxiv.org/abs/2602.12241), and
  [Moonshine model flavors](https://arxiv.org/abs/2509.02523).
- **whisper.cpp**, commit
  [`d5d6e59bfa941adcdbcc7b1f3418706a95f21e39`](https://github.com/ggml-org/whisper.cpp/tree/d5d6e59bfa941adcdbcc7b1f3418706a95f21e39),
  MIT: [`README.md`](https://github.com/ggml-org/whisper.cpp/blob/d5d6e59bfa941adcdbcc7b1f3418706a95f21e39/README.md),
  [`include/whisper.h`](https://github.com/ggml-org/whisper.cpp/blob/d5d6e59bfa941adcdbcc7b1f3418706a95f21e39/include/whisper.h),
  [`models/README.md`](https://github.com/ggml-org/whisper.cpp/blob/d5d6e59bfa941adcdbcc7b1f3418706a95f21e39/models/README.md), and
  the [Whisper paper](https://cdn.openai.com/papers/whisper.pdf).

### Audio front end

- **WebRTC Audio Processing Module**, source commit
  [`b32e4b35e6025f044e88f4cc3169523b3021e3a9`](https://webrtc.googlesource.com/src/+/b32e4b35e6025f044e88f4cc3169523b3021e3a9/),
  BSD-style license: [APM design/documentation](https://webrtc.googlesource.com/src/+/b32e4b35e6025f044e88f4cc3169523b3021e3a9/modules/audio_processing/g3doc/audio_processing_module.md)
  and [`api/audio/audio_processing.h`](https://webrtc.googlesource.com/src/+/b32e4b35e6025f044e88f4cc3169523b3021e3a9/api/audio/audio_processing.h).
- **ESP-SR**, commit
  [`44b08495ef4b00b53fb0496bd6077223f77256ec`](https://github.com/espressif/esp-sr/tree/44b08495ef4b00b53fb0496bd6077223f77256ec):
  [AFE documentation](https://docs.espressif.com/projects/esp-sr/en/latest/esp32/audio_front_end/README.html),
  [AEC documentation](https://docs.espressif.com/projects/esp-sr/en/latest/esp32/acoustic_echo_cancellation/README.html),
  [`docs/en/vadnet/README.rst`](https://github.com/espressif/esp-sr/blob/44b08495ef4b00b53fb0496bd6077223f77256ec/docs/en/vadnet/README.rst), and
  [license](https://github.com/espressif/esp-sr/blob/44b08495ef4b00b53fb0496bd6077223f77256ec/LICENSE).
- **Silero VAD**, tag `v6.2.2`, commit
  [`60b7ffa243625ebdc1070275a29f18c87843786a`](https://github.com/snakers4/silero-vad/tree/60b7ffa243625ebdc1070275a29f18c87843786a),
  MIT: [`README.md`](https://github.com/snakers4/silero-vad/blob/60b7ffa243625ebdc1070275a29f18c87843786a/README.md)
  and [tuning wiki](https://github.com/snakers4/silero-vad/wiki/Examples-and-Dependencies-Overview).
- **TEN VAD**, commit
  [`22a3bcd4509d0faaa8eef4881e8af5f39c178950`](https://github.com/TEN-framework/ten-vad/tree/22a3bcd4509d0faaa8eef4881e8af5f39c178950):
  [`LICENSE`](https://github.com/TEN-framework/ten-vad/blob/22a3bcd4509d0faaa8eef4881e8af5f39c178950/LICENSE).
- **RNNoise**, commit
  [`70f1d256acd4b34a572f999a05c87bf00b67730d`](https://github.com/xiph/rnnoise/tree/70f1d256acd4b34a572f999a05c87bf00b67730d),
  BSD-3-Clause-like terms: [`COPYING`](https://github.com/xiph/rnnoise/blob/70f1d256acd4b34a572f999a05c87bf00b67730d/COPYING),
  [`include/rnnoise.h`](https://github.com/xiph/rnnoise/blob/70f1d256acd4b34a572f999a05c87bf00b67730d/include/rnnoise.h), and
  [`src/vec_neon.h`](https://github.com/xiph/rnnoise/blob/70f1d256acd4b34a572f999a05c87bf00b67730d/src/vec_neon.h).
  Upstream notes that the canonical repository is the Xiph GitLab instance.

### Calibration, inference, and datasets

- **Calibration:** [Guo et al., *On Calibration of Modern Neural Networks*](https://proceedings.mlr.press/v70/guo17a.html);
  [Oneata et al., *An Evaluation of Word-Level Confidence Estimation for End-to-End ASR*](https://arxiv.org/abs/2101.05525);
  NIST SCTK commit
  [`9688a26882a688132a5e414cadcb4c19b6fffaba`](https://github.com/usnistgov/SCTK/tree/9688a26882a688132a5e414cadcb4c19b6fffaba),
  [`sclite.htm`](https://github.com/usnistgov/SCTK/blob/9688a26882a688132a5e414cadcb4c19b6fffaba/doc/sclite.htm).
- **ONNX Runtime**, reviewed source HEAD
  `bc8e7ed75c8b29d72f4b7bbbe4a0b66bafd28b49`:
  [quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html),
  [mobile guidance](https://onnxruntime.ai/docs/tutorials/mobile/),
  [XNNPACK](https://onnxruntime.ai/docs/execution-providers/Xnnpack-ExecutionProvider.html),
  [NNAPI](https://onnxruntime.ai/docs/execution-providers/NNAPI-ExecutionProvider.html), and
  [Core ML](https://onnxruntime.ai/docs/execution-providers/CoreML-ExecutionProvider.html).
- **Public data/noise:** [AISHELL-1 / OpenSLR 33](https://www.openslr.org/33/),
  [Mozilla Common Voice datasets](https://commonvoice.mozilla.org/en/datasets),
  [WenetSpeech source](https://github.com/wenet-e2e/WenetSpeech/tree/d293df833f053154fe5e2cec2c46a5b39a7175ad),
  [MUSAN / OpenSLR 17](https://www.openslr.org/17/),
  [MS-SNSD source](https://github.com/microsoft/MS-SNSD/tree/fe61c4ba0d9ac8dd7e23d719cc79f8947e1dc742),
  [TALCS paper](https://arxiv.org/abs/2206.13135), and
  [BAAI CS-Dialogue model card](https://huggingface.co/datasets/BAAI/CS-Dialogue).

## Open Evidence Gaps

This research pass did not itself run the candidate matrix or inspect Jiko's
final microphone assembly. In parallel, the project did run one pinned
SenseVoice int8 artifact on five non-human synthetic host fixtures and produced
`host_measured` / `not_evaluated` receipts. That spike exposed a 10/10 digital-
silence hallucination and ITN-dependent English deletion; it is not a model
winner or a real-speech result. Those receipts are under ignored `artifacts/`,
used a temporary corpus/config, and record `gitDirty=true`, so this repository
does not yet contain an independently reproducible evidence bundle.
Specifically still unknown:

- Jiko corpus CER/WER and critical-content error for every candidate;
- real partial/final latency on laptop, Pi 5, and candidate CM5 configuration;
- final microphone/enclosure pre-roll, echo, SNR, clock, and thermal behavior;
- exact licenses and hashes for every candidate artifact; the measured
  SenseVoice conversion has byte hashes but still lacks a pinned conversion
  license snapshot;
- whether any confidence feature is calibratable enough to improve selective
  risk over explicit failure-only fallback;
- whether enhancement improves ASR without damaging quiet speech or the first/
  last phoneme;
- whether XNNPACK or any hardware accelerator covers enough of the chosen graph
  to beat a tuned CPU path.

Until those receipts exist, “challenger,” “reported,” and “specified” are the
only honest labels.
