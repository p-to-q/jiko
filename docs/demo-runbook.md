# Demo Runbook

This runbook is for the hackathon setup where the laptop is the compute and
audio core, and Raspberry Pi 5 plus MPI3508 is the visible display shell.

## Roles

- Laptop: server, browser recording, local STT, audio features, readings, TTS,
  receipts, and operator fallback.
- Raspberry Pi 5: Chromium kiosk display for the device UI.
- Optional Pi adapter: side-button events posted to the laptop server.

Do not move microphone capture, STT, TTS, or receipt writing onto the Pi for the
first demo unless the laptop loop is already stable.

## Laptop Setup

Install dependencies, then run the local server and web app:

```sh
pnpm install
pnpm dev:server
pnpm dev:web -- --host 0.0.0.0
```

The default server port is `4317`. The Vite dev server usually uses `5173`.
When the Pi opens the laptop-hosted page, the web app automatically points API
requests at `http://<same-laptop-ip>:4317` unless `VITE_API_URL` is set.

Find the laptop IP on the shared network:

```sh
pnpm demo:urls
```

If the laptop is not on Wi-Fi, use the interface that is actually shared with
the Pi.

## Local TTS Clips

For the demo, prefer pre-generated local clips over dynamic TTS.

Generate clips:

```sh
pnpm --filter @jiko/server generate:clips -- --voice Tingting
```

Run the server with clip playback enabled:

```sh
TTS_PROVIDER=clip \
TTS_CLIP_DIR=apps/server/local-clips \
TTS_PLAY_AUDIO=1 \
pnpm dev:server
```

If playback is disabled or a clip is missing, the result flow should still
continue and the receipt should say what happened.

## Pi Kiosk Setup

Put the Pi and laptop on the same network. On the Pi, open Chromium kiosk to:

```text
http://<laptop-ip>:5173/?mode=device
```

Example:

```sh
chromium-browser --kiosk --noerrdialogs --disable-infobars \
  'http://192.168.1.20:5173/?mode=device'
```

The device UI should preserve the MPI3508-oriented 320 x 480 layout. Confirm
screen rotation, visible area, and mask alignment before rehearsing the demo.

## Optional Pi Button

Use the Pi button adapter only after the display path works.

```sh
JIKO_SERVER_URL=http://<laptop-ip>:4317 \
python3 apps/device/pi_button_adapter.py
```

If the MPI3508 uses the GPIO header for touch or power, do not assume `GPIO17`
is safe. Prefer the browser record button, a USB HID button, or a small serial
controller before forcing a GPIO layout.

## Smoke Tests

Run the automated local smoke test first:

```sh
pnpm demo:smoke
```

This starts a temporary server with receipts disabled, runs one manual
transcript path, then uploads a synthetic WAV through the real audio pipeline.
It does not use real speech recordings.

Server health:

```sh
curl http://localhost:4317/health
```

Create a session and run the manual transcript fallback:

```sh
curl -X POST http://localhost:4317/sessions \
  -H 'content-type: application/json' \
  -d '{"sessionId":"demo-001","source":"manual"}'

curl -X POST http://localhost:4317/sessions/demo-001/manual-transcript \
  -H 'content-type: application/json' \
  -d '{"transcript":"我在考虑辞职，但还想先把这件事说清楚。","language":"zh"}'
```

Check the receipt:

```sh
curl http://localhost:4317/sessions/demo-001/receipt
```

Web smoke:

- Open `http://localhost:5173/` on the laptop.
- Use browser recording and confirm the debug panel shows transcript, features,
  readings, result, and TTS provider status.
- Open `http://localhost:5173/?mode=device` and confirm it fits the MPI3508
  device canvas.
- Open the same device URL from the Pi using the laptop IP.

## Fallback Ladder

Use the highest real path that works in the room:

1. Real browser recording plus configured local STT.
2. Real browser recording with STT unavailable, keeping real voice/timing
   features and an honest receipt.
3. Manual transcript through `POST /sessions/:id/manual-transcript`.
4. Operator `demo-event` only for start, stop, reset, or timing control.

Every fallback should still use the shared event protocol. Do not run a separate
fake UI path.

## Success Criteria

- Laptop recording can create a result and receipt.
- TTS clip playback works or records a clear provider receipt.
- Pi kiosk displays the device UI from the laptop-hosted web app.
- MPI3508 orientation and mask alignment are usable.
- Manual transcript fallback is rehearsed before judging.
