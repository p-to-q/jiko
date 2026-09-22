# Open Voice / Agent Hardware Repository Archaeology

Status: **pinned-source research; not a hardware or model validation**
Last reviewed: **2026-09-18 (Asia/Shanghai)**

## Executive Decision

There is no open repository in this comparison set that Jiko should copy as a
complete product. The useful pieces live at different layers:

- Omi has the strongest small-device framing, sequence, and offline-ring
  evidence, but its current BLE completion is not a host-durable commit and a
  connected-but-unsubscribed path can still consume a live frame;
- Home Assistant Voice PE and ESPHome have the clearest product stage events,
  bounded audio rings, local wake-word boundary, and retry-before-consume send
  loop, but the ring silently replaces old audio and the normal voice loop
  depends on another machine;
- Wyoming is a small, self-describing local/self-hosted speech-service protocol,
  but transport `drain()` is not an application acknowledgment and the protocol
  intentionally has no authentication or encryption;
- ESP-SR provides a credible MCU AFE/VAD/wake boundary and an explicit VAD
  pre-roll cache, but it is not an open-ended STT replacement and its vendor
  benchmarks are not Jiko measurements;
- ESP-ADF demonstrates the stop/wait/terminate/reset lifecycle that a restartable
  audio graph needs, while its issue history makes that lifecycle a test target,
  not a guarantee;
- OpenSQZ OpenGlass and Open Interpreter 01 Light expose valuable prototype
  decisions. Their missing durable delivery, authentication, OTA, and measured
  power/thermal envelopes make them counterexamples as often as templates.

Jiko should therefore keep the current product shape: **one shared core, two
runtime shells, hardware-specific code at the edge, and local/self-hosted STT
and TTS by default**. The host owns the canonical event protocol, session
identity, receipt authority, model identity, timeouts, and UI truth; it is the
intended owner of future restart-durable receipts, which the current
write-and-rename receipt and process spool do not yet prove. An ESP32 or
audio coprocessor may own only bounded real-time capture, AFE, wake/VAD, physical
controls, and an explicitly bounded edge ring.

This note adds code-path and failure evidence to, rather than replacing,
[`mature-device-systems-research.md`](./mature-device-systems-research.md),
[`research-embedded-voice-systems.md`](./research-embedded-voice-systems.md),
and [`research-wearable-hardware.md`](./research-wearable-hardware.md). Broad
product/component summaries remain in those documents.

## Product Language Is Not A Sensor Contract

Jiko's original **content / emotion / context** proposition remains an open
product question. Repository archaeology does not prove that a device can read
emotion or understand context. Mature systems are more disciplined: they map a
visible state to a lifecycle event, and a user-facing setting to a named test,
instead of treating product language as a measured signal.

| Product proposition | What engineering can presently measure | What remains open |
| --- | --- | --- |
| content | local transcript fidelity; separately receipted semantic output; abstention and model identity | whether a composed product line captures what the person meant |
| emotion | speech-region timing, energy, pitch variation, clipping/noise, pauses; call this **delivery** | emotion, intent, honesty, personality, or mental state |
| context | monotonic button/speech timings, continuation, session boundaries, known user-selected context; call this **timing / interaction** | latent situation or meaning not represented in an explicit input |

Two upstream practices make this distinction concrete:

