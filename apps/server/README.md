# jiko local server

Prototype-only local backend loop for the first laptop demo.

This app uses Node's HTTP server plus `ws` for the ordered PCM ingress. It
accepts batch uploads or ordered PCM into the normal event stream, normalizes
them with `ffmpeg`, extracts first-pass audio features, calls the explicitly
configured STT adapter, and emits the same reading/result events as the manual
demo path.
Local/self-hosted STT remains the default. Manual transcripts remain available
as a local rehearsal fallback.

## Run

```sh
npm --prefix apps/server run dev
```

The default port is `4317`. Override it with `PORT=4318`.
The default dev command does not use Node watch mode because hackathon demos
need a stable long-running server. Use `npm --prefix apps/server run dev:watch`
only when active server hot reload is worth the occasional restart.

Receipts are written to `apps/server/sessions/` by default outside production.
The file and `GET /sessions/:sessionId/receipt` use the same strict
`session_receipt_v1` schema; neither is a second, looser debug shape.
The in-memory terminal event commits before its receipt snapshot is written. If
that terminal write fails, the HTTP/WebSocket terminal acknowledgement remains
authoritative and the server does not append a second `session.error` or report
the attempt as superseded. `GET /sessions/:sessionId` then includes a top-level
`receiptPersistenceFailure` warning and the server writes a bounded error log;
this explicitly means disk durability was not proved. A later successful full
snapshot clears the warning.
Receipt snapshots are capped per file, by file count, by aggregate bytes, and
by retention age. Maintenance is serialized across sessions and never deletes
the snapshot that triggered the current prune. This bounds one-process disk
growth; it is not a multi-process lock or a disk-full recovery mechanism.
While a strict creation receipt remains present, a restarted server refuses to
reuse its `sessionId` rather than overwrite that prior attempt. This is retained-
receipt protection, not a durable event replay log: count/age pruning removes
that restart evidence. With receipts disabled, `/health` reports
`sessionIdentityProtection.mode: "process_only"`, and anti-reuse protection
ends when the process exits.
Disable them with:

```sh
JIKO_WRITE_RECEIPTS=0 npm --prefix apps/server run dev
```

## Endpoints

- `GET /health`
- `GET /events?sessionId=<id>`
- `GET /sessions/:sessionId`
- `GET /sessions/:sessionId/receipt`
- `POST /sessions`
- `POST /sessions/:sessionId/input-event`
- `POST /sessions/:sessionId/audio`
- `POST /sessions/:sessionId/manual-transcript`
- `POST /sessions/:sessionId/demo-event`
- `WS /sessions/:sessionId/audio-stream` with subprotocol
  `jiko.ordered-pcm.v1`

`POST /sessions/:sessionId/audio` expects a raw audio body such as `audio/webm`,
`audio/ogg`, `audio/wav`, or `audio/mp4`. Browser/device clients should send
`input.recording.stopped` before the upload. For compatibility, an upload with
`durationMs` still emits that stop event when the session is currently
recording. The route then emits `audio.uploaded`, `audio.normalized`,
`audio.transcribed`, `audio.features.extracted`, three reading events,
`session.result`, and TTS lifecycle events.

Raw audio and normalized working audio stay in the OS temp directory and are
deleted after the request. Receipts store metadata, transcript/provider status,
features, readings, result, and events, but not raw recordings.

### Ordered PCM ingress

The WebSocket endpoint accepts only the versioned binary envelopes from
`@jiko/protocol`. A valid `audio.start` binds the path session to the exact
server-created attempt, verifies the SHA-256 PCM profile identity, atomically
claims the attempt's audio input, and emits the canonical
`input.recording.started` event. Chunk order, source-monotonic time, frame/byte
counts, cumulative loss evidence, stop totals, and an optional source PCM hash
are validated before audio can reach STT.

