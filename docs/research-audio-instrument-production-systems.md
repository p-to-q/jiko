# Audio Instrument And Production Systems Research

Status: **research synthesis; architecture and verification input, not target-hardware proof**

Last reviewed: **2026-09-18 (Asia/Shanghai)**

## Why This Comparison Set Exists

Jiko already has useful comparisons for open voice assistants, audio front ends,
wearables, and MCU/Linux splits. The remaining blind spot was different: mature
hardware often fails or succeeds because of real-time isolation, recovery,
mechanical noise, production artifacts, component substitution, and version
compatibility rather than model choice.

This note therefore studies shipped or unusually well-documented **audio
instruments and audio platforms**, not more AI-assistant marketing. Repository
evidence, shipped evidence, vendor specification, and license are kept separate.
None of the figures below transfer to Jiko without a Jiko DUT measurement.

## Decision Summary

| System | Evidence maturity | What Jiko should borrow | What it is not |
| --- | --- | --- | --- |
| monome norns | multiple shipped batches; active Linux instrument software; public shield hardware | instrument independence from browser, process isolation, hardware profiles, assembly/EMI acoustic tests | a runtime stack or proof that microSD/SSH recovery is acceptable |
| Bela / Bela Gem | shipped hard-real-time Linux audio platform; editable hardware | bounded real-time capture, xrun/underrun as first-class evidence, non-real-time handoff | a reason to replace CM5 with PRU/Xenomai |
| Zynthian V5/V5.1 | shipped Pi 5 audio instrument; active UI and open V5 board files | bare-Pi baseline to product profile, recovery surface independent of main UI, strict audio profile | proof that its passive cooling, JACK graph, or update path fits Jiko |
| Tympan Rev F | small-batch product with unusually complete manufacturing package and fixture | production release contents, substitute-part discipline, wired recovery, acoustic acceptance | a main-compute architecture or large-volume manufacturing proof |
| Sound Open Firmware | production audio-DSP ecosystem used by Linux systems | driver/firmware/topology/board compatibility tuple, ABI versions, mismatch HIL | a framework Jiko should port wholesale |
| OpenEarable 2.0 | active research/development platform; limited product evidence | wearable power/recovery/storage-noise failure matrix and license caution | a current Jiko form factor or evidence for all-day consumer use |

The high-priority additions are norns, Bela, Zynthian, and Tympan. SOF is a
systems-contract reference. OpenEarable matters only if Jiko later becomes a
body-worn or in-ear product.

## 1. monome norns — A Linux Instrument That Does Not Depend On Its Browser

