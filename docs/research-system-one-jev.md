# System One Models / Jev Research

Status: **research decision; do not add Jev to the live runtime yet**

Research date: **2026-09-17 (Asia/Shanghai)**

Scope: TypeSafe AI's launch article, official documentation, public repositories,
legal terms, published evaluations, and the strongest directly useful open
comparators found by this date.

## Decision In One Page

Jev is a hosted, text-only decision API. A request supplies text/JSON state and
closed questions; the response supplies typed answers and probabilities instead
of generated prose. That is a useful systems pattern for Jiko, but the public
evidence does **not** support treating Jev as an open edge model or as a new
independent signal line.

| Decision | Verdict | Reason |
| --- | --- | --- |
| Adopt the interface pattern | **Yes, now** | Closed answer domains, explicit uncertainty, small question-isolated judgments, deterministic code composition, and versioned receipts all strengthen Jiko's existing contracts. |
| Run a local content-classifier spike | **Yes, first** | fastText/SetFit and the Jev-like open projects can test the pattern without network, transcript disclosure, or vendor lock-in. |
| Evaluate the hosted Jev API | **Conditional internal comparator only** | Use only synthetic/licensed fixtures and only after written approval covers benchmarking, volume, and output use. Pin the version and keep it outside the live scheduler. |
| Make Jev Jiko's content default | **No** | It is paid, hosted, non-offline, and not reproducible on target hardware; its own documented weak spots include literal negation, indirection, distractors, and adversarial text. |
| Make Jev a fourth light or replace delivery/timing | **Reject** | It consumes the same transcript evidence as the content line, accepts no audio, and cannot replace observable DSP or monotonic event logic without double-counting evidence. |
| Port Jev kernels or weights to the edge | **Not possible from public artifacts** | No Jev weights, inference implementation, model architecture, quantization recipe, or edge measurements were found in TypeSafe's public material. |

The useful product lesson is therefore:

> Adopt bounded probabilistic decisions as an interface; benchmark local
> implementations first; keep hosted Jev, if evaluated at all, as an isolated
> content-only comparator.

## What Is Publicly Verifiable

### Product surface