PCM and a minimal process record are written serially before each `spooled`
acknowledgement. The acknowledgement means both writes completed and the bytes
remain readable by this process; it does **not** mean `fsync`, restart-safe
durability, or ownership transfer. The files are unlinked immediately after
open and retained only by process-owned handles: a clean close, rejection,
timeout, or successful finalization releases them without leaving named raw
audio in the temp directory. A crash loses the attempt; the client must create
a new session rather than replaying acknowledged chunks into the old attempt.

On complete coverage, the server wraps the source-rate `s16le` PCM in WAVE and
hands it to the same canonical batch pipeline used by HTTP upload. Browser
input is explicitly limited to mono 16, 44.1, or 48 kHz, then normalized once
by ffmpeg instead of being naively resampled in the worklet. Unsupported or
resource-amplifying profiles fail before the attempt is claimed. The
`finalized` stop acknowledgement is
sent only after the one canonical `session.result` commits. This first slice
streams capture and transport. The production composition still starts STT
after `audio.stop`, so it is not evidence of incremental model inference.

There is now a default-off, programmatically injected streaming-STT seam for a
future local adapter. It binds every push/partial/final to the ordered-PCM
attempt, bounds queued PCM and transcript output, drains accepted chunks before
the stop flush, enforces the attempt deadline, and accepts exactly one final.
Partials reach only a transient observer callback; they are not stored as
session events and cannot feed readings. Only the coverage-matched final
returned by `finish()` can enter the normal enhancement/readings pipeline.
Partial/final events, asynchronous provider resolutions, and the final commit
each re-check the monotonic deadline synchronously, so an event-loop-delayed
timer cannot admit an overdue transcript.
The fake conformance harness proves those lifecycle rules; it is not a real
Zipformer, Moonshine, FunASR, or provider integration.

The transport fails closed on a sequence/profile/hash mismatch, declared loss,
spool capacity, capture timeout, disconnect before stop, or competing input
claim. Those cases emit one canonical `session.error`, do not run STT, and clean
the process-owned spool. An accepted `audio.stop` snapshots
`input.orderedPcm` coverage evidence while keeping `input.audioStored=false`.
Failures before an accepted stop currently retain the typed session error but
do not invent a complete ingress receipt; partial failure evidence is a named
remaining observability gap.

Relevant bounds and trust settings:

- `JIKO_HTTP_HEADERS_TIMEOUT_MS`, `JIKO_HTTP_REQUEST_TIMEOUT_MS`, and
  `JIKO_HTTP_KEEP_ALIVE_TIMEOUT_MS`: Node transport ceilings; defaults are
  10, 15, and 5 seconds. `JIKO_HTTP_MAX_REQUESTS_PER_SOCKET` defaults to 100.
- `JIKO_HTTP_ALLOWED_ORIGINS`: comma-separated exact browser origins for HTTP
  and SSE. Defaults to localhost and `127.0.0.1` on ports 5173 and 4173. A
  disallowed Origin is rejected before any route side effect. Native/CLI
  clients without an Origin header remain accepted; the default loopback bind,
  not CORS, is their current network boundary.
- `JIKO_SSE_MAX_CONNECTIONS`: process-wide SSE connection cap; defaults to 32.
  A response that first reports stream backpressure is closed immediately
  rather than accumulating an unbounded per-client queue.
- `JIKO_SESSION_MAX_COUNT`: in-memory session cap; defaults to 256. Old terminal
  sessions may be evicted to admit a new one, but live attempts are never
  capacity-evicted. Excess creation returns `503 session_capacity_exceeded`.
- `JIKO_SESSION_IDLE_TTL_MS` and `JIKO_SESSION_TERMINAL_RETENTION_MS`: defaults
  to 10 minutes and one day.
- `JIKO_RECEIPT_MAX_FILES`, `JIKO_RECEIPT_MAX_FILE_BYTES`,
  `JIKO_RECEIPT_MAX_TOTAL_BYTES`, and `JIKO_RECEIPT_RETENTION_MS`: defaults to
  512 files, 1 MiB/file, 64 MiB total, and seven days.
- `JIKO_ORDERED_PCM_ALLOWED_ORIGINS`: comma-separated exact origins. Defaults
  to localhost and `127.0.0.1` on ports 5173 and 4173; there is no wildcard and
  a missing Origin is rejected.
