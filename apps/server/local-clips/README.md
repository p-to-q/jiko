# Local TTS Clips

Put pre-generated local result-line clips here during rehearsal.

This directory is for local assets only. Do not commit real generated speech
clips unless the team explicitly decides the clip is a synthetic fixture.

Expected file names:

- `mixed.no-majority.wav`
- `minority.maintain.wav`
- `minority.deviate.wav`
- `minority.static.wav`
- `consensus.maintain.wav`
- `consensus.deviate.wav`
- `consensus.static.wav`

Supported extensions in lookup order:

1. `.wav`
2. `.mp3`
3. `.m4a`
4. `.aiff`

Use:

```sh
TTS_PROVIDER=clip TTS_CLIP_DIR=local-clips pnpm dev:server
```

Generate rehearsal clips locally:

```sh
pnpm --filter @jiko/server generate:clips -- --voice Tingting
```

The default generator uses macOS `say` and writes `.aiff` files. For Piper:

```sh
TTS_GENERATE_COMMAND=piper PIPER_VOICE=/path/to/voice.onnx pnpm --filter @jiko/server generate:clips
```

Set `TTS_PLAY_AUDIO=1` to let the server call a local playback command. By
default the server records clip readiness in the receipt without playing audio.
