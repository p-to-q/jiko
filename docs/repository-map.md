# Repository Map

This map should stay short. It explains where things go without turning the repo into a process museum.

## Active Files

- `README.md`: entrypoint, current direction, and docs map.
- `apps/web`: Vite/React MPI3508 UI preview. The main app renders one
  320 x 480 device canvas for Pi/kiosk use, `showcase.html` renders a Three.js
  hardware study with the device face attached as a live canvas texture rather
  than a DOM overlay, and `site.html` is the first minimal official-site frame
  that embeds that hardware study inside a 1200 px centered column.
- `apps/server`: local backend with HTTP commands, SSE events, manual transcript
  loop, batch upload, ordered-PCM WebSocket ingress, ffmpeg normalization,
  first-pass audio features, local STT/TTS adapter boundaries, shared readings,
  and dev receipts.
- `packages/protocol`: shared Zod schemas and TypeScript types for session events, readings, features, transcripts, results, and receipts.
- `packages/core`: shared session reducer, result composer, and framework-neutral
  instrument-scene projection.
- `packages/readings`: first transparent text/content, voice/delivery, and
  timing/interaction heuristics. Public product language remains
  content/emotion/context; runtime evidence is deliberately narrower and does
  not claim to measure inner emotion or unconstrained context.
- `benchmarks`: structural reading, STT, hardware-HIL, and host-soak harnesses
  with strict receipts. Existing host runs do not qualify target hardware or a
  model winner.
- `docs/product-brief.md`: product definition and interaction shape.
- `docs/engineering-discipline.md`: how humans and agents should change the repo.
- `docs/productization-program.md`: role, non-negotiable principles, evidence
  gates, and the long-range path to a standalone instrument.
- `docs/operational-readiness.md`: honest implemented/measured/specified
  inventory, validation ledger, and release blockers.
- `docs/human-experience-audit.md`: participant/observer UX audit, session-truth
  findings, shared-renderer direction, typography candidates, and latency SLOs.
- `docs/mature-device-systems-research.md`: Omi and mature embedded-system
  lessons, target architecture, hardware gates, benchmarks, and phased redesign.
- `docs/research-wearable-hardware.md`: Satellite1, Watcher, ReSpeaker, 01
  Light, OpenGlass/Friend lineage, recovery patterns, and pre-PCB gates.
- `docs/research-embedded-voice-systems.md`: Pi/CM, ESP32-S3, local voice,
  audio-edge, watchdog/update, power, soak, and production-test evidence.
- `docs/research-audio-instrument-production-systems.md`: norns, Bela,
  Zynthian, Tympan, SOF, and OpenEarable lessons for real-time audio,
  service-plane recovery, compatibility tuples, manufacturing, and acoustics.
- `docs/research-system-one-jev.md`: System One/Jev claims, openness and terms,
  comparator design, edge fit, and adopt/spike/reject gates.
- `docs/research-edge-speech-optimization.md`: STT/ASR and TTS roles, faithful
  versus semantic transcript rules, optional remote policy, operator/runtime
  optimization ladder, accelerator gates, latency hypotheses, and staged
  implementation; `docs/edge-speech-routes-v1.svg` visualizes the three paths.
- `docs/research-low-latency-voice-input.md`: commit-pinned TypeFree and VoicePi
  code archaeology, Doubao/Volcengine API findings, canonical ordered-PCM
  capture/transport plus a default-off provider-neutral streaming lifecycle
  seam and fake conformance harness, strict fallback semantics, and the
  implementation/benchmark order; no real streaming model is integrated yet.
- `docs/research-open-voice-hardware-repos.md`: commit-pinned Omi, OpenGlass,
  Voice PE/ESPHome, Wyoming, ESP-SR/ADF, and 01 Light code archaeology with
  concrete buffering, recovery, OTA, privacy, licensing, and failure lessons.
- `docs/research-asr-accuracy-stack.md`: pinned ASR/VAD/frontend candidates,
  transcript fidelity rules, target-runtime optimization order, calibration,
  and a same-corpus model selection plan.
- `docs/benchmark-plan.md`: reproducible structural, model, runtime, and device
  benchmark contract.
- `docs/instrument-runtime-design.md`: the three signal lines, scheduler,
  fallbacks, hardware/observer UX contract, and performance plan.
- `docs/algorithm-evaluation.md`: model candidates, per-line metrics,
  scheduling/fallback policy, caches, and selection gates.