- `JIKO_ORDERED_PCM_MAX_SPOOL_BYTES`: per-attempt PCM cap; defaults to 12 MiB.
- `JIKO_ORDERED_PCM_MAX_WAL_BYTES`: per-attempt metadata cap; defaults to 4 MiB.
- `JIKO_ORDERED_PCM_MAX_CHUNKS`: per-attempt chunk cap; defaults to 12,000.
- `JIKO_ORDERED_PCM_CAPTURE_TIMEOUT_MS`: start-to-stop ceiling; defaults to
  120 seconds. It bounds both wall time and source PCM duration; the effective
  byte ceiling is the lower of the spool cap and
  `sampleRateHz * timeoutSeconds * 2` for the current mono `s16le` profile.
- `JIKO_ORDERED_PCM_START_TIMEOUT_MS`: upgrade-to-`audio.start` ceiling;
  defaults to 10 seconds.
- `JIKO_ORDERED_PCM_MAX_CONNECTIONS`: total accepted ordered-PCM sockets,
  including those waiting for `audio.start`; defaults to 8.
- `JIKO_AUDIO_MAX_INGRESS_BYTES`: process-wide retained audio-ingress budget,
  shared by HTTP request bodies and ordered PCM plus its process WAL; defaults
  to 24 MiB. Each increment is reserved synchronously before a request retains
  it or the spool writes it. Success, rejection, disconnect, and timeout all
  release the owning lease.
- `JIKO_AUDIO_MAX_INGRESS_LEASES`: process-wide concurrent HTTP/ordered-ingress
  lease limit, including requests that have not delivered their first byte;
  defaults to 16. Ordered sockets remain additionally bounded by
  `JIKO_ORDERED_PCM_MAX_CONNECTIONS` (8 by default).
- `JIKO_AUDIO_MAX_PIPELINE_BYTES`: process-wide byte budget for bodies admitted
  to normalization/STT; defaults to 24 MiB. Admission reserves the compressed
  request bytes plus the maximum decoded 16 kHz mono WAV allocation, so a
  small compressed body cannot bypass the memory budget with a decode bomb.
- `JIKO_AUDIO_MAX_PIPELINES`: process-wide concurrent normalization/STT work
  limit; defaults to 1. Capacity is rejected rather than queued behind an
  unknown deadline. HTTP returns `503 audio_pipeline_capacity_exceeded`;
  ordered PCM returns protocol `capacity_exceeded`, while the canonical
  session receipt retains the typed terminal error and an admission-stage
  failure receipt.

All present `JIKO_AUDIO_*` policy values and numeric `JIKO_ORDERED_PCM_*`
policy values must be positive safe integers; an invalid or blank value fails
server construction instead of silently restoring a more permissive default.

`GET /health` reports current/configured ingress and pipeline reservations plus
cumulative byte/slot rejections. A cancelled or timed-out attempt releases its
pipeline lease only when the underlying provider promise actually settles, so
an abort-ignorant adapter cannot make the health counters advertise a free slot
while it is still running.
These counters are atomic within one Node process, not a distributed quota;
running multiple server processes still requires a shared external admission
boundary.

The source server binds to `127.0.0.1` by default. Setting `HOST` to a
non-loopback address does not add authentication: exact browser Origin checks
are CSRF hardening, not client identity. Until attempt capabilities and read/SSE
authorization exist, expose the service only through the controlled local
deployment; do not treat a demo LAN as a production trust boundary.

The ordered PCM protocol has no remote-audio-consent field. Consequently this
endpoint does not opt a capture into the experimental paid Deepgram route; use
local/self-hosted STT, or the separately gated batch-upload comparison.

## Session ownership and replay

`POST /sessions` creates one immutable attempt identity. A client may provide a
safe high-entropy `sessionId`; the first request returns `201`, and an exact
retry from the same source returns the existing session/attempt with `200`
without appending another event or cancelling output. An invalid explicit id
returns `400`, a source collision returns `409`, and a retired in-memory or
retained-receipt identity returns typed `410` instead of creating a new attempt.
The in-memory tombstone ledger is bounded and fails new creation with typed
`503` rather than discarding a still-live retry identity.

