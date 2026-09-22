# Measured local STT benchmark

This directory provides a strict, transcript-free `stt_benchmark_v1` runner for
the three adapters already used by the server:

- sherpa-onnx SenseVoice through the process-wide persistent worker;
- whisper.cpp through its local CLI;
- a self-hosted FunASR-compatible HTTP endpoint on loopback only.

Every configured candidate receives the same verified WAV cases and iteration
matrix. The runner never downloads a model or corpus and never selects a paid
or remote provider. Generated receipts go under ignored
`artifacts/benchmarks/stt-benchmark-v1/`.

## Evidence boundary

The measured scope is **normalized mono 16 kHz PCM WAV to transcript**. It does
not include microphone capture, VAD/features, product orchestration, readings,
TTS, playback, or UI, and it does not yet isolate a comparable cold-start
phase. It currently records quality, wall latency, and real-time factor; peak
RSS, CPU time, temperature, throttling, power, and model initialization remain
future phases in the benchmark plan.

Wall latency brackets the existing `transcribeLocalAudio` call. SenseVoice
worker readiness/model load happens before measured calls; whisper.cpp starts
its configured CLI (and therefore normally loads its model) per call; FunASR
service startup happens outside the runner. Warmup results are discarded, but
these lifecycle differences remain part of each production adapter and must be
shown when candidates are compared. Candidates run sequentially in config
order, so rotate order or reboot between decision-grade runs until a randomized
schedule and explicit cold-start phase exist.

A host or target run with at least one completed candidate can report
`host_measured` or `target_measured`. It still reports verdict
`not_evaluated`: release thresholds intentionally remain unlocked until a
consented corpus and target baseline exist. Missing corpus, missing settings,
or any artifact/readiness identity mismatch produces an unavailable candidate
and cannot create measured evidence.

`stt_benchmark_v1` has no threshold-policy artifact field, so its validator
rejects `thresholdsLocked: true` as well as any pass/fail verdict. A future
receipt version must bind the exact policy/version/hash before it can express a
release decision; editing this receipt cannot manufacture one.

## Corpus contract

[`schema/stt-corpus-manifest-v1.schema.json`](schema/stt-corpus-manifest-v1.schema.json)
requires:

- synthetic, licensed, or explicitly consented-internal provenance;
- nonempty mono 16 kHz PCM s16le WAV files beneath the manifest directory;
- exact byte count and SHA-256 for every WAV;
- a unique case ID, language (`zh`, `en`, `code_switch`, or `silence`), reference,
  keywords, and slice labels;
- empty ground truth and no keywords for silence; and at least two language
  runs for a code-switch case.

Audio paths are resolved through `realpath`; absolute paths, `..`, and symlink
escapes are rejected. Do not commit raw recordings or real people’s
transcripts. A manifest containing consented ground truth belongs in the same
access-controlled location as its audio.

Receipts contain the verified audio SHA-256 plus SHA-256 hashes of references
and hypotheses, never their text. Hashes of short or predictable phrases can
still be guessed with a dictionary, so receipts from sensitive corpora must
remain access-controlled.

## Candidate identity

The runner validates candidate settings with
[`schema/stt-benchmark-config-v1.schema.json`](schema/stt-benchmark-config-v1.schema.json)
before loading the server adapter.

- **SenseVoice:** the Python runtime, worker script, model, and tokens require
  frozen byte counts and SHA-256 values. Worker readiness must attest the same
  loaded model/tokens plus runtime and effective language/thread/provider/ITN
  configuration. Every measured call must return the same execution identity.
- **whisper.cpp:** the executable and model are hashed before execution; the
  configuration identity additionally binds language and both hashes. The
  current CLI does not return its own live identity, so this proves which frozen
  paths the adapter invoked, not an independent attestation from inside the
  process.
