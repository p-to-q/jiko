# Benchmarks

This directory starts with one deliberately narrow suite:

- `cases.json` pins the current reading-engine and coverage/fallback contract.
- `harness.mjs` warms the shared core, checks every repeated output for
  determinism, and writes p50/p95/max timing plus a reproducibility receipt
  under ignored `artifacts/benchmarks/`.
- `pnpm benchmark` builds the workspace before running the suite.

The current score is a **structural contract proxy**. It proves that the same
inputs still resolve to the declared text, voice, and timing states, and that
missing lines produce the declared partial/insufficient result without
directional TTS. Its timings cover only a warmed in-process shared-core call;
they do not include capture, STT, process startup, I/O, UI, or playback. It does
not prove STT accuracy, psychological validity, acoustic robustness, Raspberry
Pi latency, thermal stability, or user value.

Version 4 adds adversarial content fixtures for unequal ambivalent cues,
English keyword boundaries (`exchange` is not `change`; `forgo` is not `go`),
and repeated instances of the same cue with opposed polarity. These cases make
the lexical control more conservative; they are not evidence that it
understands unrestricted language.

`hardware/` contains a separate, versioned `hardware_hil_v1` receipt contract
and a metadata-only host-simulation runner. The runner proves schema, semantic,
and artifact-integrity plumbing; it always records `dut.present=false`,
qualification profile `none`, and verdict `not_evaluated`. It is not a board
test and cannot pass a hardware gate. See
[`hardware/README.md`](hardware/README.md).

`soak/` contains a separate `host_soak_v1` harness. It launches the real Node
HTTP server, exercises manual and generated-WAV turns through HTTP/SSE, checks
duplicate-final rejection and endpoint/disk receipt agreement, and records
latency and server RSS drift. Per-turn provider labels distinguish manual,
disabled, local, remote-batch, and other remote execution without qualifying
any provider path. Its schema explicitly prevents those observations
from becoming hardware, physical-audio, STT-quality, thermal, performance-gate,
or release evidence. The default is six turns; `JIKO_SOAK_TURNS` can raise the
discovery campaign to 10,000. See [`soak/README.md`](soak/README.md).

`stt/` contains the `stt_benchmark_v1` measured runner. It verifies one frozen
mono 16 kHz PCM corpus, then sends every case through the existing local
SenseVoice, whisper.cpp, and loopback-only FunASR adapters. Its receipt binds
CER/WER, code-switch, silence, keyword, latency, and RTF results to corpus,
runtime, model, and configuration hashes without storing transcript text.
Missing corpus/model evidence remains `not_evaluated`; a measured host run is
still not a release pass while thresholds are unlocked. See
[`stt/README.md`](stt/README.md).

The default is 100 warmup and 1000 measured iterations per case. Local
diagnostics may override them with `JIKO_BENCH_WARMUP_ITERATIONS` and
`JIKO_BENCH_ITERATIONS`; receipts always record the effective values.

Do not promote this directory to a separate repository until the input corpus,
receipt schema, hardware profiles, and release gate have survived real device
runs. The full benchmark program is defined in
[`docs/benchmark-plan.md`](../docs/benchmark-plan.md).
