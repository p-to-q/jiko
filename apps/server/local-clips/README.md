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
TTS_PROVIDER=clip TTS_CLIP_DIR=apps/server/local-clips pnpm dev:server
```

Set `TTS_PLAY_AUDIO=1` to let the server call a local playback command. By
default the server records clip readiness in the receipt without playing audio.
