# jiko local server

Prototype-only local backend loop for the first laptop demo.

This app uses Node's built-in HTTP server and has no runtime dependencies. It
accepts raw audio uploads into the normal event stream, normalizes them with
`ffmpeg`, extracts first-pass audio features, calls a local STT adapter when one
is configured, and emits the same reading/result events as the manual demo path.
Manual transcripts remain available as a local rehearsal fallback.

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
- `GET /sessions/:sessionId`
- `GET /sessions/:sessionId/receipt`
- `POST /sessions`
- `POST /sessions/:sessionId/audio`
- `POST /sessions/:sessionId/manual-transcript`
- `POST /sessions/:sessionId/demo-event`

`POST /sessions/:sessionId/audio` expects a raw audio body such as `audio/webm`,
`audio/ogg`, `audio/wav`, or `audio/mp4`. It emits `input.recording.stopped`
when `durationMs` is provided, then `audio.uploaded`, `audio.normalized`,
`audio.transcribed`, `audio.features.extracted`, three reading events,
`session.result`, and TTS lifecycle events.

Raw audio and normalized working audio stay in the OS temp directory and are
deleted after the request. Receipts store metadata, transcript/provider status,
features, readings, result, and events, but not raw recordings.

## Local providers

- `FFMPEG_BIN`: defaults to `ffmpeg`.
- `STT_PROVIDER=funasr` with `FUNASR_ENDPOINT`: posts the normalized WAV to a
  local/self-hosted FunASR-compatible HTTP endpoint.
- `STT_PROVIDER=whisper.cpp` with `WHISPER_CPP_BIN` and `WHISPER_MODEL`: runs a
  local whisper.cpp CLI.
- If no local STT is configured, the text layer receives an empty transcript
  with provider `local:stt-unconfigured:unavailable`; voice and timing features
  still come from real audio.
- `TTS_PROVIDER=clip` with `TTS_CLIP_DIR`: looks for a pre-generated local clip
  by `tts.clipKey`, such as `minority.maintain.wav` or
  `consensus.static.wav`.
- Generate local rehearsal clips with
  `pnpm --filter @jiko/server generate:clips -- --voice Tingting`.
  The generator defaults to macOS `say`; set `TTS_GENERATE_COMMAND=piper` for
  Piper, or `TTS_GENERATE_COMMAND=copy TTS_GENERATE_EXTENSION=txt` for a dry run.
- Set `TTS_PLAY_AUDIO=1` to let the server play a found clip with
  `TTS_PLAY_COMMAND` or the platform default (`afplay` on macOS, `aplay` on Pi).
  When playback is disabled, the server records clip readiness in the receipt.
- `TTS_PROVIDER=piper` with `PIPER_BIN` and `PIPER_VOICE`: runs Piper locally.
  If no voice is configured, the server records that in the TTS provider receipt
  and keeps the result flow moving.

## Quick check

```sh
curl http://localhost:4317/health
curl -N http://localhost:4317/events
curl -X POST http://localhost:4317/sessions
curl -X POST 'http://localhost:4317/sessions/<id>/audio?durationMs=1800' \
  -H 'content-type: audio/webm' \
  --data-binary '@sample.webm'
curl http://localhost:4317/sessions/<id>/receipt
curl -X POST http://localhost:4317/sessions/<id>/manual-transcript \
  -H 'content-type: application/json' \
  -d '{"transcript":"我在考虑辞职，但还想先把这件事说清楚。","language":"zh"}'
```
