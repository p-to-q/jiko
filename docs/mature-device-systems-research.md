# Mature Device Systems Research And Jiko Redesign

Status: **research synthesis and staged engineering decision**
Last reviewed: **2026-09-18**

## Executive Decision

Jiko should not choose between “ESP32” and “custom board” as if they are two
complete alternatives. They solve different layers.

The recommended next physical architecture is:

- a Linux application processor — Raspberry Pi 5 for measurement, then CM5 on
  a serviceable carrier — owns UI, local STT, readings, receipts, updates, and
  recovery;
- an optional ESP32-S3 or dedicated audio front end owns only bounded real-time
  work such as button/LED, audio capture, level/VAD/AEC, and a local ring buffer;
- the microcontroller is added only if measurements show that Linux scheduling,
  USB audio, boot behavior, or power mode prevents the SLOs;
- no fully custom main compute board and no custom silicon before a CM5 carrier
  EVT has produced power, acoustic, thermal, reliability, and workload data.

The software decision is similarly layered. Borrow mature runtimes and models,
then own the evidence contract, three-line meaning, scheduler, fallback,
privacy, UI scene, and release gates. A model is a component; the product is the
bounded loop around it.

## From Pitch Language To Engineering Contract

The pitch's artistic proposition remains important: Jiko is a traffic light for
one's own thought, not another answer machine. Engineering narrows the three
marketing labels so the instrument does not make unearned claims:

| Pitch label | Engineering line | Observable input | Product boundary |
| --- | --- | --- | --- |
| content | text/content | faithful local transcript plus a separately receipted semantic view | never let fluent generation decide what the person meant |
| emotion | delivery | speech regions, energy, pitch variation, clipping/noise, pauses | describe delivery; do not diagnose emotion, honesty, or personality |
| context | timing/interaction | monotonic button and speech timings, continuation, duration | do not turn network latency or a generic LLM opinion into “context” |

The three lines must be independently unavailable. Missing input is not a
yellow/static vote. Two lines cannot be displayed as three-line consensus.

## What Omi Teaches Jiko

