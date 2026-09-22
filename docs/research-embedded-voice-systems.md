# Embedded Local Voice Systems Research

**Status:** design research and provisional decision gates

**Reviewed:** 2026-09-18

**Scope:** ESP32-S3, Raspberry Pi 5 / CM4 / CM5, board-level audio, local voice pipelines, recovery, update, power, and production test for Jiko

**Policy:** local/self-hosted speech is the product default. A paid remote
challenger is permitted only behind a global capability flag plus explicit
per-session consent; it is never a silent fallback or evidence for offline
operation.

This note complements [the hardware compute decision](hardware-compute-decision.md), [the instrument runtime design](instrument-runtime-design.md), and [the benchmark plan](benchmark-plan.md). It does not change the shared-core/two-shell architecture: hardware-specific capture, GPIO, watchdog, and update code stays behind adapters at the edge; both product shells continue to drive the same event protocol and shared reading core.

Here, local/self-hosted includes the current user-controlled laptop shell and a
configured user-controlled host. The long-range self-contained Jiko One target
is stricter: its normal audio stays on the instrument's Pi/CM-class computer and
the core turn completes with WAN blocked. Research references that call a
nearby PC or LAN service “local” do not, by themselves, meet that later gate.

## Decision in one page

This voice-system study is complemented by the
[audio instrument and production systems study](research-audio-instrument-production-systems.md).
Bela and Sound Open Firmware add two constraints that assistant projects often
under-specify: prove Linux capture isolation/xrun behavior before adding an MCU,
and admit a device only when driver, firmware, topology/channel map,
calibration, board, app, and model revisions form one compatible tuple.

1. **Keep open-ended speech on Linux.** Jiko's bilingual, open-ended STT, feature extraction, three-reading core, receipt, UI, update, and recovery belong on Pi 5 during development and on CM5 for an integrated product. An ESP32-S3 can run a small command grammar with Espressif MultiNet, but that is not a substitute for open-ended transcription.
2. **Do not add an ESP32 just because voice products often have one.** A push-to-talk instrument does not need an always-listening wake-word coprocessor. Add ESP32-S3 only when a measured Linux-only prototype fails a specified audio-integrity, acoustic-quality, power, or fault-response gate below.
3. **Use a replaceable audio module before designing audio electronics.** Start with class-compliant USB audio on Pi 5. Qualify ReSpeaker Lite for a two-microphone prototype and XVF3800 for a far-field/AEC experiment, retaining both raw and processed channels in development. Pin the exact DSP firmware and host configuration.
4. **Prefer CM5 with eMMC for EVT; benchmark CM4 rather than assuming it is enough.** CM4 remains a cost/thermal candidate only if it clears the same frozen corpus, latency, thermal, and soak gates. Start CM5 sizing at 4 GB RAM and 16 GB or larger eMMC; move to 8 GB only if measured peak working set leaves less than 25% memory headroom.
5. **The first custom board should be a CM5 carrier, not a new compute platform.** Freeze audio, display, power, service, and recovery interfaces on development modules first. A custom microphone/DSP board comes later only if a module A/B test proves an enclosure, quality, cost, or supply-chain limit.
6. **Treat update and recovery as part of the instrument.** Linux needs a verified A/B OS flow plus a hardware watchdog; ESP firmware needs rollback/safe-mode recovery; DSP binaries need version and hash inventory. A process that is alive but making no audio progress is unhealthy.

The practical default is therefore:

```text
button / mute / microphones
          │
          ▼
replaceable USB or I2S audio edge
          │  sequence-numbered PCM; explicit gap/overflow events
          ▼
Pi 5 development → CM5 eMMC product candidate
          │
          ├─ capture + normalize + VAD/endpointing
          ├─ local bilingual STT and acoustic features (parallel)
          ├─ shared Jiko core → three readings + receipt
          ├─ UI + fixed clips / local TTS
          └─ supervision, telemetry, A/B update, recovery

optional ESP32-S3 only after a gate is crossed:
GPIO timestamps, LED/haptic, I2S capture, bounded ring, AFE/VAD/KWS,
power sequencing, progress watchdog — never product truth or open-ended STT
```

## What the mature systems actually demonstrate

### Home Assistant Voice Preview Edition and ESPHome

