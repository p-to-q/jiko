# Repository Map

This map should stay short. It explains where things go without turning the repo into a process museum.

## Active Files

- `README.md`: entrypoint, current direction, and docs map.
- `apps/web`: Vite/React MPI3508 UI preview. The main app renders one
  320 x 480 device canvas for Pi/kiosk use, `showcase.html` renders a Three.js
  hardware study with the device face attached as a live canvas texture rather
  than a DOM overlay, and `site.html` is the first minimal official-site frame
  that embeds that hardware study inside a 1200 px centered column.
- `apps/server`: local backend with HTTP commands, SSE events, manual transcript loop, audio upload, ffmpeg normalization, first-pass audio features, local STT/TTS adapter boundaries, shared readings, and dev receipts.
- `packages/protocol`: shared Zod schemas and TypeScript types for session events, readings, features, transcripts, results, and receipts.
- `packages/core`: shared session reducer and result composer.
- `packages/readings`: first transparent text, voice, and timing reading heuristics.
- `docs/product-brief.md`: product definition and interaction shape.
- `docs/engineering-discipline.md`: how humans and agents should change the repo.
- `docs/engineering-architecture.md`: system architecture and event protocol.
- `docs/backend-architecture.md`: non-UI backend architecture, local audio pipeline, provider boundaries, and staged backend work.
- `docs/runtime-paths.md`: laptop app path and Raspberry Pi hardware path.
- `docs/audio-prototype.md`: STT, TTS, VAD, and audio feature plan.
- `docs/data-handling.md`: privacy and retention rules for audio/transcript data.
- `docs/result-copy.md`: top-screen result copy rules and candidate lines.
- `docs/form-factor.md`: Raspberry Pi 5 physical form and screen-layout direction.
- `docs/hardware-notes.md`: screen, shell, button, Pi, and mounting notes.
- `docs/hardware-interfaces.md`: Raspberry Pi 5 and MPI3508 interface notes, with secondary Pi notes.
- `docs/demo-runbook.md`: hackathon laptop-plus-Pi setup, smoke tests, and fallback ladder.
- `docs/next-phase-checklist.md`: readiness check and decisions before implementation.
- `docs/release-versioning.md`: shared prototype version calculation and naming rule.
- `docs/open-questions.md`: unresolved questions.
- `docs/repository-setup.md`: private GitHub setup notes.
- `.env.example`: environment variable names only.
- `.gitignore`: ignored local files, secrets, recordings, and build output.
- `AGENTS.md`: local instructions for coding agents.

- `apps/device`: Raspberry Pi thin hardware adapters. The first adapter bridges a GPIO side button into normal jiko session events.

## Next Code Paths

- Browser recording upload and receipt viewer in `apps/web`.
- Local STT provider setup and latency measurement.
- Raspberry Pi 5 hardware smoke test for the `apps/device` GPIO adapter.

## Not Active Yet

These are intentionally not present:

- `LICENSE`: the project is private and not open source.
- `CODE_OF_CONDUCT.md`: unnecessary for a private hackathon repo right now.
- `SECURITY.md`: add later if the repo becomes a deployed product.
- ADR/RFC routes: add only when a decision becomes durable and expensive to reverse.
- Full CI: add after the first runnable app exists.

## Reading Order

For new contributors:

1. `README.md`.
2. `docs/product-brief.md`.
3. `docs/result-copy.md`.
4. `docs/form-factor.md`.
5. `docs/engineering-discipline.md`.
6. `docs/backend-architecture.md`.
7. `docs/runtime-paths.md`.
8. `docs/data-handling.md`.
9. `docs/next-phase-checklist.md`.

Read the rest only when touching that area.
