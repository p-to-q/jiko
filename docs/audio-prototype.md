# Audio Prototype

## Prototype Goal

The first audio prototype should prove the full loop:

1. Record one spoken intention.
2. Transcribe it.
3. Extract voice and timing features.
4. Produce three independent reading states.
5. Trigger UI animation and TTS.

Accuracy can be rough at first. Reliability and observability matter more.

## Recommended Laptop Path

Use the laptop as the audio computer first. The Pi should not be the first place we debug microphone drivers, model installation, or TTS latency.

Preferred path:

- Browser or desktop UI starts/stops recording.
- Backend receives a WAV/WebM file.
- STT runs locally on the laptop or through a self-hosted local service.
- Python extracts feature data.
- Backend returns structured readings.

## STT Options

### Option A: FunASR Local Service

Best for: private Chinese or Chinese/English mixed transcription on the laptop.

Use:

- FunASR local Python pipeline for batch files.
- FunASR local server if we want an API boundary.
- Paraformer/SenseVoice-style models depending on language and speed needs.

Pros:

- Private and self-hosted.
- Strong Chinese ASR path.
- Includes VAD/punctuation-style pipeline options.
- Can expose a local API and keep the app architecture clean.

Cons:

- Python/model setup may take time.
- Needs local model downloads.
- Raspberry Pi is not the first target for this path; run the first STT spike on the laptop.

Source: FunASR describes itself as an industrial-grade ASR toolkit with offline/streaming ASR, VAD, punctuation, speaker diarization, and local service deployment options.

### Option B: faster-whisper

Best for: local desktop transcription when Whisper-family accuracy is preferred.

Pros:

- Mature Python library.
- Good laptop/GPU path.
- Supports CPU and GPU, with quantization options.

Cons:

- Model download and environment setup can eat time.
- Raspberry Pi may be too slow for comfortable real-time local Whisper; benchmark before using it as the primary STT path.

### Option C: whisper.cpp

Best for: local/offline C/C++ deployment and eventual Pi experiments.

Pros:

- Designed for CPU-only and quantized inference.
- Strong Apple Silicon path.
- Useful fallback when Python/GPU stack is annoying.

Cons:

- Integration is more command/process oriented unless wrapped.
- Real-time Pi performance must be tested with small models.

### Option D: MLX Whisper

Best for: Apple Silicon laptop experiments.

Pros:

- Native Apple Silicon acceleration through MLX.
- Keeps audio local.
- Useful if the demo laptop is a Mac.

Cons:

- Mac-specific.
- Not the Pi path.
- Still needs model download and benchmarking.

### Option E: Vosk

Best for: Pi-compatible offline speech recognition and lightweight fallback.

Pros:

- Offline.
- Small models.
- Explicitly targets Raspberry Pi and other small devices.
- Streaming API.

Cons:

- Lower transcription quality than modern Whisper-family models.
- May struggle with noisy Chinese/English mixed demo speech.

### Option F: sherpa-onnx

Best for: a future unified offline path across desktop and embedded devices.

Pros:

- Offline ASR/TTS/speaker tooling through ONNX Runtime.
- Supports desktop and embedded targets, including Raspberry Pi-class devices.
- Multiple language/runtime bindings.

Cons:

- More setup complexity for the first day.
- Needs model choice and benchmarking before becoming the main path.

## Voice Activity Detection

Use VAD to split speech and silence before running readings.

Recommended:

- Silero VAD for Python prototype.
- Browser-side simple RMS threshold only for UI responsiveness.

Silero VAD is lightweight, supports 8 kHz and 16 kHz sampling rates, and has Python/ONNX paths. It is a good fit for detecting start/end of speech and silence segments.

## Feature Extraction

Minimum features for the first prototype:

- Total recording duration.
- Speech duration.
- Silence duration.
- Number of pauses.
- Longest pause.
- Time from button down to first speech.
- Mean RMS volume.
- RMS variance.
- Approximate pitch mean.
- Approximate pitch variance.
- Speech rate from transcript length over speech duration.

Recommended libraries:

- Web Audio API: browser-side recording and live metering.
- MediaRecorder API: simple browser audio capture.
- Meyda: JavaScript real-time and offline audio features via Web Audio.
- librosa: Python offline feature extraction.
- aubio: pitch detection and onset/tempo style features.
- openSMILE: larger feature sets if we later want emotion-like speech features.

Do not start with a black-box emotion classifier. Use transparent features first, because the product needs independent readings, not a fake confidence label.

## Reading Heuristics

The first version can be rule-based:

Text reading:

- `maintain` if text contains avoidance, delay, safety, returning, "maybe later", "不去", "算了", "还是".
- `deviate` if text contains rupture, motion, asking, quitting, confessing, going, "试试", "离开", "辞职", "说出来".
- `static` if transcript is too short or STT confidence is weak.

Voice reading:

- `maintain` if speech is quiet, low variance, many long pauses, or energy drops sharply.
- `deviate` if speech has rising energy, stable volume, faster attack, or pitch/energy variance increases.
- `static` if audio is clipped, too noisy, or mostly silence.

Timing reading:

- `maintain` if user delays before speaking, pauses before key verbs, or stops early.
- `deviate` if user begins quickly, continues after hesitation, or speaks past an initial pause.
- `static` if recording is too short or button behavior is unclear.

These rules should output confidence under `0.75` unless there is an unusually strong signal. Low confidence is acceptable; disagreement is the point.

## TTS Options

### Local TTS

Use when we want private, no-cost speech output.

Recommended default:

- Piper for generated speech.
- Pre-generated local clips for the most important result lines.
- macOS `say` or browser speech synthesis only as an emergency laptop fallback.

For the hackathon, pre-generated local clips may be the most reliable path for the final spoken lines. Dynamic TTS can come after the interaction works.

Piper is a fast local neural TTS engine with command-line, Python API, web server, and C/C++ API paths. Finding the right Chinese voice may take time, so the demo should not depend on last-minute voice design.

## Audio Control Rules

- Pause microphone capture while TTS is playing.
- Store extracted feature JSON for each dev session.
- Store raw recordings only when debugging requires them.
- Show a debug panel only in dev mode.
- Always allow a manual transcript override for demo rehearsal.
- Keep result text short enough that TTS never becomes the main event.
- Do not send audio to paid cloud APIs by default.

## Minimal Session Log

```json
{
  "sessionId": "2026-06-28-demo-001",
  "startedAt": "2026-06-28T10:00:00+08:00",
  "transcript": "我在考虑辞职",
  "audio": {
    "durationMs": 3810,
    "speechMs": 2490,
    "preSpeechDelayMs": 620,
    "pauseCount": 2,
    "longestPauseMs": 510,
    "rmsMean": 0.12,
    "rmsStd": 0.04,
    "pitchMeanHz": 178,
    "pitchStdHz": 21
  },
  "readings": [
    { "channel": "text", "state": "deviate", "confidence": 0.64 },
    { "channel": "voice", "state": "maintain", "confidence": 0.57 },
    { "channel": "timing", "state": "maintain", "confidence": 0.61 }
  ]
}
```

## Research Links

- FunASR: https://github.com/modelscope/FunASR
- faster-whisper: https://github.com/SYSTRAN/faster-whisper
- whisper.cpp: https://github.com/ggml-org/whisper.cpp
- MLX Whisper: https://github.com/ml-explore/mlx-examples/blob/main/whisper/README.md
- Vosk: https://github.com/alphacep/vosk-api
- sherpa-onnx: https://github.com/k2-fsa/sherpa-onnx
- Silero VAD: https://github.com/snakers4/silero-vad
- Web Audio API: https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API
- MediaRecorder API: https://developer.mozilla.org/en-US/docs/Web/API/MediaRecorder
- Meyda: https://github.com/meyda/meyda
- librosa: https://librosa.org/doc/latest/index.html
- aubio: https://aubio.org/manual/latest/
- openSMILE: https://audeering.github.io/opensmile/
- Piper TTS: https://github.com/OHF-Voice/piper1-gpl