- **FunASR:** the endpoint must be credential-free HTTP(S) on `localhost`,
  `127.0.0.0/8`, or `::1`; redirects are not followed. A local
  [`stt_provider_identity_v1`](schema/stt-provider-identity-v1.schema.json)
  manifest and every runtime/model artifact it names are hashed. That manifest
  is an operator-controlled association, not cryptographic remote-process
  attestation; keep the service and manifest under the same deployment control.

For FunASR, `configurationId` must be the canonical hash of the model and
language used by the runner (the candidate ID only names the configuration
artifact). It can be calculated without contacting the service:

```sh
node --input-type=module -e 'import { configurationIdentity } from "./benchmarks/stt/identity.mjs"; console.log(configurationIdentity("funasr-self-hosted", { model: "sensevoice", language: "auto" }).configurationId)'
```

Artifact descriptors have this shape:

```json
{
  "path": "/absolute/or/config-relative/model.bin",
  "name": "model.bin",
  "sha256": "64-lowercase-hex-characters",
  "bytes": 123456
}
```

Use `shasum -a 256 /path/to/artifact` and
`wc -c < /path/to/artifact` (or equivalent local tools) to obtain the two
values. The runner recalculates both before execution; labels or filenames are
never accepted as model proof.

Omit `settings` while a candidate is not installed. The checked-in
[`config/host-unconfigured-v1.json`](config/host-unconfigured-v1.json) does
exactly that and therefore always stays `not_evaluated`.

## Metrics

Normalization is pinned as `jiko-stt-text-normalization-v1`: NFKC and lowercase,
with Han characters for Chinese CER, Unicode word tokens for English WER, and
mixed Han/word tokens for code-switch error. Code-switch language-run edit
error, recognizable-content hallucination rate for silence, and exact
normalized keyword-sequence preservation are reported separately. Aggregate
counts are retained beside rates, and receipt validation recomputes every
aggregate from its case records. Latency and RTF p50/p95 use nearest rank.

Provider timeout, unavailable, and failure outcomes remain explicit case
evidence; they are never converted to a successful empty transcript. A run can
therefore be measured while recording failed cases, but it cannot pass an
unlocked release gate.

## Comparison audit

New case receipts preserve the corpus manifest's slice labels. The comparison
command recomputes global and per-slice summaries and reports labelled
right-minus-left deltas for every measured pair. It deliberately returns
`winnerCandidateId: null` and `selectionAllowed: false`.

Receipt validation rejects a comparison unless every measured candidate has the
same per-case audio hash, language, metric, reference hash, duration, reference
units, boundary units, and keyword total for every iteration. The comparison
output carries a canonical receipt hash, source/config/lockfile hashes, a
per-candidate input-matrix hash, and full runtime/configuration/artifact
identity, so a detached JSON audit remains attributable.

Its blockers make the missing decision evidence visible: incomplete candidates,
host-only evidence, dirty source, unlocked policy, absent resource/thermal
metrics, absent grouped paired uncertainty, missing slice labels, and unequal
runtime lifecycle accounting. Older valid v1 receipts without slice labels can
still be inspected, but the audit marks that evidence absent rather than
inventing a grouping. This is a comparison aid, not a ranking function.

## Commands

```sh
# Strict schema-only preflight; never executes a model.
pnpm benchmark:stt:preflight

# Build the existing server adapters, verify corpus/artifact identity, and run.
pnpm benchmark:stt:run -- --config /path/to/stt-config.json

# Validate schema, coverage, identity roles, evidence level, and metric math.
pnpm benchmark:stt:validate artifacts/benchmarks/stt-benchmark-v1/latest.json

# Recompute pairwise and per-slice evidence; never selects a winner.
pnpm benchmark:stt:compare -- artifacts/benchmarks/stt-benchmark-v1/latest.json

# Synthetic adapter-contract tests; no model or recording downloads.
pnpm test:stt-benchmark
```

The integration test launches synthetic local stand-ins for all three adapters
against one generated WAV. It proves routing, identity, metric, and receipt
plumbing; it is not model-quality evidence.
