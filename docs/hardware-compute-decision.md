# Hardware Compute Decision

Status: **research-backed direction; target-device proof pending**

Last reviewed: **2026-09-18**

## Decision

For EVT planning, Jiko keeps a Linux-class ARM64 compute module as the main
computer. Raspberry Pi Compute Module 5 is the leading EVT candidate, not a
completed selection; it or a measured equivalent proceeds only after the gates
in this document pass. Raspberry Pi 5 remains the development and integration
reference.

ESP32-S3 and ESP32-P4 are not candidates for the only main processor in the
current product contract. They may be evaluated later as an audio/control/power
front end when a measured benefit justifies the second processor.

"Custom board" means a custom carrier first. It does not mean custom silicon.
No custom SoC or ASIC work starts before workload, volume, power, thermal, cost,
and certification evidence makes that investment rational.

## Adopt, Spike, Reject

The detailed evidence is recorded in
[embedded local voice systems](research-embedded-voice-systems.md),
[wearable/desktop hardware](research-wearable-hardware.md), and the
[audio instrument/production study](research-audio-instrument-production-systems.md),
the [edge speech/compute co-design study](research-edge-speech-optimization.md),
plus the [Omi device study](mature-device-systems-research.md). The resulting
boundary is:

| Decision | Now | Evidence required to change it |
| --- | --- | --- |
| **Adopt** | Pi 5 development reference; CM5 with eMMC as EVT main-compute candidate; class-compliant USB audio first; local Linux STT/TTS; one shared event/core contract | target corpus, kiosk-on latency/memory/thermal receipts and offline recovery proof |
| **Spike** | ReSpeaker Lite raw/processed two-mic path; XVF3800/other XMOS path only if far-field/AEC is a real product requirement; CM4 as a measured cost/thermal challenger | same enclosure/corpus and exact firmware/channel profile; quality, integrity, power, and recovery deltas |
| **Conditional spike** | ESP32-S3 for timestamped capture, bounded ring, physical mute/control, AFE, watchdog, or Linux power sequencing | at least one quantified primary gate plus all non-regression gates in the embedded-systems note |
| **Reject for EVT** | ESP32-only open-ended bilingual STT; Wi-Fi as an internal PCM bus; MCU-owned reading/state machine; microSD as product storage; cloud-required normal turns; custom main compute/ASIC | reopen only if the complete offline workload wins the same benchmark and recovery matrix |
| **Defer until module failure is measured** | custom microphone/DSP PCB and custom CM5 carrier | locked acoustics/stack-up and a specific size, quality, lifecycle, integrity, or landed-cost failure that the custom board fixes |

Hailo-10H/AI HAT+ 2, QCS6490 and RK3588 are conversion spikes rather than
selections. Each must compile the chosen speech graph with visible operator
coverage and then beat CM5 on the complete quality/latency/memory/power/thermal/
BSP/recovery/BOM scorecard. Published TOPS does not pass that gate.

Satellite1/Home Assistant Voice PE validate the edge-audio/strong-host split;
ReSpeaker provides a practical raw-versus-processed acoustic baseline; Watcher
shows the recovery cost of two independently flashed processors; and Open
Interpreter 01 Light is negative evidence that a credible BOM and prototype do
not justify manufacturing before product value and recovery are proved. These
are architecture inputs, not proof that their power, thermal, microphone, or
firmware numbers transfer to Jiko's enclosure.

[norns, Bela, Zynthian, Tympan and SOF](research-audio-instrument-production-systems.md)
add the missing whole-instrument constraint: the browser is not the product,
Linux capture must expose xruns under concurrent load, a recovery plane must
survive kiosk/audio failure, and the full driver/firmware/topology/board tuple
must be compatible before `ready`. They reinforce Pi 5/CM5 as the first system
to measure; they do not justify importing a music runtime or skipping Jiko's
own acoustic, thermal, and production tests.

Omi adds a specific counterexample to speculative coprocessors: its consumer
BOM contains an nRF7002 Wi-Fi companion while the public product/firmware work
has not established a closed, indispensable job for that silicon. A radio or
MCU therefore enters Jiko's BOM only with a named runtime owner, measured power
budget, update/recovery path, and an A/B result against the simpler Linux-only
system. Physical presence on another product is not a selection argument.

## Product Workload

The compute choice must run the complete offline loop, not only the display:

1. immediate button/touch acknowledgment and capture ownership;
2. mono audio capture, normalization, VAD, acoustic features, and buffering;
3. arbitrary Mandarin/English/code-switch STT, not a fixed command grammar;
4. content, delivery, and timing readings with explicit unavailable states;
5. the 320 x 480 instrument UI plus local result playback;
6. bounded receipts, health checks, crash recovery, and offline startup;
7. an observer connection that can disappear without stopping the instrument.

This workload is the reason a microcontroller-only design is rejected for EVT.
Espressif MultiNet is useful for an offline command set, but its documented
contract is command recognition rather than open-ended transcription. Jiko's
content line depends on the latter.

## Candidate Matrix

