# [jiko]

**a traffic light for your own thoughts.**

---

jiko is a small physical signal instrument. it listens to one spoken intention, separates it into three independent readings — text, voice, timing — then reveals whether the readings agree or diverge. it does not tell you what to do. the final choice stays with you.

> pre-release · v0.9 · hardware in design · software prototype functional · [site live](https://jiko.ptoq.io)

当所有 AI 都抢着给你答案，jiko 偏不——它把你的念头拆成三个信号灯，然后让你自己看。

答案太多的年代，克制是一种激进。

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

a thick vertical slab — Raspberry Pi 5, MPI3508 display, masked four-window shell, side thumb button. the form borrows from field instruments and compact signal objects. the interaction is quieter and stranger than an assistant.

current industrial design uses superellipse (squircle) corner geometry. see `docs/form-factor.md` and `docs/hardware-notes.md`.

## three surfaces

- `https://jiko.ptoq.io/` — canonical public website.
- `https://jiko-showcase.vercel.app/` — Vercel fallback / frontend deployment URL.
- `/?mode=device` — the Raspberry Pi kiosk face. the actual instrument.
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
  -d '{"transcript":"我在考虑辞职，但还想先把这件事说清楚。","language":"zh"}'
```

## docs

- [Product Brief](docs/product-brief.md)
- [Engineering Discipline](docs/engineering-discipline.md)
- [Engineering Architecture](docs/engineering-architecture.md)
- [Backend Architecture](docs/backend-architecture.md)
- [Runtime Paths](docs/runtime-paths.md)
- [Audio Prototype](docs/audio-prototype.md)
- [Data Handling](docs/data-handling.md)
- [Result Copy](docs/result-copy.md)
- [Form Factor](docs/form-factor.md)
- [Hardware Notes](docs/hardware-notes.md)
- [Hardware Interfaces](docs/hardware-interfaces.md)
- [Showcase Design Decisions](docs/showcase-design-decisions.md)
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

a [p to q](https://www.ptoq.io/) project.
