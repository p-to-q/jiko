# Edge Speech, Compute, And Hardware Co-Design

Status: research decision and implementation gates
Reviewed: 2026-09-18
Scope: STT / ASR, transcript rules, bounded TTS, edge inference, optional remote
services, and the compute path from laptop to a product board.

This note turns the speech and compute research into decisions. It is not a
claim that any model, accelerator, or latency target already passed on Jiko's
hardware. Candidate status means **measure it on the same corpus and target**.

The recommended route is the evidence-gated hybrid shown in
[the edge speech route map](edge-speech-routes-v1.svg): local is the product
default, the remote-provider adapter class is explicit and policy-gated, and
larger models are offline teachers or lab references. Only the Deepgram batch
boundary is currently implemented, but no live paid-provider experiment is
authorized under [Remote Audio Policy](remote-audio-policy.md); other remote
providers remain design candidates.

The code-level TypeFree/VoicePi comparison, Doubao/Volcengine controls, common
streaming ingress, and strict fallback contract are documented separately in
[Low-Latency Voice Input: Local And API Paths](research-low-latency-voice-input.md).
The source-pinned model, frontend, confidence, and benchmark analysis is in
[ASR Accuracy Stack And Model Selection](research-asr-accuracy-stack.md).

## Decision In One Page

1. Keep the three product readings independent:
   - **content** consumes a faithful transcript and a separately receipted
     semantic view;
   - **voice** consumes waveform/VAD/pitch/energy evidence, never transcript
     sentiment or an ASR confidence proxy;
   - **timing** consumes source-monotonic button/capture/VAD events, never API
     or network latency.
2. Keep one provider-neutral speech contract. Model runtimes, remote services,
   microphone drivers, GPIO, and accelerators remain adapters at the edge.
3. Use the existing persistent SenseVoice int8 path as the integrated baseline,
   not as a preselected winner.
4. Benchmark a bilingual streaming Zipformer in the existing sherpa-onnx
   runtime first. It offers the smallest architectural step from the current
   worker and can start decoding before button release.
5. Benchmark the current Moonshine Mandarin Tiny Streaming model second. At the
   reviewed upstream commit it is a 34M MIT streaming model with cached C++/ORT
   state, but Jiko still needs exact-artifact, code-switch, ARM64, memory, and
   thermal proof.
6. Keep quantized whisper.cpp tiny/base as the portable CPU fallback and
   independent implementation control.
7. Use Qwen3-ASR 0.6B and FireRedASR2-AED as laptop/GPU teachers and accuracy
   ceilings. They are not the CM5 default: the official Qwen 0.6B artifact is
   about 1.88 GB, while FireRed's current deployment work is aimed at much
   larger GPU-class models.
8. Preserve paid remote STT only as an explicit challenger or policy-selected
   fallback. Never silently turn a local timeout into an audio upload.
9. Keep the seven bounded spoken result lines as pre-rendered local clips. Add
   dynamic TTS only if the product vocabulary becomes open-ended.
10. Do not hand-write a neural operator until a target-device profile proves a
    stable hotspot, an existing optimized backend cannot cover it, and the
    candidate kernel has differential accuracy tests plus a measurable system
    win.

## Model Roles, Not One Global Winner