| Candidate | Open-ended local STT | UI / media role | Memory / runtime fit | Product role now | Verdict |
| --- | --- | --- | --- | --- | --- |
| Raspberry Pi 5 | plausible; model benchmark still required | full kiosk, USB audio, local service supervision | Linux, Cortex-A76-class CPU, normal process isolation | development/reference computer | retain for integration and measurement |
| Compute Module 5 | plausible; same model benchmark class as Pi 5 | product carrier can expose only required display/audio/I/O | 2–16 GB RAM options, optional eMMC/Wi-Fi, Linux | EVT product compute module | **preferred main-compute direction** |
| ESP32-S3 | no evidence for arbitrary bilingual STT in this envelope | strong I2S/audio-front-end, button, wake/VAD/command path | dual LX7 up to 240 MHz, 512 KB SRAM and bounded PSRAM | optional always-on/audio/control coprocessor | not the main computer |
| ESP32-P4 | no evidence for current arbitrary STT workload | stronger display/DSP/HMI interfaces; needs companion radio for wireless | dual 400 MHz RISC-V HP cores, 768 KB HP L2 memory | optional HMI/DSP spike | not the main computer |
| Custom silicon | unknown | could eventually optimize the measured hot path | highest NRE, toolchain and validation risk | none in EVT/DVT | explicitly deferred |

The CM5 package is 55 x 40 x 4.7 mm before carrier, display, audio, storage,
power, battery, shielding, fasteners, and thermal clearances. It does not prove
the current 80 x 120 x 6.6 mm visual body. That depth remains an appearance
study until a measured stack-up and thermal prototype exist.

## Reference Architecture

```text
microphone / button / display / speaker
                 |
        custom carrier at the edge
                 |
      Linux ARM64 SoM (shared runtime)
        |         |          |
       DSP       STT      core + UI
        \_________|__________/
                  |
       local receipt / observer stream
```

An ESP32 can be added at the carrier edge only for one or more proven needs:

- lower-power always-on VAD or wake/control behavior;
- audio AFE functions such as echo cancellation/noise suppression;
- power sequencing, watchdog, or safe shutdown supervision;
- deterministic input while Linux boots or recovers.

It must exchange the normal Jiko event protocol. It must not create a second
decision engine, invent missing timestamps, or become an unobservable audio
path.

## Provisional Device Gates

The numbers below are engineering targets for comparison, not current claims.
The 50 ms input-acknowledgment target is the internal device-response budget;
the human-facing alpha envelope is p95 <= 100 ms with a 200 ms hard ceiling.
Those are nested measurement layers and remain provisional until real-device
testing.

| Gate | Provisional target | Measurement condition |
| --- | ---: | --- |
| local input acknowledgment | p95 <= 50 ms | physical control to visible local state |
| processing indication | <= 100 ms after release | does not wait for STT |
| warmed release-to-result | p95 <= 2.5 s | up to 10 s utterance, kiosk active, selected model |
| fallback decision | <= 4.0 s | partial/unavailable is preferable to a hung spinner |
| idle-to-ready after service start | record cold and warm separately | all selected models health-ready |
| sustained operation | 8 h without manual recovery | kiosk, audio, receipts, and network disabled test |
| thermal | no throttling-driven p95 breach | final cooling direction and enclosed prototype |

The scheduler may try an alternate local STT only when it is already warm and
the remaining deadline can still satisfy the fallback gate.

## Experiments Before Carrier Freeze

1. Run the same frozen STT/DSP corpus on Pi 5 and CM5 with the kiosk active.
   Record cold load, warm p50/p95, RTF, RSS, CPU, temperature, throttling, model
   hash, thread count, and failures.
2. Test USB and I2S audio candidates for capture/playback concurrency, noise,
   clipping, echo, and suspend/restart behavior.
3. Run the display and interaction loop at the actual 320 x 480 target, including
   boot, service crash, observer disconnect, and no-network operation.
4. Build a physical stack-up. Measure the module, carrier, connectors, speaker,
   microphone, battery/power, shielding, fastening, and cooling rather than
   scaling the showcase mesh.
5. Spike ESP32 AFE only against the Linux-only baseline. Keep it only if it
   improves measured power, capture quality, boot interaction, or recovery
   enough to pay for firmware, protocol, BOM, and failure-mode complexity.

## Exit Criteria For Each Branch

- **CM5/custom carrier proceeds** when the selected STT meets the quality and
  latency gates under thermal load and the stack-up is manufacturable.
- **ESP32 coprocessor proceeds** only with an A/B receipt showing a material
  benefit and no protocol split.
- **ESP32-only main compute** can be reopened only if an open-ended bilingual
  STT plus the full UI/runtime fits and beats the Linux path on the same corpus.
- **Custom silicon** can be reopened only after forecast volume and measured
  bottlenecks justify NRE and a software-compatible migration plan exists.

## Primary Sources

- Jiko pitch: <https://www.ptoq.io/pitches/jiko_%5Bp%E2%86%92q%5D_hack_pitch.pdf>
- Raspberry Pi Compute Module 5: <https://www.raspberrypi.com/products/compute-module-5/>
- Raspberry Pi 5 product brief: <https://pip.raspberrypi.com/categories/1098-design-files>
- ESP32-S3-WROOM-2 datasheet: <https://documentation.espressif.com/esp32-s3-wroom-2_datasheet_en.html>
- ESP-SR speech command recognition: <https://docs.espressif.com/projects/esp-sr/en/latest/esp32s3/speech_command_recognition/README.html>
- ESP32-P4 datasheet: <https://documentation.espressif.com/esp32-p4_datasheet_en.html>
- ESP-DL introduction and operator runtime: <https://docs.espressif.com/projects/esp-dl/en/latest/introduction/readme.html>