The official [System One documentation](https://docs.typesafe.ai/concepts/system-one)
describes one request containing a shared state plus multiple questions:

- `Noul`: a binary proposition returning `P(true)`;
- `Choice`: one of a declared set, with a probability distribution and a
  derived confidence value;
- `Score`: an ordered rubric, with per-level probabilities, a
  probability-weighted score, and derived confidence.

The model accepts strings, JSON objects, and arrays of text. It does not accept
audio, images, or video. The launch article says `Choice` supports up to 255
choices and uses a two-stage path at high cardinality. All questions see the
same state; TypeSafe says they are evaluated in parallel and independently.
That is a vendor claim about question isolation inside one request, not proof of
statistical independence and not permission to count several answers as
separate Jiko signals.

The current [models page](https://docs.typesafe.ai/models) lists:

| Field | Public value on 2026-09-17 |
| --- | --- |
| Version | `jev-1.13.0` |
| Aliases | `jev-latest` and `jev-preview`, both then resolving to `jev-1.13.0` |
| Price | $42/B input tokens, or $0.042/M input tokens; output tokens unmetered |
| Published rate limits | 250,000 tokens/s and 1,200 requests/min; documented as dynamic and changeable without notice |
| Endpoint | hosted `POST https://api.typesafe.ai/v1/systemone` |
| Context limits | 64k tokens across state and all questions; 32k for state plus the longest question |
| Self-hosted/offline path | none published |

Aliases can move. Any research receipt must request `jev-1.13.0` and record the
version returned by the response, rather than silently depending on
`jev-latest`.

### What the launch claims, and what it actually establishes

| Claim | Evidence boundary | Jiko interpretation |
| --- | --- | --- |
| “Can't hallucinate” | The answer must conform to a predeclared type/domain. The blog explicitly says its 0% schema-error point is guaranteed rather than empirically measured. | Read as **zero invalid-domain/type outputs**, not zero wrong meanings. A perfectly typed wrong label remains wrong. |
| “Calibrated probabilities” | TypeSafe names a private training method, RLCD, but publishes no algorithm, training recipe, reliability diagrams, or third-party calibration study. Official docs also say calibration over groups does not make an individual answer correct. | Measure NLL, Brier score, ECE/reliability, and selective risk on Jiko's own held-out corpus. |
| `confidence` | Official docs say it is a statistic derived from how concentrated the returned probability distribution is; the formula is not public. `Noul` has no separate confidence field. | Peakedness is not proof of empirical calibration. Do not gate the product on this field before local validation. |
| Parallel decisions | The API returns many typed answers in one call, and the vendor reports weak latency growth with more questions. The inference architecture and kernels are not public. | The batching shape is valuable. The hardware mechanism and its speedup are not available to port. |
| 70–500 ms, 40–200x faster | Vendor measurements; the blog says published runs were generally from West Coast laptops close to the service and that its short, dense demo favors Jev. | Treat as hosted round-trip evidence in one geography, not device inference or a global p95 guarantee. |
| “Similar frontier intelligence” | Workflow scores use large models as the reference, not independently labeled truth. | This is model-consensus agreement on TypeSafe-authored workflows, not proof on Jiko content semantics. |
| 193.6x faster / 444.6x cheaper | The blog says these are the high end of observed workflow gains. | Do not generalize the maximum ratio to every model, payload, or region. |

“Output tokens are free” is a pricing rule, not evidence that the output path has
zero compute cost.

### Officially documented weak spots

The official [Jev 1.13 jaggedness
page](https://docs.typesafe.ai/model-jaggedness/jev-1.13) is more useful than the
marketing page for integration decisions. It says the model:

- reads instructions literally and can mishandle scoping, negation, and implied
  conditions;
- is unreliable at counting, numeric precision, numeric representation, date
  ordering, and time arithmetic;
- loses accuracy with multiple layers of indirection;
- suffers when the state contains large amounts of irrelevant detail;
- does not treat input state as hostile by default, so prompt-like adversarial
  content can move the answer;
- can be confused by contradictory question and criteria wording;
- is not a text generator.

These are directly relevant to Jiko. Negation, ambivalence, code-switching,
STT corruption, and distractor text already belong in the frozen content
corpus. Jev cannot bypass those slices merely because its response always
parses.

## Benchmark Audit

### TypeSafe workflow evaluations

The public [workflow evaluation site](https://evals.typesafe.ai/) reports four
workflows. The figures below are TypeSafe's published figures, not measurements
made in this repository.

| Workflow | Reported cases | Jev reported accuracy | Cost/case | Time/case |
| --- | ---: | ---: | ---: | ---: |
| Security incidents | 240 | 61.7% | $0.0001 | 0.3 s |
| Agent trace observability | 117 | 71.6% | $0.0003 | 0.5 s |
| Invoice processing | 150 | 61.8% | $0.0011 | 0.5 s |
| Customer service | 204 | 76.0% | $0.0001 | 0.4 s |
| Equal-weight mean shown by site | 711 total | 67.8% | $0.0004 | 0.4 s |

Useful context from the same chart:

- Terra workflow: 67.9%, $0.0304/case, 10.1 s/case;
- Sol workflow: 74.1%, $0.0836/case, 23.3 s/case;
- Opus 5 workflow: 73.1%, $0.1761/case, 37.8 s/case;
- Sonnet 5 workflow: 67.8%, $0.1174/case, 78.1 s/case.

This supports a narrow conclusion: on the vendor's workload, Jev is on the
cost/latency Pareto frontier and approximately matches some much slower
workflow configurations. It is not the highest-accuracy point.

The evaluation does **not** establish an independently reproducible quality
result:

1. The reference is the mean prediction of GPT-6 Astra and Claude Fable 5.1 at
   high reasoning, not a human-labeled or factual ground truth.
2. The workflows were made by TypeSafe's model-capabilities team; the blog
   acknowledges possible authoring bias.
3. The public `*-cases.js` artifacts inspected on 2026-09-17 contain five
   highlighted examples per workflow while reporting 711 total cases. The full
   corpus, complete raw predictions, executable generator/harness, metric
   implementation, and seeds were not found in the public site.
4. Model weights, serving build, hardware, and inference runtime are not
   published. The selected artifacts use an internal-looking model identifier,
   so they do not provide a standalone `jev-1.13.0` reproduction receipt.
5. The study evaluates agreement/accuracy, cost, and wall time; it does not
   publish Jiko-relevant calibration curves, target-device memory, energy,
   thermal behavior, or offline failure behavior.

### Self-consistency evidence

TypeSafe's [Noul self-consistency
cookbook](https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook) is a
small but useful counterweight to deterministic-sounding language:

- one insurance claim, 14 binary questions, 15 calls on 2026-09-11;
- all 15 `jev-latest` calls returned `jev-1.13.0`;
- mean per-question probability standard deviation was reported as 0.0102;
- one `covered` probability ranged from 0.43 to 0.53, crossing a 0.5 decision
  threshold;
- mean hosted round-trip time was 111 ms for that run;
- every repetition inserted a fresh irrelevant `uid`, so the experiment cannot
  separate nondeterminism from sensitivity to the irrelevant field. The
  cookbook explicitly acknowledges this confound.

The operational lesson is to use an abstention/review band and to test exact
repeat, irrelevant-field, question-order, and question-set perturbations
separately. A single hard threshold is brittle even when average variance is
small.

## Openness, License, Privacy, And Reproducibility

### Public artifacts found

TypeSafe's [GitHub organization](https://github.com/typesafe-ai) showed ten
public repositories on the research date. Relevant ones are:

- [JavaScript SDK](https://github.com/typesafe-ai/typesafe-sdk-js), MIT;
- [Python SDK](https://github.com/typesafe-ai/typesafe-sdk-python), MIT;
- [System One Adapter](https://github.com/typesafe-ai/system-one-adapter-python),
  MIT, which maps the same interface onto OpenAI-, Anthropic-, or
  OpenAI-compatible model APIs;
- [agent skills](https://github.com/typesafe-ai/skills), MIT.

The organization also carries forks such as LLaDA and vLLM. A fork is not
evidence that Jev uses that architecture. No official Jev model repository,
weights, conventional model card, technical paper, parameter count, tokenizer,
training corpus, RLCD recipe, serving container, quantization path, or ARM edge
benchmark was found in the official public materials inspected for this report.

The SDKs being MIT does **not** license the Jev model or make the service
self-hostable.

### Service terms

The [Master Customer
Agreement](https://typesafe.ai/legal/mca) describes a TypeSafe-hosted service
under a limited, non-transferable service/API license. It prohibits, among
other things:

- distilling or training a model to imitate service output;
- reverse-engineering underlying ideas, algorithms, structure, or data;
- developing a similar or competing service from the service/output;
- publishing benchmarks or performance information about the service;
- bypassing access controls, performing security/vulnerability tests, or
  exceeding usage limits.

It also permits service updates that may affect API compatibility, provides the
service “as is” and “as available,” and does not warrant uninterrupted or
error-free use. No public service-level agreement was found. Because Jiko is
also evaluating local alternatives, using Jev output as an oracle, label source,
or local-model improvement loop creates additional competing-product risk. Any
API study needs legal confirmation or written TypeSafe permission that names
the benchmarking purpose, permitted volume, fault-testing scope, publication,
and output use. Keep results clean-room isolated from local training,
calibration, labeling, prompt engineering, and candidate selection. Do not
intentionally trigger live rate limits or security tests. This is an
engineering risk note, not legal advice.

The [privacy policy](https://typesafe.ai/legal/privacy-policy) says TypeSafe
collects service inputs, including prompts/data/instructions, and may share them
with service providers. It says inputs are not used to train or fine-tune model
weights, but also says the service is hosted in the United States and personal
data may be retained as long as reasonably necessary for service or business
purposes. The [DPA](https://typesafe.ai/legal/data-processing) frames the customer
as controller and TypeSafe as processor; its schedule lists sensitive-data
safeguards as `N/A`. Those are useful commitments, but they do not turn a
hosted request into local processing.

Jev cannot receive raw audio, so a Jiko integration would send a transcript
rather than a recording. A transcript derived from a real person's speech is
still sensitive. Sending it to a paid hosted API would break the current
offline behavior gate and the intent of the local-first privacy design unless
the team explicitly changes policy and completes data-classification,
cross-border-transfer, retention, subprocessor, consent, and legal review. The
current spike therefore uses synthetic/licensed fixtures only; “sanitized” is
not treated as synonymous with non-personal.

### Reproducibility and edge-readiness matrix

| Property | Jev status | Consequence for Jiko |
| --- | --- | --- |
| Weights / inference code | Not public | Cannot reproduce or audit inference locally. |
| Model/training specification | Only high-level “new architecture,” parallel sampler, and RLCD descriptions | Cannot validate causal claims or rebuild the training path. |
| Offline/self-hosted | No public route | Fails Jiko's offline default gate. |
| ARM64 / Pi / CM5 build | None published | No basis for a target-device claim. |
| Quantization | No artifact or recipe published | Model size, accuracy delta, and edge memory are unknown. |
| Model bytes / peak RSS / energy / thermal | Not published | Hosted wall time cannot substitute for device measurements. |
| Version stability | Version IDs exist; aliases move | Pin exact version and store returned model ID. |
| Availability commitment | Terms say “as is”/“as available”; no public SLA found | A hosted default has an unbounded dependency the product cannot repair locally. |
| Cancellation | SDK exposes `AbortSignal` | Useful, but cancellation still has to obey Jiko's session deadline. |
| Retry deadline | SDK timeout is per attempt; docs say there is no total retry budget; default is 10 s | Disable retries or bind them to a Jiko-owned remaining budget. |
| Debug logging | SDK debug mode includes unredacted bodies | Keep production logging at `warn`; emit Jiko receipts without transcript content. |
| Independent reproduction | Low | Vendor results can motivate a spike, not select a default. |

## Four Executable Comparators

These are not claimed to be equivalent in intelligence. They isolate which part
of the Jev value proposition is useful and testable.

| Comparator | What it proves or tests | License/runtime | Edge relevance | Main caveat |
| --- | --- | --- | --- | --- |
| [System One Adapter](https://github.com/typesafe-ai/system-one-adapter-python) | The typed `Noul`/`Choice`/`Score` workflow can be separated from the proprietary model and run against LLM or OpenAI-compatible endpoints. It is the closest protocol-level control. | MIT Python; hosted providers or a custom compatible endpoint | Useful for harness compatibility, not itself an edge model | Autoregressive generation, malformed-output retries, and model-authored probabilities do not become calibrated merely through normalization. |
| [OpenJev](https://github.com/TheoLeeCJ/openjev) | A direct-logit, runtime-option pattern with shared-state prefix reuse. Its committed RTX 3090/Qwen3.5-4B BF16 example reports 21 probability pairs in 1.023 s versus 5.332 s for a compact generated array, and up to 20.03 decisions/s on a 37×21 fixture. | MIT project code; Python/CUDA; upstream Qwen terms also apply | Good GPU systems reference; not a Pi path | Independent project, only three commits at inspection, 4B BF16 GPU footprint, no live Jev parity. Experimental BF16 reuse changed 5–6/777 argmaxes, so speed paths need equivalence tests. |
| [fastText](https://github.com/facebookresearch/fastText) | A small supervised, probability-producing fixed-label classifier with documented model quantization. This is the strongest first control for Jiko's fixed `maintain/deviate/static` ontology. | MIT, C++11/Python; repository is archived/read-only | Strong: small CPU runtime and quantized artifacts are compatible with edge measurement | Needs a labeled Jiko corpus and post-hoc calibration; bag/subword features may miss nested negation and discourse. |
| [SetFit](https://github.com/huggingface/setfit) and its [paper](https://arxiv.org/abs/2209.11055) | Prompt-free few-shot classification using a sentence-transformer plus a classification head; tests whether semantic embeddings beat fastText with limited labels. | Apache-2.0 framework; backbone license must be checked separately | Plausible laptop/ONNX challenger; Pi status must be measured | Heavier model/session, export and quantization work, and no inherent probability calibration guarantee. |

One more early project is worth watching, not selecting:
[Jevlike](https://github.com/vinnylarouge/jevlike) is an MIT trainable
option-attention head with CPU, Apple MPS, and CUDA paths and an optional frozen
Qwen2.5-0.5B encoder. It reports ECE in its evaluator and documents honest
controls, but its published numbers are local research examples, it had only
three commits at inspection, and it explicitly does not reproduce Jev or show
Jev-level quality. It is useful for learning the dynamic-option head, not for a
product dependency decision.

For the narrow type-safety claim, [XGrammar](https://github.com/mlc-ai/xgrammar)
and [JSONSchemaBench](https://github.com/guidance-ai/jsonschemabench) are useful
controls: constrained decoding can guarantee structural validity for ordinary
generative models. This reinforces that schema correctness is a runtime/interface
property; it is not evidence of semantic correctness or calibration.

## Mapping To Jiko's Three Lines

```text
audio ── local STT ── faithful transcript ── local content provider
  │                                           └─ Reading(channel: "text")
  ├─ local DSP / VAD / level / pitch ─────────── Reading(channel: "voice")
  └─ local monotonic input + speech events ───── Reading(channel: "timing")

three Reading values ── deterministic Jiko coverage/composition ── result

P5 frozen synthetic/licensed corpus ── hosted Jev comparator
                                      └─ research receipt only; no product state
```

### Content line: the only plausible Jev location

Conceptually, Jev could consume text after STT and return a bounded content
decision. The proposed hosted spike will not receive session transcripts; this
mapping describes the adapter boundary being tested with synthetic/licensed
fixtures. A `Choice` should include `maintain`, `deviate`, `static`, and one
explicit `insufficient_evidence` option so out-of-domain text is not forced into
a directional vote.

The adapter must map that fourth option into the existing protocol rather than
inventing a fourth product state. Until the core has a distinct semantic
abstention state, an `insufficient_evidence` response remains research-receipt
data and **must not emit a product `Reading`**. Mapping it to `state: "static"`
with `availability: "measured"` would be incorrect: the current core counts
every non-unavailable reading, so the supposed abstention would change the
majority. A future live adapter therefore requires an explicit protocol/core
abstention semantic (or another composition-excluded vote) plus coverage tests
before integration. Provider failure uses the repository's current placeholder shape:
`channel: "text"`, `state: "static"`, `confidence: 0`,
`availability: "unavailable"`, plus `providerFailure: true`, and a `readings`
stage with `unavailable`, `timed_out`, or `failed` status. The core excludes
every unavailable reading from majority/state calculation, so the placeholder
state and confidence are schema fillers, not a vote or confidence claim.
Semantic insufficiency and provider failure must never be conflated.

Question decomposition may help debugging—for example, separate propositions
for maintaining, deviating, contradiction, and insufficient context, followed
by Jiko-owned code. These propositions are still outputs from the same model and
same transcript. They are not independent evidence and must not be counted as
extra lights.

The current keyword/negation implementation remains the control. A local
learned challenger wins only on the same frozen corpus and slices. Any
permitted Jev measurement is reported separately and cannot drive local
candidate training or selection.

### Delivery line: do not use Jev

Jev accepts no audio. Serializing RMS, pauses, pitch, or clipping into prose and
asking a language model what they “mean” would add network latency and an
unverifiable opinion after deterministic measurements already exist. It would
also collapse the independence between observed delivery and text semantics.
Keep the DSP path and its observable-language contract.

### Timing line: do not use Jev

Button-down, speech onset, pauses, button-up, continuation, and cancellation
are ordered numeric events. Jev's own documentation says arithmetic/date/time
comparisons belong in code. The current monotonic handwritten state machine is
cheaper, deterministic, inspectable, and works offline.

### Composition: borrow the discipline, not the authority

Jiko's core continues to own coverage, disagreement, partial-result, and
insufficient-evidence behavior. A model's `static` label is not interchangeable
with an unavailable/failed content stage. Model confidence must not override
missing delivery/timing evidence or turn three aligned lamps into permission.

## Scheduler, Cache, And Operator Implications

### Scheduler

Hosted Jev does not belong in P3, which produces readings and the immutable
product result. If approved, run it only as a P5 benchmark job over a frozen
synthetic/licensed corpus, after or separately from live work:

1. Any P0–P4 live work preempts or pauses P5. Run the hosted job only while the
   live system is idle or its CPU/GPU/network resources are isolated.
2. The P5 job never receives a session transcript and never writes a product
   `Reading`, coverage value, availability value, or result.
3. Give each benchmark request one attempt, a benchmark-owned hard total
   deadline, and an `AbortSignal`; do not inherit the SDK's 10-second
   per-attempt default or unbounded retry behavior.
4. A late response may be recorded as a timed-out research case, but it cannot
   mutate product state.
5. Exercise DNS loss, disconnect, 429, timeout, and cancellation with a mock
   transport or fault-injection proxy. Do not intentionally induce live rate
   limits or security behavior. Naturally observed service failures remain
   research-receipt data only.

### Cache and receipts

Separate runtime cache from benchmark evidence:

- Runtime cache keeps only immutable question schemas and harmless transport
  metadata. It never keeps raw audio or transcript content.
- The access-controlled benchmark artifact needs per-case reproducibility:
  opaque fixture ID, input/label manifest hashes, question/schema hash,
  requested and returned model IDs, complete probability vector, status,
  latency scope, code revision, configuration, and dependency-lock hash.
  Synthetic/licensed fixtures may be resolved through their manifest. A bare
  hash of real-person text is not anonymization; local consented corpora use an
  opaque ID or keyed HMAC and remain outside Git.

Do not use Jev outputs as training, calibration, labeling, distillation, prompt
engineering, or selection data for local candidates. The service contract
expressly forbids imitation/distillation and creates broader competing-product
risk; any other output use requires the written authorization described above.

For local challengers, keep the encoder/session/tokenizer/calibrator warm and
key caches by model artifact hash, runtime, execution provider, thread count,
quantization, and feature-schema version, following the existing cache policy.

### Handwritten operators

There is no public Jev kernel to borrow. The transferable hypotheses are:

- score a bounded option set directly instead of generating answer prose;
- reuse a shared state representation across several questions;
- batch decomposed question heads where equivalence is proven, without calling
  them statistically independent evidence;
- keep deterministic arithmetic and composition outside the model.

Only optimize a local softmax, tokenizer, prefix cache, or DSP loop after the
profiler identifies it as hot. Every prefix-reuse or reduced-precision path
needs an argmax/probability equivalence fixture; OpenJev's reported BF16 drift
is a concrete warning.

## Edge Benchmark Contract

Jev belongs in a `remote-hosted-reference` lane, not an `edge-inference` lane.
For it, report separately:

- client serialization and queue time;
- network connect/TLS/transfer time where observable;
- service wait/inference as reported, if exposed;
- response parse/validation;
- total round-trip p50/p95/max by deployment geography;
- 429/timeout/cancel/offline behavior;
- requested/returned model version and payload token count.

Do **not** attribute Jev round-trip time to Pi/CM5 inference, and do not fill in
unknown model bytes, RSS, CPU, energy, or thermal values.

Local fastText/SetFit/Jev-like candidates must follow the normal Jiko receipt:
cold/warm p50 and p95, peak RSS, model/disk bytes, CPU, temperature/throttling,
energy when available, quality/calibration by slice, and network-absent boot and
session behavior with the kiosk active.

## Falsifiable Hypotheses

| ID | Hypothesis | Test | Pass signal |
| --- | --- | --- | --- |
| H1 | Typed output eliminates parser/domain failures but not semantic failures. | Run adversarial and ordinary content cases; count schema failures separately from label errors. | Schema failures may be zero; semantic errors and quality metrics are reported separately and honestly. |
| H2 | A local fastText or SetFit challenger improves content quality over the lexicon without breaking the device envelope. | Same frozen train/validation/test split; report macro F1, per-class precision/recall, negation, ambivalence, code-switch, STT-corruption, cold/warm p95, RSS, and thermal. | It deliberately beats/trades against the control and passes existing target-hardware selection gates. |
| H3 | Decomposed atomic questions are more robust than one monolithic decision. | Compare a single 3-way head with fixed atomic propositions plus deterministic composition on identical folds. | Better worst-slice quality or calibration without unacceptable latency/memory cost. |
| H4 | Returned probabilities support safer abstention after local calibration. | Fit temperature/isotonic calibration on validation only; report NLL, Brier, ECE/reliability, coverage-risk, and held-out abstention error. | Calibrated selective risk improves over raw confidence and hard argmax; thresholds remain action-specific. |
| H5 | The vendor-claimed question isolation is stable to harmless request changes. | Exact repeats, question-order permutations, irrelevant fields, and unrelated extra questions, each isolated. | Changes remain inside a preregistered tolerance and do not flip product actions outside the abstention band; this still does not make answers independent evidence. |
| H6 | Shared-state/direct-option scoring saves work without changing decisions. | Compare fresh scoring, prefix reuse, parallel heads, and quantized paths with fixed hashes. | Speed/memory win plus equivalence on logits/argmax within declared tolerance. |
| H7 | A hosted dependency cannot satisfy the live Jiko offline contract. | Use mock 429, DNS, disconnect, cancel, and no-network fixtures. Any live characterization stays within a written, approved plan and normal limits. | Product behavior remains correct offline; Jev remains an isolated internal comparator, never an oracle or default. |

No hypothesis may be tested by sending real-user transcripts to an unapproved
service, and no Jev benchmark may be published without resolving the agreement's
publication restriction.

## Minimum Integration Spike

### Stage 0 — local, interface-shaped, no cloud dependency

Build the smallest provider-neutral research harness around the content line.
Its question/benchmark types stay internal; the product adapter returns the
existing `Reading` and `PipelineStageReceipt` shapes:

```ts
type DecisionQuestion =
  | { type: "noul"; instruction: string }
  | { type: "choice"; instruction: string; options: Record<string, string> }
  | { type: "score"; instruction: string; levels: string[] };

type BenchmarkDecisionReceiptBase = {
  fixtureId: string;
  inputManifestHash: string;
  labelManifestHash: string;
  questionSchemaHash: string;
  benchmarkLane: "local-edge" | "remote-hosted-reference";
  latencyScope: "local-inference" | "client-round-trip";
  configurationHash: string;
  provider: string;
  requestedModel: string;
  modelArtifactHash?: string; // required for a local model; unavailable for hosted Jev
  latencyMs: number;
  codeRevision: string;
  dependencyLockHash: string;
  environment: {
    hardwareId: string;
    architecture: string;
    operatingSystem: string;
    runtime: string;
    runtimeVersion: string;
    executionProvider?: string;
    threadCount?: number;
    quantization?: string;
    coldStart: boolean;
    kioskActive: boolean;
  };
  peakRssBytes?: number;
  temperatureC?: number;
  throttled?: boolean;
  energyMilliJoules?: number;
};

type BenchmarkDecisionReceipt =
  | (BenchmarkDecisionReceiptBase & {
      status: "ready" | "degraded";
      returnedModel: string;
      probabilities: Record<string, number>;
    })
  | (BenchmarkDecisionReceiptBase & {
      status: "unavailable" | "timed_out" | "failed";
      returnedModel?: string; // only when a response identified it
      probabilities?: Record<string, number>; // only when a response supplied it
    });

// Product boundary: existing @jiko/protocol shape, not a new API.
type TextReading = Reading & { channel: "text" };
type ReadingStage = PipelineStageReceipt & { stage: "readings" };
```

Use only synthetic/licensed text in Git and the access-controlled consented
corpus outside Git. Compare:

1. current lexicon/negation control;
2. quantized fastText;
3. SetFit with a small multilingual backbone if fastText misses semantic cases;
4. optionally, Jevlike/OpenJev patterns off-device to test dynamic options and
   shared-state scoring, not as presumed Pi candidates.

Reuse the content labels and existing `Reading(channel: "text")` protocol; do
not add a parallel product API. Shared-state batching remains a spike hypothesis
until equivalence and scheduling measurements pass. Measure the quality,
calibration, stability, and target-hardware receipt described above.

### Stage 1 — optional hosted Jev, internal-only

Proceed only after an explicit project-policy decision, privacy review, contract
review, and written authorization for the intended benchmarking, volume,
fault-testing scope, publication, and output use:

- use synthetic/licensed fixtures only, never raw audio or real-person text;
- pin `jev-1.13.0` and store the returned version;
- include `insufficient_evidence` in the answer domain and apply the explicit
  existing-protocol mapping above;
- keep SDK logging at `warn`; never log request bodies;
- use one attempt, a benchmark-owned abort signal, and a hard total deadline;
- use mocks for 429/network/cancel fault cases rather than probing the live
  service;
- store the per-case reproducibility receipt above in an access-controlled
  benchmark artifact;
- compare against the exact same frozen manifest and local controls;
- keep Jev results clean-room isolated from local candidate development;
- run as a P5 research job, outside Jiko's composition and product state.

### Stage 2 — selection review, not automatic promotion

Only a passing local challenger can be considered for the product default under
the existing selection gates. Hosted Jev cannot pass the current offline gate;
changing that gate is a product/policy decision, not an engineering shortcut.

## Adopt / Spike / Reject Gates

### Adopt now

- typed closed domains with explicit `insufficient_evidence` and a declared
  mapping into the existing three-state/availability protocol;
- full probability vectors where the provider genuinely supplies them;
- atomic questions plus deterministic code-owned composition;
- version/model/schema receipts and exact pinning;
- empirical calibration and action-specific abstention thresholds.

### Spike entry gates

- The experiment is content-line-only and cannot affect delivery/timing.
- Corpus source, split policy, required slices, metrics, and artifact schema are
  frozen before fitting or API calls.
- The lexicon control and at least one local/offline candidate can run on the
  same cases.
- Any hosted Jev test uses synthetic/licensed fixtures, has written
  policy/privacy/legal approval for its exact purpose and output use, and stays
  internal unless publication rights are explicit.
- Hosted output is clean-room isolated from local training, calibration,
  labeling, prompt engineering, and model selection.
- Shared-state batching, quantization, and prefix reuse are treated as
  hypotheses requiring equivalence tests, not pre-adopted optimizations.

### Promotion / spike exit gates

- A local candidate has complete target-device cold/warm p50/p95, RSS, model
  bytes, thermal, failure, soak, recovery, and offline receipts.
- Quality and calibration pass the frozen overall and worst-slice comparisons.
- Cancellation, timeout, and version drift map through the existing stage and
  availability values without a fabricated vote.
- Runtime/model/data licenses permit the proposed product distribution.
- The same `Reading` and event protocol works in both runtime shells.

### Reject a candidate or integration if any apply

- it fails to beat or deliberately justify a trade against the current control
  on macro F1 and the negation, ambivalence, code-switch, and STT-corruption
  slices;
- calibration or coverage-risk is worse than a simpler baseline;
- target-hardware warmed p95, memory, thermal, soak, or recovery gates fail;
- model/runtime/data licenses are missing or non-redistributable when the
  candidate is proposed for product deployment; a lawful internal comparator
  is judged under its own terms instead;
- it cannot install and boot offline when proposed as a product default;
- it uses network/server arrival as the timing line, text as the delivery line,
  or multiple questions from one model as independent votes;
- it conflates `unavailable` with `static`, or confidence with correctness;
- it relies on a moving alias, retries beyond the session deadline, logs
  transcript bodies, or caches real-person audio/transcripts;
- it uses Jev output to train, calibrate, label, prompt-engineer, or select a
  local candidate, distills from it, or publishes Jev performance without
  resolved contractual permission;
- it deliberately triggers live 429/security behavior rather than using a
  mock, or assumes an SLA the service does not publish;
- it claims edge speed, memory, quantization, or energy from hosted API latency.

Under today's project rules, these gates produce a clear outcome: **adopt the
System One interface ideas, run a local content spike, keep Jev as an optional
clean-room comparator, and reject Jev as a live/default Jiko dependency.**

## Primary Sources

All web sources below were accessed on **2026-09-17**.

### TypeSafe

- Launch article: https://typesafe.ai/blog/introducing-system-one-models-and-jev
- Documentation index: https://docs.typesafe.ai/llms.txt
- System One concepts: https://docs.typesafe.ai/concepts/system-one
- RLCD/decision-model primer: https://docs.typesafe.ai/introduction/machine-learning-primer
- Models, versions, price, and limits: https://docs.typesafe.ai/models
- Jev 1.13 known limitations: https://docs.typesafe.ai/model-jaggedness/jev-1.13
- Confidence semantics: https://docs.typesafe.ai/confidence
- HTTP API: https://docs.typesafe.ai/api
- JavaScript client configuration: https://docs.typesafe.ai/sdk/javascript/api/interfaces/TypeSafeClientConfig
- Per-request timeout/cancel semantics: https://docs.typesafe.ai/sdk/javascript/api/interfaces/RequestOptions
- Noul self-consistency cookbook: https://docs.typesafe.ai/cookbooks/consistency_noul_cookbook
- Workflow evaluations: https://evals.typesafe.ai/
- Official GitHub organization: https://github.com/typesafe-ai
- Official JS SDK: https://github.com/typesafe-ai/typesafe-sdk-js
- Official Python SDK: https://github.com/typesafe-ai/typesafe-sdk-python
- Official System One Adapter: https://github.com/typesafe-ai/system-one-adapter-python
- Master Customer Agreement: https://typesafe.ai/legal/mca
- Privacy policy: https://typesafe.ai/legal/privacy-policy
- Data Processing Addendum: https://typesafe.ai/legal/data-processing

### Open comparators

- OpenJev: https://github.com/TheoLeeCJ/openjev
- Jevlike: https://github.com/vinnylarouge/jevlike
- fastText: https://github.com/facebookresearch/fastText
- fastText supervised tutorial: https://fasttext.cc/docs/en/supervised-tutorial.html
- SetFit: https://github.com/huggingface/setfit
- SetFit paper: https://arxiv.org/abs/2209.11055
- XGrammar: https://github.com/mlc-ai/xgrammar
- JSONSchemaBench code: https://github.com/guidance-ai/jsonschemabench
- JSONSchemaBench paper: https://arxiv.org/abs/2501.10868

### Jiko decision contracts

- [Algorithm evaluation and scheduling](./algorithm-evaluation.md)
- [Benchmark plan](./benchmark-plan.md)
- [Instrument runtime design](./instrument-runtime-design.md)
- [Engineering discipline](./engineering-discipline.md)