Recording start/stop retries have a narrower in-process replay rule: an exact
match on source and local `monotonicMs` returns the original event; stop also
requires the same `durationMs`. A changed or keyless duplicate remains a `409`.
This does not make the transport exactly once: audio upload and `session.error`
do not yet share an operation id, and no replay/outbox state survives restart.
Browser/device capture failures may send a validated `session.error` through the
same input-event route so an empty recording reaches an explicit terminal state.

Operator demo events use that same protocol path, but their optional `payload`
is allowlisted by event type: only `monotonicMs`, relevant `durationMs`, and the
typed `session.error` fields are accepted. A demo payload cannot set
`sessionId`, `attemptId`, `sequence`, `timestamp`, `type`, or `source`; the emit
boundary writes those authoritative fields after all caller data.

Every stored session event carries that `sessionId`, the server-created
`attemptId`, and a contiguous server-assigned `sequence`; the SSE event id is
`attemptId:sequence`.

Participant and observer clients should subscribe to
`/events?sessionId=<id>`. That stream replays and forwards only the requested
session. On reconnect, `Last-Event-ID: <attemptId>:<sequence>` replays only the
later retained events for the same attempt. The unscoped `/events` stream still
exists for device discovery and development, but it is not a safe source for an
already selected participant turn.

One attempt can claim exactly one input path: `audio` or `manual`. A competing
claim receives `409`, and the attempt can publish only one final
`session.result`. Manual fallback therefore uses the same event protocol as
audio without racing it into a second conclusion.

This replay buffer is currently in process memory. Session count and age plus
open SSE connections are bounded, and a slow stream is closed on backpressure.
Events are not persisted as a resumable log, however: a server restart cannot
resume an old cursor or produce a retention-gap snapshot. Those are deployment
blockers, not properties proved by the current SSE tests.

## Result visibility and local output

The server stores and publishes `session.result` before scheduling local TTS.
The output task is not awaited by the request path, so the HTTP result can
return independently. `TTS_AFTER_RESULT_DELAY_MS` controls that background
pacing; a slow or delayed speaker does not hold the result response open.

The local output scheduler owns one playback slot. A newer output supersedes the
previous one, and a new session, new recording, reset, error, or server shutdown
cancels active output. Abort signals reach local clip playback and Piper
processes. Scheduler and process tests cover this control path; cancellation on
the actual target speaker/Piper installation has not yet been proved.

Audio attempts now have a separate reset-wins cancellation registry. A committed
reset/error aborts ffmpeg, Whisper/Sherpa processes, and FunASR HTTP waits; both
cooperative and noncooperative late pipeline completions are sealed with `409`
instead of appending a late error/result. Same-session receipt snapshots commit
in order, so a slow old write cannot overwrite reset on disk. Synchronous DSP
can only observe cancellation at stage boundaries, and multi-process receipt
writers remain unsupported.

The server also owns one monotonic logical deadline per audio attempt. The first
committed `input.recording.stopped` event starts it; direct audio uploads use
request acceptance as a compatibility anchor, and neither path can extend an
existing deadline. STT receives an earlier soft cutoff so a timed-out text line
can still produce an honest partial result from measured voice/timing evidence.
The hard expiry commits `session.error` with code
`analysis_deadline_exceeded` before cancelling attempt work. Result, reset, and
error commits synchronously disarm the timer.

This is now paired with a process-wide byte/work admission bound. The same
non-extendable attempt deadline aborts a request body that keeps the upload open,
and the server also has header/request transport ceilings. It is not a distinct
per-chunk idle timeout or a multi-process quota. Synchronous DSP can delay the
timer until the event loop is released; a monotonic commit-boundary check rejects
that late result, but it cannot make feedback appear while the event loop is
blocked. Abort-ignorant asynchronous providers are detached from the HTTP
request while retaining their admission lease until their explicit resource
settlement finishes; they still need process/worker supervision. Those limits
remain explicit until worker-isolated DSP and distributed admission exist.

