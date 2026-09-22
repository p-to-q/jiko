# Jiko Linux supervision profile

Status: **checked-in deployment contract; not yet proved on Raspberry Pi or CM5**

This directory defines the first versioned Linux process boundary for a
self-contained Jiko instrument. It runs prebuilt artifacts and local providers;
it does not compile at boot, download models, call cloud speech services, or
put hardware details into the shared core.

The contract identifier is `jiko_systemd_v1`. The preflight and readiness
commands emit machine-readable receipts rather than treating a running process
as proof that the instrument is usable.

## Included units

| Unit | Scope | Behavior |
| --- | --- | --- |
| `jiko-server.service` | system | Starts the prebuilt Node server, validates immutable/mutable paths, loads the real configured STT worker during readiness, and gives shutdown ten seconds before escalation. |
| `jiko-server-probe.service` + `.timer` | system | Rechecks strict readiness every 30 seconds and leaves a failed unit plus journal receipt. It deliberately does not create an automatic health/restart loop. |
| `jiko-web.service` | system | Serves the already-built UI on loopback with Python's static server. This is a local instrument shell, not an Internet web server. |
| `jiko-device.service` | system | Runs the thin Raspberry Pi input adapter after requesting the local server, but remains alive across server failure/restart so its SQLite outbox can keep button timing. It is enabled only on a real GPIO target. |
| `jiko-kiosk.service` | user | Starts Chromium after the graphical user session, probes both the server and built shell first, and restarts a closed/crashed kiosk with a bounded start limit. |

The server, web shell, and device adapter are fixed to loopback. The current
write API has no authentication, so changing `HOST` or `JIKO_SERVER_URL` in an
environment file fails preflight, while systemd IP policy independently denies
non-loopback traffic. A future LAN observer profile needs authentication,
authorization, transport security, and a separate threat review.

## Required release layout

Assemble and validate a release before installing units:

```text
/opt/jiko/releases/<release-id>/
  apps/server/dist/index.js
  apps/server/scripts/sherpa-sensevoice-worker.py
  apps/server/local-clips/
  apps/server/sessions -> /var/lib/jiko/sessions
  apps/web/dist/index.html
  apps/web/dist/demo.html
  apps/device/pi_button_adapter.py
  deploy/systemd/

/opt/jiko/current -> /opt/jiko/releases/<release-id>
/var/lib/jiko/sessions/
/var/lib/jiko/models/
/etc/jiko/server.env
/etc/jiko/web.env
/etc/jiko/device.env
```

`apps/server/sessions` must be a symlink into `/var/lib/jiko`. This preserves
canonical receipts across an atomic release switch and lets
`ProtectSystem=strict` keep the release tree read-only. Do not copy development
receipts into a release. Models are provisioned separately under `/var/lib/jiko`
and are identified by the existing SenseVoice readiness hashes.

Create a dedicated `jiko` system user and add only the target groups it needs
(`audio`, plus `gpio` when the adapter is enabled). Install environment files
as `root:jiko` mode `0640`; the preflight rejects a group/world-writable file.
Use the checked-in examples as a field list, not as working target values.

Before switching `/opt/jiko/current`, run from the release build workspace:

```sh
pnpm install --frozen-lockfile
pnpm build
node deploy/systemd/validate-units.mjs
node --test deploy/systemd/test/*.test.mjs
```

On the Linux target, after copying units into `/etc/systemd/system` and the
user kiosk unit into the kiosk account's systemd user directory, validate the
actual installed files:

```sh
sudo systemd-analyze verify /etc/systemd/system/jiko-*.service /etc/systemd/system/jiko-*.timer
sudo systemctl daemon-reload
sudo systemctl enable --now jiko-server.service jiko-web.service jiko-server-probe.timer
```

Enable `jiko-device.service` only after the GPIO pin/header conflict and button
behavior have been checked on the target. Enable the kiosk from the graphical
account with `systemctl --user enable --now jiko-kiosk.service`; a system unit
must not guess the compositor display socket or own a user's Chromium session.

## Preflight and readiness

The service startup path has two distinct checks:

1. `runtime-preflight.mjs` validates the deployment schema, built artifacts,
   environment-file permissions, loopback policy, executable/model paths,
   local-provider policy, and writable receipt state.
2. `runtime-probe.mjs` calls the existing `/health` diagnostic endpoint and
   applies the stricter deployment policy. `configured` is not `ready`; required
   ffmpeg, STT, TTS, and receipt checks must report the provider-specific
   `ready` state. For SenseVoice that includes a loaded recognizer and artifact
   hashes; Whisper currently proves executable/model presence, and local clips
   prove the complete required clip set. Those lighter checks are not inference
   or speaker-loop tests.

SenseVoice startup may legitimately load for up to 60 seconds. The server's
one-time activation probe therefore has a 75-second request budget inside a
90-second systemd start bound. The periodic probe uses the shorter value from
`server.env`. Web startup uses bounded connection retries to cover the small
exec-to-listen race.

Run checks through the installed service boundary when diagnosing installation;
this loads the environment without copying it into shell history or process
arguments:

```sh
sudo systemctl restart jiko-server.service
sudo systemctl status jiko-server.service
sudo systemctl start jiko-server-probe.service
sudo systemctl status jiko-server-probe.service
```

## Logs, stop, and recovery

Useful inspection commands:

```sh
journalctl -u jiko-server.service -u jiko-server-probe.service -b
journalctl -u jiko-device.service -b
systemctl show jiko-server.service -p Result -p ExecMainStatus -p NRestarts
systemctl list-timers jiko-server-probe.timer
```

Journald owns operational stdout/stderr. Do not add transcripts, raw audio, or
provider response bodies to those logs. Canonical session receipts remain in
`/var/lib/jiko/sessions`; they can contain transcript text and require an
explicit retention/consent policy. Raw working audio stays in the service's
private temporary directory and is deleted by the existing pipeline cleanup.

For the Node server, systemd sends `SIGTERM` only to the main process first.
The server stops accepting connections, closes attempt deadlines/work/output,
stops the persistent STT worker, and waits up to its existing three-second
output-drain bound. At ten seconds systemd terminates remaining processes. The
current Python adapter receives `SIGINT`, which reaches its existing
`KeyboardInterrupt`/GPIO close path; systemd escalates after ten seconds.

Crash exits restart after three seconds, capped at five starts per minute. A
periodic readiness failure does not restart a live server automatically because
an overloaded or temporarily loading model must not cause a restart storm. The
operator first inspects the typed probe result and journal, then uses
`systemctl restart jiko-server.service`. The device adapter deliberately keeps
running and retries its durable button operations while the server is down.
This preserves control events only; because the adapter captures no audio, it
does not make the human utterance or first syllable offline-safe.

Release recovery is an application-level rollback:

1. keep the previous immutable release directory;
2. stop the affected units;
3. atomically repoint `/opt/jiko/current` to the selected release;
4. start the units and require both preflight and readiness to pass;
5. repoint to the previous release if either check fails.

This is not a signed or power-loss-safe OS update. There is no RAUC/Mender A/B
image, boot-health mark, signed artifact manifest, database migration protocol,
or automatic rollback yet. Those remain required before field deployment.

## Evidence boundary

The portable contract tests prove the checked-in unit invariants and probe
semantics on the development machine. They do not prove that systemd accepted
the units on Raspberry Pi OS, that Chromium inherited the real graphical/audio
session, that GPIO/audio permissions are correct, that a model fits in target
memory, or that restarts preserve an in-flight human interaction. Record those
facts through target HIL and soak receipts rather than changing this status.