[Home Assistant Voice Preview Edition](https://www.home-assistant.io/voice-pe/) is the closest current open hardware reference for the split Jiko is considering. It combines an ESP32-S3 with 16 MB flash and 8 MB PSRAM, an XMOS XU316 audio processor, two microphones, a speaker/output codec, and a physical microphone power cut. XMOS handles AEC, stationary-noise removal, and gain control; ESP32 runs the device protocol; open-ended recognition runs on the Home Assistant host. The [schematic](https://voice-pe.home-assistant.io/resources/home_assistant_voice_pe_schematic_v1.0_241009.pdf) and [datasheet](https://voice-pe.home-assistant.io/resources/home_assistant_voice_preview_edition_datasheet_v1_1.pdf) make the separation concrete.

The reusable lesson is the boundary, not a requirement to copy every chip:

- deterministic capture, mute, light ring, and front-end audio work can live at the edge;
- intent, open-ended STT, TTS selection, and product state live on the stronger host;
- physical mute should remove microphone power rather than rely only on software state;
- a DSP is justified by simultaneous loudspeaker playback/far-field capture, not by the word “voice.”

[ESPHome's voice assistant component](https://esphome.io/components/voice_assistant/) streams microphone audio to the host and can pair it with on-device `micro_wake_word`. The documentation explicitly warns that audio and voice components consume substantial RAM/CPU and may conflict with other components such as BLE. In the implementation documented on 2026-09-17, [the voice-assistant source](https://api-docs.esphome.io/voice__assistant_8cpp_source) uses 16 kHz mono audio, 32 ms send chunks, a 512 ms ring, and a bounded speaker buffer. Those are useful starting points for a spike, not universal product constants.

Home Assistant's [Assist pipeline](https://developers.home-assistant.io/docs/voice/pipelines/) also provides a good event vocabulary: wake-word, STT, intent, and TTS stages have explicit start/end events and typed errors. It recommends client-side VAD to avoid sending needless audio. Jiko should borrow the observable stage semantics while keeping its much smaller instrument protocol; it should not inherit Home Assistant's broad assistant domain or its generous overall timeout.

The [2025 voice architecture update](https://www.home-assistant.io/blog/2025/06/25/voice-chapter-10/) is further evidence for a split: ESPHome optimized several concurrent edge workloads, while Home Assistant still distinguishes constrained local commands from open-ended local speech that needs higher compute. Home Assistant's [local voice guide](https://www.home-assistant.io/voice_control/voice_remote_local_assistant) reports approximately eight seconds for a Whisper command on Pi 4 versus under a second on an Intel NUC, and about 1.6 seconds of Piper audio generated per second on Pi-class hardware. These are orientation points only; they use different models, utterances, and software from Jiko and cannot be acceptance evidence.

### Willow

[Willow](https://github.com/HeyWillow/willow) is a useful ESP32-S3 architecture reference. Its [pipeline description](https://heywillow.io/how-willow-works/) uses Espressif ADF/SR for I2S, AFE, wake word, VAD, and optional AMR-WB streaming. It exposes two materially different modes:

- server mode streams an utterance to a stronger inference server, receives text/JSON, and invokes an endpoint;
- device-local mode runs MultiNet and returns one item from a fixed command set.

That distinction is decisive for Jiko: a successful ESP32 demo of ten or 200 commands does **not** establish feasibility for free-form Mandarin/English/code-switched readings. Willow's [application server](https://heywillow.io/components/willow-application-server/) is more relevant for its operational pattern: central configuration, cached firmware, OTA initiation, and a recovery flasher. Moving integration logic off the MCU reduces device-state complexity.

Historic Willow inference-server [Raspberry Pi 4 results](https://github.com/toverainc/willow-inference-server#benchmarks) put a 3.84-second sample through `faster-whisper` in roughly 3.33 seconds with `tiny`, 6.21 seconds with `base`, and much longer with larger models in that particular 2023-era setup. Model load was excluded. These numbers reinforce the need for current Jiko measurements; they must not be used to size the product.

### Wyoming and the Rhasspy lineage

The maintained [Wyoming protocol](https://github.com/OHF-Voice/wyoming) is a compact reference for moving PCM and typed voice events between processes. A JSON-line header declares the event and exact byte lengths, followed by optional JSON data and binary payload. Its vocabulary covers audio start/chunk/stop, wake, VAD, STT, TTS, and satellites. This is worth learning from for Jiko's adapter boundary.

Two constraints matter:

- Wyoming deliberately provides no authentication or encryption, so it belongs on loopback, a Unix socket, or a trusted isolated link—not on an exposed LAN;
- a generic network voice bus is larger than Jiko needs. Jiko should keep the existing narrow event schema and add only sequence, timing, gap, and device-health fields that benchmarks require.

The current [OHF Linux Voice Assistant](https://github.com/OHF-Voice/linux-voice-assistant) supersedes older satellite examples and demonstrates ARM64 Linux capture, local wake-word options, WebRTC audio preprocessing, and an ESPHome-compatible host path. Its audio-server guide recommends [PipeWire configuration](https://github.com/OHF-Voice/linux-voice-assistant/blob/main/docs/install_audioserver.md) and calls out headless service/session details. It is explicitly experimental, so it is a source of patterns rather than a Jiko runtime dependency.

The older [Rhasspy 3 repository](https://github.com/rhasspy/rhasspy3) and [Wyoming Satellite](https://github.com/rhasspy/wyoming-satellite) are archived. Their service decomposition and `systemd` examples remain educational, but new product code should use maintained OHF components or copy only small protocol ideas.

### Mycroft and OpenVoiceOS

[Mycroft Core](https://github.com/MycroftAI/mycroft-core) was archived in 2024 and says it is no longer maintained. It should not become a new dependency.

The archived runtime is separate from the value of the [Mark II hardware
release](https://github.com/MycroftAI/hardware-mycroft-mark-II/tree/f416bf342547c56f575e91eb9acb2df50f1f8a16).
Its editable production files and [PCBA programming/test
jig](https://github.com/MycroftAI/hardware-mycroft-mark-II/blob/f416bf342547c56f575e91eb9acb2df50f1f8a16/mark-II-Rpi-devkit/code/TestingJig/mycroftPCBAprogramAndTest.py)
are useful factory references: program the board, query peripheral firmware,
exercise mute/buttons, and close one microphone-to-speaker loop. Jiko should
adopt that artifact/fixture discipline while replacing its broad exception
handling and single-phrase pass/fail with typed, quantitative receipts. The
repository root does not provide a clear license for copying the complete
hardware package, so it remains a research reference until clarified.

[OpenVoiceOS Core](https://github.com/OpenVoiceOS/ovos-core) is the maintained successor worth studying. Its [installation architecture](https://github.com/OpenVoiceOS/OpenVoiceOS/blob/main/docs/installation.md) separates message bus, listener, core, audio/TTS, GUI, and hardware abstraction into independently supervised processes. [Dinkum Listener](https://github.com/OpenVoiceOS/ovos-dinkum-listener/blob/dev/README.md) makes the audio state machine explicit—microphone, optional pre-wake VAD, wake word, recording, endpointing, STT—and exposes bounded settings such as start-speech, end-silence, no-speech, and maximum recording timeouts.

Jiko should borrow process ownership, plugin seams, and supervision, but not the general-assistant skill/message-bus model. The [OVOS message bus](https://github.com/OpenVoiceOS/ovos-messagebus) broadcasts broadly and has no built-in authentication; it is too permissive for the instrument's core boundary. The Jiko event protocol should remain smaller, typed, and local.

### Espressif ESP-SR and ESP-DSP

[ESP-SR](https://github.com/espressif/esp-sr) provides the credible ESP32-S3 edge capabilities:

- [AFE](https://docs.espressif.com/projects/esp-sr/en/latest/esp32s3/audio_front_end/README.html): acoustic echo cancellation, noise suppression, beam/source separation, VAD, AGC, and WakeNet, with fixed-frame feed/fetch APIs;
- [WakeNet](https://docs.espressif.com/projects/esp-sr/en/latest/esp32s3/wake_word_engine/README.html): bounded wake-word detection;
- [MultiNet](https://docs.espressif.com/projects/esp-sr/en/latest/esp32s3/speech_command_recognition/README.html): up to 200 configured Chinese/English commands, documented at under 500 ms, using 16 kHz, 16-bit mono input;
- a constrained Chinese speech synthesizer, not a general bilingual product TTS engine.

Espressif's current [ESP32-S3 benchmark table](https://docs.espressif.com/projects/esp-sr/en/latest/esp32s3/benchmark/README.html) is useful for capacity estimates. Depending on AFE/model configuration, it reports roughly:

| Vendor benchmark item | Internal RAM | PSRAM | Frame compute |
|---|---:|---:|---:|
| speech-recognition AFE, one mic + reference | 49–60 KB | 740–776 KB | about 9% feed + 10% fetch of one core |
| speech-recognition AFE, two mic + reference | 68–79 KB | 1.15–1.24 MB | about 24–30% feed + 23% fetch of one core |
| WakeNet9, two channel | 16 KB | 324 KB | about 3 ms per 32 ms frame |
| MultiNet7 | 18 KB | 2.92 MB | about 11 ms per 32 ms frame |

These are Espressif board/model measurements, not a Jiko enclosure benchmark. They do show why PSRAM bandwidth, fixed frame cadence, task scheduling, and spare CPU must be treated as first-class constraints. The [ESP-SR changelog](https://github.com/espressif/esp-sr/blob/master/CHANGELOG.md) contains past ring-buffer, overflow, and memory-leak fixes; Jiko must pin an ESP-IDF/ESP-SR version and soak that exact build.

Use an official board to separate algorithm feasibility from custom-PCB
failures. [ESP32-S3-Korvo-1](https://docs.espressif.com/projects/esp-board-manager/en/latest/references/boards/esp32_s3_korvo_1.html)
provides a three-microphone array, codec, speaker/headphone, SD, and battery
input; the [Korvo-2
BSP](https://github.com/espressif/esp-bsp/tree/73ee07b1ad56f865f13a2739be8bb6808c1da58a/bsp/esp32_s3_korvo_2)
tracks board revisions. A pinned Korvo-2 + ESP-SR build is the MCU AFE/KWS/
command-word control in the matrix. It is not evidence that open-ended bilingual
STT or the Jiko reading core belongs on an ESP32.

[ESP-DSP](https://github.com/espressif/esp-dsp) supplies optimized FFT, FIR/IIR, vector, and matrix primitives with portable reference implementations. It can accelerate level/spectral features at the edge. It is not an STT engine and should not become a second implementation of the Jiko reading core.

### ReSpeaker and Seeed audio modules

[ReSpeaker Lite](https://github.com/respeaker/ReSpeaker_Lite) combines a two-microphone board, XMOS XU316, AEC/noise processing, USB or I2S output, and a TLV320AIC3204 codec. Its repository publishes several distinct firmware variants, including USB, I2S, and a microWakeWord-oriented I2S channel layout. This makes it a strong prototype module and a warning: the exact firmware changes the channel contract.

[ReSpeaker XVF3800 USB 4-Mic Array](https://github.com/respeaker/reSpeaker_XVF3800_USB_4MIC_ARRAY) adds four microphones, beamforming/direction, AEC, VAD, noise suppression, dereverberation, USB audio, and host controls. The repository includes a [DFU procedure](https://github.com/respeaker/reSpeaker_XVF3800_USB_4MIC_ARRAY/blob/master/xmos_firmwares/dfu_guide.md) and [host-control/version query](https://github.com/respeaker/reSpeaker_XVF3800_USB_4MIC_ARRAY/blob/master/host_control/README.md). That makes version-pinned provisioning and factory verification possible.

It does not remove qualification work. Current public reports include [multi-channel mapping differences](https://github.com/respeaker/reSpeaker_XVF3800_USB_4MIC_ARRAY/issues/24) and [a USB capture failure report](https://github.com/respeaker/reSpeaker_XVF3800_USB_4MIC_ARRAY/issues/26). These issues are not proof of a systemic fault, but they are sufficient reason to run long capture, unplug/re-enumeration, and firmware-matrix tests. The legacy [Seeed voice-card Pi HAT driver](https://github.com/respeaker/seeed-voicecard) depends on an older out-of-tree kernel path and should not be the CM5 production baseline.

### Raspberry Pi 5, CM4, and CM5

The official [Compute Module documentation](https://www.raspberrypi.com/documentation/computers/compute-module.html) positions CM4 and CM5 for carrier-board products. CM4 uses a four-core Cortex-A72-class BCM2711 up to 1.5 GHz; CM5 uses the Cortex-A76-class BCM2712 up to 2.4 GHz and offers up to 16 GB RAM. Both have eMMC variants; CM5 offers 16/32/64 GB eMMC options. CM5 is the safer performance candidate for a local STT kiosk, while CM4 deserves a measurement-based cost/thermal comparison.

For Jiko, choose an eMMC module rather than a Lite/microSD product configuration. Raspberry Pi documents eMMC reliability features and production programming flows, while removable media adds connector and field-corruption variables. Pin the EEPROM bootloader version and configuration; do not allow an uncontrolled production image to follow the newest channel.

Power and thermal behavior must be measured as a whole product. Raspberry Pi's own [Pi 5 overview](https://www.raspberrypi.com/news/16gb-raspberry-pi-5-on-sale-now-at-120/) describes roughly 2–3 W idle and under 10 W fully loaded for the bare platform. The [thermal engineering note](https://www.raspberrypi.com/news/heating-and-cooling-raspberry-pi-5/) shows that sustained workloads can require active cooling to avoid throttling. CM5 IO documentation also distinguishes a 5 V/5 A supply from a 5 V/3 A mode with a restricted peripheral budget. None of these numbers includes Jiko's display, amplifier, microphones, LEDs, or regulator loss.

Raspberry Pi provides EEPROM bootloader A/B plus [`autoboot`/`tryboot`
selection primitives](https://github.com/raspberrypi/documentation/blob/master/documentation/asciidoc/computers/config_txt/autoboot.adoc).
Those primitives are not a complete signed OS/rootfs/app updater. Jiko still
has to select and prove its partition layout, bundle verification, health
marking, and loss-of-power rollback. For factory provisioning, the official [CM5 Programming Jig](https://www.raspberrypi.com/documentation/accessories/cm5-programming-jig.html) provides repeatable carrier-less flashing and security provisioning; it complements rather than replaces Jiko's audio/display/button functional fixture.

## Proposed Jiko compute split

| Concern | Linux main compute: Pi 5 / CM5 | Optional ESP32-S3 edge | Audio DSP / codec |
|---|---|---|---|
| Product truth and session state | owns | mirrors only | none |
| Push-to-talk lifecycle | authoritative state machine and receipt | debounced edge/timestamp, immediate feedback | none |
| PCM capture | ALSA/PipeWire owner in the first prototype | optional I2S owner after gate | converts/processes samples |
| Buffering | bounded host queue and utterance buffer | short pre-roll/transport ring only | implementation-specific FIFO |
| VAD/endpoint | authoritative, especially for metrics | optional early VAD; never silently truncates | optional signal flag |
| Wake word | absent for the initial PTT product | optional future WakeNet/microWakeWord | optional front-end assist |
| Open-ended bilingual STT | owns | never | never |
| Fixed command fallback | may own | optional small MultiNet recovery grammar | never |
| Acoustic features/readings | owns reference implementation | optional primitive acceleration only after parity test | AEC/NS/AGC only |
| Three readings and receipt | owns shared core | never | never |
| TTS / fixed prompts | local TTS and product assets | at most a fault tone | playback path only |
| UI / manual demo | owns; same event protocol as real capture | GPIO/LED actuator only | none |
| Update | A/B OS/app and health confirmation | signed/versioned OTA with rollback | version-pinned DFU |
| Watchdog | service + hardware progress watchdog | task + hardware watchdog | host verifies heartbeat/version |
| Secrets / user audio | bounded local handling; no raw recordings in repo/logs | no persistence | no persistence |

### Why the initial product should remain push-to-talk

KWS adds continuous capture, false-accept/false-reject tuning, playback echo handling, privacy indication, and idle power. None of that helps a deliberate instrument button interaction. Push-to-talk gives a physical session boundary and lets fixed acknowledgment audio/lighting happen immediately. Add wake word only after product research establishes a hands-free requirement and a frozen noisy-room corpus can support a published FAR/FRR target.

### Proposed capture and backpressure contract

Normalize the model-facing stream once to **16 kHz, signed 16-bit, mono**. Keep higher-rate/raw/multichannel streams available only in development builds for acoustic qualification. At 16 kHz mono:

- PCM rate is 32,000 bytes/s;
- a 32 ms frame is 512 samples or 1,024 bytes;
- a 512 ms ring is 16 KiB mono or 32 KiB for two channels.

Those values align with ESPHome's current implementation and are a sensible first spike. Jiko must benchmark 256/512/1,024 ms edge rings rather than canonize 512 ms prematurely.

Every frame should carry `session_id`, monotonically increasing `sequence`, sample count, sample-clock position, and capture monotonic timestamp. The receiver reports:

- missing/duplicate/out-of-order frame count;
- ALSA/PipeWire xrun count;
- edge ring high-water mark and overflow count;
- host queue depth and oldest-frame age;
- clock discontinuity and device re-enumeration;
- the exact DSP/MCU firmware and audio-format contract.

Use a bounded host admission queue—start the spike at 64 × 32 ms frames, or 2.048 seconds / 64 KiB mono. The capture task must not wait on STT, UI, disk, logging, or networking. If downstream cannot recover before the edge/host buffers fill, emit a typed `audio_overrun`, mark the attempt invalid, stop it cleanly, and invite a retry. Never silently overwrite the oldest speech and never convert a partial utterance into a normal reading.

Queue capacity is not latency permission. Treat 2.048 seconds as fault
containment, while starting the normal-load `oldest_frame_age` admission gate
at a provisional 120 ms and tuning it from trace evidence. A queue that is not
full can still violate the user-facing deadline.

For the PTT path, button release is authoritative; VAD may trim trailing silence only within a measured safety margin. For any future KWS path, the edge ring supplies pre-roll so the wake word does not remove the first syllable. A full ten-second utterance belongs in bounded Linux memory, not MCU PSRAM.

### Linux scheduling and service ownership

Use separate supervised processes (or strictly isolated workers) for capture, inference, and UI/core:

1. the capture worker owns one audio device and the real-time-paced queue;
2. normalization fans one canonical utterance to STT and feature extraction in parallel;
3. the shared core waits for declared inputs, produces the three readings and receipt, and never imports ALSA/ESP libraries;
4. the UI shell renders typed stage/progress/error events;
5. a supervisor observes **progress**—sample counter, completed turn counter, queue age—not only process liveness.

Start with normal Linux scheduling and measured load isolation. Escalate priority or CPU affinity only after tracing demonstrates missed deadlines, because an incorrectly configured real-time inference process can starve capture. PipeWire is convenient for flexible devices; direct ALSA can reduce variables in an appliance. Select by xrun/recovery evidence, not preference.

## Latency budget and measurable acceptance criteria

The following values are **Jiko engineering targets**, not claims from the upstream projects. The primary scenario is a warmed model, a released push-to-talk button, an utterance of at most ten seconds, and no network dependency.

The 50 ms / 80 ms acknowledgment numbers below are an internal device-response
budget for hardware comparison. The broader human-perception hypothesis remains
p95 <= 100 ms with a 200 ms hard ceiling. They are nested targets, not two
competing product SLOs, and neither is frozen until physical-device testing.

| Observable | Provisional gate | Measurement boundary |
|---|---:|---|
| button-down to visible/haptic acknowledgment | p95 ≤ 50 ms; p99 ≤ 80 ms | GPIO/input event to rendered/light transition |
| button-up to processing indication | p95 ≤ 100 ms | input event to UI event |
| release-to-final reading, warmed normal path | p95 ≤ 2.5 s; p99 ≤ 3.5 s | monotonic button-up to committed UI reading |
| release-to-explicit fallback/error | p95 ≤ 4.0 s | no indefinite spinner |
| dynamic local TTS first audio, if enabled | p95 ≤ 800 ms after reading | reading commit to first non-silent output |
| fixed acknowledgment clip | p95 ≤ 100 ms | request event to first non-silent output |
| audio integrity | zero silent frame loss in 10,000 turns | sequence/xrun counters and injected marker |
| service recovery after worker kill | ready ≤ 10 s; no false result | kill to health-confirmed ready |
| cold boot to PTT-ready | record p50/p95; initial gate ≤ 45 s | power-good to accepted button-down |

Suggested critical-path budget inside the 2.5-second p95 gate:

| Post-release stage | Budget | Notes |
|---|---:|---|
| edge drain, seal, final sequence check | 80 ms | includes no hidden retransmit loop |
| normalization and worker admission | 120 ms | bounded queue; warmed worker |
| local STT finalization | 1,600 ms | critical branch |
| features | 250 ms | runs parallel with STT |
| reading/core composition | 200 ms | deterministic shared core |
| event delivery and render | 100 ms | both shells use same event path |
| contingency | 400 ms | sums to a 2.5 s envelope |

For a batch recognizer, a ten-second utterance must achieve p95 real-time factor near **0.16 or better** to fit the 1.6-second STT allocation. A streaming recognizer may instead process during capture, but its backlog at release plus finalization must stay within 1.6 seconds. Record model load separately; production keeps the chosen STT model warm.

Do not report only an average end-to-end number. Emit stage timestamps and report p50/p95/p99, cold/warm, utterance duration, model/version, thermals, throttling state, queue high-water marks, and whether the audio DSP used raw or processed channels.

## Hardware decision gates

### CM4 versus CM5

Benchmark Pi 5 first as the development control, then the exact CM4 and CM5 RAM/eMMC SKUs. CM4 is acceptable only if it clears **all** of these on the frozen product image and enclosed thermal prototype:

- warmed release-to-reading p95 ≤ 2.5 s and p99 ≤ 3.5 s for every required language/noise cell;
- zero unexplained audio gaps or invalid-but-accepted turns in 10,000 cycles;
- no sustained frequency throttling during an eight-hour mixed UI/STT/playback soak;
- peak working set ≤ 75% of physical RAM and storage headroom ≥ 25%;
- steady-state CPU has at least 25% headroom at the p95 product load;
- update, rollback, cold boot, and fault recovery meet the same gates as CM5;
- its measured landed cost or representative duty-cycle energy is at least 20% better than CM5. A small paper saving is not worth a second performance tier.

If CM4 misses any functional gate, select CM5. For CM5, 4 GB is the starting SKU; select 8 GB only when the complete kiosk plus warmed models crosses the 75% memory ceiling or when model concurrency produces repeatable OOM pressure. Use eMMC in either case.

### When an ESP32-S3 earns a place

Keep the first prototype Linux-only. Add an ESP32-S3 only if it clears at least one primary gate and all non-regression gates.

Primary gates—one is enough to justify an experiment:

- **Integrity:** Linux-only capture has >0.1% invalid turns under the frozen load/fault suite, and the MCU path reduces this to zero silent-loss events in 10,000 turns.
- **Acoustic:** ESP-SR/XMOS processing improves the frozen noisy/echo corpus by ≥15% relative keyword error or CER, or ≥6 dB median echo-return-loss enhancement, without degrading quiet-room CER by more than 2% relative.
- **Power:** an MCU-controlled ready/sleep design lowers whole-device representative duty-cycle energy by ≥20% while button acknowledgment stays ≤50 ms and full PTT readiness returns ≤200 ms. Merely moving GPIO while Linux remains on does not qualify.
- **Fault response:** during forced Linux hangs, physical mute state and button/light acknowledgment remain correct within 50 ms, and recovery never yields a false reading from stale audio.

Non-regression gates—all are required:

- wired audio/control inside the product; do not stream internal PCM over Wi-Fi;
- 10,000-turn and eight-hour soak with zero silent gaps, deadlocks, or unrecovered ring overflow;
- signed/version-pinned firmware, rollback, and a documented recovery/programming path;
- a named owner for the MCU protocol, build, factory flash, and field update;
- BOM, boot, fault, and firmware complexity recorded in the product decision, not hidden in a demo adapter;
- Linux can identify an incompatible or unhealthy edge and show a typed unavailable/retry state.

MultiNet may be used for an explicitly small offline recovery grammar such as “cancel” or a factory command, but its output must enter the same event protocol and must never masquerade as the open-ended STT result.

### When to design a carrier board

A CM5 carrier is justified only after:

- exact display, USB/I2S audio, amplifier, mute, button, service connector, storage, and power budgets are frozen;
- three identical development stacks each pass a 24-hour thermal soak and at least 10,000 automated turns;
- the intended eMMC image passes 100 update/rollback cycles and at least 20 randomized power interruptions across download, install, first boot, and health confirmation;
- maximum input/current transients and cooling solution are measured in the intended enclosure;
- a factory provisioning and functional-test design exists;
- integration removes a concrete enclosure/connector/supply constraint or improves landed cost by at least 20% at forecast volume.

This is a carrier-board decision, not permission to fork the shared core into firmware.

### When to design the microphone/DSP board

First A/B at least one USB two-mic path and, if far-field/AEC is required, a four-mic/DSP path using the same corpus and enclosure. Design custom audio electronics only when:

- microphone geometry and speaker location are locked;
- a module fails a specified acoustic, latency, power, size, lifecycle, or unit-cost gate;
- raw/processed recordings from consented or synthetic tests identify the electrical/acoustic bottleneck rather than STT/model error;
- the team can own codec clocks, I2S/TDM routing, echo reference, RF coupling, ESD/EMC, calibration, DFU, and production limits;
- a golden-unit fixture and pilot yield target are defined.

## Benchmark plan

### Frozen matrix

Run the same image, models, event trace, and corpus across:

- Pi 5 control, CM5 4 GB/eMMC, CM4 4 GB/eMMC; add CM5 8 GB only if memory warrants it;
- baseline USB UAC capture, ReSpeaker Lite raw/processed, XVF3800 raw/processed, and pinned Korvo-2 + ESP-SR AFE control;
- quiet, 55 dBA and 65 dBA stationary noise; nearby competing speech; playback echo at two speaker levels; fan noise; handling noise;
- 0.3 m, 1 m, and the product's claimed maximum distance; front/off-axis positions;
- Mandarin, English, code-switching, short/long utterances, numbers, units, and the product's critical vocabulary;
- idle UI, animation, local TTS/playback, update download, storage pressure, and sustained inference load;
- open bench and closed enclosure at the allowed ambient-temperature extremes.

The test corpus must be synthetic, licensed, or explicitly consented and stored outside the repository when it could identify a real person. Do not commit raw recordings or real-person transcripts.

### Metrics

Measure:

- WER/CER, code-switch token accuracy, numeric/unit accuracy, and critical-keyword preservation;
- VAD onset/offset error, clipped leading/trailing speech, false endpoint, and no-speech behavior;
- channel RMS/noise floor, clipping, SNR, AEC ERLE, and raw-versus-processed delta;
- frame gaps, duplicates, sequence discontinuities, xruns, queue/ring high-water marks, and recovery time;
- stage p50/p95/p99, STT RTF or streaming backlog, fixed-clip onset, TTS first audio and RTF;
- CPU per process, RSS/PSRAM, temperature, frequency/throttle flags, storage writes, and wall energy;
- boot-to-ready, device re-enumeration, process restart, rollback, and update-health confirmation.

Never mix unsupported turns into the accuracy denominator as if they were bad transcripts only. Report `audio_invalid`, `stt_unavailable`, `timeout`, and `fallback_used` separately, then report user-visible success as a second aggregate.

### Soak and fault injection

Use [labgrid](https://github.com/labgrid-project/labgrid/tree/b3e7b8769d0d02c27c663dc48aa7b288eaba04c3)
for the complete Pi/CM DUT, controllable power/USB, serial/SSH, audio fixtures,
and instruments. Use
[pytest-embedded](https://github.com/espressif/pytest-embedded/tree/5177fb45918c7e768562fa67a8d229026636622c)
for ESP-IDF flashing, serial/JTAG, emulation, and multi-DUT tests. Both are test
infrastructure at the hardware edge; neither may create a second product event
protocol or import board types into the shared core. Every HIL receipt binds DUT
serial/hardware revision, image/model/MCU/DSP hashes, fixture/calibration
version, ambient conditions, stage timestamps, and typed outcome.

The automated rig should cover at least 10,000 PTT turns and a continuous eight-hour mixed workload before any architecture gate. Treat eight hours as architecture screening, 24 hours as an EVT gate, and 72 hours or a representative duty-cycle campaign as a DVT gate. Inject:

- STT worker kill/hang/OOM and UI restart;
- USB unplug, replug, reset, channel-map change, and codec/DSP reboot;
- ALSA/PipeWire xrun and forced consumer slowdown until ring overflow;
- absent network, bad clock, full log partition, read-only storage, and corrupted/missing model;
- optional ESP reset, stale sequence, firmware mismatch, and host/edge clock discontinuity;
- Pi reboot and randomized power loss during every update phase;
- thermal saturation and supply droop during display plus amplifier plus inference peaks.

Acceptance requires a typed, bounded outcome, no fabricated reading, no indefinite spinner, and no raw-audio persistence. A watchdog reset without a persisted reason and preceding progress counters is a diagnosability failure.

Zero failures in 10,000 independent trials gives only an approximate one-sided
95% upper bound of `3 / 10,000` per turn (the rule of three); it does not prove
99.99% production reliability. Report trial count, failures, confidence bound,
and correlated/soak conditions. A `1e-4` target needs roughly 30,000 zero-failure
independent trials for a comparable bound, plus ageing and environmental work.

## Reliability and update design

### Watchdogs

ESP-IDF provides [interrupt, task, and RTC watchdogs](https://docs.espressif.com/projects/esp-idf/en/stable/esp32s3/api-reference/system/wdts.html). Use a hardware watchdog for total MCU stalls and task-level progress monitoring for capture/control. Feed it only after frame counters and control loops advance; a timer task that feeds regardless of pipeline progress defeats the purpose.

On Linux, use the kernel [watchdog device API](https://docs.kernel.org/watchdog/watchdog-api.html) through a single supervised owner. The health decision should include capture sample progress, queue age, successful core heartbeat, and UI readiness. Persist reset reason, boot counter, last completed stage, temperature, and bounded error counters—never speech content.

### Update and rollback

ESPHome [safe mode](https://esphome.io/components/safe_mode/) boots a restricted network/OTA environment after repeated failed starts, and its [OTA component](https://esphome.io/components/ota/) notes that an update blocks the normal application loop. Jiko therefore stops/invalidates an active capture, displays an update state, and never starts OTA mid-session. For direct ESP-IDF use, enable and test [application rollback](https://docs.espressif.com/projects/esp-idf/en/v5.5/esp32s3/api-reference/system/ota.html) with the pinned IDF release; defaults can change between major versions.

Linux uses two bootable application/OS slots or another equally atomic scheme. Download and verify into the inactive slot, boot it once, run audio-device/model/core/UI self-tests, then mark healthy. A failed health window reverts without network access. Keep an external recovery path: CM5 programming jig/service connector for Linux and USB/UART recovery pads for MCU/DSP.

[RAUC](https://github.com/rauc/rauc/blob/1a412fe80badb9cf91f5374ea2ef791de4db55a9/docs/integration.rst)
is the first local signed-bundle A/B candidate to spike on CM5/eMMC. It writes
inactive slots and integrates with a boot chooser, but it does not design the
initial partition image or Raspberry Pi boot flow for Jiko. Compare it with
Mender or a minimal `tryboot` integration under the same randomized power-cut
matrix. Keep OS/rootfs, app, model, config, MCU, and DSP compatibility in one
release manifest; splitting independently updated slot groups is accepted only
after mismatch and rollback tests.

Every release manifest should bind:

- Linux image/app version and model hashes;
- CM EEPROM bootloader/config version;
- ESP-IDF/ESP-SR firmware version and protocol version;
- DSP/codec firmware and channel map;
- calibration schema and hardware revision.

Reject incompatible combinations before accepting a session.

## Power conclusions

Measure four whole-device states at the DC input and, for final validation, at the wall: ready/idle, recording, inference+UI, and playback. Report average, peak, energy per successful turn, and temperature. Chip data cannot be added to estimate product power reliably: the [ESP32-S3 datasheet](https://documentation.espressif.com/esp32_s3_datasheet_en.pdf) itself shows Wi-Fi transmit peaks around hundreds of milliamps, while board regulators, PSRAM, microphones, DSP, amplifier, and LEDs add their own modes.

An ESP32 does not save meaningful system energy if CM5 and the display remain fully powered. A real low-power architecture would let the MCU power-sequence or suspend the Linux side, which introduces boot/wake latency, filesystem/update risks, and a harder recovery contract. Adopt that design only if the ≥20% representative-duty-cycle gate is met with ≤200 ms PTT readiness; otherwise optimize CM/display sleep and keep the system simpler.

## Board-level audio and production test

Espressif's [microphone design guideline](https://docs.espressif.com/projects/esp-sr/en/latest/esp32s3/audio_front_end/Espressif_Microphone_Design_Guidelines.html) gives useful physical checks even if Jiko does not ship ESP-SR: high-SNR microphones, acoustic separation from the speaker, sealed ports, controlled array geometry, and a valid echo-reference path. It recommends a two-microphone spacing around 4–6.5 cm for its algorithms, a blocked-port leakage attenuation over 25 dB (30 dB recommended), and less than 3 dB amplitude mismatch between array microphones. The algorithm/enclosure combination must still be retuned for Jiko.

The factory fixture should use synthetic deterministic stimuli and perform:

1. identity, hardware revision, secure/provisioned state, and image/firmware/model hash verification;
2. rail idle/peak current against golden-unit limits;
3. each microphone's presence, polarity, RMS, clipping, noise, and channel map;
4. blocked-port leakage and inter-microphone amplitude tests using the upstream limits above where the same geometry applies;
5. speaker chirp/level and microphone loopback against pilot-derived frequency/level tolerances;
6. echo-reference routing and raw/processed channel sanity for AEC models;
7. physical mute power cut, PTT/button, LED/haptic, display, service port, USB/I2S, and watchdog reset;
8. one end-to-end synthetic phrase through capture, local STT, shared core, receipt, and UI;
9. deletion of temporary factory audio and a final no-user-data assertion.

Each station receipt also records fixture/calibration identity, station cycle
time, first-pass versus retest, and final disposition. Track first-pass yield,
retest rate, and guard-band drift across the pilot; a golden unit alone is not
process capability.

Compliance starts before the carrier is frozen. Define target markets and the
radio/antenna/enclosure combination during EVT, then complete RF/EMC/ESD
pre-scan before DVT. Raspberry Pi's [industrial compliance
material](https://www.raspberrypi.com/for-industry/compliance/) and official
antenna coverage reduce evidence work but do not certify Jiko's complete host,
power, display, amplifier, cables, or enclosure. A third-party antenna can
change the required radio assessment.

Do not invent universal acoustic tolerances from one golden unit. Establish guard bands from engineering builds, correlate failures with listening/recognition metrics, and tighten them after the pilot yield distribution is known.

## Expected failure modes and required response

| Failure | Detection | Required product behavior |
|---|---|---|
| ALSA/PipeWire xrun or frame gap | driver counter + sequence gap | invalidate turn, stop cleanly, typed retry; never silently transcribe partial audio |
| USB/DSP detach | device event + sample progress timeout | show unavailable, bounded re-enumeration/restart, record firmware/device identity |
| channel-map/firmware mismatch | startup probe + synthetic channel test | refuse readiness; enter service state |
| capture queue full | age/high-water/overflow counter | emit `audio_overrun`, cancel result, preserve counters |
| STT worker crash/OOM | process exit/progress timeout | core/UI remain alive; one bounded restart, then explicit fallback |
| core/UI hang | heartbeat and end-to-end progress | supervisor restart; no duplicate receipt/session |
| MCU hang | task/hardware watchdog, host heartbeat | reset edge; discard stale session; report reset reason |
| Linux hang | hardware watchdog | reboot known-good slot; edge maintains only mute/indicator safety |
| thermal throttle | temperature/frequency/throttle flag | reduce nonessential UI/load or declare unavailable; benchmark failure if persistent |
| full/read-only storage | preflight and write error | bounded logs, no raw audio, keep or explicitly disable sessions safely |
| bad update | signature/hash, boot health deadline | automatic rollback and offline recovery path |
| network absent | interface state | normal local reading still works; only update/optional admin is deferred |

## Reuse, adapt, and avoid

| Source | Reuse directly or as a small adapter | Learn/adapt | Avoid as a product dependency |
|---|---|---|---|
| Home Assistant / ESPHome | safe-mode and bounded-buffer patterns where compatible | explicit stage events, ESP/XMOS/host split, physical mute | Home Assistant domain model and an always-listening pipeline for initial Jiko |
| Willow | none initially | local grammar versus server STT distinction, central OTA/config | old benchmark numbers as product sizing; cloud/service assumptions |
| Wyoming / OHF | possibly a provider-side adapter | framed binary PCM + typed events | exposed unauthenticated network bus; archived Rhasspy satellite |
| OpenVoiceOS | process/service concepts | listener lifecycle, plugin ownership, timeouts | generic assistant skills and broadcast message bus |
| ESP-SR / ESP-DSP | pinned AFE/KWS/command/DSP libraries after a gate | fixed frame/task capacity planning | claiming MultiNet is open-ended STT; duplicating shared readings on MCU |
| Korvo-2 | ESP-SR reference/control board only | isolate AFE/model results from custom-PCB faults | treating a dev board win as enclosure or production proof |
| ReSpeaker | development audio module | raw/processed A/B, firmware query/DFU | unpinned DSP binary or legacy Pi HAT driver as production foundation |
| Raspberry Pi / CM | CM5 eMMC and official provisioning/boot mechanisms | A/B health, thermal/power qualification | uncontrolled bootloader updates; microSD as final product storage |
| labgrid / pytest-embedded | HIL orchestration at the edge | power/flash/serial/instrument and multi-DUT receipts | a parallel business protocol or product runtime dependency |
| RAUC | CM5 signed A/B spike candidate | slot/boot health and power-cut recovery | assuming it supplies the Pi partition/boot design automatically |

## Open questions that require experiments

1. What microphone distance and simultaneous-playback requirement is actually in the product brief? This decides whether any AEC/beamforming DSP is justified.
2. Which bilingual local STT model and quantization clear the ten-second p95 budget on CM4 and CM5? Upstream Pi anecdotes do not answer this.
3. Does a class-compliant USB path remain gap-free during full kiosk rendering, inference, playback, update download, and thermal soak?
4. Does ReSpeaker processing improve Jiko's real enclosure corpus, or does it remove features useful to the readings? Retain raw channels to answer this.
5. Can the Linux-only button/audio path already meet the 50 ms feedback and 10,000-turn integrity gates? If yes, ESP32 should stay out.
6. What is the wall-energy and wake-latency trade if CM5/display suspension is attempted? MCU chip current alone cannot answer this.
7. Which exact A/B implementation and partition layout survives the required randomized power cuts on eMMC?
8. What factory audio tolerances predict field recognition success and acceptable pilot yield?

## Source ledger and freshness

Repositories and docs were checked on 2026-09-17. Commit IDs record the inspected moving branch; they are evidence of the review snapshot, not a request to update automatically.

| Project/source | Snapshot checked | Maintenance/use judgment |
|---|---|---|
| [ESPHome Home Assistant Voice PE firmware](https://github.com/esphome/home-assistant-voice-pe/tree/2644f4c794271d735d182ca7ebf899ed46164f4e) | `2644f4c79427` | active reference device; pin release assets and hashes |
| [ESPHome Voice PE 26.6.0 release](https://github.com/esphome/home-assistant-voice-pe/releases/tag/26.6.0) | published 2026-06-18 | verified release example; do not infer “latest” at install time |
| [Willow](https://github.com/HeyWillow/willow/tree/415ba07007f49873649d36e0b384d72640f1cfac) | `415ba07007f4` | active architecture reference; validate exact board support |
| [OHF Wyoming](https://github.com/OHF-Voice/wyoming/tree/fa5d98c1e8d3f1b00eadcf46df6f87f1d352ca3e) | `fa5d98c1e8d3` | active, small protocol reference; trusted links only |
| [OHF Linux Voice Assistant](https://github.com/OHF-Voice/linux-voice-assistant/tree/7c6fbaa4ee3c9a2cdd25803ed40b32e108a99a4a) | `7c6fbaa4ee3c` | active but labeled experimental |
| [Rhasspy 3](https://github.com/rhasspy/rhasspy3) | archived 2025-10-06 | learning only |
| [OpenVoiceOS Core](https://github.com/OpenVoiceOS/ovos-core/tree/ea9ee60b6b201ab4f90bf5900d8a04422e38c99f) | `ea9ee60b6b20` on `dev` | maintained service/plugin reference |
| [OVOS Dinkum Listener](https://github.com/OpenVoiceOS/ovos-dinkum-listener/tree/3d49f99b7bdf55198745f1e34c0f11d775b1d9fb) | `3d49f99b7bdf` on `dev` | maintained listener state-machine reference |
| [Mycroft Core](https://github.com/MycroftAI/mycroft-core) | archived 2024-09-08 | do not adopt |
| [Mycroft Mark II hardware](https://github.com/MycroftAI/hardware-mycroft-mark-II/tree/f416bf342547c56f575e91eb9acb2df50f1f8a16) | `f416bf342547` | production artifact/fixture reference; license clarification required before copying |
| [ESP-SR](https://github.com/espressif/esp-sr/tree/44b08495ef4b00b53fb0496bd6077223f77256ec) | `44b08495ef4b`; docs report 2.5.x line | viable pinned edge AFE/KWS/grammar candidate |
| [ESP-DSP](https://github.com/espressif/esp-dsp/tree/3c8ac0fdfec83740b783e200862c8d0c056de0ad) | `3c8ac0fdfec8` | viable primitive library, not speech recognition |
| [Korvo-2 BSP](https://github.com/espressif/esp-bsp/tree/73ee07b1ad56f865f13a2739be8bb6808c1da58a/bsp/esp32_s3_korvo_2) | `73ee07b1ad56` | ESP-SR control board, not final hardware |
| [ReSpeaker Lite](https://github.com/respeaker/ReSpeaker_Lite/tree/2ad81e22e773d1680793acdb3e14bb108d7566cb) | `2ad81e22e773` | prototype module; firmware/channel contract must be pinned |
| [ReSpeaker XVF3800](https://github.com/respeaker/reSpeaker_XVF3800_USB_4MIC_ARRAY/tree/a652fe79da3a292b25decc0e1e7f267d29bb0284) | `a652fe79da3a` | prototype/far-field candidate; qualify USB and firmware matrix |
| [labgrid](https://github.com/labgrid-project/labgrid/tree/b3e7b8769d0d02c27c663dc48aa7b288eaba04c3) | `b3e7b8769d0d` | whole-device HIL orchestration candidate |
| [pytest-embedded](https://github.com/espressif/pytest-embedded/tree/5177fb45918c7e768562fa67a8d229026636622c) | `5177fb45918c` | ESP firmware/HIL orchestration candidate |
| [RAUC integration docs](https://github.com/rauc/rauc/blob/1a412fe80badb9cf91f5374ea2ef791de4db55a9/docs/integration.rst) | `1a412fe80bad` | signed local A/B spike; Pi boot integration remains Jiko work |
| [AudioMoth basic firmware](https://github.com/OpenAcousticDevices/AudioMoth-Firmware-Basic/tree/c5d2b660e7c974c3ecfe5fbe8b95359949e1adba) | `c5d2b660e7c9` | service/update/low-power reference, not an interactive voice baseline |
| [Raspberry Pi Compute Module docs](https://www.raspberrypi.com/documentation/computers/compute-module.html) | live official docs | source of board, boot, eMMC, and production constraints |

## Recommended next experiment

Build one Linux-only vertical slice before approving any new board:

1. Pi 5 + class-compliant USB/ReSpeaker Lite, physical PTT, fixed acknowledgment clip.
2. Sequence-numbered 32 ms frames, 512 ms capture ring, 2.048 s bounded host queue, and complete stage telemetry.
3. One warmed local bilingual STT candidate plus parallel feature extraction feeding the existing shared core and both runtime shells.
4. Frozen quiet/noise/echo corpus and labgrid-backed 10,000-turn load/fault run; report the confidence bound, not only “zero failures.”
5. Repeat unchanged on CM5 4 GB/eMMC and CM4 4 GB/eMMC.
6. Only if a primary gate fails, run pinned Korvo-2 + ESP-SR or XMOS A/B and keep the MCU/DSP only if it clears the quantified improvement and all non-regression gates.
7. Separately spike RAUC on disposable CM5/eMMC images with power cuts in every update phase; do not merge update selection into the audio benchmark.

That experiment resolves the highest-value unknowns—actual STT compute, USB audio integrity, enclosure acoustics, and whether an edge controller earns its complexity—without prematurely committing Jiko to custom hardware.
