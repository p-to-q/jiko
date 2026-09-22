# Release Versioning

This repository uses one product version across its workspace packages.
The package versions are not package-publication promises; they are a shared
prototype release marker for the current jiko artifact.

## Current Release

- Version: `0.9.0`
- Release name: `Showcase Prototype`
- Hardware phase: **Jiko Zero** (hackathon prototype; Raspberry Pi 5 + MPI3508)
- Git identity: resolve from the exact built checkout; do not reuse a stale
  documentation SHA as release evidence.

The next minor should be `0.10.0` when the browser recording, receipt viewer,
and one benchmarked local STT path are stable enough to rehearse as a single
laptop-first demo loop. That line continues Jiko Zero. The Jiko One (custom
carrier with Linux-class compute, showcase form factor) milestones will be
tracked separately in [Hardware Phases](hardware-phases.md) once that stack is
defined; custom silicon remains deferred.

## Calculation

The old `0.2.0` line understated the demonstrated product surface, but commit
counts and source-line totals are not maturity evidence and immediately go
stale. Build metadata, receipts, and release notes must derive the commit SHA
from the checkout that actually passed the gate. The project is still pre-1.0
because target hardware, a decision-grade real-speech model benchmark, and the
signed update/rollback workflow are not release-qualified.

## Version Rule

Use pre-1.0 SemVer with capability milestones:

- `0.MINOR.0`: a new demonstrable product capability or releaseable prototype
  stage.
- `0.MINOR.PATCH`: bug fixes, hardening, copy updates, asset refreshes, and
  validation improvements inside that capability stage.
- `+N.gHASH`: optional build metadata for the mechanical snapshot ordinal.

Keep all workspace package versions aligned.

## Milestone Ladder

- `0.1.0` - Repository Seed.
- `0.2.0` - Audio Loop Prototype.
- `0.3.0` - Local TTS and Pi Display Shell.
- `0.4.0` - Smoke Test and Runtime Diagnostics.
- `0.5.0` - Audio Feature and Manual Fallback Layer.
- `0.6.0` - Local STT Provider Paths.
- `0.7.0` - Demo Runtime Hardening.
- `0.8.0` - Device UI, Asset, and Recorder Preview.
- `0.9.0` - Showcase Prototype.

Milestones `0.1.0` through the current release are **Jiko Zero** work:
laptop-first loop, Pi kiosk shell, and the four-window UI. Future milestones will
carry the shared core into **Jiko One** once the compute-module and custom-carrier
stack is known.