[Omi](https://github.com/BasedHardware/omi) is a useful comparison because it
spans a wearable, Zephyr firmware, BLE audio, mobile/desktop apps, and a large
backend. Its product objective — continuous capture and cloud memory — is not
Jiko's objective, so the useful lesson is in boundaries and failure history,
not in copying its stack.

The 2026-09-17 re-check adds a more important software lesson than the
wearable comparison alone. Omi now states product rules in a checked-in
[`PRODUCT.md`](https://github.com/BasedHardware/omi/blob/main/PRODUCT.md):
silent data loss and dual sources of truth are product bugs, all surfaces are
one product mind, and durable harnesses/contracts outrank one-off heuristics.
Those principles map directly to Jiko's shared protocol, core reducer, and
instrument scene. They do **not** imply adopting Omi's continuous-capture or
cloud-memory loop.

### Mature practices worth borrowing

- **Hardware is published as a buildable system.** Omi exposes schematic,
  layout, Gerber/assembly/BOM material, stack-up constraints, components,
  first-power checks, and mechanical information rather than calling a render
  “open hardware.” Its consumer design uses nRF5340, nRF7002, NAND, IMU, dual
  PDM microphones, and multiple small PCBs. Source:
  <https://github.com/BasedHardware/omi/blob/main/docs/doc/hardware/consumer/electronics.mdx>
- **Firmware profiles stay at the edge.** Zephyr boards, overlays, and build
  presets separate hardware revisions from application behavior. Source:
  <https://github.com/BasedHardware/omi/blob/main/omi/firmware/readme.md>
- **The transport is explicit.** Audio is framed, encoded, sequenced, and
  fragmented rather than treated as a magic stream. Source:
  <https://docs.omi.me/doc/developer/Protocol>
- **Offline storage exists because connectivity is not a fact.** Local storage
  and later reconstruction are product requirements for a streaming wearable,
  not optional debugging aids.
- **The repository contains contracts across languages.** Shared packet and
  protocol tests matter more than every client reimplementing assumptions.
- **Cross-surface parity is fixture-driven.** Omi's
  [`contracts/parity`](https://github.com/BasedHardware/omi/tree/main/contracts/parity)
  directory runs the same platform-neutral vectors through backend, Flutter,
  macOS, Windows, and web production adapters, and records known divergence
  instead of hiding it. Jiko should use the same pattern for laptop and kiosk
  shells: one trace fixture, two renderers, and an explicit divergence ledger.
- **Debugging has a runtime cost.** Omi's firmware documentation warns that
  logging priorities can affect BLE transfer and SD-card writes, while offline
  storage remains experimental in that path. Jiko therefore benchmarks
  receipts/logging both enabled and disabled; observability cannot be assumed
  free on the target computer.

### 2026-09-17 source audit corrections

The following findings are pinned to Omi commit
[`898118d`](https://github.com/BasedHardware/omi/tree/898118d6e410325116e98a1ede1d1e81d233871b).
They matter because component lists and product prose are not reliable runtime
contracts by themselves.

| Audited fact | Direct evidence | Jiko consequence |
| --- | --- | --- |
| The consumer board uses 4 Gbit NAND and the firmware exposes at most 480 MiB; a separate page calling the same part 8 GB is inconsistent | [consumer BOM](https://github.com/BasedHardware/omi/blob/898118d6e410325116e98a1ede1d1e81d233871b/omi/hardware/consumer/bom/README.md#L23-L33), [consumer README](https://github.com/BasedHardware/omi/blob/898118d6e410325116e98a1ede1d1e81d233871b/omi/hardware/consumer/README.md#L36-L47), [storage limit](https://github.com/BasedHardware/omi/blob/898118d6e410325116e98a1ede1d1e81d233871b/omi/firmware/omi/src/lib/core/sd_card.h#L9-L21) | BOM part number, firmware probe, and factory test are the authority; do not size buffers or retention from a marketing/docs capacity string. |
| Two PDM channels are immediately averaged into mono; the checked path does not retain array information or implement an AEC/beamforming chain | [microphone path](https://github.com/BasedHardware/omi/blob/898118d6e410325116e98a1ede1d1e81d233871b/omi/firmware/omi/src/mic.c#L92-L130), [16 kHz/20 ms Opus profile](https://github.com/BasedHardware/omi/blob/898118d6e410325116e98a1ede1d1e81d233871b/omi/firmware/omi/src/lib/core/config.h#L24-L38) | A dual-microphone BOM is not a spatial-audio capability. Compare raw channel, downmix, and codec paths before relying on delivery features. |
| The ring has sequences, drop counters, recovery metadata, and explicit commands, but one path advances after a BLE notify callback rather than an application-level durable acknowledgment | [ring state](https://github.com/BasedHardware/omi/blob/898118d6e410325116e98a1ede1d1e81d233871b/omi/firmware/omi/src/lib/core/sd_card.h#L9-L21), [advance path](https://github.com/BasedHardware/omi/blob/898118d6e410325116e98a1ede1d1e81d233871b/omi/firmware/omi/src/lib/core/storage.c#L245-L286) | Borrow sequence/drop/recovery, but transfer ownership only after the host WAL has durably committed and acknowledged the session/attempt/profile identity. |
| A connected-but-unsubscribed path can remove a queued frame without storing it, and socket enqueue is not a server persistence acknowledgment | [device transport](https://github.com/BasedHardware/omi/blob/898118d6e410325116e98a1ede1d1e81d233871b/omi/firmware/omi/src/lib/core/transport.c#L1215-L1254), [mobile capture path](https://github.com/BasedHardware/omi/blob/898118d6e410325116e98a1ede1d1e81d233871b/app/lib/services/capture/capture_controller.dart#L1107-L1161) | Connected, subscribed, enqueued, received, and durable are separate states and fault-injection points. |
| The acoustic activity detector sleeps after sustained quiet, but the inspected path has no pre-roll that proves preservation of the first phoneme | [AAD configuration](https://github.com/BasedHardware/omi/blob/898118d6e410325116e98a1ede1d1e81d233871b/omi/firmware/omi/omi.conf#L208-L224), [sleep/wake path](https://github.com/BasedHardware/omi/blob/898118d6e410325116e98a1ede1d1e81d233871b/omi/firmware/omi/src/mic.c#L362-L450) | Low-power capture is accepted only after wake-to-valid-frame, initial-phoneme loss, quiet false-wake, and whole-device current measurements. |
| MCUboot/multi-image scaffolding exists, but the inspected build points at a committed signing private key and the GATT characteristics do not request encrypted/authenticated permissions in source | [sysbuild signing config](https://github.com/BasedHardware/omi/blob/898118d6e410325116e98a1ede1d1e81d233871b/omi/firmware/omi/sysbuild.conf#L7-L17), [audio GATT permissions](https://github.com/BasedHardware/omi/blob/898118d6e410325116e98a1ede1d1e81d233871b/omi/firmware/omi/src/lib/core/transport.c#L144-L166) | Borrow rollback concepts, not the trust chain: release signing stays outside Git/CI images, supports rotation/revocation, and pairing/security claims require a real-device test. |

### Public failures that should become Jiko fixtures

| Omi evidence | Failure pattern | Jiko rule |
| --- | --- | --- |
| [#5159](https://github.com/BasedHardware/omi/issues/5159) | internet socket dies while BLE remains connected, so audio is silently discarded | capture and transport health are separate; sequence every chunk and persist a bounded local write-ahead log before acknowledging ownership |
| [#6977](https://github.com/BasedHardware/omi/issues/6977) | stale socket can leave a zombie listening state | every long-lived link has heartbeat, progress watchdog, reconnect budget, and a visible degraded state; a connected flag never proves progress or durability |
| [#9417](https://github.com/BasedHardware/omi/issues/9417) | reliability drifts after longer runtime/reconnect | soak tests measure loss and latency drift, not only whether a fresh session works |
| [#9585](https://github.com/BasedHardware/omi/issues/9585) | empty transcripts can be returned as HTTP 200 success | outcome is typed: `success`, `expected_silence`, `empty_unexpected`, `timeout`, `upstream_error`, `config_error`, `invalid_input`; deploy gates run fixed synthetic audio |
| [#10431](https://github.com/BasedHardware/omi/issues/10431) | a custom local STT path can still forward raw audio to the main backend | “local” is an end-to-end network invariant verified with WAN-blocked tests and packet inspection |
| [#8006](https://github.com/BasedHardware/omi/issues/8006) | offline chunks are difficult to reconstruct with correct context | store session/sequence/time provenance with chunks; replay is idempotent and ordered |
| [#6856](https://github.com/BasedHardware/omi/issues/6856) | unused Wi-Fi hardware/firmware adds cost and complexity | no radio or coprocessor without a measured job, power budget, update owner, and failure policy |

BLE TX-complete, WebSocket enqueue, server receipt, and host durable commit are
four different acknowledgments. Only the level named by Jiko's durability
contract may transfer ownership or advance a source ring. The device/host
protocol therefore needs an idempotent application acknowledgment after the
host WAL is synced, not an inference from link state.

### What not to copy

Jiko must not inherit cloud-first transcription, continuous recording, a mobile
app dependency, Firebase/Deepgram assumptions, or the idea that “local model”
automatically means local audio. The normal Jiko turn is ephemeral and
device-local; after a bounded receipt is formed, raw audio is deleted. Do not
copy a repository-committed release signing private key or unaudited GATT security
settings into a release trust chain.

## Other Mature Reference Systems

### Linux audio instruments and production systems

The voice-assistant comparison set is not sufficient on its own. A separate
[audio instrument and production systems study](research-audio-instrument-production-systems.md)
adds norns, Bela, Zynthian, Tympan, Sound Open Firmware, and OpenEarable. The
main consequences are instrument independence from the browser, a bounded
Linux real-time capture path with explicit xrun evidence, a separate recovery
surface, a complete driver/firmware/topology/hardware compatibility tuple, and
factory-grade production/acoustic artifacts. These are release gates; their
vendor latency, thermal, or acoustic numbers are not Jiko evidence.

### Home Assistant Voice Preview Edition

[Home Assistant Voice PE](https://www.home-assistant.io/voice-pe/) separates a
small ESP32-S3 controller from an XMOS XU316 audio front end for AEC, noise
removal, and gain control, and sends heavier local speech work to a separate
Home Assistant machine. It also uses a physical mute that cuts microphone
power. The lesson is architectural: deterministic audio/control work can be
isolated from Linux inference, and privacy state deserves a physical boundary.

Its [Assist pipeline](https://developers.home-assistant.io/docs/voice/pipelines/)
defines explicit stage events and an overall timeout. The Wyoming ecosystem
keeps long-loading speech engines behind small streaming adapters:

- <https://github.com/OHF-Voice/wyoming>
- <https://github.com/rhasspy/rhasspy3>

For Jiko, this supports a persistent local worker and provider-neutral protocol,
not a dependency on Home Assistant itself.

### Embedded release discipline

Useful production disciplines come from systems work rather than model demos:

- Memfault pre-launch and NPI guidance separates prototype, EVT, DVT, PVT,
  manufacturing firmware, and Day-0 firmware:
  <https://memfault.com/blog/how-to-test-your-iot-product-before-launch/> and
  <https://memfault.com/blog/accelerating-iot-device-development-through-npi-and-firmware-milestones/>
- watchdog behavior must include task/software watchdogs and retained crash
  reasons, not only “enable the hardware timer”:
  <https://interrupt.memfault.com/blog/firmware-watchdog-best-practices/>
- Zephyr Twister provides a route from host tests to hardware-map HIL runs:
  <https://docs.zephyrproject.org/latest/develop/twister/index.html>
- RAUC and Mender document signed/atomic A/B system update patterns:
  <https://github.com/rauc/rauc> and
  <https://docs.mender.io/artifact-creation/combining-system-and-application-updates>

The conclusion is not “install every framework.” It is to make update,
rollback, watchdog, factory test, and retained failure evidence first-class
before a board becomes difficult to reach.

## Proposed Jiko System

```text
physical input / microphone
        |
        v
hardware edge adapter
  local timestamps, frame sequence, level/clipping, bounded ring/WAL
        |
        v
session scheduler -------------------- observer/lab adapter
  identity, deadline, cancel, queue         receipts only; never owns state
        |
        +--> normalize once
              +--> warm local STT ----------> faithful + semantic text
              +--> VAD / DSP ---------------> delivery evidence
              +--> event alignment ---------> timing evidence
        |
        v
coverage policy -> immutable result -> shared InstrumentScene
                                      +--> kiosk/device renderer
                                      +--> laptop participant renderer
                                      +--> website synthetic-trace renderer
        |
        +--> fixed local clip / optional local TTS
        +--> content-free operational receipt
```

Core invariants:

1. Capture acknowledges only after the active owner can preserve the frame.
2. Every frame/event/result is session-, attempt-, and sequence-addressed.
3. Stop seals the input; reset/cancel wins over late provider output.
4. STT and features share one normalized PCM buffer and run concurrently.
5. The scheduler owns the end-to-end deadline. Providers return typed outcomes.
6. A partial measured result is better than a fabricated complete result.
7. The observer can disappear without stopping the instrument.
8. The network can disappear without violating the privacy or success contract.

## Algorithm And Framework Decision By Line

### Text/content

| Layer | Baseline | Challenger | Selection evidence |
| --- | --- | --- | --- |
| STT | sherpa-onnx SenseVoice int8 persistent worker | quantized whisper.cpp tiny/base; self-hosted FunASR as laptop reference | Mandarin CER, English WER, mixed-token error, silence hallucination, keyword/negation preservation, warm/cold latency, RSS, thermal |
| transcript enhancement | bounded filler/control-token cleanup producing a second semantic view | local dictionary and correction memory; never destructive-only text | faithful-view preservation, transform receipt, negation/modality/hesitation equivalence corpus |
| content reading | current transparent rule engine | first: quantized fastText char n-gram; later: small multilingual embedding classifier only if necessary | macro F1, per-class precision/recall, abstention/calibration, STT perturbation stability, explanation footprint |

This is the “Typeless” leverage point: STT is a primitive, and the product value
comes from an enhancement layer. Unlike dictation, Jiko must not polish away
hesitation, repetition, negation, or timing. It therefore keeps a faithful view
and creates a separate, versioned semantic view.

### Delivery

| Layer | Baseline | Challenger | Selection evidence |
| --- | --- | --- | --- |
| speech boundaries | current energy/pause path | Silero VAD through sherpa-onnx; TEN VAD is research-only pending license review | onset/offset error, false speech in noise, CPU/RSS, streaming behavior |
| acoustic evidence | handwritten RMS, clipping, noise floor, pitch variation, pauses | enclosure-calibrated native/NEON hot loops; small ONNX classifier only with a valid labeled task | repeatability over gain/distance/mics, unusable-input detection, output equivalence, sustained latency |
| front end | Linux/USB or CSI/I2S mic path | ESP-SR AFE, XMOS-class AFE, or ESP32-S3 capture/control experiment | echo/self-noise/handling tests, lost frames, current draw, integration and update cost |

Do not optimize an “emotion classifier.” First make observable audio evidence
repeatable across the actual enclosure and microphone.

### Timing/interaction

Keep this line deterministic. It uses device-monotonic button-down, first
speech, pauses, last speech, button-up, retry, and continuation events. A neural
model adds opacity to a small structured signal. Calibration belongs in a
device profile, not a general-purpose model.

## Scheduler, Fallback, And Outcome Contract

Priority order:

```text
P0 acknowledge / stop / reset / cancel
P1 capture ring / frame durability / level and clipping guard
P2 normalize -> features and selected warm STT
P3 three readings -> coverage -> immutable result
P4 playback / observer / receipt persistence
P5 benchmark, cache maintenance, model or update download
```

Required outcomes:

| Outcome | Meaning | Participant behavior |
| --- | --- | --- |
| `success` | required measured evidence completed | normal result |
| `partial` | one line unavailable, remaining measured evidence valid | unresolved window plus explicit short copy |
| `expected_silence` | no speech by design/threshold | invite another turn; no failure theatre |
| `empty_unexpected` | audio existed but STT returned empty | retry; provider marked unhealthy if repeated |
| `timed_out` | stage/session deadline expired | partial if allowed, otherwise stable retry |
| `unusable_input` | clipping/noise/too-short input prevents a line | say what can be corrected |
| `provider_unavailable` | model/service not ready | do not queue behind an unknown wait |
| `failed` | internal stage failure | recover/restart; stable error code in lab view |
| `cancelled` | newer user action/reset superseded work | late outputs are sealed out |

Only an already-warm alternate provider may be tried, and only when its measured
p95 fits inside the remaining product deadline. Otherwise return an honest
partial result. A fallback ladder is not an excuse to wait through every model.

## Performance And Reliability Gates

### Human-facing latency

These are proposed alpha SLOs and must be validated, not advertised as already
met:

| Scope | Gate |
| --- | ---: |
| local input acknowledgment | p95 <= 100 ms; hard <= 200 ms |
| release to received/processing state | p95 <= 150 ms |
| release to first stable line | p95 <= 700 ms |
| warmed complete visual result | p50 <= 1.2 s; p95 <= 2.5 s |
| hard product deadline | 4 s, then explicit partial/unavailable/retry |
| warm STT real-time factor | p95 <= 0.5 on selected target profile |
| fixed playback start after result | p95 <= 500 ms; never blocks visual result |

The 4-second boundary is supported directionally by recent conversational-agent
research, which found significant experience degradation at delays of four
seconds or more: <https://arxiv.org/abs/2507.22352>. Jiko still needs its own
usability data.

### Device and soak gates

| Measure | Alpha/EVT hypothesis |
| --- | --- |
| normal-turn audio integrity | zero dropped/duplicated frames; every gap has a typed receipt |
| capture-progress watchdog | visible recovery when no sequence progress for 500 ms during active capture |
| model worker recovery | ready again within 2 s or before the next admitted session |
| boot to safe local idle | <= 10 s target, WAN absent |
| memory | >= 30% headroom at sustained peak; no unbounded RSS in an 8-hour soak |
| thermal | no throttling in 30-minute stress or 8-hour scripted sessions |
| event/result integrity | zero lost events and zero duplicate final results |
| storage | bounded receipts; no raw audio after normal or failed turn |
| power interruption | 100 scripted cuts across idle/write/update states with no unrecoverable filesystem or image |

Benchmark cold start and warmed operation separately. Run with the kiosk,
observer, audio capture, screen, and thermal system active. A bare model CLI is
not the product number.

## Optimization Discipline

Use mature runtime leverage before writing custom kernels:

1. load STT/VAD models once in a supervised worker;
2. decode/normalize audio once and share one mono 16 kHz buffer;
3. bound copies with a ring buffer or shared-memory/native boundary only after
   profiling proves JS/Python copies are material;
4. use ONNX graph optimization, appropriate thread counts, and int8 only after
   pre/post quality equivalence;
5. tune under sustained temperature with the UI active — maximum threads often
   worsen p95 through contention and throttling;
6. hand-write a C/Rust/NEON/WASM operator only for a measured hot loop, with
   golden vectors, tolerance, architecture fallback, and before/after receipt;
7. cache model/tokenizer/immutable TTS assets by hashes, never user audio or
   transcript content.

Primary performance references:

- ONNX Runtime threading:
  <https://onnxruntime.ai/docs/performance/tune-performance/threading.html>
- ONNX Runtime memory:
  <https://onnxruntime.ai/docs/performance/tune-performance/memory.html>
- ONNX Runtime quantization:
  <https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html>
- whisper.cpp benchmark tooling: <https://github.com/ggml-org/whisper.cpp>
- MLPerf Tiny accuracy/latency/energy discipline:
  <https://mlcommons.org/working-groups/benchmarks/tiny/>

## Hardware Path And Pre-PCB Gates

### Profile 0 — laptop reference

Purpose: close session truth, participant UX, corpus, provider adapters, and
benchmark contract. It does not prove embedded performance.

### Profile 1 — Pi 5 development instrument

Purpose: run the entire local stack with final-resolution display, candidate
microphone, button, speaker, cooling, and no WAN. Gather thread/thermal/power
data before choosing the compute module.

### Profile 2 — CM5 plus serviceable carrier alpha

Purpose: make interfaces and recovery real without inventing a processor board.
Carrier requirements include:

- SWD/UART/USB recovery and labelled test pads;
- current measurement points by major power rail;
- microphone loopback/injection path and speaker isolation test point;
- hardware mute/power/privacy state if a microphone is always physically
  connected;
- display, button, audio, storage, watchdog, RTC, fan/thermal, and boot-mode
  interfaces declared in a versioned hardware profile;
- factory-test firmware/image that can run without the product UI;
- signed A/B update and rollback plan before inaccessible enclosure assembly.

### Optional ESP32-S3 edge profile

Add it only if Profile 1 proves a bounded need. It may own capture sequencing,
button/LED, wake, basic AFE, and short disconnect buffering. It must expose a
versioned transport with frame sequence, device-monotonic timestamp, format,
health, and overflow events. It must not become a second reading engine.

Espressif's official hardware guidance should be used for power, RF, ground,
ESD, and four-layer layout work:
<https://docs.espressif.com/projects/esp-hardware-design-guidelines/en/latest/esp32s3/>.

### Custom carrier EVT entry gate

Do not freeze a PCB until all are true:

- the selected local STT/VAD profile passes corpus and target p95/RSS/thermal
  gates with the UI active;
- microphone placement and speaker self-noise have two physical mock-up rounds;
- peak/idle/average power and brownout margin are measured, not estimated from
  datasheets alone;
- the screen stack, board, battery/power, connectors, fasteners, acoustic
  volumes, keep-outs, cooling, and service access fit a measured CAD stack-up;
- no-network boot, worker crash, read-only/full storage, and power-cut recovery
  have receipts;
- session/attempt identity and the participant UI pass interleaving E2E tests;
- test points, programming, factory fixture, update, rollback, and failure-log
  extraction are reviewed before routing.

### EVT -> DVT -> PVT

- **EVT:** prove electrical interfaces, acoustic placement, thermals, power,
  bring-up, programming, and repeated local sessions on several boards.
- **DVT:** freeze the verification matrix; test tolerances, multiple units,
  handling/drop/strap/connector stress, EMC/safety pre-compliance, accessibility,
  updates, rollback, and 8-hour operation.
- **PVT/pilot:** prove assembly fixtures, factory image/test, traceable versions,
  yield, service/replacement flow, and content-free fleet health receipts.

## Phased Implementation

| Phase | Work | Exit evidence |
| --- | --- | --- |
| A. Truth before polish | single active session/attempt, sequence-aware SSE/replay, computation vs reveal timing, shared `InstrumentScene` | interleaved-session E2E; kiosk/site golden frames from one trace |
| B. Human test cockpit | participant/facilitator/lab modes, local CJK type system, scenario runner, latency waterfall | success/partial/timeout/reconnect/reduced-motion journeys; physical font matrix |
| C. Algorithm selection | frozen consented/synthetic corpus; warm SenseVoice, whisper.cpp and FunASR runs; VAD and content challengers | slice quality, p50/p95/p99, RTF, RSS, thermal, license and failure receipts |
| D. Runtime hardening | bounded scheduler/queue, cancellation, WAL/atomic receipts, health/readiness, supervision, immutable image | crash/restart/no-network/full-storage tests and 30-minute stress |
| E. Device alpha | Pi 5 then CM5 profile with real mic/display/button/speaker/cooling | repeated complete loop, power/thermal/acoustic report, 8-hour soak |
| F. Hardware maturation | carrier EVT, DVT matrix, factory test, A/B update, pilot operations | multiple-unit evidence and reviewed gate closure |

The order is intentional. A new PCB would make current software ambiguity more
expensive; a new model would not fix a participant seeing the wrong session.

## Immediate Work Order

1. Fix the session identity split and add the two-session interleaving test.
2. Preserve the implemented pipeline/reveal separation; measure the current
   0/450/900 ms reveal, reduced-motion path, browser paint, and real playback
   onset independently on the target display/speaker.
3. Extract the shared scene contract and make the website replay it.
4. Build participant/facilitator/lab modes and the proposed local font system.
5. Add the benchmark cockpit and corpus manifest before selecting a model.
6. Benchmark the implemented persistent SenseVoice worker with real pinned
   artifacts against whisper.cpp and FunASR under the same harness; carry the
   winning artifact/runtime identity into each session receipt.
7. Move the unchanged suite to Pi 5; decide whether CM5 alone is sufficient or
   an ESP32-S3/audio coprocessor has a measured job.
8. Enter carrier EVT only after the pre-PCB gate is complete.

This is how Jiko can become like the instrument shown on the website: not by
making localhost look more finished, but by making every visible state,
hardware boundary, latency promise, and recovery path true.
