# Release Versioning

This repository uses one product version across the private workspace packages.
The package versions are not package-publication promises; they are a shared
prototype release marker for the current jiko artifact.

## Current Release

- Version: `0.9.0`
- Release name: `Showcase Prototype`
- Snapshot ordinal: `23`
- Reference commit: `db14613`

Full internal label:

```text
jiko 0.9.0 "Showcase Prototype" (+23.db14613)
```

## Calculation

The old `0.2.0` line understated the project state. At the current reference
commit, the repository has:

- 23 total commits.
- 11 feature commits.
- 5 fix or hardening commits.
- 4 asset or chore commits.
- 2 merge commits.
- 1 initialization commit.
- 49 tracked source files, 10,896 source lines.
- 28 tracked documentation files, 5,902 documentation lines.
- 44 tracked structured asset files, 4,046 lines.
- 129 counted source, documentation, and structured asset files, 21,628 lines.

The mechanical snapshot number is therefore `23`, but the release version should
not be `0.23.0`. A commit count is useful build metadata, not a product-maturity
minor version. The project is still pre-1.0 because the hardware smoke test,
local STT benchmarking, and release/deployment workflow are not locked.

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

The next minor should be `0.10.0` when the browser recording, receipt viewer,
and one benchmarked local STT path are stable enough to rehearse as a single
laptop-first demo loop.