The pinned [norns software tree](https://github.com/monome/norns/tree/42df84420774)
separates the `crone` audio engine, `matron` control process, and `maiden`
browser editor/manager. The official [extension and service
documentation](https://monome.org/docs/norns/extending/) describes independent
systemd services. That boundary is closer to Jiko's intended instrument than a
browser-first assistant: the device keeps being the product while the browser
is an optional service/authoring surface.

The pinned [norns-shield hardware
tree](https://github.com/monome/norns-shield/tree/afe961324aa5) includes board
source, BOM, mechanical files, and revisions under GPL-3.0. Official shield
documentation records physical problems such as Pi 4 Wi-Fi noise, shielding,
screw pressure, and mechanical shorts. The official [software failure
guide](https://monome.org/docs/norns/help/software/) also documents update
recovery by SSH or reflash; this is honest failure evidence, not an A/B update
pattern Jiko should copy. Monome's [batch history](https://monome.org/old.html)
records recent batches, component quality issues, and supply delays; it is
stronger shipped evidence than a prototype gallery.

Jiko consequences:

- the local instrument loop must survive observer/browser close, crash, and
  reconnect;
- capture, product control, and browser/service tooling should remain separate
  supervised processes;
- codec, driver, image, and board revision form a named hardware profile;
- Wi-Fi transmit, power source, enclosure state, cable routing, fastener torque,
  and metalwork enter the acoustic test matrix;
- the service surface exposes a bounded API, not arbitrary filesystem access.

Do not copy the SuperCollider music stack, old CM3 choice, microSD recovery, or
developer SSH policy. Public shield licensing also does not imply that every
commercial norns hardware revision is open.

## 2. Bela — Treat Linux Capture As A Real-Time System Before Adding An MCU

The pinned [Bela software tree](https://github.com/BelaPlatform/Bela/tree/fb362a543281)
uses Xenomai and PRU support. Its
[`PRU.cpp`](https://github.com/BelaPlatform/Bela/blob/fb362a543281/core/PRU.cpp)
handles frame synchronization, DMA, clock, timeouts, and underruns explicitly;
[`Bela.h`](https://github.com/BelaPlatform/Bela/blob/fb362a543281/include/Bela.h)
exposes underrun detection/counting. The
[hardware repository](https://github.com/BelaPlatform/bela-hardware/tree/dee84eefff7c)
contains editable Bela Gem Stereo/Multi sources. Bela documents currently sold
and legacy systems on its official product pages, so this is a maintained
platform rather than only a paper prototype. Software is LGPL-3.0; the hardware
README uses CC-BY-SA-3.0 and points to a commercial-license path.

The transferable rule is not "use Xenomai." It is:

```text
real-time capture/playback
        -> bounded nonblocking handoff
        -> non-real-time normalization / STT / receipts / UI / network
```

Jiko consequences:

- an audio callback never performs model inference, filesystem IO, UI work, or
  an unbounded allocation;
- xrun/underrun/gap counts belong to each turn and soak receipt, not only logs;
- before adding ESP32-S3, measure a Linux-only isolated capture worker under
  concurrent kiosk, STT, TTS, receipt, network, and observer load;
- an architecture-qualification window requires zero unaccounted xruns and must
  attribute every observed fault to a turn and resource trace;
- browser refresh, disconnect, or crash must not perturb capture cadence.

Bela's sub-millisecond vendor figures are experiment orientation only. They are
not Jiko release-to-result evidence and do not justify changing the CM5 main
compute direction.

## 3. Zynthian — The Most Direct Pi 5 Whole-Instrument Reference

Zynthian's current [technical specifications](https://zynthian.org/technical-specifications)
describe a purchasable Pi 5 instrument with DSI display, physical controls,
balanced audio IO, passive cooling, and a broad power-input range. Those are
vendor specifications, not Jiko measurements. The pinned
[hardware tree](https://github.com/zynthian/zynthian-hw/tree/b96b9c7dba46)
contains V5 main/control-board KiCad and BOM material, while the
[UI tree](https://github.com/zynthian/zynthian-ui/tree/62e86a6b90ea) remains
active. Public V5 hardware and current V5.1 sales material are not a proven
one-to-one production release; the distinction must remain visible.

The official [WebConf guide](https://wiki.zynthian.org/index.php?mobileaction=toggle_view_desktop&title=Web_Configuration_User_Guide)
shows a useful recovery property: an invalid ALSA/JACK configuration can stop
the product GUI while the configuration/recovery surface remains usable. The
[no-dedicated-hardware path](https://wiki.zynthian.org/index.php/No_Hardware_Build)
also supports progressive proof from a bare Pi to a hardware profile.

Jiko consequences:

- validate a bare Pi 5 audio/display baseline, then a reference-audio profile,
  then a Jiko carrier profile instead of debugging every layer at once;
- keep a minimal local service surface available when the kiosk, audio daemon,
  or product UI cannot start;
- pin ALSA device, channel map, sample format/rate, buffer, GPIO, display, power,
  and thermal policy in the device profile;
- incompatible or missing profiles refuse `ready`; they do not guess a channel;
- boot fixtures include wrong sound card, swapped channels, failed audio daemon,
  missing display, and recovery without the normal product UI.

Do not inherit the plugin-heavy music graph, microSD update strategy, or assume
Zynthian's passive Pi 5 thermal claims transfer into Jiko's thinner enclosure.

## 4. Tympan Rev F — A Production Package And Acoustic-Test Reference

The pinned [Tympan Rev F hardware
release](https://github.com/Tympan/Tympan_Rev_F_Hardware/tree/19194a1f17ee)
documents its first production run and a component-lifecycle change from the
discontinued BC127 to nRF52840 while retaining expansion compatibility. It
contains editable design sources, Gerber/drill, BOM, STEP/SolidWorks/STL,
battery SDS/transport material, and a programming fixture. The maintained
[Tympan Library](https://github.com/Tympan/Tympan_Library/tree/4a2ba904c511)
is MIT; the Rev F hardware is CERN-OHL-P-2.0. Its store describes individual
programming/testing, which supports small-batch shipment, not high-volume yield.

Tympan also publishes independent acoustic measurements for an older Rev C.
Those measurements are useful because they include input-referred noise,
maximum output, THD, frequency response, directionality, and KEMAR work. They
must not be reassigned to Rev F or Jiko.

Jiko consequences:

- every codec, microphone, radio, PMIC, flash, and display has manufacturer part
  number, lifecycle state, approved substitutes, and retest triggers;
- production release means editable source, Gerber/drill/assembly, BOM, STEP,
  fixture, calibration, flash map, factory image, and wired recovery procedure;
- changing a mic/codec/radio/PMIC triggers the acoustic, RF, power, thermal, and
  recovery matrix again;
- factory acoustic evidence includes per-mic polarity/level/noise, input-referred
  noise, THD+N, frequency response, output level, directionality, and batch
  distribution;
- a battery product keeps cell SDS, transport/UN38.3 evidence, protection design,
  and charge/temperature policy with its release record.

Do not copy its Teensy/Arduino architecture or hearing-assistance product
assumptions into Jiko.

## 5. Sound Open Firmware — Bind The Whole Audio Compatibility Tuple

The pinned [SOF tree](https://github.com/thesofproject/sof/tree/6f92aeeb44c7)
and [architecture](https://github.com/thesofproject/sof/blob/6f92aeeb44c7/ARCHITECTURE.md)
separate host driver, DSP firmware, and external topology. IPC3/IPC4 provide
versioned protocol families, and the project includes explicit scheduling and
memory-domain design. The pinned
[sof-test tree](https://github.com/thesofproject/sof-test/tree/954bad3d32ef)
contains multi-format playback/capture, stress, reboot, and logging tests.
Linux kernel documentation for codecs such as
[CS35L56](https://docs.kernel.org/sound/codecs/cs35l56.html) shows real systems
depending on SOF firmware/topology, which is stronger than a project marketing
claim. The ecosystem has mixed BSD/GPL/MIT components; it is not one uniformly
licensed package.

Jiko should borrow the compatibility contract, not the framework:

```text
OS image + kernel/driver + board revision + codec revision
+ MCU/DSP firmware + topology/channel map + calibration
+ app/protocol/model versions
= one admitted hardware profile
```

Ready state validates the complete tuple. HIL must deliberately combine the
wrong firmware, topology, channel map, and board profile and prove that the unit
refuses normal operation with an actionable recovery state. Release, developer,
and nightly artifacts stay separate and identifiable. Firmware trace/crash
evidence survives restart without retaining user audio.

## 6. OpenEarable 2.0 — Conditional Wearable Risk Reference

The pinned [OpenEarable 2.0
tree](https://github.com/OpenEarable/open-earable-2/tree/23ff47eca2ef) uses
nRF5340/Zephyr and exposes FOTA, two cores, J-Link recovery, storage, fuel gauge,
and audio/sensor management. Its README records practical failures including
deep-discharge recovery, left/right identity recovery, and an SD remount limit
that requires power cycling. The
[OpenEarable 2.0 paper](https://publikationen.bibliothek.kit.edu/1000180676/159683121)
documents the platform and a short study, but the published battery table is a
datasheet-derived estimate and the study does not prove all-day powered wear.

The top-level repository license is also a caution: it is a `LicenseRef-PCFT`
with Nordic-specific restrictions and apparent tension with other openness
language. The paper's license description, product name, or public source tree
must not substitute for per-file SPDX and legal review. No code is copied into
Jiko from this reference.

Only a future body-worn/in-ear branch should activate these gates:

- measured whole-device runtime in every operating state, charge-while-used
  temperature, skin-contact temperature, deep-discharge recovery, and an
  eight-hour dynamic wear study;
- left/right/device identity, pairing/bonding, and wired recovery fixtures;
- SD hot-plug/remount behavior and storage-write electrical noise measured at
  the microphones;
- iOS/Android transport matrix, battery shipping evidence, and a per-file
  license/binary-source ledger.

It does not change the current Pi 5/CM5 desktop-instrument direction.

## Gates Added To Jiko

### Real-time audio gate

With kiosk, STT, TTS, receipt writes, cache work, and observer/network load
active, the qualification window has zero unaccounted xrun/underrun/gap events.
Each fault is bound to session/attempt, monotonic time, audio profile, and a
resource trace. This gate is run on Linux before an MCU is allowed into the BOM.

### Product/service-plane isolation gate

Observer disappearance never stops the instrument. If kiosk or audio startup
fails, a minimal local service plane still exposes immutable hardware/profile
identity, readiness failure, logs, and bounded recovery actions.

### Hardware compatibility tuple gate

Image, kernel/driver, MCU/DSP firmware, topology/channel map, calibration,
codec, PCB, protocol, app, and model revisions are admitted as a tuple. A
mismatch cannot reach normal `ready` and must be covered by HIL.

### Acoustic-mechanical-RF gate

Measure noise floor/EIN, THD+N, frequency response, first/last phoneme, channel
balance, and STT delta across Wi-Fi transmit, power sources, storage writes,
enclosure state, cable routing, fastener torque, assembly tolerance, and
temperature. A supplier data sheet or open-board result is not an enclosure
result.

### Substitution and production gate

A substitute component reopens the affected verification matrix. EVT release
must already contain buildable sources, production outputs, BOM/lifecycle data,
fixture self-test, calibration, wired recovery, and traceable hashes; DVT adds
multi-unit distribution and yield evidence.

### Update and recovery gate

Signed inactive-slot update remains the intended Linux direction, but every DUT
also keeps a recovery path that does not depend on the running OS, network, or
OTA service. HIL injects power loss and incompatible compatibility tuples.

## Resulting Hardware Direction

These references strengthen rather than overturn the current decision:

- Pi 5 remains the measurement platform and CM5/eMMC the leading EVT compute
  direction;
- prove a bounded Linux capture process and service plane before adding an MCU;
- keep USB/raw-versus-processed audio as the first acoustic baseline;
- add ESP32/XMOS only after an A/B receipt shows a primary benefit and its
  firmware/profile/recovery cost is accepted;
- enter carrier-board EVT only after the production, compatibility, acoustic,
  and recovery gates above have executable fixtures.
