# jiko mock server

Prototype-only local backend loop for the first laptop demo.

This app uses Node's built-in HTTP server and has no runtime dependencies. It
accepts raw audio uploads into the normal event stream, but audio normalization
and STT/TTS providers are not wired yet. Manual transcripts are treated as local
demo input and become mock features, three readings, and a `session.result`
event.

## Run

```sh
npm --prefix apps/server run dev
```

The default port is `4317`. Override it with `PORT=4318`.

Receipts are written to `apps/server/sessions/` by default outside production.
Disable them with:

```sh
JIKO_WRITE_RECEIPTS=0 npm --prefix apps/server run dev
```

## Endpoints

- `GET /health`
- `GET /events`
- `POST /sessions`
- `POST /sessions/:sessionId/audio`
- `POST /sessions/:sessionId/manual-transcript`
- `POST /sessions/:sessionId/demo-event`

`POST /sessions/:sessionId/audio` expects a raw audio body such as `audio/webm`,
`audio/ogg`, `audio/wav`, or `audio/mp4`. It emits `input.recording.stopped`
when `durationMs` is provided, then `audio.uploaded`. It does not store raw
audio and does not transcribe yet.

## Quick check

```sh
curl http://localhost:4317/health
curl -N http://localhost:4317/events
curl -X POST http://localhost:4317/sessions
curl -X POST 'http://localhost:4317/sessions/<id>/audio?durationMs=1800' \
  -H 'content-type: audio/webm' \
  --data-binary '@sample.webm'
curl -X POST http://localhost:4317/sessions/<id>/manual-transcript \
  -H 'content-type: application/json' \
  -d '{"transcript":"我在考虑辞职，但还想先把这件事说清楚。","language":"zh"}'
```
