# Device Adapter

Prototype Raspberry Pi 5 hardware adapters live here. Keep this layer thin:
translate hardware input into the shared jiko event protocol, and leave audio,
STT, TTS, readings, and UI behavior to the existing runtime paths.

## Pi ALSA Ordered-PCM Adapter

`pi_audio_adapter.py` is an **experimental, host-tested** native capture edge
for Pi/CM-class Linux devices. It starts `arecord` without a shell, requests
mono s16le PCM, and reads only from the process pipe. It never gives `arecord`
a recording filename and does not retain raw audio on the device.

The adapter uses the same `ordered_pcm_v1` / binary `JPCM` contract as the
browser path:

- one `CLOCK_MONOTONIC` anchor advanced by exact source-frame counts for start,
  chunk, and stop times;
- contiguous chunk sequence numbers and exact frame/byte totals;
- the canonical PCM-profile SHA-256 and a SHA-256 over transmitted PCM;
- cumulative queue-drop, byte/frame-drop, overflow, and ALSA xrun evidence;
- a bounded in-memory capture queue, separate control-ACK/finalization
  deadlines, and SIGINT -> terminate -> kill cleanup under one stop deadline;
- server admission and the existing audio/STT/readings pipeline, rather than a
  second device-only state machine.

After the server confirms session creation, a failure before a valid
`audio.start` ACK posts a typed `session.error` through the canonical
`/input-event` route. A lost HTTP response retries the exact event identity, so
the server can replay it idempotently. If `audio.start` reached the server but
its ACK was lost, closing that WebSocket leaves the owning server path to seal
the attempt; the adapter only treats a claim conflict as sealed after the
response reports terminal `error` state. This is bounded in-process retry, not
a durable audio outbox: a power loss before the event is accepted still
requires supervisor/recovery work.

For a controlled same-host smoke run, start the local server first, then run:

```sh
python3 apps/device/pi_audio_adapter.py \
  --alsa-device default \
  --duration-seconds 5
```

Omit `--duration-seconds` to stop on SIGINT/SIGTERM. The relevant options are:

| Option | Default | Purpose |
| --- | --- | --- |
| `--server-url` | `http://127.0.0.1:4317` | Local/self-hosted jiko server. |
| `--origin` | `http://localhost:5173` | Exact origin required by the current WebSocket boundary; this header is not authentication. |
| `--alsa-device` | `default` | Explicit ALSA capture device; the release device profile must eventually pin a stable card/device tuple. |
| `--sample-rate-hz` | `16000` | One of the protocol-supported 16/44.1/48 kHz mono profiles. |
| `--chunk-duration-ms` | `80` | Source chunk size; the default is 1,280 frames / 2,560 bytes at 16 kHz. |
| `--queue-chunks` | `16` | Hard in-memory capture/transport handoff bound. Overflow is reported as incomplete coverage. |
| `--ack-timeout-seconds` | `3` | Short deadline for `audio.start` and each `audio.chunk` ACK. |
| `--finalization-timeout-seconds` | `65` | Bounded `audio.stop` receipt wait: the server contract permits at most 60 seconds of attempt work, plus a five-second delivery envelope. |
| `--process-stop-timeout-seconds` | `2` | Total shared budget for process escalation and capture-thread joins. |
| `--stop-timeout-seconds` | `70` | Absolute outer deadline shared by capture drain, publisher cancellation, and finalization. |

The Python implementation includes a dependency-free RFC 6455 client so the
device does not need a second WebSocket package. `wss://` uses the system TLS
trust store. HTTP response bodies are capped at 64 KiB before JSON parsing.
Do not expose the current write API on an untrusted LAN: exact Origin checks do
not identify a device, and scoped enrollment/capability work remains required
before remote deployment.

`arecord` stdout does not expose an ALSA hardware timestamp. The adapter's
frame clock is exact relative to its first monotonic anchor, while xrun lines
remain explicit loss evidence; it is not proof of codec/driver timestamp
accuracy or microphone-to-process latency.

