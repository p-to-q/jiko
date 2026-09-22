# Productization Program

## Role And Objective

The engineering role for this program is **principal product-systems engineer
and evidence steward**. The job is not to make the prototype look complete. It
is to make every important claim reproducible, make failure visible, and move
Jiko from an interactive demo to an unattended local instrument.

The long-range objective is:

> A person can power on one physical Jiko, hold the side control, speak, receive
> a result, and repeat the interaction for a full operating day without a
> laptop, cloud audio service, operator intervention, or unexplained state.

The current website and Three.js body are product intent. They are not evidence
that the hardware envelope, acoustics, power system, thermal path, or production
runtime works.

## Non-negotiable Principles

1. **One shared core, two runtime shells.** Protocol, state reduction, reading
   logic, result composition, and copy selection stay in shared packages. The
   laptop shell and device shell only adapt capture, GPIO, playback, launch, and
   operating-system concerns.
2. **Hardware stays at the edge.** A screen, microphone, GPIO pin, audio device,
   or compute module may change without changing the product state machine.
3. **Local audio is the default.** STT and TTS run locally or on a self-hosted
   endpoint. Paid cloud audio is outside policy until explicitly approved under
   [Remote Audio Policy](remote-audio-policy.md); implementation flags alone are
   not approval.
4. **The instrument must not flatter itself.** Missing confidence stays
   missing. Simulated features are labelled simulated. A fallback must not be
   presented as a measured result.
5. **A receipt is stronger than a claim.** Benchmarks, device runs, releases,
   and soak tests keep machine-readable inputs, versions, timings, outcomes,
   and hashes.
6. **Manual control is a protocol client.** Rehearsal and recovery controls
   emit the same events as browser audio and hardware controls.
7. **Private by construction.** Temporary audio is deleted. Real recordings
   and transcripts are never committed. Retention is explicit and off in
   production unless a reviewed need exists.
8. **No diagnostic theatre.** The three readings are transparent heuristics,
   not a psychological assessment or scientific measurement. Product language
   and benchmark labels must preserve that boundary.
9. **No target-hardware claim without target-hardware evidence.** Desktop and
   RK3588 measurements may select experiments; they do not prove Raspberry Pi
   5 performance.
10. **Small slices, mechanical proof.** Each change declares its boundary,
    invariant, proof, and non-goal as required by
    [`engineering-discipline.md`](engineering-discipline.md).

## Architecture That Must Survive Productization

```text
shared product core
  packages/protocol  event and receipt contracts
  packages/core      state reduction, result composition, instrument scene
  packages/readings  transparent first-pass heuristics

laptop shell                    device shell
  browser microphone              side control / GPIO or USB HID
  local server                    device-local capture
  local/self-hosted STT           ARM64 local STT
  local clips/TTS                 local clips/TTS
  desktop playback                kiosk UI and watchdogs
```

Jiko Zero currently combines a laptop compute/audio shell with a Raspberry Pi
kiosk shell. That is a valid integration prototype, but it is a **two-computer
demo**, not the self-contained instrument in the objective.

Jiko One should not jump from that demo to “custom chip.” The next credible
hardware step is a measured single-device prototype on an off-the-shelf ARM64
board or compute module and a serviceable carrier. Custom silicon is unjustified
until workload, power, volume, cost, and thermal data exist.

The 80 × 120 × 6.6 mm model in [`hardware-phases.md`](hardware-phases.md) is an
appearance-derived envelope. It is not a functional stack-up. Board height,
screen assembly, battery, microphone keep-out, connector strain relief,
fasteners, and cooling must be measured before that thickness becomes a product
requirement.

## Program Gates

| Gate | Outcome | Required evidence | Explicitly not enough |
| --- | --- | --- | --- |
| G0 Truthful baseline | Current repo can be replayed and audited | unit tests, typecheck, build, smoke receipt, structural benchmark receipt, honest surface inventory | a successful website render |
| G1 Laptop loop | Real speech completes the full loop repeatedly | consented/local corpus, configured STT receipt, browser E2E run, fallback audit, latency distribution | manual transcript only |
| G2 Device-local alpha | One device boots and runs without laptop/network | target image manifest, mic/button/display/TTS loop, service restart test, 30-minute thermal run | Pi displaying laptop-hosted UI |
| G3 EVT | Electrical and mechanical architecture is credible | measured stack-up, BOM, power budget, thermal map, port/button force/clearance, 24-hour HIL soak, recovery tests | showcase dimensions, an 8-hour architecture screen, or a printed shell alone |
| G4 DVT | Repeatable units meet a frozen verification plan | multiple builds, fixture/yield results, acoustic/noise tests, 72-hour or representative-duty-cycle campaign, accessibility checks, update/rollback drill, pre-compliance results | one hand-tuned prototype |
| G5 Pilot | A small fleet can be operated and supported | signed/versioned image, fleet receipts without content, failure taxonomy, replacement/recovery runbook, retention review | developer SSH access as the recovery plan |

No gate closes from prose alone. The evidence path and the date of the last
passing run must appear in [`operational-readiness.md`](operational-readiness.md).

## Workstreams And Order

### 1. Truth, replay, and test foundations