| Candidate | Intended role | Evidence in its favor | Gate or reason to hold |
| --- | --- | --- | --- |
| sherpa-onnx SenseVoice Small int8 | integrated non-streaming baseline | current persistent worker; multilingual zh/en/yue/ja/ko; official project describes a 234M encoder model and an ONNX path | exact converted artifact license/hash, same-corpus CER/WER, silence hallucination, cold/warm latency, RSS and Pi/CM5 thermal proof |
| sherpa-onnx bilingual streaming Zipformer/transducer | first live-device challenger | same runtime family; official examples cover streaming microphone and zh/en models | checkpoint training provenance, mixed-language accuracy, model footprint, endpoint stability and first-phoneme tests |
| Moonshine Mandarin Tiny Streaming | second live-device challenger | current upstream lists a 34M MIT streaming model with incremental audio, cached C++ state, ONNX Runtime, Mandarin evaluation, and memory tests | exact artifact hash, ARM64 build, same-corpus/code-switch behavior, memory and real enclosure measurements; upstream accuracy is not Jiko evidence |
| whisper.cpp tiny/base quantized | portable CPU fallback and independent control | C/C++, ARM NEON, integer quantization, Raspberry Pi support, zero runtime allocation design and built-in benchmark tooling | Chinese/code-switch quality, quantization delta, warm state and Jiko target-device latency |
| FunASR self-hosted | laptop/reference service | Chinese ecosystem, timestamps/hotword/ITN tooling, current local HTTP adapter | server footprint and external supervision make it a poor assumed device default |
| Qwen3-ASR 0.6B/1.7B | teacher, laptop/GPU/NPU ceiling, optional service challenger | Apache-2.0 model family; broad language/dialect coverage; official streaming path exists through vLLM | 0.6B artifact size and vLLM streaming dependency are outside the current CM5 budget; teacher output is not ground truth |
| FireRedASR2-AED / FireRedPunc | Chinese/dialect/code-switch teacher and punctuation reference | official 2026 suite covers Mandarin, 20+ dialects/accents, English, code-switch, VAD/LID/punctuation | billion-scale/GPU-oriented stack; not an edge runtime candidate without a separate compressed model |
| Deepgram Nova-3 batch/stream | paid remote challenger | interim/final events, configurable endpointing, key terms, model-version field and request metadata | explicit consent, WAN/privacy/cost/region gates; Jiko must measure rather than adopt vendor latency/accuracy claims |
| Qwen3-ASR-Flash-Realtime | paid remote challenger for Chinese/code-switch | manual or server-VAD turn control, context/hotwords, pinned snapshots and regional endpoints | some realtime variants omit timestamps; explicit consent and region/data policy still required |

Primary references:

- [sherpa-onnx examples and supported models](https://github.com/k2-fsa/sherpa-onnx)
- [SenseVoice source/model license distinction](https://github.com/QwenAudio/SenseVoice)
- [whisper.cpp runtime and quantization](https://github.com/ggml-org/whisper.cpp)
- [Current Moonshine streaming runtime](https://github.com/moonshine-ai/moonshine)
- [Qwen3-ASR official repository](https://github.com/QwenLM/Qwen3-ASR)
- [Qwen3-ASR 0.6B artifact](https://huggingface.co/Qwen/Qwen3-ASR-0.6B)
- [FireRedASR2S](https://github.com/FireRedTeam/FireRedASR2S)
- [Deepgram endpointing and interim results](https://developers.deepgram.com/docs/understand-endpointing-interim-results)
- [Alibaba Model Studio realtime ASR](https://help.aliyun.com/en/model-studio/real-time-speech-recognition-user-guide)

Popularity, published aggregate WER, parameter count, and TOPS are discovery
signals only. Jiko's selection score is lexicographic:

1. privacy/license/reproducibility and failure correctness;
2. frozen Jiko corpus quality, including silence and first-phoneme failures;
3. release-to-result and first-partial latency on the intended device;
4. peak memory, sustained power, temperature and throttling;
5. installed bytes, update cost, supervision and rollback complexity.

An option that fails an earlier class does not win by being faster later.

### What Typeless proves — and what it does not

Typeless is useful product prior art, but it is not evidence for a particular
on-device model. Its August 2026
[data-control statement](https://www.typeless.com/data-controls) explicitly
says transcription happens on cloud servers for accuracy and latency; voice
audio and limited application/text context are processed in real time, while
dictation history stays local unless sync is enabled. Its published material
does not expose the ASR model, chunk protocol, scheduler, server fleet, or
measured latency distribution.

Learn from:

- hold-to-talk and immediate state feedback;
- mixed-language behavior, personal dictionary and context-aware correction;
- separation of temporary audio processing from local history;
- explicit zero-retention and no-training controls;
- system-wide insertion UX rather than a transcript-only demo.

Do not infer:

- that its transcription runs on the endpoint;
- that Jiko needs an LLM rewrite in the live path;
- that a cloud service will retain its speed under Jiko's network, region,
  language mix or privacy constraints;
- that app/screen context is acceptable for a decision instrument.

Jiko's equivalent of "Typeless enhancement" is therefore a narrow, versioned
semantic view plus an optional local dictionary. It is not a fluent rewrite of
what the person said.

### On-device implementation references

Two Apple-focused projects are not Pi runtime dependencies, but they expose
engineering patterns worth copying:

- [WhisperKit](https://github.com/argmaxinc/WhisperKit) separates confirmed and
  unconfirmed streaming segments, supports model prewarming, VAD, device-aware
  compute selection, fallback decoding and reproducible model conversion/
  evaluation through
  [whisperkittools](https://github.com/argmaxinc/whisperkittools). Its current
  release also uses bounded incremental file loading instead of decoding an
  entire long input into memory.
- [FluidAudio](https://github.com/FluidInference/FluidAudio) publishes separate
  batch, sliding-window and cache-aware streaming paths, explicit chunk-latency
  tiers, graph/precision compatibility notes, model artifact validation and
  resumable downloads. Its Core ML and Apple Neural Engine results do not
  transfer to CM5, but its receipts and failure notes are a better reference
  than a single "real-time" number.

The useful pattern is not Core ML itself. It is: expose chunk size and context,
prewarm deliberately, bound buffers, distinguish tentative/stable text, verify
artifacts before caching, publish cold and warm measurements, and keep
per-device compatibility exceptions explicit.

### OpenVoiceStream: borrow admission and receipts, not its accelerator stack

[Seeed OpenVoiceStream at `a8cddf31ff7b`](https://github.com/Seeed-Solution/openvoicestream/tree/a8cddf31ff7bf227ffbcbc121e8b922a1f3a885d)
is a useful 2026 hardware/software reference because it keeps one streaming API
while selecting quantized native backends per Jetson, Rockchip, Hailo, or CPU
profile. It is not evidence that those backends fit Jiko's CM5 envelope.

The parts worth adapting are operational:

- its [process-wide limiter](https://github.com/Seeed-Solution/openvoicestream/blob/a8cddf31ff7bf227ffbcbc121e8b922a1f3a885d/server/core/session_limiter.py)
  rejects rather than building an invisible latency queue, clamps requested
  concurrency to backend capacity, uses idempotent release tokens, reports
  active/limit state, and tests early-error slot release;
- its [streaming gates](https://github.com/Seeed-Solution/openvoicestream/blob/a8cddf31ff7bf227ffbcbc121e8b922a1f3a885d/BENCHMARKS.md)
  test concurrent zh/en isolation, excess-session rejection, partial-to-final
  behavior, and concurrent output parity with solo execution;
- its benchmark method labels ASR finalize latency as audio-end to final and
  discloses that a separate VAD wait is excluded. Jiko should copy that metric
  honesty while measuring both boundaries, not copy the published number;
- its [cancel/finalize tests](https://github.com/Seeed-Solution/openvoicestream/blob/a8cddf31ff7bf227ffbcbc121e8b922a1f3a885d/tests/test_asr_cancel_and_finalize.py)
  require cancellation to avoid heavy inference and subsequent audio to be a
  no-op. Jiko additionally suppresses the cached partial: a cancelled attempt
  may not become a product final.

The relevant design rule is `admit or reject explicitly`, then prove every
reservation is released on success, timeout, cancellation, disconnect, and
startup failure. A single-session product still needs this because browser,
device, benchmark, and recovery traffic can otherwise overlap inside one
process.

## The Three Product Lines

The project has three algorithms, not three votes produced from the same model.

### Content

Input:

- provider-faithful transcript;
- semantic transcript plus exact transform version;
- detected language boundaries when the provider actually exposes them;
- calibrated provider confidence only when a frozen calibration receipt exists.

Current control: bounded lexicon plus local negation scope and abstention.

First learned challenger: a small supervised fastText classifier with character
n-grams and post-training quantization. It is allowed to replace the control
only after label definition, annotator agreement, calibration, robustness, and
error slices beat the transparent baseline. `multilingual-e5-small` plus a tiny
head remains a later challenger; its extra footprint needs a measured gain.

Large ASR or language models may mine disagreements and propose hard examples.
They may not supply production labels, become a hidden fourth line, or teach the
system which of `maintain`, `deviate`, or `static` is "correct" without human
adjudication.

### Voice

Input:

- normalized PCM and calibrated microphone profile;
- speech regions, RMS/peak/clipping/noise;
- pitch and delivery variability where the estimator is valid.

The first upgrade is better capture and VAD, not an emotion model. Benchmark
Silero VAD behind the existing feature contract. TEN VAD may be a research
comparison only; its additional competitive-use restriction blocks an assumed
production dependency pending legal review. A learned delivery classifier
requires consented labels and language/device slices; it must never claim
mental state.

### Timing

Input:

- source-monotonic press, first captured frame, first speech, last speech,
  release and durable-commit timestamps;
- VAD gaps and queue/drop counters.

There is no learned model by default. Network arrival time, remote STT latency,
and UI animation duration are system measurements, not evidence about the
speaker.

## Transcript Rules: Faithful First, Semantic Second

The backend keeps provider output in `transcript.text`. A versioned semantic
view may apply only listed transforms. The current policy is deliberately
smaller than a dictation product such as Typeless:

| Operation | Default | Reason |
| --- | --- | --- |
| Unicode canonical normalization | semantic view only | make equivalent text stable without changing the receipt |
| full-width letter/number folding | semantic view only | make zh/en rules robust while preserving CJK punctuation |
| provider control-tag removal | semantic view only | tags are not spoken content |
| zero-width format removal | semantic view only | avoid invisible token-boundary changes |
| typographic apostrophe folding | semantic view only | keep English negation rules stable |
| bounded filler removal | semantic view only | content may ignore a leading filler while voice/timing retain its audio evidence |
| punctuation insertion/removal | preserve provider output | punctuation is inferred and cannot be treated as user intent |
| inverse text normalization | off unless separately versioned | dates/numbers can change meaning; never overwrite faithful text |
| repetition/self-correction rewrite | off | hesitation and correction are product evidence |
| generative rewrite or completion | forbidden | fluency is not fidelity |

Additional rules:

- Do not truncate a long transcript into an apparently valid intention. When a
  measured product range is established, out-of-range content abstains while
  voice/timing can remain available.
- Run content tests with punctuation removed, punctuation changed, straight and
  curly apostrophes, full-width forms, code-switch boundaries, repeated words,
  and local negation.
- Hotwords and context prompts may contain proper nouns and product vocabulary.
  They must not contain decision-bearing cue words such as "quit", "stay",
  `辞职`, or `留下`, because that would bias the reading before classification.
- Provider confidence is telemetry until calibrated on the frozen corpus. A
  vendor-specific scalar is not a portable probability.
- Remote "text polishing" remains off. If later evaluated, every transform is
  diffed against the faithful view and tested for negation/modality preservation.

## Runtime And Scheduling

The target flow is streaming capture even when the selected model later
finalizes in batch:

```text
button down
  -> immediate local visual state
  -> fixed-format PCM ring
  -> [VAD/features] || [warm streaming STT]
button up
  -> close source stream
  -> provider finalize inside remaining deadline
  -> semantic view + three separately computed readings
  -> durable result receipt
  -> staged lamps -> fixed local clip -> silence
```

Priority remains:

```text
P0 cancel/reset/input acknowledgement
P1 capture ring/VAD/drop accounting
P2 STT and acoustic feature work
P3 readings/result commit
P4 observer, playback and receipt export
P5 benchmark, teacher models and cache maintenance
```

Rules:

- Capture cannot wait behind inference, the observer UI, receipt formatting or
  remote network work.
- Normalize/resample once. Local candidates consume the same PCM frames and
  remote candidates consume an explicitly authorized copy of that stream.
- Each candidate has its own deadline and circuit state. A remote timeout cannot
  extend the session deadline.
- Interim transcripts are hypotheses. Only finalized, attempt-current output
  can enter the content reading.
- Cancellation/reset wins over late local or remote completion.
- A local failure yields an explicit partial/insufficient result unless the
  active session policy already authorized a named remote fallback.
- Manual text continues through the canonical event protocol and is marked
  simulated; it never enters ASR quality denominators.

The current browser default now emits ordered PCM while held: 20 ms worklet
frames, roughly 80 ms transport chunks, source-monotonic time, sequence,
profile/hash, bounded retention, loss evidence, and cumulative process-spool
acknowledgements. It still cannot prove first-partial latency because STT begins
after stop, nor first-phoneme safety on a physical microphone. The Pi edge,
pre-roll, provider fan-out, reconnect/resume, and restart-recoverable ownership
remain the next protocol/runtime increment.

## Remote Audio Policy

Paid remote ASR is useful because a maintained service may beat a small local
model on both latency and accuracy. It is still a different trust boundary.

Remote audio requires all of these:

1. the written project approval defined in
   [Remote Audio Policy](remote-audio-policy.md);
2. a build/runtime capability flag;
3. an explicitly named provider, model snapshot, region and HTTPS endpoint;
4. per-session user/operator consent;
5. model-improvement/training opt-out where the provider exposes it;
6. a remaining latency budget and a closed circuit breaker;
7. a receipt declaring `remote`, provider/model/version/region, mode, bytes,
   timing, retry count, request identifier and final outcome;
8. no provider key in the browser, receipt, logs or repository.

Local-to-remote failover is never implicit. Benchmark and production profiles
are separate, so a benchmark can compare a remote challenger without changing
the instrument's behavior. Deepgram documents `mip_opt_out=true`; opted-out
requests are retained only as needed to process them. That control is required,
not assumed. Alibaba endpoints are region-specific, so region is part of the
identity rather than an operational footnote.

Remote streaming measurement must split:

- capture-to-first-send;
- send queue and network RTT;
- first interim hypothesis;
- first stable/final segment;
- end-of-speech to utterance final;
- total release-to-result;
- bytes, retries, 429/5xx, reconnects and cost.

Batch and streaming numbers cannot share one latency column.

## Optimization Ladder

Optimization proceeds from evidence to specialization:

1. **Remove avoidable work** — persistent process, one normalization, bounded
   queues, no duplicate model loads, no transcript/audio cache.
2. **Tune the selected runtime** — thread count/affinity, arena and prepacking,
   static shapes where possible, provider graph optimizations, ORT-format model
   and reduced-operator build.
3. **Quantize with a quality receipt** — compare FP32/FP16/int8/int4 per corpus
   slice; record model hash, calibration manifest and operator assignment.
4. **Use an existing optimized backend** — ORT CPU/XNNPACK, ggml, Arm Compute
   Library or upstream KleidiAI kernels before maintaining local assembly.
5. **Fuse/copy-eliminate at boundaries** — PCM conversion, feature framing,
   tensor layout, I/O binding and tokenizer/decoder buffers.
6. **Write a custom operator only after profiling** — require a stable hotspot,
   a reference implementation, differential tests, per-target dispatch and an
   end-to-end win after packing/copy overhead.

[ONNX Runtime's quantization guide](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html)
explicitly warns that quantization can reduce accuracy or performance and
provides activation/weight comparison tooling. Dynamic quantization generally
fits RNN/transformer models; static calibration often fits CNNs, but Jiko will
measure both when a model supports them. An optimized file is not accepted when
only its byte size improved.

Useful existing levers:

- [ONNX Runtime tuning](https://onnxruntime.ai/docs/performance/tune-performance/):
  profiling, thread management, memory and I/O binding;
- [ORT format and reduced operator configuration](https://onnxruntime.ai/docs/performance/model-optimizations/ort-format-models.html):
  smaller target runtime after the winning graph is frozen;
- [XNNPACK execution provider](https://onnxruntime.ai/docs/execution-providers/Xnnpack-ExecutionProvider.html):
  evaluate graph coverage on ARM rather than assuming speedup;
- [Arm Compute Library](https://github.com/ARM-software/ComputeLibrary):
  NEON/OpenCL primitives and workload tuning;
- [Arm KleidiAI](https://github.com/ARM-software/kleidiai): existing int8/int4
  matmul/GEMV micro-kernels and packing patterns.

KleidiAI includes SME/SME2 variants, but a CM5/Pi 5 Cortex-A76 cannot benefit
from kernels for architectural features it does not implement. On that target,
NEON/dot-product-capable upstream kernels and memory movement are the relevant
area. A hand-written SME2 kernel would optimize a different future board.

Candidate local handwritten work, only after a profile:

- fused 16 kHz PCM framing plus log-mel/filterbank;
- ring-buffer/VAD scan with NEON and no per-frame allocation;
- layout/packing bridge for a dominant int8 GEMM not covered upstream;
- decoder/token post-processing that is demonstrably on the critical path.

Do not start with a custom attention kernel, a new inference framework, or
platform assembly simply because those changes look "low level".

## Compute And Board Direction

| Platform | Decision now | What would change it |
| --- | --- | --- |
| laptop Apple Silicon/x86 | development shell, corpus reference and teacher-model host | nothing; it remains one supported shell |
| Pi 5 -> CM5 CPU | current hardware/productization path | fails frozen corpus latency/RSS/thermal gates with the best CPU runtime |
| Pi AI HAT+ Hailo-8/8L | do not select for ASR | full chosen speech graph compiles with high operator coverage and beats CPU after transfers |
| Pi AI HAT+ 2 / Hailo-10H | conversion spike only | exact ASR graph support, reproducible toolchain, accuracy parity, power/thermal/BOM win |
| QCS6490 SOM | strongest post-CM5 product-board alternate | QNN/Hexagon compiles the winning graph; BSP, audio, display, OTA and production supply pass together |
| RK3588 SOM | secondary cost/performance probe | pinned RKNN conversion/operator coverage and a credible long-lived BSP/supply path |
| ESP32-S3/P4 class MCU | control, physical mute, power/audio front-end or bounded command grammar | never promoted to open-ended bilingual ASR without measured evidence |
| custom carrier around CM5/SOM | after EVT signal/audio/thermal proof | proceed when connector, codec, mic, display and power topology are stable |
| custom compute board | not before a SOM-based DVT need is proven | volume, BOM, size or power justifies owning DDR/high-speed/BSP/manufacturing risk |

Raspberry Pi's current
[AI HAT documentation](https://www.raspberrypi.com/documentation/accessories/ai-hat-plus.html)
describes Hailo-8/8L as INT8 accelerators and AI HAT+ 2 as a Hailo-10H device
with 8 GB on-board memory. Those specifications do not prove ASR graph support.
Likewise, [QCS6490](https://www.qualcomm.com/internet-of-things/products/q6-series/qcs6490)
advertises an 8-core CPU, Hexagon AI engine, up to 12 dense TOPS, multiple OSes
and a long product lifecycle; the selection gate is still the compiled Jiko
graph and whole-device engineering cost, not TOPS.

## Cache And Storage Rules

Allowed:

- loaded model weights in a supervised warm process;
- OS page cache and provider-compiled graph cache keyed by runtime, hardware,
  model/config hash and software image;
- prepacked immutable weights when the runtime validates their identity;
- fixed TTS clips and their provenance manifest;
- aggregate benchmark metrics and transcript hashes.

Forbidden by default:

- raw-audio response caches;
- transcript-content caches;
- API response bodies in debug logs;
- reusing a compiled accelerator artifact across an unverified driver/runtime
  tuple;
- treating an OS page-cache warm run as a cold-start result.

## Human And System Budgets

These are alpha hypotheses, not claims that the current build meets them.
The first target-hardware baseline may revise them, but it must not silently
weaken them.

| Surface | Provisional p95 budget | Measurement boundary |
| --- | ---: | --- |
| button/click visual acknowledgement | 100 ms | source input to first painted state |
| capture-first-frame process handoff | 100 ms | mic frame to source ring/current-process spool acknowledgement; future restart-safe WAL gets a separate `host_wal_durable` metric |
| visible processing state after release | 100 ms | source release to first painted processing state |
| first stable streaming transcript segment | 800 ms | spoken segment end to stable provider segment |
| terminal result commit | 2.5 s | source release to the authoritative current-process `session.result` commit |
| all three staged lamps locked | 3.4 s | source release including the current 0/450/900 ms ritual |
| TTS start when a directional clip exists | 3.6 s | source release to first audible sample |

The 4-second session deadline remains a safety ceiling, not a desired latency.
Every wait longer than 100 ms needs visible causal feedback; no spinner may hide
an unbounded provider call. Google's RAIL guidance uses 100 ms for an immediate
input response and notes that attention degrades beyond roughly one second.
Jiko's staged ritual may intentionally last longer, but only after the hardware
has acknowledged the person and shown continued progress.

## Benchmark Additions

The existing STT runner measures normalized WAV-to-final transcript. Add a
separate streaming receipt version rather than stretching that number:

- source frame size and cadence;
- first accepted frame, first speech, first interim, first stable and final;
- partial revision count and finalization delay;
- first/last phoneme loss;
- CER/WER/mixed-token error and intent-keyword/negation preservation;
- punctuation-off and ITN-off paired cases;
- silence/noise hallucination;
- cold/warm model load, peak RSS, CPU, energy, temperature and throttle state;
- graph/operator assignment and accelerator fallback-to-CPU count;
- WAN RTT/loss/reconnect/429/5xx/cost for remote candidates;
- model/runtime/config/corpus/audio-profile hashes.

Required adversarial slices include:

- `不想辞职`, `不是不想走`, "I don't want to stay", curly apostrophes and
  punctuation removal;
- Chinese/English switching inside one clause;
- quiet first consonants, plosives, soft Mandarin initial syllables;
- leading filler, mid-sentence hesitation, repetition and self-correction;
- zero speech, speech-like background and music;
- long input outside the intended one-intention product range;
- remote disconnect after upload, duplicate final, late final after reset and
  model-version drift.

## Staged Implementation

### P0 — contracts and honest controls

- keep the faithful/semantic transcript split and explicit transform list;
- record strict local artifact identity and remote service identity;
- add explicit remote capability plus per-session consent; never auto-enable;
- finish same-corpus local runner and host software soak;
- keep fixed TTS clips.

### P1 — first streaming proof

- extend the implemented browser ordered-PCM slice to Pi capture and a
  restart-recoverable bounded ownership ring;
- add bilingual streaming Zipformer behind the provider-neutral contract;
- measure first-partial/final/onset loss on laptop, then Pi 5/CM5;
- compare current SenseVoice, Zipformer, Moonshine and whisper.cpp on the same
  frozen corpus.

### P2 — selected-runtime tuning

- freeze the winner and its license/artifact manifest;
- tune threads, allocation, graph, quantization and reduced runtime;
- profile target CPU before any custom operator;
- calibrate microphone/VAD in the enclosure and run 8/24/72-hour gates.

### P3 — board and accelerator fork

- remain on CM5 when CPU gates pass;
- otherwise run time-boxed Hailo-10H, QCS6490 and RK3588 conversion spikes;
- select on whole-device receipts: quality, latency, memory, power, thermal,
  BSP/update/recovery, BOM and supply;
- design a carrier before considering a custom compute board.

## Explicit Non-Decisions

- No final STT winner exists until target measurements exist.
- No NPU has been selected.
- No published vendor benchmark is a Jiko benchmark.
- No teacher model is an oracle or a production fallback.
- No API is allowed to receive audio by merely setting a provider key.
- No dynamic TTS model is needed for the bounded seven-line product.
- No hand-written kernel is justified by model size or profiler-free intuition.
- No arbitrary maximum transcript length is silently enforced before the human
  one-intention range is measured and documented.