This slice is intentionally not wired into `pi_button_adapter.py` yet. The
button outbox protects control-event delivery, while audio transport currently
has no reconnect/chunk replay or restart-recoverable audio WAL. Combining them
before one component owns the turn would create two competing start/stop paths.
The next device-runtime step is one supervisor that gives the physical button
local acknowledgement, starts this capture edge, and closes both paths under
one attempt id.

## Pi Button Adapter

`pi_button_adapter.py` reads a hold-to-record side button with `gpiozero`.
The GPIO callbacks write to a bounded SQLite outbox and return without waiting
for HTTP. A background dispatcher then delivers the canonical operations in
order.

- Press: allocate a safe client session id and atomically queue idempotent
  session creation plus `input.recording.started`, using the adapter's local
  monotonic timestamp.
- Release: atomically queue `input.recording.stopped` with locally measured
  `durationMs` and monotonic timestamp. Server arrival is diagnostic. If that
  durable write fails, the adapter keeps the turn active and reports the
  failure; a later release retries the stop instead of printing a false local
  success or silently abandoning the open press.
- Lost HTTP responses replay the exact client session id and event timing
  identity. The server returns the original event instead of appending a
  duplicate.
- A server response is treated as permanent only when it is both HTTP `410`
  and carries the typed JSON code `session_identity_retired`. The complete
  turn is then quarantined in SQLite with the rejected operation, attempt
  count, timestamp, error code, and diagnostic instead of retrying that id
  forever. Untyped `410`, other HTTP failures, timeouts, and disconnects keep
  the normal retry behavior. Quarantined turns remain inside the configured
  outbox bound so an operator can inspect the evidence rather than losing it.
- If the adapter restarts after a press but before a release was persisted, it
  queues a typed `device_input_interrupted` error so the session cannot remain
  silently stuck in `recording`.
- No audio is captured or analyzed in this script.

Default wiring expects a normally-open button between `GPIO17` and ground, using
`gpiozero.Button(..., pull_up=True)`.

```sh
python3 apps/device/pi_button_adapter.py
```

Environment:

| Variable | Default | Purpose |
| --- | --- | --- |
| `JIKO_SERVER_URL` | `http://localhost:4317` | Server base URL. |
| `JIKO_SESSION_ID` | unset | Use one pre-created session for one controlled press/release attempt. Sessions are immutable and must not be reused across turns. |
| `GPIO_RECORD_BUTTON_PIN` | `17` | BCM GPIO pin for the record button. |
| `BUTTON_BOUNCE_TIME` | `0.05` | gpiozero debounce time in seconds. |
| `JIKO_DEVICE_OUTBOX_PATH` | `data/device/button-outbox.sqlite3` | Private SQLite outbox. Its parent must be writable by the service user. |
| `JIKO_DEVICE_OUTBOX_MAX_TURNS` | `128` | Hard bound on incomplete or unacknowledged turns. A new press is rejected visibly when full. |
| `JIKO_DEVICE_RETRY_BASE_SECONDS` | `0.25` | Initial delivery retry delay. |
| `JIKO_DEVICE_RETRY_MAX_SECONDS` | `5.0` | Maximum bounded retry delay. |

The script exits with a clear error if `gpiozero` is missing or if it is not
running on Raspberry Pi hardware.

Run the host-side outbox contract tests with:

```sh
python3 -m unittest discover -s apps/device -p 'test_*.py'
```

The button adapter alone is still not the hardware product loop. The outbox
protects button timing and operation order, but it does not own the ALSA
capture adapter above and therefore cannot yet make a physical press
first-syllable safe. There is no Raspberry Pi validation, physical
debounce/long-hold receipt, target ALSA/xrun campaign, reconnect/replay,
restart-safe audio ownership, or target storage endurance evidence. The SQLite
file is local operational state, not a claim of durable audio ownership or
exactly-once transport.
