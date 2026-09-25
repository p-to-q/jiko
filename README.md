# [jiko]

**instant decision making instrument**

**a traffic light for your own thoughts.**

---

jiko is a small physical signal instrument. it listens to one spoken intention, separates it into three separately computed readings — content, emotion, context — then reveals whether the readings agree or diverge. it does not tell you what to do. the final choice stays with you.

> pre-release · v0.9 · hardware in design · software prototype functional · [site live](https://jiko.ptoq.io)

When every AI rushes to give you an answer, jiko refuses — it splits your thought into three signal lights, and leaves you to read them.

In an age of too many answers, restraint is radical.

> [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev) [2026-09-17] takes a wonderfully heretical model route: give up string generation and return typed, probabilistic decisions in a reported 70–500 ms. That reaches a surprisingly similar feeling of fast, bounded judgment. It makes this landscape more interesting. ([research note](docs/research-system-one-jev.md))

## what it is not

- not an AI assistant.
- not a decision recommendation engine.
- not a therapy chatbot or fortune-telling machine.
- not a traffic light that says stop / go.

the device can reveal signal, disagreement, or unanimity. but the interpretive step belongs to the person.

## the ritual

1. hold the side button.
2. speak one intention — "I'm thinking about quitting" or "I may not go tonight."
3. three windows animate independently; each locks into a signal state.
4. the top strip shows a short observation.
5. the device speaks one line, then stops.

the silence after speech is part of the product. it gives the decision back.

## signal states

- **maintain** — the reading sees inertia, a return to the familiar path.
- **deviate** — the reading sees rupture, movement, a break from pattern.
- **static** — the reading cannot form a stable signal.

color mapping: red · yellow · green. never good / bad / correct / wrong.

## hardware direction

a thick vertical slab — masked four-window shell, side thumb button. the current hardware and kiosk work is designed around a Raspberry Pi 5 with an MPI3508 display, but that target has not yet completed a physical integration receipt and the product form remains independent of any specific compute board. the interaction is quieter and stranger than an assistant.

current industrial design uses superellipse (squircle) corner geometry. see `docs/form-factor.md` and `docs/hardware-notes.md`.

## three surfaces

- `https://jiko.ptoq.io/` — canonical public website.
- `https://jiko-showcase.vercel.app/` — Vercel fallback / frontend deployment URL.
- `/?mode=device` — the intended kiosk face; physical-instrument proof is still pending.
- `showcase.html` — a standalone Three.js hardware-material study.
- `site.html` — the public first-viewport, embedding the hardware object in a quiet framed page.

same product language, no shared fake runtime paths.

## quickstart

```sh
pnpm install
pnpm dev:server
pnpm dev:web
pnpm demo:urls
```

trigger a reading without audio:

```sh
curl -X POST http://localhost:4317/sessions \
  -H 'content-type: application/json' \
  -d '{"sessionId":"demo-001","source":"manual"}'

curl -X POST http://localhost:4317/sessions/demo-001/manual-transcript \
  -H 'content-type: application/json' \
  -d '{"transcript":"I am thinking about quitting, but I still want to say this clearly first.","language":"en"}'
```

## docs

- [Product Brief](docs/product-brief.md)
- [Engineering Discipline](docs/engineering-discipline.md)
- [Productization Program](docs/productization-program.md)
- [Operational Readiness](docs/operational-readiness.md)
- [Human Experience And Interface Audit](docs/human-experience-audit.md)
- [Mature Device Systems Research And Jiko Redesign](docs/mature-device-systems-research.md)
- [Wearable And Desktop Hardware Research](docs/research-wearable-hardware.md)
- [Embedded Local Voice Systems Research](docs/research-embedded-voice-systems.md)
- [Audio Instrument And Production Systems Research](docs/research-audio-instrument-production-systems.md)
- [System One Models / Jev Research](docs/research-system-one-jev.md)
- [Edge Speech, Compute, And Hardware Co-Design](docs/research-edge-speech-optimization.md)
- [Edge Speech Route Map](docs/edge-speech-routes-v1.svg)
- [Low-Latency Voice Input: Local And API Paths](docs/research-low-latency-voice-input.md)
- [Open Voice Hardware Repository Archaeology](docs/research-open-voice-hardware-repos.md)
- [ASR Accuracy Stack And Model Selection](docs/research-asr-accuracy-stack.md)
- [Benchmark Plan](docs/benchmark-plan.md)
- [Instrument Runtime Design](docs/instrument-runtime-design.md)
- [Algorithm Evaluation And Scheduling](docs/algorithm-evaluation.md)
- [Hardware Compute Decision](docs/hardware-compute-decision.md)
- [Engineering Architecture](docs/engineering-architecture.md)
- [Backend Architecture](docs/backend-architecture.md)
- [Runtime Paths](docs/runtime-paths.md)
- [Audio Prototype](docs/audio-prototype.md)
- [Data Handling](docs/data-handling.md)
- [Remote Audio Policy](docs/remote-audio-policy.md)
- [Result Copy](docs/result-copy.md)
- [Form Factor](docs/form-factor.md)
- [Hardware Phases](docs/hardware-phases.md)
- [Hardware Notes](docs/hardware-notes.md)
- [Hardware Interfaces](docs/hardware-interfaces.md)
- [Showcase Design Decisions](docs/showcase-design-decisions.md)
- [Waitlist Deploy](docs/waitlist-deploy.md)
- [Demo Runbook](docs/demo-runbook.md)
- [Repository Map](docs/repository-map.md)
- [Release Versioning](docs/release-versioning.md)
- [Next Phase Checklist](docs/next-phase-checklist.md)
- [Open Questions](docs/open-questions.md)

## contributing

this is an open hardware-design workflow. issues, questions, and design discussions are welcome.

```
https://github.com/p-to-q/jiko/issues
```

## license

[CC BY-NC-SA 4.0](./LICENSE). you can read, learn, fork, and contribute — but not commercialize.

a [p → q](https://www.ptoq.io/) project.