- `docs/hardware-compute-decision.md`: Linux SoM, ESP32, custom-carrier, and
  custom-silicon decision with target-device experiments.
- `docs/engineering-architecture.md`: system architecture and event protocol.
- `docs/backend-architecture.md`: non-UI backend architecture, local audio pipeline, provider boundaries, and staged backend work.
- `docs/runtime-paths.md`: laptop app path and Raspberry Pi hardware path.
- `docs/audio-prototype.md`: STT, TTS, VAD, and audio feature plan.
- `docs/data-handling.md`: privacy and retention rules for audio/transcript data.
- `docs/remote-audio-policy.md`: canonical release decision and approval gate
  for every paid third-party audio experiment.
- `docs/result-copy.md`: top-screen result copy rules and candidate lines.
- `docs/form-factor.md`: Raspberry Pi 5 physical form and screen-layout direction.
- `docs/hardware-notes.md`: screen, shell, button, Pi, and mounting notes.
- `docs/hardware-phases.md`: Jiko Zero / Jiko One definitions and physical dimensions from the USB-C reference.
- `docs/hardware-interfaces.md`: Raspberry Pi 5 and MPI3508 interface notes, with secondary Pi notes.
- `docs/showcase-design-decisions.md`: current visual decisions for the framed site and Three.js hardware showcase.
- `docs/demo-runbook.md`: hackathon laptop-plus-Pi setup, smoke tests, and fallback ladder.
- `docs/next-phase-checklist.md`: remaining integration, hardware-validation,
  and release-gate work after the first implemented slice.
- `docs/release-versioning.md`: shared prototype version calculation and naming rule.
- `docs/open-questions.md`: unresolved questions.
- `docs/repository-setup.md`: public-repository setup and privacy notes.
- `.env.example`: environment variable names only.
- `.gitignore`: ignored local files, secrets, recordings, and build output.
- `AGENTS.md`: local instructions for coding agents.

- `apps/device`: Raspberry Pi thin hardware adapters. The first adapter bridges a GPIO side button into normal jiko session events.

## Next Code Paths

- Finish the already-wired browser `ordered_pcm_v1` slice on the Pi/CM5 ALSA
  edge, then add restart-recoverable ownership and a global spool quota.
- Freeze a licensed/consented real-speech corpus and run the local streaming/
  batch model matrix with durable, versioned evidence.
- Run Raspberry Pi 5/CM5 HIL for GPIO, microphone, display, playback, recovery,
  latency, RSS, power, thermal, and soak behavior.

## Not Active Yet

These are intentionally not present or not yet complete:

- `CODE_OF_CONDUCT.md`: deferred until the contributor workflow needs one.
- `SECURITY.md`: add later if the repo becomes a deployed product.
- ADR/RFC routes: add only when a decision becomes durable and expensive to reverse.
- Full target release CI: host build/test/benchmark/Chromium gates now run in
  GitHub Actions, but target-HIL, reproducible model artifacts, signed images,
  and release qualification are not automated.

The tracked root `LICENSE` is CC BY-NC-SA 4.0. Model, runtime, voice, firmware,
and third-party hardware licenses remain separate artifact-level decisions.

## Reading Order

For new contributors:

1. `README.md`.
2. `docs/product-brief.md`.
3. `docs/result-copy.md`.
4. `docs/form-factor.md`.
5. `docs/hardware-phases.md`.
6. `docs/engineering-discipline.md`.
7. `docs/productization-program.md`.
8. `docs/operational-readiness.md`.
9. `docs/human-experience-audit.md`.
10. `docs/mature-device-systems-research.md`.
11. `docs/research-wearable-hardware.md`.
12. `docs/research-embedded-voice-systems.md`.
13. `docs/research-audio-instrument-production-systems.md`.
14. `docs/research-system-one-jev.md`.
15. `docs/research-edge-speech-optimization.md`.
16. `docs/research-low-latency-voice-input.md`.
17. `docs/research-open-voice-hardware-repos.md`.
18. `docs/research-asr-accuracy-stack.md`.
19. `docs/benchmark-plan.md`.
20. `docs/instrument-runtime-design.md`.
21. `docs/algorithm-evaluation.md`.
22. `docs/hardware-compute-decision.md`.
23. `docs/backend-architecture.md`.
24. `docs/runtime-paths.md`.
25. `docs/data-handling.md`.
26. `docs/remote-audio-policy.md`.
27. `docs/next-phase-checklist.md`.

Read the rest only when touching that area.
