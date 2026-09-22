# Host software soak

`host-harness.mjs` starts the built Jiko Node server as a separate process and
drives it only through localhost HTTP and SSE. It produces a versioned
`host_soak_v1` receipt under ignored
`artifacts/benchmarks/host-soak-v1/<run-id>/receipt.json`.

The default six-turn run is deliberately short enough for CI. It alternates
fixed synthetic manual text with two in-memory generated PCM WAV turns. Audio
turns use the real create, recording-start, recording-stop, upload, ffmpeg,
event, result, and receipt paths, but disable STT and speaker playback. Every
turn also retries session creation, attempts a second final-producing
submission, observes live SSE, and verifies the canonical live and on-disk
session receipts. Selected turns reconnect with an SSE cursor to check replay.

Provider reporting is provenance, not a provider benchmark. Each case records
the route observed in its canonical receipt as `manual`, `disabled`, `local`,
`remote_batch`, `remote`, or `not_observed`, together with the provider ID and
STT outcome when available. The default harness clears provider configuration,
so an executed local or remote route is a boundary failure. It never sends the
generated WAV to a cloud API. Use the dedicated STT benchmark (and explicit
consent/policy for any API fixture) to evaluate either local inference or a
remote batch service.

Run and validate it with:

```sh
pnpm benchmark:soak
pnpm benchmark:soak:validate -- artifacts/benchmarks/host-soak-v1/latest.json
```

Configuration is explicit and recorded in every receipt:

| Variable | Default | Meaning |
| --- | ---: | --- |
| `JIKO_SOAK_TURNS` | `6` | Planned turns; valid range is 1–10,000. |
| `JIKO_SOAK_AUDIO_EVERY` | `3` | Every Nth turn uses generated WAV; `0` is manual-only. |
| `JIKO_SOAK_REPLAY_EVERY` | `3` | Every Nth turn probes scoped SSE replay; `0` disables the probe. |
| `JIKO_SOAK_STARTUP_TIMEOUT_MS` | `60000` | Ceiling for process start plus a lightweight localhost HTTP readiness probe. |
| `JIKO_SOAK_TURN_TIMEOUT_MS` | `90000` | Harness ceiling for one complete turn. |
| `JIKO_SOAK_SESSION_DEADLINE_MS` | `60000` | Server analysis deadline used by this campaign. |
| `JIKO_SOAK_RESULT_COMMIT_RESERVE_MS` | `1000` | Server deadline reserve used by this campaign. |
| `JIKO_SOAK_RSS_SAMPLE_EVERY` | about 100 samples/run | Turn interval for host `ps` RSS sampling. |
| `JIKO_SOAK_KEEP_SESSION_RECEIPTS` | `false` | Retain generated per-session receipts instead of removing only this run's files. |

For example, a 10,000-turn discovery run with sparse generated-audio and replay
probes is:

```sh
JIKO_SOAK_TURNS=10000 \
JIKO_SOAK_AUDIO_EVERY=100 \
JIKO_SOAK_REPLAY_EVERY=100 \
pnpm benchmark:soak
```

The host-software integrity verdict requires all planned turns to reach exactly
one result, contiguous canonical sequences, no lost/duplicate/unexpected SSE
events, matching endpoint and disk receipts, successful duplicate-submission
rejection, and no stuck session or server-process failure. Latency drift and
server RSS growth are measured but have no pass/fail threshold yet.

## Evidence boundary

This is not an HIL run. It uses no physical button, microphone, speaker,
consented speech, STT model, power instrument, temperature sensor, or target
board. Generated WAV exercises software codec and feature plumbing only. The
schema therefore forces hardware reliability, physical capture, STT quality,
power, thermal, performance qualification, and release qualification to
`not_evaluated`. A 10,000-turn pass remains a host-software discovery result,
not a production reliability claim. Seeing a `local`, `remote_batch`, or
`remote` provider label in a receipt identifies a route; it does not prove that
route's accuracy, privacy, availability, or latency target.

Per-session server receipts contain only the fixed synthetic stimuli and are
removed by default after verification. The aggregate soak receipt stores no
transcript content or raw-audio artifact. This harness does not audit operating
system temp-audio residue after a crash; that remains a separate fault test.