## Speech providers

`GET /health` reports diagnostics for `ffmpeg`, STT, and TTS. It does not run a
transcription or speech synthesis. For sherpa-onnx it starts or observes the
same persistent worker used by sessions and reports `ready` only after the
recognizer is loaded and the model/token SHA-256 identities are available.
Other provider checks remain lightweight reachability/configuration checks.
The optional Deepgram check reports `disabled`, `missing`, or `configured`; it
does not call Deepgram and never returns the API key.

The top-level `ok: true` is service liveness, not proof that speech execution is
ready. Consumers that require strict operational readiness must require
`diagnostics.strictReady === true`; its `strictBlocking` list includes every
runtime/provider whose diagnostic status is `configured`, `disabled`, or
`missing`. In particular, a syntactically accepted FunASR endpoint and an
existing Piper voice file remain `configured`, not `ready`, because health does
not perform a real transcription or synthesis. Strict deployments must reject
that state instead of treating configuration as an execution proof.

The ffmpeg health probe has a one-second deadline, retains at most 64 KiB from
each of stdout and stderr, and uses a one-second single-flight cache. Concurrent
health requests therefore share one probe, while the short cache still lets
operators observe a changed runtime promptly.

- `FFMPEG_BIN`: defaults to `ffmpeg`.
- `AUDIO_NORMALIZE_TIMEOUT_MS`: hard deadline for one local normalization
  process; defaults to 15 seconds and is recorded as `timed_out` when exceeded.
- `STT_TIMEOUT_MS`: hard deadline shared by local CLI, self-hosted HTTP, and the
  optional remote batch STT adapter; defaults to 15 seconds. This is a prototype
  safety ceiling, not the product response-time target.
- `SESSION_DEADLINE_MS`: hard logical ceiling for one audio attempt; defaults to
  4 seconds. The clock is server-monotonic and does not use client timestamps.
- `SESSION_RESULT_COMMIT_RESERVE_MS`: time reserved before the hard deadline for
  feature completion, reading composition, event commits, and receipt work;
  defaults to 750 ms. The effective STT budget is the smaller of the remaining
  pre-reserve time and `STT_TIMEOUT_MS`.
- `STT_PROVIDER=funasr` with `FUNASR_ENDPOINT`: posts the normalized WAV to a
  local/self-hosted FunASR-compatible HTTP endpoint. Diagnostics and receipt
  provider ids label numeric IP literals only: IPv4 `127.0.0.0/8` or RFC1918,
  and IPv6 `::1` or the true `fc00::/7` unique-local range. `localhost`, every
  other DNS name, public/link-local IPs, and redirects are rejected before
  reading audio; this adapter is not a hidden paid-cloud path.
- `STT_PROVIDER=deepgram` selects an optional HTTPS pre-recorded/batch
  challenger retained for mock tests and future approved experiments. Its
  technical gates are not policy authorization. It sends no audio unless
  `JIKO_ALLOW_REMOTE_AUDIO=1` and the same
  upload explicitly supplies `x-jiko-remote-audio-consent: deepgram` or
  `?remoteAudioConsent=deepgram`. The checked-in browser supplies neither by
  default. `DEEPGRAM_API_KEY` stays server-side; `DEEPGRAM_ENDPOINT` defaults
  to `https://api.deepgram.com/v1/listen`; model/language default to `nova-3`
  and `multi`. `DEEPGRAM_VERSION` is required and `latest` is rejected so a
  challenger run starts from a pinned selector; the receipt also records the
  resolved response version. The adapter forces `mip_opt_out=true`, refuses
  redirects, is batch-only, records remote request/model provenance, and never
  silently retries through a local provider.
  Deepgram is the first strict reference implementation of this remote adapter
  boundary, not the only provider the architecture may ever support. A future
  Doubao/Volcengine or other API challenger must implement the same named
  consent, policy, provenance, redirect, and failure contracts; none is
  implemented here, and this batch adapter does not claim streaming latency.
