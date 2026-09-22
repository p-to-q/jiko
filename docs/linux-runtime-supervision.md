# Linux runtime supervision boundary

Status: **implemented configuration and host-tested contract; target proof missing**

Jiko now has a first deployment boundary for Linux under
[`deploy/systemd`](../deploy/systemd/README.md). It is intentionally smaller
than an update system: it defines which built processes run, what must be ready,
where mutable state lives, how crash restart is bounded, and how an operator can
inspect and recover the local instrument.

## Decision

- `jiko-server` owns orchestration, local STT/TTS adapters, attempt cancellation,
  results, and receipts.
- `jiko-web` serves the prebuilt shared UI locally. It is not a second product
  core and does not run a Vite development server on boot.
- `jiko-device` remains a thin hardware-edge adapter. It requests and orders
  after the server at boot, but has an independent lifecycle so button events
  continue entering its SQLite outbox during a server crash/restart.
- Chromium remains a graphical **user** service. A system daemon should not
  fabricate display/session ownership.
- All HTTP stays on loopback while command routes are unauthenticated.
- A process being alive is only liveness. Activation uses a strict readiness
  probe; the periodic timer records later readiness loss without blindly
  restarting a potentially overloaded service.

The checked-in schema identifier is `jiko_systemd_v1`. Preflight and live probe
outputs are versioned as `jiko_systemd_v1` and `jiko_runtime_probe_v1`; static
unit validation emits `jiko_systemd_contract_v1`.

## What this closes

- boot no longer implies `pnpm`, TypeScript compilation, model download, or a
  mutable checkout;
- receipt state is required to live outside the immutable release;
- environment files have an explicit ownership/mode boundary and production
  paths must be absolute;
- only enumerated local/self-hosted STT and local TTS choices pass preflight;
- `configured` provider labels do not satisfy production readiness;
- server shutdown has a ten-second outer bound around the existing graceful
  cancellation/worker/output drain;
- crash loops have a restart delay and start-rate cap;
- the kiosk cannot start before the local built shell answers its probe;
- journald and canonical receipt locations have separate privacy rules.

## What remains open

This work does not make the repository field-ready. The units have not run on
Pi 5/CM5, GPIO/audio group permissions are unproved, Chromium microphone and
Wayland/X11 startup are unproved, and the static web server is appropriate only
for a loopback instrument shell. There is no authenticated remote observer,
durable SSE replay, automatic stuck-process watchdog, signed release manifest,
OS A/B updater, boot-health mark, or power-loss rollback drill.

The next proof is not another configuration file. It is a target receipt that
records cold boot, model-ready time/RSS, kiosk-ready time, one real physical
turn, controlled server/model crashes, clean stop, restart count, receipt
continuity, and an eight-hour soak under kiosk + audio + STT/TTS load.