- Voice PE changes `waiting`, `listening`, `thinking`, `replying`, `not ready`,
  and `error` from actual pipeline callbacks, not from an LLM guess. Its wake
  sensitivity labels are tied to model-specific false accepts per hour on the
  named Dinner Party Corpus. See the pinned
  [phase callbacks](https://github.com/esphome/home-assistant-voice-pe/blob/d4e6fa43d6a1a7d342b7d4d403567e06516719de/home-assistant-voice.yaml#L1815-L1894)
  and [cut-offs/FAPH comments](https://github.com/esphome/home-assistant-voice-pe/blob/d4e6fa43d6a1a7d342b7d4d403567e06516719de/home-assistant-voice.yaml#L1790-L1813).
- Wyoming advertises the installed model, version, languages, and streaming/VAD
  capabilities. A product can say which service is running without claiming the
  service understands emotion or context. See the pinned
  [`info` contract](https://github.com/OHF-Voice/wyoming/blob/fa5d98c1e8d3f1b00eadcf46df6f87f1d352ca3e/README.md#L86-L173).

The Jiko UI may preserve the artistic labels while the development receipt and
benchmark use `content`, `delivery`, and `timing`. Each line must be independently
unavailable. An unavailable signal is not silently converted into a neutral or
positive reading. An attempt-level admission failure such as exact all-zero PCM
may invalidate all three lines together because no spoken input entered the
instrument; raw press/provider events remain diagnostics, not a timing reading.
Release telemetry and qualification receipts must be content-free. Short-lived
local development session receipts may contain consented transcripts, remain
ignored, and must never be committed; raw real-person audio remains excluded.

## Method And Source Ledger

The findings below come from pinned code/configuration, official technical
documentation, and official repository issues. Commit time is the upstream UTC
committer time returned by GitHub on 2026-09-18. An issue is a report at a
particular version, not proof that every device or current revision still has the
failure. A maintainer retrospective is labeled as opinion.

| Project | Pinned snapshot and time | Directly inspected evidence | Status boundary |
| --- | --- | --- | --- |
| BasedHardware Omi | [`6cdeb6665bce`](https://github.com/BasedHardware/omi/tree/6cdeb6665bce750120fdfbcba8a6c51cdd61d731), 2026-09-18 03:09 UTC | `mic.c`, `config.h`, `codec.c`, `transport.c`, `storage.c`, `sd_card.h`, `omi.conf`, `sysbuild.conf`, official issues | active, high-churn snapshot; do not infer a release tag |
| BasedHardware OpenGlass | [`19f077757813`](https://github.com/BasedHardware/OpenGlass/tree/19f077757813265515b83e291807ce34a60751e8), 2025-09-22 03:05 UTC | `firmware/firmware.ino`, README | repository explicitly unsupported and moved to Omi |
| OpenSQZ OpenGlass | [`1ffe701e808c`](https://github.com/OpenSQZ/OpenGlass/tree/1ffe701e808cc67aa6462bc6071c61413302f17d), 2026-08-06 07:19 UTC | PDM/WebSocket firmware, partition choice, hardware and safety/privacy notes | research prototype, not a durability or certification baseline |
| Home Assistant Voice PE | [`d4e6fa43d6a1`](https://github.com/esphome/home-assistant-voice-pe/tree/d4e6fa43d6a1a7d342b7d4d403567e06516719de), 2026-09-17 23:40 UTC | product/factory YAML, editable KiCad, hardware license, official issues | shipped, genuinely open desktop hardware; external HA pipeline still required |
| ESPHome voice assistant | [`f6897f2257a3`](https://github.com/esphome/esphome/tree/f6897f2257a3533abf4445346b958f9128810c76), 2026-09-17 19:57 UTC | `voice_assistant.cpp/.h`, `ring_buffer.cpp` | framework code, not proof of Voice PE whole-device latency |
| Wyoming protocol | [`fa5d98c1e8d3`](https://github.com/OHF-Voice/wyoming/tree/fa5d98c1e8d3f1b00eadcf46df6f87f1d352ca3e), 2026-08-27 16:29 UTC | README protocol, event framing/write path | local trusted-network protocol; no auth/encryption by design |
| Wyoming Satellite | [`7a3ba2bc23fc`](https://github.com/rhasspy/wyoming-satellite/tree/7a3ba2bc23fc6699adae4f5bbac4ce529fe2a623), 2026-01-24 13:20 UTC | settings, satellite service loops, queues, heartbeat, debug recorder | repository is archived; use as legacy evidence only |
| Linux Voice Assistant | [`7c6fbaa4ee3c`](https://github.com/OHF-Voice/linux-voice-assistant/tree/7c6fbaa4ee3c9a2cdd25803ed40b32e108a99a4a), 2026-09-03 19:33 UTC | README, peripheral API, deployment docs | maintained successor, explicitly experimental |
| Espressif ESP-SR | [`44b08495ef4b`](https://github.com/espressif/esp-sr/tree/44b08495ef4b00b53fb0496bd6077223f77256ec), 2026-09-17 07:31 UTC | AFE API, benchmarks, changelog | vendor library/data; figures are board/model-specific upstream results |
| Espressif ESP-ADF `release/v2.x` | [`d6e1ef5ccf29`](https://github.com/espressif/esp-adf/tree/d6e1ef5ccf29ca52dcb8332a3232505366755012), 2026-08-31 11:36 UTC | pipeline lifecycle example, README, official issues | v2.x and `master` are explicitly incompatible lines |
| Open Interpreter 01 | [`befddaf205d0`](https://github.com/OpenInterpreter/01/tree/befddaf205d0eb03020af4df13bf7d8f1b3f6003), 2024-11-01 23:48 UTC | ESP32 client, Light server, local profile, BOM/manufacturing report | genuine open pocket prototype; manufacturing discontinued |

The ledger is intentionally pin-specific. A later upstream fix does not make an
old issue current, and a current commit does not retroactively validate shipped
hardware.

## 1. Omi: Useful Offline Primitives, Incomplete Ownership Transfer

### Audio cadence and queue semantics

The current Omi firmware captures 16 kHz, signed 16-bit, two-channel PDM in
100 ms driver blocks with four slab blocks, then immediately downsamples the
two channels to one mono stream. See
[`mic.c`](https://github.com/BasedHardware/omi/blob/6cdeb6665bce750120fdfbcba8a6c51cdd61d731/omi/firmware/omi/src/mic.c#L30-L61)
and the
[downmix path](https://github.com/BasedHardware/omi/blob/6cdeb6665bce750120fdfbcba8a6c51cdd61d731/omi/firmware/omi/src/mic.c#L92-L130).
The Opus profile encodes 320 samples, or 20 ms at 16 kHz, using restricted
low-delay mode, 32 kbit/s VBR, and complexity 3. The live transmit ring has 32
codec-frame slots, about 640 ms at that normal cadence. Sources:
[`config.h`](https://github.com/BasedHardware/omi/blob/6cdeb6665bce750120fdfbcba8a6c51cdd61d731/omi/firmware/omi/src/lib/core/config.h#L3-L31)
and
[`codec.c`](https://github.com/BasedHardware/omi/blob/6cdeb6665bce750120fdfbcba8a6c51cdd61d731/omi/firmware/omi/src/lib/core/codec.c#L73-L106).

That is a useful distinction for Jiko: capture period and wire frame do not need
to be identical, but both must be receipted. A 20 ms packet label cannot hide
100 ms capture blocking or an older frame waiting behind 31 slots.

The queue put is all-or-nothing, and GATT fragments carry a rolling 16-bit
packet id plus fragment index. Current notification code reserves shared TX
slots and retries a failed enqueue three times. However, the pusher removes the
frame **before** testing whether the connected client subscribed. With a BLE
connection but no audio subscription, the final branch sleeps and the removed
frame is neither sent nor written to offline storage. This is direct current
code evidence, not an issue inference:
[`transport.c` queue and notify](https://github.com/BasedHardware/omi/blob/6cdeb6665bce750120fdfbcba8a6c51cdd61d731/omi/firmware/omi/src/lib/core/transport.c#L970-L1131)
and
[`pusher`](https://github.com/BasedHardware/omi/blob/6cdeb6665bce750120fdfbcba8a6c51cdd61d731/omi/firmware/omi/src/lib/core/transport.c#L1215-L1253).

### Offline ring and acknowledgment level

The storage ring is substantially better than a flat file: it exposes
`read_seq`, `write_seq`, `dropped_packets`, and capacity; packets include a
4-byte timestamp; the maximum configured storage is `0x1E000000` bytes
(approximately 480 MiB). Source:
[`sd_card.h`](https://github.com/BasedHardware/omi/blob/6cdeb6665bce750120fdfbcba8a6c51cdd61d731/omi/firmware/omi/src/lib/core/sd_card.h#L9-L21).

The current sync path accumulates bytes in the BLE TX-completion callback and
checkpoints the read pointer every two seconds, so a disconnect can resume from
the last checkpoint. That is a meaningful improvement over freeing the entire
range after enqueue. It still calls a returned BLE TX buffer “the phone has
confirmed receiving”; it is not evidence that the host application wrote the
session/sequence to a durable WAL. Source:
[`storage.c`](https://github.com/BasedHardware/omi/blob/6cdeb6665bce750120fdfbcba8a6c51cdd61d731/omi/firmware/omi/src/lib/core/storage.c#L40-L55),
[`storage_data_tx_done`](https://github.com/BasedHardware/omi/blob/6cdeb6665bce750120fdfbcba8a6c51cdd61d731/omi/firmware/omi/src/lib/core/storage.c#L118-L137),
and its
[notify callback](https://github.com/BasedHardware/omi/blob/6cdeb6665bce750120fdfbcba8a6c51cdd61d731/omi/firmware/omi/src/lib/core/storage.c#L245-L286).

Jiko must distinguish these acknowledgments:

```text
device TX accepted
  != link callback completed
  != host socket/API accepted
  != server process received
  != host WAL fsynced and session/sequence committed
```

Only the last named level may transfer durable ownership in Jiko.

### Same-day Omi app WAL delta: adopt the states, not the cloud product

A later Omi app snapshot at
[`9a477a51bd1f`](https://github.com/BasedHardware/omi/tree/9a477a51bd1f139cf40590aafe14c411e0d1c49b)
adds a sharper recovery vocabulary than the firmware transport above:
`inProgress -> miss -> uploaded -> synced`, plus corrupted,
outside-recovery-window, exhausted automatic retry, and manual retry states.
Most importantly, HTTP 202 moves a recording only to `uploaded`; cleanup waits
for a background job to confirm `synced`. A single foreground coordinator owns
recovery, and a reconciler re-arms on startup, foreground/network/device
recovery, and cooldown using a bounded 20/20/30/45/60/120-second cadence.
Sources: [WAL state/worst-state UI](https://github.com/BasedHardware/omi/blob/9a477a51bd1f139cf40590aafe14c411e0d1c49b/app/lib/services/wals/wal.dart#L13-L88),
[accepted versus synced](https://github.com/BasedHardware/omi/blob/9a477a51bd1f139cf40590aafe14c411e0d1c49b/app/lib/services/wals/local_wal_sync.dart#L814-L838),
[uploaded reconciliation](https://github.com/BasedHardware/omi/blob/9a477a51bd1f139cf40590aafe14c411e0d1c49b/app/lib/services/wals/local_wal_sync.dart#L1114-L1245),
[backoff](https://github.com/BasedHardware/omi/blob/9a477a51bd1f139cf40590aafe14c411e0d1c49b/app/lib/services/wals/sync_reconciler.dart#L30-L112),
and [single recovery owner](https://github.com/BasedHardware/omi/blob/9a477a51bd1f139cf40590aafe14c411e0d1c49b/app/lib/services/wals/recording_transfer_coordinator.dart#L48-L116).

Jiko should adapt this to
`capturing -> host_wal_durable -> provider_accepted -> provider_completed -> session_committed`.
Only `host_wal_durable` transfers device ownership, and raw audio is removed
after the committed terminal state under the local retention policy. Do not
copy Omi's long cloud-retention or background-upload product semantics. The
current browser server's `spooled` ACK deliberately remains process-lifetime;
it is not this future restart-recoverable state machine.

### Wake/power, OTA, privacy, and observability

Omi's amplitude activity check is used to enter T5838 hardware acoustic-activity
sleep after ten seconds of quiet. It is not a product VAD/STT endpoint. The
current path waits for an in-flight `dmic_read` before stopping, handles a wake
pin that is already high when armed, powers/remounts storage before capture
resumes, and only powers storage down when no phone is connected. Sources:
[`omi.conf`](https://github.com/BasedHardware/omi/blob/6cdeb6665bce750120fdfbcba8a6c51cdd61d731/omi/firmware/omi/omi.conf#L208-L224)
and
[`mic.c`](https://github.com/BasedHardware/omi/blob/6cdeb6665bce750120fdfbcba8a6c51cdd61d731/omi/firmware/omi/src/mic.c#L276-L405).
The inspected path has no pre-roll proving that the first phoneme survives the
power transition.

MCUboot and multi-image update scaffolding exist, but `sysbuild.conf` points to
a repository path for `root-rsa-2048.pem`. Jiko should borrow rollback concepts,
not a committed release-key pattern. Source:
[`sysbuild.conf`](https://github.com/BasedHardware/omi/blob/6cdeb6665bce750120fdfbcba8a6c51cdd61d731/omi/firmware/omi/sysbuild.conf#L7-L17).
The release config disables the structured log and monitor while leaving
`printk`/UART; storage speed telemetry is compiled out with logging. A release
soak therefore needs explicit low-cost counters rather than assuming debug logs
will exist.

Official issue history supplies fault-injection cases, while its closed/open
state prevents treating all of them as current-code defects:

| Issue snapshot checked 2026-09-18 | State | Failure pattern to preserve as a Jiko fixture |
| --- | --- | --- |
| [#5159](https://github.com/BasedHardware/omi/issues/5159) | closed | internet socket dies while BLE stays connected; link state did not prove end-to-end progress |
| [#6977](https://github.com/BasedHardware/omi/issues/6977) | open | stale live socket can leave gaps and a zombie `Listening` state |
| [#7841](https://github.com/BasedHardware/omi/issues/7841) | closed | a Limitless integration reconnected its server WebSocket but did not re-enable device streaming; this is Omi integration evidence, not Limitless firmware evidence |
| [#8006](https://github.com/BasedHardware/omi/issues/8006) | open | offline audio needs ordered, contextual, idempotent reconstruction before ASR |
| [#9417](https://github.com/BasedHardware/omi/issues/9417) | closed | long-running desktop PTT/model-runtime drift and reconnect loss |
| [#9585](https://github.com/BasedHardware/omi/issues/9585) | closed | HTTP 200 with an empty transcript must not be typed as success |
| [#10431](https://github.com/BasedHardware/omi/issues/10431) | closed | selecting “local STT” did not by itself stop a second socket from forwarding audio |

## 2. OpenGlass: Two Useful Prototype Counterexamples

### BasedHardware OpenGlass

The official README now repeats that the project is unsupported and moved to
Omi. It should be read as historical code, not a current BasedHardware product
baseline. The default PCM build declares 16 kHz, 16-bit mono and `FRAME_SIZE=160`
(10 ms), but the main loop adds an unconditional 20 ms delay after capture/send/
camera work. The source therefore does not prove continuous 10 ms cadence or
absence of I2S backlog/overrun. Source:
[`firmware.ino`](https://github.com/BasedHardware/OpenGlass/blob/19f077757813265515b83e291807ce34a60751e8/firmware/firmware.ino#L14-L54)
and its
[capture loop](https://github.com/BasedHardware/OpenGlass/blob/19f077757813265515b83e291807ce34a60751e8/firmware/firmware.ino#L397-L511).

The implementation has no audio queue, application acknowledgment, retransmit,
offline storage, progress watchdog, or OTA. When disconnected it continues to
read and drops audio. A two-byte frame count plus a fragment byte is useful, but
the advertised default codec id is commented as “PCM 8khz” while the compiled
PCM path is 16 kHz. Battery starts at 100 and `updateBatteryLevel()` remains a
TODO. The Opus switch is labeled under development and the checked single file
references `FRAME_SIZE` from a branch where it is not defined; this research did
not build that optional path. Sources:
[`codec characteristic`](https://github.com/BasedHardware/OpenGlass/blob/19f077757813265515b83e291807ce34a60751e8/firmware/firmware.ino#L145-L157)
and
[`battery TODO`](https://github.com/BasedHardware/OpenGlass/blob/19f077757813265515b83e291807ce34a60751e8/firmware/firmware.ino#L364-L369).

This is why Jiko needs a startup-negotiated and receipted audio profile, not a
comment, BOM label, or host assumption.

### OpenSQZ OpenGlass

OpenSQZ's newer research fork is more explicit. The firmware emits 16 kHz,
mono, PCM16 little-endian in 640-byte/20 ms WebSocket binary frames. It uses six
1024-sample PDM DMA descriptors, a dedicated Core 1 task at priority 5 while
Wi-Fi runs on Core 0, a 200 ms I2S read timeout, DC-offset removal and saturating
gain. It deliberately drops the first five frames (100 ms) after connect to
flush stale DMA. Source:
[`app_httpd.cpp`](https://github.com/OpenSQZ/OpenGlass/blob/1ffe701e808cc67aa6462bc6071c61413302f17d/CameraWebServer_PDM_Audio/app_httpd.cpp#L55-L79)
and the
[audio task](https://github.com/OpenSQZ/OpenGlass/blob/1ffe701e808cc67aa6462bc6071c61413302f17d/CameraWebServer_PDM_Audio/app_httpd.cpp#L228-L331).

That task calls `httpd_ws_send_frame_async`; three immediate errors stop the
stream. There are no sequence numbers, bounded application queue, receiver
acknowledgments, retransmit ownership, or offline storage. Async enqueue is not
durable delivery. A second client receives 409. Source:
[`ws_audio_handler`](https://github.com/OpenSQZ/OpenGlass/blob/1ffe701e808cc67aa6462bc6071c61413302f17d/CameraWebServer_PDM_Audio/app_httpd.cpp#L945-L1008).

The firmware lowers camera XCLK to 10 MHz for Wi-Fi headroom, restarts if initial
Wi-Fi association exceeds 20 seconds, logs heap/PSRAM/RSSI/uptime every ten
seconds, and logs stream rate/heap every five seconds. These are useful
prototype observations, but the source has no explicit post-boot reconnect/WAL
policy. It runs plaintext HTTP/WebSocket without authentication and asks the
builder to compile Wi-Fi credentials. The selected `Huge APP (3MB No OTA)`
partition explicitly has no OTA. Sources:
[`CameraWebServer_PDM_Audio.ino`](https://github.com/OpenSQZ/OpenGlass/blob/1ffe701e808cc67aa6462bc6071c61413302f17d/CameraWebServer_PDM_Audio/CameraWebServer_PDM_Audio.ino#L27-L46)
and its
[Wi-Fi/health loop](https://github.com/OpenSQZ/OpenGlass/blob/1ffe701e808cc67aa6462bc6071c61413302f17d/CameraWebServer_PDM_Audio/CameraWebServer_PDM_Audio.ino#L198-L238).

The project's own
[`safety_privacy.md`](https://github.com/OpenSQZ/OpenGlass/blob/1ffe701e808cc67aa6462bc6071c61413302f17d/docs/safety_privacy.md)
and
[`hardware/README.md`](https://github.com/OpenSQZ/OpenGlass/blob/1ffe701e808cc67aa6462bc6071c61413302f17d/hardware/README.md)
call it a research prototype and list unvalidated runtime, charging, thermal,
comfort, and safety. That evidence boundary is worth adopting verbatim in
Jiko's EVT notes.

## 3. Voice PE And ESPHome: Stage Truth And Backpressure, With Silent Replacement

At this pin, Voice PE is also the clearest **genuinely open desktop voice
hardware** in the comparison: the repository contains the editable KiCad
project/PCB/schematics, and the hardware directory explicitly applies
CERN-OHL-P v2. Sources:
[`hardware/README.md`](https://github.com/esphome/home-assistant-voice-pe/blob/d4e6fa43d6a1a7d342b7d4d403567e06516719de/hardware/README.md)
and
[`hardware/LICENSE.txt`](https://github.com/esphome/home-assistant-voice-pe/blob/d4e6fa43d6a1a7d342b7d4d403567e06516719de/hardware/LICENSE.txt).
That proves an editable, licensed design release; it does not by itself prove
supplier yield, factory fixtures, Jiko acoustics, or a reproducible thermal
envelope.

Voice PE uses an ESP32-S3 at 240 MHz with 16 MB flash and PSRAM, moves
instructions/rodata into PSRAM to improve microWakeWord performance, enables API
encryption, and supports ESPHome plus manifest-based OTA. The factory profile
can switch production/beta manifests and reuses BLE provisioning. Sources:
[`home-assistant-voice.yaml`](https://github.com/esphome/home-assistant-voice-pe/blob/d4e6fa43d6a1a7d342b7d4d403567e06516719de/home-assistant-voice.yaml#L37-L119)
and
[`home-assistant-voice.factory.yaml`](https://github.com/esphome/home-assistant-voice-pe/blob/d4e6fa43d6a1a7d342b7d4d403567e06516719de/home-assistant-voice.factory.yaml#L16-L75).

The audio boundary is explicit: XMOS delivers 16 kHz, 32-bit stereo input;
speaker output is 48 kHz, 32-bit stereo with a 100 ms buffer. Both microphone
channels go to the voice-assistant component, while local wake uses a selected
channel. Voice-assistant noise suppression and auto gain are zero because the
external audio path owns preprocessing. Source:
[`audio configuration`](https://github.com/esphome/home-assistant-voice-pe/blob/d4e6fa43d6a1a7d342b7d4d403567e06516719de/home-assistant-voice.yaml#L1529-L1593)
and
[`voice_assistant`](https://github.com/esphome/home-assistant-voice-pe/blob/d4e6fa43d6a1a7d342b7d4d403567e06516719de/home-assistant-voice.yaml#L1815-L1836).

In current ESPHome, each 16 kHz channel has a 512 ms ring and is exposed in at
most 32 ms chunks. The send loop keeps a zero-copy chunk exposed when
`send_message()` refuses it and consumes only after acceptance. For two-channel
input it waits until both have data, then uses a two-second imbalance watchdog
so a dead channel cannot hang the stream forever. Source:
[`voice_assistant.cpp`](https://github.com/esphome/esphome/blob/f6897f2257a3533abf4445346b958f9128810c76/esphome/components/voice_assistant/voice_assistant.cpp#L21-L52)
and the
[send/stall path](https://github.com/esphome/esphome/blob/f6897f2257a3533abf4445346b958f9128810c76/esphome/components/voice_assistant/voice_assistant.cpp#L212-L288).

This is the best inspected low-latency send pattern: **do not consume before the
next layer accepts**. It is still not durability. If backpressure lasts, the
generic ring's `write()` discards the oldest bytes to admit new data, and the
voice-assistant callback does not surface that replacement as a session drop
counter. Source:
[`ring_buffer.cpp`](https://github.com/esphome/esphome/blob/f6897f2257a3533abf4445346b958f9128810c76/esphome/components/ring_buffer/ring_buffer.cpp#L81-L103).

The hardware-mute state overrides software mute in configuration and is made
visible in the UI state. The physical power-cut claim is established by the
published Voice PE hardware design, not by the YAML alone. Jiko must make the
same distinction between a GPIO label, a software state, and a measured
electrical disconnect.

Official issue reports expose useful regression cells:

- [Voice PE #485](https://github.com/esphome/home-assistant-voice-pe/issues/485)
  contains a 2025.11 beta-update log where a long update operation coincides
  with a microWakeWord ring reset and temporarily reduced wake accuracy;
- [#480](https://github.com/esphome/home-assistant-voice-pe/issues/480) reports
  an I2C timeout/AIC3204 communication failure that leaves the device in mute;
- [#382](https://github.com/esphome/home-assistant-voice-pe/issues/382) reports
  a device stuck in `responding` with no audible output until restart.

They are version-specific user reports, not proof of a current universal flaw.
They do prove that update contention, codec health, state-vs-actual-playback, and
recovery belong in Jiko's system tests.

## 4. Wyoming: A Good Service Boundary, Not A Durability Protocol

Wyoming frames a UTF-8 JSON-line header followed by exact-length JSON data and
binary payload. Audio is raw PCM with explicit rate, sample width, channels,
optional timestamp, and start/chunk/stop events. It advertises installed model
name/version/languages and whether ASR/TTS/intent streams partial output. Source:
[`README`](https://github.com/OHF-Voice/wyoming/blob/fa5d98c1e8d3f1b00eadcf46df6f87f1d352ca3e/README.md#L45-L83)
and its
[streaming contracts](https://github.com/OHF-Voice/wyoming/blob/fa5d98c1e8d3f1b00eadcf46df6f87f1d352ca3e/README.md#L175-L220).

The writer emits header/data/payload and awaits `writer.drain()`. That is valid
TCP backpressure, but the envelope has no session sequence, acknowledgment,
idempotency key, or durable commit. Source:
[`event.py`](https://github.com/OHF-Voice/wyoming/blob/fa5d98c1e8d3f1b00eadcf46df6f87f1d352ca3e/wyoming/event.py#L112-L145).
The official security section says Wyoming has no authentication or encryption
by design and must stay on a trusted network. Jiko should use loopback/Unix
socket by default; a LAN exposure needs an authenticated wrapper and explicit
threat model.

The archived Wyoming Satellite remains useful for boundaries, not as a new
dependency. Its default mic path is 16 kHz, 16-bit mono with 1024 samples per
chunk (64 ms); local VAD can retain two seconds of pre-roll; wake refractory and
VAD wake timeout default to five seconds; component reconnect defaults to three
seconds. Source:
[`settings.py`](https://github.com/rhasspy/wyoming-satellite/blob/7a3ba2bc23fc6699adae4f5bbac4ce529fe2a623/wyoming_satellite/settings.py#L9-L151).
It pings every two seconds and drops a stale server after a five-second pong
timeout. Yet `event_to_server()` simply returns if there is no writer, and sound,
wake, and event paths create unbounded `asyncio.Queue()` instances; reconnect
can replace a queue and discard backlog. Source:
[`satellite.py`](https://github.com/rhasspy/wyoming-satellite/blob/7a3ba2bc23fc6699adae4f5bbac4ce529fe2a623/wyoming_satellite/satellite.py#L160-L226)
and its
[sound queue loop](https://github.com/rhasspy/wyoming-satellite/blob/7a3ba2bc23fc6699adae4f5bbac4ce529fe2a623/wyoming_satellite/satellite.py#L578-L635).
The optional debug recorder can write real speech and must remain disabled in a
Jiko release.

The maintained successor, Linux Voice Assistant, is relevant to Jiko's “one core,
hardware at the edge” rule. It runs the host pipeline on x64/ARM64 Linux and lets
button/LED/display adapters live in separate scripts or containers. A peripheral
gets a current-state snapshot, then typed stage events and commands. Source:
[`peripheral_api.md`](https://github.com/OHF-Voice/linux-voice-assistant/blob/7c6fbaa4ee3c9a2cdd25803ed40b32e108a99a4a/docs/peripheral_api.md#L1-L74).
That is the boundary to adapt, but not the security/privacy defaults: the API is
plain unauthenticated WebSocket, binds `0.0.0.0:6055` by default, and the example
snapshot includes last STT/TTS text. Jiko hardware adapters should receive only
the minimum content-free UI/control state unless a display feature explicitly
requires text and passes a privacy review. The repository itself calls the
runtime experimental; its 1024-sample default input block is 64 ms at the
required 16 kHz rate. Source:
[`README`](https://github.com/OHF-Voice/linux-voice-assistant/blob/7c6fbaa4ee3c9a2cdd25803ed40b32e108a99a4a/README.md#L1-L36)
and its
[parameter table](https://github.com/OHF-Voice/linux-voice-assistant/blob/7c6fbaa4ee3c9a2cdd25803ed40b32e108a99a4a/README.md#L72-L116).

## 5. ESP-SR And ESP-ADF: Keep Determinism At The Edge

ESP-SR's AFE accepts interleaved signed 16-bit, 16 kHz channels whose format is
declared explicitly; `MMNR`, for example, means two microphones, an unused
channel, and a playback reference. The application queries feed/fetch chunk
sizes and channel count from the loaded AFE instead of hard-coding a cadence.
Feed and fetch run in separate tasks in the reference pattern. Source:
[`audio_front_end/README.rst`](https://github.com/espressif/esp-sr/blob/44b08495ef4b00b53fb0496bd6077223f77256ec/docs/en/audio_front_end/README.rst#L60-L123).

Most important for Jiko, `fetch()` returns processed mono plus VAD/wake state and
a `vad_cache`; the documentation explicitly instructs the caller to prepend
that cache to avoid losing the start of speech. `fetch_with_delay()` exposes a
bounded wait rather than forcing the documented 2000 ms default. Source:
[`AFE fetch`](https://github.com/espressif/esp-sr/blob/44b08495ef4b00b53fb0496bd6077223f77256ec/docs/en/audio_front_end/README.rst#L124-L184).

Espressif's ESP32-S3 tables are capacity estimates, not Jiko results. For the
documented model set, MR/SR high-performance AFE reports 49.1 KB internal RAM,
775.8 KB PSRAM, 9.3% feed and 9.8% fetch of one core; MMNR/SR high-performance
reports 68.1 KB, 1200.4 KB, 24.9%, and 22.9%. Quantized two-channel WakeNet9 is
listed at 16 KB RAM, 324 KB PSRAM, and 3.0 ms per 32 ms frame; three-channel
WakeNet10 at 17 KB, 523 KB, 7.1 ms/32 ms and 22.6% of one core. Source:
[`benchmark/README.rst`](https://github.com/espressif/esp-sr/blob/44b08495ef4b00b53fb0496bd6077223f77256ec/docs/en/benchmark/README.rst#L27-L120)
and
[`WakeNet table`](https://github.com/espressif/esp-sr/blob/44b08495ef4b00b53fb0496bd6077223f77256ec/docs/en/benchmark/README.rst#L246-L274).
The upstream wake percentages and once-per-12-hour false-trigger line are for a
Korvo V4 board and a named Alexa model, not for Jiko's microphones/enclosure.

The changelog contains ring-buffer, memory-leak, duration-overflow, and crash
fixes. That history requires an exact ESP-IDF/ESP-SR/library/model tuple in every
artifact and receipt. ESP-SR is a candidate for AFE, local wake, VAD, or a fixed
grammar; it is not a reason to move STT, readings, session scheduling, or UI
state into the MCU.

ESP-ADF's value is lifecycle discipline. The official example restarts a graph
with `stop -> wait_for_stop -> terminate -> reset_ringbuffer -> reset_elements ->
run`, and tears down listeners before event and element deinitialization. Source:
[`play_mp3_control_example.c`](https://github.com/espressif/esp-adf/blob/d6e1ef5ccf29ca52dcb8332a3232505366755012/examples/get-started/play_mp3_control/main/play_mp3_control_example.c#L190-L251).
Official issue history turns that order into fault tests:

- [#1347](https://github.com/espressif/esp-adf/issues/1347), open at review,
  reports a 16 kHz VoIP ring-buffer write timeout and task watchdog;
- [#1456](https://github.com/espressif/esp-adf/issues/1456), closed, reports a
  crash when stopping/resetting/rerunning an AEC graph on ESP32-S3;
- [#297](https://github.com/espressif/esp-adf/issues/297), historical/closed,
  reports audible streaming jerk around ring-buffer locking.

They are version-specific reports. They justify repeated start/stop/reset,
backpressure, watchdog-progress, and audible-gap tests. Also pin the branch:
ESP-ADF's own README says v2.8+ updates live on `release/v2.x`, and `master` is an
incompatible v3 line.

## 6. Open Interpreter 01 Light: A Real Pocket Agent, And A Useful Failure

01 Light is genuinely inspectable: its M5 Atom Echo/ESP32 client, host server,
local profile, 3D-printable enclosure, BOM, and manufacturing report are in the
same pinned tree. The prototype BOM uses a 500 mAh cell and totals about USD
42.38 in its report. Those are design inputs, not measured runtime or thermal
performance.

Its push-to-talk boundary contains a concrete ordering defect. Press sends an
audio-start control message, selects microphone mode, and begins capture.
Release sends audio-end **before** flushing the final binary microphone bytes.
A server that finalizes on end may truncate or process late final audio. Source:
[`client.ino`](https://github.com/OpenInterpreter/01/blob/befddaf205d0eb03020af4df13bf7d8f1b3f6003/software/source/clients/esp32/src/client/client.ino#L859-L878).

Capture is 16 kHz, 16-bit mono. The task reads 1024-byte blocks into a 10 KiB
array and flushes after the offset exceeds 9 KiB, which normally means a 10 KiB
burst: about 320 ms of audio at 32,000 bytes/s. The WebSocket reconnect interval
is five seconds; authentication is only a commented example. There are no frame
sequences, acknowledgments, bounded offline queue, or replay identity. Source:
[`capture constants/task`](https://github.com/OpenInterpreter/01/blob/befddaf205d0eb03020af4df13bf7d8f1b3f6003/software/source/clients/esp32/src/client/client.ino#L570-L780).
The same I2S peripheral switches between mic and speaker, so the inspected path
does not demonstrate simultaneous full-duplex AEC.

The host feeds raw chunks into RealtimeSTT/faster-whisper and only calls
`text()` at the end; an empty transcript returns silently. It does contain one
good perceived-latency pattern: TTS begins asynchronously after the first
sentence delimiter (minimum fragment length nine) and streams audio chunks to
the output queue. Source:
[`server.py`](https://github.com/OpenInterpreter/01/blob/befddaf205d0eb03020af4df13bf7d8f1b3f6003/software/source/server/server.py#L31-L140).
Jiko can adapt progressive TTS behind its provider-neutral scheduler, with
cancellation, bounded queues, and stage receipts.

The local profile says faster-whisper, Coqui, and an offline Ollama model, but
its own comment states the STT setting is not used because the Light server
always uses faster-whisper. This is direct config/runtime-identity drift:
[`profiles/local.py`](https://github.com/OpenInterpreter/01/blob/befddaf205d0eb03020af4df13bf7d8f1b3f6003/software/source/server/profiles/local.py#L1-L71).
The manufacturing report also retains unfinished values such as placeholder
power/THD/SPL fields, so it is not a verified specification.

Open Interpreter's
[`01 App` retrospective](https://changes.openinterpreter.com/log/01-app)
(2024-09-09) says manufacturing stopped and argues the experience should have
been an app. This is **maintainer retrospective/opinion**, not performance data.
Its useful lesson is a go/no-go gate: prove that hardware changes privacy,
latency, reliability, controls, or use context before financing custom form
factor work.

## Cross-Repository Failure Matrix

| System | Frame/cadence | Buffer/backpressure | VAD/wake/STT boundary | Reconnect/offline | Power/thermal | OTA/supervision | Privacy/observability | Important failure mode |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Omi | 100 ms PDM capture; 20 ms Opus | 32-frame live ring; sequenced fragments; 480 MiB offline ring | amplitude/AAD power sleep, not STT VAD; no proven pre-roll | reconnectable ring sync, but BLE TX callback is not durable host ack | real mic/storage power sequencing; no Jiko-equivalent energy/thermal result | MCUboot multi-image; repository key-path pattern rejected | release logs/monitor reduced; counters exist in storage ring | current connected-unsubscribed consume; historical stale socket/silent-loss issues |
| Based OpenGlass | nominal 10 ms PCM plus 20 ms loop delay | no audio queue/ack/retry | none | advertising restart only; disconnected audio dropped | fake battery value; no measurements | no inspected OTA/supervisor | serial only; codec metadata drift | cadence not proven; optional codec path not proven buildable |
| OpenSQZ Glass | 20 ms PCM16 WS frames | DMA plus async WS send; three errors stop; no app queue/seq | no VAD/wake; first 100 ms discarded | initial Wi-Fi restart; no offline queue | explicitly unvalidated | `No OTA` partition | 5/10 s rate/heap/RSSI logs; plaintext unauthenticated LAN | async enqueue mistaken for delivery; stale/reconnect policy absent |
| Voice PE/ESPHome | 16 kHz stereo in; 32 ms API chunks | 512 ms/channel, retain-until-send; oldest replaced on overflow | local model-specific wake; server STT/VAD callbacks | visible disconnected state; no durable audio WAL | desktop powered; issue evidence for codec/update contention, not full thermal envelope | ESPHome/HTTP manifest OTA and provisioning | strong stage UI; encryption; no surfaced per-session overwrite count | channel stall, update contention, codec mute, state says replying without audio |
| Wyoming Satellite | default 64 ms PCM | TCP drain; unbounded service queues | optional Silero VAD, 2 s pre-roll, separate wake service | 2 s ping/5 s pong, 3 s service reconnect; no WAL | host dependent | deployment dependent; archived | debug WAV can capture real speech | writer absent drops; queue reset can discard backlog |
| Linux Voice Assistant | default 64 ms Linux input block | host/framework dependent | local OWW/MWW; remote HA speech pipeline | HA disconnect event; deployment supervision varies | host dependent | Docker/systemd/image options | stage events/snapshot, but plain unauthenticated peripheral WS can expose text | hardware adapter can look live while host/API health differs |
| ESP-SR/ADF | queried AFE chunks; wake models commonly 32 ms | explicit feed/fetch graph; ADF rings | AFE VAD cache preserves onset; edge wake/fixed grammar | not an offline host protocol | vendor resource numbers only; measure whole device | IDF/ADF version-specific lifecycle | low-level states; Jiko must add session receipts | historical ring, leak, restart-crash, watchdog and audible-gap issues |
| 01 Light | 1024-byte reads; ~320 ms network bursts | 10 KiB RAM batch; no seq/ack/offline | PTT only; STT finalizes at end | 5 s WS reconnect only | 500 mAh design input, no verified endurance/thermal data | no inspected production OTA/rollback | visible LED/socket state, plaintext unauthenticated path | end marker before final flush; silent empty transcript; config/runtime drift |

## Target Low-Latency Pattern For Both Local And API-Shaped Providers

This is the target architecture, not the current browser implementation. The
current ordered path has process-readable ACKs and loses in-flight audio on a
server restart; it does not yet provide the bounded durable host WAL below.

The common low-latency lesson is not “stream everything to a cloud.” It is to
keep capture and provider scheduling incremental while preserving ownership:

```text
mic
  -> hardware-edge adapter
  -> canonical input events + ordered PCM frames (cadence is benchmarked, not fixed by schema)
  -> bounded host WAL (durable ack returned to edge)
  -> one provider adapter contract
       -> in-process local model
       -> localhost / LAN self-hosted streaming service
       -> explicitly authorized remote API experiment
  -> canonical partial/final/error/cancel events
manual demo control
  -> canonical control/transcript events marked simulated
  -> no PCM and no fabricated acoustic evidence
both paths
  -> one shared core
  -> laptop shell or Pi instrument shell
```

The same adapter must expose session/attempt/profile identity, partial/final
ordering, deadline/cancellation, first-partial/final monotonic time, queue age,
and typed outcome. Local and API-shaped implementations may differ in transport;
they may not differ in product state or receipt semantics. Under the current
project policy, release STT/TTS remains local/self-hosted. The one implemented
remote exception is an explicit Deepgram batch experiment gated by provider
selection, process opt-in, and per-request consent; it is not a fallback and the
browser grants no consent. Doubao/Volcengine or any other remote route still
requires an explicit policy decision. Every remote experiment must receipt
network destination, audio egress, provider request identity, retention policy,
and WAN failure; merely selecting a provider named “local” is not proof of local
handling.

Concrete patterns to carry forward:

- start with the same experimental clock split used by the latency plan: native
  capture blocks around 20 ms, canonical transport aggregation around 80–100 ms,
  plus a 200 ms comparison arm. `ordered_pcm_v1` deliberately freezes format,
  identity, sequence, time, and loss—not cadence. Every adapter must receipt its
  capture, canonical-chunk, and provider aggregation durations rather than
  silently conflating them;
- retain a frame until the next layer accepts it, as ESPHome does, but add a
  sequence, age, overwrite/drop counter, and durable host acknowledgment;
- separate capture/AFE, network, provider, and UI loops so a slow service cannot
  block physical feedback; OpenSQZ and ESP-SR show the task split, not the full
  durability solution;
- preserve speech onset with explicit pre-roll/VAD cache, as ESP-SR documents;
- stream partial transcript/TTS where the selected local provider truly supports
  it; Wyoming and 01 demonstrate protocol shapes, not Jiko latency results;
- use a progress watchdog, not only connection state. ESPHome's two-second
  channel-stall check is a useful shape; Jiko needs stage-specific budgets;
- treat queue capacity as fault containment, not permission to add latency.
  `oldest_frame_age` and high-water marks belong in every benchmark receipt.

The current Jiko targets remain defined in
[`research-embedded-voice-systems.md`](./research-embedded-voice-systems.md#latency-budget-and-measurable-acceptance-criteria)
and [`human-experience-audit.md`](./human-experience-audit.md). In particular,
the physical side-button/device acknowledgment target is p95 at most 50 ms,
nested inside the broader cross-shell human-feedback target of p95 at most
100 ms (hard 200 ms); warmed release-to-reading p95 is at most 2.5 s, and
release-to-explicit fallback p95 is at most 4.0 s. These are Jiko
acceptance targets, not numbers proved by the upstream repositories.

## Adopt / Adapt / Reject For Jiko

| Decision | Upstream practice | Jiko interpretation |
| --- | --- | --- |
| **Adopt** | Voice PE lifecycle-driven `listening/thinking/replying/error` | UI shows only canonical stages backed by actual events; both shells render the same trace |
| **Adopt** | ESPHome retain-until-send and multi-channel stall watchdog | do not consume on immediate refusal; add bounded age, drop accounting, and stage timeout |
| **Adopt** | Wyoming explicit PCM/model/capability description | provider readiness reports actual installed model/version/artifact, format, and streaming/VAD capability |
| **Adopt** | ESP-SR queried frame sizes and VAD cache | never hard-code a vendor AFE cadence; preserve onset and receipt raw/processed profile |
| **Adopt** | ESP-ADF stop/wait/terminate/reset/deinit order | every graph supports repeatable cancellation, restart, and teardown under fault injection |
| **Adapt** | Omi sequence/drop/offline ring | edge ring advances only after idempotent host-WAL commit acknowledgment, not BLE/TCP/API enqueue |
| **Adapt** | Voice PE hardware edge plus external compute | Pi/CM5 owns shared core and local models; optional MCU/XMOS owns only measured real-time work |
| **Adapt** | Linux Voice Assistant peripheral processes | hardware adapters receive minimal content-free state and emit canonical events; bind locally/authenticate if networked |
| **Adapt** | 01 progressive TTS after punctuation | provider-neutral partial synthesis with bounded queue, interruption, and first-audio receipt; local by default |
| **Adapt** | OpenSQZ health/rate logs | release-safe counters and histograms with fixed overhead; never rely on verbose serial logging for integrity |
| **Reject** | connection/subscription/socket enqueue as health or durability | health requires monotonic progress; ownership transfers only at the declared durable layer |
| **Reject** | unbounded queues, silent oldest replacement, or silent empty transcript | every overflow/outcome is typed, counted, visible in dev receipt, and mapped to a deliberate fallback |
| **Reject** | plaintext unauthenticated WebSocket on `0.0.0.0` | use loopback/Unix socket or authenticated encrypted LAN transport; minimize content at the hardware edge |
| **Reject** | `No OTA`, repository release private key, or “two slots means safe” | external signing/rotation, verified boot policy, power-cut rollback, wired recovery, and release manifest are gates |
| **Reject** | marketing label, BOM feature, or model selection as runtime evidence | probe real format/model/hash/bytes/version; measure the actual enclosure, target, and end-to-end route |
| **Reject** | MCU ownership of STT, readings, session, or UI | ESP32 remains an optional edge accelerator/controller; the shared core does not fork by hardware |

## Ten Executable Engineering Tasks

| ID | Engineering task | Required artifact and test | Exit criterion |
| --- | --- | --- | --- |
| T01 — partial | Freeze the device-to-host audio envelope: session id, monotonic sequence/time, PCM format, capture period, wire-frame duration, profile id, start/end/cancel, and CRC/length. Route browser/manual controls through the same canonical event protocol. Browser and experimental Pi/Python edges now emit the same start/chunk/stop envelope, and a Python fixture passes the authoritative TypeScript decoder; explicit cancel, reconnect, CRC decision, and physical Pi trace remain. | versioned schema plus golden trace consumed by both laptop and Pi shells; malformed/duplicate/out-of-order/end-before-data tests | the two shells reduce the same trace to the same shared-core state; unsupported format fails before STT |
| T02 — partial | Implement bounded edge and host rings in milliseconds. On overflow, identify the missing sequence range, invalidate the attempt, and stop/retry rather than completing from partial speech. Browser archive/in-flight credit, per-attempt server spool, and a bounded Pi `arecord` stdout queue with cumulative drop/xrun evidence exist; queue-age/high-water telemetry, reconnect/replay, global quota, and a failed-ingress receipt remain. | deterministic slow-consumer/overflow suite with 20 ms capture blocks and 80/100/200 ms aggregation arms, plus provider reframing and logging-on/off benchmarks | no silent loss or normal result from partial speech; every overflow produces a content-free receipt and the normal-load oldest-frame-age gate is met |
| T03 | Add idempotent host durable ownership: append session/sequence/profile to a bounded WAL, sync according to the written durability contract, then acknowledge; replay after process/power loss without double-processing. | crash matrix at before-write, after-write/before-ack, after-ack, reconnect, and WAL-full points | every acknowledged frame exists once after restart; unacknowledged replay is ordered and safe; raw audio retention follows policy |
| T04 | Build a progress supervisor for capture, subscription, host transport, provider, reducer, UI, and playback. Separate `connected`, `subscribed`, `accepted`, `durable`, and `completed`; enforce restart budgets and a visible degraded/error state. | fixtures for connected-unsubscribed, stale socket, one-channel stall, provider hang, empty-200, no audible playback, and worker kill | no indefinite listening/thinking/replying state; the documented fallback is emitted within the project deadline |
| T05 | Define PTT and optional wake/VAD boundaries with a bounded pre-roll, post-roll, authoritative button release, and final-audio-before-end ordering. Compare no-VAD, Silero/WebRTC host VAD, and ESP-SR AFE/VAD on the same consented/synthetic corpus. | first-phoneme, final-phoneme, silence, double-press, echo, noise, and wake-from-sleep fixtures with boundary timestamps | zero unexplained boundary loss in fixtures; selected profile clears false-start/miss/latency gates and can abstain |
| T06 | Put in-process local STT/TTS and localhost/self-hosted streaming services behind one provider adapter: readiness identity, partial/final ordering, deadlines, cancellation, bounded output, and typed `success/silence/timeout/failure/config_error`. Keep release behavior local by default; isolate any authorized remote experiment behind explicit provider/process/request gates. | adapter conformance harness with a fake stream plus each installed local candidate; WAN-block release run; separate consent/egress tests for the Deepgram batch experiment | identical canonical events/receipts across adapter shapes; release succeeds with WAN blocked and no unapproved audio egress; the remote experiment cannot run or become a fallback without all gates |
| T07 | Run an AFE bake-off before adding MCU/XMOS complexity: raw USB/ALSA baseline, candidate processed channel, and optional ESP-SR profile, all with exact firmware/library/model identity. | frozen near/far/noise/echo corpus; latency, clipping, SNR proxy, STT CER/WER, CPU/RSS, power, and thermal receipts | adopt an edge AFE only if end-to-end quality/latency/power improves without hiding raw bypass or breaking update/recovery |
| T08 | Specify and test update/recovery for Pi app/OS and every edge firmware: external signing, key rotation/revocation, manifest identity, anti-rollback policy, A/B or safe mode, boot-attempt counter, physical recovery, and no update during a session. | repeated normal/corrupt/wrong-board/power-cut/update-while-capturing matrix with version/readiness readback | old or new known-good image becomes ready; no false reading, secret in Git, or unrecoverable board |
| T09 | Measure whole-device power, thermal, and acoustic behavior rather than chip figures: idle/listen/STT/UI/playback/update, logging on/off, sealed enclosure, charging, weak supply, and an eight-hour plus repeated-turn soak. | synchronized current, temperature, throttle, xrun/drop, queue-age, latency and audible-output record keyed by build/profile | no unsafe temperature, progressive latency/loss, codec lock, or false-ready; MCU addition must clear the existing system-energy gate |
| T10 | Make privacy and human truth a release gate: physical mute electrical test, visible capture/degraded state, data-flow inventory, WAN-block and packet inspection, content-free operational receipts, dev-only consented raw capture, and independent unavailable states for content/delivery/timing. | factory fixture plus release checklist and canonical UI trace in both shells | mute prevents samples at the acquisition boundary; no forbidden egress/storage; UI never fabricates emotion/context or success from missing evidence |

These tasks are ordered by dependency, not by perceived glamour. T01-T06 can be
completed on laptop/Pi before a custom board. T07 determines whether an audio
coprocessor earns its cost. T08-T10 are product gates, not cleanup after EVT.

## Closed Or Surface-Only Products

- **Friend:** the official BasedHardware GitHub lineage redirects to Omi. There
  is no separate current official Friend firmware/hardware baseline to count as
  independent evidence. Old third-party forks must not be used to claim current
  behavior.
- **Limitless Pendant:** no official public MCU firmware, editable PCB/BOM, or
  device transport implementation was found in the official material reviewed.
  Official help/product behavior may inform UX questions, but it cannot support
  code, buffer, OTA, power, or privacy implementation claims. Omi
  [#7841](https://github.com/BasedHardware/omi/issues/7841) is evidence about an
  Omi integration with a Limitless device, not evidence about Limitless firmware.
- **Typeless:** it is useful as the user's product metaphor—turning base STT into
  a polished input product—but this review found no official open wearable/
  desktop hardware firmware and PCB baseline to audit. Surface behavior cannot
  establish its audio routing, model, cache, privacy, or latency implementation.

Those products may be studied in a separate product-experience comparison, with
every observation labeled as surface behavior. They are excluded from the code
matrix above.

## Evidence Limits And Open Questions

- This was source archaeology, not a build matrix. No upstream firmware was
  compiled, flashed, or exercised on a physical board in this review.
- No model, microphone, speaker, battery, thermal, OTA, or network measurement
  in this document is a Jiko result. Vendor and issue numbers are labeled by
  source and version.
- GitHub issues are failure reports, not prevalence estimates. Closed issues may
  be fixed; open issues may be configuration-specific. They remain valuable as
  regression fixtures.
- Code inspection cannot prove electrical mute, RF behavior, acoustic quality,
  secure boot, or power-loss recovery. Those require schematic/net inspection
  and physical tests.
- Repository absence is time-scoped to this review. It does not prove a vendor
  has no private implementation or will never publish one.
- The disabled Deepgram batch adapter is the only implemented remote boundary,
  but live remote execution is not currently approved; see
  [Remote Audio Policy](remote-audio-policy.md). Doubao/Volcengine and other
  remote routes remain design candidates until a specific policy decision; no
  remote provider may be a silent fallback, and local/self-hosted remains the
  default.
- The final product meaning of content/emotion/context remains open. Current
  engineering can validate content, delivery, and timing signals and expose
  uncertainty. It must not rename those measurements into a stronger human
  interpretation.