- `STT_PROVIDER=whisper.cpp` with `WHISPER_CPP_BIN` and `WHISPER_MODEL`: runs a
  local whisper.cpp CLI.
- `STT_PROVIDER=sherpa-onnx` with `SHERPA_ONNX_SENSEVOICE_MODEL` and
  `SHERPA_ONNX_SENSEVOICE_TOKENS`: runs a local sherpa-onnx SenseVoice model
  through the NDJSON worker at
  `apps/server/scripts/sherpa-sensevoice-worker.py`. The recognizer is loaded
  once per worker process and reused across requests. Override the script with
  `SHERPA_ONNX_WORKER_SCRIPT`, the cold readiness ceiling with
  `SHERPA_ONNX_STARTUP_TIMEOUT_MS`, and the bounded pending-request count with
  `SHERPA_ONNX_MAX_PENDING_REQUESTS` (default `1`). An active request abort or
  deadline terminates the worker; the next request/readiness check reloads it.
  Once loaded readiness admits a call, its runtime/configuration and full
  model/token SHA-256 plus byte counts are copied into `providers.stt.execution`
  in the canonical receipt. Failures before readiness do not invent identity
  from these environment paths.
- If no local STT is configured, the text layer receives an empty transcript
  with provider `local:stt-unconfigured:unavailable` and failure code
  `provider_unavailable`; voice and timing features still come from real audio.
- STT failures are classified as `provider_unavailable`, `timed_out`, or
  `failed`. They never become a fabricated text confidence or a normal
  `static` content vote.
- `TTS_PROVIDER=clip` with `TTS_CLIP_DIR`: looks for a pre-generated local clip
  by `tts.clipKey`, such as `minority.maintain.wav` or
  `consensus.static.wav`.
- Generate local rehearsal clips with
  `pnpm --filter @jiko/server generate:clips -- --voice Tingting`.
  The generator defaults to macOS `say`; set `TTS_GENERATE_COMMAND=piper` for
  Piper, or `TTS_GENERATE_COMMAND=copy TTS_GENERATE_EXTENSION=txt` for a dry run.
- Set `TTS_PLAY_AUDIO=1` to let the server play a found clip with
  `TTS_PLAY_COMMAND` or the platform default (`afplay` on macOS, `aplay` on Pi).
  When playback is disabled, the server records clip readiness in the receipt.
- `TTS_PROVIDER=piper` with `PIPER_BIN` and `PIPER_VOICE`: runs Piper locally.
  If no voice is configured, the server records that in the TTS provider receipt
  and keeps the result flow moving.

## Quick check

```sh
curl http://localhost:4317/health
curl -X POST http://localhost:4317/sessions
curl -N 'http://localhost:4317/events?sessionId=<id>' \
  -H 'Last-Event-ID: <attemptId>:<sequence>'
curl -X POST 'http://localhost:4317/sessions/<id>/audio?durationMs=1800' \
  -H 'content-type: audio/webm' \
  --data-binary '@sample.webm'
curl http://localhost:4317/sessions/<id>/receipt
curl -X POST http://localhost:4317/sessions/<id>/manual-transcript \
  -H 'content-type: application/json' \
  -d '{"transcript":"我在考虑辞职，但还想先把这件事说清楚。","language":"zh"}'
```

Only after the written [`Remote Audio Policy`](../../docs/remote-audio-policy.md)
approval, a controlled Deepgram batch comparison configures the three
server-side variables (`STT_PROVIDER=deepgram`, `JIKO_ALLOW_REMOTE_AUDIO=1`,
and `DEEPGRAM_API_KEY`) and opts in that one upload explicitly:

```sh
curl -X POST 'http://localhost:4317/sessions/<id>/audio?durationMs=1800' \
  -H 'content-type: audio/wav' \
  -H 'x-jiko-remote-audio-consent: deepgram' \
  --data-binary '@synthetic-or-consented-sample.wav'
```

This is not an instruction to use unconsented speech. See
[`docs/data-handling.md`](../../docs/data-handling.md) for the trust and
retention boundary.