- Remove random or fabricated values from product receipts.
- Test protocol parsing, reducer transitions, reading thresholds, and result
  determinism.
- Generate benchmark manifests with commit, lockfile, fixture, runtime, and
  result hashes.
- Add CI only after the local commands are stable; CI should run the same
  commands, not introduce a second validation path.

### 2. Real audio closure

- Build a legal, consented, local evaluation set covering Mandarin, English,
  code-switching, quiet speech, hesitation, room noise, clipping, and silence.
- Compare sherpa-onnx SenseVoice int8, quantized whisper.cpp, and the existing
  self-hosted FunASR route on identical audio and hardware.
- Replace hand-tuned silence segmentation with a measured VAD candidate only
  after output equivalence and end-to-end latency are recorded.
- Keep fixed local result clips as the production baseline. Dynamic TTS is an
  optional feature that requires license, voice quality, cold-start, and ARM64
  evidence.

### 3. Runtime hardening

- Authenticate operator and device write routes; bind management surfaces to a
  trusted interface.
- Enforce legal event transitions and idempotency at the server boundary.
- Add readiness/health endpoints that check ffmpeg, model files, writable
  receipt storage, audio devices, and UI/server version compatibility.
- Package server, kiosk, and button/capture adapters as supervised services
  with bounded restart and logs.
- Define offline startup, update, rollback, power-loss, and storage-corruption
  recovery rather than assuming the browser remains healthy.

### 4. Single-device integration

- Measure the actual screen, active cooler, microphone, control, cable, and
  power assemblies.
- Establish a power tree and peak-current budget before selecting a battery.
- Establish microphone location with self-noise and handling-noise recordings;
  an aesthetic pinhole is not an acoustic design.
- Run STT with the kiosk, screen, VAD, and thermal management active. Isolated
  model speed is not a product number.
- Use the Pi 5 dedicated power-button/J2 path for clean shutdown experiments;
  keep the record control a separate protocol input.

### 5. Hardware verification and operations

- EVT freezes interfaces, not cosmetics: display, compute, storage, power,
  thermal, microphone, control, and service access.
- Use labgrid for the complete Pi/CM DUT and pytest-embedded for any ESP32
  edge firmware; both drive canonical protocol events and store versioned HIL
  receipts rather than creating a second demo path.
- Spike a signed inactive-slot updater such as RAUC on disposable CM5/eMMC
  images and inject power loss during every update phase before selecting it.
- DVT adds fixtures, repeated units, assembly tolerances, drop/strap/cable
  stress, acoustic tests, RF/EMC/ESD pre-compliance, and first-pass-yield/
  retest/station-cycle evidence.
- Pilot images are immutable and versioned. A field unit can factory-reset or
  roll back without retaining a person’s audio or transcript.

## Continuous-operation Definition

“Can stay online” means all of the following are demonstrated on the target
unit:

- cold boot reaches an explicit ready state with network unavailable;
- the side control, microphone, inference, result, silence, and reset loop can
  complete repeatedly;
- a killed server, kiosk, or adapter is restarted into a known state;
- power loss during idle and receipt write does not leave an unbootable unit;
- storage is bounded and raw audio is absent after the session;
- model or audio failure produces an explicit degraded state, never a normal
  success receipt;
- an 8-hour architecture screen has zero observed lost events and no
  progressive memory, storage, temperature, or latency failure; EVT and DVT
  still require the longer 24-hour and 72-hour/representative-duty-cycle gates;
- the installed image, models, configuration schema, and UI/server protocol
  versions can be identified from one support receipt.

## Standards And Primary References

Use these as engineering inputs, not as certification claims:

- Raspberry Pi 5 power, USB budget, cooling, RTC, power button, and boot
  watchdog: https://www.raspberrypi.com/documentation/computers/raspberry-pi.html
- Official 64-bit Raspberry Pi OS kiosk baseline:
  https://www.raspberrypi.com/tutorials/how-to-use-a-raspberry-pi-in-kiosk-mode/
- IEC 62368-1:2023 edition 4, corrected 2025-08, for AV/ICT hazard-based safety
  pre-compliance: https://webstore.iec.ch/en/iec_catalog/product/preview/?id=L3B1Yi9wZGYvcHJldmlldy9pbmZvX2llYzYyMzY4LTF7ZWQ0LjB9Yi5wZGY%3D
- WCAG 2.2 for operator/preview UI, including 24 × 24 CSS px target minimum:
  https://www.w3.org/TR/WCAG22/

## Comparison Sources

The program intentionally adopts useful disciplines from neighbouring p-to-q
projects without copying their product assumptions:

- Matter: outcome/boundary/invariant/proof slices and mechanically checked
  architecture — https://github.com/p-to-q/matter
- SEE-ME SEE-U: implemented/measured/specified surface honesty and degradation
  audits — https://github.com/p-to-q/see-me-see-u
- Murmur: audio closure, observability, and release verification —
  https://github.com/p-to-q/murmur
- Carburetor: reproducible run manifests and hardware-status honesty —
  https://github.com/p-to-q/carburetor
- Wittgenstein: separate cost, latency, and quality dimensions; label structural
  proxies as proxies — https://github.com/p-to-q/wittgenstein
